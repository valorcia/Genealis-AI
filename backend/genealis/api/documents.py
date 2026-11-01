from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agents import engine
from ..db import get_session
from ..io.csv_import import import_csv
from ..io.exports import family_report_pdf, person_sheet_pdf, persons_csv, sources_csv
from ..io.gedcom import export_gedcom, import_gedcom
from ..models import Media, Person
from ..schemas import MediaOut
from ..services.confidence import recompute_all
from ..services.consistency import run_all as run_consistency
from ..services.journal import log
from ..services import storage
from ..services.media_service import import_file
from ..services.persons import media_out

router = APIRouter(prefix="/api", tags=["documents"])


@router.get("/media", response_model=list[MediaOut])
def list_media(person_id: str | None = None, db: Session = Depends(get_session)):
    stmt = select(Media).order_by(Media.created_at.desc())
    if person_id:
        stmt = stmt.where(Media.person_id == person_id)
    return [media_out(m) for m in db.execute(stmt).scalars()]


@router.post("/media", response_model=MediaOut, status_code=201)
async def upload_media(file: UploadFile = File(...), person_id: str | None = Form(None), kind: str = Form("document"),
                       title: str | None = Form(None), analyze: bool = Form(False), db: Session = Depends(get_session)):
    if person_id and not db.get(Person, person_id):
        raise HTTPException(404, "Personne introuvable")
    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename or "f").suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)
    try:
        m = import_file(db, tmp_path, original_filename=file.filename, kind=kind, person_id=person_id, title=title)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    finally:
        tmp_path.unlink(missing_ok=True)
    log(db, f"Document importé : {m.title}", category="decision", person_id=person_id)
    if analyze:
        engine.enqueue(db, "analyze_document", person_id, title=f"Analyser « {m.title} »", priority=70,
                       params={"media_id": m.id}, force=True)
    db.commit()
    return media_out(m)


@router.get("/media/{media_id}", response_model=MediaOut)
def get_media(media_id: str, db: Session = Depends(get_session)):
    m = db.get(Media, media_id)
    if not m:
        raise HTTPException(404, "Document introuvable")
    return media_out(m, with_text=True)


@router.get("/media/{media_id}/file")
def media_file(media_id: str, db: Session = Depends(get_session)):
    m = db.get(Media, media_id)
    if not m or not storage.exists(m.path):
        raise HTTPException(404, "Fichier introuvable")
    if storage.is_remote(m.path):
        return Response(storage.read_bytes(m.path), media_type=m.mime_type or "application/octet-stream",
                        headers={"Cache-Control": "private, max-age=3600"})
    return FileResponse(m.path, media_type=m.mime_type or "application/octet-stream", filename=m.original_filename)


@router.post("/media/{media_id}/analyze")
def analyze_media_endpoint(media_id: str, db: Session = Depends(get_session)):
    m = db.get(Media, media_id)
    if not m:
        raise HTTPException(404, "Document introuvable")
    t = engine.enqueue(db, "analyze_document", m.person_id, title=f"Analyser « {m.title} »", priority=70,
                       params={"media_id": m.id}, force=True)
    db.commit()
    return {"task_id": t.id, "status": t.status}


@router.get("/media/{media_id}/prompt")
def media_prompt(media_id: str, db: Session = Depends(get_session)):
    """Texte à coller dans claude.ai / chatgpt.com (abonnement) avec l'image du document."""
    from ..ai.documents import manual_prompt

    m = db.get(Media, media_id)
    if not m:
        raise HTTPException(404, "Document introuvable")
    return {"prompt": manual_prompt(m), "file_url": f"/api/media/{m.id}/file", "filename": m.original_filename}


