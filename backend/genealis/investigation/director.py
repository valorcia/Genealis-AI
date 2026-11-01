"""GENEALIS RESEARCH DIRECTOR — « LANCER UNE ENQUÊTE AUTONOME ».

Boucle : examiner l'arbre → trouver les lacunes → planifier (tâches priorisées, stratégie la moins chère) →
chercher (connecteurs gratuits, recherche web Gemini) → confier la navigation au worker local (tâches `browse`) →
lire les actes (paléographie / IA) → comparer les personnes → vérifier les filiations (niveaux de preuve) →
suivre les témoins et relations indirectes → génération précédente → recommencer, sans intervention systématique.

Les décisions importantes qui ne peuvent pas être tranchées deviennent des questions ; un quota atteint
bloque proprement l'enquête (BLOQUÉE, raison visible, reprise possible).
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from ..ai.errors import ExternalTransferRefused, QuotaExceeded
from ..models import Hypothesis, Investigation, InvestigationTask, Media, PageVisit, Person, STATUS_LABELS_FR, utcnow
from ..services import cost, privacy
from ..services import settings_service as cfg
from ..services.persons import families_of, parents_of
from . import memory, queue, strategy
from .handlers import HANDLERS, SERVER_KINDS

logger = logging.getLogger("genealis.director")

ACTIVE = ("pending", "running")
_step_lock = threading.Lock()

# Lacunes : (clé, registre, objectif, priorité de base)
GAPS = (
    ("birth", "birth", "Acte de naissance ou de baptême (il nomme les parents)", 85),
    ("parents", "parents", "Parents : acte de naissance ou de mariage qui les nomme", 80),
    ("marriage", "marriage", "Acte de mariage (il nomme les parents des deux époux et des témoins)", 70),
    ("death", "death", "Acte de décès ou de sépulture", 55),
    ("census", "census", "Recensements (composition du foyer, âges, lieux)", 35),
)
REGISTER_FR = {"birth": "naissance", "parents": "parents", "marriage": "mariage", "death": "décès", "census": "recensement"}


# ------------------------------------------------------------------ création
def start_investigation(db: Session, person_id: str, objective: str | None = None, max_generations: int | None = None,
                        ai_call_ceiling: int | None = None, cost_mode: str | None = None, *, start: bool = True,
                        owner_id: str | None = None) -> Investigation:
    person = db.get(Person, person_id)
    if person is None:
        raise ValueError("Personne introuvable.")
    if cost_mode and cost_mode not in cost.COST_MODES:
        raise ValueError(f"Mode de coût inconnu : {cost_mode}")
    gens = int(max_generations if max_generations is not None else cfg.get(db, "investigation_max_generations", 3) or 3)
    ceiling = int(ai_call_ceiling if ai_call_ceiling is not None else cfg.get(db, "investigation_ai_call_ceiling", 60) or 60)
    objective = objective or (f"Remonter les ascendants de {person.display_name()} sur {gens} génération(s) : actes, parents, "
                              "témoins et relations indirectes, avec preuves.")
    inv = Investigation(title=f"Enquête : {person.display_name()}"[:512], person_id=person.id, objective=objective,
                        status="pending" if start else "paused", cost_mode=cost_mode or cost.mode(db),
                        max_generations=max(0, gens), ai_call_ceiling=max(0, ceiling), memory={}, stats={},
                        owner_id=owner_id)
    db.add(inv)
    db.flush()
    memory.save(inv, {**memory.load(inv), "person_id": person.id, "objective": objective})
    queue.enqueue(db, inv.id, "plan", f"Examiner l'arbre et planifier — {person.display_name()}", person_id=person.id,
                  params={"generation": 0}, priority=100, generation=0)
    queue.emit(db, inv.id, "plan", f"Enquête lancée sur {person.display_name()} : {objective}",
               {"max_generations": inv.max_generations, "ai_call_ceiling": inv.ai_call_ceiling, "cost_mode": inv.cost_mode})
    db.flush()
    return inv


# ------------------------------------------------------------------ planification
def _has_event(db: Session, p: Person, *types: str) -> bool:
    if any(e.event_type in types for e in p.events):
        return True
    return any(e.event_type in types for f in families_of(db, p.id) for e in getattr(f, "events", []) or [])


def gaps(db: Session, p: Person) -> list[str]:
    out = []
    birth_year = next((e.sort_year for e in p.events if e.event_type in ("birth", "baptism") and e.sort_year), None)
    if not _has_event(db, p, "birth", "baptism"):
        out.append("birth")
    pars = [x for x, r in parents_of(db, p.id) if r.relation_type in ("biological", "uncertain", "legal", "adoptive")]
    if len(pars) < 2 and "birth" not in out:
        out.append("parents")
    if not _has_event(db, p, "marriage", "civil_marriage", "religious_marriage"):
        out.append("marriage")
    if not _has_event(db, p, "death", "burial") and p.is_living is not True:
        out.append("death")
    if birth_year and 1820 <= birth_year <= 1936 and not _has_event(db, p, "census"):
        out.append("census")
    return out


def _query_text(p: Person, reg: str) -> str:
    by = next((e.sort_year for e in p.events if e.event_type in ("birth", "baptism") and e.sort_year), None)
    place = next(((e.place.name if e.place else e.place_original) for e in p.events if e.place or e.place_original), None)
    bits = [p.given_names or "", (p.surname or "").upper(), REGISTER_FR.get(reg, reg)]
    if by:
        bits.append(f"vers {by}")
    if place:
        bits.append(place.split(",")[0])
    return " ".join(b for b in bits if b).strip()


def plan_person(db: Session, inv: Investigation, person: Person, *, generation: int = 0,
                parent_task_id: str | None = None) -> list[InvestigationTask]:
    """Lacunes de la personne → tâches priorisées (la stratégie la moins chère d'abord). Jamais deux fois la même."""
    from ..agents.questions import ask

    created: list[InvestigationTask] = []
    base = -5 * generation
    living = privacy.protection_active(db) and privacy.is_possibly_living(db, person.id)
    # 0. Données déjà disponibles : documents rattachés non encore exploités (0 recherche)
    for med in db.query(Media).filter(Media.person_id == person.id, Media.kind == "document").all():
        if living:
            break
        t, new = queue.enqueue(db, inv.id, "analyze_document", f"Lire le document « {med.title or med.original_filename} »",
                               person_id=person.id, params={"media_id": med.id}, priority=95 + base, generation=generation,
                               parent_task_id=parent_task_id)
        if new:
            created.append(t)
    found = gaps(db, person)
    pars = [x for x, r in parents_of(db, person.id) if r.relation_type in ("biological", "uncertain", "legal", "adoptive")]
    if living:
        queue.emit(db, inv.id, "info", f"{person.display_name()} est peut-être vivant(e) : aucune recherche externe la concernant "
                                       "(protection des personnes vivantes).", {"person_id": person.id}, parent_task_id)
        if not pars:
            ask(db, title=f"Connais-tu les noms des parents de {person.display_name()} ?",
                problem="Cette personne est peut-être vivante : l'enquête ne la recherche pas en ligne. Les parents permettent "
                        "de commencer la recherche à la génération précédente.", person_id=person.id, task_id=parent_task_id,
                impact="Démarre l'enquête sur les parents.", priority=85, dedupe_key=f"inv:{inv.id}:parents:{person.id}")
        found = []
    choice = strategy.for_search(db, inv)
    for key, reg, goal, prio in GAPS:
        if key not in found:
            continue
        if not person.surname:
            ask(db, title=f"Quel est le nom de famille de {person.display_name()} ?",
                problem="Sans patronyme, aucune recherche nominative n'est possible.", person_id=person.id,
                task_id=parent_task_id, priority=90, dedupe_key=f"{person.id}:surname")
            break
        q = _query_text(person, reg)
        t, new = queue.enqueue(db, inv.id, "web_search", f"{goal} — {person.display_name()}"[:512], person_id=person.id,
                               params={"query": q, "person_id": person.id, "goal": goal, "register_type": reg},
                               priority=prio + base, strategy="web_search", generation=generation, parent_task_id=parent_task_id)
        if new:
            created.append(t)
    if pars:
        t, new = queue.enqueue(db, inv.id, "expand_generation", f"Génération précédente — {person.display_name()}",
                               person_id=person.id, params={"person_id": person.id, "generation": generation},
                               priority=50 + base, generation=generation, parent_task_id=parent_task_id)
        if new:
            created.append(t)
    labels = ", ".join(REGISTER_FR.get(g, g) for g in found) or "aucune lacune exploitable"
    queue.emit(db, inv.id, "plan", f"Plan pour {person.display_name()} (génération {generation}) : lacunes {labels} ; "
                                   f"{len(created)} tâche(s) créée(s). Stratégie : {choice.reason}",
               {"person_id": person.id, "gaps": found, "tasks": [t.id for t in created], "strategy": choice.to_dict()},
               parent_task_id)
    refresh_next_searches(db, inv)
    return created


def plan(db: Session, inv: Investigation) -> list[InvestigationTask]:
    """Planifie la personne de départ de l'enquête (équivaut à la tâche `plan` de génération 0)."""
    person = db.get(Person, inv.person_id or "")
    return plan_person(db, inv, person, generation=0) if person else []


def refresh_next_searches(db: Session, inv: Investigation) -> None:
    rows = (db.query(InvestigationTask).filter(InvestigationTask.investigation_id == inv.id, InvestigationTask.status == "pending")
            .order_by(InvestigationTask.priority.desc(), InvestigationTask.created_at).limit(10).all())
    memory.set_next_searches(inv, [{"task_id": t.id, "title": t.title, "kind": t.kind, "priority": t.priority} for t in rows])


# ------------------------------------------------------------------ résultats du worker navigateur
def process_browse_results(db: Session, inv_id: str | None = None) -> list[str]:
    """Tâches `browse` terminées par le worker → tâches `analyze_document` (une par document téléchargé)."""
    from ..agents.questions import ask

    q = db.query(InvestigationTask).filter(InvestigationTask.kind == "browse",
                                           InvestigationTask.status.in_(("done", "to_verify", "blocked", "failed")))
    if inv_id:
        q = q.filter(InvestigationTask.investigation_id == inv_id)
    created: list[str] = []
    for t in q.all():
        r = dict(t.result or {})
        if r.get("director_processed"):
            continue
        inv = db.get(Investigation, t.investigation_id)
        if inv is None:
            continue
        for pv in db.query(PageVisit).filter(PageVisit.task_id == t.id).all():
            memory.record_page(inv, pv.url, title=pv.title, outcome=pv.outcome, task_id=t.id)
            memory.record_site(inv, pv.domain)
        findings = r.get("findings") or []
        ref = next((f.get("archival_reference") for f in findings if isinstance(f, dict) and f.get("archival_reference")),
                   (t.params or {}).get("archival_reference"))
        url = next((f.get("url") for f in findings if isinstance(f, dict) and f.get("url")), (t.params or {}).get("start_url"))
        for mid in r.get("documents") or []:
            if not db.get(Media, mid):
                continue
            memory.record_document(inv, mid, url=url, archival_reference=ref, status="found")
            nt, new = queue.enqueue(db, inv.id, "analyze_document", f"Lire le document trouvé ({t.title[:80]})",
                                    person_id=t.person_id, params={"media_id": mid, "url": url, "archival_reference": ref,
                                                                   "browse_task_id": t.id},
                                    priority=max(t.priority, 80), generation=t.generation, parent_task_id=t.id)
            if new:
                created.append(nt.id)
                queue.emit(db, inv.id, "document", "Document trouvé par le navigateur : lecture planifiée.", {"media_id": mid}, t.id)
        if t.status == "blocked" and r.get("needs_human"):
            ask(db, title=f"Votre aide est nécessaire : {t.title}",
                problem=f"Le navigateur s'est arrêté : {r.get('blocked_reason') or 'action humaine requise'}. Aucun contournement "
                        "n'est tenté (CAPTCHA, connexion, conditions du site). Ouvrez la page, faites l'action, puis cliquez "
                        "« J'ai terminé ».", person_id=t.person_id, task_id=t.id,
                documents=[{"url": (t.params or {}).get("start_url")}], priority=70, dedupe_key=f"inv:{inv.id}:human:{t.id}")
            queue.emit(db, inv.id, "human", f"Assistance humaine demandée : {r.get('blocked_reason') or t.title}", {}, t.id)
        if t.status == "failed" or r.get("outcome") == "failed":
            memory.record_failure(inv, t.title, t.last_error or r.get("notes") or "échec de navigation", t.id)
        t.result = {**r, "director_processed": True}
    db.flush()
    return created


# ------------------------------------------------------------------ états
def open_hypotheses(db: Session, inv: Investigation) -> int:
    ids = [i for (i,) in db.query(InvestigationTask.id).filter(InvestigationTask.investigation_id == inv.id)]
    if not ids:
        return 0
    return db.query(Hypothesis).filter(Hypothesis.task_id.in_(ids), Hypothesis.status == "open").count()


def update_status(db: Session, inv: Investigation) -> str:
    if inv.status not in ACTIVE:
        return inv.status
    c = queue.counts(db, inv.id)
    if c.get("pending", 0) + c.get("running", 0) == 0:
        n_open = open_hypotheses(db, inv)
        inv.status = "to_verify" if (n_open or c.get("to_verify")) else "done"
        inv.finished_at = utcnow()
        queue.emit(db, inv.id, "info", "Enquête terminée : " + (f"{n_open} hypothèse(s) à vérifier par vous." if inv.status == "to_verify"
                                                                 else "toutes les recherches planifiées ont été faites."), {})
    return inv.status


def block_investigation(db: Session, inv: Investigation, exc: QuotaExceeded, task: InvestigationTask | None) -> None:
    inv.status = "blocked"
    inv.blocked_reason = str(exc)
    until = (utcnow() + timedelta(seconds=exc.retry_after_s)).isoformat(timespec="seconds") if exc.retry_after_s else None
    if exc.scope == "daily":
        until = (utcnow().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1, minutes=5)).isoformat(timespec="seconds")
    memory.set_blocked(inv, {"scope": exc.scope, "message": str(exc), "retry_after_until": until,
                             "auto_resume": exc.scope in ("minute", "provider", "daily")})
    queue.emit(db, inv.id, "cost", f"Enquête BLOQUÉE : {exc} Aucun nouvel appel IA n'est envoyé ; reprise possible.",
               {"scope": exc.scope, "retry_after_until": until}, task.id if task else None)


