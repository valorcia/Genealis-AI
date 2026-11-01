"""Enregistrement côté serveur de ce que le worker a réellement fait : pages visitées, captures, documents, résultat.

Utilisé par l'API du worker (`api/worker.py`) et par `DbReporter` (exécution dans le même processus, tests).
Aucune dépendance à Playwright ni à Browser Use. Chaque fichier reçu est revérifié (signature, taille, type) :
le serveur ne fait pas confiance au worker plus qu'au web.
"""
from __future__ import annotations

import hashlib
import mimetypes
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from ..ai.errors import QuotaExceeded
from ..config import settings as app_settings
from ..investigation import queue
from ..models import AICallLog, Investigation, InvestigationTask, Media, PageVisit, TransmissionLog, utcnow
from ..services import cost, privacy
from ..services import settings_service as cfg
from .security import check_download, domain_of, sanitize_page_text

BROWSER_SETTING_KEYS = ("browser_mode", "browser_use_cloud_authorized", "browser_max_steps", "browser_page_timeout_s",
                        "browser_task_timeout_s", "browser_max_retries", "browser_extra_allowed_domains",
                        "browser_blocked_domains", "browser_headless", "connector_min_interval", "cost_mode",
                        "ai_monthly_budget_usd")
OUTCOMES = ("ok", "blocked_policy", "robots_disallowed", "captcha", "login_required", "paywall", "not_found", "error", "timeout")
STRATEGY_LABELS_FR = {"web_search": "recherche web", "playwright": "navigation déterministe",
                      "browser_agent": "agent IA (Browser Use)", "human": "assistance humaine"}
WORKER_ONLINE_S = 120


def browser_settings(db: Session) -> dict:
    return {k: cfg.get(db, k) for k in BROWSER_SETTING_KEYS}


# ---------------------------------------------------------------- état du worker
def touch_worker(db: Session, worker_id: str, info: dict | None = None) -> None:
    cfg.set_value(db, "worker_last_seen", utcnow().isoformat(timespec="seconds"))
    cfg.set_value(db, "worker_id", (worker_id or "")[:64])
    if info is not None:
        cfg.set_value(db, "worker_info", {k: info.get(k) for k in ("playwright", "browser_use", "mode", "version", "headless",
                                                                    "chromium", "gemini_key_configured", "platform")})


def worker_status(db: Session) -> dict:
    last = cfg.get(db, "worker_last_seen")
    info = cfg.get(db, "worker_info") or {}
    online = False
    if last:
        try:
            ts = datetime.fromisoformat(last)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            now = utcnow()
            now = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
            online = now - ts < timedelta(seconds=WORKER_ONLINE_S)
        except ValueError:
            online = False
    current = (db.query(InvestigationTask.id).filter(InvestigationTask.kind == "browse", InvestigationTask.status == "running",
                                                     InvestigationTask.claimed_by == cfg.get(db, "worker_id")).first()
               if cfg.get(db, "worker_id") else None)
    return {"online": online, "last_seen": last, "worker_id": cfg.get(db, "worker_id"),
            "playwright": bool(info.get("playwright")), "browser_use": bool(info.get("browser_use")),
            "mode": info.get("mode") or cfg.get(db, "browser_mode"), "gemini_key_configured": info.get("gemini_key_configured"),
            "current_task_id": current[0] if current else None, "browser_mode": cfg.get(db, "browser_mode")}


# ---------------------------------------------------------------- confidentialité et plafonds IA
def privacy_refusal(db: Session, task: InvestigationTask) -> Optional[str]:
    """Une tâche de navigation ne transmet jamais à un site ou à une IA les données d'une personne peut-être vivante."""
    person = (task.params or {}).get("person") or {}
    living_flag = bool(person.get("living") or person.get("is_living") or person.get("possibly_living"))
    if not privacy.protection_active(db):
        return None
    if living_flag or (task.person_id and privacy.is_possibly_living(db, task.person_id)):
        return ("Personne peut-être vivante : ses données ne sont pas envoyées à des sites ni à une IA externe sans votre "
                "autorisation (Paramètres → Confidentialité).")
    return None


