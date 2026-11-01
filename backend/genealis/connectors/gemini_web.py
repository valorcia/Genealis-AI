"""Recherche web IA : Gemini + outil Google Search (« grounding »).

Gemini lance de vraies recherches Google, lit les pages trouvées et répond en citant ses sources.
L'application ne conserve que ce qui est vérifiable : chaque piste doit pointer vers une page réellement
consultée par Gemini (liste fournie par Google, pas par le modèle). Les indications sans page vérifiable
sont gardées à titre de note, jamais comme résultat.
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Optional
from urllib.parse import quote_plus, urlparse

from .base import AccessRestricted, ArchiveConnector, ConnectorCapabilities, SearchQuery, SearchResult, registry

# Sites d'arbres en ligne publiés par des particuliers : pistes à vérifier, jamais des preuves.
TREE_DOMAINS = ("geneanet", "roglo", "myheritage", "ancestry", "wikitree", "geni.com", "gw.geneanet")

# Archives départementales en ligne (état civil numérisé) : à citer explicitement à Gemini.
DEPARTMENT_ARCHIVES = {
    "54": ("Meurthe-et-Moselle", "archives.meurthe-et-moselle.fr"), "57": ("Moselle", "archives57.com"),
    "55": ("Meuse", "archives.meuse.fr"), "88": ("Vosges", "archives.vosges.fr"),
    "70": ("Haute-Saône", "archives.haute-saone.fr"), "52": ("Haute-Marne", "archives.haute-marne.fr"),
    "67": ("Bas-Rhin", "archives.bas-rhin.fr"), "68": ("Haut-Rhin", "archives.haut-rhin.fr"),
    "08": ("Ardennes", "archives.cd08.fr"), "51": ("Marne", "archives.marne.fr"), "75": ("Paris", "archives.paris.fr"),
    "59": ("Nord", "archivesdepartementales.lenord.fr"), "21": ("Côte-d'Or", "archives.cotedor.fr"),
    "25": ("Doubs", "archives.doubs.fr"), "69": ("Rhône", "archives.rhone.fr"), "13": ("Bouches-du-Rhône", "archives13.fr"),
}
LORRAINE = ("54", "57", "55", "88")

COMMON_SITES = [
    "Geneanet (geneanet.org : arbres en ligne et relevés collaboratifs)",
    "Filae (filae.com : relevés d'état civil indexés et arbres)",
    "FamilySearch (familysearch.org : registres indexés)",
    "FranceArchives (francearchives.gouv.fr : portail national des archives)",
    "Mémoire des Hommes (memoiredeshommes.sga.defense.gouv.fr : morts pour la France, militaires)",
    "Grand Mémorial (registres matricules 14-18 via FranceArchives)",
    "Gallica (gallica.bnf.fr : presse ancienne, annuaires)",
    "Fichier des décès INSEE (deces.matchid.io : décès en France depuis 1970)",
]
COUNTRY_SITES = {
    "PL": ["Geneteka (geneteka.genealodzy.pl : index des actes polonais)", "Szukaj w Archiwach (szukajwarchiwach.gov.pl)"],
    "IT": ["Portale Antenati (antenati.cultura.gov.it : état civil italien)"],
    "DE": ["Matricula (data.matricula-online.eu : registres paroissiaux d'Allemagne, Autriche, Pologne)"],
    "AT": ["Matricula (data.matricula-online.eu)"],
    "BE": ["Search Archives / Archives de l'État belge (search.arch.be)", "Open Archives (openarch.nl)"],
    "LU": ["Matricula (data.matricula-online.eu : registres du Luxembourg)"],
}

TYPE_FR = {"birth": "Naissance", "baptism": "Baptême", "marriage": "Mariage", "death": "Décès", "burial": "Inhumation",
           "census": "Recensement", "military": "Registre militaire", "tree": "Arbre en ligne", "other": "Mention"}
REGISTER_FR = {"birth": "l'acte de naissance (ou de baptême) et les parents", "marriage": "l'acte de mariage",
               "death": "l'acte de décès", "census": "les recensements", "military": "le registre matricule",
               "any": "tous les actes (naissance, mariage, décès) et les parents"}

SYSTEM = (
    "Tu es un généalogiste professionnel qui travaille pour un débutant. Tu disposes de l'outil Google Search : "
    "utilise-le réellement pour chercher sur le web des actes, relevés ou arbres concernant UNE personne précise. "
    "Règle absolue : n'écris que ce qui figure réellement dans les pages que tu as consultées. N'invente aucun nom, "
    "aucune date, aucun lieu, aucune adresse de page. Si tu ne trouves rien, dis-le dans not_found. "
    "Réponds uniquement par un objet JSON valide, sans texte autour."
)

JSON_SHAPE = (
    '{"findings":[{"type":"birth|baptism|marriage|death|burial|census|military|tree|other","summary":"phrase courte en français",'
    '"persons":{"subject":{"given_names":"","surname":"","birth_year":null,"birth_place":"","death_year":null,"death_place":""},'
    '"father":{"given_names":"","surname":""},"mother":{"given_names":"","surname":""},"spouse":{"given_names":"","surname":""}},'
    '"date":"","place":"","url":"adresse exacte de la page consultée","site":"nom de domaine","quote":"court extrait exact de la page",'
    '"confidence":"high|medium|low"}],"not_found":["ce qui a été cherché sans résultat (site + recherche)"]}'
)


class GroundedResults(list):
    """Liste de résultats accompagnée de la trace de recherche Google (requêtes, pages consultées, justifications)."""

    grounding: dict

    def __init__(self, items: list[SearchResult] | None = None, grounding: dict | None = None) -> None:
        super().__init__(items or [])
        self.grounding = grounding or {}


def _norm_url(u: str | None) -> str:
    if not u:
        return ""
    p = urlparse(u.strip())
    host = p.netloc.lower().replace("www.", "")
    return f"{host}{p.path.rstrip('/')}" + (f"?{p.query}" if p.query else "")


def _domain(u: str | None) -> str:
    if not u:
        return ""
    s = u if "//" in u else "//" + u
    return urlparse(s).netloc.lower().replace("www.", "")


def _same_site(a: str, b: str) -> bool:
    a, b = a.lower().replace("www.", ""), b.lower().replace("www.", "")
    return bool(a and b) and (a == b or a.endswith("." + b) or b.endswith("." + a))


def _int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    if isinstance(v, int):
        return v
    m = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", str(v))
    return int(m.group(1)) if m else None


def _name(p: dict | None) -> Optional[str]:
    if not isinstance(p, dict):
        return None
    n = " ".join(x for x in (str(p.get("given_names") or "").strip(), str(p.get("surname") or "").strip()) if x)
    return n or None


def reliability_for(domain: str, url: str | None, ftype: str | None) -> str:
    """Arbres de particuliers → « derivative » (piste) ; relevés et index → « secondary ». Jamais « primary » : Gemini lit des pages, pas l'acte original."""
    d = (domain or "").lower()
    path = (urlparse(url).path.lower() if url else "")
    if ftype == "tree" or any(t in d for t in TREE_DOMAINS):
        return "derivative"
    if "filae" in d and ("arbre" in path or "/tree" in path):
        return "derivative"
    if "familysearch" in d and ("/tree/" in path or d.startswith("ancestors.")):
        return "derivative"
    return "secondary"


