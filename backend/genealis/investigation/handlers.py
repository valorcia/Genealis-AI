"""Gestionnaires des tâches serveur du Director (un par `kind`, contrat docs/ARCHITECTURE_V04.md §4).

Chaque gestionnaire reçoit (db, enquête, tâche) et renvoie (result, status) avec status ∈ done | to_verify | blocked.
Un `QuotaExceeded` n'est JAMAIS intercepté ici : il remonte jusqu'à `director.step`, qui bloque l'enquête.
Les tâches `browse` (worker navigateur local) et `human_assist` (utilisateur) ne sont pas exécutées par le serveur.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any, Callable

from sqlalchemy.orm import Session

from ..ai.errors import AIUnavailable, ExternalTransferRefused, QuotaExceeded
from ..models import DocumentReading, Hypothesis, Investigation, InvestigationTask, Media, Person, PersonMention
from ..services import privacy
from ..services import settings_service as cfg
from . import memory, network, queue, strategy, verification

logger = logging.getLogger("genealis.director")

LINEAL = ("biological", "uncertain", "legal", "adoptive")
ARCHIVE_HINTS = ("archives", "francearchives", "antenati", "geneteka", "matricula", "szukajwarchiwach", "arch.be",
                 "memoiredeshommes", "openarch", "gallica", "familysearch.org/ark")
DOC_TYPES = ("birth", "baptism", "marriage", "death", "burial", "census", "military", "other")
CONFIDENCE_NUM = {"high": 0.9, "medium": 0.6, "low": 0.3}
MAX_BROWSE_PER_SEARCH = 3

Result = tuple[dict, str]


# ------------------------------------------------------------------ outils
def run_async(coro, timeout: float = 30.0) -> Any:
    """Exécute une coroutine depuis du code synchrone, même si une boucle tourne déjà (API asynchrone)."""
    async def guarded():
        return await asyncio.wait_for(coro, timeout)

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(guarded())
    box: dict = {}

    def target():
        try:
            box["v"] = asyncio.run(guarded())
        except BaseException as exc:  # pragma: no cover - transmis à l'appelant
            box["e"] = exc

    th = threading.Thread(target=target, daemon=True)
    th.start()
    th.join(timeout + 5)
    if "e" in box:
        raise box["e"]
    return box.get("v")


def person_brief(db: Session, p: Person | None) -> dict | None:
    """Personne transmise au worker navigateur : JAMAIS une personne peut-être vivante."""
    if p is None or privacy.is_possibly_living(db, p.id):
        return None
    by = next((e.sort_year for e in p.events if e.event_type in ("birth", "baptism") and e.sort_year), None)
    place = next(((e.place.name if e.place else e.place_original) for e in p.events if e.place or e.place_original), None)
    return {"given_names": p.given_names, "surname": p.surname, "birth_year": by, "place": place}


def structured_query(db: Session, task: InvestigationTask, person: Person | None):
    from ..agents.planner import build_query, person_facts
    from ..connectors.base import SearchQuery

    p = task.params or {}
    reg = p.get("register_type") or "any"
    if person is not None:
        q = build_query(person, reg if reg != "parents" else "birth")
        q.extra = {**q.extra, **person_facts(db, person)}
        return q
    s = p.get("structured") or {}
    return SearchQuery(surname=s.get("surname"), given_names=s.get("given_names"), year_from=s.get("year_from"),
                       year_to=s.get("year_to"), commune=s.get("commune"), department=s.get("department"),
                       register_type=reg if reg in ("birth", "marriage", "death", "census", "military") else "any",
                       extra={"country": s.get("country") or "FR"})


def compact(r) -> dict:
    from .strategy import domain_of

    return {"title": r.title, "url": r.url, "snippet": r.snippet, "domain": domain_of(r.url) or r.repository,
            "record_type": r.record_type, "year": r.year, "place": r.place, "reliability": r.reliability,
            "connector_id": r.connector_id, "candidate": r.candidate or {}, "archival_reference": r.reference}


# ------------------------------------------------------------------ plan
def handle_plan(db: Session, inv: Investigation, task: InvestigationTask) -> Result:
    from .director import plan_person

    person = db.get(Person, task.person_id or inv.person_id or "")
    if person is None:
        return {"created": [], "note": "Personne introuvable."}, "done"
    created = plan_person(db, inv, person, generation=task.generation, parent_task_id=task.id)
    return {"created": [t.id for t in created]}, "done"


# ------------------------------------------------------------------ web_search
def _free_connectors(db: Session, inv: Investigation, task: InvestigationTask, sq, label: str) -> tuple[list[dict], list[str]]:
    findings, sites = [], []
    for c in strategy.free_connectors(db, sq):
        key = f"{c.id}:{label}"
        if memory.query_done(inv, key, "free_connectors"):
            prev = memory.result_for(inv, key, "free_connectors") or {}
            findings += prev.get("findings") or []
            continue
        try:
            results = run_async(c.search(sq), timeout=25)
        except QuotaExceeded:
            raise
        except Exception as exc:
            from ..connectors.base import AccessRestricted

            outcome = "restricted" if isinstance(exc, AccessRestricted) else "error"
            memory.record_query(inv, key, strategy="free_connectors", task_id=task.id, outcome=outcome)
            memory.record_failure(inv, c.capabilities.name, str(exc) or outcome, task.id)
            queue.emit(db, inv.id, "search", f"{c.capabilities.name} : aucune réponse exploitable ({str(exc)[:160]}).",
                       {"connector_id": c.id, "outcome": outcome}, task.id)
            continue
        found = [compact(r) for r in results or []][:30]
        memory.record_query(inv, key, strategy="free_connectors", task_id=task.id, outcome="ok" if found else "no_result",
                            count=len(found))
        memory.record_result(inv, key, "free_connectors", found)
        memory.record_site(inv, strategy.domain_of(c.capabilities.homepage))
        sites.append(c.capabilities.name)
        queue.emit(db, inv.id, "search", f"{c.capabilities.name} interrogé : {len(found)} résultat(s).",
                   {"connector_id": c.id, "count": len(found)}, task.id)
        findings += found
    return findings, sites


def _gemini_search(db: Session, inv: Investigation, task: InvestigationTask, sq, label: str) -> tuple[list[dict], dict]:
    from ..ai.providers import AIClient
    from ..connectors import gemini_web

    if memory.query_done(inv, label, "web_search"):
        prev = memory.result_for(inv, label, "web_search") or {}
        queue.emit(db, inv.id, "search", f"Recherche déjà faite (mémoire de l'enquête) : « {label} » — non relancée.",
                   {"reused": True}, task.id)
        return list(prev.get("findings") or []), {"queries": prev.get("queries") or [], "sources": prev.get("sources") or [],
                                                  "reused": True}
    resp = AIClient(db).complete(gemini_web.SYSTEM, gemini_web.build_prompt(sq), purpose=f"recherche web {sq.surname or ''}"[:64],
                                 personal=True, max_tokens=3000, web_search=True,
                                 subject_person_ids=[task.person_id] if task.person_id else None)
    g = resp.grounding or {}
    grounding = {"queries": list(g.get("queries") or []), "sources": list(g.get("sources") or []),
                 "supports": list(g.get("supports") or [])}
    try:
        data = resp.json()
    except ValueError:
        data = None
    results, traced = gemini_web.map_findings(data, grounding)
    found = [compact(r) for r in results][:30]
    srcs = [{"title": s.get("title"), "url": s.get("url"), "domain": s.get("domain")} for s in grounding["sources"]][:30]
    memory.record_query(inv, label, strategy="web_search", task_id=task.id, outcome="ok" if found else "no_result", count=len(found))
    memory.record_result(inv, label, "web_search", found, {"queries": grounding["queries"][:10], "sources": srcs})
    for s in srcs:
        memory.record_site(inv, s.get("domain"))
    notes = len([t for t in traced if not t.get("kept")])
    queue.emit(db, inv.id, "search", f"Recherche web Gemini : {len(grounding['queries'])} requête(s) Google, {len(srcs)} page(s) "
                                     f"consultée(s), {len(found)} piste(s) vérifiable(s)"
                                     + (f", {notes} indication(s) sans page vérifiable écartée(s)" if notes else "") + ".",
               {"queries": grounding["queries"][:10], "count": len(found), "cached": resp.cached}, task.id)
    return found, {"queries": grounding["queries"], "sources": srcs}


def _is_document_lead(f: dict) -> bool:
    url = (f.get("url") or "").lower()
    return bool(url) and (f.get("record_type") in DOC_TYPES[:-1] or any(h in url for h in ARCHIVE_HINTS)) \
        and f.get("reliability") != "derivative"


def enqueue_browse(db: Session, inv: Investigation, task: InvestigationTask, *, url: str | None, goal: str, person: Person | None,
                   query: str | None = None, priority: int = 50, previous: str | None = None, extra: dict | None = None) -> InvestigationTask:
    if url:  # une même page n'est jamais ouverte deux fois dans une enquête
        for t in db.query(InvestigationTask).filter(InvestigationTask.investigation_id == inv.id,
                                                    InvestigationTask.kind.in_(("browse", "human_assist")),
                                                    InvestigationTask.status != "cancelled").all():
            if url in ((t.params or {}).get("start_url"), (t.params or {}).get("url")):
                return t
    choice = strategy.for_browse(db, inv, url, previous=previous)
    dom = strategy.domain_of(url)
    if choice.kind == "human_assist":
        t, created = queue.enqueue(db, inv.id, "human_assist", f"À faire par vous : {goal}"[:512], person_id=task.person_id,
                                   params={"reason": choice.reason, "url": url, "goal": goal}, priority=priority,
                                   strategy="human", generation=task.generation, parent_task_id=task.id)
        if created:
            queue.emit(db, inv.id, "human", f"Assistance demandée : {goal} — {choice.reason}", {"task_id": t.id, "url": url}, task.id)
        return t
    params = {"goal": goal, "start_url": url, "query": query, "allowed_domains": [dom] if dom else [],
              "max_steps": int(cfg.get(db, "browser_max_steps", 25) or 25), "expect": "documents",
              "person": person_brief(db, person), "strategy_hint": choice.strategy, **(extra or {})}
    params = {k: v for k, v in params.items() if v is not None}
    t, created = queue.enqueue(db, inv.id, "browse", f"Ouvrir : {goal}"[:512], person_id=task.person_id, params=params,
                               priority=priority, strategy=choice.strategy, generation=task.generation, parent_task_id=task.id)
    if created:
        queue.emit(db, inv.id, "plan", f"Navigation confiée au worker local ({choice.strategy}) : {goal}.",
                   {"task_id": t.id, "url": url, "strategy": choice.strategy}, task.id)
    return t


def handle_web_search(db: Session, inv: Investigation, task: InvestigationTask) -> Result:
    from ..models import Hypothesis as H
    from ..services.matching import Candidate, score_candidate

    p = task.params or {}
    person = db.get(Person, task.person_id) if task.person_id else None
    if person is not None and privacy.protection_active(db) and privacy.is_possibly_living(db, person.id):
        return {"findings": [], "note": "Personne peut-être vivante : aucune recherche externe n'est faite à son sujet."}, "done"
    sq = structured_query(db, task, person)
    label = p.get("query") or " ".join(x for x in (sq.given_names, sq.surname, sq.register_type) if x)
    findings, sites = _free_connectors(db, inv, task, sq, label)
    trace: dict = {"queries": [], "sources": []}
    choice = strategy.for_search(db, inv)
    if choice.strategy == "web_search":
        try:
            g_found, trace = _gemini_search(db, inv, task, sq, label)
            findings += g_found
        except ExternalTransferRefused as exc:
            memory.record_failure(inv, "Recherche web IA", str(exc), task.id)
            queue.emit(db, inv.id, "info", f"Recherche web IA non envoyée : {exc}", {}, task.id)
        except QuotaExceeded:
            raise
        except AIUnavailable as exc:
            memory.record_query(inv, label, strategy="web_search", task_id=task.id, outcome="error")
            memory.record_failure(inv, "Recherche web IA", str(exc), task.id)
            queue.emit(db, inv.id, "error", f"Recherche web IA impossible : {exc}", {}, task.id)
    else:
        queue.emit(db, inv.id, "info", f"Stratégie : {choice.reason}", {"strategy": choice.strategy}, task.id)
    # Dédoublonnage des pistes par adresse
    seen, uniq = set(), []
    for f in findings:
        k = (f.get("url") or f.get("title") or "").lower()
        if k and k not in seen:
            seen.add(k)
            uniq.append(f)
    findings = uniq
    hyp_ids, browse_ids = [], []
    if person is not None:
        for f in findings:
            cand = f.get("candidate") or {}
            if not (cand.get("surname") or cand.get("given_names")):
                continue
            r = score_candidate(db, Candidate.from_dict(cand), person)
            if r.blocking or r.level not in ("green", "orange"):
                continue
            exists = db.query(H).filter(H.subject_person_id == person.id, H.kind == "identity_match").all()
            if any((h.candidate or {}).get("url") == f.get("url") for h in exists):
                continue
            h = H(kind="identity_match", title=f"{f['title']} — correspond à {person.display_name()} ?"[:512],
                  description=f.get("snippet"), subject_person_id=person.id, candidate=f,
                  evidence=[{"url": f.get("url"), "connector_id": f.get("connector_id"),
                             "note": "résultat de recherche (piste, jamais une preuve)", "reliability": f.get("reliability")}],
                  score=r.total, score_details={**r.to_dict(), "status_label": "À VÉRIFIER",
                                                "warnings": ["Page web : à confirmer par l'acte original."]},
                  status="open", created_by="agent:director", task_id=task.id,
                  group_key=f"identity:{person.id}:{p.get('register_type') or 'any'}")
            db.add(h)
            db.flush()
            memory.record_hypothesis(inv, h.id, h.title)
            hyp_ids.append(h.id)
    leads = [f for f in findings if _is_document_lead(f)][:MAX_BROWSE_PER_SEARCH]
    for f in leads:
        t = enqueue_browse(db, inv, task, url=f["url"], goal=f"{f['title']}"[:300], person=person, query=label,
                           priority=max(10, task.priority - 5),
                           extra={"archival_reference": f.get("archival_reference"), "finding_title": f.get("title")})
        browse_ids.append(t.id)
    if not findings and strategy.browser_enabled(db):
        from ..connectors.gemini_web import DEPARTMENT_ARCHIVES

        dep = sq.department
        if dep in DEPARTMENT_ARCHIVES:
            name, dom = DEPARTMENT_ARCHIVES[dep]
            t = enqueue_browse(db, inv, task, url=f"https://{dom}", priority=max(10, task.priority - 10), person=person, query=label,
                               goal=f"Archives départementales {name} : chercher dans l'état civil numérisé — {label}")
            browse_ids.append(t.id)
    if not findings:
        memory.record_failure(inv, label, "Aucune piste trouvée par les stratégies serveur.", task.id)
    status = "done"
    result = {"findings": findings, "queries": trace.get("queries") or [], "sources": trace.get("sources") or [],
              "connectors": sites, "strategy": choice.strategy, "hypotheses": hyp_ids, "browse_tasks": browse_ids,
              "reused": bool(trace.get("reused"))}
    return result, status


# ------------------------------------------------------------------ analyze_document
def mentions_from_analysis(db: Session, media: Media, investigation_id: str | None) -> list[PersonMention]:
    """Repli sans module paléographique : extraction de `media.analysis` → mentions (jamais fusionnées)."""
    from ..services.interpret import _excerpt, extract_people

    a = media.analysis or {}
    ex = a.get("extraction") or {}
    transcription = a.get("transcription") or media.ocr_text or ""
    doc = ex.get("document_type") or "other"
    out = []
    for p in extract_people(ex):
        role, to_role, stated = p.get("role") or "other", None, p.get("relation")
        if doc == "marriage":
            role, to_role = {"subject": ("groom", None), "spouse": ("bride", None), "father": ("father", "groom"),
                             "mother": ("mother", "groom"), "spouse_father": ("father", "bride"),
                             "spouse_mother": ("mother", "bride")}.get(role, (role, None))
        elif role in ("father", "mother"):
            to_role = "deceased" if doc in ("death", "burial") else "subject"
        elif role in ("spouse_father", "spouse_mother"):
            role, to_role = ("father" if role == "spouse_father" else "mother"), "spouse"
        if role in ("head_of_household", "household_member"):
            stated = stated or ("chef de ménage" if role == "head_of_household" else None)
            role = "subject" if role == "head_of_household" else "other"
        if role not in ("subject", "father", "mother", "spouse", "groom", "bride", "witness", "godfather", "godmother",
                        "declarant", "officiant", "deceased", "informant", "neighbour", "other"):
            role = "other"
        name = " ".join(x for x in (p.get("given_names"), p.get("surname")) if x) or "?"
        m = PersonMention(media_id=media.id, source_id=media.source_id, investigation_id=investigation_id, name_original=name[:512],
                          given_names=p.get("given_names"), surname=p.get("surname"), sex=p.get("sex"), role=role,
                          stated_relation=stated, relation_to_role=to_role,
                          age_stated=str(p["age"]) if p.get("age") is not None else None, occupation=p.get("occupation"),
                          residence=p.get("residence"), excerpt=_excerpt(transcription, p.get("surname"), p.get("given_names"), width=90),
                          reading_confidence=CONFIDENCE_NUM.get(p.get("confidence") or "medium", 0.6))
        network.apply_parsed(m)
        db.add(m)
        out.append(m)
    db.flush()
    return out


def ensure_ai_allowed(db: Session, purpose: str) -> None:
    """Contrôle des plafonds AVANT la lecture : l'analyse v0.3 convertit les refus en simples avertissements, or un quota
    atteint doit bloquer l'enquête (QuotaExceeded remonte jusqu'au Director ; rien n'est envoyé)."""
    from ..ai.providers import AIClient
    from ..services import cost

    ai = AIClient(db)
    if ai.available() and ai.provider in ("gemini", "anthropic", "ollama"):
        cost.check_allowed(db, ai.provider, ai._model_name(), purpose)