def ai_allowance(db: Session, task: InvestigationTask) -> dict:
    """Appels IA permis pour l'agent Browser Use de cette tâche (le nombre d'étapes compte dans le plafond de l'enquête)."""
    model = cfg.get(db, "gemini_model") or "gemini-3.8-flash"
    max_steps = int(cfg.get(db, "browser_max_steps", 25) or 25)
    out = {"allowed": False, "max_calls": 0, "per_minute": int(cfg.get(db, "ai_minute_call_limit", 8) or 0), "model": model,
           "provider": "gemini", "reason": ""}
    if not cfg.get(db, "allow_external_ai"):
        out["reason"] = ("L'agent IA du navigateur envoie le contenu des pages à Gemini : activez « Autoriser l'IA externe » "
                         "dans les paramètres pour l'utiliser.")
        return out
    with cost.ai_context(investigation_id=task.investigation_id, task_id=task.id):
        try:
            cost.check_allowed(db, "gemini", model, "navigation:precheck")
        except QuotaExceeded as exc:
            out["reason"], out["scope"] = str(exc), exc.scope
            # vérification préalable : le refus réel sera journalisé si l'agent était nécessaire
            db.query(AICallLog).filter(AICallLog.purpose == "navigation:precheck").delete()
            db.flush()
            return out
    budget = max_steps
    daily = int(cfg.get(db, "ai_daily_call_limit", 200) or 0)
    if daily:
        budget = min(budget, daily - cost.calls_since(db, cost._day_start()))
    inv = db.get(Investigation, task.investigation_id)
    if inv and inv.ai_call_ceiling:
        budget = min(budget, int(inv.ai_call_ceiling) - int(inv.ai_calls_used or 0))
    out["max_calls"] = max(0, budget)
    out["allowed"] = out["max_calls"] > 0
    if not out["allowed"]:
        out["reason"] = "Plafond d'appels IA atteint pour cette enquête ou pour aujourd'hui."
    return out


def record_ai_calls(db: Session, task: InvestigationTask, calls: list[dict], *, purpose: str = "navigation",
                    refused: str | None = None, personal: bool = False) -> int:
    """Appels Gemini faits par Browser Use (hors AIClient) → gestionnaire de coûts, attribués à l'enquête et à la tâche."""
    n = 0
    with cost.ai_context(investigation_id=task.investigation_id, task_id=task.id):
        for c in (calls or [])[:500]:
            status = c.get("status") if c.get("status") in ("ok", "error", "rate_limited") else "error"
            usage = c.get("usage") or {}
            usage = {k: max(0, int(usage.get(k, 0) or 0)) for k in ("input_tokens", "output_tokens", "thinking_tokens")}
            cost.record(db, provider="gemini", model=str(c.get("model") or "")[:128] or None, purpose=purpose, status=status,
                        usage=usage, duration_ms=int(c.get("duration_ms") or 0) or None, error=c.get("error"))
            n += 1
        if refused:
            ctx = cost.current_context()
            db.add(AICallLog(provider="gemini", model=cfg.get(db, "gemini_model"), purpose=purpose, status="quota_refused",
                             error=refused[:500], investigation_id=ctx.get("investigation_id"), task_id=ctx.get("task_id")))
    if n:
        db.add(TransmissionLog(provider="gemini", purpose="navigation (agent Browser Use)",
                               payload_summary=f"Agent navigateur : {n} appel(s) — contenu de pages web publiques et objectif "
                                               f"de la tâche « {task.title[:150]} »",
                               bytes_sent=0, contains_personal_data=personal, authorized=True))
    db.flush()
    return n


