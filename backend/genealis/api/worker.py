"""API du worker navigateur local (Playwright / Browser Use) — contrat §5 de docs/ARCHITECTURE_V04.md.

Toutes ces routes sont sous /api/ : elles sont protégées par le mot de passe d'accès (ACCESS_TOKEN, middleware de
main.py) dès qu'il est défini. Le serveur ne transmet JAMAIS de clé API au worker : la clé Gemini est configurée
localement sur le PC qui exécute le navigateur.
"""
from __future__ import annotations

import base64
import binascii
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..browser import store
from ..browser.security import MAX_DOWNLOAD_BYTES
from ..db import get_session
from ..investigation import queue
from ..models import Investigation, InvestigationTask, utcnow

router = APIRouter(prefix="/api", tags=["worker"])

LEASE_S = 300


class ClaimIn(BaseModel):
    worker_id: str = Field(min_length=1, max_length=64)
    capabilities: dict[str, Any] = Field(default_factory=dict)
    lease_s: int = LEASE_S
    investigation_id: Optional[str] = None


class HeartbeatIn(BaseModel):
    worker_id: str
    lease_s: int = LEASE_S
    message: Optional[str] = None


class ResultIn(BaseModel):
    worker_id: str
    result: dict[str, Any]
    ai_calls: list[dict[str, Any]] = Field(default_factory=list)
    ai_refused: Optional[str] = None


class ReleaseIn(BaseModel):
    worker_id: str
    reason: Optional[str] = None


def _own_task(db: Session, task_id: str, worker_id: str) -> InvestigationTask:
    t = db.get(InvestigationTask, task_id)
    if t is None or t.kind != "browse":
        raise HTTPException(404, "Tâche de navigation introuvable")
    if t.status != "running" or t.claimed_by != worker_id:
        raise HTTPException(409, "Cette tâche n'est plus réservée par ce worker (bail expiré, annulée ou reprise).")
    return t


def _task_out(t: InvestigationTask) -> dict:
    return {"id": t.id, "investigation_id": t.investigation_id, "title": t.title, "kind": t.kind, "person_id": t.person_id,
            "params": t.params or {}, "attempts": t.attempts, "max_attempts": t.max_attempts,
            "lease_until": t.lease_until.isoformat() if t.lease_until else None, "strategy": t.strategy}


@router.post("/worker/claim")
def worker_claim(body: ClaimIn, db: Session = Depends(get_session)):
    """Réserve la prochaine tâche `browse` (bail renouvelé par heartbeat ; reprise automatique si le PC s'arrête)."""
    store.touch_worker(db, body.worker_id, body.capabilities)
    settings = store.browser_settings(db)
    if settings.get("browser_mode") == "off":
        db.commit()
        return {"task": None, "message": "Navigation désactivée dans les paramètres.", "settings": settings}
    lease = max(60, min(int(body.lease_s or LEASE_S), 1800))
    task = None
    for _ in range(10):
        t = queue.claim(db, body.worker_id, kinds=["browse"], investigation_id=body.investigation_id, lease_s=lease)
        if t is None:
            break
        refusal = store.privacy_refusal(db, t)
        if refusal:
            queue.block(db, t, refusal, needs_human=True)
            queue.emit(db, t.investigation_id, "human", f"Navigation non lancée : {refusal}", task_id=t.id)
            continue
        task = t
        break
    if task is None:
        db.commit()
        return {"task": None, "settings": settings}
    ai = store.ai_allowance(db, task)
    queue.emit(db, task.investigation_id, "info", f"Navigation « {task.title} » prise en charge par le PC ({body.worker_id}).",
               {"worker_id": body.worker_id, "ai_allowed": ai["allowed"], "ai_max_calls": ai["max_calls"]}, task_id=task.id)
    db.commit()
    return {"task": _task_out(task), "ai": ai, "settings": settings}


@router.post("/worker/tasks/{task_id}/heartbeat")
def worker_heartbeat(task_id: str, body: HeartbeatIn, db: Session = Depends(get_session)):
    store.touch_worker(db, body.worker_id)
    t = db.get(InvestigationTask, task_id)
    if t is None or t.status != "running" or t.claimed_by != body.worker_id:
        db.commit()
        return {"ok": False, "cancel": True, "reason": "Tâche annulée, reprise par un autre worker ou bail expiré."}
    inv = db.get(Investigation, t.investigation_id)
    if inv and inv.status in ("paused", "stopped", "failed", "done"):
        db.commit()
        return {"ok": True, "cancel": True, "reason": f"Enquête {inv.status} : la navigation s'interrompt."}
    queue.heartbeat(db, t, max(60, min(int(body.lease_s or LEASE_S), 1800)))
    if body.message:
        queue.emit(db, t.investigation_id, "human" if body.message.startswith("Action requise") else "info",
                   body.message[:1000], task_id=t.id)
    human_done_at = (t.result or {}).get("human_done_at")
    db.commit()
    return {"ok": True, "cancel": False, "human_done_at": human_done_at, "server_time": utcnow().isoformat(timespec="seconds"),
            "lease_until": t.lease_until.isoformat() if t.lease_until else None}


