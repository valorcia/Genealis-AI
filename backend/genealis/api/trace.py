"""Traçabilité des recherches : ce que l'IA a cherché, où, avec quel résultat — et diagnostic du moteur.

Tout ce qui est affiché provient des étapes réellement exécutées (plan des tâches) et du journal horodaté.
Aucun résultat n'est reconstitué : un site non joint est présenté comme tel.
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from datetime import datetime
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agents.planner import TASK_LABELS
from ..connectors import registry_service  # noqa: F401 - enregistre les connecteurs
from ..connectors.base import AccessRestricted, registry
from ..db import get_session
from ..models import ConnectorStatus, Hypothesis, Media, Person, Question, ResearchLog, ResearchTask, Source, utcnow
from ..services.persons import hypothesis_out, question_out

router = APIRouter(prefix="/api", tags=["trace"])

DIAGNOSTIC_TIMEOUT = 60.0
STEP_DONE = ("done", "failed", "manual", "skipped")


def _domain(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    return (urlparse(url if "//" in url else "//" + url).netloc or "").lower().replace("www.", "") or None


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n <= 1 else many}"


def _step_status(s: dict) -> str:
    """Statut lisible d'une étape : ok | no_result | restricted | error | manual | pending | running | skipped."""
    r = s.get("result") or {}
    if r.get("status"):
        return str(r["status"])
    st = s.get("status")
    if st == "done":
        if s.get("action") == "search":
            return "ok" if (r.get("count") or 0) > 0 else "no_result"
        return "done"
    if st == "manual":
        return "manual" if s.get("action") == "browse" else "restricted"
    if st == "failed":
        return "error"
    return st or "pending"


def _connector_info(cid: Optional[str]) -> dict:
    c = registry.get(cid) if cid else None
    if not c:
        return {"connector_name": cid, "site": None, "homepage": None, "access_mode": None}
    caps = c.capabilities
    return {"connector_name": caps.name, "site": _domain(caps.homepage), "homepage": caps.homepage, "access_mode": caps.access_mode}


def _steps_out(task: ResearchTask) -> list[dict]:
    out = []
    for i, s in enumerate(task.plan or []):
        info = _connector_info(s.get("connector_id"))
        r = dict(s.get("result") or {})
        out.append({"index": i, "action": s.get("action"), "label": s.get("label"), "connector_id": s.get("connector_id"),
                    **info, "site": r.get("site") or info["site"], "query": s.get("query") or {}, "status": s.get("status"),
                    "outcome": _step_status(s), "result": r})
    return out


def _summary(task: ResearchTask, n_hyp: int, n_q: int, n_src: int, n_media: int) -> dict:
    steps = [s for s in task.plan or [] if s.get("action") in ("search", "browse")]
    searched = [s for s in steps if s.get("action") == "search" and s.get("status") in STEP_DONE]
    stats: dict[str, int] = defaultdict(int)
    sites = []
    for s in steps:
        st = _step_status(s)
        stats[st] += 1
        info = _connector_info(s.get("connector_id"))
        r = s.get("result") or {}
        sites.append({"connector_id": s.get("connector_id"), "name": info["connector_name"], "site": r.get("site") or info["site"],
                      "status": st, "count": int(r.get("count") or 0), "action": s.get("action")})
    results = sum(int((s.get("result") or {}).get("count") or 0) for s in searched)
    web_pages = sum(len(((s.get("result") or {}).get("grounding") or {}).get("sources") or []) for s in searched)
    found = bool(n_hyp or n_src or results)
    return {"sites": sites, "sites_queried": len(searched), "sites_answered": stats["ok"] + stats["no_result"],
            "sites_failed": stats["error"], "sites_restricted": stats["restricted"], "sites_manual": stats["manual"],
            "results": results, "web_pages": web_pages, "hypotheses": n_hyp, "questions": n_q, "sources": n_src,
            "media": n_media, "found": found, "sentence": _sentence(task, len(searched), stats, results, n_hyp, n_q, n_src, n_media, web_pages)}


