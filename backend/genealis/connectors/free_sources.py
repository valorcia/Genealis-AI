"""Sources gratuites, sans clé API ni inscription.

Toutes ces sources sont publiques et accessibles sans authentification. Les capacités sont déclarées
d'après la documentation publique et restent « non vérifiées » tant que le test réel n'a pas réussi.
"""
from __future__ import annotations

import re
from html import unescape
from typing import Optional
from urllib.parse import quote_plus, urlencode
from xml.etree import ElementTree as ET

from .base import AccessRestricted, ArchiveConnector, ConnectorCapabilities, SearchQuery, SearchResult, registry
from .france import UNVERIFIED, BrowserAssistedConnector


class GallicaConnector(ArchiveConnector):
    """Gallica (BnF) – API SRU publique : presse ancienne, annuaires, almanachs, registres imprimés."""

    capabilities = ConnectorCapabilities(
        id="gallica", name="Gallica (BnF) – presse et imprimés", country="FR", organization="Bibliothèque nationale de France",
        collections=["Presse régionale et nationale (Est Républicain partiel, Journal de la Meurthe...)", "Annuaires et almanachs",
                     "Bottins", "Monographies et nobiliaires", "Bulletins des lois (naturalisations)"],
        areas=["*"], period_start=1600, period_end=1950, search_fields=["surname", "given_names", "commune", "year_from", "year_to"],
        access_mode="api", limitations=["Recherche plein texte dans l'OCR : bruit et faux positifs possibles",
                                        "Mentions dans la presse = indices, pas des actes"],
        terms_url="https://gallica.bnf.fr/edit/und/conditions-dutilisation-des-contenus-de-gallica",
        reuse_terms="Usage non commercial libre ; gratuit, sans clé", formats=["xml", "images"], homepage="https://gallica.bnf.fr",
        notes="API SRU documentée (https://api.bnf.fr/fr/api-gallica-de-recherche). " + UNVERIFIED,
    )
    min_interval = 2.0
    SRU = "https://gallica.bnf.fr/SRU"

    def _cql(self, query: SearchQuery) -> str:
        words = " ".join(x for x in (query.given_names, query.surname) if x).strip()
        parts = [f'(gallica all "{words}")'] if words else []
        if query.commune:
            parts.append(f'(gallica all "{query.commune}")')
        if query.year_from or query.year_to:
            parts.append(f'(dc.date >= "{query.year_from or 1500}" and dc.date <= "{query.year_to or 2026}")')
        return " and ".join(parts) or '(gallica all "genealogie")'

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        params = {"operation": "searchRetrieve", "version": "1.2", "query": self._cql(query), "maximumRecords": 20}
        r = await self.fetch(self.SRU, params=params)
        if r.status_code != 200:
            raise RuntimeError(f"Gallica HTTP {r.status_code}")
        return self._parse(r.text, query)

    def _parse(self, xml: str, query: SearchQuery) -> list[SearchResult]:
        out = []
        try:
            root = ET.fromstring(xml.encode("utf-8") if isinstance(xml, str) else xml)
        except ET.ParseError:
            return out
        ns = {"srw": "http://www.loc.gov/zing/srw/", "dc": "http://purl.org/dc/elements/1.1/", "oai_dc": "http://www.openarchives.org/OAI/2.0/oai_dc/"}
        for rec in root.iterfind(".//srw:record", ns):
            def tx(tag: str) -> list[str]:
                return [e.text.strip() for e in rec.iterfind(f".//dc:{tag}", ns) if e.text]
            title = (tx("title") or ["Document Gallica"])[0]
            ident = next((i for i in tx("identifier") if i.startswith("http")), None)
            dates = tx("date")
            year = None
            for d in dates:
                m = re.search(r"(1[5-9]\d{2}|20\d{2})", d)
                if m:
                    year = int(m.group(1))
                    break
            out.append(SearchResult(connector_id=self.id, title=title[:300], url=ident, snippet="; ".join(tx("description"))[:400] or None,
                                    record_type="press", year=year, date_text=dates[0] if dates else None, repository="BnF – Gallica",
                                    reliability="secondary", raw={"type": tx("type"), "publisher": tx("publisher")},
                                    external_id=ident))
        return out

    def browse_url(self, query: SearchQuery) -> Optional[str]:
        words = " ".join(x for x in (query.given_names, query.surname, query.commune) if x)
        return "https://gallica.bnf.fr/services/engine/search/sru?operation=searchRetrieve&version=1.2&query=" + quote_plus(f'(gallica all "{words}")')

    async def self_test(self) -> dict:
        try:
            res = await self.search(SearchQuery(surname="Nancy", year_from=1900, year_to=1910))
            return {"ok": True, "status": "ok", "details": {"sample_results": len(res)}}
        except AccessRestricted as exc:
            return {"ok": False, "status": "manual", "details": {"error": str(exc)}}
        except Exception as exc:
            return {"ok": False, "status": "failed", "details": {"error": str(exc)}}