def sites_to_search(query: SearchQuery) -> list[str]:
    countries = set(query.extra.get("countries") or [query.extra.get("country") or "FR"])
    sites: list[str] = []
    deps = [query.department] if query.department else []
    for dep in deps + [d for d in LORRAINE if d not in deps]:
        if dep in DEPARTMENT_ARCHIVES:
            name, dom = DEPARTMENT_ARCHIVES[dep]
            sites.append(f"Archives départementales {name} ({dep}) : {dom}")
    sites += COMMON_SITES
    for c in sorted(countries):
        sites += COUNTRY_SITES.get(c, [])
    return sites


def describe_person(query: SearchQuery) -> list[str]:
    x = query.extra or {}
    lines = [f"Nom de famille : {query.surname or 'inconnu'}", f"Prénom(s) : {query.given_names or 'inconnu'}"]
    if x.get("name_variants"):
        lines.append("Variantes du nom : " + ", ".join(map(str, x["name_variants"])))
    if x.get("sex"):
        lines.append("Sexe : " + ("homme" if x["sex"] == "M" else "femme" if x["sex"] == "F" else str(x["sex"])))
    for key, label in (("birth", "Naissance"), ("death", "Décès"), ("marriage", "Mariage")):
        if x.get(key):
            lines.append(f"{label} connu(e) : {x[key]}")
    if x.get("birth_year") and not x.get("birth"):
        lines.append(f"Année de naissance approximative : {x['birth_year']}")
    if query.year_from or query.year_to:
        lines.append(f"Période de l'acte recherché : {query.year_from or '?'}–{query.year_to or '?'}")
    if query.commune:
        lines.append(f"Commune : {query.commune}" + (f" (département {query.department})" if query.department else ""))
    for key, label in (("father", "Père"), ("mother", "Mère")):
        if x.get(key):
            lines.append(f"{label} : {x[key]}")
    if x.get("spouses"):
        lines.append("Conjoint(s) : " + ", ".join(map(str, x["spouses"])))
    if x.get("occupation"):
        lines.append(f"Profession : {x['occupation']}")
    if x.get("places"):
        lines.append("Lieux connus : " + ", ".join(map(str, x["places"])))
    return lines


