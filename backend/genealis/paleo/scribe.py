"""Même main, même registre : clé de scribe et glossaire des formes confirmées.

`scribe_key` regroupe les pages écrites par la même main (même source / registre / cote, ou choix de l'utilisateur).
Les corrections humaines et les lectures validées de cette main sont réinjectées dans les consignes des lectures
suivantes : elles aident à lire, mais restent signalées comme des indications, jamais comme des preuves.
"""
from __future__ import annotations

import difflib
import re
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session
from unidecode import unidecode

from ..models import DocumentReading, Media, ReadingCorrection, Source


def _slug(*parts: Optional[str]) -> str:
    s = "|".join(unidecode(str(p)).strip().lower() for p in parts if p and str(p).strip())
    return re.sub(r"[^a-z0-9|]+", "-", s).strip("-|")[:120]


def resolve_scribe_key(db: Session, media: Media, explicit: str | None = None) -> Optional[str]:
    """Choix de l'utilisateur > clé déjà utilisée pour ce document > source (dépôt, commune, registre, cote)."""
    if explicit and explicit.strip():
        return explicit.strip()[:128]
    prev = db.execute(select(DocumentReading.scribe_key).where(DocumentReading.media_id == media.id,
                                                               DocumentReading.scribe_key.isnot(None))
                      .order_by(DocumentReading.version.desc())).scalars().first()
    if prev:
        return prev
    if media.source_id:
        src = db.get(Source, media.source_id)
        if src:
            key = _slug(src.repository, src.commune, src.register_type, src.reference or src.fonds)
            if key:
                return f"src:{key}"[:128]
    return None


def word_pairs(before: str, after: str) -> list[tuple[str, str]]:
    """Paires (mot lu → mot corrigé) d'une correction de ligne, pour le glossaire."""
    a, b = (before or "").split(), (after or "").split()
    out: list[tuple[str, str]] = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if tag == "replace":
            out.append((" ".join(a[i1:i2]), " ".join(b[j1:j2])))
        elif tag == "insert":
            out.append(("", " ".join(b[j1:j2])))
    return [(x, y) for x, y in out if x != y][:12]


def glossary(db: Session, scribe_key: str | None, script_type: str | None, limit: int = 30) -> list[dict]:
    """Formes confirmées par des corrections humaines : même main d'abord, puis même type d'écriture."""
    rows: list[ReadingCorrection] = []
    if scribe_key:
        rows += db.execute(select(ReadingCorrection).where(ReadingCorrection.scribe_key == scribe_key,
                                                           ReadingCorrection.layer == "diplomatic")
                           .order_by(ReadingCorrection.ts.desc()).limit(limit)).scalars().all()
    if script_type and script_type != "unknown" and len(rows) < limit:
        q = select(ReadingCorrection).where(ReadingCorrection.script_type == script_type, ReadingCorrection.layer == "diplomatic")
        if scribe_key:
            q = q.where((ReadingCorrection.scribe_key != scribe_key) | ReadingCorrection.scribe_key.is_(None))
        rows += db.execute(q.order_by(ReadingCorrection.ts.desc()).limit(limit - len(rows))).scalars().all()
    out, seen = [], set()
    for c in rows:
        same = bool(scribe_key) and c.scribe_key == scribe_key
        for before, after in word_pairs(c.before or "", c.after):
            if not after or (before, after) in seen:
                continue
            seen.add((before, after))
            out.append({"before": before, "after": after, "same_hand": same, "correction_id": c.id, "note": c.note})
    return out[:limit]


def validated_samples(db: Session, scribe_key: str | None, exclude_media_id: str | None = None, limit: int = 3) -> list[dict]:
    """Extraits de pages de la même main déjà validées par l'utilisateur (comparaison des formes de lettres)."""
    if not scribe_key:
        return []
    q = select(DocumentReading).where(DocumentReading.scribe_key == scribe_key, DocumentReading.status.in_(("validated", "reviewed")))
    if exclude_media_id:
        q = q.where(DocumentReading.media_id != exclude_media_id)
    out = []
    for r in db.execute(q.order_by(DocumentReading.updated_at.desc()).limit(limit)).scalars():
        text = (r.diplomatic or "")[:600]
        if text:
            out.append({"reading_id": r.id, "media_id": r.media_id, "status": r.status, "excerpt": text})
    return out


def scribe_context(db: Session, scribe_key: str | None, script_type: str | None, exclude_media_id: str | None = None) -> dict:
    return {"scribe_key": scribe_key, "glossary": glossary(db, scribe_key, script_type),
            "validated": validated_samples(db, scribe_key, exclude_media_id)}


def context_prompt(ctx: dict) -> str:
    """Texte injecté dans la consigne (vide s'il n'y a rien d'utile)."""
    parts = []
    same = [g for g in ctx.get("glossary") or [] if g["same_hand"]]
    other = [g for g in ctx.get("glossary") or [] if not g["same_hand"]]
    if same:
        parts.append("Corrections humaines déjà faites sur des pages de la MÊME MAIN (formes confirmées par l'utilisateur) : "
                     + " ; ".join(f"« {g['before'] or '∅'} » → « {g['after']} »" for g in same) + ".")
    if other:
        parts.append("Corrections humaines sur d'autres documents du même type d'écriture : "
                     + " ; ".join(f"« {g['before'] or '∅'} » → « {g['after']} »" for g in other[:12]) + ".")
    for v in ctx.get("validated") or []:
        parts.append(f"Extrait d'une page de la même main relue par l'utilisateur :\n« {v['excerpt']} »")
    if not parts:
        return ""
    return ("Aides issues des relectures humaines (à utiliser pour comparer les formes de lettres, sans jamais remplacer "
            "ce qui est visible) :\n" + "\n".join(parts))