def auto_resume(db: Session) -> list[str]:
    """Enquêtes bloquées par un quota temporaire (minute, fournisseur, jour) dont le délai est passé → EN COURS."""
    out = []
    for inv in db.query(Investigation).filter(Investigation.status == "blocked").all():
        b = (inv.memory or {}).get("blocked") or {}
        if not b.get("auto_resume") or not b.get("retry_after_until"):
            continue
        try:
            until = datetime.fromisoformat(b["retry_after_until"])
        except ValueError:
            continue
        if until <= utcnow():
            resume(db, inv, reason="Délai du quota écoulé : reprise automatique.")
            out.append(inv.id)
    return out


def pause(db: Session, inv: Investigation) -> Investigation:
    if inv.status in ACTIVE or inv.status in ("blocked", "to_verify"):
        inv.status = "paused"
        queue.emit(db, inv.id, "info", "Enquête mise en pause par vous.", {})
    db.flush()
    return inv


def resume(db: Session, inv: Investigation, reason: str = "Enquête reprise.") -> Investigation:
    if inv.status == "stopped":
        for t in db.query(InvestigationTask).filter(InvestigationTask.investigation_id == inv.id,
                                                    InvestigationTask.status == "cancelled").all():
            t.status, t.finished_at = "pending", None
    inv.status = "running"
    inv.blocked_reason = None
    inv.finished_at = None
    memory.set_blocked(inv, None)
    queue.requeue_expired(db)
    queue.emit(db, inv.id, "info", reason, {})
    db.flush()
    return inv


