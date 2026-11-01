"""Pipeline de lecture d'un document ancien : ORIGINAL — TRANSCRIPTION — TRADUCTION.

Pour chaque lecture :
1. l'original est lu (jamais modifié) et son empreinte vérifiée ;
2. une COPIE de travail est préparée (orientation, contraste, découpe éventuelle) ;
3. un appel principal combine identification (écriture, langue), zones, transcription diplomatique ligne par ligne avec
   coordonnées, passages incertains, version normalisée, traduction et extraction généalogique ;
4. une seconde passe agrandie relit les passages incertains (plafonnée) ;
5. une NOUVELLE version de lecture est enregistrée (les précédentes sont conservées) ;
6. `Media.analysis` / `Media.ocr_text` sont mis à jour pour les écrans existants.

Une lecture automatique n'est jamais une preuve : elle reste « à vérifier » tant qu'une personne ne l'a pas relue.
"""
from __future__ import annotations

import copy
import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..ai.documents import normalize_extraction
from ..ai.errors import AIUnavailable
from ..models import DocumentReading, Media, ReadingCorrection
from ..services import storage
from . import preprocess, prompts, scribe, scripts
from .htr import HTRRequest, HTRResult, ManualHTR, get_provider

AUTO_WARNING = "Lecture automatique : à vérifier sur l'image avant toute utilisation comme preuve."
MAX_SECOND_PASS = 6


@dataclass
class ReadOptions:
    script_type: Optional[str] = None
    language: Optional[str] = None
    translate_to: Optional[str] = "fr"
    second_pass: bool = True
    max_second_pass: int = MAX_SECOND_PASS
    scribe_key: Optional[str] = None
    engine: Optional[str] = None  # gemini (défaut) | manual | external
    manual_text: Optional[str] = None
    document_kind: Optional[str] = None  # photo pour forcer l'analyse de photographie
    rotate: int = 0
    contrast: bool = True
    gray: bool = False
    negative: bool = False
    crop: Optional[str | list | tuple] = None
    page: int = 0
    extra: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict | None) -> "ReadOptions":
        d = dict(d or {})
        known = {k: v for k, v in d.items() if k in cls.__dataclass_fields__ and k != "extra"}
        o = cls(**known)
        o.script_type = scripts.normalize_script(o.script_type) if o.script_type else None
        o.language = scripts.normalize_language(o.language) if o.language else None
        o.max_second_pass = max(0, min(int(o.max_second_pass or 0), MAX_SECOND_PASS))
        return o


# ---------------------------------------------------------------- chargement de l'original
def load_original(media: Media) -> bytes:
    return storage.read_bytes(media.path)


def media_mime(media: Media, data: bytes) -> str:
    m = (media.mime_type or "").lower()
    if m:
        return m
    if data[:4] == b"%PDF":
        return "application/pdf"
    return "image/jpeg" if data[:3] == b"\xff\xd8\xff" else "image/png" if data[:4] == b"\x89PNG" else "application/octet-stream"


def page_image(media: Media, data: bytes, page: int = 0) -> tuple[Optional[bytes], str]:
    """Octets d'une image exploitable (page rendue pour un PDF) — None si le format n'est pas une image lisible."""
    mime = media_mime(media, data)
    if mime == "application/pdf":
        png = preprocess.pdf_page_png(data, page)
        return png, "image/png"
    if preprocess.is_image(mime if mime.startswith("image/") else None, data):
        return data, mime
    return None, mime


# ---------------------------------------------------------------- normalisation de la réponse
def _bbox_from(item: dict, transform: preprocess.Transform | None) -> Optional[list[int]]:
    raw = None
    if isinstance(item.get("box_2d"), list):
        raw = preprocess.box2d_to_bbox(item["box_2d"])
    elif isinstance(item.get("bbox"), list) and len(item["bbox"]) == 4:
        try:
            raw = [float(v) for v in item["bbox"]]
        except (TypeError, ValueError):
            raw = None
    if not raw:
        return None
    return transform.bbox_to_original(raw) if transform else preprocess.clamp_bbox(raw)