def read_media(db: Session, inv: Investigation, media: Media, *, force: bool = False) -> tuple[str | None, list[PersonMention], dict, str, str]:
    """Lecture (module paléographique si présent, sinon analyse v0.3) → (reading_id, mentions, extraction, transcription, langue)."""
    existing = db.query(PersonMention).filter(PersonMention.media_id == media.id).all()
    reading = (db.query(DocumentReading).filter(DocumentReading.media_id == media.id)
               .order_by(DocumentReading.version.desc()).first())
    if existing and not force:
        if reading is not None:
            return reading.id, existing, dict(reading.extraction or {}), reading.diplomatic or reading.normalized or "", reading.language or "?"
        a = media.analysis or {}
        return None, existing, dict(a.get("extraction") or {}), a.get("transcription") or media.ocr_text or "", a.get("language") or "?"
    try:
        from ..paleo.mentions import mentions_from_reading
        from ..paleo.pipeline import read_document
    except ImportError:
        read_document = None  # type: ignore[assignment]
    if read_document is not None:
        if reading is None or force:
            ensure_ai_allowed(db, f"lecture document {media.id}")
            reading = read_document(db, media)
        mentions = list(mentions_from_reading(db, reading, investigation_id=inv.id) or [])
        ex = dict(reading.extraction or {})
        if not ex.get("document_type") and media.analysis:
            ex = {**((media.analysis or {}).get("extraction") or {}), **ex}
        return reading.id, mentions, ex, reading.diplomatic or reading.normalized or "", reading.language or "?"
    from ..ai.documents import analyze_media

    a = media.analysis or {}
    if force or media.analysis_status != "done" or not (a.get("extraction") or {}).get("persons"):
        ensure_ai_allowed(db, f"lecture document {media.id}")
        res = analyze_media(db, media)
        if not res.transcription and not res.extraction.get("persons"):
            raise AIUnavailable("; ".join(res.warnings) or "Document illisible : aucune transcription obtenue.")
        media.ocr_text = res.transcription
        media.language = res.language if res.language != "?" else media.language
        media.analysis = {**(media.analysis or {}), **res.to_dict()}
        media.analysis_status = "done"
        db.flush()
    a = media.analysis or {}
    mentions = existing if existing and not force else mentions_from_analysis(db, media, inv.id)
    return None, mentions, dict(a.get("extraction") or {}), a.get("transcription") or "", a.get("language") or "?"


