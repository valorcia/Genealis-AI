"""Gestionnaire de coûts et de quotas des appels IA.

- compte chaque appel (et chaque appel évité grâce au cache ou refusé par un plafond) dans `ai_call_logs` ;
- refuse AVANT l'envoi tout appel qui dépasserait un plafond (jour, minute, enquête, budget, quota fournisseur) ;
- met en cache les réponses (un même document ou une même question n'est jamais renvoyé deux fois) ;
- limite le nombre d'appels simultanés ;
- applique les modes GRATUIT / HYBRIDE / COMMERCIAL.

Les tarifs ne sont pas codés en dur : ils changent souvent et doivent être vérifiés sur la page officielle du
fournisseur. L'utilisateur peut saisir ses tarifs (`ai_prices`) ; sans tarif, le coût estimé reste 0 et l'interface
l'indique (« tarif non renseigné »).
"""
from __future__ import annotations

import contextvars
import hashlib
import json
import re
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any, Iterator, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..ai.errors import QuotaExceeded
from ..models import AICacheEntry, AICallLog, Investigation, utcnow
from . import settings_service as cfg

COST_MODES = {
    "free": {"label": "GRATUIT", "paid_providers": False, "manual_allowed": True, "cloud_browser": False,
             "description": "Navigateur local, Browser Use open source, Gemini dans les limites gratuites, aucun service "
                            "cloud payant ; arrêt automatique dès qu'un quota est atteint."},
    "hybrid": {"label": "HYBRIDE", "paid_providers": True, "manual_allowed": True, "cloud_browser": False,
               "description": "Navigateur local, Gemini, modèle local (Ollama) quand c'est pertinent ; un service externe "
                              "payant seulement si vous l'avez autorisé et dans la limite du budget."},
    "commercial": {"label": "COMMERCIAL", "paid_providers": True, "manual_allowed": False, "cloud_browser": True,
                   "description": "Préparation SaaS : comptes, quotas et journalisation des coûts par client. Les abonnements "
                                  "personnels (claude.ai, chatgpt.com) ne sont jamais utilisés pour des clients."},
}
PAID_PROVIDERS = {"anthropic"}  # Gemini dispose d'un niveau gratuit ; Anthropic est toujours facturé à l'usage
COUNTED_STATUSES = ("ok", "error", "rate_limited")  # appels réellement envoyés au fournisseur

_ctx: contextvars.ContextVar[dict] = contextvars.ContextVar("genealis_ai_ctx", default={})
_sem_lock = threading.Lock()
_semaphore: Optional[threading.BoundedSemaphore] = None
_sem_size = 0


@contextmanager
def ai_context(*, investigation_id: str | None = None, task_id: str | None = None, owner_id: str | None = None) -> Iterator[None]:
    """Attribue les appels IA effectués dans ce bloc à une enquête / tâche (comptage et plafonds)."""
    token = _ctx.set({**_ctx.get(), **{k: v for k, v in (("investigation_id", investigation_id), ("task_id", task_id),
                                                          ("owner_id", owner_id)) if v}})
    try:
        yield
    finally:
        _ctx.reset(token)


def current_context() -> dict:
    return dict(_ctx.get())


def mode(db: Session) -> str:
    m = cfg.get(db, "cost_mode", "free")
    return m if m in COST_MODES else "free"


# ---------------------------------------------------------------- cache
def cache_key(provider: str, model: str | None, system: str, user: str, *, json_mode: bool, web_search: bool,
              files: list[tuple[bytes, str]] | None) -> str:
    h = hashlib.sha256()
    for part in (provider, model or "", system, user, str(json_mode), str(web_search)):
        h.update(part.encode("utf-8"))
        h.update(b"\x00")
    for data, mime in files or []:
        h.update(hashlib.sha256(data).digest())
        h.update(mime.encode())
    return h.hexdigest()


def cache_get(db: Session, key: str) -> Optional[AICacheEntry]:
    if not cfg.get(db, "ai_cache_enabled", True):
        return None
    row = db.get(AICacheEntry, key)
    if row is None:
        return None
    if row.expires_at and row.expires_at < utcnow():
        db.delete(row)
        db.flush()
        return None
    row.hits = (row.hits or 0) + 1
    db.flush()
    return row


