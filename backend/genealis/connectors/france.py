"""Connecteurs France."""
from __future__ import annotations

import re
from html import unescape
from typing import Optional
from urllib.parse import quote_plus, urlencode

from .base import AccessRestricted, ArchiveConnector, ConnectorCapabilities, SearchQuery, SearchResult, registry

UNVERIFIED = "Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi."


class InseeDecesConnector(ArchiveConnector):
    """Fichier des personnes décédées (INSEE, open data) via l'API publique matchID.

    Source officielle : https://deces.matchid.io (ministère de l'Intérieur / INSEE). Couvre les décès
    survenus en France depuis 1970 (données ouvertes, licence ouverte Etalab).
    """

    capabilities = ConnectorCapabilities(
        id="insee_deces", name="Fichier des décès INSEE (matchID)", country="FR",
        organization="INSEE / ministère de l'Intérieur (matchID)",
        collections=["Fichier des personnes décédées depuis 1970"], areas=["*"], period_start=1970, period_end=None,
        search_fields=["surname", "given_names", "birth_date", "year_from", "year_to", "commune"],
        access_mode="api", limitations=["Décès survenus en France uniquement", "Depuis 1970 seulement",
                                        "Limitation de débit côté serveur"],
        terms_url="https://deces.matchid.io/about", reuse_terms="Licence Ouverte 2.0 (Etalab)",
        formats=["json"], homepage="https://deces.matchid.io", notes=UNVERIFIED,
    )
    min_interval = 1.5
    API = "https://deces.matchid.io/deces/api/v1/search"

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        body: dict = {"size": 20}
        if query.surname:
            body["lastName"] = query.surname
        if query.given_names:
            body["firstName"] = query.given_names.split()[0]
        if query.birth_date:
            body["birthDate"] = query.birth_date.replace("-", "")
        if query.commune:
            body["birthCity"] = query.commune
        if query.year_from or query.year_to:
            body["deathDate"] = f"{query.year_from or 1970}-{query.year_to or 2026}"
        r = await self.fetch(self.API, method="POST", json_body=body, headers={"Accept": "application/json"})
        if r.status_code != 200:
            raise RuntimeError(f"matchID HTTP {r.status_code}")
        data = r.json()
        persons = (data.get("response") or {}).get("persons") or []
        out = []
        for p in persons:
            name = p.get("name") or {}
            first = " ".join(name.get("first") or [])
            last = name.get("last") or ""
            birth = p.get("birth") or {}
            death = p.get("death") or {}
            bloc = birth.get("location") or {}
            dloc = death.get("location") or {}
            bdate = _iso_from_compact(birth.get("date"))
            ddate = _iso_from_compact(death.get("date"))
            out.append(SearchResult(
                connector_id=self.id, title=f"{first} {last} ({bdate or '?'} – {ddate or '?'})",
                url=f"https://deces.matchid.io/id/{p.get('id')}" if p.get("id") else self.capabilities.homepage,
                snippet=f"Né(e) {bdate or '?'} à {bloc.get('city') or '?'} ({bloc.get('departmentCode') or bloc.get('country') or '?'}), "
                        f"décédé(e) {ddate or '?'} à {dloc.get('city') or '?'}",
                record_type="death", year=int(ddate[:4]) if ddate else None, date_text=ddate,
                place=dloc.get("city"), reference=p.get("id"), repository="INSEE", reliability="secondary",
                candidate={"surname": last, "given_names": first, "sex": (p.get("sex") or "")[:1] or None,
                           "birth_year": int(bdate[:4]) if bdate else None, "birth_place": bloc.get("city"),
                           "death_year": int(ddate[:4]) if ddate else None, "death_place": dloc.get("city"),
                           "event_year": int(ddate[:4]) if ddate else None, "extra": {"event_type": "death", "score": p.get("score")}},
                raw=p, external_id=p.get("id"),
            ))
        return out

    def browse_url(self, query: SearchQuery) -> Optional[str]:
        q = " ".join(x for x in (query.given_names, query.surname) if x)
        return f"https://deces.matchid.io/search?q={quote_plus(q)}"

    async def self_test(self) -> dict:
        try:
            res = await self.search(SearchQuery(surname="Martin", given_names="Jean", year_from=1990, year_to=1991))
            return {"ok": True, "status": "ok", "details": {"sample_results": len(res)}}
        except AccessRestricted as exc:
            return {"ok": False, "status": "manual", "details": {"error": str(exc)}}
        except Exception as exc:
            return {"ok": False, "status": "failed", "details": {"error": str(exc)}}


def _iso_from_compact(s: str | None) -> str | None:
    if not s:
        return None
    s = str(s)
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return s


