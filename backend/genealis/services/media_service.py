"""Import de documents/photos : copie locale intègre (jamais modifiée), empreinte, métadonnées."""
from __future__ import annotations

import mimetypes
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai.documents import sha256_file
from ..config import settings
from ..models import Media, Person
from . import storage
from .fts import index_entity

ALLOWED = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".pdf", ".gif", ".bmp"}


def import_file(db: Session, src: Path, *, original_filename: str | None = None, kind: str = "document",
                person_id: str | None = None, title: str | None = None, source_id: str | None = None) -> Media:
    settings.ensure_dirs()
    name = original_filename or src.name
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED:
        raise ValueError(f"Format non pris en charge : {ext}")
    digest = sha256_file(src)
    existing = db.execute(select(Media).where(Media.sha256 == digest)).scalars().first()
    if existing:
        if person_id and not existing.person_id:
            existing.person_id = person_id
        return existing
    stored = storage.store(src, f"{digest[:2]}/{digest}{ext}")
    m = Media(path=stored, original_filename=name, mime_type=mimetypes.guess_type(name)[0], kind=kind,
              title=title or Path(name).stem, sha256=digest, person_id=person_id, source_id=source_id)
    db.add(m)
    db.flush()
    index_entity(db.connection(), "media", m.id, m.title or name, name)
    if kind == "portrait" and person_id:
        p = db.get(Person, person_id)
        if p:
            p.portrait_media_id = m.id
    return m
