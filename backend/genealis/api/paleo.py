"""Lecture des écritures anciennes (paléographie / HTR) — routes définies dans docs/ARCHITECTURE_V04.md."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai.errors import AIUnavailable, ExternalTransferRefused, QuotaExceeded
from ..db import get_session
from ..models import DocumentReading, Media, PersonMention, ReadingCorrection, utcnow
from ..paleo import benchmark, corrections, htr, mentions, pipeline, preprocess, scribe, scripts
from ..services import storage
from ..services.journal import log

router = APIRouter(prefix="/api", tags=["paleo"])


def _ai_error(db: Session, exc: Exception) -> HTTPException:
    """Erreurs de la couche IA → réponses HTTP claires (les journaux de coûts / transmissions sont conservés)."""
    db.commit()
    if isinstance(exc, QuotaExceeded):
        wait = f" Réessayez dans environ {max(1, (exc.retry_after_s or 60) // 60)} min." if exc.retry_after_s else ""
        return HTTPException(429, f"Plafond d'appels IA atteint ({exc.scope}) : aucune lecture n'a été envoyée. {exc}{wait}")
    if isinstance(exc, ExternalTransferRefused):
        return HTTPException(403, f"Envoi refusé pour protéger la vie privée : {exc}")
    return HTTPException(503, f"Lecture automatique indisponible : {exc}")


def _media(db: Session, media_id: str) -> Media:
    m = db.get(Media, media_id)
    if not m:
        raise HTTPException(404, "Document introuvable")
    return m


def _reading(db: Session, reading_id: str) -> DocumentReading:
    r = db.get(DocumentReading, reading_id)
    if not r:
        raise HTTPException(404, "Lecture introuvable")
    return r


def reading_dict(db: Session, r: DocumentReading, full: bool = True) -> dict[str, Any]:
    latest = pipeline.latest_reading(db, r.media_id)
    d: dict[str, Any] = {
        "id": r.id, "media_id": r.media_id, "version": r.version, "is_latest": bool(latest and latest.id == r.id),
        "engine": r.engine, "model": r.model, "status": r.status, "document_kind": r.document_kind,
        "script_type": r.script_type, "script_label": scripts.SCRIPTS.get(r.script_type or "", {}).get("label"),
        "language": r.language, "language_label": scripts.LANGUAGES.get(r.language or ""), "period_estimate": r.period_estimate,
        "scribe_key": r.scribe_key, "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        "uncertain_count": len([u for u in r.uncertain or [] if u.get("status") != "human_verified"]),
        "quality": r.quality or {}, "warnings": r.warnings or [],
    }
    if full:
        d.update({"preprocessing": r.preprocessing or {}, "zones": r.zones or [], "lines": r.lines or [],
                  "diplomatic": r.diplomatic, "normalized": r.normalized, "translation": r.translation,
                  "translation_language": r.translation_language, "uncertain": r.uncertain or [],
                  "extraction": r.extraction or {}, "photo_analysis": r.photo_analysis or {},
                  "corrections": [{"id": c.id, "ts": c.ts.isoformat() if c.ts else None, "line_n": c.line_n, "layer": c.layer,
                                   "before": c.before, "after": c.after, "note": c.note, "author": c.author}
                                  for c in corrections.corrections_of(db, r.id)],
                  "mentions_count": db.query(PersonMention).filter(PersonMention.reading_id == r.id).count()})
    return d


# ---------------------------------------------------------------- catalogue
@router.get("/paleo/scripts")
def paleo_scripts(db: Session = Depends(get_session)):
    return {**scripts.catalog(), "engines": htr.engines_status(db), "max_second_pass": pipeline.MAX_SECOND_PASS,
            "translate_targets": [{"id": "fr", "label": "Français"}, {"id": "en", "label": "Anglais"}]}


# ---------------------------------------------------------------- lectures
@router.post("/media/{media_id}/readings", status_code=201)
def create_reading(media_id: str, body: Optional[dict] = None, db: Session = Depends(get_session)):
    """Nouvelle lecture (nouvelle version). Options : script_type, language, translate_to, second_pass, scribe_key,
    engine (gemini | manual | external), manual_text, rotate, contrast, gray, negative, crop « x,y,w,h », document_kind."""
    m = _media(db, media_id)
    body = body or {}
    try:
        opts = pipeline.ReadOptions.from_dict(body)
        if opts.crop is not None:
            preprocess.parse_crop(opts.crop)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, f"Options invalides : {exc}")
    try:
        r = pipeline.read_document(db, m, options=opts)
    except (QuotaExceeded, ExternalTransferRefused, AIUnavailable) as exc:
        raise _ai_error(db, exc)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    log(db, f"Lecture paléographique v{r.version} de « {m.title} » ({r.engine}) : {len(r.lines or [])} ligne(s), "
            f"{len(r.uncertain or [])} passage(s) incertain(s)", category="analysis", person_id=m.person_id)
    db.commit()
    return reading_dict(db, r)


@router.get("/media/{media_id}/readings")
def list_readings(media_id: str, db: Session = Depends(get_session)):
    _media(db, media_id)
    rows = db.execute(select(DocumentReading).where(DocumentReading.media_id == media_id)
                      .order_by(DocumentReading.version.desc())).scalars().all()
    return [reading_dict(db, r, full=False) for r in rows]


@router.get("/media/{media_id}/readings/manual-prompt")
def manual_prompt(media_id: str, script_type: Optional[str] = None, language: Optional[str] = None,
                  translate_to: Optional[str] = "fr", db: Session = Depends(get_session)):
    """Consigne à coller dans claude.ai / chatgpt.com (abonnement) avec l'image ORIGINALE du document."""
    from ..paleo import prompts

    m = _media(db, media_id)
    key = scribe.resolve_scribe_key(db, m, None)
    st = scripts.normalize_script(script_type) if script_type else None
    user = prompts.read_user_prompt(guidance=scripts.script_guidance(st, language), scribe_context=scribe.context_prompt(
        scribe.scribe_context(db, key, st)), translate_to=translate_to, forced_script=st,
        forced_language=scripts.normalize_language(language) if language else None,
        filename=m.original_filename or m.title or "")
    return {"prompt": htr.ManualHTR.prompt(prompts.SYSTEM_PALEO, user), "file_url": f"/api/media/{m.id}/file",
            "filename": m.original_filename}


