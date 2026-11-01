"""Contexte encyclopédique libre (Wikipédia FR + Wikidata) pour le livre de famille.

- Résumé : https://fr.wikipedia.org/api/rest_v1/page/summary/<titre>
- Blason (P94) et image (P18) : Wikidata, servis par https://commons.wikimedia.org/wiki/Special:FilePath/<fichier>

Tout est mis en cache dans la table `settings` (clé « cache:wiki:<titre> ») ; les échecs (réseau coupé,
page absente) renvoient None et sont aussi mis en cache brièvement pour ne pas ralentir chaque page.
Ces textes décrivent un lieu ou un métier en général : ils sont toujours affichés avec leur source.
"""
from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import quote

from sqlalchemy.orm import Session

from ..models import Setting

logger = logging.getLogger("genealis.wiki")

SUMMARY_URL = "https://fr.wikipedia.org/api/rest_v1/page/summary/{title}"
WIKIDATA_CLAIMS_URL = "https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&entity={qid}"
FILEPATH_URL = "https://commons.wikimedia.org/wiki/Special:FilePath/{name}?width={width}"
USER_AGENT = "GENEALIS-AI/0.3 (logiciel de généalogie ; livre de famille)"
TIMEOUT = 4.0
OK_TTL = timedelta(days=90)
FAIL_TTL = timedelta(hours=12)


class Budget:
    """Limite le temps total passé en appels réseau pour une requête (évite les pages lentes hors ligne)."""

    def __init__(self, seconds: float = 6.0) -> None:
        self.deadline = time.monotonic() + seconds
        self.offline = False  # premier échec réseau : on n'insiste pas pour le reste de la requête

    def left(self) -> float:
        return self.deadline - time.monotonic()

    def ok(self) -> bool:
        return not self.offline and self.left() > 0.3


# ---------- Accès réseau (remplacés par des faux dans les tests) ----------

def fetch_json(url: str, timeout: float = TIMEOUT) -> Optional[dict]:
    """GET JSON ; None en cas d'erreur (hors ligne, 404, délai dépassé)."""
    try:
        import httpx

        r = httpx.get(url, timeout=timeout, headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                      follow_redirects=True)
        if r.status_code != 200:
            return None
        return r.json()
    except Exception as exc:  # réseau indisponible, JSON invalide…
        logger.info("Wikipédia/Wikidata indisponible (%s) : %s", url[:120], exc)
        raise _NetworkError(str(exc)) from exc


class _NetworkError(Exception):
    pass


def fetch_summary(title: str, timeout: float = TIMEOUT) -> Optional[dict]:
    """Résumé REST d'une page Wikipédia FR (None si absente)."""
    return fetch_json(SUMMARY_URL.format(title=quote(title.replace(" ", "_"), safe="")), timeout)


def fetch_claims(qid: str, timeout: float = TIMEOUT) -> Optional[dict]:
    return fetch_json(WIKIDATA_CLAIMS_URL.format(qid=quote(qid)), timeout)


# ---------- Cache ----------

def _cache_key(kind: str, title: str) -> str:
    key = f"cache:wiki:{kind}:{title}"
    if len(key) > 120:
        key = f"cache:wiki:{kind}:" + hashlib.sha1(title.encode("utf-8")).hexdigest()
    return key


def _cache_get(db: Session, key: str) -> tuple[bool, Any]:
    row = db.get(Setting, key)
    if row is None or not isinstance(row.value, dict):
        return False, None
    try:
        ts = datetime.fromisoformat(row.value.get("ts", ""))
    except ValueError:
        return False, None
    ttl = OK_TTL if row.value.get("ok") else FAIL_TTL
    if datetime.now(timezone.utc) - ts > ttl:
        return False, None
    return True, row.value.get("data")


def _cache_set(db: Session, key: str, data: Any) -> None:
    value = {"ok": data is not None, "ts": datetime.now(timezone.utc).isoformat(), "data": data}
    try:
        with db.begin_nested():
            row = db.get(Setting, key)
            if row is None:
                db.add(Setting(key=key, value=value, encrypted=False))
            else:
                row.value = value
    except Exception as exc:  # écriture concurrente : le cache n'est qu'une optimisation
        logger.info("Cache Wikipédia non enregistré (%s) : %s", key, exc)