class OpenArchivesConnector(ArchiveConnector):
    """Open Archives (openarchieven.nl) – API JSON gratuite : actes des Pays-Bas, Belgique et sources partenaires."""

    capabilities = ConnectorCapabilities(
        id="openarch", name="Open Archives (Pays-Bas / Belgique)", country="BE", organization="Open Archieven (Coret Genealogie)",
        collections=["État civil et registres paroissiaux néerlandais", "Actes belges (partiel)", "Index de recensements, notaires, militaires"],
        areas=["*"], period_start=1500, period_end=1970, search_fields=["surname", "given_names", "year_from", "year_to"],
        access_mode="api", limitations=["Couverture surtout Pays-Bas ; Belgique et France frontalière partielles"],
        terms_url="https://www.openarch.nl/api/docs/", reuse_terms="API publique gratuite ; mention de la source demandée",
        formats=["json"], homepage="https://www.openarch.nl", languages=["nl", "fr", "en"], notes=UNVERIFIED,
    )
    min_interval = 1.5
    API = "https://api.openarch.nl/1.0/records/search.json"

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        name = " ".join(x for x in (query.given_names, query.surname) if x)
        if not name:
            return []
        params = {"name": name, "lang": "fr", "number_show": 20}
        if query.year_from and query.year_to:
            params["eventtype"] = ""
            params["period"] = f"{query.year_from}-{query.year_to}"
        r = await self.fetch(self.API, params=params, headers={"Accept": "application/json"})
        if r.status_code != 200:
            raise RuntimeError(f"OpenArch HTTP {r.status_code}")
        data = r.json()
        out = []
        for d in (data.get("response") or {}).get("docs") or []:
            year = d.get("eventyear")
            out.append(SearchResult(connector_id=self.id, title=f"{d.get('personname') or name} – {d.get('eventtype') or ''} {year or ''}".strip(),
                                    url=d.get("url"), snippet=f"{d.get('sourcetype') or ''} – {d.get('eventplace') or ''} ({d.get('archive') or ''})",
                                    record_type=d.get("eventtype"), year=int(year) if year else None, place=d.get("eventplace"),
                                    repository=d.get("archive"), reliability="secondary", external_id=d.get("identifier"),
                                    candidate={"surname": query.surname, "given_names": query.given_names, "event_year": int(year) if year else None,
                                               "event_place": d.get("eventplace")}, raw=d))
        return out

    def browse_url(self, query: SearchQuery) -> Optional[str]:
        return "https://www.openarch.nl/search.php?" + urlencode({"name": " ".join(x for x in (query.given_names, query.surname) if x), "lang": "fr"})


