"""File de tâches persistante des enquêtes (partagée par le serveur et le worker navigateur local).

- `enqueue` déduplique par empreinte : une recherche déjà faite (ou en cours) n'est jamais relancée ;
- `claim` réserve une tâche avec un bail (lease) : si le processus s'arrête, le bail expire et la tâche
  redevient EN ATTENTE au prochain `requeue_expired` → reprise automatique après redémarrage ;
- `fail` réessaie avec un nombre maximal de tentatives, puis passe en ÉCHEC.
"""
from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from typing import Any, Iterable, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import Investigation, InvestigationEvent, InvestigationTask, utcnow

FINAL_STATES = ("done", "failed", "cancelled")
ACTIVE_INVESTIGATION = ("pending", "running")


def fingerprint(kind: str, person_id: str | None, params: dict[str, Any]) -> str:
    keep = {k: v for k, v in sorted(params.items()) if not k.startswith("_")}
    raw = json.dumps([kind, person_id, keep], sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]


def emit(db: Session, investigation_id: str, kind: str, message: str, data: dict | None = None,
         task_id: str | None = None) -> InvestigationEvent:
    ev = InvestigationEvent(investigation_id=investigation_id, kind=kind, message=message[:4000], data=data or {},
                            task_id=task_id)
    db.add(ev)
    inv = db.get(Investigation, investigation_id)
    if inv:
        inv.last_activity_at = utcnow()
    db.flush()
    return ev


def enqueue(db: Session, investigation_id: str, kind: str, title: str, *, person_id: str | None = None,
            params: dict | None = None, priority: int = 50, strategy: str | None = None, generation: int = 0,
            parent_task_id: str | None = None, max_attempts: int = 3, dedupe: bool = True) -> tuple[InvestigationTask, bool]:
    """Ajoute une tâche ; renvoie (tâche, créée). Si une tâche identique existe déjà dans l'enquête, elle est renvoyée."""
    params = params or {}
    fp = fingerprint(kind, person_id, params)
    if dedupe:
        existing = (db.query(InvestigationTask)
                    .filter(InvestigationTask.investigation_id == investigation_id, InvestigationTask.fingerprint == fp,
                            InvestigationTask.status != "cancelled").first())
        if existing:
            return existing, False
    t = InvestigationTask(investigation_id=investigation_id, kind=kind, title=title[:512], person_id=person_id, params=params,
                          priority=priority, strategy=strategy, generation=generation, parent_task_id=parent_task_id,
                          max_attempts=max_attempts, fingerprint=fp)
    db.add(t)
    db.flush()
    return t, True


def requeue_expired(db: Session) -> int:
    """Tâches EN COURS dont le bail a expiré (processus arrêté, PC éteint) → EN ATTENTE."""
    now = utcnow()
    rows = (db.query(InvestigationTask)
            .filter(InvestigationTask.status == "running",
                    or_(InvestigationTask.lease_until.is_(None), InvestigationTask.lease_until < now)).all())
    for t in rows:
        t.status, t.claimed_by, t.lease_until = "pending", None, None
        emit(db, t.investigation_id, "info", f"Reprise : « {t.title} » remise en attente (interruption détectée).",
             task_id=t.id)
    db.flush()
    return len(rows)


def claim(db: Session, worker: str, *, kinds: Iterable[str] | None = None, investigation_id: str | None = None,
          lease_s: int = 600) -> Optional[InvestigationTask]:
    """Réserve la tâche EN ATTENTE la plus prioritaire d'une enquête active."""
    requeue_expired(db)
    q = (db.query(InvestigationTask).join(Investigation, Investigation.id == InvestigationTask.investigation_id)
         .filter(InvestigationTask.status == "pending", Investigation.status.in_(ACTIVE_INVESTIGATION)))
    if kinds:
        q = q.filter(InvestigationTask.kind.in_(list(kinds)))
    if investigation_id:
        q = q.filter(InvestigationTask.investigation_id == investigation_id)
    q = q.filter(or_(InvestigationTask.lease_until.is_(None), InvestigationTask.lease_until < utcnow()))
    t = q.order_by(InvestigationTask.priority.desc(), InvestigationTask.created_at).with_for_update(skip_locked=True).first()
    if t is None:
        return None
    t.status, t.claimed_by = "running", worker
    t.lease_until = utcnow() + timedelta(seconds=lease_s)
    t.attempts = (t.attempts or 0) + 1
    t.started_at = t.started_at or utcnow()
    inv = db.get(Investigation, t.investigation_id)
    if inv and inv.status == "pending":
        inv.status, inv.started_at = "running", inv.started_at or utcnow()
    db.flush()
    return t


def heartbeat(db: Session, task: InvestigationTask, lease_s: int = 600) -> None:
    task.lease_until = utcnow() + timedelta(seconds=lease_s)
    db.flush()


def complete(db: Session, task: InvestigationTask, result: dict | None = None, status: str = "done") -> None:
    """status : done | to_verify | blocked."""
    task.status = status
    task.result = {**(task.result or {}), **(result or {})}
    task.lease_until, task.claimed_by = None, None
    task.finished_at = utcnow()
    db.flush()


def fail(db: Session, task: InvestigationTask, error: str, *, retry: bool = True, delay_s: int = 30) -> None:
    task.last_error = error[:2000]
    task.claimed_by = None
    if retry and (task.attempts or 0) < (task.max_attempts or 1):
        task.status = "pending"
        task.lease_until = utcnow() + timedelta(seconds=delay_s)  # pas de nouvel essai avant ce délai
    else:
        task.status = "failed"
        task.lease_until = None
        task.finished_at = utcnow()
    db.flush()


def block(db: Session, task: InvestigationTask, reason: str, *, needs_human: bool = False) -> None:
    """BLOQUÉE : CAPTCHA, connexion requise, abonnement, interdiction d'automatisation… (jamais contourné)."""
    task.status = "blocked"
    task.result = {**(task.result or {}), "blocked_reason": reason, "needs_human": needs_human}
    task.lease_until, task.claimed_by = None, None
    task.finished_at = utcnow()
    db.flush()


def counts(db: Session, investigation_id: str) -> dict[str, int]:
    from sqlalchemy import func

    rows = (db.query(InvestigationTask.status, func.count(InvestigationTask.id))
            .filter(InvestigationTask.investigation_id == investigation_id).group_by(InvestigationTask.status).all())
    return {s: int(n) for s, n in rows}