def stop(db: Session, inv: Investigation) -> Investigation:
    """Arrêt : les tâches en attente sont annulées (jamais supprimées) ; ce qui est trouvé est conservé."""
    n = 0
    for t in db.query(InvestigationTask).filter(InvestigationTask.investigation_id == inv.id,
                                                InvestigationTask.status == "pending").all():
        t.status, t.finished_at = "cancelled", utcnow()
        n += 1
    inv.status = "stopped"
    inv.finished_at = utcnow()
    queue.emit(db, inv.id, "info", f"Enquête arrêtée par vous : {n} tâche(s) en attente annulée(s). Les découvertes sont conservées.", {})
    db.flush()
    return inv


# ------------------------------------------------------------------ exécution
def _run_task(db: Session, inv: Investigation, task: InvestigationTask) -> Optional[QuotaExceeded]:
    """Exécute UNE tâche serveur. Renvoie l'exception de quota si l'enquête doit être bloquée."""
    handler = HANDLERS[task.kind]
    t0 = time.monotonic()
    tid, iid = task.id, inv.id
    queue.emit(db, inv.id, "info", f"Début : {task.title}", {"kind": task.kind}, task.id)
    try:
        with cost.ai_context(investigation_id=inv.id, task_id=task.id, owner_id=inv.owner_id):
            result, status = handler(db, inv, task)
        if status == "blocked":
            queue.block(db, task, result.pop("blocked_reason", "Bloquée"), needs_human=bool(result.pop("needs_human", True)))
            task.result = {**(task.result or {}), **result}
            queue.emit(db, inv.id, "human", f"Tâche bloquée : {task.title} — {task.result.get('blocked_reason')}", {}, task.id)
        else:
            queue.complete(db, task, result, status=status)
            queue.emit(db, inv.id, "info", f"Terminé ({STATUS_LABELS_FR.get(status, status)}) : {task.title}", {"kind": task.kind}, task.id)
    except QuotaExceeded as exc:
        # La tâche n'a pas été faite : elle redevient EN ATTENTE, sans compter de tentative ; l'enquête est BLOQUÉE.
        task.status, task.claimed_by, task.lease_until = "pending", None, None
        task.attempts = max(0, (task.attempts or 1) - 1)
        task.last_error = str(exc)[:2000]
        block_investigation(db, inv, exc, task)
        return exc
    except ExternalTransferRefused as exc:
        queue.block(db, task, str(exc), needs_human=True)
        queue.emit(db, inv.id, "human", f"Tâche bloquée (protection des données) : {exc}", {}, task.id)
    except Exception as exc:  # erreur inattendue : on annule les écritures partielles de cette tâche
        logger.exception("Tâche d'enquête %s en échec", tid)
        db.rollback()
        task = db.get(InvestigationTask, tid)
        inv = db.get(Investigation, iid)
        queue.fail(db, task, f"{type(exc).__name__}: {exc}")
        inv.last_error = f"{task.title} : {exc}"[:2000]
        memory.record_failure(inv, task.title, str(exc), task.id)
        queue.emit(db, inv.id, "error", f"Erreur sur « {task.title} » : {exc}"
                   + (" — nouvel essai plus tard." if task.status == "pending" else " — abandon (ÉCHEC)."), {}, task.id)
    finally:
        inv = db.get(Investigation, iid)
        if inv is not None:
            inv.active_seconds = float(inv.active_seconds or 0) + (time.monotonic() - t0)
    return None