class InternetArchiveConnector(ArchiveConnector):
    """Internet Archive – recherche avancée JSON gratuite (livres numérisés, annuaires, histoires locales)."""

    capabilities = ConnectorCapabilities(
        id="internet_archive", name="Internet Archive (livres numérisés)", country="*", organization="Internet Archive",
        collections=["Livres et annuaires numérisés", "Histoires locales", "Nobiliaires et armoriaux", "Registres imprimés"],
        areas=["*"], period_start=1500, period_end=1960, search_fields=["surname", "commune"], access_mode="api",
        limitations=["Recherche sur les métadonnées et le texte intégral : résultats indicatifs"],
        terms_url="https://archive.org/about/terms.php", reuse_terms="Gratuit, sans clé", formats=["json", "pdf", "txt"],
        homepage="https://archive.org", languages=["en", "fr"], notes=UNVERIFIED,
    )
    min_interval = 2.0

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        words = " ".join(x for x in (query.surname, query.commune) if x)
        if not words:
            return []
        params = {"q": f'({words}) AND mediatype:texts', "fl[]": ["identifier", "title", "year", "creator", "description"],
                  "rows": 20, "output": "json"}
        r = await self.fetch("https://archive.org/advancedsearch.php", params=params, headers={"Accept": "application/json"})
        if r.status_code != 200:
            raise RuntimeError(f"Internet Archive HTTP {r.status_code}")
        out = []
        for d in (r.json().get("response") or {}).get("docs") or []:
            desc = d.get("description")
            if isinstance(desc, list):
                desc = " ".join(desc)
            out.append(SearchResult(connector_id=self.id, title=str(d.get("title") or d.get("identifier"))[:300],
                                    url=f"https://archive.org/details/{d.get('identifier')}", snippet=(desc or "")[:400] or None,
                                    record_type="book", year=int(d["year"]) if str(d.get("year") or "").isdigit() else None,
                                    repository="Internet Archive", reliability="secondary", external_id=d.get("identifier")))
        return out

    def browse_url(self, query: SearchQuery) -> Optional[str]:
        return "https://archive.org/search?query=" + quote_plus(" ".join(x for x in (query.surname, query.commune) if x))


