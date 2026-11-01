"""Moteur autonome de recherche : file d'attente, agents, reprise, mémoire.

Agents :
- Coordinateur : orchestre, applique le mode d'autonomie, journalise ses décisions.
- Chercheur : interroge les connecteurs (opérations réelles uniquement).
- Vérificateur : rapproche les résultats des personnes connues, détecte homonymes et contradictions.
- Transcripteur : analyse les documents importés.
- Historien : contexte (archives probables, frontières, variantes de noms) et narration sourcée.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..connectors.base import AccessRestricted, SearchQuery, SearchResult, registry
from ..connectors import registry_service  # noqa: F401
from ..db import session_scope
from ..models import utcnow, Citation, Hypothesis, Media, Person, ResearchTask, Source
from ..schemas import EventIn
from ..services import settings_service as cfg
from ..services.confidence import recompute_all
from ..services.consistency import run_all as run_consistency
from ..services.journal import decide, log, notify
from ..services.matching import Candidate, MatchResult, find_matches, score_candidate
from ..services.persons import add_event, parents_of
from .planner import PlanStep, TASK_LABELS, plan_task
from .questions import ask

logger = logging.getLogger("genealis.engine")

RETRY_DELAY_DAYS = 30  # une recherche infructueuse n'est pas relancée avant ce délai, sauf nouvelle information


def fingerprint(task_type: str, person_id: str | None, params: dict) -> str:
    return hashlib.sha1(f"{task_type}|{person_id}|{json.dumps(params, sort_keys=True, default=str)}".encode()).hexdigest()[:24]


# ------------------------------------------------------------------ création
def enqueue(db: Session, task_type: str, person_id: str | None = None, *, title: str | None = None, priority: int = 50,
            params: dict | None = None, parent_task_id: str | None = None, force: bool = False) -> ResearchTask:
    params = params or {}
    fp = fingerprint(task_type, person_id, params)
    person = db.get(Person, person_id) if person_id else None
    if not force:
        prev = db.execute(select(ResearchTask).where(ResearchTask.fingerprint == fp)
                          .order_by(ResearchTask.created_at.desc())).scalars().first()
        if prev and prev.status in ("queued", "running", "waiting_user"):
            return prev
        if prev and prev.status == "done" and prev.finished_at and prev.finished_at > utcnow() - timedelta(days=RETRY_DELAY_DAYS) \
                and not prev.result.get("new_info_since"):
            log(db, f"Recherche déjà effectuée le {prev.finished_at:%d/%m/%Y} : {prev.title} — non relancée.",
                category="decision", person_id=person_id)
            return prev
    mode = int(cfg.get(db, "autonomy_mode", 1))
    label = title or f"{TASK_LABELS.get(task_type, task_type)}" + (f" — {person.display_name()}" if person else "")
    task = ResearchTask(task_type=task_type, title=label, person_id=person_id, priority=priority, params=params,
                        parent_task_id=parent_task_id, fingerprint=fp, requires_approval=(mode == 1),
                        status="waiting_user" if mode == 1 else "queued")
    db.add(task)
    db.flush()
    task.plan = [s.to_dict() for s in plan_task(db, task, person)]
    db.flush()
    log(db, f"Tâche créée : {label} (priorité {priority}, {'attend votre accord' if mode == 1 else 'en file'})",
        category="decision", task_id=task.id, person_id=person_id)
    notify({"type": "task", "id": task.id, "status": task.status, "title": task.title})
    return task


def approve(db: Session, task: ResearchTask, approved: bool) -> ResearchTask:
    task.approved = approved
    task.status = "queued" if approved else "cancelled"
    db.flush()
    log(db, f"Tâche {'approuvée' if approved else 'refusée'} : {task.title}", category="decision", task_id=task.id)
    notify({"type": "task", "id": task.id, "status": task.status, "title": task.title})
    return task


def recover_interrupted(db: Session) -> int:
    """Au démarrage : les tâches restées « running » sont remises en file (reprise après interruption)."""
    n = 0
    for t in db.execute(select(ResearchTask).where(ResearchTask.status == "running")).scalars():
        t.status = "queued"
        t.attempts += 1
        t.last_error = "Interrompue (redémarrage de l'application) ; reprise automatique."
        n += 1
    db.flush()
    if n:
        log(db, f"{n} tâche(s) interrompue(s) remise(s) en file d'attente.", category="decision")
    return n


# ------------------------------------------------------------------ agents
def _domain(url: str | None) -> str | None:
    from urllib.parse import urlparse

    if not url:
        return None
    return (urlparse(url).netloc or "").lower().replace("www.", "") or None


def searched_summary(q: SearchQuery) -> dict:
    """Ce qui a été cherché, en clair (nom, années, commune)."""
    return {"name": " ".join(x for x in (q.given_names, (q.surname or "").upper()) if x) or None,
            "years": (f"{q.year_from or '?'}–{q.year_to or '?'}" if (q.year_from or q.year_to) else None),
            "commune": q.commune, "department": q.department, "register_type": q.register_type}


def compact_result(r: SearchResult) -> dict:
    return {"title": r.title, "url": r.url, "snippet": r.snippet, "year": r.year, "date_text": r.date_text, "place": r.place,
            "reliability": r.reliability, "connector_id": r.connector_id, "record_type": r.record_type,
            "repository": r.repository}


def step_context(c, q: SearchQuery) -> dict:
    try:
        verify = c.browse_url(q)
    except Exception:  # pragma: no cover - modèle d'URL invalide
        verify = c.capabilities.homepage
    return {"verify_url": verify, "browse_url": verify, "site": _domain(c.capabilities.homepage),
            "homepage": c.capabilities.homepage, "connector_name": c.capabilities.name,
            "access_mode": c.capabilities.access_mode, "searched": searched_summary(q)}


class ResearcherAgent:
    name = "chercheur"

    async def run_step(self, db: Session, task: ResearchTask, step: dict) -> list[SearchResult]:
        """Exécute une recherche réelle et en garde une trace complète et vérifiable (jamais simulée)."""
        import time

        cid = step.get("connector_id")
        c = registry.get(cid) if cid else None
        if not c:
            step["status"] = "skipped"
            step["result"] = {"status": "error", "count": 0, "results": [],
                              "message": f"Le connecteur « {cid} » n'est plus disponible : cette recherche n'a pas été effectuée."}
            return []
        q = SearchQuery(**{k: v for k, v in (step.get("query") or {}).items() if k in SearchQuery.__dataclass_fields__})
        ctx = step_context(c, q)
        started = utcnow()
        t0 = time.monotonic()
        name = c.capabilities.name

        def timing() -> dict:
            return {"started_at": started.isoformat(), "finished_at": utcnow().isoformat(),
                    "duration_ms": int((time.monotonic() - t0) * 1000)}

        log(db, f"Recherche dans {name} : {q.surname or ''} {q.given_names or ''} "
                f"{q.year_from or ''}-{q.year_to or ''} {q.commune or ''}".strip(),
            category="search", task_id=task.id, person_id=task.person_id, connector_id=cid, query=q.to_dict(),
            outcome={"verify_url": ctx["verify_url"], "site": ctx["site"]})
        db.commit()
        try:
            results = await c.search(q)
        except AccessRestricted as exc:
            step["status"] = "manual"
            step["result"] = {**ctx, **timing(), "status": "restricted", "count": 0, "results": [], "error": str(exc),
                              "message": f"{name} n'autorise pas (ou plus) la consultation automatique : rien n'a été lu sur ce site. "
                                         "Utilisez « Refaire cette recherche moi-même » pour consulter le site."}
            log(db, f"{name} : accès automatisé impossible — consultation manuelle proposée.",
                category="connector", level="warning", task_id=task.id, person_id=task.person_id, connector_id=cid,
                outcome={"status": "restricted", "count": 0, "verify_url": ctx["verify_url"], "browse_url": ctx["verify_url"],
                         "site": ctx["site"], "error": str(exc)})
            return []
        except Exception as exc:
            step["status"] = "failed"
            step["result"] = {**ctx, **timing(), "status": "error", "count": 0, "results": [], "error": str(exc),
                              "message": f"{name} n'a pas pu être interrogé ({exc}). Aucun résultat n'a été obtenu de ce site."}
            log(db, f"{name} : échec ({exc}).", category="error", level="error", task_id=task.id,
                person_id=task.person_id, connector_id=cid,
                outcome={"status": "error", "count": 0, "verify_url": ctx["verify_url"], "site": ctx["site"], "error": str(exc)})
            return []
        grounding = getattr(results, "grounding", None)
        n = len(results)
        res: dict[str, Any] = {**ctx, **timing(), "status": "ok" if n else "no_result", "count": n,
                               "results": [compact_result(r) for r in results[:50]],
                               "message": (f"{n} résultat(s) trouvé(s) sur {name}." if n else
                                           f"{name} a bien été interrogé mais n'a renvoyé aucun résultat pour cette recherche.")}
        outcome: dict[str, Any] = {"status": res["status"], "count": n, "verify_url": ctx["verify_url"], "site": ctx["site"],
                                   "sources": sorted({d for d in (_domain(r.url) for r in results) if d})}
        if grounding is not None:
            from urllib.parse import quote_plus

            g = dict(grounding)
            res["grounding"] = g
            nsrc = len(g.get("sources") or [])
            if g.get("queries"):
                res["verify_url"] = "https://www.google.com/search?q=" + quote_plus(str(g["queries"][0]))
                outcome["verify_url"] = res["verify_url"]
            outcome["sources"] = sorted({s.get("domain") for s in g.get("sources") or [] if s.get("domain")})
            outcome["queries"] = list(g.get("queries") or [])[:10]
            if g.get("parse_error"):
                res["status"] = "error" if not n else "ok"
                res["message"] = f"Gemini a consulté {nsrc} page(s) mais sa réponse n'était pas exploitable. {g['parse_error']}"
            elif not nsrc:
                res["status"] = "no_result" if not n else res["status"]
                res["message"] = "Gemini a répondu sans consulter aucune page web : aucune piste ne peut être vérifiée."
            else:
                notes = len(g.get("notes") or [])
                res["message"] = (f"Gemini a lancé {len(g.get('queries') or [])} recherche(s) Google et consulté {nsrc} page(s) : "
                                  f"{n} piste(s) rattachée(s) à une page" + (f", {notes} indication(s) sans page vérifiable (non retenues)" if notes else "") + ".")
        step["status"] = "done"
        step["result"] = res
        log(db, f"{name} : {n} résultat(s)." + (f" Pages consultées : {', '.join(outcome['sources'][:6])}." if grounding and outcome["sources"] else ""),
            category="result", task_id=task.id, person_id=task.person_id, connector_id=cid, outcome=outcome)
        return results


class VerifierAgent:
    name = "verificateur"

    def evaluate(self, db: Session, task: ResearchTask, person: Person, results: list[SearchResult]) -> list[dict]:
        """Compare chaque résultat nominatif à la personne cible et aux homonymes connus."""
        evaluations = []
        for r in results:
            if not r.candidate:
                continue
            cand = Candidate.from_dict(r.candidate)
            target = score_candidate(db, cand, person)
            # Homonymes réellement compatibles : score suffisant ET aucune contradiction bloquante
            others = [m for m in find_matches(db, cand, min_total=50)
                      if m.person_id != person.id and not m.blocking and m.level in ("green", "orange")]
            evaluations.append({"result": r.to_dict(), "target": target.to_dict(),
                                "other_matches": [m.to_dict() for m in others[:5]]})
            log(db, f"Comparaison « {r.title} » ↔ {person.display_name()} : {target.total:.0f}% ({target.level})"
                    + (f" ; {len(others)} autre(s) personne(s) compatible(s)" if others else ""),
                category="compare", task_id=task.id, person_id=person.id,
                outcome={"total": target.total, "level": target.level, "blocking": target.blocking})
        evaluations.sort(key=lambda e: -e["target"]["total"])
        return evaluations


class TranscriberAgent:
    name = "transcripteur"

    def analyze(self, db: Session, task: ResearchTask, media: Media) -> dict:
        from ..ai.documents import analyze_media

        log(db, f"Analyse du document « {media.title or media.original_filename} »", category="analysis",
            task_id=task.id, person_id=media.person_id)
        db.commit()
        media.analysis_status = "pending"
        db.flush()
        try:
            res = analyze_media(db, media)
        except Exception as exc:
            media.analysis_status = "failed"
            media.analysis = {"error": str(exc)}
            log(db, f"Analyse échouée : {exc}", category="error", level="error", task_id=task.id, person_id=media.person_id)
            return media.analysis
        media.ocr_text = res.transcription
        media.language = res.language if res.language != "?" else media.language
        media.analysis = res.to_dict()
        media.analysis_status = "done" if res.transcription else "failed"
        db.flush()
        log(db, f"Transcription obtenue ({res.method}) : {len(res.transcription)} caractères, "
                f"{len(res.uncertain)} passage(s) incertain(s), {len(res.extraction.get('persons', []))} personne(s) extraite(s).",
            category="analysis", task_id=task.id, person_id=media.person_id, outcome={"method": res.method})
        return media.analysis


class HistorianAgent:
    name = "historien"

    def context_for(self, db: Session, person: Person) -> dict:
        from .planner import _event_place, infer_country

        place, dep, country = _event_place(person, "birth", "baptism", "residence", "marriage", "death")
        c = infer_country(place, country)
        birth_year = next((e.sort_year for e in person.events if e.event_type in ("birth", "baptism") and e.sort_year), None)
        notes = []
        if c == "FR" and birth_year:
            if birth_year < 1792:
                notes.append("Avant 1792 : registres paroissiaux (baptêmes, mariages, sépultures) tenus par le clergé.")
            else:
                notes.append("Après 1792 : état civil communal ; tables décennales à partir de 1793.")
            if 1871 <= birth_year <= 1918 and dep in ("57", "Moselle"):
                notes.append("Moselle annexée 1871-1918 : actes rédigés en allemand.")
        if c == "IT" and birth_year:
            notes.append("Italie : état civil généralisé à partir de 1866 ; état civil napoléonien 1806-1815 dans certaines régions.")
        if c == "PL" and birth_year:
            notes.append("Pologne : registres en latin, polonais, russe (partage russe après 1868) ou allemand selon la zone.")
        return {"country": c, "department": dep, "place": place, "birth_year": birth_year, "notes": notes}


class CoordinatorAgent:
    name = "coordinateur"

    def __init__(self) -> None:
        self.researcher = ResearcherAgent()
        self.verifier = VerifierAgent()
        self.transcriber = TranscriberAgent()
        self.historian = HistorianAgent()

    async def execute(self, db: Session, task: ResearchTask) -> None:
        mode = int(cfg.get(db, "autonomy_mode", 1))
        person = db.get(Person, task.person_id) if task.person_id else None
        decide(db, self.name, f"Exécution de « {task.title} » en mode {mode}", {"mode": mode, "plan_steps": len(task.plan)}, task.id)
        if task.task_type == "analyze_document":
            media = db.get(Media, task.params.get("media_id", ""))
            if media is None:
                raise RuntimeError("Document introuvable")
            analysis = self.transcriber.analyze(db, task, media)
            task.result = {"analysis_status": media.analysis_status}
            if person and analysis.get("extraction", {}).get("persons"):
                self._propose_from_extraction(db, task, person, media, analysis, mode)
            return
        if person is None:
            raise RuntimeError("Personne introuvable")
        ctx = self.historian.context_for(db, person)
        if ctx["notes"]:
            log(db, "Contexte historique : " + " ".join(ctx["notes"]), category="analysis", task_id=task.id, person_id=person.id)
        plan = [dict(s) for s in task.plan]
        all_results: list[SearchResult] = []
        manual_steps = []
        for step in plan:
            if step["action"] == "search":
                step["status"] = "running"
                task.plan = [dict(s) for s in plan]
                all_results.extend(await self.researcher.run_step(db, task, step))
            elif step["action"] == "browse":
                c = registry.get(step["connector_id"])
                q = SearchQuery(**{k: v for k, v in (step.get("query") or {}).items() if k in SearchQuery.__dataclass_fields__})
                step["status"] = "manual"
                if c:
                    ctx = step_context(c, q)
                    step["result"] = {**ctx, "status": "manual", "count": 0, "results": [],
                                      "message": f"{c.capabilities.name} ne permet pas la recherche automatique : l'IA n'a rien consulté ici. "
                                                 "Ouvrez le lien pour chercher vous-même, puis importez l'acte trouvé."}
                else:
                    step["result"] = {"browse_url": None, "status": "error", "message": "Service d'archives inconnu."}
                manual_steps.append(step)
            elif step["action"] == "ask":
                step["status"] = "done"
                ask(db, title=f"Quel est le nom de famille de {person.display_name()} ?",
                    problem="Sans patronyme, aucune recherche nominative n'est possible.", person_id=person.id,
                    task_id=task.id, priority=90, dedupe_key=f"{person.id}:surname")
            task.plan = [dict(s) for s in plan]  # nouvelle liste : SQLAlchemy ne détecte pas les mutations JSON en place
            db.commit()
        evaluations = self.verifier.evaluate(db, task, person, all_results) if all_results else []
        for step in plan:
            if step["action"] == "compare":
                step["status"] = "done" if all_results else "skipped"
                step["result"] = {"evaluated": len(evaluations)} if all_results else {"note": "aucun résultat à comparer"}
            elif step["action"] == "record" and step["status"] == "pending":
                step["status"] = "done" if evaluations else "skipped"
        task.plan = [dict(s) for s in plan]
        self._record_outcome(db, task, person, evaluations, manual_steps, mode)
        # Mémoire : statut de recherche par type sur la personne
        rs = dict(person.research_status or {})
        rs[task.task_type] = {"last": utcnow().isoformat(), "results": len(all_results),
                              "best": evaluations[0]["target"]["total"] if evaluations else None, "task_id": task.id}
        person.research_status = rs
        db.flush()

    # ---- décisions ----
    def _record_outcome(self, db: Session, task: ResearchTask, person: Person, evaluations: list[dict],
                        manual_steps: list[dict], mode: int) -> None:
        strong = [e for e in evaluations if e["target"]["level"] == "green" and not e["other_matches"]]
        ambiguous = [e for e in evaluations if e["target"]["level"] in ("green", "orange") and e["other_matches"]]
        plausible = [e for e in evaluations if e["target"]["level"] == "orange" and not e["other_matches"]]
        task.result = {"results": sum(1 for _ in evaluations), "strong": len(strong), "ambiguous": len(ambiguous),
                       "plausible": len(plausible), "manual_sites": [s["result"].get("browse_url") for s in manual_steps]}
        # Hypothèses concurrentes pour tout résultat plausible (jamais supprimées automatiquement — RÈGLE 9)
        for e in strong + ambiguous + plausible:
            r = e["result"]
            h = Hypothesis(kind="identity_match", title=f"{r['title']} correspond à {person.display_name()} ?",
                           description=r.get("snippet"), subject_person_id=person.id, candidate=r,
                           evidence=[{"connector_id": r["connector_id"], "url": r.get("url"), "note": "résultat de recherche"}],
                           score=e["target"]["total"], score_details=e["target"], created_by=f"agent:{self.name}",
                           task_id=task.id, group_key=f"{task.task_type}:{person.id}")
            db.add(h)
        db.flush()
        self._auto_archive(db, task, person, strong + plausible + ambiguous)
        if ambiguous:
            top = ambiguous[0]
            others = ", ".join(db.get(Person, m["person_id"]).display_name() for m in top["other_matches"] if db.get(Person, m["person_id"]))
            ask(db, title=f"Plusieurs personnes correspondent à « {top['result']['title']} ». Est-ce bien {person.display_name()} ?",
                problem=f"Le résultat est compatible avec {person.display_name()} mais aussi avec : {others}.",
                person_id=person.id, task_id=task.id, known_facts=[c["detail"] for c in top["target"]["criteria"]],
                hypotheses=[{"label": person.display_name(), "score": top["target"]["total"]}] +
                           [{"label": db.get(Person, m["person_id"]).display_name(), "score": m["total"]} for m in top["other_matches"] if db.get(Person, m["person_id"])],
                documents=[{"title": top["result"]["title"], "url": top["result"].get("url")}],
                impact="Évite de confondre deux homonymes ; conditionne l'enregistrement de la source.", priority=85,
                dedupe_key=f"{person.id}:ambiguous:{top['result'].get('url')}")
            decide(db, self.name, "Homonymes détectés : aucune attribution automatique, question posée.", {"count": len(ambiguous)}, task.id)
        if strong:
            top = strong[0]
            if mode == 3:
                self._record_source(db, task, person, top)
                decide(db, self.name, "Mode autonome : correspondance verte sans homonyme → source enregistrée.",
                       {"score": top["target"]["total"]}, task.id)
            else:
                ask(db, title=f"Confirmer : « {top['result']['title']} » concerne {person.display_name()} ?",
                    problem="La correspondance est forte ; en mode assisté/semi-autonome, votre validation est requise avant enregistrement.",
                    person_id=person.id, task_id=task.id, known_facts=[c["detail"] for c in top["target"]["criteria"]],
                    documents=[{"title": top["result"]["title"], "url": top["result"].get("url")}],
                    impact="Ajoute une source sourcée et met à jour les dates/lieux.", priority=75,
                    dedupe_key=f"{person.id}:confirm:{top['result'].get('url')}")
        elif plausible and not ambiguous:
            top = plausible[0]
            ask(db, title=f"Piste plausible : « {top['result']['title']} ». S'agit-il de {person.display_name()} ?",
                problem="Certains critères concordent mais la preuve est insuffisante.", person_id=person.id, task_id=task.id,
                known_facts=[c["detail"] for c in top["target"]["criteria"]],
                documents=[{"title": top["result"]["title"], "url": top["result"].get("url")}],
                impact="Permet de rechercher une source indépendante avant enregistrement.", priority=60,
                dedupe_key=f"{person.id}:plausible:{top['result'].get('url')}")
        if manual_steps and not evaluations:
            urls = [s["result"].get("browse_url") for s in manual_steps if s["result"].get("browse_url")]
            names = [registry.get(s["connector_id"]).capabilities.name for s in manual_steps if registry.get(s["connector_id"])]
            ask(db, title=f"Consulter manuellement {len(manual_steps)} service(s) d'archives pour {person.display_name()} ?",
                problem="Ces services n'autorisent pas la recherche automatisée. L'application a préparé les liens ; "
                        "importez ensuite l'image de l'acte pour analyse.",
                person_id=person.id, task_id=task.id, documents=[{"title": n, "url": u} for n, u in zip(names, urls)],
                impact="Seule voie d'accès aux registres de ce territoire.", priority=55,
                dedupe_key=f"{person.id}:manual:{task.task_type}")
        if not evaluations and not manual_steps:
            log(db, f"Aucun résultat exploitable pour {person.display_name()} ; piste conservée pour réévaluation.",
                category="result", level="warning", task_id=task.id, person_id=person.id)

    ARCHIVABLE = {"gallica", "internet_archive", "openarch", "uk_tna_discovery", "francearchives", "insee_deces", "antenati",
                  "szukajwarchiwach", "geneteka"}

    def _auto_archive(self, db: Session, task: ResearchTask, person: Person, evaluations: list[dict], limit: int = 2) -> None:
        """Archive dans l'application les documents en ligne des meilleures pistes (copie de travail, jamais une preuve en soi)."""
        if not cfg.get(db, "auto_archive", True):
            return
        from ..services.web_archive import ArchiveRefused, archive_url

        archived = []
        for e in evaluations:
            r = e["result"]
            if len(archived) >= limit or not r.get("url") or r.get("connector_id") not in self.ARCHIVABLE:
                continue
            if e["target"]["total"] < 50:
                continue
            try:
                medias = archive_url(db, r["url"], person_id=person.id, title=r.get("title"))
                archived.extend(m.id for m in medias)
            except (ArchiveRefused, ValueError) as exc:
                log(db, f"Archivage non effectué pour « {r.get('title')} » : {exc}", category="connector", level="warning",
                    task_id=task.id, person_id=person.id)
            except Exception as exc:  # pragma: no cover - réseau
                log(db, f"Archivage échoué : {exc}", category="error", level="warning", task_id=task.id, person_id=person.id)
        if archived:
            task.result = {**(task.result or {}), "archived_media": archived}

    def _record_source(self, db: Session, task: ResearchTask, person: Person, evaluation: dict) -> Source:
        r = evaluation["result"]
        src = Source(title=r["title"], repository=r.get("repository"), url=r.get("url"), year=r.get("year"),
                     reference=r.get("reference"), register_type=r.get("record_type"), reliability=r.get("reliability", "unknown"),
                     connector_id=r["connector_id"], external_id=r.get("external_id"), consulted_at=utcnow(),
                     extra={"candidate": r.get("candidate"), "match": evaluation["target"]},
                     content_hash=hashlib.sha256((r.get("url") or r["title"]).encode()).hexdigest())
        db.add(src)
        db.flush()
        db.add(Citation(source_id=src.id, target_type="person", target_id=person.id, confidence=evaluation["target"]["level"],
                        excerpt=r.get("snippet"), note=f"Score {evaluation['target']['total']:.0f}% (agent vérificateur)"))
        cand = r.get("candidate") or {}
        if r.get("record_type") == "death" and cand.get("death_year") and not any(e.event_type == "death" for e in person.events):
            ev = add_event(db, person.id, EventIn(event_type="death", date=r.get("date_text") or str(cand["death_year"]),
                                                  place=cand.get("death_place"), confidence="orange"))
            db.add(Citation(source_id=src.id, target_type="event", target_id=ev.id, confidence="orange"))
        db.flush()
        log(db, f"Source enregistrée : {src.title}", category="decision", task_id=task.id, person_id=person.id,
            outcome={"source_id": src.id, "url": src.url})
        if isinstance(task.result, dict):
            task.result = {**task.result, "sources_recorded": int(task.result.get("sources_recorded") or 0) + 1}
        if src.url and cfg.get(db, "auto_archive", True):
            from ..services.web_archive import ArchiveRefused, archive_url

            try:
                medias = archive_url(db, src.url, person_id=person.id, source_id=src.id, title=src.title)
                if medias:
                    src.local_copy_path, src.local_copy_allowed = medias[0].id, True
            except (ArchiveRefused, ValueError) as exc:
                log(db, f"Copie locale de la source non effectuée : {exc}", category="connector", level="warning",
                    task_id=task.id, person_id=person.id)
            except Exception:  # pragma: no cover
                pass
        return src

    def _propose_from_extraction(self, db: Session, task: ResearchTask, person: Person, media: Media, analysis: dict, mode: int) -> None:
        persons = analysis.get("extraction", {}).get("persons") or []
        father = next((p for p in persons if p.get("role") == "father"), None)
        mother = next((p for p in persons if p.get("role") == "mother"), None)
        if not (father or mother):
            return
        known = parents_of(db, person.id)
        role_fr = {"father": "père", "mother": "mère"}
        desc = ", ".join(f"{role_fr.get(p.get('role'), p.get('role'))} : {p.get('given_names') or ''} {p.get('surname') or ''}".strip() for p in (father, mother) if p)
        h = Hypothesis(kind="filiation", title=f"Parents de {person.display_name()} d'après le document « {media.title or media.original_filename} »",
                       description=desc, subject_person_id=person.id, candidate={"father": father, "mother": mother, "media_id": media.id},
                       evidence=[{"media_id": media.id, "note": "extraction du document (transcription à vérifier)"}],
                       score=None, status="open", created_by="agent:transcripteur", task_id=task.id,
                       group_key=f"filiation:{person.id}")
        db.add(h)
        db.flush()
        ask(db, title=f"Le document indique comme parents : {desc}. Confirmer pour {person.display_name()} ?",
            problem="Une transcription IA n'est jamais une preuve parfaite : vérifiez l'image avant de valider la filiation.",
            person_id=person.id, task_id=task.id, known_facts=[f"Parents déjà connus : {', '.join(p.display_name() for p, _ in known) or 'aucun'}"],
            hypotheses=[{"label": desc, "hypothesis_id": h.id}], documents=[{"media_id": media.id, "title": media.title}],
            impact="Crée les fiches des parents et la filiation sourcée.", priority=80,
            dedupe_key=f"{person.id}:filiation:{media.id}")


