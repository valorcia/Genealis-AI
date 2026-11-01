"""Cadre des connecteurs d'archives.

Chaque connecteur déclare ses capacités (collections, zones, périodes, mode d'accès, limites, droits).
Un connecteur n'est jamais affiché comme opérationnel tant que `self_test` n'a pas réussi.
Aucun contournement de CAPTCHA, d'authentification ou de protection anti-robot.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, ClassVar, Optional
from urllib.parse import urlencode, urlparse

import httpx

from ..config import settings

logger = logging.getLogger("genealis.connectors")

ACCESS_MODES = ("api", "html", "browser", "manual")
# api : API documentée ; html : lecture de pages publiques (fragile) ; browser : ouverture dans le navigateur ;
# manual : import manuel de documents


@dataclass
class ConnectorCapabilities:
    id: str
    name: str
    country: str
    organization: str
    collections: list[str]
    areas: list[str]
    period_start: Optional[int]
    period_end: Optional[int]
    search_fields: list[str]  # surname, given_names, year, commune, register_type...
    access_mode: str
    limitations: list[str]
    terms_url: Optional[str]
    reuse_terms: str
    formats: list[str]
    homepage: str
    languages: list[str] = field(default_factory=lambda: ["fr"])
    requires_credentials: bool = False
    notes: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SearchQuery:
    surname: Optional[str] = None
    given_names: Optional[str] = None
    year_from: Optional[int] = None
    year_to: Optional[int] = None
    commune: Optional[str] = None
    department: Optional[str] = None
    register_type: Optional[str] = None  # birth | marriage | death | census | military | any
    birth_date: Optional[str] = None
    extra: dict[str, Any] = field(default_factory=dict)

    def fingerprint(self) -> str:
        return hashlib.sha1(json.dumps(asdict(self), sort_keys=True, default=str).encode()).hexdigest()[:16]

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SearchResult:
    connector_id: str
    title: str
    url: Optional[str]
    snippet: Optional[str] = None
    record_type: Optional[str] = None
    year: Optional[int] = None
    date_text: Optional[str] = None
    place: Optional[str] = None
    reference: Optional[str] = None
    repository: Optional[str] = None
    reliability: str = "unknown"
    candidate: dict[str, Any] = field(default_factory=dict)  # données nominatives extraites
    raw: dict[str, Any] = field(default_factory=dict)
    external_id: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


class RateLimiter:
    def __init__(self) -> None:
        self._last: dict[str, float] = {}

    async def wait(self, key: str, min_interval: float) -> None:
        now = time.monotonic()
        last = self._last.get(key, 0.0)
        delay = min_interval - (now - last)
        if delay > 0:
            await asyncio.sleep(delay)
        self._last[key] = time.monotonic()


rate_limiter = RateLimiter()


class ArchiveConnector:
    capabilities: ClassVar[ConnectorCapabilities]
    min_interval: ClassVar[float] = 2.0

    def __init__(self) -> None:
        self.cache_dir = settings.cache_dir / self.capabilities.id
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    @property
    def id(self) -> str:
        return self.capabilities.id

    # ---- HTTP partagé ----
    async def fetch(self, url: str, *, params: dict | None = None, method: str = "GET", json_body: Any = None,
                    headers: dict | None = None, timeout: float | None = None, use_cache: bool = True) -> httpx.Response:
        timeout = min(timeout or settings.request_timeout, settings.request_timeout)
        await rate_limiter.wait(self.id, max(self.min_interval, settings.connector_min_interval))
        h = {"User-Agent": settings.user_agent, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5"}
        if headers:
            h.update(headers)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=h) as client:
            resp = await client.request(method, url, params=params, json=json_body)
        if resp.status_code in (401, 403, 429) or "captcha" in resp.text[:5000].lower():
            raise AccessRestricted(f"{self.capabilities.name} : accès restreint (HTTP {resp.status_code}). "
                                   "Aucun contournement n'est tenté ; ouvrez le site dans votre navigateur.")
        return resp

    async def robots_allows(self, url: str) -> Optional[bool]:
        """Vérifie robots.txt (meilleur effort). None si indéterminé."""
        try:
            parsed = urlparse(url)
            base = f"{parsed.scheme}://{parsed.netloc}"
            r = await self.fetch(f"{base}/robots.txt", use_cache=False, timeout=10)
            if r.status_code != 200:
                return None
            from urllib.robotparser import RobotFileParser

            rp = RobotFileParser()
            rp.parse(r.text.splitlines())
            return rp.can_fetch(settings.user_agent, url) and rp.can_fetch("*", url)
        except Exception:
            return None

    # ---- à implémenter ----
    async def search(self, query: SearchQuery) -> list[SearchResult]:
        raise NotImplementedError

    def browse_url(self, query: SearchQuery) -> Optional[str]:
        """URL à ouvrir dans le navigateur pour une recherche manuelle."""
        return self.capabilities.homepage

    async def self_test(self) -> dict:
        """Test réel de connectivité et de fonctionnement. Retourne {ok, status, details}."""
        try:
            r = await self.fetch(self.capabilities.homepage, timeout=15, use_cache=False)
            ok = r.status_code == 200
            return {"ok": ok, "status": "ok" if ok else "degraded",
                    "details": {"homepage_http": r.status_code, "mode": self.capabilities.access_mode}}
        except AccessRestricted as exc:
            return {"ok": False, "status": "manual", "details": {"error": str(exc)}}
        except Exception as exc:
            return {"ok": False, "status": "failed", "details": {"error": str(exc)}}


class AccessRestricted(Exception):
    pass


class ConnectorRegistry:
    def __init__(self) -> None:
        self._connectors: dict[str, ArchiveConnector] = {}

    def register(self, connector: ArchiveConnector) -> None:
        self._connectors[connector.id] = connector

    def get(self, cid: str) -> ArchiveConnector | None:
        return self._connectors.get(cid)

    def all(self) -> list[ArchiveConnector]:
        return list(self._connectors.values())

    def for_query(self, query: SearchQuery, country_hint: str | None = None) -> list[ArchiveConnector]:
        out = []
        for c in self._connectors.values():
            caps = c.capabilities
            if caps.access_mode in ("browser", "manual"):
                continue
            if country_hint and caps.country not in (country_hint, "*"):
                continue
            if query.department and caps.areas and "*" not in caps.areas and query.department not in caps.areas:
                continue
            if query.year_from and caps.period_end and query.year_from > caps.period_end:
                continue
            if query.year_to and caps.period_start and query.year_to < caps.period_start:
                continue
            out.append(c)
        return out


registry = ConnectorRegistry()