def cache_put(db: Session, key: str, *, provider: str, model: str | None, purpose: str, text: str,
              grounding: dict | None, usage: dict | None, ttl_days: int | None = None) -> None:
    if not cfg.get(db, "ai_cache_enabled", True):
        return
    days = ttl_days if ttl_days is not None else int(cfg.get(db, "ai_cache_ttl_days", 30) or 30)
    row = db.get(AICacheEntry, key)
    if row is None:
        row = AICacheEntry(key=key)
        db.add(row)
    row.provider, row.model, row.purpose, row.text = provider, model, purpose[:64], text
    row.grounding, row.usage = grounding, usage or {}
    row.created_at = utcnow()
    row.expires_at = utcnow() + timedelta(days=days)
    db.flush()


# ---------------------------------------------------------------- plafonds
def _day_start() -> datetime:
    n = utcnow()
    return n.replace(hour=0, minute=0, second=0, microsecond=0)


def _month_start() -> datetime:
    return _day_start().replace(day=1)


def calls_since(db: Session, since: datetime, provider: str | None = None) -> int:
    q = db.query(func.count(AICallLog.id)).filter(AICallLog.ts >= since, AICallLog.status.in_(COUNTED_STATUSES))
    if provider:
        q = q.filter(AICallLog.provider == provider)
    return int(q.scalar() or 0)


def month_cost(db: Session) -> float:
    return float(db.query(func.coalesce(func.sum(AICallLog.estimated_cost_usd), 0.0))
                 .filter(AICallLog.ts >= _month_start()).scalar() or 0.0)


def _refuse(db: Session, provider: str, model: str | None, purpose: str, message: str, scope: str,
            retry_after_s: int | None = None) -> None:
    ctx = current_context()
    db.add(AICallLog(provider=provider, model=model, purpose=purpose[:64], status="quota_refused", error=message[:500],
                     investigation_id=ctx.get("investigation_id"), task_id=ctx.get("task_id"), owner_id=ctx.get("owner_id")))
    db.flush()
    raise QuotaExceeded(message, scope=scope, retry_after_s=retry_after_s)


def check_allowed(db: Session, provider: str, model: str | None, purpose: str) -> None:
    """Lève QuotaExceeded si l'appel ne doit pas partir. Ne fait aucun appel réseau."""
    if provider in ("none", "manual"):
        if provider == "manual" and not COST_MODES[mode(db)]["manual_allowed"]:
            raise QuotaExceeded("Mode COMMERCIAL : les abonnements personnels (claude.ai, chatgpt.com) ne peuvent pas servir "
                                "à des clients. Configurez une clé API professionnelle.", scope="mode")
        return
    m = mode(db)
    if provider in PAID_PROVIDERS and not COST_MODES[m]["paid_providers"]:
        _refuse(db, provider, model, purpose, f"Mode GRATUIT : {provider} est un service payant à l'usage. Passez en mode "
                                              "HYBRIDE et fixez un budget pour l'autoriser.", "mode")
    blocked = cfg.get(db, "ai_quota_blocked_until")
    if blocked:
        try:
            until = datetime.fromisoformat(blocked)
        except ValueError:
            until = None
        if until and until > utcnow():
            wait = int((until - utcnow()).total_seconds())
            last = cfg.get(db, "ai_quota_last_error") or {}
            _refuse(db, provider, model, purpose, quota_explanation(last if isinstance(last, dict) else {}, wait),
                    "provider", wait)
    if provider == "ollama":
        return  # modèle local : pas de quota externe
    daily = int(cfg.get(db, "ai_daily_call_limit", 200) or 0)
    if daily and calls_since(db, _day_start()) >= daily:
        _refuse(db, provider, model, purpose, f"Plafond quotidien atteint ({daily} appels IA). Reprise automatique demain "
                                              "ou augmentez le plafond dans Paramètres → Coûts.", "daily")
    per_min = int(cfg.get(db, "ai_minute_call_limit", 8) or 0)
    if per_min and calls_since(db, utcnow() - timedelta(minutes=1)) >= per_min:
        _refuse(db, provider, model, purpose, f"Limite de {per_min} appels par minute atteinte : nouvel essai dans une minute.",
                "minute", 60)
    inv_id = current_context().get("investigation_id")
    if inv_id:
        inv = db.get(Investigation, inv_id)
        if inv and inv.ai_call_ceiling and (inv.ai_calls_used or 0) >= inv.ai_call_ceiling:
            _refuse(db, provider, model, purpose, f"Plafond de l'enquête atteint ({inv.ai_call_ceiling} appels IA). "
                                                  "Augmentez-le pour continuer.", "investigation")
    if _price(db, model):
        budget = float(cfg.get(db, "ai_monthly_budget_usd", 0.0) or 0.0)
        if month_cost(db) >= budget:
            _refuse(db, provider, model, purpose, f"Budget mensuel atteint ({budget:.2f} $). Aucune dépense supplémentaire "
                                                  "sans votre accord.", "budget")


