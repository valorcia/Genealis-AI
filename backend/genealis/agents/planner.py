"""Planificateur du GENEALIS RESEARCH AGENT et moteur de priorisation des branches."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..connectors.base import SearchQuery, registry
from ..models import Person, ResearchTask
from ..services.persons import families_of, parents_of, spouses_of

DEPARTMENT_HINTS = {"meurthe-et-moselle": "54", "moselle": "57", "meuse": "55", "vosges": "88", "haute-saone": "70",
                    "haute-saône": "70", "haute-marne": "52", "nancy": "54", "metz": "57", "epinal": "88", "épinal": "88",
                    "verdun": "55", "bar-le-duc": "55", "vesoul": "70", "chaumont": "52", "luneville": "54", "lunéville": "54",
                    "toul": "54", "briey": "54", "longwy": "54", "thionville": "57", "forbach": "57"}
COUNTRY_HINTS = {"italie": "IT", "italia": "IT", "italy": "IT", "pologne": "PL", "polska": "PL", "poland": "PL",
                 "allemagne": "DE", "deutschland": "DE", "belgique": "BE", "luxembourg": "LU", "suisse": "CH",
                 "autriche": "AT", "espagne": "ES", "portugal": "PT", "royaume-uni": "GB", "angleterre": "GB",
                 "états-unis": "US", "etats-unis": "US", "canada": "CA", "tchéquie": "CZ", "slovaquie": "SK", "hongrie": "HU"}


@dataclass
class PlanStep:
    action: str  # search | compare | ask | analyze | record | browse
    connector_id: Optional[str]
    label: str
    query: dict = field(default_factory=dict)
    status: str = "pending"  # pending | done | skipped | failed | manual
    result: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return self.__dict__


def _event_place(p: Person, *types: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """(commune, département, pays) du premier événement trouvé."""
    for t in types:
        for e in p.events:
            if e.event_type == t and (e.place or e.place_original):
                if e.place:
                    return e.place.name, e.place.department, e.place.country_code or e.place.country
                return e.place_original, None, None
    return None, None, None


def infer_department(place: Optional[str], dep: Optional[str]) -> Optional[str]:
    if dep and dep.isdigit():
        return dep
    for raw in (dep, place):
        if raw:
            key = raw.lower().split(",")[0].strip()
            if key in DEPARTMENT_HINTS:
                return DEPARTMENT_HINTS[key]
    return None


def infer_country(place: Optional[str], country: Optional[str]) -> str:
    if country:
        c = country.strip()
        if len(c) == 2:
            return c.upper()
        return COUNTRY_HINTS.get(c.lower(), "FR")
    if place:
        for token in place.lower().replace(",", " ").split():
            if token in COUNTRY_HINTS:
                return COUNTRY_HINTS[token]
    return "FR"


PLACE_PRIORITY = {
    "birth": ("birth", "baptism", "residence", "census", "marriage", "death"),
    "marriage": ("marriage", "residence", "census", "birth", "baptism", "death"),
    "death": ("death", "burial", "residence", "census", "immigration", "naturalization", "marriage", "birth", "baptism"),
    "census": ("census", "residence", "marriage", "death", "birth"),
    "military": ("residence", "birth", "baptism", "census"),
}


def countries_of(p: Person) -> set[str]:
    """Tous les pays où la personne a un événement documenté (une migration implique plusieurs pays)."""
    out = set()
    for e in p.events:
        if e.place:
            out.add(infer_country(e.place.name, e.place.country_code or e.place.country))
        elif e.place_original:
            out.add(infer_country(e.place_original, None))
    return out


def build_query(p: Person, register_type: str, window: int = 2) -> SearchQuery:
    birth_year = next((e.sort_year for e in p.events if e.event_type in ("birth", "baptism") and e.sort_year), None)
    death_year = next((e.sort_year for e in p.events if e.event_type in ("death", "burial") and e.sort_year), None)
    place, dep, country = _event_place(p, *PLACE_PRIORITY.get(register_type, PLACE_PRIORITY["birth"]))
    q = SearchQuery(surname=p.surname, given_names=p.given_names, commune=place.split(",")[0] if place else None,
                    department=infer_department(place, dep), register_type=register_type)
    if register_type == "birth" and birth_year:
        q.year_from, q.year_to = birth_year - window, birth_year + window
    elif register_type == "death":
        if death_year:
            q.year_from, q.year_to = death_year - window, death_year + window
        elif birth_year:
            q.year_from, q.year_to = birth_year, birth_year + 110
    elif register_type == "marriage" and birth_year:
        q.year_from, q.year_to = birth_year + 15, birth_year + 50
    elif register_type == "census" and birth_year:
        q.year_from, q.year_to = birth_year, (death_year or birth_year + 80)
    b = next((e for e in p.events if e.event_type == "birth" and e.date_start and len(e.date_start) == 10), None)
    if b:
        q.birth_date = b.date_start
    q.extra["country"] = infer_country(place, country)
    q.extra["countries"] = sorted(countries_of(p) | {q.extra["country"]})
    return q


TASK_LABELS = {"find_birth": "Rechercher l'acte de naissance", "find_parents": "Retrouver les parents",
               "find_marriage": "Rechercher l'acte de mariage", "find_death": "Rechercher l'acte de décès",
               "find_census": "Comparer les recensements", "find_siblings": "Identifier les frères et sœurs",
               "explore_branch": "Explorer la branche (plusieurs générations)", "analyze_document": "Analyser un document",
               "verify_person": "Vérifier la cohérence", "find_military": "Rechercher le registre matricule"}


WEB_SEARCH_TASKS = {"find_birth", "find_parents", "find_marriage", "find_death", "explore_branch"}
SPECIAL_CONNECTORS = {"gemini_web"}  # ajoutés explicitement, jamais via la sélection générique


def web_search_available(db: Session) -> bool:
    """Vrai si la recherche web IA (Gemini + Google Search) peut être lancée automatiquement."""
    try:
        from ..ai.providers import AIClient

        return AIClient(db).can_search_web()
    except Exception:  # pragma: no cover - configuration illisible
        return False


def _event_text(e) -> str:
    from ..services.persons import gendate_of

    try:
        date = gendate_of(e).display()
    except Exception:
        date = e.date_original or (str(e.sort_year) if e.sort_year else "")
    place = e.place.display() if e.place else (e.place_original or "")
    return " à ".join(x for x in (date, place) if x)


def person_facts(db: Session, p: Person) -> dict:
    """Faits connus d'une personne transmis à la recherche web IA (parents, conjoint, lieux, années)."""
    facts: dict = {}
    if p.sex:
        facts["sex"] = p.sex
    if p.occupation:
        facts["occupation"] = p.occupation
    if p.name_variants:
        facts["name_variants"] = list(p.name_variants)[:6]
    places: list[str] = []
    for e in p.events:
        txt = _event_text(e)
        if e.event_type in ("birth", "baptism") and txt and "birth" not in facts:
            facts["birth"] = txt
        if e.event_type in ("death", "burial") and txt and "death" not in facts:
            facts["death"] = txt
        pl = e.place.name if e.place else e.place_original
        if pl and pl not in places:
            places.append(pl)
    for f in families_of(db, p.id):
        for e in getattr(f, "events", []) or []:
            if e.event_type in ("marriage", "civil_marriage", "religious_marriage") and "marriage" not in facts:
                facts["marriage"] = _event_text(e) or "date inconnue"
    for par, _ in parents_of(db, p.id):
        by = next((e.sort_year for e in par.events if e.event_type in ("birth", "baptism") and e.sort_year), None)
        key = "father" if par.sex == "M" else "mother" if par.sex == "F" else ("father" if "father" not in facts else "mother")
        facts[key] = par.display_name() + (f" (né(e) vers {by})" if by else "")
    sp = [s.display_name() for s in spouses_of(db, p.id)]
    if sp:
        facts["spouses"] = sp
    if places:
        facts["places"] = places[:6]
    return facts