class GenetekaConnector(ArchiveConnector):
    """Geneteka (Pologne) – index bénévole de baptêmes, mariages, décès. Lecture HTML expérimentale, repli navigateur."""

    capabilities = ConnectorCapabilities(
        id="geneteka", name="Geneteka (index PTG, Pologne)", country="PL", organization="Polskie Towarzystwo Genealogiczne",
        collections=["Index des baptêmes, mariages, décès par voïvodie et paroisse", "Liens vers les scans (Metryki, AP)"],
        areas=["*"], period_start=1600, period_end=1950, search_fields=["surname", "given_names", "year_from", "year_to"],
        access_mode="html", limitations=["Site bénévole : ne pas solliciter intensivement", "Pages HTML : analyse fragile",
                                         "Index = piste ; l'acte doit être vérifié sur le scan"],
        terms_url="https://geneteka.genealodzy.pl", reuse_terms="Usage personnel gratuit", formats=["html"], homepage="https://geneteka.genealodzy.pl",
        languages=["pl"], notes=UNVERIFIED,
    )
    min_interval = 5.0

    def browse_url(self, query: SearchQuery) -> Optional[str]:
        params = {"op": "gt", "lang": "pol", "search_lastname": query.surname or "", "search_name": query.given_names or "",
                  "from_date": query.year_from or "", "to_date": query.year_to or "", "bdm": "", "w": ""}
        return "https://geneteka.genealodzy.pl/index.php?" + urlencode(params)

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        url = self.browse_url(query)
        if await self.robots_allows(url) is False:
            raise AccessRestricted("Geneteka : robots.txt interdit l'accès automatisé.")
        r = await self.fetch(url)
        if r.status_code != 200:
            raise RuntimeError(f"Geneteka HTTP {r.status_code}")
        out = []
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", r.text, re.S)
        for row in rows:
            cells = [unescape(re.sub(r"<[^>]+>", " ", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if len(cells) < 5 or not any(ch.isdigit() for ch in cells[0]):
                continue
            year = next((int(c) for c in cells if re.fullmatch(r"1[5-9]\d{2}|20\d{2}", c)), None)
            link = re.search(r'href="(https?://[^"]+)"', row)
            title = " – ".join(c for c in cells[:6] if c)
            out.append(SearchResult(connector_id=self.id, title=title[:300], url=link.group(1) if link else url, record_type="index",
                                    year=year, repository="Geneteka (PTG)", reliability="secondary",
                                    candidate={"surname": query.surname, "given_names": query.given_names, "event_year": year}))
        return out[:50]


class NominatimConnector(ArchiveConnector):
    """Géocodage mondial gratuit (OpenStreetMap Nominatim) – 1 requête/seconde, User-Agent identifié."""

    capabilities = ConnectorCapabilities(
        id="nominatim", name="Géocodage OpenStreetMap (Nominatim)", country="*", organization="OpenStreetMap Foundation",
        collections=["Lieux du monde entier (communes, hameaux)"], areas=["*"], period_start=None, period_end=None,
        search_fields=["commune"], access_mode="api", limitations=["1 requête/seconde maximum (politique d'usage)", "Lieux actuels"],
        terms_url="https://operations.osmfoundation.org/policies/nominatim/", reuse_terms="ODbL ; gratuit, sans clé",
        formats=["json"], homepage="https://nominatim.openstreetmap.org", notes=UNVERIFIED,
    )
    min_interval = 1.1

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        if not query.commune:
            return []
        r = await self.fetch("https://nominatim.openstreetmap.org/search", params={"q": query.commune, "format": "jsonv2", "limit": 5, "addressdetails": 1})
        if r.status_code != 200:
            raise RuntimeError(f"Nominatim HTTP {r.status_code}")
        out = []
        for d in r.json():
            addr = d.get("address") or {}
            out.append(SearchResult(connector_id=self.id, title=d.get("display_name", ""), url=None, record_type="place", place=d.get("name"),
                                    raw={"lat": float(d["lat"]), "lon": float(d["lon"]), "country_code": (addr.get("country_code") or "").upper(),
                                         "country": addr.get("country"), "department": addr.get("county") or addr.get("state_district") or addr.get("state")}))
        return out

    async def self_test(self) -> dict:
        try:
            res = await self.search(SearchQuery(commune="Lunéville"))
            return {"ok": bool(res), "status": "ok" if res else "degraded", "details": {"results": len(res)}}
        except Exception as exc:
            return {"ok": False, "status": "failed", "details": {"error": str(exc)}}


class WikidataPlacesConnector(ArchiveConnector):
    """Wikidata – noms historiques et coordonnées des lieux (gratuit, sans clé)."""

    capabilities = ConnectorCapabilities(
        id="wikidata", name="Wikidata (lieux et noms historiques)", country="*", organization="Wikimedia Foundation",
        collections=["Communes, anciens noms (allemand, polonais, italien, latin), coordonnées"], areas=["*"], period_start=None, period_end=None,
        search_fields=["commune"], access_mode="api", limitations=["Qualité variable selon les entités"],
        terms_url="https://www.wikidata.org/wiki/Wikidata:Data_access", reuse_terms="CC0 ; gratuit, sans clé", formats=["json"],
        homepage="https://www.wikidata.org", notes=UNVERIFIED,
    )
    min_interval = 1.0

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        if not query.commune:
            return []
        r = await self.fetch("https://www.wikidata.org/w/api.php", params={"action": "wbsearchentities", "search": query.commune, "language": "fr",
                                                                              "type": "item", "limit": 5, "format": "json"})
        if r.status_code != 200:
            raise RuntimeError(f"Wikidata HTTP {r.status_code}")
        out = []
        for d in r.json().get("search", []):
            out.append(SearchResult(connector_id=self.id, title=f"{d.get('label')} — {d.get('description') or ''}", url=d.get("concepturi"),
                                    record_type="place", place=d.get("label"), external_id=d.get("id"), raw=d))
        return out

    async def labels(self, qid: str) -> dict:
        """Noms dans toutes les langues + coordonnées pour une entité."""
        r = await self.fetch("https://www.wikidata.org/w/api.php", params={"action": "wbgetentities", "ids": qid, "props": "labels|claims|aliases", "format": "json"})
        ent = (r.json().get("entities") or {}).get(qid) or {}
        labels = {k: v["value"] for k, v in (ent.get("labels") or {}).items()}
        coords = None
        for claim in (ent.get("claims") or {}).get("P625", []):
            v = claim.get("mainsnak", {}).get("datavalue", {}).get("value", {})
            if v:
                coords = {"lat": v.get("latitude"), "lon": v.get("longitude")}
        return {"labels": labels, "coords": coords}


def _b(id_, name, country, org, homepage, collections, langs, notes="", tpl=None, period_start=1500):
    caps = ConnectorCapabilities(id=id_, name=name, country=country, organization=org, collections=collections, areas=["*"],
                                 period_start=period_start, period_end=2026, search_fields=["surname", "given_names"], access_mode="browser",
                                 limitations=["Gratuit, sans compte, mais sans recherche automatisable : consultation par navigateur"],
                                 terms_url=homepage, reuse_terms="Gratuit ; conditions du site", formats=["html"], homepage=homepage,
                                 languages=langs, notes=(notes + " " + UNVERIFIED).strip())
    return BrowserAssistedConnector(caps, tpl)


FREE_BROWSER = [
    _b("grand_memorial", "Grand Mémorial (soldats 1914-1918, registres matricules)", "FR", "FranceArchives / ministère de la Culture",
       "https://www.culture.fr/Genealogie/Grand-Memorial", ["Registres matricules indexés (76 départements)", "Morts pour la France"],
       ["fr"], tpl="https://www.culture.fr/Genealogie/Grand-Memorial?nom={surname}&prenom={given}", period_start=1860),
    _b("memorialgenweb", "MémorialGenWeb (monuments aux morts)", "FR", "Association MémorialGenWeb", "https://www.memorialgenweb.org",
       ["Relevés des monuments aux morts et plaques commémoratives", "Soldats de toutes les guerres"], ["fr"],
       tpl="https://www.memorialgenweb.org/memorial3/html/fr/resultcommune.php?nom={surname}", period_start=1800),
    _b("limedia", "Limédia Kiosque (presse de Lorraine)", "FR", "Sillon Lorrain (bibliothèques de Nancy, Metz, Épinal, Thionville)",
       "https://kiosque.limedia.fr", ["Est Républicain, Journal de la Meurthe et des Vosges, Le Lorrain… (avis de décès, mariages, faits divers)"], ["fr"],
       tpl="https://kiosque.limedia.fr/recherche?q={surname}+{given}", period_start=1800),
    _b("roglo", "Roglo (base généalogique libre)", "*", "Roglo", "https://roglo.eu", ["Arbre collaboratif libre (pistes à vérifier)"], ["fr"],
       tpl="https://roglo.eu/roglo?lang=fr&m=S&n={surname}&p={given}"),
    _b("geneafrance", "Généafrance (relevés d'associations)", "FR", "Généafrance", "https://www.geneafrance.com",
       ["Relevés d'actes par département (gratuits selon associations)"], ["fr"]),
    _b("poznan_project", "Poznań Project (mariages Grande-Pologne 1800-1899)", "PL", "Łukasz Bielecki", "https://poznan-project.psnc.pl",
       ["Index des mariages de la région de Poznań 1800-1899"], ["pl", "en", "de"], tpl="https://poznan-project.psnc.pl/?lang=fr", period_start=1800),
    _b("genbaza", "Genbaza / Metryki (scans de registres polonais)", "PL", "Genealodzy.pl", "https://metryki.genealodzy.pl",
       ["Scans de registres paroissiaux et d'état civil polonais"], ["pl"], period_start=1600),
    _b("antenati_browse", "Antenati – navigation par commune (Italie)", "IT", "Archivi di Stato", "https://antenati.cultura.gov.it/archivi/",
       ["Registres non indexés : parcours par archive d'État, commune, année"], ["it"], period_start=1800),
    _b("archives_portal_europe", "Archives Portal Europe", "*", "APEF", "https://www.archivesportaleurope.net",
       ["Inventaires de 7 000 services d'archives européens"], ["en", "fr", "de", "pl", "it"], tpl="https://www.archivesportaleurope.net/advanced-search/search-in-archives/?term={surname}"),
]

for c in (GallicaConnector(), OpenArchivesConnector(), InternetArchiveConnector(), GenetekaConnector(), NominatimConnector(),
          WikidataPlacesConnector(), *FREE_BROWSER):
    registry.register(c)