FOLLOW_ROLES = ("witness", "godfather", "godmother", "declarant", "informant", "neighbour")


def handle_analyze_document(db: Session, inv: Investigation, task: InvestigationTask) -> Result:
    p = task.params or {}
    media = db.get(Media, p.get("media_id") or "")
    if media is None:
        return {"blocked_reason": "Document introuvable dans l'application.", "needs_human": False}, "blocked"
    if media.person_id and privacy.protection_active(db) and privacy.is_possibly_living(db, media.person_id):
        return {"blocked_reason": privacy.REFUSAL, "needs_human": True}, "blocked"
    # Pas de pré-contrôle ici : si un plafond est atteint, AIClient lève QuotaExceeded AVANT tout envoi et le Director
    # bloque l'enquête (raison visible, reprise possible).
    queue.emit(db, inv.id, "document", f"Lecture du document « {media.title or media.original_filename} ».", {"media_id": media.id}, task.id)
    try:
        reading_id, mentions, ex, transcription, lang = read_media(db, inv, media, force=bool(p.get("_force")))
    except ExternalTransferRefused as exc:
        return {"blocked_reason": str(exc), "needs_human": True}, "blocked"
    except QuotaExceeded:
        raise
    except AIUnavailable as exc:
        memory.record_failure(inv, f"lecture {media.id}", str(exc), task.id)
        return {"blocked_reason": f"Lecture impossible : {exc}", "needs_human": True}, "blocked"
    source = verification.ensure_source(db, inv, media, extraction=ex, transcription=transcription, url=p.get("url"),
                                        archival_reference=p.get("archival_reference"), reading_id=reading_id,
                                        language=lang)
    for m in mentions:
        if m.investigation_id is None:
            m.investigation_id = inv.id
        m.source_id = m.source_id or source.id
        network.apply_parsed(m)
    db.flush()
    verification.match_mentions(db, mentions, ex)  # comparer les personnes (candidats seulement)
    memory.record_document(inv, media.id, url=p.get("url") or source.url, archival_reference=source.reference, status="analyzed")
    roles = {}
    for m in mentions:
        roles[m.role] = roles.get(m.role, 0) + 1
    queue.emit(db, inv.id, "analysis", f"Acte lu ({ex.get('document_type') or 'type inconnu'}) : {len(mentions)} personne(s) citée(s) "
                                       f"— " + ", ".join(f"{n} {r}" for r, n in roles.items()) + ". Source : " + source.title,
               {"media_id": media.id, "source_id": source.id, "mentions": [m.id for m in mentions]}, task.id)
    person_id = task.person_id or media.person_id or p.get("person_id")
    created = []
    if person_id and mentions:
        t, _ = queue.enqueue(db, inv.id, "verify", "Vérifier l'identité et la filiation d'après l'acte", person_id=person_id,
                             params={"mention_ids": sorted(m.id for m in mentions), "person_id": person_id, "media_id": media.id},
                             priority=75, generation=task.generation, parent_task_id=task.id)
        created.append(t.id)
    for m in mentions:
        if m.stated_relation or m.role in FOLLOW_ROLES:
            t, _ = queue.enqueue(db, inv.id, "witness_followup", f"Réseau : {network.full_name(m)} ({m.stated_relation or m.role})",
                                 person_id=None, params={"mention_id": m.id}, priority=45, generation=task.generation,
                                 parent_task_id=task.id)
            created.append(t.id)
    return {"reading_id": reading_id, "mentions": [m.id for m in mentions], "source_id": source.id, "created": created}, "done"