def _conf(v: Any, default: float = 0.5) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, f / 100 if f > 1 else f))


def _s(v: Any) -> Optional[str]:
    if v is None or isinstance(v, (dict, list)):
        return None
    t = str(v).strip()
    return t if t and t.lower() not in ("null", "none") else None


_MARK = re.compile(r"\[\?([^\]]*)\]")


def normalize_lines(payload: dict, transform: preprocess.Transform | None) -> list[dict]:
    lines_in = payload.get("lines") if isinstance(payload.get("lines"), list) else []
    out: list[dict] = []
    for i, ln in enumerate(lines_in):
        if isinstance(ln, str):
            ln = {"diplomatic": ln}
        if not isinstance(ln, dict):
            continue
        dip = _s(ln.get("diplomatic")) or _s(ln.get("text")) or ""
        bbox = _bbox_from(ln, transform)
        unc_out = []
        for u in ln.get("uncertain") or []:
            if isinstance(u, str):
                u = {"text": u}
            if not isinstance(u, dict) or not _s(u.get("text")):
                continue
            alts = [a for a in (_s(x) for x in (u.get("alternatives") or [])) if a and a != _s(u.get("text"))]
            unc_out.append({"text": _s(u.get("text")), "alternatives": alts[:6], "reason": _s(u.get("reason")),
                            "confidence": _conf(u.get("confidence"), 0.4), "bbox": _bbox_from(u, transform) or bbox,
                            "bbox_is_line": _bbox_from(u, transform) is None, "status": "uncertain"})
        # mots marqués [?mot] dans la transcription mais absents de la liste : jamais perdus
        known = {u["text"] for u in unc_out}
        for m in _MARK.findall(dip):
            if m and m not in known:
                unc_out.append({"text": m, "alternatives": [], "reason": "marqué incertain dans la transcription",
                                "confidence": 0.4, "bbox": bbox, "bbox_is_line": True, "status": "uncertain"})
        out.append({"n": len(out) + 1, "bbox": bbox, "zone": ln.get("zone"), "diplomatic": dip,
                    "normalized": _s(ln.get("normalized")), "translation": _s(ln.get("translation")), "uncertain": unc_out})
    return out


def normalize_zones(payload: dict, transform: preprocess.Transform | None) -> list[dict]:
    zones = []
    for z in payload.get("zones") or []:
        if isinstance(z, dict):
            b = _bbox_from(z, transform)
            if b:
                zones.append({"bbox": b, "kind": _s(z.get("kind")) or "text"})
    return zones


def compose(lines: list[dict], layer: str) -> Optional[str]:
    vals = [ln.get(layer) for ln in lines]
    if not any(vals):
        return None
    return "\n".join(v or "" for v in vals)


def all_uncertain(lines: list[dict]) -> list[dict]:
    out = []
    for ln in lines:
        for j, u in enumerate(ln.get("uncertain") or []):
            out.append({**u, "line_n": ln["n"], "index": j})
    return out


def quality_stats(lines: list[dict], payload_quality: dict | None) -> dict:
    n_chars = sum(len(ln.get("diplomatic") or "") for ln in lines)
    unc = all_uncertain(lines)
    unc_chars = sum(len(u.get("text") or "") for u in unc)
    q = {"lines": len(lines), "lines_with_bbox": sum(1 for ln in lines if ln.get("bbox")), "chars": n_chars,
         "uncertain_passages": len(unc), "uncertain_char_ratio": round(unc_chars / n_chars, 3) if n_chars else None,
         "verified_by_human": False, "self_assessment": None, "legibility": None, "problems": []}
    if isinstance(payload_quality, dict):
        q["self_assessment"] = _s(payload_quality.get("self_assessment"))
        q["legibility"] = _s(payload_quality.get("legibility"))
        q["problems"] = [p for p in (payload_quality.get("problems") or []) if isinstance(p, str)][:10]
    q["note"] = ("Mesure de qualité réelle seulement avec un texte de référence vérifié (CER/WER) ; "
                 "l'auto-évaluation du modèle n'est pas une mesure.")
    return q