def _price(db: Session, model: str | None) -> Optional[dict]:
    prices = cfg.get(db, "ai_prices", {}) or {}
    if not model or not isinstance(prices, dict):
        return None
    p = prices.get(model)
    return p if isinstance(p, dict) and (p.get("input") or p.get("output")) else None


def estimate_cost(db: Session, model: str | None, usage: dict) -> float:
    p = _price(db, model)
    if not p:
        return 0.0
    out = (usage.get("output_tokens", 0) + usage.get("thinking_tokens", 0)) * float(p.get("output") or 0)
    return round((usage.get("input_tokens", 0) * float(p.get("input") or 0) + out) / 1_000_000, 6)


def record(db: Session, *, provider: str, model: str | None, purpose: str, status: str, usage: dict | None = None,
           duration_ms: int | None = None, request_hash: str | None = None, error: str | None = None,
           attachments: int = 0, web_search: bool = False) -> AICallLog:
    usage = usage or {}
    ctx = current_context()
    row = AICallLog(provider=provider, model=model, purpose=purpose[:64], status=status,
                    investigation_id=ctx.get("investigation_id"), task_id=ctx.get("task_id"), owner_id=ctx.get("owner_id"),
                    input_tokens=int(usage.get("input_tokens", 0) or 0), output_tokens=int(usage.get("output_tokens", 0) or 0),
                    thinking_tokens=int(usage.get("thinking_tokens", 0) or 0), attachments=attachments, web_search=web_search,
                    estimated_cost_usd=estimate_cost(db, model, usage) if status == "ok" else 0.0,
                    duration_ms=duration_ms, request_hash=request_hash, error=(error or "")[:500] or None)
    db.add(row)
    if status in COUNTED_STATUSES and ctx.get("investigation_id"):
        inv = db.get(Investigation, ctx["investigation_id"])
        if inv:
            inv.ai_calls_used = (inv.ai_calls_used or 0) + 1
    db.flush()
    return row


def parse_quota_error(body: str) -> dict:
    """Lit la réponse 429 de Google : quota par minute ou par jour, limite, modèle, délai conseillé."""
    info: dict[str, Any] = {"per_day": False, "per_minute": False, "quota_id": None, "quota_value": None, "model": None,
                            "retry_delay_s": None, "message": None}
    try:
        err = (json.loads(body or "{}") or {}).get("error") or {}
    except (ValueError, TypeError):
        err = {}
    info["message"] = (err.get("message") or "")[:300] or None
    for d in err.get("details") or []:
        for v in d.get("violations") or []:
            qid = str(v.get("quotaId") or "")
            info["quota_id"] = info["quota_id"] or qid or None
            info["quota_value"] = info["quota_value"] or v.get("quotaValue")
            info["model"] = info["model"] or (v.get("quotaDimensions") or {}).get("model")
            if "perday" in qid.lower():
                info["per_day"] = True
            if "perminute" in qid.lower():
                info["per_minute"] = True
        m = re.match(r"(\d+)(?:\.\d+)?s$", str(d.get("retryDelay") or ""))
        if m:
            info["retry_delay_s"] = int(m.group(1))
    if not info["quota_id"] and re.search(r"per\s*day|PerDay|daily", body or "", re.I):
        info["per_day"] = True
    if info["retry_delay_s"] is None:
        m = re.search(r'"retryDelay"\s*:\s*"(\d+)(?:\.\d+)?s"', body or "")
        if m:
            info["retry_delay_s"] = int(m.group(1))
    return info