class GeoApiGouvConnector(ArchiveConnector):
    """Référentiel officiel des communes françaises (geo.api.gouv.fr) : utilitaire de lieux."""

    capabilities = ConnectorCapabilities(
        id="geo_api_gouv", name="Référentiel des communes (geo.api.gouv.fr)", country="FR",
        organization="Etalab / IGN", collections=["Communes, départements, coordonnées"], areas=["*"],
        period_start=None, period_end=None, search_fields=["commune"], access_mode="api",
        limitations=["Communes actuelles uniquement (pas de communes disparues)"],
        terms_url="https://geo.api.gouv.fr/", reuse_terms="Licence Ouverte", formats=["json"],
        homepage="https://geo.api.gouv.fr", notes="Utilisé pour géocoder les lieux. " + UNVERIFIED,
    )
    min_interval = 0.5

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        if not query.commune:
            return []
        r = await self.fetch("https://geo.api.gouv.fr/communes",
                             params={"nom": query.commune, "fields": "departement,centre,codesPostaux,population",
                                     "boost": "population", "limit": 5})
        out = []
        for c in r.json():
            centre = (c.get("centre") or {}).get("coordinates") or [None, None]
            dep = c.get("departement") or {}
            out.append(SearchResult(connector_id=self.id, title=c.get("nom", ""), url=None, record_type="place",
                                    place=c.get("nom"), reference=c.get("code"),
                                    raw={"lat": centre[1], "lon": centre[0], "department": dep.get("nom"),
                                         "department_code": dep.get("code"), "insee": c.get("code")}))
        return out

    async def self_test(self) -> dict:
        try:
            res = await self.search(SearchQuery(commune="Nancy"))
            ok = any(r.title.lower() == "nancy" for r in res)
            return {"ok": ok, "status": "ok" if ok else "degraded", "details": {"results": len(res)}}
        except Exception as exc:
            return {"ok": False, "status": "failed", "details": {"error": str(exc)}}


class FranceArchivesConnector(ArchiveConnector):
    """Portail national FranceArchives : moteur de recherche fédéré (inventaires, Grand Mémorial, bases nominatives).

    Lecture des pages de résultats publiques (HTML). Fragile : à revalider à chaque évolution du site.
    """

    capabilities = ConnectorCapabilities(
        id="francearchives", name="FranceArchives (portail national)", country="FR",
        organization="Service interministériel des Archives de France",
        collections=["Inventaires des archives publiques", "Grand Mémorial (militaires 14-18)", "Bases nominatives agrégées"],
        areas=["*"], period_start=800, period_end=2026,
        search_fields=["surname", "given_names", "commune", "year_from", "year_to"], access_mode="html",
        limitations=["Résultats d'inventaires, rarement des actes nominatifs", "Pages HTML : analyse fragile",
                     "Les images restent sur les sites des services d'archives"],
        terms_url="https://francearchives.gouv.fr/fr/cgu", reuse_terms="Licence Ouverte pour les métadonnées (vérifier par fonds)",
        formats=["html"], homepage="https://francearchives.gouv.fr", notes=UNVERIFIED,
    )
    min_interval = 3.0

    def _q(self, query: SearchQuery) -> str:
        parts = [query.given_names, query.surname, query.commune]
        return " ".join(p for p in parts if p)

    def browse_url(self, query: SearchQuery) -> Optional[str]:
        return "https://francearchives.gouv.fr/fr/search?" + urlencode({"q": self._q(query)})

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        url = self.browse_url(query)
        allowed = await self.robots_allows(url)
        if allowed is False:
            raise AccessRestricted("FranceArchives : robots.txt interdit l'accès automatisé à la recherche.")
        r = await self.fetch(url)
        if r.status_code != 200:
            raise RuntimeError(f"FranceArchives HTTP {r.status_code}")
        return self._parse(r.text)

    def _parse(self, html: str) -> list[SearchResult]:
        out = []
        # Liens de résultats : <a href="/fr/facomponent/..."> ou /fr/findingaid/... ou /fr/commemo/...
        for m in re.finditer(r'<a[^>]+href="(/fr/(?:facomponent|findingaid|commemo|basedenoms|circular|authorityrecord)/[^"#]+)"[^>]*>(.*?)</a>', html, re.S):
            href, inner = m.group(1), re.sub(r"<[^>]+>", " ", m.group(2))
            title = unescape(re.sub(r"\s+", " ", inner)).strip()
            if not title or len(title) < 3:
                continue
            years = re.findall(r"\b(1[5-9]\d{2}|20\d{2})\b", title)
            out.append(SearchResult(connector_id=self.id, title=title[:300], url="https://francearchives.gouv.fr" + href,
                                    record_type="inventory", year=int(years[0]) if years else None,
                                    repository="FranceArchives", reliability="secondary",
                                    raw={"href": href}))
        # Dédoublonnage par URL
        seen, uniq = set(), []
        for r in out:
            if r.url not in seen:
                seen.add(r.url)
                uniq.append(r)
        return uniq[:50]