def build_prompt(query: SearchQuery) -> str:
    goal = REGISTER_FR.get(query.register_type or "any", REGISTER_FR["any"])
    return (
        "Personne recherchée (faits déjà connus dans l'arbre) :\n- " + "\n- ".join(describe_person(query)) + "\n\n"
        f"Objectif : retrouver {goal}.\n\n"
        "Cherche avec Google Search, en ciblant en priorité ces sites de généalogie et d'archives :\n- "
        + "\n- ".join(sites_to_search(query)) + "\n\n"
        "Fais plusieurs recherches (nom + prénom + commune + année, variantes orthographiques, site:geneanet.org, site:filae.com, "
        "site:familysearch.org, archives départementales…). Pour chaque page qui mentionne vraiment cette personne "
        "(ou ses parents / conjoint), ajoute une entrée dans findings avec l'adresse exacte de la page, le domaine, et un "
        "court extrait recopié tel quel. Une homonymie probable doit être signalée dans summary et confidence=low.\n"
        "Les archives départementales affichent souvent les registres en images sans texte indexé : si tu ne trouves que la "
        "page d'accès au registre (commune, années), indique-la avec type=other.\n\n"
        "Réponds UNIQUEMENT avec ce JSON :\n" + JSON_SHAPE
    )


def map_findings(data: Any, grounding: dict, connector_id: str = "gemini_web") -> tuple[list[SearchResult], list[dict]]:
    """Transforme la réponse de Gemini en résultats vérifiables (URL issue des sources Google uniquement)."""
    sources: list[dict] = grounding.get("sources") or []
    supports: list[dict] = grounding.get("supports") or []
    by_url = {_norm_url(s.get("url")): s for s in sources if s.get("url")}
    findings = (data or {}).get("findings") if isinstance(data, dict) else None
    out: list[SearchResult] = []
    traced: list[dict] = []
    for f in findings if isinstance(findings, list) else []:
        if not isinstance(f, dict):
            continue
        ftype = str(f.get("type") or "other").lower()
        site = _domain(str(f.get("site") or "")) or _domain(str(f.get("url") or ""))
        src = by_url.get(_norm_url(str(f.get("url") or "")))
        how = "page exacte consultée par Gemini" if src else None
        if src is None and site:
            src = next((s for s in sources if _same_site(str(s.get("domain") or _domain(s.get("url"))), site)), None)
            how = "page du même site parmi les sources Google" if src else None
        # Passages de la réponse justifiés par des sources Google (segments qui recoupent cette piste)
        keys = [str(f.get(k) or "")[:50].strip() for k in ("quote", "summary", "url")]
        keys = [k for k in keys if len(k) >= 12]
        justif: set[int] = set()
        for sup in supports:
            seg = str(sup.get("text") or "")
            if any(k in seg for k in keys) or (len(seg) > 25 and any(seg in str(f.get(k) or "") for k in ("quote", "summary"))):
                justif.update(int(i) for i in sup.get("sources") or [])
        if src is not None:
            justif.add(int(src.get("index", 0)))
        url = src.get("url") if src else None
        domain = (src.get("domain") if src else None) or site
        entry = {**f, "type": ftype, "resolved_url": url, "resolved_domain": domain, "match": how, "kept": bool(url),
                 "source_indices": sorted(justif)}
        traced.append(entry)
        if not url:
            continue
        persons = f.get("persons") if isinstance(f.get("persons"), dict) else {}
        subj = persons.get("subject") if isinstance(persons.get("subject"), dict) else {}
        year = _int(f.get("date"))
        cand = {
            "surname": subj.get("surname") or None, "given_names": subj.get("given_names") or None,
            "birth_year": _int(subj.get("birth_year")), "birth_place": subj.get("birth_place") or None,
            "death_year": _int(subj.get("death_year")), "death_place": subj.get("death_place") or None,
            "father_name": _name(persons.get("father")), "mother_name": _name(persons.get("mother")),
            "spouse_name": _name(persons.get("spouse")), "event_year": year, "event_place": f.get("place") or None,
            "extra": {"event_type": ftype, "source": "gemini_web", "confidence": f.get("confidence")},
        }
        if ftype in ("birth", "baptism") and not cand["birth_year"]:
            cand["birth_year"] = year
        if ftype in ("death", "burial") and not cand["death_year"]:
            cand["death_year"] = year
        cand = {k: v for k, v in cand.items() if v not in (None, "")}
        title = f"{TYPE_FR.get(ftype, 'Mention')} : {str(f.get('summary') or _name(subj) or 'piste').strip()}"
        quote = str(f.get("quote") or "").strip()
        out.append(SearchResult(
            connector_id=connector_id, title=title[:300], url=url, snippet=(f"« {quote} »" if quote else None),
            record_type=ftype, year=year, date_text=str(f.get("date") or "") or None, place=f.get("place") or None,
            repository=domain, reliability=reliability_for(domain or "", url, ftype),
            candidate=cand if (cand.get("surname") or cand.get("given_names")) else {},
            raw={"finding": entry, "grounding": {"queries": grounding.get("queries") or [],
                                                 "sources": [s for s in sources if s.get("index") in justif]}},
        ))
    return out, traced