def _next_pacific_midnight() -> datetime:
    """Les quotas quotidiens de Google repartent à minuit, heure du Pacifique."""
    from zoneinfo import ZoneInfo

    pt = datetime.now(ZoneInfo("America/Los_Angeles"))
    nxt = (pt + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
    return nxt.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


def note_rate_limited(db: Session, body: str) -> tuple[int, dict]:
    """Réponse 429 du fournisseur : suspend TOUS les appels pendant le bon délai.

    Quota du jour → jusqu'au lendemain (minuit, heure du Pacifique) ; sinon délai indiqué par Google, doublé à chaque
    nouveau refus rapproché (1, 2, 4… min, au plus 1 h) pour ne jamais renvoyer des appels voués à l'échec.
    """
    info = parse_quota_error(body)
    if info["per_day"]:
        until = _next_pacific_midnight()
    else:
        base = max(60, (info["retry_delay_s"] or 60) + 2)
        recent = int(db.query(func.count(AICallLog.id)).filter(AICallLog.status == "rate_limited",
                                                                AICallLog.ts >= utcnow() - timedelta(hours=2)).scalar() or 0)
        until = utcnow() + timedelta(seconds=min(3600, base * (2 ** min(recent, 6))))
    wait = int((until - utcnow()).total_seconds())
    cfg.set_value(db, "ai_quota_blocked_until", until.isoformat(timespec="seconds"))
    cfg.set_value(db, "ai_quota_last_error", {**info, "at": utcnow().isoformat(timespec="seconds"),
                                              "until": until.isoformat(timespec="seconds")})
    return wait, info


def quota_explanation(info: dict, wait: int) -> str:
    """Phrase claire pour l'utilisateur à partir du refus de Google."""
    from zoneinfo import ZoneInfo

    until_paris = (utcnow() + timedelta(seconds=wait)).replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo("Europe/Paris"))
    model = f" pour le modèle {info['model']}" if info.get("model") else ""
    limit = f" (limite gratuite : {info['quota_value']} requêtes)" if info.get("quota_value") else ""
    if info.get("per_day"):
        return (f"Google a refusé l'appel : le quota GRATUIT DU JOUR de Gemini est épuisé{model}{limit}. Il se renouvelle "
                f"chaque nuit : GENEALIS ne renverra aucun appel avant {until_paris:%d/%m à %H:%M} (heure de Paris).")
    return (f"Google a refusé l'appel : trop de requêtes Gemini en peu de temps{model}{limit}. GENEALIS attend "
            f"{max(1, round(wait / 60))} min (jusqu'à {until_paris:%H:%M}) avant de réessayer, sans rien renvoyer d'ici là.")


@contextmanager
def concurrency_slot(db: Session, timeout: float = 120.0) -> Iterator[None]:
    """Limite le nombre d'appels IA simultanés dans ce processus."""
    global _semaphore, _sem_size
    size = max(1, int(cfg.get(db, "ai_max_concurrency", 1) or 1))
    with _sem_lock:
        if _semaphore is None or _sem_size != size:
            _semaphore, _sem_size = threading.BoundedSemaphore(size), size
        sem = _semaphore
    if not sem.acquire(timeout=timeout):
        raise QuotaExceeded("Trop d'appels IA simultanés : réessayez dans un instant.", scope="minute", retry_after_s=10)
    try:
        yield
    finally:
        sem.release()