# ---------------------------------------------------------------- pages et documents
def _import_bytes(db: Session, data: bytes, filename: str, *, kind: str, title: str) -> tuple[Media, bool]:
    """Copie intègre (jamais modifiée) dans le stockage de documents ; renvoie (média, déjà présent)."""
    from ..services import storage
    from ..services.fts import index_entity
    from ..services.media_service import ALLOWED, import_file

    digest = hashlib.sha256(data).hexdigest()
    existing = db.query(Media).filter(Media.sha256 == digest).first()
    if existing:
        return existing, True
    ext = Path(filename).suffix.lower() or ".bin"
    app_settings.ensure_dirs()
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext, dir=app_settings.cache_dir) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)
    try:
        if ext in ALLOWED:
            m = import_file(db, tmp_path, original_filename=filename, kind=kind, title=title[:500])
        else:  # JPEG 2000 : accepté par la politique de téléchargement, conservé tel quel
            stored = storage.store(tmp_path, f"{digest[:2]}/{digest}{ext}")
            m = Media(path=stored, original_filename=filename, mime_type=mimetypes.guess_type(filename)[0] or "image/jp2",
                      kind=kind, title=title[:500], sha256=digest)
            db.add(m)
            db.flush()
            index_entity(db.connection(), "media", m.id, m.title or filename, filename)
    finally:
        tmp_path.unlink(missing_ok=True)
    return m, False


def record_visit(db: Session, task: InvestigationTask, *, worker_id: str, url: str, title: str | None = None,
                 strategy: str = "playwright", outcome: str = "ok", http_status: int | None = None,
                 text_excerpt: str | None = None, content_hash: str | None = None, security_flags: list | None = None,
                 duration_ms: int | None = None, notes: str | None = None, screenshot: bytes | None = None) -> PageVisit:
    if outcome not in OUTCOMES:
        outcome = "error"
    shot_id = None
    if screenshot:
        kind = "png" if screenshot.startswith(b"\x89PNG") else "jpeg" if screenshot.startswith(b"\xff\xd8") else None
        if kind and len(screenshot) <= 8 * 1024 * 1024:
            m, _ = _import_bytes(db, screenshot, f"capture-{hashlib.sha256(screenshot).hexdigest()[:12]}."
                                                 f"{'png' if kind == 'png' else 'jpg'}",
                                 kind="screenshot", title=f"Capture : {(title or url)[:200]}")
            m.analysis = {**(m.analysis or {}), "screenshot_of": url[:2000], "investigation_id": task.investigation_id,
                          "task_id": task.id, "captured_by": worker_id, "captured_at": utcnow().isoformat(timespec="seconds")}
            shot_id = m.id
    flags = [f for f in (security_flags or []) if isinstance(f, dict)][:50]
    v = PageVisit(investigation_id=task.investigation_id, task_id=task.id, url=url[:4000], domain=domain_of(url)[:255] or None,
                  title=sanitize_page_text(title, 500) or None, strategy=strategy if strategy in STRATEGY_LABELS_FR else "playwright",
                  outcome=outcome, http_status=http_status, text_excerpt=sanitize_page_text(text_excerpt, 4000) or None,
                  content_hash=(content_hash or "")[:64] or None, security_flags=flags, worker_id=(worker_id or "")[:64],
                  duration_ms=duration_ms, notes=sanitize_page_text(notes, 2000) or None, screenshot_media_id=shot_id,
                  downloads=[])
    db.add(v)
    db.flush()
    label = {"ok": "Page ouverte", "blocked_policy": "Page non ouverte (politique du site / sécurité)",
             "robots_disallowed": "Page interdite aux robots (robots.txt)", "captcha": "CAPTCHA rencontré",
             "login_required": "Connexion demandée par le site", "paywall": "Contenu payant / réservé aux abonnés",
             "not_found": "Page introuvable", "error": "Erreur de chargement", "timeout": "Délai dépassé"}[outcome]
    queue.emit(db, task.investigation_id, "page", f"{label} : {v.title or v.url[:200]} ({v.domain or '?'})",
               {"page_visit_id": v.id, "url": v.url[:500], "outcome": outcome, "strategy": v.strategy,
                "security_flags": len(flags)}, task_id=task.id)
    if any(f.get("kind") == "prompt_injection" for f in flags):
        queue.emit(db, task.investigation_id, "info",
                   "Tentative d'injection de consignes détectée sur une page : son contenu est traité comme une donnée non "
                   "fiable et n'a pas été suivi.", {"page_visit_id": v.id}, task_id=task.id)
    return v


