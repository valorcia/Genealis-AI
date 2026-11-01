from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..agents import engine
from ..agents import questions as qsvc
from ..agents.planner import prioritized_branches
from ..connectors.base import SearchQuery, registry
from ..connectors.registry_service import connector_overview, test_connector
from ..db import get_session
from ..models import AgentDecision, Contradiction, Hypothesis, Person, Question, ResearchLog, ResearchTask
from ..schemas import ContradictionOut, HypothesisIn, HypothesisOut, LogOut, QuestionAnswer, QuestionOut, TaskIn, TaskOut
from ..services import journal
from ..services.confidence import recompute_all
from ..services.consistency import run_all as run_consistency
from ..services.persons import contradiction_out, hypothesis_out, question_out

router = APIRouter(prefix="/api/research", tags=["research"])


def _task_out(t: ResearchTask) -> TaskOut:
    return TaskOut(id=t.id, task_type=t.task_type, title=t.title, person_id=t.person_id, status=t.status, priority=t.priority,
                   plan=t.plan or [], params=t.params or {}, attempts=t.attempts, last_error=t.last_error, result=t.result or {},
                   started_at=t.started_at, finished_at=t.finished_at, parent_task_id=t.parent_task_id,
                   requires_approval=t.requires_approval, approved=t.approved, created_at=t.created_at, updated_at=t.updated_at)


# ---- tâches ----
@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(status: str | None = None, limit: int = Query(200, le=2000), db: Session = Depends(get_session)):
    stmt = select(ResearchTask).order_by(ResearchTask.created_at.desc()).limit(limit)
    if status:
        stmt = stmt.where(ResearchTask.status.in_(status.split(",")))
    return [_task_out(t) for t in db.execute(stmt).scalars()]


@router.post("/tasks", response_model=TaskOut, status_code=201)
def create_task(data: TaskIn, db: Session = Depends(get_session)):
    if data.person_id and not db.get(Person, data.person_id):
        raise HTTPException(404, "Personne introuvable")
    t = engine.enqueue(db, data.task_type, data.person_id, title=data.title, priority=data.priority, params=data.params, force=True)
    db.commit()
    return _task_out(t)


@router.post("/explore/{person_id}", response_model=list[TaskOut])
def explore(person_id: str, generations: int = 3, db: Session = Depends(get_session)):
    if not db.get(Person, person_id):
        raise HTTPException(404, "Personne introuvable")
    tasks = engine.explore_branch(db, person_id, generations)
    db.commit()
    return [_task_out(t) for t in tasks]


@router.post("/tasks/{task_id}/approve", response_model=TaskOut)
def approve_task(task_id: str, approved: bool = True, db: Session = Depends(get_session)):
    t = db.get(ResearchTask, task_id)
    if not t:
        raise HTTPException(404, "Tâche introuvable")
    engine.approve(db, t, approved)
    db.commit()
    return _task_out(t)


@router.post("/tasks/{task_id}/cancel", response_model=TaskOut)
def cancel_task(task_id: str, db: Session = Depends(get_session)):
    t = db.get(ResearchTask, task_id)
    if not t:
        raise HTTPException(404, "Tâche introuvable")
    if t.status in ("queued", "waiting_user", "paused"):
        t.status = "cancelled"
    db.commit()
    return _task_out(t)


@router.post("/tasks/{task_id}/retry", response_model=TaskOut)
def retry_task(task_id: str, db: Session = Depends(get_session)):
    t = db.get(ResearchTask, task_id)
    if not t:
        raise HTTPException(404, "Tâche introuvable")
    t.status = "queued"
    t.last_error = None
    t.result = {**(t.result or {}), "new_info_since": True}
    db.commit()
    return _task_out(t)


@router.get("/worker")
def worker_status(db: Session = Depends(get_session)):
    from ..config import settings as app_settings
    from ..services import settings_service as cfg

    queued = db.scalar(select(func.count(ResearchTask.id)).where(ResearchTask.status == "queued")) or 0
    return {"running": settings_running(), "current_task_id": engine.worker.current_task_id,
            "paused": bool(cfg.get(db, "research_pause", False)), "autonomy_mode": int(cfg.get(db, "autonomy_mode", 1)),
            "serverless": app_settings.serverless, "queued": queued}


def settings_running() -> bool:
    return engine.worker._task is not None and not engine.worker._task.done()


@router.post("/run")
async def run_now(budget: float = Query(50, le=280), db: Session = Depends(get_session)):
    """Fait avancer la file d'enquêtes pendant un budget de temps (appelé par l'interface en mode hébergé)."""
    from ..services import settings_service as cfg

    if cfg.get(db, "research_pause", False):
        return {"ran": 0, "paused": True}
    db.close()
    return await engine.run_budget(budget)