# ------------------------------------------------------------------ verify
def _extraction_for(db: Session, mentions: list[PersonMention]) -> dict:
    m = mentions[0]
    if m.reading_id:
        r = db.get(DocumentReading, m.reading_id)
        if r is not None and r.extraction:
            ex = dict(r.extraction)
            med = db.get(Media, r.media_id)
            if not ex.get("document_type") and med is not None:
                ex = {**((med.analysis or {}).get("extraction") or {}), **ex}
            return ex
    med = db.get(Media, m.media_id or "")
    return dict(((med.analysis or {}).get("extraction") or {}) if med else {})


def handle_verify(db: Session, inv: Investigation, task: InvestigationTask) -> Result:
    from ..models import Source

    p = task.params or {}
    person = db.get(Person, p.get("person_id") or task.person_id or "")
    mentions = [m for m in (db.get(PersonMention, i) for i in p.get("mention_ids") or []) if m is not None]
    if person is None or not mentions:
        return {"proposals": [], "note": "Rien à vérifier."}, "done"
    source = db.get(Source, mentions[0].source_id or "")
    if source is None:
        return {"proposals": [], "note": "Source absente : la vérification attend la lecture du document."}, "to_verify"
    res = verification.evaluate_document(db, inv, person, mentions, source, _extraction_for(db, mentions), task)
    recorded = any(x.get("kind") == "filiation" and x.get("recorded") for x in res["proposals"])
    proposed_with_proof = bool(res.get("assessment", {}).get("sufficient"))
    if recorded or proposed_with_proof:
        t, created = queue.enqueue(db, inv.id, "expand_generation", f"Génération précédente — {person.display_name()}",
                                   person_id=person.id, params={"person_id": person.id, "generation": task.generation},
                                   priority=60, generation=task.generation, parent_task_id=task.id)
        res["expand_task_id"] = t.id
    a = res.get("assessment") or {}
    return {"proposals": res["proposals"], "level": a.get("level"), "sufficient": a.get("sufficient"),
            "reasons": a.get("reasons"), "missing": a.get("missing"), "hypothesis_id": res.get("hypothesis_id"),
            "expand_task_id": res.get("expand_task_id")}, res["status"]


