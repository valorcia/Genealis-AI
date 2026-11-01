"""Analyse d'une photographie ancienne : éléments visibles, inscriptions, vêtements, objets, cachet du photographe,
indices géographiques, période approximative.

Règle absolue : aucune personne n'est identifiée à partir de son visage. La consigne l'interdit explicitement et,
par sécurité, seuls des champs descriptifs sont conservés pour chaque personne représentée (aucun nom, aucune identité).
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from ..ai.errors import AIUnavailable
from ..models import DocumentReading, Media
from . import preprocess, prompts

PERSON_FIELDS = ("position", "clothing", "objects", "posture", "apparent_age_group")
FORBIDDEN_HINTS = ("ressembl", "identif", "il s'agit de", "probablement le même", "même personne", "looks like", "resembl")


def _clean(v: Any) -> Optional[str]:
    if v is None or isinstance(v, (dict, list)):
        return None
    t = str(v).strip()
    return t[:500] if t and t.lower() not in ("null", "none") else None


def _no_identity(text: Optional[str]) -> Optional[str]:
    """Écarte une phrase descriptive qui tenterait une identification (ressemblance, nom supposé)."""
    if not text:
        return text
    low = text.lower()
    return None if any(h in low for h in FORBIDDEN_HINTS) else text


def sanitize(payload: dict, transform: preprocess.Transform | None) -> dict:
    from .pipeline import _bbox_from

    people = []
    for p in payload.get("people") or []:
        if isinstance(p, dict):
            people.append({k: _no_identity(_clean(p.get(k))) for k in PERSON_FIELDS})
    inscriptions = []
    for ins in payload.get("inscriptions") or []:
        if isinstance(ins, str):
            ins = {"text": ins}
        if isinstance(ins, dict) and _clean(ins.get("text")):
            inscriptions.append({"text": _clean(ins.get("text")), "location": _clean(ins.get("location")),
                                 "bbox": _bbox_from(ins, transform), "uncertain": bool(ins.get("uncertain")),
                                 "alternatives": [a for a in (_clean(x) for x in ins.get("alternatives") or []) if a][:5]})
    stamp = payload.get("photographer_stamp") if isinstance(payload.get("photographer_stamp"), dict) else {}
    period = payload.get("period_estimate") if isinstance(payload.get("period_estimate"), dict) else {"range": _clean(payload.get("period_estimate"))}
    return {
        "description": _no_identity(_clean(payload.get("description"))),
        "visible_elements": [e for e in (_no_identity(_clean(x)) for x in payload.get("visible_elements") or []) if e][:30],
        "people_count": payload.get("people_count") if isinstance(payload.get("people_count"), int) else len(people),
        "people": people,
        "inscriptions": inscriptions,
        "photographer_stamp": {k: _clean(stamp.get(k)) for k in ("text", "studio", "city")},
        "geographic_clues": [e for e in (_clean(x) for x in payload.get("geographic_clues") or []) if e][:15],
        "period_estimate": {"range": _clean(period.get("range")), "clues": [c for c in (_clean(x) for x in period.get("clues") or []) if c][:10],
                            "confidence": _clean(period.get("confidence")) or "low"},
        "photo_format": _clean(payload.get("photo_format")),
        "condition": _clean(payload.get("condition")),
        "face_identification": "refusée par principe : aucune personne n'est identifiée à partir de son visage",
    }


def read_photo(db: Session, media: Media, img: Optional[bytes], mime: str, original: bytes, sha: str, opts, warnings: list[str]) -> DocumentReading:
    from .htr import HTRRequest, get_provider
    from .pipeline import _next_version, sync_media

    if img is None:
        raise AIUnavailable("Format d'image non lisible pour l'analyse de photographie.")
    wc = preprocess.working_copy(img, rotate=opts.rotate, crop=opts.crop, contrast=False, max_side=2400)
    provider = get_provider(db, opts.engine if opts.engine != "manual" else None)
    ok, why = provider.available()
    if not ok:
        raise AIUnavailable(why)
    user = ("Analyse cette photographie ancienne et renvoie le JSON demandé. Rappel : " + prompts.PHOTO_NO_FACE_RULE +
            ", ne donne aucun nom sauf en recopiant une inscription visible. "
            f"Nom du fichier : {media.original_filename or media.title or ''}.")
    res = provider.read(HTRRequest(wc.data, wc.mime, prompts.SYSTEM_PHOTO, user, purpose=f"analyse photo {media.id}",
                                   subject_person_ids=[media.person_id] if media.person_id else None, max_tokens=4000))
    analysis = sanitize(res.payload or {}, wc.transform)
    lines = []
    for ins in analysis["inscriptions"]:
        unc = [{"text": ins["text"], "alternatives": ins["alternatives"], "reason": "inscription peu lisible", "confidence": 0.4,
                "bbox": ins["bbox"], "bbox_is_line": True, "status": "uncertain"}] if ins["uncertain"] else []
        lines.append({"n": len(lines) + 1, "bbox": ins["bbox"], "diplomatic": ins["text"], "normalized": None,
                      "translation": None, "uncertain": unc, "location": ins["location"]})
    warnings = list(warnings) + ["Photographie : aucune personne n'est identifiée à partir de son visage ; une inscription "
                                 "ne prouve pas à elle seule qui est représenté."]
    for w in (res.payload or {}).get("warnings") or []:
        if isinstance(w, str):
            warnings.append(w)
    reading = DocumentReading(media_id=media.id, version=_next_version(db, media.id), engine=res.engine, model=res.model,
                              status="draft", document_kind="photo", script_type=None, language=None,
                              period_estimate=analysis["period_estimate"]["range"], scribe_key=None,
                              preprocessing={"original_sha256": sha, "original_untouched": True, **wc.describe(), "cached": res.cached},
                              zones=[{"bbox": i["bbox"], "kind": "inscription"} for i in analysis["inscriptions"] if i["bbox"]],
                              lines=lines, extraction={"document_type": "family_photo", "persons": [], "relations": []},
                              photo_analysis=analysis, warnings=warnings,
                              quality={"lines": len(lines), "verified_by_human": False})
    from .pipeline import recompute_texts

    recompute_texts(reading)
    db.add(reading)
    db.flush()
    sync_media(media, reading)
    db.flush()
    return reading