def friendly_gemini_error(msg: str) -> str:
    """Message compréhensible par un débutant à partir de l'erreur technique de Gemini."""
    low = msg.lower()
    m = re.search(r"http (\d{3})", low)
    code = m.group(1) if m else None
    if "api key not valid" in low or "api_key_invalid" in low or (code == "400" and "key" in low):
        reason = "Google refuse la clé Gemini (clé invalide ou supprimée) : vérifiez-la dans Paramètres → Intelligence artificielle"
    elif code == "429" or "quota" in low or "resource_exhausted" in low:
        reason = "le quota gratuit de Gemini est épuisé pour le moment : réessayez plus tard"
    elif code in ("401", "403") or "permission" in low:
        reason = "Google refuse l'accès avec cette clé (droits insuffisants)"
    elif code and code.startswith("5"):
        reason = f"le service Gemini est momentanément indisponible (erreur {code})"
    elif "injoignable" in low or "connect" in low or "timed out" in low or "timeout" in low:
        reason = "le service Gemini est injoignable (connexion Internet ou blocage réseau)"
    elif "bloqué" in low:
        reason = "la réponse a été bloquée par les filtres de sécurité de Gemini"
    else:
        reason = "erreur inattendue de Gemini"
    return f"Gemini n'a pas pu effectuer la recherche : {reason}"


