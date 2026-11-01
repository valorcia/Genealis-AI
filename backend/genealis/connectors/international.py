"""Connecteurs Italie, Pologne, Europe, Amérique du Nord et plateformes généalogiques."""
from __future__ import annotations

import re
from html import unescape
from typing import Optional
from urllib.parse import quote_plus, urlencode

from .base import AccessRestricted, ArchiveConnector, ConnectorCapabilities, SearchQuery, SearchResult, registry
from .france import UNVERIFIED, BrowserAssistedConnector


class AntenatiConnector(ArchiveConnector):
    """Portale Antenati (Archivi di Stato italiens) : registres d'état civil numérisés.

    Le portail propose une recherche nominative (partielle, selon les fonds indexés) et des images IIIF.
    Lecture HTML expérimentale ; repli navigateur.
    """

    capabilities = ConnectorCapabilities(
        id="antenati", name="Portale Antenati (Italie)", country="IT",
        organization="Direzione Generale Archivi – Ministero della Cultura",
        collections=["Stato civile napoleonico (1806-1815)", "Stato civile della restaurazione", "Stato civile italiano (1866-)",
                     "Liste di leva", "Registri parrocchiali (sélection)"],
        areas=["*"], period_start=1800, period_end=1950,
        search_fields=["surname", "given_names", "commune", "year_from", "year_to"], access_mode="html",
        limitations=["Recherche nominative disponible seulement pour les fonds indexés", "Majorité des registres non indexés : navigation par commune/année",
                     "Images IIIF consultables en ligne ; téléchargement selon les conditions du portail"],
        terms_url="https://antenati.cultura.gov.it/note-legali/", reuse_terms="Vérifier les conditions du portail (usage personnel autorisé)",
        formats=["html", "IIIF"], homepage="https://antenati.cultura.gov.it", languages=["it", "la"], notes=UNVERIFIED,
    )
    min_interval = 3.0

    def browse_url(self, query: SearchQuery) -> Optional[str]:
        params = {"cognome": query.surname or "", "nome": query.given_names or ""}
        if query.commune:
            params["luogo"] = query.commune
        return "https://antenati.cultura.gov.it/search-nominative/?" + urlencode(params)

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        url = self.browse_url(query)
        if await self.robots_allows(url) is False:
            raise AccessRestricted("Antenati : robots.txt interdit l'accès automatisé.")
        r = await self.fetch(url)
        if r.status_code != 200:
            raise RuntimeError(f"Antenati HTTP {r.status_code}")
        out = []
        for m in re.finditer(r'<a[^>]+href="(https?://antenati\.cultura\.gov\.it/(?:ark:|detail-nominative|detail-registry)[^"]+)"[^>]*>(.*?)</a>', r.text, re.S):
            title = unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2)))).strip()
            if len(title) < 3:
                continue
            years = re.findall(r"\b(1[6-9]\d{2}|20\d{2})\b", title)
            out.append(SearchResult(connector_id=self.id, title=title[:300], url=m.group(1), repository="Archivi di Stato",
                                    year=int(years[0]) if years else None, reliability="primary",
                                    candidate={"surname": query.surname, "given_names": query.given_names}))
        seen, uniq = set(), []
        for x in out:
            if x.url not in seen:
                seen.add(x.url)
                uniq.append(x)
        return uniq[:50]


class SzukajWArchiwachConnector(ArchiveConnector):
    """Szukaj w Archiwach (Archives nationales polonaises)."""

    capabilities = ConnectorCapabilities(
        id="szukajwarchiwach", name="Szukaj w Archiwach (Pologne)", country="PL",
        organization="Naczelna Dyrekcja Archiwów Państwowych",
        collections=["Registres d'état civil et paroissiaux (akta stanu cywilnego)", "Inventaires des archives d'État",
                     "Documents numérisés"], areas=["*"], period_start=1500, period_end=1950,
        search_fields=["surname", "given_names", "commune", "year_from", "year_to"], access_mode="html",
        limitations=["Indexation nominative partielle (projets Geneteka séparés)", "Documents en polonais, allemand, latin, russe",
                     "Frontières historiques : certains fonds sont conservés en Ukraine, Biélorussie, Lituanie"],
        terms_url="https://www.szukajwarchiwach.gov.pl/en/regulamin", reuse_terms="Vérifier le règlement du portail",
        formats=["html", "images"], homepage="https://www.szukajwarchiwach.gov.pl", languages=["pl", "de", "la", "ru"],
        notes=UNVERIFIED,
    )
    min_interval = 3.0

    def browse_url(self, query: SearchQuery) -> Optional[str]:
        q = " ".join(x for x in (query.given_names, query.surname, query.commune) if x)
        return "https://www.szukajwarchiwach.gov.pl/en/wyszukiwarka?" + urlencode({"q": q})

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        url = self.browse_url(query)
        if await self.robots_allows(url) is False:
            raise AccessRestricted("Szukaj w Archiwach : robots.txt interdit l'accès automatisé.")
        r = await self.fetch(url)
        if r.status_code != 200:
            raise RuntimeError(f"SzukajWArchiwach HTTP {r.status_code}")
        out = []
        for m in re.finditer(r'<a[^>]+href="(/(?:en|pl)/(?:jednostka|zespol|skan)/[^"]+)"[^>]*>(.*?)</a>', r.text, re.S):
            title = unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2)))).strip()
            if len(title) < 3:
                continue
            years = re.findall(r"\b(1[5-9]\d{2})\b", title)
            out.append(SearchResult(connector_id=self.id, title=title[:300], url="https://www.szukajwarchiwach.gov.pl" + m.group(1),
                                    repository="Archiwa Państwowe", year=int(years[0]) if years else None,
                                    reliability="secondary"))
        return out[:50]