def step(db: Session, inv_id: str | None = None, budget_s: float = 20.0, *, worker: str = "server", max_tasks: int = 50) -> dict:
    """Fait avancer une enquête (ou toutes) pendant `budget_s` secondes. Persiste après chaque tâche (reprise possible)."""
    if not _step_lock.acquire(timeout=max(1.0, budget_s)):
        inv = db.get(Investigation, inv_id) if inv_id else None
        return {"executed": [], "status": inv.status if inv else None, "locked": True}
    try:
        t0 = time.monotonic()
        executed: list[str] = []
        queue.requeue_expired(db)
        auto_resume(db)
        process_browse_results(db, inv_id)
        db.commit()
        touched: set[str] = {inv_id} if inv_id else set()
        while time.monotonic() - t0 < budget_s and len(executed) < max_tasks:
            task = queue.claim(db, worker, kinds=SERVER_KINDS, investigation_id=inv_id, lease_s=max(120, int(budget_s * 3)))
            if task is None:
                break
            db.commit()  # le bail est enregistré : un arrêt brutal rendra la tâche à la file (requeue_expired)
            inv = db.get(Investigation, task.investigation_id)
            touched.add(inv.id)
            executed.append(task.id)
            quota = _run_task(db, inv, task)
            refresh_next_searches(db, db.get(Investigation, inv.id))
            db.commit()
            if quota is not None:
                if quota.scope != "investigation":
                    # Quota global (jour, minute, fournisseur, budget) : aucune autre enquête ne doit partir non plus
                    for other in db.query(Investigation).filter(Investigation.status.in_(ACTIVE), Investigation.id != inv.id).all():
                        block_investigation(db, other, quota, None)
                        touched.add(other.id)
                    db.commit()
                    break
                if inv_id:
                    break
        for iid in touched:
            i = db.get(Investigation, iid)
            if i is not None:
                update_status(db, i)
        db.commit()
        inv = db.get(Investigation, inv_id) if inv_id else None
        return {"executed": executed, "status": inv.status if inv else None,
                "elapsed": round(time.monotonic() - t0, 2)}
    finally:
        _step_lock.release()