class GeminiWebConnector(ArchiveConnector):
    capabilities = ConnectorCapabilities(
        id="gemini_web", name="Recherche web IA (Gemini + Google Search)", country="*",
        organization="Google (Gemini, outil Google Search)",
        collections=["Pages web publiques : Geneanet, Filae, FamilySearch, archives départementales, FranceArchives, "
                     "Mémoire des Hommes, Geneteka, Antenati, Matricula, Gallica…"],
        areas=["*"], period_start=None, period_end=None,
        search_fields=["surname", "given_names", "year_from", "year_to", "commune", "department", "register_type"],
        access_mode="api",
        limitations=["Nécessite Gemini (clé gratuite) et l'autorisation de l'IA externe",
                     "Gemini ne lit que les pages publiques indexées par Google (pas les images de registres)",
                     "Les arbres en ligne sont des pistes à vérifier, jamais des preuves"],
        terms_url="https://ai.google.dev/gemini-api/terms", reuse_terms="Liens vers les pages d'origine ; conditions de chaque site",
        formats=["json"], homepage="https://www.google.com", languages=["fr", "en", "it", "pl", "de"],
        notes="Chaque piste est rattachée à une page réellement consultée par Google ; sinon elle reste une simple note.",
    )
    min_interval = 0.0

    def browse_url(self, query: SearchQuery) -> Optional[str]:
        terms = " ".join(x for x in (query.given_names, query.surname, query.commune,
                                     str(query.year_from) if query.year_from else None, "généalogie") if x)
        return "https://www.google.com/search?q=" + quote_plus(terms)

    @staticmethod
    def _client_call(system: str, user: str, purpose: str, personal: bool, max_tokens: int) -> Any:
        from ..ai.providers import AIClient, AIUnavailable
        from ..db import session_scope

        with session_scope() as db:
            ai = AIClient(db)
            if not ai.can_search_web():
                reason = ("le fournisseur d'IA choisi n'est pas Gemini" if ai.provider != "gemini"
                          else "la clé Gemini est absente ou l'IA externe n'est pas autorisée")
                raise AccessRestricted(f"Recherche web IA indisponible : {reason} (Paramètres → Intelligence artificielle).")
            try:
                return ai.complete(system, user, purpose=purpose, personal=personal, max_tokens=max_tokens, web_search=True)
            except AIUnavailable as exc:
                raise RuntimeError(friendly_gemini_error(str(exc))) from exc

    async def search(self, query: SearchQuery) -> list[SearchResult]:
        prompt = build_prompt(query)
        resp = await asyncio.to_thread(self._client_call, SYSTEM, prompt, f"recherche web {query.surname or ''}", True, 3000)
        g = resp.grounding or {}
        grounding: dict = {"queries": list(g.get("queries") or []), "sources": list(g.get("sources") or []),
                           "supports": list(g.get("supports") or []), "not_found": [], "findings": [],
                           "sites_requested": sites_to_search(query), "model": resp.model}
        try:
            data = resp.json()
        except (ValueError, json.JSONDecodeError):
            data = None
            grounding["parse_error"] = "Gemini n'a pas répondu au format attendu ; seules les pages consultées sont listées."
            grounding["raw_text"] = (resp.text or "")[:1500]
        if isinstance(data, dict):
            nf = data.get("not_found")
            grounding["not_found"] = [str(x) for x in nf] if isinstance(nf, list) else ([str(nf)] if nf else [])
        results, traced = map_findings(data, grounding, self.id)
        grounding["findings"] = traced
        grounding["notes"] = [t for t in traced if not t.get("kept")]
        return GroundedResults(results, grounding)

    async def self_test(self) -> dict:
        try:
            resp = await asyncio.to_thread(
                self._client_call, "Réponds en une phrase.",
                "Cherche sur Google le site officiel des Archives départementales de Meurthe-et-Moselle et donne son adresse.",
                "test recherche web", False, 300)
        except AccessRestricted as exc:
            return {"ok": False, "status": "manual", "details": {"error": str(exc), "mode": "api"}}
        except Exception as exc:
            return {"ok": False, "status": "failed", "details": {"error": str(exc), "mode": "api"}}
        g = resp.grounding or {}
        n = len(g.get("sources") or [])
        return {"ok": n > 0, "status": "ok" if n > 0 else "degraded",
                "details": {"sources": n, "queries": g.get("queries") or [], "model": resp.model,
                            "domains": sorted({s.get("domain") for s in g.get("sources") or [] if s.get("domain")}),
                            **({} if n else {"error": "Gemini a répondu sans consulter de page web (aucune source)."})}}


registry.register(GeminiWebConnector())