@router.get("/cron")
async def cron(request: Request):
    """Tâche planifiée (Vercel Cron) : protégée par CRON_SECRET."""
    from ..config import settings as app_settings

    auth = request.headers.get("authorization", "")
    if app_settings.cron_secret and auth != f"Bearer {app_settings.cron_secret}":
        raise HTTPException(401, "Non autorisé")
    return await engine.run_budget(240, max_tasks=40)


@router.post("/worker/pause")
def pause_worker(paused: bool = True, db: Session = Depends(get_session)):
    from ..services import settings_service as cfg

    cfg.set_value(db, "research_pause", paused)
    journal.log(db, "Moteur de recherche " + ("mis en pause" if paused else "relancé"), category="decision")
    db.commit()
    return {"paused": paused}


@router.get("/priorities")
def priorities(limit: int = 20, db: Session = Depends(get_session)):
    return prioritized_branches(db, limit)


# ---- journal ----
@router.get("/logs", response_model=list[LogOut])
def logs(limit: int = Query(200, le=5000), task_id: str | None = None, person_id: str | None = None, since_id: int | None = None,
         db: Session = Depends(get_session)):
    stmt = select(ResearchLog).order_by(ResearchLog.id.desc()).limit(limit)
    if task_id:
        stmt = stmt.where(ResearchLog.task_id == task_id)
    if person_id:
        stmt = stmt.where(ResearchLog.person_id == person_id)
    if since_id:
        stmt = stmt.where(ResearchLog.id > since_id)
    rows = db.execute(stmt).scalars().all()
    return [LogOut(id=r.id, ts=r.ts, task_id=r.task_id, person_id=r.person_id, level=r.level, category=r.category,
                   message=r.message, connector_id=r.connector_id, query=r.query, outcome=r.outcome) for r in rows]


@router.get("/decisions")
def decisions(limit: int = 200, db: Session = Depends(get_session)):
    rows = db.execute(select(AgentDecision).order_by(AgentDecision.id.desc()).limit(limit)).scalars().all()
    return [{"id": d.id, "ts": d.ts, "agent": d.agent, "task_id": d.task_id, "decision": d.decision, "rationale": d.rationale} for d in rows]


@router.get("/stream")
async def stream():
    q = journal.subscribe()

    async def gen():
        try:
            yield "event: hello\ndata: {}\n\n"
            while True:
                try:
                    item = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(item, default=str)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            journal.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# ---- questions ----
@router.get("/questions", response_model=list[QuestionOut])
def list_questions(status: str = "pending", db: Session = Depends(get_session)):
    stmt = select(Question).order_by(Question.priority.desc(), Question.created_at.asc())
    if status != "all":
        stmt = stmt.where(Question.status == status)
    return [question_out(q) for q in db.execute(stmt).scalars()]


@router.post("/questions/{question_id}/answer", response_model=QuestionOut)
def answer_question(question_id: str, data: QuestionAnswer, db: Session = Depends(get_session)):
    q = db.get(Question, question_id)
    if not q:
        raise HTTPException(404, "Question introuvable")
    qsvc.answer(db, q, data.answer_type, data.answer, data.payload)
    _apply_answer(db, q, data)
    db.commit()
    return question_out(q)


