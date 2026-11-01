"""Enquêtes autonomes (GENEALIS RESEARCH DIRECTOR) — routes définies dans docs/ARCHITECTURE_V04.md."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import false, func, or_
from sqlalchemy.orm import Session

from ..db import get_session
from ..investigation import director, memory, network, queue, verification
from ..models import (STATUS_LABELS_FR, AICallLog, Hypothesis, Investigation, InvestigationEvent, InvestigationTask, PageVisit,
                      Person, PersonMention, Question, utcnow)
from ..services import settings_service as cfg

router = APIRouter(prefix="/api", tags=["investigations"])


# ------------------------------------------------------------------ schémas
class InvestigationIn(BaseModel):
    person_id: str
    objective: Optional[str] = None
    max_generations: Optional[int] = None
    ai_call_ceiling: Optional[int] = None
    cost_mode: Optional[str] = None
    start: bool = True


class InvestigationStats(BaseModel):
    documents_found: int = 0
    acts_analyzed: int = 0
    ancestors_identified: int = 0
    filiations_verified: int = 0
    hypotheses: int = 0
    errors: int = 0
    pages_visited: int = 0
    persons_searched: int = 0


class InvestigationOut(BaseModel):
    id: str
    title: str
    person_id: Optional[str]
    person_name: Optional[str]
    objective: Optional[str]
    status: str
    status_label: str
    cost_mode: str
    max_generations: int
    current_generation: int
    ai_call_ceiling: int
    ai_calls_used: int
    stats: InvestigationStats
    blocked_reason: Optional[str]
    last_error: Optional[str]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    last_activity_at: Optional[datetime]
    active_seconds: float
    task_counts: dict[str, int]


class TaskOut(BaseModel):
    id: str
    kind: str
    title: str
    person_id: Optional[str]
    status: str
    status_label: str
    strategy: Optional[str]
    priority: int
    generation: int
    attempts: int
    last_error: Optional[str]
    result: dict
    params: dict
    created_at: Optional[datetime]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]


class EvidenceOut(BaseModel):
    source_id: Optional[str] = None
    media_id: Optional[str] = None
    url: Optional[str] = None
    excerpt: Optional[str] = None


class DiscoveryOut(BaseModel):
    kind: str  # hypothesis | mention | filiation | question
    id: str
    title: str
    description: Optional[str]
    score: Optional[float]
    confidence: Optional[str]
    status: str
    evidence: list[EvidenceOut]
    person_id: Optional[str]
    created_at: Optional[datetime]
    subkind: Optional[str] = None  # filiation | indirect_relation | witness_homonym | identity_match | …
    warnings: list[str] = []


class PageVisitOut(BaseModel):
    id: str
    ts: datetime
    url: str
    domain: Optional[str]
    title: Optional[str]
    strategy: str
    outcome: str
    screenshot_media_id: Optional[str]
    text_excerpt: Optional[str]
    downloads: list
    security_flags: list


class PersonRow(BaseModel):
    id: str
    name: str
    generation: int
    sosa: list[int]
    status: str


class InvestigationDetail(InvestigationOut):
    tasks: list[TaskOut]
    discoveries: list[DiscoveryOut]
    next_searches: list[TaskOut]
    persons: list[PersonRow]
    memory: dict
    recent_pages: list[PageVisitOut]


class EventOut(BaseModel):
    id: int
    ts: datetime
    kind: str
    message: str
    data: dict
    task_id: Optional[str]


class MentionOut(BaseModel):
    id: str
    media_id: Optional[str]
    source_id: Optional[str]
    reading_id: Optional[str]
    investigation_id: Optional[str]
    name_original: str
    given_names: Optional[str]
    surname: Optional[str]
    sex: Optional[str]
    role: str
    stated_relation: Optional[str]
    relation_kind: Optional[str]
    relation_side: Optional[str]
    relation_to_role: Optional[str]
    relation_to_mention_id: Optional[str]
    age_stated: Optional[str]
    occupation: Optional[str]
    residence: Optional[str]
    signed: Optional[bool]
    excerpt: Optional[str]
    image_region: Optional[dict]
    reading_confidence: Optional[float]
    linked_person_id: Optional[str]
    link_status: str
    candidates: list
    lead_task_id: Optional[str]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


class HumanDoneIn(BaseModel):
    note: Optional[str] = None


class DecisionIn(BaseModel):
    person_id: Optional[str] = None
    note: Optional[str] = None


# ------------------------------------------------------------------ sérialisation
def _label(status: str) -> str:
    return STATUS_LABELS_FR.get(status, status.upper())


def investigation_out(db: Session, inv: Investigation) -> InvestigationOut:
    p = db.get(Person, inv.person_id) if inv.person_id else None
    st = director.stats(db, inv)
    inv.stats = st
    return InvestigationOut(id=inv.id, title=inv.title, person_id=inv.person_id, person_name=p.display_name() if p else None,
                            objective=inv.objective, status=inv.status, status_label=_label(inv.status), cost_mode=inv.cost_mode,
                            max_generations=inv.max_generations or 0, current_generation=inv.current_generation or 0,
                            ai_call_ceiling=inv.ai_call_ceiling or 0, ai_calls_used=inv.ai_calls_used or 0,
                            stats=InvestigationStats(**st), blocked_reason=inv.blocked_reason, last_error=inv.last_error,
                            started_at=inv.started_at, finished_at=inv.finished_at, last_activity_at=inv.last_activity_at,
                            active_seconds=round(float(inv.active_seconds or 0), 1), task_counts=queue.counts(db, inv.id))


def task_out(t: InvestigationTask) -> TaskOut:
    return TaskOut(id=t.id, kind=t.kind, title=t.title, person_id=t.person_id, status=t.status, status_label=_label(t.status),
                   strategy=t.strategy, priority=t.priority or 0, generation=t.generation or 0, attempts=t.attempts or 0,
                   last_error=t.last_error, result=t.result or {}, params=t.params or {}, created_at=t.created_at,
                   started_at=t.started_at, finished_at=t.finished_at)


def mention_out(m: PersonMention) -> MentionOut:
    return MentionOut(**{k: getattr(m, k) for k in MentionOut.model_fields if k not in ("candidates",)},
                      candidates=list(m.candidates or []))


def page_out(v: PageVisit) -> PageVisitOut:
    return PageVisitOut(id=v.id, ts=v.ts, url=v.url, domain=v.domain, title=v.title, strategy=v.strategy, outcome=v.outcome,
                        screenshot_media_id=v.screenshot_media_id, text_excerpt=v.text_excerpt, downloads=list(v.downloads or []),
                        security_flags=list(v.security_flags or []))


def _level(score: Optional[float]) -> Optional[str]:
    if score is None:
        return None
    return "green" if score >= 80 else "orange" if score >= 50 else "red"


def _evidence(items: Any) -> list[EvidenceOut]:
    out = []
    for e in items or []:
        if isinstance(e, dict):
            out.append(EvidenceOut(source_id=e.get("source_id"), media_id=e.get("media_id"), url=e.get("url"),
                                   excerpt=e.get("excerpt") or e.get("note")))
    return out


def hypothesis_discovery(h: Hypothesis) -> DiscoveryOut:
    sd = h.score_details or {}
    kind = "filiation" if h.kind == "filiation" and h.status == "confirmed" else "hypothesis"
    warnings = [str(w) for w in (sd.get("missing") or []) + (sd.get("warnings") or [])]
    return DiscoveryOut(kind=kind, id=h.id, title=h.title, description=h.description, score=h.score,
                        confidence=sd.get("level") or _level(h.score), status=h.status, evidence=_evidence(h.evidence),
                        person_id=h.subject_person_id, created_at=h.created_at, subkind=h.kind, warnings=warnings)


def mention_discovery(m: PersonMention) -> DiscoveryOut:
    rc = m.reading_confidence
    role = m.stated_relation or m.role
    return DiscoveryOut(kind="mention", id=m.id, title=f"{network.full_name(m)} — {role}", description=m.excerpt,
                        score=round(rc * 100, 1) if rc is not None else None,
                        confidence=None if rc is None else ("green" if rc >= 0.8 else "orange" if rc >= 0.5 else "red"),
                        status=m.link_status, evidence=[EvidenceOut(source_id=m.source_id, media_id=m.media_id, excerpt=m.excerpt)],
                        person_id=m.linked_person_id, created_at=m.created_at, subkind=m.role,
                        warnings=["Mention non fusionnée : à relier à une personne de l'arbre seulement après vérification."]
                        if m.link_status != "confirmed" else [])


def question_discovery(q: Question) -> DiscoveryOut:
    return DiscoveryOut(kind="question", id=q.id, title=q.title, description=q.problem, score=float(q.priority or 0),
                        confidence=None, status=q.status,
                        evidence=_evidence([d for d in q.documents or [] if isinstance(d, dict)]), person_id=q.person_id,
                        created_at=q.created_at, subkind="question")


def discoveries(db: Session, inv: Investigation) -> list[DiscoveryOut]:
    ids = [i for (i,) in db.query(InvestigationTask.id).filter(InvestigationTask.investigation_id == inv.id)]
    out: list[DiscoveryOut] = []
    if ids:
        out += [hypothesis_discovery(h) for h in db.query(Hypothesis).filter(Hypothesis.task_id.in_(ids)).all()]
    out += [mention_discovery(m) for m in db.query(PersonMention).filter(PersonMention.investigation_id == inv.id).all()]
    qs = db.query(Question).filter(or_(Question.task_id.in_(ids) if ids else false(), Question.dedupe_key.like(f"inv:{inv.id}:%"))).all()
    out += [question_discovery(q) for q in qs]
    out.sort(key=lambda d: d.created_at or datetime.min, reverse=True)
    return out


def _get_inv(db: Session, inv_id: str) -> Investigation:
    inv = db.get(Investigation, inv_id)
    if inv is None:
        raise HTTPException(404, "Enquête introuvable")
    return inv


# ------------------------------------------------------------------ enquêtes
@router.post("/investigations", response_model=InvestigationOut, status_code=201)
def create_investigation(data: InvestigationIn, db: Session = Depends(get_session)):
    try:
        inv = director.start_investigation(db, data.person_id, data.objective, data.max_generations, data.ai_call_ceiling,
                                           data.cost_mode, start=data.start)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    db.commit()
    return investigation_out(db, inv)


@router.get("/investigations", response_model=list[InvestigationOut])
def list_investigations(db: Session = Depends(get_session)):
    rows = db.query(Investigation).order_by(Investigation.created_at.desc()).all()
    return [investigation_out(db, i) for i in rows]


@router.get("/investigations/dashboard")
def dashboard(db: Session = Depends(get_session)):
    invs = db.query(Investigation).all()
    totals = {k: 0 for k in InvestigationStats.model_fields}
    for inv in invs:
        for k, v in director.stats(db, inv).items():
            totals[k] = totals.get(k, 0) + int(v or 0)
    by_status: dict[str, int] = {}
    for inv in invs:
        by_status[inv.status] = by_status.get(inv.status, 0) + 1
    calls = db.query(func.count(AICallLog.id)).filter(AICallLog.investigation_id.isnot(None),
                                                       AICallLog.status.in_(("ok", "error", "rate_limited"))).scalar() or 0
    cost_usd = db.query(func.coalesce(func.sum(AICallLog.estimated_cost_usd), 0.0)) \
        .filter(AICallLog.investigation_id.isnot(None)).scalar() or 0.0
    ids = [i.id for i in invs]
    task_ids = [t for (t,) in db.query(InvestigationTask.id).filter(InvestigationTask.investigation_id.in_(ids))] if ids else []
    open_h = db.query(func.count(Hypothesis.id)).filter(Hypothesis.task_id.in_(task_ids), Hypothesis.status == "open").scalar() \
        if task_ids else 0
    persons = {p for (p,) in db.query(InvestigationTask.person_id).filter(InvestigationTask.person_id.isnot(None),
                                                                          InvestigationTask.kind.in_(("plan", "web_search")))}
    seen = cfg.get(db, "worker_last_seen")
    from ..investigation.strategy import worker_online

    return {"active": sum(1 for i in invs if i.status in ("pending", "running")),
            "persons_searched": len(persons), "documents_found": totals["documents_found"],
            "acts_analyzed": totals["acts_analyzed"], "ancestors_identified": totals["ancestors_identified"],
            "filiations_verified": totals["filiations_verified"], "hypotheses_open": int(open_h or 0),
            "errors": totals["errors"], "research_seconds": round(sum(float(i.active_seconds or 0) for i in invs), 1),
            "ai_calls": int(calls), "estimated_cost_usd": round(float(cost_usd), 4), "by_status": by_status,
            "worker": {"online": worker_online(db), "last_seen": str(seen) if seen else None,
                       "worker_id": cfg.get(db, "worker_id")}}


@router.get("/investigations/{inv_id}", response_model=InvestigationDetail)
def get_investigation(inv_id: str, db: Session = Depends(get_session)):
    inv = _get_inv(db, inv_id)
    base = investigation_out(db, inv)
    tasks = (db.query(InvestigationTask).filter(InvestigationTask.investigation_id == inv.id)
             .order_by(InvestigationTask.created_at).all())
    nxt = (db.query(InvestigationTask).filter(InvestigationTask.investigation_id == inv.id, InvestigationTask.status == "pending")
           .order_by(InvestigationTask.priority.desc(), InvestigationTask.created_at).limit(10).all())
    pages = (db.query(PageVisit).filter(PageVisit.investigation_id == inv.id).order_by(PageVisit.ts.desc()).limit(20).all())
    return InvestigationDetail(**base.model_dump(), tasks=[task_out(t) for t in tasks], discoveries=discoveries(db, inv),
                               next_searches=[task_out(t) for t in nxt],
                               persons=[PersonRow(**r) for r in director.generation_persons(db, inv)],
                               memory=memory.load(inv), recent_pages=[page_out(v) for v in pages])


@router.get("/investigations/{inv_id}/events", response_model=list[EventOut])
def events(inv_id: str, after: Optional[int] = None, limit: int = Query(100, ge=1, le=1000), db: Session = Depends(get_session)):
    _get_inv(db, inv_id)
    q = db.query(InvestigationEvent).filter(InvestigationEvent.investigation_id == inv_id)
    if after is not None:
        q = q.filter(InvestigationEvent.id > after)
        rows = q.order_by(InvestigationEvent.id).limit(limit).all()
    else:
        rows = list(reversed(q.order_by(InvestigationEvent.id.desc()).limit(limit).all()))
    return [EventOut(id=e.id, ts=e.ts, kind=e.kind, message=e.message, data=e.data or {}, task_id=e.task_id) for e in rows]


@router.post("/investigations/{inv_id}/pause", response_model=InvestigationOut)
def pause_investigation(inv_id: str, db: Session = Depends(get_session)):
    inv = director.pause(db, _get_inv(db, inv_id))
    db.commit()
    return investigation_out(db, inv)


@router.post("/investigations/{inv_id}/resume", response_model=InvestigationOut)
def resume_investigation(inv_id: str, db: Session = Depends(get_session)):
    inv = director.resume(db, _get_inv(db, inv_id))
    db.commit()
    return investigation_out(db, inv)


@router.post("/investigations/{inv_id}/stop", response_model=InvestigationOut)
def stop_investigation(inv_id: str, db: Session = Depends(get_session)):
    inv = director.stop(db, _get_inv(db, inv_id))
    db.commit()
    return investigation_out(db, inv)


@router.post("/investigations/{inv_id}/step")
def step_investigation(inv_id: str, budget_s: float = Query(20, ge=1, le=120), db: Session = Depends(get_session)):
    _get_inv(db, inv_id)
    res = director.step(db, inv_id, budget_s=budget_s)
    return {"executed": res.get("executed", []), "status": res.get("status"), "locked": bool(res.get("locked"))}


# ------------------------------------------------------------------ tâches
def _get_task(db: Session, task_id: str) -> InvestigationTask:
    t = db.get(InvestigationTask, task_id)
    if t is None:
        raise HTTPException(404, "Tâche introuvable")
    return t


def _reopen(db: Session, inv: Investigation | None) -> None:
    if inv is not None and inv.status in ("done", "to_verify", "failed"):
        inv.status, inv.finished_at = "running", None


@router.post("/investigation-tasks/{task_id}/retry", response_model=TaskOut)
def retry_task(task_id: str, db: Session = Depends(get_session)):
    """« Analyser à nouveau » : la tâche repart (sans dupliquer ce qui a déjà été trouvé)."""
    t = _get_task(db, task_id)
    if t.status == "running":
        raise HTTPException(409, "Tâche en cours d'exécution.")
    t.status, t.attempts, t.last_error, t.lease_until, t.claimed_by, t.finished_at = "pending", 0, None, None, None, None
    t.result = {k: v for k, v in (t.result or {}).items() if k != "director_processed"}
    if t.kind == "analyze_document":
        t.params = {**(t.params or {}), "_force": True}
    inv = db.get(Investigation, t.investigation_id)
    _reopen(db, inv)
    queue.emit(db, t.investigation_id, "info", f"Nouvel essai demandé : {t.title}", {}, t.id)
    db.commit()
    return task_out(t)


@router.post("/investigation-tasks/{task_id}/human-done", response_model=TaskOut)
def human_done(task_id: str, data: HumanDoneIn = Body(default_factory=HumanDoneIn), db: Session = Depends(get_session)):
    """Après votre action (CAPTCHA, connexion, consultation manuelle) : la tâche est terminée ou relancée."""
    from ..agents.questions import answer

    t = _get_task(db, task_id)
    note = (data.note or "").strip() or None
    if t.kind == "browse" and t.status == "running":
        # Le worker local attend votre action dans la fenêtre du navigateur : on lui signale seulement la fin (il reprend).
        t.result = {**(t.result or {}), "human_note": note, "human_done_at": utcnow().isoformat(timespec="seconds")}
    elif t.kind == "human_assist":
        queue.complete(db, t, {"human_note": note, "human_done_at": utcnow().isoformat(timespec="seconds")}, status="done")
    else:
        t.status, t.lease_until, t.claimed_by, t.finished_at, t.last_error = "pending", None, None, None, None
        t.result = {**{k: v for k, v in (t.result or {}).items() if k not in ("director_processed", "needs_human")},
                    "human_note": note, "human_done_at": utcnow().isoformat(timespec="seconds")}
    for q in db.query(Question).filter(Question.status == "pending", Question.task_id == t.id).all():
        answer(db, q, "info", note or "Action effectuée")
    _reopen(db, db.get(Investigation, t.investigation_id))
    queue.emit(db, t.investigation_id, "human", f"Action humaine terminée : {t.title}" + (f" — {note}" if note else ""), {}, t.id)
    db.commit()
    return task_out(t)


# ------------------------------------------------------------------ découvertes
def _get_discovery(db: Session, kind: str, item_id: str):
    if kind == "hypothesis":
        obj = db.get(Hypothesis, item_id)
    elif kind == "mention":
        obj = db.get(PersonMention, item_id)
    else:
        raise HTTPException(400, "Type de découverte inconnu (hypothesis ou mention).")
    if obj is None:
        raise HTTPException(404, "Découverte introuvable")
    return obj


@router.post("/discoveries/{kind}/{item_id}/validate", response_model=DiscoveryOut)
def validate_discovery(kind: str, item_id: str, data: DecisionIn = Body(default_factory=DecisionIn),
                       db: Session = Depends(get_session)):
    from ..services.confidence import recompute_all

    obj = _get_discovery(db, kind, item_id)
    try:
        if kind == "hypothesis":
            verification.validate_hypothesis(db, obj, person_id=data.person_id, note=data.note)
        else:
            verification.validate_mention(db, obj, person_id=data.person_id, note=data.note)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    recompute_all(db)
    db.commit()
    return hypothesis_discovery(obj) if kind == "hypothesis" else mention_discovery(obj)


@router.post("/discoveries/{kind}/{item_id}/reject", response_model=DiscoveryOut)
def reject_discovery(kind: str, item_id: str, data: DecisionIn = Body(default_factory=DecisionIn),
                     db: Session = Depends(get_session)):
    """Rejeter : statut « rejected », jamais de suppression (la trace reste consultable)."""
    obj = _get_discovery(db, kind, item_id)
    if kind == "hypothesis":
        obj.status = "rejected"
        sd = dict(obj.score_details or {})
        sd["rejected_by_user"] = utcnow().isoformat(timespec="seconds")
        if data.note:
            sd["user_note"] = data.note
        obj.score_details = sd
        inv_id = None
        if obj.task_id:
            t = db.get(InvestigationTask, obj.task_id)
            inv_id = t.investigation_id if t else None
        if inv_id:
            queue.emit(db, inv_id, "decision", f"Rejeté par vous : {obj.title}", {"hypothesis_id": obj.id})
    else:
        obj.link_status = "rejected"
        if obj.investigation_id:
            queue.emit(db, obj.investigation_id, "decision", f"Mention rejetée par vous : {network.full_name(obj)}", {"mention_id": obj.id})
    db.commit()
    return hypothesis_discovery(obj) if kind == "hypothesis" else mention_discovery(obj)


# ------------------------------------------------------------------ réseau des personnes
@router.get("/mentions", response_model=list[MentionOut])
def list_mentions(media_id: Optional[str] = None, person_id: Optional[str] = None, investigation_id: Optional[str] = None,
                  db: Session = Depends(get_session)):
    q = db.query(PersonMention)
    if media_id:
        q = q.filter(PersonMention.media_id == media_id)
    if investigation_id:
        q = q.filter(PersonMention.investigation_id == investigation_id)
    rows = q.order_by(PersonMention.created_at).all()
    if person_id:
        rows = [m for m in rows if m.linked_person_id == person_id
                or any(isinstance(c, dict) and c.get("person_id") == person_id for c in m.candidates or [])]
    return [mention_out(m) for m in rows]


@router.get("/network/{person_id}")
def person_network(person_id: str, db: Session = Depends(get_session)):
    try:
        return network.graph(db, person_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