@router.post("/media/{media_id}/analysis", response_model=MediaOut)
def media_manual_analysis(media_id: str, body: dict, db: Session = Depends(get_session)):
    """Enregistre la réponse collée (transcription + JSON) et propose les filiations détectées via le coordinateur."""
    from ..ai.documents import parse_manual_answer
    from ..agents.engine import coordinator
    from ..models import ResearchTask

    m = db.get(Media, media_id)
    if not m:
        raise HTTPException(404, "Document introuvable")
    try:
        res = parse_manual_answer(body.get("text", ""))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    source = body.get("source") or "claude.ai/chatgpt"
    res.method = f"manual_llm:{source}"
    m.ocr_text = res.transcription
    m.language = res.language if res.language != "?" else m.language
    m.analysis = res.to_dict()
    m.analysis_status = "done" if res.transcription else "failed"
    db.flush()
    log(db, f"Réponse {source} collée pour « {m.title} » : {len(res.transcription)} caractères, "
            f"{len(res.extraction.get('persons', []) or [])} personne(s) extraite(s).", category="analysis", person_id=m.person_id)
    if m.person_id:
        person = db.get(Person, m.person_id)
        task = ResearchTask(task_type="analyze_document", title=f"Analyse collée « {m.title} »", person_id=m.person_id,
                            status="done", params={"media_id": m.id})
        db.add(task)
        db.flush()
        if person:
            coordinator._propose_from_extraction(db, task, person, m, m.analysis, int(__import__("genealis.services.settings_service", fromlist=["get"]).get(db, "autonomy_mode", 3)))
    db.commit()
    return media_out(m, with_text=True)


@router.put("/media/{media_id}/transcription", response_model=MediaOut)
def set_transcription(media_id: str, body: dict, db: Session = Depends(get_session)):
    m = db.get(Media, media_id)
    if not m:
        raise HTTPException(404, "Document introuvable")
    m.ocr_text = body.get("transcription", m.ocr_text)
    m.analysis = {**(m.analysis or {}), "transcription": m.ocr_text, "method": "manual"}
    m.analysis_status = "done"
    if body.get("person_id"):
        m.person_id = body["person_id"]
    if body.get("title"):
        m.title = body["title"]
    db.commit()
    return media_out(m, with_text=True)


@router.delete("/media/{media_id}", status_code=204)
def delete_media(media_id: str, db: Session = Depends(get_session)):
    m = db.get(Media, media_id)
    if not m:
        raise HTTPException(404, "Document introuvable")
    path = m.path
    db.delete(m)
    db.flush()
    if not db.execute(select(Media).where(Media.path == path)).scalars().first():
        storage.delete(path)
    db.commit()


# ---- import / export ----
@router.post("/import/gedcom")
async def gedcom_import(file: UploadFile = File(...), db: Session = Depends(get_session)):
    data = await file.read()
    stats = import_gedcom(db, data)
    run_consistency(db)
    recompute_all(db)
    log(db, f"Import GEDCOM « {file.filename} » : {stats['persons']} personnes, {stats['families']} familles, {stats['sources']} sources",
        category="decision", outcome=stats)
    db.commit()
    return stats


@router.post("/import/csv")
async def csv_import_endpoint(file: UploadFile = File(...), db: Session = Depends(get_session)):
    stats = import_csv(db, await file.read())
    run_consistency(db)
    recompute_all(db)
    db.commit()
    return stats


@router.get("/export/gedcom")
def gedcom_export(hide_living: bool = True, db: Session = Depends(get_session)):
    text = export_gedcom(db, hide_living=hide_living)
    return Response(text, media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=genealis.ged"})


@router.get("/export/persons.csv")
def persons_csv_export(db: Session = Depends(get_session)):
    return Response(persons_csv(db), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=personnes.csv"})


@router.get("/export/sources.csv")
def sources_csv_export(db: Session = Depends(get_session)):
    return Response(sources_csv(db), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=sources.csv"})


@router.get("/export/person/{person_id}.pdf")
def person_pdf(person_id: str, db: Session = Depends(get_session)):
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Personne introuvable")
    return Response(person_sheet_pdf(db, p), media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=fiche-{p.surname or 'personne'}.pdf"})


@router.get("/export/report.pdf")
def report_pdf(root_id: str | None = None, generations: int = 6, db: Session = Depends(get_session)):
    root = db.get(Person, root_id) if root_id else db.execute(select(Person).where(Person.is_root == True)).scalars().first()  # noqa: E712
    if not root:
        raise HTTPException(404, "Aucune personne de départ")
    return Response(family_report_pdf(db, root.id, generations), media_type="application/pdf",
                    headers={"Content-Disposition": "attachment; filename=rapport-genealogique.pdf"})