def _apply_answer(db: Session, q: Question, data: QuestionAnswer) -> None:
    """Effets d'une réponse : confirmation d'hypothèse, relance de recherche, ajout d'information."""
    from ..schemas import PersonIn, RelationIn
    from ..services.persons import create_person, add_relation, update_person

    key = q.dedupe_key or ""
    if data.answer_type == "yes" and ":filiation:" in key:
        hyp_id = next((h.get("hypothesis_id") for h in (q.hypotheses or []) if isinstance(h, dict) and h.get("hypothesis_id")), None)
        h = db.get(Hypothesis, hyp_id) if hyp_id else None
        if h and q.person_id:
            for role, sex in (("father", "M"), ("mother", "F")):
                c = (h.candidate or {}).get(role)
                if c and (c.get("surname") or c.get("given_names")):
                    parent = create_person(db, PersonIn(given_names=c.get("given_names"), surname=c.get("surname"), sex=sex,
                                                        occupation=c.get("occupation"), confidence="orange"))
                    add_relation(db, RelationIn(parent_id=parent.id, child_id=q.person_id, relation_type="biological",
                                                confidence="orange", notes="Validé par l'utilisateur d'après le document " + str(c.get("media_id") or h.candidate.get("media_id"))))
            h.status = "confirmed"
            journal.log(db, f"Filiation validée par l'utilisateur pour {q.person_id}", category="decision", person_id=q.person_id, task_id=q.task_id)
    elif data.answer_type == "no" and ":filiation:" in key:
        for h in db.execute(select(Hypothesis).where(Hypothesis.subject_person_id == q.person_id, Hypothesis.status == "open")).scalars():
            if (h.candidate or {}).get("media_id") and f":{h.candidate['media_id']}" in key:
                h.status = "rejected"
    elif data.answer_type == "yes" and (":confirm:" in key or ":ambiguous:" in key or ":plausible:" in key) and q.person_id:
        url = key.split(":", 2)[-1]
        for h in db.execute(select(Hypothesis).where(Hypothesis.subject_person_id == q.person_id, Hypothesis.status == "open")).scalars():
            if (h.candidate or {}).get("url") == url:
                h.status = "confirmed"
                t = db.get(ResearchTask, h.task_id) if h.task_id else None
                person = db.get(Person, q.person_id)
                if person:
                    engine.coordinator._record_source(db, t or ResearchTask(id="manual", title="manuel"), person,
                                                      {"result": h.candidate, "target": h.score_details})
    elif data.answer_type == "no" and (":confirm:" in key or ":ambiguous:" in key or ":plausible:" in key) and q.person_id:
        url = key.split(":", 2)[-1]
        for h in db.execute(select(Hypothesis).where(Hypothesis.subject_person_id == q.person_id, Hypothesis.status == "open")).scalars():
            if (h.candidate or {}).get("url") == url:
                h.status = "rejected"
    elif data.answer_type == "info" and q.person_id and data.payload:
        p = db.get(Person, q.person_id)
        if p:
            fields = {k: v for k, v in data.payload.items() if k in PersonIn.model_fields}
            if fields:
                update_person(db, p, PersonIn(**fields))
            if data.payload.get("parent"):
                par = data.payload["parent"]
                parent = create_person(db, PersonIn(given_names=par.get("given_names"), surname=par.get("surname"), sex=par.get("sex")))
                add_relation(db, RelationIn(parent_id=parent.id, child_id=p.id, relation_type="biological", confidence="orange",
                                            notes="Déclaré par l'utilisateur (à sourcer)"))
            for t in db.execute(select(ResearchTask).where(ResearchTask.person_id == p.id, ResearchTask.status == "done")).scalars():
                t.result = {**(t.result or {}), "new_info_since": True}
    elif data.answer_type == "search_other" and q.person_id:
        engine.enqueue(db, "explore_branch", q.person_id, priority=65, params={"after_question": q.id}, force=True)
    run_consistency(db)
    recompute_all(db)


# ---- hypothèses ----
@router.get("/hypotheses", response_model=list[HypothesisOut])
def list_hypotheses(status: str = "open", person_id: str | None = None, db: Session = Depends(get_session)):
    stmt = select(Hypothesis).order_by(Hypothesis.created_at.desc())
    if status != "all":
        stmt = stmt.where(Hypothesis.status == status)
    if person_id:
        stmt = stmt.where(Hypothesis.subject_person_id == person_id)
    return [hypothesis_out(h) for h in db.execute(stmt).scalars()]


@router.post("/hypotheses", response_model=HypothesisOut, status_code=201)
def create_hypothesis(data: HypothesisIn, db: Session = Depends(get_session)):
    h = Hypothesis(**data.model_dump(), created_by="user")
    db.add(h)
    db.commit()
    return hypothesis_out(h)


@router.post("/hypotheses/{hyp_id}/status", response_model=HypothesisOut)
def set_hypothesis_status(hyp_id: str, status: str, db: Session = Depends(get_session)):
    h = db.get(Hypothesis, hyp_id)
    if not h:
        raise HTTPException(404, "Hypothèse introuvable")
    if status not in ("open", "confirmed", "rejected", "superseded"):
        raise HTTPException(400, "Statut invalide")
    h.status = status
    journal.log(db, f"Hypothèse « {h.title} » → {status} (utilisateur)", category="decision", person_id=h.subject_person_id)
    db.commit()
    return hypothesis_out(h)


# ---- contradictions ----
@router.get("/contradictions", response_model=list[ContradictionOut])
def list_contradictions(status: str = "open", db: Session = Depends(get_session)):
    stmt = select(Contradiction).order_by(Contradiction.severity, Contradiction.created_at.desc())
    if status != "all":
        stmt = stmt.where(Contradiction.status == status)
    return [contradiction_out(c) for c in db.execute(stmt).scalars()]