class DocumentRefused(ValueError):
    pass


def record_document(db: Session, task: InvestigationTask, *, worker_id: str, data: bytes, filename: str | None,
                    mime: str | None, source_url: str, page_url: str | None = None, archival_reference: str | None = None,
                    title: str | None = None, page_visit_id: str | None = None) -> tuple[Media, bool]:
    dec = check_download(filename or Path(urlsplit(source_url).path).name, mime, len(data), data[:64])
    if not dec.allowed:
        raise DocumentRefused(dec.reason)
    name = dec.safe_filename or f"document{dec.ext}"
    kind = "document"
    m, duplicate = _import_bytes(db, data, name, kind=kind, title=sanitize_page_text(title, 400) or name)
    if not duplicate or not (m.analysis or {}).get("archived_from"):
        m.analysis = {**(m.analysis or {}), "archived_from": source_url[:2000], "page_url": (page_url or "")[:2000] or None,
                      "archival_reference": sanitize_page_text(archival_reference, 300) or None,
                      "archived_at": utcnow().isoformat(timespec="seconds"), "content_type": dec.mime, "size": len(data),
                      "sha256": hashlib.sha256(data).hexdigest(), "downloaded_by": worker_id, "origin": "browser_worker",
                      "investigation_id": task.investigation_id, "task_id": task.id, "page_visit_id": page_visit_id}
    if page_visit_id:
        v = db.get(PageVisit, page_visit_id)
        if v and v.task_id == task.id:
            v.downloads = [*(v.downloads or []), {"media_id": m.id, "filename": name, "mime": dec.mime, "size": len(data),
                                                  "sha256": m.sha256, "source_url": source_url[:1000]}]
    db.flush()
    queue.emit(db, task.investigation_id, "document",
               f"Document {'déjà connu' if duplicate else 'téléchargé'} : {m.title} ({domain_of(source_url) or '?'})"
               + (f" — cote {archival_reference}" if archival_reference else ""),
               {"media_id": m.id, "source_url": source_url[:500], "duplicate": duplicate}, task_id=task.id)
    return m, duplicate


# ---------------------------------------------------------------- résultat
def _clean_findings(findings: Any) -> list[dict]:
    out = []
    for f in (findings or [])[:100]:
        if not isinstance(f, dict):
            continue
        url = str(f.get("url") or "")
        if not url.startswith(("http://", "https://")):
            continue
        out.append({"title": sanitize_page_text(f.get("title"), 300) or url[:200], "url": url[:2000],
                    "snippet": sanitize_page_text(f.get("snippet"), 600),
                    "archival_reference": sanitize_page_text(f.get("archival_reference"), 300) or None,
                    **({"verified_visit": bool(f.get("verified_visit"))} if "verified_visit" in f else {})})
    return out