def _sentence(task: ResearchTask, queried: int, stats: dict, results: int, n_hyp: int, n_q: int, n_src: int, n_media: int,
              web_pages: int) -> str:
    if task.status == "waiting_user":
        return "Recherche préparée, en attente de votre accord : aucun site n'a encore été interrogé."
    if task.status == "queued" and not queried:
        return "Recherche en file d'attente : aucun site n'a encore été interrogé."
    if task.status == "cancelled" and not queried:
        return "Recherche annulée avant d'avoir interrogé un site."
    if task.task_type == "analyze_document":
        return "Analyse d'un document importé (aucun site interrogé)."
    parts = [_plural(queried, "site interrogé", "sites interrogés")]
    if web_pages:
        parts.append(_plural(web_pages, "page web consultée par Gemini", "pages web consultées par Gemini"))
    parts.append(_plural(results, "résultat", "résultats"))
    parts.append(_plural(n_hyp, "piste trouvée", "pistes trouvées") if n_hyp else "aucune piste")
    if n_q:
        parts.append(_plural(n_q, "question posée", "questions posées"))
    if n_src:
        parts.append(_plural(n_src, "source enregistrée", "sources enregistrées"))
    if n_media:
        parts.append(_plural(n_media, "document archivé", "documents archivés"))
    if stats.get("manual"):
        parts.append(_plural(stats["manual"], "site à consulter vous-même", "sites à consulter vous-même"))
    s = ", ".join(parts) + "."
    if queried and stats.get("error", 0) + stats.get("restricted", 0) == queried:
        s += " Attention : aucun site n'a pu être joint automatiquement."
    elif stats.get("error"):
        s += f" {_plural(stats['error'], 'site n’a', 'sites n’ont')} pas répondu."
    return s[0].upper() + s[1:]


def _counts_by_task(db: Session, ids: list[str]) -> tuple[dict, dict]:
    hyp, qs = defaultdict(int), defaultdict(int)
    if not ids:
        return hyp, qs
    for (tid,) in db.execute(select(Hypothesis.task_id).where(Hypothesis.task_id.in_(ids))):
        hyp[tid] += 1
    for (tid,) in db.execute(select(Question.task_id).where(Question.task_id.in_(ids))):
        qs[tid] += 1
    return hyp, qs


def _task_sources(db: Session, task: ResearchTask) -> list[Source]:
    """Sources enregistrées à partir des résultats de cette recherche (même connecteur, même page)."""
    pairs = set()
    for s in task.plan or []:
        for r in (s.get("result") or {}).get("results") or []:
            if r.get("url"):
                pairs.add((r.get("connector_id") or s.get("connector_id"), r["url"]))
    if not pairs:
        return []
    urls = list({u for _, u in pairs})[:500]
    rows = db.execute(select(Source).where(Source.url.in_(urls))).scalars().all()
    return [src for src in rows if (src.connector_id, src.url) in pairs
            and (task.started_at is None or src.created_at is None or src.created_at >= task.started_at)]


def _person_brief(p: Optional[Person]) -> Optional[dict]:
    if not p:
        return None
    by = next((e.sort_year for e in p.events if e.event_type in ("birth", "baptism") and e.sort_year), None)
    dy = next((e.sort_year for e in p.events if e.event_type in ("death", "burial") and e.sort_year), None)
    return {"id": p.id, "name": p.display_name(), "sex": p.sex, "birth_year": by, "death_year": dy}


def _task_brief(t: ResearchTask, person: Optional[Person], summary: dict) -> dict:
    return {"id": t.id, "title": t.title, "task_type": t.task_type, "type_label": TASK_LABELS.get(t.task_type, t.task_type),
            "status": t.status, "person_id": t.person_id, "person_name": person.display_name() if person else None,
            "created_at": t.created_at, "started_at": t.started_at, "finished_at": t.finished_at, "last_error": t.last_error,
            "attempts": t.attempts, "summary": summary}


# ------------------------------------------------------------------ recherches effectuées
@router.get("/trace/tasks")
def trace_tasks(person_id: Optional[str] = None, status: Optional[str] = None, limit: int = Query(100, ge=1, le=1000),
                db: Session = Depends(get_session)):
    stmt = select(ResearchTask).order_by(ResearchTask.created_at.desc()).limit(limit)
    if person_id:
        stmt = stmt.where(ResearchTask.person_id == person_id)
    if status:
        stmt = stmt.where(ResearchTask.status.in_(status.split(",")))
    tasks = db.execute(stmt).scalars().all()
    hyp, qs = _counts_by_task(db, [t.id for t in tasks])
    persons: dict[str, Optional[Person]] = {}
    out = []
    for t in tasks:
        if t.person_id and t.person_id not in persons:
            persons[t.person_id] = db.get(Person, t.person_id)
        res = t.result or {}
        n_media = len(res.get("archived_media") or [])
        n_src = int(res.get("sources_recorded") or 0)
        out.append(_task_brief(t, persons.get(t.person_id or ""), _summary(t, hyp[t.id], qs[t.id], n_src, n_media)))
    return out