# ------------------------------------------------------------------ witness_followup
def handle_witness_followup(db: Session, inv: Investigation, task: InvestigationTask) -> Result:
    m = db.get(PersonMention, (task.params or {}).get("mention_id") or "")
    if m is None:
        return {"note": "Mention introuvable."}, "done"
    return network.followup(db, inv, m, task), "done"


# ------------------------------------------------------------------ expand_generation
def handle_expand_generation(db: Session, inv: Investigation, task: InvestigationTask) -> Result:
    from ..services.persons import parents_of

    p = task.params or {}
    person = db.get(Person, p.get("person_id") or task.person_id or "")
    if person is None:
        return {"created": []}, "done"
    gen = int(p.get("generation", task.generation) or 0)
    nxt = gen + 1
    if nxt > int(inv.max_generations or 0):
        queue.emit(db, inv.id, "info", f"Limite de {inv.max_generations} génération(s) atteinte : les parents de "
                                       f"{person.display_name()} ne sont pas explorés.", {"person_id": person.id}, task.id)
        return {"created": [], "limit_reached": True}, "done"
    if not cfg.get(db, "investigation_auto_continue", True):
        return {"created": [], "note": "Continuation automatique désactivée dans les paramètres."}, "done"
    created = []
    for parent, rel in parents_of(db, person.id):
        if rel.relation_type not in LINEAL:
            continue
        t, new = queue.enqueue(db, inv.id, "plan", f"Planifier les recherches — {parent.display_name()}", person_id=parent.id,
                               params={"generation": nxt}, priority=max(20, 100 - nxt * 10), generation=nxt, parent_task_id=task.id)
        if new:
            created.append(t.id)
            queue.emit(db, inv.id, "plan", f"Génération {nxt} : {parent.display_name()} ({'père' if parent.sex == 'M' else 'mère' if parent.sex == 'F' else 'parent'} "
                                           f"de {person.display_name()}) ajouté(e) à l'enquête.", {"person_id": parent.id}, task.id)
    # Parents seulement proposés (preuve suffisante, en attente de votre validation) : recherche par le nom
    for h in db.query(Hypothesis).filter(Hypothesis.subject_person_id == person.id, Hypothesis.kind == "filiation",
                                         Hypothesis.status == "open").all():
        if (h.score_details or {}).get("proof") != "sufficient":
            continue
        a = (h.candidate or {}).get("assessment") or {}
        year = a.get("year")
        for par in a.get("parents") or []:
            if par.get("action") != "create" or not (par.get("surname") or par.get("given_names")):
                continue
            q = f"{par['name']}, {'père' if par['role'] == 'father' else 'mère'} de {person.display_name()}"
            t, new = queue.enqueue(db, inv.id, "web_search", f"Génération {nxt} (proposée) : {par['name']}", person_id=None,
                                   params={"query": q, "goal": "Naissance et mariage du parent proposé (à valider)",
                                           "hypothesis_id": h.id, "register_type": "any",
                                           "structured": {"given_names": par.get("given_names"), "surname": par.get("surname"),
                                                          "year_from": (year - 60) if year else None,
                                                          "year_to": (year - 14) if year else None,
                                                          "commune": (a.get("place") or "").split(",")[0] or None}},
                                   priority=max(15, 90 - nxt * 10), generation=nxt, parent_task_id=task.id)
            if new:
                created.append(t.id)
    if created:
        inv.current_generation = max(int(inv.current_generation or 0), nxt)
    return {"created": created, "generation": nxt}, "done"


HANDLERS: dict[str, Callable[[Session, Investigation, InvestigationTask], Result]] = {
    "plan": handle_plan,
    "web_search": handle_web_search,
    "analyze_document": handle_analyze_document,
    "verify": handle_verify,
    "witness_followup": handle_witness_followup,
    "expand_generation": handle_expand_generation,
}
SERVER_KINDS = tuple(HANDLERS)
