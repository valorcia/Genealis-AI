"""Corrections humaines d'une lecture : enregistrées, appliquées à la ligne, réutilisées pour les lectures suivantes
(même main / même type d'écriture, via `scribe.glossary`)."""
from __future__ import annotations

import copy
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import DocumentReading, Media, ReadingCorrection
from .pipeline import latest_reading, save_lines, sync_media

LAYERS = ("diplomatic", "normalized", "translation")


def apply_correction(db: Session, reading: DocumentReading, line_n: int, text: str, *, layer: str = "diplomatic",
                     note: Optional[str] = None, author: str = "user", resolve_uncertain: bool = True) -> ReadingCorrection:
    if layer not in LAYERS:
        raise ValueError(f"Couche inconnue : {layer}")
    lines = copy.deepcopy(reading.lines or [])
    line = next((ln for ln in lines if ln.get("n") == line_n), None)
    if line is None:
        if line_n == len(lines) + 1:  # ligne oubliée par la lecture automatique, ajoutée par l'utilisateur
            line = {"n": line_n, "bbox": None, "diplomatic": "", "normalized": None, "translation": None, "uncertain": []}
            lines.append(line)
        else:
            raise ValueError(f"Ligne {line_n} introuvable")
    before = line.get(layer)
    corr = ReadingCorrection(reading_id=reading.id, media_id=reading.media_id, scribe_key=reading.scribe_key,
                             script_type=reading.script_type, line_n=line_n, layer=layer, before=before, after=text,
                             note=note, author=author)
    db.add(corr)
    line[layer] = text
    line.setdefault("human", {})[layer] = {"by": author, "note": note}
    if layer == "diplomatic" and resolve_uncertain:
        for u in line.get("uncertain") or []:
            # vérifié par une personne : conservé dans l'historique, plus surligné comme incertain
            u["status"] = "human_verified"
            u["resolved_by_human"] = True
    save_lines(reading, lines)
    reading.status = "reviewed" if reading.status == "draft" else reading.status
    reading.quality = {**(reading.quality or {}), "human_corrections": int((reading.quality or {}).get("human_corrections", 0)) + 1}
    db.flush()
    media = db.get(Media, reading.media_id)
    latest = latest_reading(db, reading.media_id)
    if media and latest and latest.id == reading.id:
        sync_media(media, reading)
    db.flush()
    return corr


def validate(db: Session, reading: DocumentReading, note: Optional[str] = None) -> DocumentReading:
    """L'utilisateur confirme avoir relu la transcription sur l'image. Les passages encore incertains restent signalés."""
    reading.status = "validated"
    open_unc = [u for u in reading.uncertain or [] if u.get("status") != "human_verified"]
    reading.quality = {**(reading.quality or {}), "verified_by_human": True, "validation_note": note,
                       "uncertain_left_at_validation": len(open_unc)}
    if open_unc:
        reading.warnings = list(reading.warnings or []) + [
            f"Validée avec {len(open_unc)} passage(s) encore incertain(s) : ils restent des hypothèses de lecture."]
    db.flush()
    media = db.get(Media, reading.media_id)
    latest = latest_reading(db, reading.media_id)
    if media and latest and latest.id == reading.id:
        sync_media(media, reading)
    return reading


def corrections_of(db: Session, reading_id: str) -> list[ReadingCorrection]:
    return list(db.execute(select(ReadingCorrection).where(ReadingCorrection.reading_id == reading_id)
                           .order_by(ReadingCorrection.ts)).scalars())