coordinator = CoordinatorAgent()


# ------------------------------------------------------------------ boucle de travail
class ResearchWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop: asyncio.Event | None = None
        self.current_task_id: str | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stop = asyncio.Event()  # lié à la boucle courante
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._stop is not None:
            self._stop.set()
        if self._task and not self._task.done():
            try:
                await asyncio.wait_for(self._task, timeout=10)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
        self._task = None

    async def _loop(self) -> None:
        assert self._stop is not None
        while not self._stop.is_set():
            try:
                worked = await self.run_once()
            except Exception:  # pragma: no cover
                logger.exception("Erreur du moteur de recherche")
                worked = False
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=1.0 if worked else 5.0)
            except asyncio.TimeoutError:
                pass

    async def run_once(self) -> bool:
        with session_scope() as db:
            if cfg.get(db, "research_pause", False):
                return False
            task = db.execute(select(ResearchTask).where(ResearchTask.status == "queued")
                              .order_by(ResearchTask.priority.desc(), ResearchTask.created_at.asc())).scalars().first()
            if task is None:
                return False
            task.status = "running"
            task.started_at = utcnow()
            task.attempts += 1
            tid = task.id
            self.current_task_id = tid
            notify({"type": "task", "id": tid, "status": "running", "title": task.title})
        try:
            with session_scope() as db:
                task = db.get(ResearchTask, tid)
                await coordinator.execute(db, task)
                task.status = "done"
                task.finished_at = utcnow()
                run_consistency(db)
                recompute_all(db)
                log(db, f"Tâche terminée : {task.title}", category="decision", task_id=tid, person_id=task.person_id)
                notify({"type": "task", "id": tid, "status": "done", "title": task.title})
        except Exception as exc:
            logger.exception("Tâche %s en échec", tid)
            with session_scope() as db:
                task = db.get(ResearchTask, tid)
                task.last_error = str(exc)
                task.status = "queued" if task.attempts < 3 else "failed"
                task.finished_at = utcnow()
                log(db, f"Échec de « {task.title} » : {exc}" + (" — nouvelle tentative plus tard." if task.status == "queued" else ""),
                    category="error", level="error", task_id=tid, person_id=task.person_id)
                notify({"type": "task", "id": tid, "status": task.status, "title": task.title})
        finally:
            self.current_task_id = None
        return True