def correction_suggestions(db: Session, lines: list[dict], scribe_key: str | None, script_type: str | None) -> int:
    """Signale (sans jamais remplacer) les mots déjà corrigés par l'utilisateur pour la même main."""
    gl = scribe.glossary(db, scribe_key, script_type)
    n = 0
    for ln in lines:
        text = ln.get("diplomatic") or ""
        sugg = []
        for g in gl:
            if g["before"] and re.search(rf"(?<!\w){re.escape(g['before'])}(?!\w)", text):
                sugg.append({"before": g["before"], "after": g["after"], "same_hand": g["same_hand"],
                             "correction_id": g["correction_id"],
                             "message": f"Une relecture humaine{' de la même main' if g['same_hand'] else ''} a corrigé « {g['before']} » en « {g['after']} »."})
        if sugg:
            ln["suggestions"] = sugg
            n += len(sugg)
    return n


# ---------------------------------------------------------------- mise à jour du média (écrans v0.3)
def sync_media(media: Media, reading: DocumentReading) -> None:
    ex = dict(reading.extraction or {})
    if reading.translation and not ex.get("translation_fr") and (reading.translation_language or "fr") == "fr":
        ex["translation_fr"] = reading.translation
    unc = [u.get("text") for u in all_uncertain(reading.lines or []) if u.get("text")]
    media.ocr_text = reading.diplomatic or ""
    if reading.language:
        media.language = reading.language[:8]
    media.analysis = {**(media.analysis or {}), "transcription": reading.diplomatic or "", "method": f"paleo:{reading.engine}",
                      "language": reading.language or "?", "extraction": ex, "words": [], "uncertain": unc,
                      "warnings": list(reading.warnings or []), "reading_id": reading.id, "reading_version": reading.version,
                      "normalized": reading.normalized, "translation": reading.translation,
                      "script_type": reading.script_type, "photo_analysis": reading.photo_analysis or None}
    media.analysis_status = "done" if (reading.diplomatic or reading.photo_analysis) else "failed"
    flag_modified(media, "analysis")


def latest_reading(db: Session, media_id: str) -> Optional[DocumentReading]:
    return db.execute(select(DocumentReading).where(DocumentReading.media_id == media_id)
                      .order_by(DocumentReading.version.desc())).scalars().first()


def recompute_texts(reading: DocumentReading) -> None:
    lines = reading.lines or []
    reading.diplomatic = compose(lines, "diplomatic") or ""
    reading.normalized = compose(lines, "normalized")
    tr = compose(lines, "translation")
    if tr:
        reading.translation = tr
    reading.uncertain = all_uncertain(lines)


def save_lines(reading: DocumentReading, lines: list[dict]) -> None:
    reading.lines = copy.deepcopy(lines)
    flag_modified(reading, "lines")
    recompute_texts(reading)
    flag_modified(reading, "uncertain")


# ---------------------------------------------------------------- lecture
def _next_version(db: Session, media_id: str) -> int:
    return int(db.execute(select(func.max(DocumentReading.version)).where(DocumentReading.media_id == media_id)).scalar() or 0) + 1


def _previous_script(db: Session, media: Media, scribe_key: str | None) -> tuple[Optional[str], Optional[str]]:
    q = select(DocumentReading).where(DocumentReading.script_type.isnot(None))
    q = q.where((DocumentReading.media_id == media.id) | (DocumentReading.scribe_key == scribe_key)) if scribe_key else \
        q.where(DocumentReading.media_id == media.id)
    r = db.execute(q.order_by(DocumentReading.created_at.desc())).scalars().first()
    if r and r.script_type != "unknown":
        return r.script_type, r.language
    return None, None


def is_photo(media: Media, opts: ReadOptions) -> bool:
    return (opts.document_kind or "").lower() == "photo" or (media.kind or "") in ("photo", "portrait")


