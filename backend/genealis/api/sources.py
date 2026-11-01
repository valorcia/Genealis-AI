from __future__ import annotations

import hashlib
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import utcnow, Citation, Source
from ..schemas import CitationIn, CitationOut, SourceIn, SourceOut
from ..services.confidence import recompute_all
from ..services.fts import index_entity, remove_entity
from ..services.journal import log

router = APIRouter(prefix="/api/sources", tags=["sources"])


def _out(db: Session, s: Source) -> SourceOut:
    n = db.scalar(select(func.count(Citation.id)).where(Citation.source_id == s.id)) or 0
    return SourceOut(id=s.id, title=s.title, repository=s.repository, fonds=s.fonds, commune=s.commune,
                     register_type=s.register_type, reference=s.reference, year=s.year, page=s.page, url=s.url,
                     consulted_at=s.consulted_at, local_copy_path=s.local_copy_path, local_copy_allowed=s.local_copy_allowed,
                     transcription=s.transcription, translation=s.translation, interpretation=s.interpretation,
                     language=s.language, reliability=s.reliability, connector_id=s.connector_id, external_id=s.external_id,
                     extra=s.extra or {}, content_hash=s.content_hash, created_at=s.created_at, citation_count=n)


def _hash(data: SourceIn) -> str | None:
    key = "|".join(x for x in (data.repository or "", data.reference or "", data.page or "", data.url or "") if x)
    return hashlib.sha256(key.encode()).hexdigest() if key else None


@router.get("", response_model=list[SourceOut])
def list_sources(db: Session = Depends(get_session), q: str | None = None, limit: int = Query(500, le=5000)):
    stmt = select(Source).order_by(Source.created_at.desc()).limit(limit)
    if q:
        like = f"%{q}%"
        stmt = select(Source).where(Source.title.ilike(like) | Source.repository.ilike(like) | Source.reference.ilike(like)).limit(limit)
    return [_out(db, s) for s in db.execute(stmt).scalars()]


@router.post("", response_model=SourceOut, status_code=201)
def create_source(data: SourceIn, db: Session = Depends(get_session)):
    s = Source(**data.model_dump())
    s.content_hash = _hash(data)
    if s.consulted_at is None and s.url:
        s.consulted_at = utcnow()
    db.add(s)
    db.flush()
    index_entity(db.connection(), "source", s.id, s.title, " ".join(x for x in (s.repository, s.commune, s.reference, s.transcription) if x))
    log(db, f"Source ajoutée : {s.title}", category="decision")
    db.commit()
    return _out(db, s)


@router.get("/{source_id}", response_model=SourceOut)
def get_source(source_id: str, db: Session = Depends(get_session)):
    s = db.get(Source, source_id)
    if not s:
        raise HTTPException(404, "Source introuvable")
    return _out(db, s)


@router.put("/{source_id}", response_model=SourceOut)
def update_source(source_id: str, data: SourceIn, db: Session = Depends(get_session)):
    s = db.get(Source, source_id)
    if not s:
        raise HTTPException(404, "Source introuvable")
    for k, v in data.model_dump().items():
        setattr(s, k, v)
    s.content_hash = _hash(data)
    index_entity(db.connection(), "source", s.id, s.title, " ".join(x for x in (s.repository, s.commune, s.reference, s.transcription) if x))
    recompute_all(db)
    db.commit()
    return _out(db, s)


@router.delete("/{source_id}", status_code=204)
def delete_source(source_id: str, db: Session = Depends(get_session)):
    s = db.get(Source, source_id)
    if not s:
        raise HTTPException(404, "Source introuvable")
    remove_entity(db.connection(), "source", s.id)
    db.delete(s)
    recompute_all(db)
    db.commit()


@router.get("/{source_id}/citations", response_model=list[CitationOut])
def source_citations(source_id: str, db: Session = Depends(get_session)):
    rows = db.execute(select(Citation).where(Citation.source_id == source_id)).scalars().all()
    return [CitationOut(id=c.id, source_id=c.source_id, target_type=c.target_type, target_id=c.target_id, excerpt=c.excerpt,
                        image_region=c.image_region, confidence=c.confidence, note=c.note,
                        source_title=c.source.title, source_reliability=c.source.reliability) for c in rows]


@router.post("/citations", response_model=CitationOut, status_code=201)
def add_citation(data: CitationIn, db: Session = Depends(get_session)):
    s = db.get(Source, data.source_id)
    if not s:
        raise HTTPException(404, "Source introuvable")
    c = Citation(**data.model_dump())
    db.add(c)
    db.flush()
    recompute_all(db)
    db.commit()
    return CitationOut(id=c.id, **data.model_dump(), source_title=s.title, source_reliability=s.reliability)


@router.delete("/citations/{citation_id}", status_code=204)
def delete_citation(citation_id: str, db: Session = Depends(get_session)):
    c = db.get(Citation, citation_id)
    if not c:
        raise HTTPException(404, "Citation introuvable")
    db.delete(c)
    recompute_all(db)
    db.commit()