class UKNationalArchivesConnector(ArchiveConnector):
    """The National Archives (UK) – Discovery API (documentée, JSON)."""

    capabilities = ConnectorCapabilities(
        id="uk_tna_discovery", name="The National Archives – Discovery (Royaume-Uni)", country="GB",
        organization="The National Archives (Kew)",
        collections=["Catalogue Discovery (TNA + 2 500 services d'archives britanniques)", "Index de naturalisations",
                     "Dossiers militaires (index)"], areas=["*"], period_start=1000, period_end=2026,
        search_fields=["surname", "given_names", "year_from", "year_to"], access_mode="api",
        limitations=["Catalogue : descriptions, pas les images", "Quota d'appels raisonnable attendu"],
        terms_url="https://www.nationalarchives.gov.uk/legal/", reuse_terms="Open Government Licence (métadonnées)",
        formats=["json"], homepage="https://discovery.nationalarchives.gov.uk", languages=["en"], notes=UNVERIFIED,
    )
    min_interval = 2.0

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        q = " ".join(x for x in (query.given_names, query.surname) if x)
        params = {"sps.searchQuery": q, "sps.resultsPageSize": 20}
        if query.year_from:
            params["sps.dateFrom"] = f"{query.year_from}-01-01"
        if query.year_to:
            params["sps.dateTo"] = f"{query.year_to}-12-31"
        r = await self.fetch("https://discovery.nationalarchives.gov.uk/API/search/records", params=params,
                             headers={"Accept": "application/json"})
        if r.status_code != 200:
            raise RuntimeError(f"Discovery HTTP {r.status_code}")
        data = r.json()
        out = []
        for rec in data.get("records", []):
            desc = re.sub(r"<[^>]+>", " ", rec.get("description") or "")
            out.append(SearchResult(connector_id=self.id, title=(rec.get("title") or desc[:120]).strip(),
                                    url=f"https://discovery.nationalarchives.gov.uk/details/r/{rec.get('id')}",
                                    snippet=desc[:400], reference=rec.get("reference"), repository=rec.get("heldBy", [None])[0] if isinstance(rec.get("heldBy"), list) else None,
                                    year=_first_year(rec.get("startDate")), reliability="secondary", raw=rec,
                                    external_id=rec.get("id")))
        return out

    def browse_url(self, query: SearchQuery) -> Optional[str]:
        q = " ".join(x for x in (query.given_names, query.surname) if x)
        return "https://discovery.nationalarchives.gov.uk/results/r?_q=" + quote_plus(q)


def _first_year(s) -> Optional[int]:
    if not s:
        return None
    m = re.search(r"(1\d{3}|20\d{2})", str(s))
    return int(m.group(1)) if m else None


def _browser(id_: str, name: str, country: str, org: str, homepage: str, collections: list[str], langs: list[str],
             notes: str = "", tpl: str | None = None, period_start: int = 1500, mode: str = "browser",
             requires_credentials: bool = False, limitations: list[str] | None = None) -> BrowserAssistedConnector:
    caps = ConnectorCapabilities(
        id=id_, name=name, country=country, organization=org, collections=collections, areas=["*"],
        period_start=period_start, period_end=2026, search_fields=["surname", "given_names"], access_mode=mode,
        limitations=limitations or ["Pas d'API publique utilisable sans accord : consultation par navigateur"],
        terms_url=homepage, reuse_terms="Conditions du site", formats=["html"], homepage=homepage, languages=langs,
        requires_credentials=requires_credentials, notes=(notes + " " + UNVERIFIED).strip(),
    )
    return BrowserAssistedConnector(caps, tpl)


