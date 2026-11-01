"""Exécution d'une tâche `browse` (contrat §5 de docs/ARCHITECTURE_V04.md) : la stratégie la moins chère d'abord.

1. `web_search` : faite par le serveur, jamais ici ;
2. `playwright` : recette déterministe (0 appel IA) dès qu'une adresse de départ existe ;
3. `browser_agent` : Browser Use + Gemini, seulement si la recette n'a rien donné (ou sur demande explicite),
   et seulement si les plafonds le permettent ;
4. `human` : politique « humain uniquement » (CGU), CAPTCHA, connexion, abonnement → pause ; l'utilisateur agit
   lui-même dans une fenêtre visible, puis la tâche reprend (le worker ne saisit jamais d'identifiants).

Limites : nombre d'étapes (`browser_max_steps`), délai global (`browser_task_timeout_s`), nouvelles tentatives sur les
erreurs passagères (`browser_max_retries`), historique de chaque page ouverte (PageVisit via le `Reporter`).
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional, Protocol
from urllib.parse import urlsplit

from .detect import ISSUE_LABELS_FR
from .playwright_driver import DownloadedFile, DownloadRefused, DriverConfig, PageSnapshot, PlaywrightDriver, SafeFetcher
from .security import (SecurityPolicy, check_download, check_url, detect_injection, domain_matches, domain_of,
                       sanitize_page_text, site_policy)

logger = logging.getLogger("genealis.browser.service")

BLOCKING_OUTCOMES = ("captcha", "login_required", "paywall", "blocked_policy", "robots_disallowed")
TRANSIENT_OUTCOMES = ("error", "timeout")
_COTE_RE = re.compile(r"\b(?:cote|segnatura|sygnatura|signatur|shelfmark)\s*[:：]\s*([^\n|;]{2,80})", re.I)


class Reporter(Protocol):
    """Destination des traces (API du serveur pour le worker, base locale pour les tests)."""

    def visit(self, *, url: str, title: str | None, strategy: str, outcome: str, http_status: int | None,
              text_excerpt: str | None, content_hash: str | None, security_flags: list, duration_ms: int | None,
              notes: str | None, screenshot: bytes | None) -> Optional[str]: ...

    def document(self, f: DownloadedFile, page_visit_id: Optional[str]) -> Optional[str]: ...

    def progress(self, message: str) -> None: ...


@dataclass
class HumanRequest:
    issue: str  # captcha | login_required | paywall | blocked_policy | robots_disallowed | human_only
    reason: str
    url: str
    driver: Optional[PlaywrightDriver] = None  # fenêtre visible ouverte sur la page (None si aucune automatisation permise)
    automation_allowed: bool = True


@dataclass
class BrowseEnv:
    settings: dict
    reporter: Reporter
    workdir: Path
    ai: dict = field(default_factory=dict)  # {allowed, max_calls, per_minute, model, reason} calculé par le serveur
    gemini_key: Optional[str] = None  # clé locale du PC (jamais reçue du serveur)
    llm_factory: Optional[Callable[[str], Any]] = None  # tests : modèle simulé
    human_assist: Optional[Callable[[HumanRequest], Awaitable[bool]]] = None
    policy: Optional[SecurityPolicy] = None
    cancel: Optional[asyncio.Event] = None
    headless: Optional[bool] = None
    assist_headless: bool = False  # tests : la « fenêtre visible » reste invisible
    respect_robots: bool = True
    chromium_path: Optional[str] = None


@dataclass
class BrowseOutcome:
    result: dict
    ai_calls: list[dict] = field(default_factory=list)
    ai_refused: Optional[str] = None


class _Blocked(Exception):
    def __init__(self, issue: str, reason: str, url: str, needs_human: bool = True):
        super().__init__(reason)
        self.issue, self.reason, self.url, self.needs_human = issue, reason, url, needs_human


@dataclass
class _State:
    pages: list[str] = field(default_factory=list)
    documents: list[str] = field(default_factory=list)
    doc_hashes: set[str] = field(default_factory=set)
    findings: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    flags: list[dict] = field(default_factory=list)
    history: list[dict] = field(default_factory=list)
    steps: int = 0
    strategy: str = "playwright"
    last_url: Optional[str] = None


def _norm_url(u: str) -> str:
    u = (u or "").split("#")[0]
    return u[:-1] if u.endswith("/") else u


def _in_domains(url: str, domains: list[str]) -> bool:
    host = domain_of(url)
    return any(domain_matches(host, d) for d in domains)


class BrowseRunner:
    def __init__(self, params: dict, env: BrowseEnv):
        self.p = params or {}
        self.env = env
        s = env.settings or {}
        self.s = s
        self.policy = env.policy or SecurityPolicy.from_settings(s)
        self.max_steps = max(1, min(int(self.p.get("max_steps") or s.get("browser_max_steps") or 25),
                                    int(s.get("browser_max_steps") or 25)))
        self.timeout_s = float(s.get("browser_task_timeout_s") or 300)
        self.retries = max(0, int(s.get("browser_max_retries") if s.get("browser_max_retries") is not None else 2))
        self.expect = self.p.get("expect") if self.p.get("expect") in ("documents", "links", "text") else "documents"
        self.max_documents = max(1, min(int(self.p.get("max_documents") or 3), 10))
        from .agent_driver import safe_person

        self.person = safe_person(self.p.get("person"))
        self.goal = sanitize_page_text(self.p.get("goal") or "", 600)
        self.start_url = (self.p.get("start_url") or self.p.get("url") or "").strip() or None
        doms = [domain_of(d) for d in (self.p.get("allowed_domains") or []) if domain_of(d)]
        if self.start_url and domain_of(self.start_url) and domain_of(self.start_url) not in doms:
            doms.insert(0, domain_of(self.start_url))
        doms += [domain_of(d) for d in (s.get("browser_extra_allowed_domains") or []) if domain_of(d) and domain_of(d) not in doms]
        self.allowed = doms
        if not self.start_url and doms:
            self.start_url = f"https://{doms[0]}/"
        self.st = _State()
        self.ai_calls: list[dict] = []
        self.ai_refused: Optional[str] = None
        self.t0 = time.monotonic()
        self.guard = None
        self._reported_hashes: set[str] = set()

    # ---- traces
    def _visit(self, snap: PageSnapshot, strategy: str, notes: str | None = None) -> Optional[str]:
        self.st.flags.extend(snap.security_flags)
        self.st.history.append({"url": snap.final_url or snap.url, "outcome": snap.outcome, "strategy": strategy,
                                "duration_ms": snap.duration_ms})
        try:
            vid = self.env.reporter.visit(
                url=snap.final_url or snap.url, title=snap.title or None, strategy=strategy, outcome=snap.outcome,
                http_status=snap.status, text_excerpt=snap.excerpt(1500) if snap.outcome == "ok" or snap.text else None,
                content_hash=snap.content_hash, security_flags=snap.security_flags, duration_ms=snap.duration_ms,
                notes=notes or snap.error or (snap.detection.reason if snap.detection.blocked else None),
                screenshot=snap.screenshot)
        except Exception as exc:  # une trace perdue ne doit pas arrêter la navigation
            logger.warning("Page non enregistrée : %s", exc)
            vid = None
        if vid:
            self.st.pages.append(vid)
        if snap.outcome == "ok":
            self.st.last_url = snap.final_url or snap.url
        return vid

    def _document(self, f: DownloadedFile, vid: Optional[str]) -> None:
        if f.sha256 in self._reported_hashes:
            return
        self._reported_hashes.add(f.sha256)
        try:
            mid = self.env.reporter.document(f, vid)
        except Exception as exc:
            self.st.notes.append(f"Document refusé par le serveur : {str(exc)[:200]}")
            mid = None
        if mid and mid not in self.st.documents:
            self.st.documents.append(mid)

    def _progress(self, msg: str) -> None:
        try:
            self.env.reporter.progress(msg)
        except Exception:  # pragma: no cover
            pass

    def _remaining(self) -> float:
        return max(5.0, self.timeout_s - (time.monotonic() - self.t0))

    def _driver_config(self, sub: str, *, headless: Optional[bool] = None) -> DriverConfig:
        cfg = DriverConfig.from_settings(self.s, self.env.workdir / sub, policy=self.policy)
        cfg.headless = bool(self.s.get("browser_headless", True)) if headless is None else headless
        if self.env.headless is not None and headless is None:
            cfg.headless = self.env.headless
        cfg.respect_robots = self.env.respect_robots
        if self.env.chromium_path:
            cfg.chromium_path = self.env.chromium_path
        return cfg

    # ---- résultat
    def _result(self, outcome: str, *, reason: str | None = None, needs_human: bool = False, human_url: str | None = None,
                error: str | None = None, retry: bool = False) -> BrowseOutcome:
        if self.guard is not None:
            self.st.flags.extend(self.guard.take_refusals())
        refused_dl = [f for f in self.st.flags if f.get("kind") == "download_refused"]
        injections = [f for f in self.st.flags if f.get("kind") == "prompt_injection"]
        notes = list(self.st.notes)
        if refused_dl:
            notes.append(f"{len(refused_dl)} téléchargement(s) refusé(s) par la politique de sécurité.")
        if injections:
            notes.append(f"{len(injections)} tentative(s) d'injection de consignes détectée(s) et ignorée(s).")
        res = {"outcome": outcome, "blocked_reason": reason, "needs_human": needs_human, "pages": self.st.pages,
               "documents": self.st.documents, "findings": self.st.findings[:50], "strategy_used": self.st.strategy,
               "steps": self.st.steps, "notes": " ".join(dict.fromkeys(notes))[:2000], "human_url": human_url,
               "history": self.st.history[-60:], "security_flags": self.st.flags[:50]}
        if error:
            res["error"], res["retry"] = error, retry
        return BrowseOutcome(result=res, ai_calls=self.ai_calls, ai_refused=self.ai_refused)

    # ---- point d'entrée
    async def run(self) -> BrowseOutcome:
        from .guard import EgressGuard

        if not self.start_url:
            self.st.strategy = "web_search"
            return self._result("failed", error="Aucune adresse de départ ni domaine autorisé : cette recherche relève de la "
                                               "recherche web (serveur).", retry=False)
        pol = site_policy(domain_of(self.start_url), blocked_domains=self.policy.blocked_domains)
        if pol == "blocked":
            return self._result("blocked", reason="Domaine bloqué dans vos paramètres : aucune navigation.", needs_human=False)
        if pol == "human_only":
            return await self._human_only()
        decision = await asyncio.to_thread(check_url, self.start_url, self.policy)
        if not decision.allowed:
            self._visit(PageSnapshot(url=self.start_url, outcome="blocked_policy", error=decision.reason,
                                     security_flags=[decision.flag()]), "playwright")
            return self._result("failed", error=f"Adresse refusée : {decision.reason}", retry=False)
        self.guard = EgressGuard(self.policy).start()
        try:
            return await asyncio.wait_for(self._strategies(), timeout=self.timeout_s + 30)
        except asyncio.TimeoutError:
            self.st.notes.append(f"Délai global dépassé ({int(self.timeout_s)} s) : résultats partiels conservés.")
            return self._result("failed", error="Délai global de la tâche dépassé.", retry=True)
        finally:
            self.st.flags.extend(self.guard.take_refusals())
            self.guard.stop()

    async def _strategies(self) -> BrowseOutcome:
        ai_ok = bool(self.env.ai.get("allowed")) and int(self.env.ai.get("max_calls") or 0) > 0
        agent_first = self.p.get("strategy_hint") == "browser_agent" and ai_ok
        if not agent_first:
            try:
                found = await self._playwright()
            except _Blocked as b:
                return await self._on_blocked(b)
            except _Transient as t:
                if not ai_ok:
                    return self._result("failed", error=str(t), retry=True)
                self.st.notes.append(f"Navigation déterministe interrompue ({t}).")
                found = False
            if found:
                return self._result("ok")
            if self.p.get("strategy_hint") == "playwright":
                self.st.notes.append("Recette déterministe sans résultat ; agent IA non demandé pour cette tâche.")
                return self._result("ok")
        if not ai_ok:
            reason = self.env.ai.get("reason") or "Agent IA non disponible."
            self.ai_refused = reason if self.env.ai.get("scope") else None
            self.st.notes.append(f"Aucun résultat par la navigation déterministe ; agent IA non utilisé : {reason}")
            return self._result("ok")
        return await self._agent()

    # ---- stratégie 2 : Playwright
    async def _open(self, d: PlaywrightDriver, url: str, strategy: str = "playwright") -> tuple[PageSnapshot, Optional[str]]:
        if self.st.steps >= self.max_steps:
            raise _StepLimit()
        snap = None
        for attempt in range(self.retries + 1):
            if self.env.cancel and self.env.cancel.is_set():
                raise asyncio.CancelledError()
            snap = await d.open(url)
            self.st.steps += 1
            if snap.outcome not in TRANSIENT_OUTCOMES or attempt == self.retries or self.st.steps >= self.max_steps:
                break
            self._visit(snap, strategy, notes=f"Essai {attempt + 1} : {snap.error or snap.outcome} — nouvel essai.")
            await asyncio.sleep(min(10, 2 * (attempt + 1)))
        vid = self._visit(snap, strategy)
        self._check_blocked(snap)
        if snap.outcome in TRANSIENT_OUTCOMES:
            raise _Transient(snap.error or snap.outcome)
        return snap, vid

    def _check_blocked(self, snap: PageSnapshot) -> None:
        if snap.outcome in BLOCKING_OUTCOMES:
            if snap.outcome == "robots_disallowed":
                raise _Blocked("robots_disallowed", "robots.txt du site interdit cette page aux robots : ouvrez-la vous-même.",
                               snap.url)
            if snap.outcome == "blocked_policy" and snap.policy == "allowed" and not snap.detection.blocked:
                raise _Blocked("blocked_policy", snap.error or "Adresse refusée par la politique de sécurité.", snap.url, False)
            reason = snap.detection.reason or ISSUE_LABELS_FR.get(snap.outcome, snap.error or "Accès bloqué.")
            raise _Blocked(snap.outcome, reason, snap.final_url or snap.url)

    async def _playwright(self) -> bool:
        self.st.strategy = "playwright"
        async with PlaywrightDriver(self._driver_config("pw"), guard=self.guard) as d:
            try:
                return await self._recipe(d, start=self.start_url)
            except _StepLimit:
                self.st.notes.append(f"Limite de {self.max_steps} étapes atteinte.")
                return bool(self.st.documents or self.st.findings)
            finally:
                for f in list(d.downloads):
                    self._document(f, self.st.pages[-1] if self.st.pages else None)

    async def _recipe(self, d: PlaywrightDriver, *, start: Optional[str] = None, snap: Optional[PageSnapshot] = None,
                      vid: Optional[str] = None, strategy: str = "playwright") -> bool:
        """Recette générique : page → documents (IIIF / liens directs) → formulaire → résultats → pages d'actes."""
        if snap is None:
            snap, vid = await self._open(d, start or self.start_url, strategy)
        if self.expect == "documents" and await self._collect_documents(d, snap, vid):
            return True
        page_for_results = snap
        if self.person.get("surname"):
            submitted = await d.fill_search_form(self.person, snap)
            if submitted is not None:
                self.st.steps += 1
                vid2 = self._visit(submitted, strategy, notes="Formulaire de recherche rempli et envoyé (recette générique).")
                self._check_blocked(submitted)
                page_for_results = submitted
                if self.expect == "documents" and await self._collect_documents(d, submitted, vid2):
                    return True
            results = d.result_links(page_for_results, self.person, self.allowed, limit=5)
        else:
            results = []
        for r in results[:3]:
            if self.st.steps >= self.max_steps:
                self.st.notes.append(f"Limite de {self.max_steps} étapes atteinte.")
                break
            finding = {"title": r["title"], "url": r["url"], "snippet": r["snippet"], "archival_reference": None,
                       "verified_visit": False}
            self.st.findings.append(finding)
            try:
                s3, v3 = await self._open(d, r["url"], strategy)
            except _Transient as t:
                self.st.notes.append(f"Résultat non ouvert ({t}).")
                continue
            finding["verified_visit"] = True
            m = _COTE_RE.search(s3.text or "")
            if m:
                finding["archival_reference"] = sanitize_page_text(m.group(1), 120)
            if s3.text and not finding["snippet"]:
                finding["snippet"] = s3.excerpt(300)
            if self.expect == "documents":
                await self._collect_documents(d, s3, v3, archival_reference=finding["archival_reference"])
        for r in results[3:]:
            self.st.findings.append({"title": r["title"], "url": r["url"], "snippet": r["snippet"], "archival_reference": None,
                                     "verified_visit": False})
        return bool(self.st.documents or (self.expect != "documents" and self.st.findings) or
                    any(f.get("verified_visit") for f in self.st.findings))

    async def _collect_documents(self, d: PlaywrightDriver, snap: PageSnapshot, vid: Optional[str],
                                 archival_reference: str | None = None) -> bool:
        before = len(self.st.documents)
        cands = await d.iiif_documents(snap, limit=1)
        cands += [c for c in d.document_candidates(snap) if c["url"] not in {x["url"] for x in cands}]
        for c in cands:
            if len(self.st.documents) - before >= self.max_documents:
                break
            if not _in_domains(c["url"], self.allowed) and not c.get("manifest"):
                # image servie par un autre domaine : acceptée seulement si elle vient d'un manifeste de la page
                self.st.notes.append(f"Document d'un domaine non autorisé ignoré ({domain_of(c['url'])}).")
                continue
            try:
                f = await d.download(c["url"], referer=snap.final_url or snap.url, title=c.get("title") or snap.title or None,
                                     archival_reference=c.get("archival_reference") or archival_reference)
            except DownloadRefused as r:
                self.st.flags.append(r.flag)
                continue
            except Exception as exc:
                self.st.notes.append(f"Téléchargement impossible ({exc.__class__.__name__}).")
                continue
            self._document(f, vid)
        return len(self.st.documents) > before

    # ---- stratégie 4 : assistance humaine
    async def _human_only(self) -> BrowseOutcome:
        self.st.strategy = "human"
        dom = domain_of(self.start_url)
        reason = (f"Les conditions d'utilisation de {dom} n'autorisent pas la navigation automatique : la page est ouverte "
                  "pour vous, sans aucune collecte automatique. Importez ensuite le document trouvé.")
        self._visit(PageSnapshot(url=self.start_url, outcome="blocked_policy", policy="human_only", error=reason), "human",
                    notes=reason)
        if self.env.human_assist:
            try:
                await self.env.human_assist(HumanRequest("human_only", reason, self.start_url, None, automation_allowed=False))
            except Exception as exc:  # pragma: no cover
                logger.debug("Ouverture pour l'utilisateur impossible : %s", exc)
        return self._result("blocked", reason=reason, needs_human=True, human_url=self.start_url)

    async def _on_blocked(self, b: _Blocked) -> BrowseOutcome:
        if not b.needs_human:
            return self._result("blocked", reason=b.reason, needs_human=False)
        if self.env.human_assist and b.issue in ("captcha", "login_required", "paywall"):
            try:
                resumed = await self._assist(b)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pas d'écran disponible, fenêtre fermée par l'utilisateur…
                logger.warning("Assistance humaine impossible : %s", exc)
                self.st.notes.append("Fenêtre d'assistance impossible à ouvrir sur ce PC.")
                resumed = None
            if resumed is not None:
                return resumed
        return self._result("blocked", reason=b.reason, needs_human=True, human_url=b.url)

    async def _assist(self, b: _Blocked) -> Optional[BrowseOutcome]:
        """Fenêtre visible sur la page bloquée ; l'utilisateur agit lui-même ; reprise de la recette après confirmation."""
        self._progress(f"Action requise : {b.reason} Une fenêtre du navigateur est ouverte sur la page.")
        async with PlaywrightDriver(self._driver_config("assist", headless=self.env.assist_headless), guard=self.guard) as vis:
            snap = await vis.open(b.url, check_robots=False)
            ok = await self.env.human_assist(HumanRequest(b.issue, b.reason, b.url, vis))
            if not ok:
                return None
            self.st.strategy = "human"
            snap = await vis.snapshot()
            self.st.steps += 1
            vid = self._visit(snap, "human", notes="Reprise après l'action de l'utilisateur.")
            if snap.outcome in BLOCKING_OUTCOMES:
                return None
            try:
                found = await self._recipe(vis, snap=snap, vid=vid, strategy="human")
            except _Blocked as again:
                return self._result("blocked", reason=again.reason, needs_human=True, human_url=again.url)
            except (_Transient, _StepLimit) as exc:
                self.st.notes.append(f"Reprise interrompue ({exc}).")
                found = bool(self.st.documents)
            finally:
                for f in list(vis.downloads):
                    self._document(f, self.st.pages[-1] if self.st.pages else None)
            self.st.notes.append("Reprise après assistance humaine.")
            if not found:
                self.st.notes.append("Aucun document trouvé après la reprise.")
            return self._result("ok")

    # ---- stratégie 3 : agent Browser Use
    async def _agent(self) -> BrowseOutcome:
        from .agent_driver import (AgentBudget, AgentRunConfig, browser_use_available, build_task, make_gemini_llm,
                                   run_agent)
        from .playwright_driver import resolve_chromium_path

        self.st.strategy = "browser_agent"
        if not browser_use_available():
            self.st.notes.append("Browser Use n'est pas installé sur ce PC (pip install -e \"backend[browser]\").")
            return self._result("ok")
        model = self.env.ai.get("model") or "gemini-3.8-flash"
        try:
            llm = self.env.llm_factory(model) if self.env.llm_factory else make_gemini_llm(self.env.gemini_key or "", model)
        except Exception as exc:
            self.st.notes.append(f"Agent IA non lancé : {exc}")
            return self._result("ok")
        remaining_steps = max(1, self.max_steps - self.st.steps)
        budget = AgentBudget(max_calls=min(int(self.env.ai.get("max_calls") or 0), remaining_steps),
                             per_minute=int(self.env.ai.get("per_minute") or 0))
        cfg = AgentRunConfig(downloads_dir=self.env.workdir / "agent-downloads", allowed_domains=self.allowed,
                             proxy_url=self.guard.url if self.guard else None,
                             headless=self.env.headless if self.env.headless is not None else bool(self.s.get("browser_headless", True)),
                             chromium_path=self.env.chromium_path or await resolve_chromium_path(), max_steps=remaining_steps,
                             timeout_s=self._remaining(), allow_ip_hosts=self.policy.allow_loopback_ports is not None)
        start = self.st.last_url or self.start_url
        task = build_task(self.goal, person=self.person, start_url=start, allowed_domains=self.allowed, expect=self.expect)
        self._progress(f"Agent IA (Browser Use) lancé : {budget.max_calls} appel(s) IA au plus.")
        try:
            out = await run_agent(task, llm, cfg, budget, self.env.cancel)
        except Exception as exc:
            self.ai_calls = budget.calls
            return self._result("failed", error=f"Agent IA en échec : {str(exc)[:300]}", retry=True)
        finally:
            self.ai_calls = budget.calls
        self.st.steps += out.steps
        visited: list[str] = []
        shots: dict[str, Optional[str]] = {}
        for i, u in enumerate(out.urls):
            if not u or u.startswith(("about:", "chrome:", "data:")):
                continue
            if _norm_url(u) not in {_norm_url(v) for v in visited}:
                visited.append(u)
                shots[u] = out.screenshots[i] if i < len(out.screenshots) else None
        for u in visited:
            shot = None
            p = shots.get(u)
            if p:
                try:
                    shot = Path(p).read_bytes()
                except OSError:
                    shot = None
            self._visit(PageSnapshot(url=u, final_url=u, outcome="ok", screenshot=shot), "browser_agent",
                        notes="Page ouverte par l'agent IA.")
        rep = out.report
        visited_n = {_norm_url(v) for v in visited}
        if out.final_text:
            self.st.flags.extend(f for f in detect_injection(out.final_text) if f not in self.st.flags)
        if rep is not None:
            dropped = 0
            for f in rep.findings[:30]:
                if _norm_url(f.url) not in visited_n:
                    dropped += 1
                    continue
                text = f"{f.title} {f.snippet}"
                inj = detect_injection(text)
                if inj:
                    self.st.flags.extend(inj)
                self.st.findings.append({"title": sanitize_page_text(f.title, 300), "url": f.url,
                                         "snippet": sanitize_page_text(f.snippet, 600),
                                         "archival_reference": sanitize_page_text(f.archival_reference, 200) or None,
                                         "verified_visit": True})
            if dropped:
                self.st.notes.append(f"{dropped} piste(s) de l'agent écartée(s) : page non réellement ouverte.")
            if rep.injection_suspected:
                self.st.notes.append("L'agent a signalé des consignes suspectes dans une page (ignorées).")
            fetcher = SafeFetcher(self._driver_config("agent-dl"), guard=self.guard, flags=self.st.flags)
            for u in rep.document_urls[: self.max_documents]:
                if not _in_domains(u, self.allowed):
                    self.st.flags.append({"kind": "download_refused", "url": u[:300],
                                          "reason": "Document proposé par l'agent sur un domaine non autorisé."})
                    continue
                try:
                    f = await fetcher.download(u, referer=self.st.last_url or "")
                except DownloadRefused as r:
                    self.st.flags.append(r.flag)
                    continue
                except Exception as exc:
                    self.st.notes.append(f"Téléchargement impossible ({exc.__class__.__name__}).")
                    continue
                self._document(f, self.st.pages[-1] if self.st.pages else None)
        for path in out.downloaded_files:
            data = path.read_bytes() if path.stat().st_size <= 41 * 1024 * 1024 else b""
            dec = check_download(path.name, None, len(data), data[:64])
            if not dec.allowed:
                self.st.flags.append(dec.flag(path.name))
                continue
            import hashlib

            self._document(DownloadedFile(path=path, filename=dec.safe_filename or path.name, mime=dec.mime or "", size=len(data),
                                          sha256=hashlib.sha256(data).hexdigest(), source_url=self.st.last_url or "",
                                          page_url=self.st.last_url or ""), self.st.pages[-1] if self.st.pages else None)
        if out.stopped_reason:
            self.st.notes.append(f"Agent arrêté : {out.stopped_reason}")
        if rep is not None and rep.blocked != "none":
            url = rep.blocked_url if rep.blocked_url and _in_domains(rep.blocked_url, self.allowed) else (visited[-1] if visited else self.start_url)
            b = _Blocked(rep.blocked, ISSUE_LABELS_FR.get(rep.blocked, "Accès bloqué."), url)
            self.st.strategy = "browser_agent"
            return await self._on_blocked(b)
        if rep is None and not out.done:
            self.st.notes.append("L'agent n'a pas terminé sa tâche.")
        if rep is not None and rep.notes:
            self.st.notes.append("Note de l'agent : " + sanitize_page_text(rep.notes, 300))
        return self._result("ok")


class _Transient(Exception):
    pass


class _StepLimit(Exception):
    pass


async def execute_browse_task(params: dict, env: BrowseEnv) -> BrowseOutcome:
    """Exécute une tâche `browse` et renvoie le résultat du contrat §5 (+ appels IA à enregistrer côté serveur)."""
    env.workdir.mkdir(parents=True, exist_ok=True)
    runner = BrowseRunner(params, env)
    try:
        return await runner.run()
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # erreur imprévue : jamais de résultat inventé
        logger.exception("Tâche de navigation en échec")
        return runner._result("failed", error=f"Erreur du worker : {exc.__class__.__name__}: {str(exc)[:300]}", retry=True)


def host_of(url: str) -> str:
    return urlsplit(url).hostname or ""