@router.get("/trace/tasks/{task_id}")
def trace_task(task_id: str, db: Session = Depends(get_session)):
    t = db.get(ResearchTask, task_id)
    if not t:
        raise HTTPException(404, "Recherche introuvable")
    person = db.get(Person, t.person_id) if t.person_id else None
    hyps = db.execute(select(Hypothesis).where(Hypothesis.task_id == t.id).order_by(Hypothesis.created_at)).scalars().all()
    qs = db.execute(select(Question).where(Question.task_id == t.id).order_by(Question.created_at)).scalars().all()
    sources = _task_sources(db, t)
    media_ids = list((t.result or {}).get("archived_media") or [])
    medias = [m for m in (db.get(Media, mid) for mid in media_ids) if m]
    if sources:
        for m in db.execute(select(Media).where(Media.source_id.in_([s.id for s in sources]))).scalars():
            if m.id not in {x.id for x in medias}:
                medias.append(m)
    if t.task_type == "analyze_document" and t.params.get("media_id"):
        m = db.get(Media, t.params["media_id"])
        if m and m.id not in {x.id for x in medias}:
            medias.append(m)
    logs = db.execute(select(ResearchLog).where(ResearchLog.task_id == t.id).order_by(ResearchLog.id)).scalars().all()
    summary = _summary(t, len(hyps), len(qs), len(sources), len(medias))
    return {
        **_task_brief(t, person, summary),
        "priority": t.priority, "params": t.params or {}, "result": t.result or {}, "parent_task_id": t.parent_task_id,
        "requires_approval": t.requires_approval, "approved": t.approved,
        "person": _person_brief(person), "conclusion": summary["sentence"], "steps": _steps_out(t),
        "logs": [{"id": r.id, "ts": r.ts, "level": r.level, "category": r.category, "message": r.message,
                  "connector_id": r.connector_id, "query": r.query, "outcome": r.outcome} for r in logs],
        "hypotheses": [hypothesis_out(h).model_dump() for h in hyps],
        "questions": [question_out(q).model_dump() for q in qs],
        "sources": [{"id": s.id, "title": s.title, "url": s.url, "repository": s.repository, "reliability": s.reliability,
                     "connector_id": s.connector_id, "year": s.year, "created_at": s.created_at} for s in sources],
        "media": [{"id": m.id, "title": m.title or m.original_filename, "kind": m.kind, "mime_type": m.mime_type,
                   "archived_from": (m.analysis or {}).get("archived_from"), "created_at": m.created_at} for m in medias],
    }


# ------------------------------------------------------------------ sites consultés
def _status_message(cid: str, st: Optional[ConnectorStatus], mode: str) -> tuple[str, str]:
    """(couleur, explication) de l'état opérationnel d'un site."""
    if mode in ("browser", "manual"):
        return "orange", "Consultation par navigateur uniquement (règles du site) : l'IA prépare le lien, vous cherchez vous-même."
    if st is None or st.status == "untested":
        return "grey", "Pas encore vérifié : lancez « Vérifier le moteur de recherche »."
    err = str((st.details or {}).get("error") or "")
    if st.status == "ok":
        return "green", "Opérationnel lors de la dernière vérification."
    if st.status == "manual":
        if cid == "gemini_web":
            return "orange", "Gemini : clé absente ou recherche web désactivée (Paramètres → Intelligence artificielle)."
        return "orange", f"Accès automatisé refusé par le site{(' : ' + err) if err else ''}."
    if st.status == "degraded":
        return "orange", "Le site répond mais de façon incomplète" + (f" : {err}" if err else ".")
    return "red", "Injoignable lors de la dernière vérification" + (f" : {err}" if err else ".")