PLATFORMS = [
    _browser("geneanet", "Geneanet", "*", "Geneanet SA", "https://www.geneanet.org",
             ["Arbres d'utilisateurs (pistes, jamais preuves)", "Relevés collaboratifs", "Bibliothèque numérisée"], ["fr", "en"],
             notes="Les CGU interdisent la collecte automatisée : recherche dans le navigateur, puis import GEDCOM de votre propre arbre.",
             tpl="https://www.geneanet.org/fonds/individus/?nom={surname}&prenom={given}&place__0__={commune}",
             limitations=["Accès automatisé interdit par les CGU", "Arbres tiers = pistes à vérifier (règle du projet)"]),
    _browser("familysearch", "FamilySearch", "*", "FamilySearch International", "https://www.familysearch.org",
             ["Index nominatifs mondiaux", "Images de registres (selon accords)", "Arbre collaboratif (pistes)"], ["en", "fr"],
             notes="API officielle réservée aux partenaires agréés (clé développeur). Sans accord, consultation dans le navigateur (compte gratuit).",
             tpl="https://www.familysearch.org/search/record/results?q.surname={surname}&q.givenName={given}&q.anyPlace={commune}",
             requires_credentials=True, limitations=["API partenaires uniquement", "Compte gratuit requis pour consulter"]),
    _browser("geneteka", "Geneteka (PTG, Pologne)", "PL", "Polskie Towarzystwo Genealogiczne", "https://geneteka.genealodzy.pl",
             ["Index des actes de baptême, mariage, décès (bénévoles)"], ["pl"],
             notes="Index bénévole très riche pour la Pologne ; chaque entrée renvoie souvent au scan de l'acte.",
             tpl="https://geneteka.genealodzy.pl/index.php?search_lastname={surname}&search_name={given}&rpp1=&bdm=&w=&op=se&lang=pol"),
    _browser("matricula", "Matricula Online (registres paroissiaux)", "*", "Diocèses d'Autriche, Allemagne, Pologne, Slovénie…",
             "https://data.matricula-online.eu", ["Registres paroissiaux catholiques numérisés"], ["de", "la", "pl"],
             notes="Navigation par diocèse/paroisse ; pas d'index nominatif."),
    _browser("be_search_arch", "Archives de l'État en Belgique", "BE", "Archives générales du Royaume",
             "https://search.arch.be", ["Registres paroissiaux et état civil belges", "Index nominatifs"], ["fr", "nl"],
             tpl="https://search.arch.be/fr/rechercher-des-personnes/resultats?text={surname}+{given}"),
    _browser("lu_anlux", "Archives nationales de Luxembourg", "LU", "ANLux", "https://anlux.public.lu",
             ["État civil (via FamilySearch/Matricula partiel)", "Inventaires"], ["fr", "de"]),
    _browser("de_archivportal", "Archivportal-D (Allemagne)", "DE", "Deutsche Digitale Bibliothek", "https://www.archivportal-d.de",
             ["Inventaires des archives allemandes"], ["de"], tpl="https://www.archivportal-d.de/objekte?query={surname}+{given}"),
    _browser("ch_archives_online", "Archives Online (Suisse)", "CH", "Archives cantonales", "https://www.archives-online.org",
             ["Inventaires cantonaux"], ["de", "fr", "it"]),
    _browser("at_archivinformationssystem", "Archivinformationssystem (Autriche)", "AT", "Österreichisches Staatsarchiv",
             "https://www.archivinformationssystem.at", ["Inventaires fédéraux"], ["de"]),
    _browser("cz_regional", "Archives régionales tchèques (registres paroissiaux)", "CZ", "Archives d'État régionales",
             "https://www.mza.cz/actapublica/", ["Matriky (registres paroissiaux) numérisés"], ["cs", "de", "la"]),
    _browser("sk_familysearch", "Slovaquie (registres via FamilySearch)", "SK", "Slovenský národný archív",
             "https://www.minv.sk/?archivy", ["Registres paroissiaux (numérisés chez FamilySearch)"], ["sk", "hu", "la"]),
    _browser("hu_hungaricana", "Hungaricana (Hongrie)", "HU", "Bibliothèque du Parlement hongrois", "https://hungaricana.hu",
             ["Recensements, inventaires, registres"], ["hu"], tpl="https://archives.hungaricana.hu/en/search/?query={surname}"),
    _browser("es_pares", "PARES (Espagne)", "ES", "Ministerio de Cultura", "https://pares.mcu.es",
             ["Portail des archives espagnoles"], ["es"]),
    _browser("pt_digitarq", "Digitarq / Arquivos nacionais (Portugal)", "PT", "Torre do Tombo", "https://digitarq.arquivos.pt",
             ["Registres paroissiaux numérisés", "Passeports"], ["pt"]),
    _browser("us_nara", "National Archives Catalog (États-Unis)", "US", "NARA", "https://catalog.archives.gov",
             ["Catalogue fédéral", "Naturalisations (index)", "Listes de passagers (index partiels)"], ["en"],
             notes="API v2 disponible avec clé gratuite ; non intégrée tant que non testée.",
             tpl="https://catalog.archives.gov/search?q={surname}+{given}"),
    _browser("ca_lac", "Bibliothèque et Archives Canada", "CA", "BAC", "https://recherche-collection-search.bac-lac.gc.ca",
             ["Recensements du Canada", "Listes de passagers", "Dossiers militaires"], ["fr", "en"],
             tpl="https://recherche-collection-search.bac-lac.gc.ca/fra/accueil/resultats?q_type_1=q&q_1={surname}+{given}"),
]

for c in (AntenatiConnector(), SzukajWArchiwachConnector(), UKNationalArchivesConnector(), *PLATFORMS):
    registry.register(c)