def plan_task(db: Session, task: ResearchTask, person: Person | None, *, web_search: bool | None = None) -> list[PlanStep]:
    """Établit un plan de recherche concret, limité aux connecteurs réellement disponibles."""
    steps: list[PlanStep] = []
    if person is None:
        return steps
    ttype = task.task_type
    reg = {"find_birth": "birth", "find_parents": "birth", "find_marriage": "marriage", "find_death": "death",
           "find_census": "census", "find_siblings": "birth", "find_military": "military"}.get(ttype, "any")
    q = build_query(person, reg)
    country = q.extra.get("country", "FR")
    countries = set(q.extra.get("countries") or [country])
    if not person.surname:
        steps.append(PlanStep("ask", None, "Le patronyme est inconnu : demander à l'utilisateur"))
        return steps
    # 1. Connecteurs automatisables pertinents
    UTILITY = {"geo_api_gouv", "nominatim", "wikidata"}
    DEATH_ONLY = {"insee_deces", "insee_deces_local"}
    birth_year = next((e.sort_year for e in person.events if e.event_type in ("birth", "baptism") and e.sort_year), None)
    if birth_year:
        q.extra["birth_year"] = birth_year
    seen: set[str] = set()
    for hint in sorted(countries, key=lambda x: x != country):
        for c in registry.for_query(q, country_hint=hint):
            if c.id in seen:
                continue
            seen.add(c.id)
            caps = c.capabilities
            if caps.id in UTILITY or caps.id in SPECIAL_CONNECTORS:
                continue
            if caps.id in DEATH_ONLY:
                if ttype == "find_death" and (q.year_to is None or q.year_to >= 1970):
                    # L'index local (hors ligne, gratuit) passe avant le service distant
                    steps.append(PlanStep("search", caps.id, f"Interroger {caps.name}", q.to_dict()))
                continue
            steps.append(PlanStep("search", caps.id, f"Interroger {caps.name}", q.to_dict()))
    steps.sort(key=lambda s: 0 if s.connector_id == "insee_deces_local" else 1)
    # Recherche web IA (Gemini + Google Search) : juste après l'index INSEE local, si disponible
    if ttype in WEB_SEARCH_TASKS and registry.get("gemini_web") is not None:
        if web_search is None:
            web_search = web_search_available(db)  # évalué une seule fois par plan
        if web_search:
            gq = SearchQuery(**{**q.to_dict(), "extra": {**q.extra, **person_facts(db, person)}})
            pos = 1 if steps and steps[0].connector_id == "insee_deces_local" else 0
            steps.insert(pos, PlanStep("search", "gemini_web", "Recherche web IA (Gemini + Google Search) : Geneanet, Filae, "
                                                                 "FamilySearch, archives départementales…", gq.to_dict()))
    # 2. Services d'archives par navigateur (département / pays)
    for c in registry.all():
        caps = c.capabilities
        if caps.access_mode != "browser":
            continue
        if "FR" in countries and caps.country == "FR" and (q.department in caps.areas or (caps.areas == ["*"] and reg == "military")):
            steps.append(PlanStep("browse", caps.id, f"Consulter {caps.name} ({_register_label(reg)})", q.to_dict()))
        elif caps.country in countries - {"FR"}:
            steps.append(PlanStep("browse", caps.id, f"Consulter {caps.name}", q.to_dict()))
    # 3. Homonymes et comparaison
    steps.append(PlanStep("compare", None, "Comparer les résultats avec les personnes connues (homonymes, chronologie)"))
    if ttype in ("find_parents", "find_birth"):
        steps.append(PlanStep("record", None, "Proposer parents / filiation selon le mode d'autonomie"))
    if ttype == "explore_branch":
        steps.append(PlanStep("record", None, "Planifier la génération précédente pour chaque parent identifié"))
    return steps