@router.get("/readings/{reading_id}")
def get_reading(reading_id: str, db: Session = Depends(get_session)):
    return reading_dict(db, _reading(db, reading_id))


@router.patch("/readings/{reading_id}/lines/{line_n}")
def correct_line(reading_id: str, line_n: int, body: dict, db: Session = Depends(get_session)):
    """Correction humaine d'une ligne (couche diplomatic | normalized | translation). Enregistrée et réutilisée."""
    r = _reading(db, reading_id)
    text = body.get("text")
    if not isinstance(text, str):
        raise HTTPException(400, "Texte de la correction manquant")
    try:
        c = corrections.apply_correction(db, r, line_n, text, layer=body.get("layer") or "diplomatic", note=body.get("note"))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    m = db.get(Media, r.media_id)
    log(db, f"Correction humaine de la ligne {line_n} ({c.layer}) dans « {m.title if m else r.media_id} »",
        category="decision", person_id=m.person_id if m else None)
    db.commit()
    return reading_dict(db, r)


@router.post("/readings/{reading_id}/recheck")
def recheck(reading_id: str, body: dict, db: Session = Depends(get_session)):
    """Seconde analyse d'un passage sur une découpe agrandie : {line_n, bbox?: [x,y,w,h] 0-1000, text?, index?}."""
    from ..paleo.second_pass import recheck_passage

    r = _reading(db, reading_id)
    m = _media(db, r.media_id)
    try:
        line_n = int(body.get("line_n"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Numéro de ligne manquant")
    bbox = body.get("bbox")
    if bbox is not None:
        try:
            bbox = list(preprocess.parse_crop(bbox) or [])
        except ValueError as exc:
            raise HTTPException(400, str(exc))
    img, _ = pipeline.page_image(m, pipeline.load_original(m), int((r.preprocessing or {}).get("pdf_page") or 0))
    if img is None:
        raise HTTPException(400, "La relecture d'une zone nécessite une image (ou un PDF lisible par PyMuPDF).")
    ctx = scribe.context_prompt(scribe.scribe_context(db, r.scribe_key, r.script_type))
    provider = htr.get_provider(db, body.get("engine"))
    ok, why = provider.available()
    if not ok or isinstance(provider, htr.ManualHTR):
        raise HTTPException(503, f"Seconde analyse indisponible : {why or 'mode copier-coller'}")
    try:
        entry = recheck_passage(db, r, img, line_n, passage=body.get("text") or None, bbox=bbox, index=body.get("index"),
                                provider=provider, subjects=[m.person_id] if m.person_id else None,
                                guidance=scripts.script_guidance(r.script_type, r.language), scribe_text=ctx)
    except (QuotaExceeded, ExternalTransferRefused, AIUnavailable) as exc:
        raise _ai_error(db, exc)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    db.commit()
    return {"passage": entry, "reading": reading_dict(db, r)}


@router.post("/readings/{reading_id}/validate")
def validate_reading(reading_id: str, body: Optional[dict] = None, db: Session = Depends(get_session)):
    r = _reading(db, reading_id)
    corrections.validate(db, r, (body or {}).get("note"))
    m = db.get(Media, r.media_id)
    log(db, f"Lecture v{r.version} de « {m.title if m else r.media_id} » relue et validée par l'utilisateur", category="decision",
        person_id=m.person_id if m else None)
    db.commit()
    return reading_dict(db, r)


@router.post("/readings/{reading_id}/mentions")
def extract_mentions(reading_id: str, body: Optional[dict] = None, db: Session = Depends(get_session)):
    """Personnes citées (rôle, lien déclaré, âge, métier, domicile, signature, zone de l'image). Aucun lien automatique."""
    r = _reading(db, reading_id)
    out = mentions.mentions_from_reading(db, r, investigation_id=(body or {}).get("investigation_id"))
    db.commit()
    return [mentions.mention_dict(x) for x in out]


@router.get("/readings/{reading_id}/mentions")
def list_mentions(reading_id: str, db: Session = Depends(get_session)):
    _reading(db, reading_id)
    rows = db.execute(select(PersonMention).where(PersonMention.reading_id == reading_id)
                      .order_by(PersonMention.created_at)).scalars().all()
    return [mentions.mention_dict(x) for x in rows]


# ---------------------------------------------------------------- image dérivée
@router.get("/media/{media_id}/view")
def media_view(media_id: str, rotate: int = 0, contrast: Optional[str] = None, negative: bool = False, gray: bool = False,
               crop: Optional[str] = None, max: int = Query(2400, ge=64, le=8000), db: Session = Depends(get_session)):
    """Image dérivée calculée à la volée (rotation, contraste « auto » ou facteur, négatif, gris, découpe x,y,w,h en 0-1000).
    Rien n'est enregistré : l'original reste intact et seul servi par /api/media/{id}/file."""
    m = _media(db, media_id)
    if not storage.exists(m.path):
        raise HTTPException(404, "Fichier introuvable")
    data = storage.read_bytes(m.path)
    img, _ = pipeline.page_image(m, data)
    if img is None:
        raise HTTPException(415, "Ce document n'est pas une image")
    auto = contrast == "auto"
    factor = None
    if contrast and not auto:
        try:
            factor = float(contrast)
        except ValueError:
            raise HTTPException(400, "contrast attendu : « auto » ou un nombre (1 = normal)")
    try:
        out, mime = preprocess.render_view(img, rotate=rotate, contrast=factor, auto_contrast=auto, negative=negative,
                                           gray=gray, crop=crop, max_side=max)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return Response(out, media_type=mime, headers={"Cache-Control": "private, max-age=600"})


# ---------------------------------------------------------------- mesure de qualité
@router.post("/paleo/benchmark")
def run_benchmark(body: dict, db: Session = Depends(get_session)):
    """CER / WER d'une lecture contre un texte de référence vérifié ({reading_id, reference_text} ou {reading_id, ref_id})."""
    r = _reading(db, body.get("reading_id") or "")
    ref_text, ref_meta = body.get("reference_text"), None
    if body.get("ref_id"):
        ref_meta = benchmark.get_ref(body["ref_id"])
        if not ref_meta:
            raise HTTPException(404, "Référence introuvable")
        ref_text = ref_meta["reference_text"]
    if not isinstance(ref_text, str) or not ref_text.strip():
        raise HTTPException(400, "Texte de référence manquant")
    layer = body.get("layer") or "diplomatic"
    hyp = {"diplomatic": r.diplomatic, "normalized": r.normalized, "translation": r.translation}.get(layer) or ""
    rep = benchmark.compare(ref_text, hyp)
    entry = {"ts": utcnow().isoformat(), "layer": layer,
             "ref_id": ref_meta["id"] if ref_meta else None, "ref_title": ref_meta["title"] if ref_meta else body.get("title"),
             "synthetic": bool(ref_meta and ref_meta.get("synthetic")),
             **{k: rep[k] for k in ("cer", "wer", "cer_normalized", "wer_normalized", "reference_chars", "reference_words")}}
    q = dict(r.quality or {})
    q["benchmarks"] = (q.get("benchmarks") or []) + [entry]
    r.quality = q
    db.commit()
    return {**rep, **entry, "reading_id": r.id, "engine": r.engine, "script_type": r.script_type}


@router.get("/paleo/benchmarks")
def list_benchmarks(db: Session = Depends(get_session)):
    out = []
    for r in db.execute(select(DocumentReading).order_by(DocumentReading.updated_at.desc()).limit(1000)).scalars():
        for b in (r.quality or {}).get("benchmarks") or []:
            out.append({**b, "reading_id": r.id, "media_id": r.media_id, "version": r.version, "engine": r.engine,
                        "script_type": r.script_type, "language": r.language})
    refs = [{k: v for k, v in ref.items() if k != "reference_text"} for ref in benchmark.load_refs()]
    return {"results": out, "references": refs}


@router.get("/paleo/corrections")
def list_corrections(scribe_key: Optional[str] = None, limit: int = 100, db: Session = Depends(get_session)):
    q = select(ReadingCorrection).order_by(ReadingCorrection.ts.desc()).limit(min(limit, 500))
    if scribe_key:
        q = q.where(ReadingCorrection.scribe_key == scribe_key)
    return [{"id": c.id, "ts": c.ts.isoformat() if c.ts else None, "reading_id": c.reading_id, "media_id": c.media_id,
             "scribe_key": c.scribe_key, "script_type": c.script_type, "line_n": c.line_n, "layer": c.layer,
             "before": c.before, "after": c.after, "note": c.note} for c in db.execute(q).scalars()]