@router.get("/trace/sites")
def trace_sites(db: Session = Depends(get_session)):
    statuses = {s.connector_id: s for s in db.execute(select(ConnectorStatus)).scalars()}
    agg: dict[str, dict[str, Any]] = defaultdict(lambda: {"searches": 0, "results": 0, "last_search_at": None, "last_status": None,
                                                          "last_message": None, "last_error": None, "last_at": None})
    web: dict[str, dict[str, Any]] = defaultdict(lambda: {"count": 0, "last_at": None})
    rows = db.execute(select(ResearchLog).where(ResearchLog.connector_id.isnot(None),
                                                ResearchLog.category.in_(("search", "result", "connector", "error")))
                      .order_by(ResearchLog.id.desc()).limit(20000)).scalars().all()
    for r in reversed(rows):  # ordre chronologique
        a = agg[r.connector_id]
        oc = r.outcome or {}
        if r.category == "search":
            a["searches"] += 1
            a["last_search_at"] = r.ts
            continue
        if r.category == "result":
            n = int(oc.get("count") or 0)
            a["results"] += n
            status = oc.get("status") or ("ok" if n else "no_result")
            err = None
            for d in oc.get("sources") or []:
                if r.connector_id == "gemini_web":
                    web[d]["count"] += 1
                    web[d]["last_at"] = r.ts
        elif r.category == "connector":
            status, err = ("restricted", oc.get("error") or r.message)
        else:
            status, err = ("error", oc.get("error") or r.message)
        if r.category in ("connector", "error") and not oc and r.level not in ("warning", "error"):
            continue
        a["last_status"], a["last_message"], a["last_at"] = status, r.message, r.ts
        if err:
            a["last_error"] = err
    proposed: dict[str, int] = defaultdict(int)
    for (plan,) in db.execute(select(ResearchTask.plan).order_by(ResearchTask.created_at.desc()).limit(2000)):
        for s in plan or []:
            if s.get("action") == "browse" and s.get("connector_id"):
                proposed[s["connector_id"]] += 1
    out = []
    for c in registry.all():
        caps = c.capabilities
        st = statuses.get(c.id)
        color, explanation = _status_message(c.id, st, caps.access_mode)
        a = agg.get(c.id) or agg[c.id]
        out.append({"connector_id": c.id, "name": caps.name, "domain": _domain(caps.homepage), "homepage": caps.homepage,
                    "access_mode": caps.access_mode, "country": caps.country, "organization": caps.organization,
                    "searches": a["searches"], "results": a["results"], "last_search_at": a["last_search_at"],
                    "last_status": a["last_status"], "last_message": a["last_message"], "last_error": a["last_error"],
                    "proposed_manual": proposed.get(c.id, 0),
                    "operational_status": st.status if st else ("manual" if caps.access_mode in ("browser", "manual") else "untested"),
                    "last_test_at": st.last_test_at if st else None, "test_details": (st.details if st else {}) or {},
                    "color": color, "explanation": explanation})
    out.sort(key=lambda x: (-(x["searches"] + x["proposed_manual"]), x["access_mode"] not in ("api", "html"), x["name"]))
    web_domains = sorted(({"domain": d, **v} for d, v in web.items()), key=lambda x: -x["count"])
    return {"sites": out, "web_domains": web_domains}


# ------------------------------------------------------------------ diagnostic
def _diag_message(cid: str, name: str, res: dict) -> str:
    det = res.get("details") or {}
    err = str(det.get("error") or "")
    st = res.get("status")
    if cid == "gemini_web":
        if st == "ok":
            doms = ", ".join((det.get("domains") or [])[:4])
            return f"Gemini : recherche web opérationnelle ({det.get('sources', 0)} page(s) consultée(s){' : ' + doms if doms else ''})."
        if st == "manual":
            return "Gemini : clé absente ou recherche web désactivée. " + err
        if st == "degraded":
            return "Gemini répond, mais sans consulter de page web (aucune source renvoyée)."
        return f"Gemini : appel impossible ({err or 'erreur inconnue'})."
    if st == "ok":
        extra = det.get("sample_results", det.get("results"))
        return f"{name} : opérationnel" + (f" ({extra} résultat(s) de test)" if isinstance(extra, int) else "") + "."
    if st == "manual":
        return f"{name} : accès automatisé refusé par le site ({err or 'protection ou règles du site'}). Consultation manuelle proposée."
    if st == "degraded":
        msg = det.get("message") or err or (f"code HTTP {det.get('homepage_http')}" if det.get("homepage_http") else "réponse incomplète")
        return f"{name} : répond partiellement ({msg})."
    if st == "timeout":
        return f"{name} : pas de réponse en moins de {int(DIAGNOSTIC_TIMEOUT)} s."
    return f"{name} : injoignable ({err or 'erreur réseau'}). Le site est peut-être en panne, ou le réseau bloque l'accès."