def _register_label(reg: str) -> str:
    return {"birth": "naissances / tables décennales", "marriage": "mariages / tables décennales", "death": "décès",
            "census": "recensements", "military": "registres matricules", "any": "tous registres"}.get(reg, reg)


# ---------- Priorisation des branches ----------

def missing_info_score(db: Session, p: Person) -> dict:
    types = {e.event_type for e in p.events}
    missing = [t for t in ("birth", "marriage", "death") if t not in types]
    pars = parents_of(db, p.id)
    if len(pars) < 2:
        missing.append("parents")
    birth_year = next((e.sort_year for e in p.events if e.event_type in ("birth", "baptism") and e.sort_year), None)
    place, dep, country = _event_place(p, "birth", "baptism", "residence", "marriage", "death")
    c = infer_country(place, country)
    # Disponibilité probable des archives
    if birth_year is None:
        availability = 0.3
    elif birth_year >= 1792 and c == "FR":
        availability = 0.9  # état civil
    elif birth_year >= 1668 and c == "FR":
        availability = 0.7  # registres paroissiaux (ordonnance 1667)
    elif birth_year >= 1539 and c == "FR":
        availability = 0.4
    elif c in ("IT", "PL", "BE", "LU", "DE") and birth_year >= 1800:
        availability = 0.7
    elif birth_year >= 1600:
        availability = 0.4
    else:
        availability = 0.15
    if not place:
        availability *= 0.5
    cost = 1.0 + (0.5 if c != "FR" else 0.0) + (0.5 if not place else 0.0)
    # Gain : une naissance avec parents débloque 2 personnes → effet multiplicateur sur la génération suivante
    gain = (2.0 if "parents" in missing else 0.5) + 0.3 * len(missing)
    score = round(100 * availability * gain / cost / 3.0, 1)
    return {"person_id": p.id, "name": p.display_name(), "missing": missing, "availability": availability,
            "country": c, "birth_year": birth_year, "estimated_minutes": int(10 * cost * (len(missing) or 1)),
            "score": min(score, 100.0), "already_tried": list((p.research_status or {}).keys())}


def prioritized_branches(db: Session, limit: int = 20) -> list[dict]:
    rows = [missing_info_score(db, p) for p in db.execute(select(Person)).scalars()]
    rows = [r for r in rows if r["missing"]]
    for r in rows:
        tried = r["already_tried"]
        r["score"] = round(r["score"] * (0.6 if tried else 1.0), 1)
    rows.sort(key=lambda r: -r["score"])
    return rows[:limit]