def cached_only(db: Session, kind: str, title: str) -> Any:
    hit, data = _cache_get(db, _cache_key(kind, title))
    return data if hit else None


# ---------- Recherche ----------

def _summary_ok(s: Optional[dict], want_commune: bool) -> bool:
    if not s or s.get("type") in ("disambiguation", "no-extract") or not s.get("extract"):
        return False
    if want_commune:
        desc = (s.get("description") or "").lower()
        ext = (s.get("extract") or "")[:400].lower()
        return "commune" in desc or "commune" in ext or "village" in ext or "ville" in desc or "ville" in ext
    return True


def _file_url(name: str, width: int = 320) -> str:
    return FILEPATH_URL.format(name=quote(name.replace(" ", "_"), safe=""), width=width)


def _claim_file(claims: dict, prop: str) -> Optional[str]:
    for c in (claims.get("claims") or {}).get(prop, []) or []:
        v = ((c.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(v, str) and v:
            return v
    return None


def _build(s: dict, claims: Optional[dict]) -> dict:
    page = ((s.get("content_urls") or {}).get("desktop") or {}).get("page") or \
        f"https://fr.wikipedia.org/wiki/{quote((s.get('title') or '').replace(' ', '_'))}"
    image = (s.get("thumbnail") or {}).get("source")
    coat = None
    if claims:
        arms = _claim_file(claims, "P94")
        coat = _file_url(arms, 200) if arms else None
        if not image:
            pic = _claim_file(claims, "P18")
            image = _file_url(pic, 400) if pic else None
    return {"title": s.get("title"), "description": s.get("description"), "extract": s.get("extract"),
            "url": page, "image": image, "coat_of_arms": coat, "wikidata": s.get("wikibase_item"),
            "source": "Wikipédia (fr), licence CC BY-SA", "license_url": "https://creativecommons.org/licenses/by-sa/4.0/deed.fr"}


def _lookup(db: Session, kind: str, titles: list[str], want_commune: bool, with_claims: bool,
            budget: Optional[Budget]) -> Optional[dict]:
    key = _cache_key(kind, titles[0])
    hit, data = _cache_get(db, key)
    if hit:
        return data
    if budget is not None and not budget.ok():
        return None  # pas mis en cache : on retentera une autre fois
    result = None
    try:
        for t in titles:
            if budget is not None and not budget.ok():
                return None
            s = fetch_summary(t, timeout=min(TIMEOUT, budget.left()) if budget else TIMEOUT)
            if _summary_ok(s, want_commune):
                claims = None
                if with_claims and s.get("wikibase_item") and (budget is None or budget.ok()):
                    try:
                        claims = fetch_claims(s["wikibase_item"], timeout=min(TIMEOUT, budget.left()) if budget else TIMEOUT)
                    except _NetworkError:
                        claims = None
                result = _build(s, claims)
                break
    except _NetworkError:
        if budget is not None:
            budget.offline = True
        _cache_set(db, key, None)
        return None
    _cache_set(db, key, result)
    return result


def place_context(db: Session, name: str, department: Optional[str] = None,
                  budget: Optional[Budget] = None) -> Optional[dict]:
    """Résumé Wikipédia d'une commune (+ blason et image Wikidata), ou None."""
    if not name:
        return None
    titles = [f"{name} ({department})"] if department and department.lower() not in name.lower() else []
    titles.append(name)
    return _lookup(db, "place", titles, want_commune=True, with_claims=True, budget=budget)


def trade_context(db: Session, label: str, budget: Optional[Budget] = None) -> Optional[dict]:
    """Résumé Wikipédia d'un métier, ou None."""
    if not label:
        return None
    t = label.strip()
    titles = [t[:1].upper() + t[1:]]
    if "(" not in t:
        titles.append(f"{titles[0]} (métier)")
    return _lookup(db, "trade", titles, want_commune=False, with_claims=False, budget=budget)