@router.post("/worker/tasks/{task_id}/human-done")
def worker_human_done(task_id: str, db: Session = Depends(get_session)):
    """L'utilisateur confirme avoir agi lui-même dans la fenêtre du navigateur (CAPTCHA, connexion…) : reprise."""
    t = db.get(InvestigationTask, task_id)
    if t is None or t.kind != "browse":
        raise HTTPException(404, "Tâche de navigation introuvable")
    t.result = {**(t.result or {}), "human_done_at": utcnow().isoformat(timespec="seconds")}
    queue.emit(db, t.investigation_id, "human", "Vous avez indiqué avoir terminé l'action demandée : la navigation reprend.",
               task_id=t.id)
    db.commit()
    return {"ok": True}


def _decode_b64(s: str | None) -> Optional[bytes]:
    if not s:
        return None
    try:
        return base64.b64decode(s.split(",", 1)[-1], validate=False)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "Capture illisible (base64)")


@router.post("/worker/tasks/{task_id}/visit")
async def worker_visit(task_id: str, request: Request, db: Session = Depends(get_session)):
    """Page réellement ouverte (PageVisit) + capture d'écran (JSON avec `screenshot_b64`, ou multipart `meta` + `screenshot`)."""
    ctype = request.headers.get("content-type", "")
    shot: Optional[bytes] = None
    if ctype.startswith(("multipart/", "application/x-www-form-urlencoded")):
        form = await request.form()
        try:
            meta = json.loads(str(form.get("meta") or "{}"))
        except json.JSONDecodeError:
            raise HTTPException(400, "Métadonnées illisibles")
        up = form.get("screenshot")
        if up is not None and hasattr(up, "read"):
            shot = await up.read(8 * 1024 * 1024 + 1)  # type: ignore[union-attr]
    else:
        meta = await request.json()
        shot = _decode_b64(meta.pop("screenshot_b64", None))
    if not isinstance(meta, dict) or not meta.get("worker_id") or not meta.get("url"):
        raise HTTPException(400, "worker_id et url sont requis")
    if shot and len(shot) > 8 * 1024 * 1024:
        raise HTTPException(413, "Capture trop volumineuse")
    t = _own_task(db, task_id, str(meta["worker_id"]))
    store.touch_worker(db, str(meta["worker_id"]))
    v = store.record_visit(db, t, worker_id=str(meta["worker_id"]), url=str(meta["url"]), title=meta.get("title"),
                           strategy=str(meta.get("strategy") or "playwright"), outcome=str(meta.get("outcome") or "ok"),
                           http_status=meta.get("http_status") if isinstance(meta.get("http_status"), int) else None,
                           text_excerpt=meta.get("text_excerpt"), content_hash=meta.get("content_hash"),
                           security_flags=meta.get("security_flags") if isinstance(meta.get("security_flags"), list) else [],
                           duration_ms=meta.get("duration_ms") if isinstance(meta.get("duration_ms"), int) else None,
                           notes=meta.get("notes"), screenshot=shot)
    db.commit()
    return {"page_visit_id": v.id, "screenshot_media_id": v.screenshot_media_id}


@router.post("/worker/tasks/{task_id}/document")
async def worker_document(task_id: str, worker_id: str = Form(...), source_url: str = Form(...),
                          file: UploadFile = File(...), page_url: Optional[str] = Form(None),
                          archival_reference: Optional[str] = Form(None), title: Optional[str] = Form(None),
                          page_visit_id: Optional[str] = Form(None), mime: Optional[str] = Form(None),
                          db: Session = Depends(get_session)):
    """Document téléchargé → Media (copie intègre, empreinte SHA-256, adresse d'origine, référence d'archive)."""
    t = _own_task(db, task_id, worker_id)
    data = await file.read(MAX_DOWNLOAD_BYTES + 1)
    if len(data) > MAX_DOWNLOAD_BYTES:
        raise HTTPException(413, "Fichier trop volumineux (> 40 Mo)")
    try:
        m, dup = store.record_document(db, t, worker_id=worker_id, data=data, filename=file.filename, mime=mime or file.content_type,
                                       source_url=source_url, page_url=page_url, archival_reference=archival_reference,
                                       title=title, page_visit_id=page_visit_id)
    except store.DocumentRefused as exc:
        queue.emit(db, t.investigation_id, "info", f"Document refusé par la politique de sécurité : {exc}", task_id=t.id)
        db.commit()
        raise HTTPException(415, str(exc))
    db.commit()
    return {"media_id": m.id, "sha256": m.sha256, "duplicate": dup}


@router.post("/worker/tasks/{task_id}/result")
def worker_result(task_id: str, body: ResultIn, db: Session = Depends(get_session)):
    t = _own_task(db, task_id, body.worker_id)
    store.touch_worker(db, body.worker_id)
    store.apply_result(db, t, body.worker_id, body.model_dump())
    db.commit()
    return {"ok": True, "status": t.status, "task": _task_out(t)}


@router.post("/worker/tasks/{task_id}/release")
def worker_release(task_id: str, body: ReleaseIn, db: Session = Depends(get_session)):
    """Arrêt propre du worker (Ctrl+C) : la tâche est remise en attente."""
    t = db.get(InvestigationTask, task_id)
    if t is None:
        raise HTTPException(404, "Tâche introuvable")
    if t.status == "running" and t.claimed_by == body.worker_id:
        store.release(db, t, body.reason or "")
    db.commit()
    return {"ok": True, "status": t.status}


@router.get("/worker/status")
def worker_status(db: Session = Depends(get_session)):
    return store.worker_status(db)