async def _run_test(c) -> dict:
    t0 = time.monotonic()
    try:
        res = await asyncio.wait_for(c.self_test(), timeout=DIAGNOSTIC_TIMEOUT * 0.9)
    except asyncio.TimeoutError:
        res = {"ok": False, "status": "timeout", "details": {"error": "délai dépassé"}}
    except AccessRestricted as exc:
        res = {"ok": False, "status": "manual", "details": {"error": str(exc)}}
    except Exception as exc:
        res = {"ok": False, "status": "failed", "details": {"error": str(exc)}}
    res["latency_ms"] = int((time.monotonic() - t0) * 1000)
    return res


@router.post("/trace/diagnostic")
async def trace_diagnostic(db: Session = Depends(get_session)):
    """« Vérifier que le moteur de recherche fonctionne » : teste réellement chaque site interrogeable automatiquement."""
    started = utcnow()
    t0 = time.monotonic()
    testable = [c for c in registry.all() if c.capabilities.access_mode in ("api", "html")]
    jobs = {c.id: asyncio.ensure_future(_run_test(c)) for c in testable}
    done, pending = await asyncio.wait(list(jobs.values()), timeout=DIAGNOSTIC_TIMEOUT)
    for p in pending:
        p.cancel()
    results = []
    now = utcnow()
    for c in testable:
        job = jobs[c.id]
        if job in done and not job.cancelled() and job.exception() is None:
            res = job.result()
        else:
            res = {"ok": False, "status": "timeout", "details": {"error": "délai global dépassé"}, "latency_ms": int(DIAGNOSTIC_TIMEOUT * 1000)}
        stored = {"timeout": "failed"}.get(res["status"], res["status"])
        st = db.get(ConnectorStatus, c.id)
        if st is None:
            st = ConnectorStatus(connector_id=c.id)
            db.add(st)
        st.status, st.last_test_at, st.details = stored, now, {**(res.get("details") or {}), "latency_ms": res.get("latency_ms")}
        verdict = "ok" if res["status"] == "ok" else "restricted" if res["status"] == "manual" else "degraded" if res["status"] == "degraded" else "failed"
        results.append({"connector_id": c.id, "name": c.capabilities.name, "domain": _domain(c.capabilities.homepage),
                        "homepage": c.capabilities.homepage, "access_mode": c.capabilities.access_mode, "result": verdict,
                        "status": stored, "ok": bool(res.get("ok")), "latency_ms": res.get("latency_ms"),
                        "message": _diag_message(c.id, c.capabilities.name, res), "details": res.get("details") or {}})
    for c in registry.all():
        if c.capabilities.access_mode in ("browser", "manual"):
            results.append({"connector_id": c.id, "name": c.capabilities.name, "domain": _domain(c.capabilities.homepage),
                            "homepage": c.capabilities.homepage, "access_mode": c.capabilities.access_mode, "result": "restricted",
                            "status": "manual", "ok": False, "latency_ms": None,
                            "message": f"{c.capabilities.name} : consultation par navigateur uniquement (règles du site).", "details": {}})
    order = {"gemini_web": 0}
    results.sort(key=lambda r: (order.get(r["connector_id"], 1), r["access_mode"] not in ("api", "html"),
                                {"ok": 0, "degraded": 1, "failed": 2, "restricted": 3}.get(r["result"], 4), r["name"]))
    tested = [r for r in results if r["access_mode"] in ("api", "html")]
    counts = {k: sum(1 for r in tested if r["result"] == k) for k in ("ok", "degraded", "failed", "restricted")}
    if tested and counts["ok"] == 0:
        verdict = "Aucun site interrogeable automatiquement n'a répondu : vérifiez la connexion Internet (ou un blocage réseau)."
    elif counts["failed"] or counts["degraded"]:
        verdict = f"Le moteur fonctionne partiellement : {counts['ok']} site(s) opérationnel(s) sur {len(tested)}."
    else:
        verdict = f"Le moteur de recherche fonctionne : {counts['ok']} site(s) opérationnel(s) sur {len(tested)}."
    db.commit()
    return {"started_at": started, "duration_ms": int((time.monotonic() - t0) * 1000), "summary": counts, "verdict": verdict,
            "results": results}