def read_document(db: Session, media: Media, *, options: ReadOptions | dict | None = None) -> DocumentReading:
    """Lit le document et enregistre une NOUVELLE version de lecture. L'original n'est jamais modifié.

    Lève `AIUnavailable` (dont `QuotaExceeded`, `ExternalTransferRefused`) si le moteur ne peut pas lire :
    aucune lecture vide n'est alors enregistrée."""
    opts = options if isinstance(options, ReadOptions) else ReadOptions.from_dict(options)
    original = load_original(media)
    sha = hashlib.sha256(original).hexdigest()
    warnings: list[str] = [AUTO_WARNING]
    if media.sha256 and media.sha256 != sha:
        warnings.append("Attention : l'empreinte du fichier ne correspond plus à celle de l'import.")
    img, mime = page_image(media, original, opts.page)
    if is_photo(media, opts):
        from .photo import read_photo

        return read_photo(db, media, img, mime, original, sha, opts, warnings)

    key = scribe.resolve_scribe_key(db, media, opts.scribe_key)
    prev_script, prev_lang = _previous_script(db, media, key)
    script_hint = opts.script_type or prev_script
    guidance = scripts.script_guidance(script_hint, opts.language or prev_lang)
    ctx = scribe.scribe_context(db, key, script_hint, exclude_media_id=media.id)
    ctx_text = scribe.context_prompt(ctx)

    transform: preprocess.Transform | None = None
    prep: dict[str, Any] = {"original_sha256": sha, "original_untouched": True}
    if img is not None:
        try:
            wc = preprocess.working_copy(img, rotate=opts.rotate, crop=opts.crop, contrast=opts.contrast, gray=opts.gray,
                                         negative=opts.negative)
            send, send_mime, transform = wc.data, wc.mime, wc.transform
            prep.update(wc.describe())
        except Exception as exc:  # image illisible par Pillow (HEIC…) : on envoie l'original tel quel
            send, send_mime = original, mime
            prep["operations"] = []
            warnings.append(f"Copie de travail impossible ({exc}) : original envoyé sans retouche.")
    else:
        send, send_mime = original, mime
        prep["operations"] = []
        if mime == "application/pdf":
            warnings.append("PDF lu sans rendu d'image (PyMuPDF absent) : coordonnées approximatives, pas de seconde passe agrandie.")
    if mime == "application/pdf" and img is not None:
        prep["pdf_page"] = opts.page

    user = prompts.read_user_prompt(guidance=guidance, scribe_context=ctx_text, translate_to=opts.translate_to,
                                    forced_script=opts.script_type, forced_language=opts.language,
                                    filename=media.original_filename or media.title or "", document_kind=opts.document_kind,
                                    working_note=("L'image jointe est une découpe d'une zone du document." if opts.crop else None))
    subjects = [media.person_id] if media.person_id else None
    provider = get_provider(db, opts.engine)
    if isinstance(provider, ManualHTR):
        if not opts.manual_text:
            raise ValueError("Mode copier-coller : collez la réponse de l'assistant (manual_text).")
        ok, why = provider.available()
        if not ok:
            raise AIUnavailable(why)
        result: HTRResult = provider.parse(opts.manual_text)
        transform_used = None  # l'utilisateur joint l'original : coordonnées déjà relatives à l'original
    else:
        ok, why = provider.available()
        if not ok:
            raise AIUnavailable(why)
        result = provider.read(HTRRequest(send, send_mime, prompts.SYSTEM_PALEO, user, purpose=f"lecture paléo {media.id}",
                                          subject_person_ids=subjects))
        transform_used = transform
    payload = result.payload

    lines = normalize_lines(payload, transform_used)
    zones = normalize_zones(payload, transform_used)
    script_type = opts.script_type or scripts.normalize_script(payload.get("script_type")) or "unknown"
    ex_lang = (payload.get("extraction") or {}).get("language") if isinstance(payload.get("extraction"), dict) else None
    language = opts.language or scripts.normalize_language(payload.get("language")) or scripts.normalize_language(ex_lang)
    if payload.get("rotation_needed") in (90, 180, 270) and not opts.rotate:
        warnings.append(f"Le modèle signale que la page semble tournée ({payload['rotation_needed']}°) : relancez la lecture "
                        "avec la rotation pour de meilleures coordonnées.")
    for w in payload.get("warnings") or []:
        if isinstance(w, str) and w not in warnings:
            warnings.append(w)
    n_sugg = correction_suggestions(db, lines, key, script_type)
    if n_sugg:
        warnings.append(f"{n_sugg} mot(s) déjà corrigé(s) par une relecture humaine sont signalés (rien n'a été remplacé).")

    raw_ex = payload.get("extraction") if isinstance(payload.get("extraction"), dict) else {}
    extraction = normalize_extraction_paleo(raw_ex, compose(lines, "diplomatic") or "")
    translation = _s(payload.get("translation")) or compose(lines, "translation")
    tr_lang = opts.translate_to if translation else None
    if language and opts.translate_to and language == opts.translate_to:
        translation, tr_lang = None, None

    reading = DocumentReading(media_id=media.id, version=_next_version(db, media.id),
                              engine=result.engine, model=result.model, status="draft",
                              document_kind=_s(payload.get("document_kind")) or "act", script_type=script_type,
                              language=(language or None), period_estimate=_s(payload.get("period_estimate")),
                              scribe_key=key, preprocessing={**prep, "cached": result.cached, "usage": result.usage,
                                                             "script_confidence": _conf(payload.get("script_confidence"), 0.0) or None,
                                                             "other_languages": payload.get("other_languages") or []},
                              zones=zones, lines=lines, translation=translation, translation_language=tr_lang,
                              extraction=extraction, photo_analysis={}, warnings=warnings,
                              quality=quality_stats(lines, payload.get("quality")))
    recompute_texts(reading)
    if translation:
        reading.translation = translation
    db.add(reading)
    db.flush()

    if opts.second_pass and img is not None and result.engine != "manual_llm" and opts.max_second_pass > 0 and reading.uncertain:
        from .second_pass import run_second_pass

        try:
            done = run_second_pass(db, reading, img, provider=provider, limit=opts.max_second_pass, subjects=subjects,
                                   guidance=guidance, scribe_text=ctx_text)
            reading.quality = {**(reading.quality or {}), "second_pass_done": done}
        except AIUnavailable as exc:  # quota atteint pendant la seconde passe : la lecture principale est conservée
            reading.warnings = list(reading.warnings or []) + [f"Seconde passe interrompue : {exc}"]
            reading.quality = {**(reading.quality or {}), "second_pass_interrupted": str(exc)[:200]}
    sync_media(media, reading)
    db.flush()
    return reading


def normalize_extraction_paleo(raw: dict, transcription: str) -> dict:
    """Extraction au schéma commun (écrans v0.3) en conservant les champs paléographiques (relations déclarées…)."""
    persons = [p for p in (raw.get("persons") if isinstance(raw.get("persons"), list) else []) if isinstance(p, dict)]
    v03 = dict(raw)
    v03["persons"] = []
    for p in persons:
        q = dict(p)
        role = str(q.get("role") or "other").lower()
        q["relation"] = q.get("relation") or q.get("stated_relation")
        q["role"] = {"groom": "subject", "bride": "spouse"}.get(role, role)
        v03["persons"].append(q)
    ex = normalize_extraction(v03, transcription)
    for p, orig in zip(ex.get("persons") or [], persons):
        for k in ("name_original", "stated_relation", "relation_kind", "relation_side", "relation_to_role", "signed",
                  "line_n", "excerpt"):
            if orig.get(k) is not None:
                p[k] = orig[k]
        if orig.get("age") not in (None, ""):
            p["age_stated"] = str(orig["age"])  # forme écrite (« vingt-sept ans »), l'âge numérique reste dans « age »
        p["mention_role"] = str(orig.get("role") or p.get("role") or "other").lower()
    return ex