class BrowserAssistedConnector(ArchiveConnector):
    """Service d'archives sans API : l'application construit l'URL d'entrée et ouvre le navigateur.

    L'utilisateur consulte, télécharge l'image s'il y est autorisé, puis l'importe pour analyse.
    """

    def __init__(self, caps: ConnectorCapabilities, search_url_template: str | None = None) -> None:
        self.capabilities = caps
        self._tpl = search_url_template
        super().__init__()

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        raise AccessRestricted(f"{self.capabilities.name} ne propose pas de recherche automatisable : "
                               f"ouvrez {self.browse_url(query)} dans votre navigateur.")

    def browse_url(self, query: SearchQuery) -> Optional[str]:
        if self._tpl:
            return self._tpl.format(surname=quote_plus(query.surname or ""), given=quote_plus(query.given_names or ""),
                                    commune=quote_plus(query.commune or ""), year=query.year_from or "")
        return self.capabilities.homepage


def _ad(id_: str, name: str, dep: str, homepage: str, collections: list[str], notes: str = "",
        period_start: int = 1500, tpl: str | None = None, platform: str | None = None) -> BrowserAssistedConnector:
    lim = ["Pas d'API publique connue : consultation par navigateur",
           "Les images sont consultables en ligne ; réutilisation selon le règlement du service"]
    if platform:
        lim.append(f"Plateforme de consultation : {platform}")
    caps = ConnectorCapabilities(
        id=id_, name=name, country="FR", organization=name, collections=collections, areas=[dep],
        period_start=period_start, period_end=1950, search_fields=["commune", "register_type", "year_from"],
        access_mode="browser", limitations=lim, terms_url=homepage, reuse_terms="Règlement de réutilisation du service",
        formats=["images en ligne (visionneuse)"], homepage=homepage, notes=(notes + " " + UNVERIFIED).strip(),
    )
    return BrowserAssistedConnector(caps, tpl)


FRENCH_AD = [
    _ad("ad54", "Archives départementales de Meurthe-et-Moselle", "54", "https://archives.meurthe-et-moselle.fr",
        ["État civil et registres paroissiaux", "Tables décennales", "Recensements", "Registres matricules",
         "Archives notariales (inventaires)"], notes="Priorité 1 du projet (Nancy, Lunéville, Toul, Briey, Longwy)."),
    _ad("ad57", "Archives départementales de la Moselle", "57", "https://www.archives57.com",
        ["État civil et registres paroissiaux", "Tables décennales", "Recensements", "Registres matricules",
         "Optants 1872"], notes="Documents en français et en allemand (annexion 1871-1918)."),
    _ad("ad55", "Archives départementales de la Meuse", "55", "https://archives.meuse.fr",
        ["État civil et registres paroissiaux", "Tables décennales", "Recensements", "Registres matricules"]),
    _ad("ad88", "Archives départementales des Vosges", "88", "https://archives.vosges.fr",
        ["État civil et registres paroissiaux", "Tables décennales", "Recensements", "Registres matricules"]),
    _ad("ad70", "Archives départementales de la Haute-Saône", "70", "https://archives.haute-saone.fr",
        ["État civil et registres paroissiaux", "Tables décennales", "Recensements", "Registres matricules"]),
    _ad("ad52", "Archives départementales de la Haute-Marne", "52", "https://archives.haute-marne.fr",
        ["État civil et registres paroissiaux", "Tables décennales", "Recensements", "Registres matricules"]),
    _ad("am_nancy", "Archives municipales de Nancy", "54", "https://www.nancy.fr/culturelle/archives-municipales",
        ["État civil de Nancy", "Recensements de Nancy", "Listes électorales", "Fonds iconographiques"], period_start=1600),
    _ad("archives_nationales", "Archives nationales (salle des inventaires virtuelle)", "*",
        "https://www.siv.archives-nationales.culture.gouv.fr",
        ["Minutier central des notaires de Paris", "Naturalisations (dossiers BB/11)", "Légion d'honneur (Léonore)"],
        period_start=800),
    _ad("memoire_des_hommes", "Mémoire des Hommes (ministère des Armées)", "*",
        "https://www.memoiredeshommes.sga.defense.gouv.fr",
        ["Morts pour la France 1914-1918", "Registres matricules (partiels)", "Personnels de l'armée de terre"],
        period_start=1700, tpl="https://www.memoiredeshommes.sga.defense.gouv.fr/fr/arkotheque/client/mdh/base_morts_pour_la_france_premiere_guerre/resus_rech.php?nom={surname}&prenoms={given}"),
    _ad("leonore", "Base Léonore (Légion d'honneur)", "*", "https://www.leonore.archives-nationales.culture.gouv.fr",
        ["Dossiers de légionnaires 1802-1977"], period_start=1802),
]

for c in (InseeDecesConnector(), GeoApiGouvConnector(), FranceArchivesConnector(), *FRENCH_AD):
    registry.register(c)