worker = ResearchWorker()


async def run_budget(budget_seconds: float = 50.0, max_tasks: int = 10) -> dict:
    """Exécute des tâches en file pendant un budget de temps (mode hébergé sans processus permanent).

    Un verrou en base évite deux exécutions simultanées (navigateur + tâche planifiée).
    """
    import time

    from ..models import Setting

    lock_key = "research_run_lock"
    now = datetime.utcnow()
    with session_scope() as db:
        row = db.get(Setting, lock_key)
        if row and row.value and (now - datetime.fromisoformat(row.value)).total_seconds() < budget_seconds + 30:
            return {"ran": 0, "locked": True}
        if row is None:
            db.add(Setting(key=lock_key, value=now.isoformat()))
        else:
            row.value = now.isoformat()
    ran = 0
    start = time.monotonic()
    try:
        while ran < max_tasks and time.monotonic() - start < budget_seconds:
            if not await worker.run_once():
                break
            ran += 1
    finally:
        with session_scope() as db:
            row = db.get(Setting, lock_key)
            if row:
                row.value = None
    return {"ran": ran, "locked": False, "elapsed": round(time.monotonic() - start, 1)}


def explore_branch(db: Session, person_id: str, generations: int = 3, priority: int = 60) -> list[ResearchTask]:
    """Planifie l'exploration ascendante : naissance → parents → mariage des parents, sans favoriser une branche."""
    person = db.get(Person, person_id)
    if not person:
        return []
    tasks = []
    frontier = [(person, 0)]
    while frontier:
        p, depth = frontier.pop(0)
        if depth > generations:
            continue
        pars = parents_of(db, p.id)
        has_birth = any(e.event_type in ("birth", "baptism") and e.sort_year for e in p.events)
        if not has_birth:
            tasks.append(enqueue(db, "find_birth", p.id, priority=priority - depth * 2))
        if len(pars) < 2:
            tasks.append(enqueue(db, "find_parents", p.id, priority=priority - depth * 2 - 1))
        if len(pars) == 2 and not any(e.event_type == "marriage" for pp, _ in pars for e in pp.events):
            tasks.append(enqueue(db, "find_marriage", pars[0][0].id, priority=priority - depth * 2 - 2))
        # Branches paternelle et maternelle traitées à égalité (même priorité)
        for pp, _ in pars:
            frontier.append((pp, depth + 1))
    return tasks