@router.post("/contradictions/check", response_model=list[ContradictionOut])
def check_contradictions(db: Session = Depends(get_session)):
    rows = run_consistency(db)
    recompute_all(db)
    db.commit()
    return [contradiction_out(c) for c in rows]


@router.post("/contradictions/{cid}/status", response_model=ContradictionOut)
def set_contradiction_status(cid: str, status: str, note: str | None = None, db: Session = Depends(get_session)):
    c = db.get(Contradiction, cid)
    if not c:
        raise HTTPException(404, "Contradiction introuvable")
    c.status = status
    c.resolution_note = note
    recompute_all(db)
    db.commit()
    return contradiction_out(c)


# ---- connecteurs ----
@router.get("/connectors")
def connectors(db: Session = Depends(get_session)):
    return connector_overview(db)


@router.post("/connectors/{cid}/test")
async def connector_test(cid: str, db: Session = Depends(get_session)):
    try:
        res = await test_connector(db, cid)
    except KeyError:
        raise HTTPException(404, "Connecteur inconnu")
    db.commit()
    return res


@router.post("/connectors/{cid}/search")
async def connector_search(cid: str, query: dict, db: Session = Depends(get_session)):
    c = registry.get(cid)
    if not c:
        raise HTTPException(404, "Connecteur inconnu")
    q = SearchQuery(**{k: v for k, v in query.items() if k in SearchQuery.__dataclass_fields__})
    journal.log(db, f"Recherche manuelle dans {c.capabilities.name}", category="search", connector_id=cid, query=q.to_dict())
    db.commit()
    try:
        results = await c.search(q)
    except Exception as exc:
        journal.log(db, f"{c.capabilities.name} : {exc}", category="connector", level="warning", connector_id=cid)
        db.commit()
        return {"ok": False, "error": str(exc), "browse_url": c.browse_url(q), "results": []}
    journal.log(db, f"{c.capabilities.name} : {len(results)} résultat(s)", category="result", connector_id=cid)
    db.commit()
    return {"ok": True, "results": [r.to_dict() for r in results], "browse_url": c.browse_url(q)}


@router.get("/connectors/{cid}/browse")
def connector_browse(cid: str, surname: str | None = None, given_names: str | None = None, commune: str | None = None,
                     year_from: int | None = None):
    c = registry.get(cid)
    if not c:
        raise HTTPException(404, "Connecteur inconnu")
    return {"url": c.browse_url(SearchQuery(surname=surname, given_names=given_names, commune=commune, year_from=year_from))}


# ---- Fichier des décès INSEE : index local gratuit ----
@router.get("/insee/status")
def insee_status():
    from ..connectors import insee_local

    return insee_local.status()


@router.get("/insee/resources")
async def insee_resources():
    from ..connectors import insee_local

    c = registry.get("insee_deces_local")
    try:
        return await c.list_resources()  # type: ignore[union-attr]
    except Exception as exc:
        raise HTTPException(502, f"data.gouv.fr injoignable : {exc}")


@router.post("/insee/import")
async def insee_import(body: dict, db: Session = Depends(get_session)):
    """Télécharge puis importe un fichier annuel (ou mensuel) dans l'index local."""
    from ..connectors import insee_local
    from ..db import session_scope

    url, name = body.get("url"), body.get("name")
    if not url or not name:
        raise HTTPException(400, "url et name requis")
    c = registry.get("insee_deces_local")
    journal.log(db, f"Téléchargement du fichier INSEE « {name} »…", category="connector", connector_id="insee_deces_local")
    db.commit()

    async def job():
        try:
            path = await c.download(url, name)  # type: ignore[union-attr]
            with session_scope() as s:
                journal.log(s, f"Fichier « {name} » téléchargé ({path.stat().st_size // 1_000_000} Mo) ; import en cours…", category="connector", connector_id="insee_deces_local")
            n = await asyncio.to_thread(insee_local.import_file, path)
            with session_scope() as s:
                journal.log(s, f"Index local INSEE : {n} enregistrements importés depuis « {name} ».", category="connector", connector_id="insee_deces_local")
        except Exception as exc:
            with session_scope() as s:
                journal.log(s, f"Import INSEE « {name} » échoué : {exc}", category="error", level="error", connector_id="insee_deces_local")

    asyncio.create_task(job())
    return {"started": True, "name": name}


@router.post("/insee/import-local")
def insee_import_local(body: dict):
    """Importe un fichier déjà téléchargé manuellement (chemin local)."""
    from pathlib import Path

    from ..connectors import insee_local

    p = Path(body.get("path", ""))
    if not p.exists():
        raise HTTPException(404, "Fichier introuvable")
    return {"imported": insee_local.import_file(p)}