# ------------------------------------------------------------------ statistiques
def stats(db: Session, inv: Investigation) -> dict:
    from sqlalchemy import func

    tasks = db.query(InvestigationTask).filter(InvestigationTask.investigation_id == inv.id).all()
    ids = [t.id for t in tasks]
    mem = memory.load(inv)
    docs = {d.get("media_id") for d in mem.get("documents") or [] if d.get("media_id")}
    for t in tasks:
        if t.kind == "analyze_document" and (t.params or {}).get("media_id"):
            docs.add(t.params["media_id"])
    n_h = db.query(func.count(Hypothesis.id)).filter(Hypothesis.task_id.in_(ids)).scalar() if ids else 0
    filiations = [f for f in mem.get("filiations") or []]
    ancestors = {f.get("parent_id") for f in filiations if f.get("parent_id")} | \
        {t.person_id for t in tasks if t.kind == "plan" and (t.generation or 0) > 0 and t.person_id}
    persons = {t.person_id for t in tasks if t.person_id and t.kind in ("plan", "web_search")}
    return {
        "documents_found": len(docs),
        "acts_analyzed": sum(1 for t in tasks if t.kind == "analyze_document" and t.status == "done"),
        "ancestors_identified": len(ancestors),
        "filiations_verified": len(filiations),
        "hypotheses": int(n_h or 0),
        "errors": sum(1 for t in tasks if t.status == "failed") + len(mem.get("failures") or []),
        "pages_visited": db.query(func.count(PageVisit.id)).filter(PageVisit.investigation_id == inv.id).scalar() or 0,
        "persons_searched": len(persons),
    }


def generation_persons(db: Session, inv: Investigation) -> list[dict]:
    """Personnes de l'enquête : génération, numéros Sosa, état de leurs tâches."""
    from ..services.sosa import sosa_map

    smap = sosa_map(db)
    rows: dict[str, dict] = {}
    for t in db.query(InvestigationTask).filter(InvestigationTask.investigation_id == inv.id,
                                                InvestigationTask.person_id.isnot(None)).all():
        p = db.get(Person, t.person_id)
        if p is None:
            continue
        r = rows.setdefault(p.id, {"id": p.id, "name": p.display_name(), "generation": t.generation, "sosa": smap.get(p.id, []),
                                   "_states": set()})
        r["generation"] = min(r["generation"], t.generation)
        r["_states"].add(t.status)
    out = []
    for r in rows.values():
        st = r.pop("_states")
        r["status"] = "running" if st & {"pending", "running"} else ("to_verify" if "to_verify" in st else
                                                                    "blocked" if "blocked" in st else "done")
        out.append(r)
    out.sort(key=lambda r: (r["generation"], r["name"]))
    return out