def apply_result(db: Session, task: InvestigationTask, worker_id: str, payload: dict) -> InvestigationTask:
    """Résultat du worker → `queue.complete` / `queue.block` / `queue.fail` + fil d'activité."""
    res = dict(payload.get("result") or {})
    outcome = res.get("outcome") if res.get("outcome") in ("ok", "blocked", "failed") else "failed"
    record_ai_calls(db, task, payload.get("ai_calls") or [], refused=payload.get("ai_refused"),
                    personal=bool((task.params or {}).get("person")))
    own_pages = {pid for (pid,) in db.query(PageVisit.id).filter(PageVisit.task_id == task.id)}
    clean = {
        "outcome": outcome,
        "blocked_reason": sanitize_page_text(res.get("blocked_reason"), 500) or None,
        "needs_human": bool(res.get("needs_human")),
        "pages": [p for p in (res.get("pages") or []) if p in own_pages],
        "documents": [str(d) for d in (res.get("documents") or []) if db.get(Media, str(d))][:100],
        "findings": _clean_findings(res.get("findings")),
        "strategy_used": res.get("strategy_used") if res.get("strategy_used") in STRATEGY_LABELS_FR else None,
        "steps": int(res.get("steps") or 0),
        "notes": sanitize_page_text(res.get("notes"), 2000),
        "human_url": str(res.get("human_url") or "")[:2000] or None,
        "worker_id": worker_id,
    }
    task.strategy = clean["strategy_used"] or task.strategy
    label = STRATEGY_LABELS_FR.get(clean["strategy_used"] or "", "navigation")
    if outcome == "ok":
        queue.complete(db, task, clean, status="done")
        queue.emit(db, task.investigation_id, "search",
                   f"Navigation terminée ({label}) : {len(clean['documents'])} document(s), {len(clean['findings'])} piste(s), "
                   f"{len(clean['pages'])} page(s) consultée(s).", {"result": {k: clean[k] for k in ("documents", "pages")}},
                   task_id=task.id)
    elif outcome == "blocked":
        task.result = {**(task.result or {}), **clean}
        reason = clean["blocked_reason"] or "Navigation bloquée."
        queue.block(db, task, reason, needs_human=clean["needs_human"])
        queue.emit(db, task.investigation_id, "human" if clean["needs_human"] else "info",
                   ("Action requise : " if clean["needs_human"] else "Navigation bloquée : ") + reason,
                   {"url": clean["human_url"], "needs_human": clean["needs_human"]}, task_id=task.id)
    else:
        task.result = {**(task.result or {}), **clean}
        err = sanitize_page_text(res.get("error") or clean["notes"] or "Échec de la navigation.", 1000)
        queue.fail(db, task, err, retry=bool(res.get("retry", True)))
        queue.emit(db, task.investigation_id, "error", f"Navigation en échec : {err}"
                   + (" (nouvel essai prévu)" if task.status == "pending" else ""), task_id=task.id)
    db.flush()
    return task


def release(db: Session, task: InvestigationTask, reason: str = "") -> None:
    """Arrêt propre du worker : la tâche est remise en attente sans compter de tentative."""
    task.status, task.claimed_by, task.lease_until = "pending", None, None
    task.attempts = max(0, (task.attempts or 1) - 1)
    queue.emit(db, task.investigation_id, "info", f"« {task.title} » remise en attente (arrêt du worker{': ' + reason if reason else ''}).",
               task_id=task.id)
    db.flush()


class DbReporter:
    """Reporter direct en base (exécution dans le même processus que le serveur, tests)."""

    def __init__(self, db: Session, task: InvestigationTask, worker_id: str = "local"):
        self.db, self.task, self.worker_id = db, task, worker_id

    def visit(self, **kw) -> Optional[str]:
        return record_visit(self.db, self.task, worker_id=self.worker_id, **kw).id

    def document(self, f, page_visit_id: Optional[str]) -> Optional[str]:
        m, _ = record_document(self.db, self.task, worker_id=self.worker_id, data=Path(f.path).read_bytes(),
                               filename=f.filename, mime=f.mime, source_url=f.source_url, page_url=f.page_url,
                               archival_reference=f.archival_reference, title=f.title, page_visit_id=page_visit_id)
        return m.id

    def progress(self, message: str) -> None:
        queue.emit(self.db, self.task.investigation_id, "human" if message.startswith("Action requise") else "info",
                   message[:1000], task_id=self.task.id)
