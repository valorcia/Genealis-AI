"""Choix de la stratégie la moins chère pour chaque recherche.

Échelle (de la moins chère à la plus chère) :
  0 `reuse`          données déjà extraites / mémoire de l'enquête / cache IA : 0 appel
  1 `free_connectors` connecteurs gratuits existants (API publiques : Gallica, Open Archives…) : 0 appel IA
  2 `web_search`     recherche web Gemini + Google Search (1 appel IA, sources vérifiables)
  3 `playwright`     navigation déterministe par le worker local (0 appel IA)
  4 `browser_agent`  agent Browser Use + Gemini sur le worker local (plusieurs appels IA, plafonné en étapes)
  5 `human`          l'utilisateur agit (CAPTCHA, connexion, site interdisant l'automatisation)

Le choix dépend du mode de coût (GRATUIT / HYBRIDE / COMMERCIAL), des quotas restants et de ce qui a déjà échoué.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from ..models import Investigation
from ..services import cost
from ..services import settings_service as cfg

LADDER = ("reuse", "free_connectors", "web_search", "playwright", "browser_agent", "human")
UTILITY_CONNECTORS = {"geo_api_gouv", "nominatim", "wikidata", "gemini_web"}
MAX_FREE_CONNECTORS = 4
# Appels IA à garder en réserve pour la lecture des documents trouvés (plus utile qu'une recherche de plus)
RESERVE_FOR_DOCUMENTS = 2


@dataclass
class Choice:
    strategy: str
    reason: str
    kind: str  # kind de tâche à créer : web_search | browse | human_assist

    def to_dict(self) -> dict:
        return {"strategy": self.strategy, "reason": self.reason, "kind": self.kind}


def domain_of(url: str | None) -> str:
    return (urlparse(url or "").netloc or "").lower().replace("www.", "")


def no_auto(url: str | None) -> bool:
    """Sites dont les conditions interdisent l'automatisation : ouverture pour l'utilisateur uniquement."""
    from ..services.web_archive import NO_AUTO

    d = domain_of(url)
    return bool(d) and any(x in d for x in NO_AUTO)


def ai_calls_remaining(db: Session, inv: Investigation | None) -> int:
    """Appels IA encore possibles (minimum du plafond quotidien et du plafond de l'enquête). N'envoie rien."""
    left = 10 ** 6
    daily = int(cfg.get(db, "ai_daily_call_limit", 200) or 0)
    if daily:
        left = min(left, daily - cost.calls_since(db, cost._day_start()))
    if inv is not None and inv.ai_call_ceiling:
        left = min(left, int(inv.ai_call_ceiling) - int(inv.ai_calls_used or 0))
    return max(0, left)


def ai_search_possible(db: Session) -> bool:
    try:
        from ..ai.providers import AIClient

        return AIClient(db).can_search_web()
    except Exception:  # pragma: no cover - configuration illisible
        return False


def worker_online(db: Session, max_age_s: int = 90) -> bool:
    from datetime import datetime

    from ..models import utcnow

    seen = cfg.get(db, "worker_last_seen")
    if not seen:
        return False
    try:
        ts = datetime.fromisoformat(str(seen).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return False
    return (utcnow() - ts).total_seconds() < max_age_s


def browser_enabled(db: Session) -> bool:
    return cfg.get(db, "browser_mode", "local_worker") != "off"


def free_connectors(db: Session, query) -> list:
    """Connecteurs gratuits automatisables pertinents pour cette requête (aucun appel IA)."""
    from ..connectors import registry_service  # noqa: F401 - enregistre tous les connecteurs
    from ..connectors.base import registry
    from ..models import ConnectorStatus

    disabled = {r.connector_id for r in db.query(ConnectorStatus).filter(ConnectorStatus.enabled == False)}  # noqa: E712
    hint = (query.extra or {}).get("country") if getattr(query, "extra", None) else None
    out = []
    for c in registry.for_query(query, country_hint=hint):
        caps = c.capabilities
        if caps.id in UTILITY_CONNECTORS or caps.id in disabled or caps.requires_credentials:
            continue
        if caps.id in ("insee_deces", "insee_deces_local") and query.register_type != "death":
            continue
        out.append(c)
    return out[:MAX_FREE_CONNECTORS]


def for_search(db: Session, inv: Investigation, *, attempts_failed: int = 0, previous: Optional[str] = None) -> Choice:
    """Stratégie pour une recherche nominative (tâche web_search)."""
    if previous in (None, "reuse", "free_connectors") and ai_search_possible(db):
        if ai_calls_remaining(db, inv) > RESERVE_FOR_DOCUMENTS:
            return Choice("web_search", "Recherche web Gemini avec sources vérifiables (1 appel IA).", "web_search")
        reason = "Quota d'appels IA presque atteint : la recherche web IA est réservée."
    else:
        reason = "Recherche web IA indisponible (Gemini non configuré ou non autorisé)."
    if browser_enabled(db):
        return Choice("playwright", reason + " Navigation déterministe par le worker local (0 appel IA).", "browse")
    return Choice("human", reason + " Navigateur désactivé : consultation par l'utilisateur.", "human_assist")


def for_browse(db: Session, inv: Investigation, url: str | None, *, attempts_failed: int = 0,
               previous: Optional[str] = None) -> Choice:
    """Stratégie pour ouvrir une page / un registre : Playwright, puis agent IA, puis humain."""
    if url and no_auto(url):
        return Choice("human", f"{domain_of(url)} interdit la consultation automatisée : ouverture pour vous uniquement.",
                      "human_assist")
    if not browser_enabled(db):
        return Choice("human", "Navigateur désactivé dans les paramètres : consultation par l'utilisateur.", "human_assist")
    if previous in (None, "playwright") and attempts_failed == 0:
        return Choice("playwright", "Recette déterministe Playwright (0 appel IA).", "browse")
    if previous in (None, "playwright") and ai_calls_remaining(db, inv) > RESERVE_FOR_DOCUMENTS + 5:
        mode = cost.mode(db)
        if mode in ("free", "hybrid", "commercial"):
            return Choice("browser_agent", "La recette déterministe a échoué : agent Browser Use (Gemini, étapes plafonnées).",
                          "browse")
    return Choice("human", "Les stratégies automatiques ont échoué ou les quotas sont épuisés : assistance humaine.",
                  "human_assist")


def for_document(db: Session, inv: Investigation) -> Choice:
    """Lecture d'un document : réutilise une lecture existante, sinon 1 appel IA (si quota)."""
    if ai_calls_remaining(db, inv) <= 0:
        return Choice("human", "Plus d'appel IA disponible : transcription manuelle (copier-coller) proposée.", "human_assist")
    return Choice("reuse", "Lecture existante réutilisée si présente, sinon lecture IA (1 appel, mis en cache).",
                  "analyze_document")