# ---------------------------------------------------------------- tableau de bord
def summary(db: Session) -> dict[str, Any]:
    day, month = _day_start(), _month_start()

    def count(status: str, since: datetime) -> int:
        return int(db.query(func.count(AICallLog.id)).filter(AICallLog.ts >= since, AICallLog.status == status).scalar() or 0)

    by_purpose = [{"purpose": p, "calls": int(n), "cost_usd": round(float(c or 0), 4)} for p, n, c in
                  db.query(AICallLog.purpose, func.count(AICallLog.id), func.sum(AICallLog.estimated_cost_usd))
                  .filter(AICallLog.ts >= month, AICallLog.status.in_(COUNTED_STATUSES))
                  .group_by(AICallLog.purpose).order_by(func.count(AICallLog.id).desc()).limit(12)]
    by_day = [{"day": str(d)[:10], "calls": int(n)} for d, n in
              db.query(func.date(AICallLog.ts), func.count(AICallLog.id))
              .filter(AICallLog.ts >= day - timedelta(days=13), AICallLog.status.in_(COUNTED_STATUSES))
              .group_by(func.date(AICallLog.ts)).order_by(func.date(AICallLog.ts))]
    tokens = db.query(func.coalesce(func.sum(AICallLog.input_tokens), 0), func.coalesce(func.sum(AICallLog.output_tokens), 0),
                      func.coalesce(func.sum(AICallLog.thinking_tokens), 0)).filter(AICallLog.ts >= month).one()
    m = mode(db)
    blocked = cfg.get(db, "ai_quota_blocked_until")
    return {
        "mode": m, "mode_label": COST_MODES[m]["label"], "mode_description": COST_MODES[m]["description"],
        "modes": {k: {"label": v["label"], "description": v["description"]} for k, v in COST_MODES.items()},
        "today": {"calls": calls_since(db, day), "cache_hits": count("cache_hit", day), "refused": count("quota_refused", day),
                  "errors": count("error", day) + count("rate_limited", day)},
        "month": {"calls": calls_since(db, month), "cache_hits": count("cache_hit", month),
                  "estimated_cost_usd": round(month_cost(db), 4), "input_tokens": int(tokens[0]),
                  "output_tokens": int(tokens[1]), "thinking_tokens": int(tokens[2])},
        "limits": {"daily": cfg.get(db, "ai_daily_call_limit", 200), "per_minute": cfg.get(db, "ai_minute_call_limit", 8),
                   "investigation": cfg.get(db, "investigation_ai_call_ceiling", 60),
                   "monthly_budget_usd": cfg.get(db, "ai_monthly_budget_usd", 0.0),
                   "concurrency": cfg.get(db, "ai_max_concurrency", 1)},
        "prices_configured": bool(cfg.get(db, "ai_prices", {})),
        "quota_blocked_until": blocked if blocked and blocked > utcnow().isoformat() else None,
        "quota_detail": (cfg.get(db, "ai_quota_last_error") or None) if blocked and blocked > utcnow().isoformat() else None,
        "cache": {"enabled": bool(cfg.get(db, "ai_cache_enabled", True)),
                  "entries": int(db.query(func.count(AICacheEntry.key)).scalar() or 0),
                  "hits_total": int(db.query(func.coalesce(func.sum(AICacheEntry.hits), 0)).scalar() or 0)},
        "by_purpose": by_purpose, "by_day": by_day,
    }


def recent_calls(db: Session, limit: int = 50, investigation_id: str | None = None) -> list[dict]:
    q = db.query(AICallLog).order_by(AICallLog.id.desc())
    if investigation_id:
        q = q.filter(AICallLog.investigation_id == investigation_id)
    return [{"id": r.id, "ts": r.ts.isoformat(), "provider": r.provider, "model": r.model, "purpose": r.purpose,
             "status": r.status, "input_tokens": r.input_tokens, "output_tokens": r.output_tokens,
             "thinking_tokens": r.thinking_tokens, "estimated_cost_usd": r.estimated_cost_usd, "duration_ms": r.duration_ms,
             "web_search": r.web_search, "attachments": r.attachments, "investigation_id": r.investigation_id,
             "error": r.error} for r in q.limit(limit)]


def dumps_usage(u: dict) -> str:
    return json.dumps(u, sort_keys=True)
