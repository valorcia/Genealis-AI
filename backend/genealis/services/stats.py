"""Statistiques de l'arbre : âges au décès, naissances par décennie, distribution des noms, prénoms, lieux, professions."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Citation, Event, Family, ParentChild, Person, Place, Question, Contradiction
from .persons import person_summary


def _year(p: Person, *types: str):
    for t in types:
        for e in p.events:
            if e.event_type == t and e.sort_year:
                return e.sort_year
    return None


def compute(db: Session) -> dict:
    persons = db.execute(select(Person)).scalars().all()
    ages, ages_by_sex = [], {"M": [], "F": [], "?": []}
    births_by_decade, deaths_by_decade = Counter(), Counter()
    surname_years: dict[str, list[int]] = defaultdict(list)
    surname_decades: dict[str, Counter] = defaultdict(Counter)
    given_m, given_f = Counter(), Counter()
    places, occupations, countries = Counter(), Counter(), Counter()
    sexes = Counter()
    lifespan_by_century: dict[int, list[int]] = defaultdict(list)
    for p in persons:
        sexes[p.sex or "?"] += 1
        s = person_summary(db, p)
        if s.age_years is not None and s.age_context == "au décès":
            ages.append(s.age_years)
            ages_by_sex[p.sex or "?"].append(s.age_years)
            if s.birth_year:
                lifespan_by_century[(s.birth_year // 100) * 100].append(s.age_years)
        by, dy = _year(p, "birth", "baptism"), _year(p, "death", "burial")
        if by:
            births_by_decade[(by // 10) * 10] += 1
        if dy:
            deaths_by_decade[(dy // 10) * 10] += 1
        if p.surname:
            key = p.surname.upper()
            yrs = [e.sort_year for e in p.events if e.sort_year]
            surname_years[key].extend(yrs)
            for y in yrs:
                surname_decades[key][(y // 10) * 10] += 1
            if not yrs:
                surname_years.setdefault(key, [])
        if p.given_names:
            first = p.given_names.split()[0].capitalize()
            (given_m if p.sex == "M" else given_f if p.sex == "F" else Counter())[first] += 1
        if p.occupation:
            occupations[p.occupation.strip().lower()] += 1
        for e in p.events:
            if e.place:
                if e.event_type in ("birth", "baptism"):
                    places[e.place.name] += 1
                if e.place.country:
                    countries[e.place.country] += 1
    bins = Counter((a // 5) * 5 for a in ages)
    histogram = [{"from": b, "to": b + 4, "count": bins.get(b, 0)} for b in range(0, max([*bins.keys(), 85]) + 5, 5)]
    # Mariages : âge au premier mariage, enfants par famille
    marriage_ages = []
    children_per_family = []
    for f in db.execute(select(Family)).scalars():
        m = next((e for e in f.events if e.event_type in ("marriage", "civil_marriage", "religious_marriage") and e.sort_year), None)
        for pid in (f.partner1_id, f.partner2_id):
            if m and pid:
                p = db.get(Person, pid)
                by = _year(p, "birth", "baptism") if p else None
                if by and 10 < m.sort_year - by < 90:
                    marriage_ages.append(m.sort_year - by)
        if f.partner1_id and f.partner2_id:
            k1 = {r.child_id for r in db.execute(select(ParentChild).where(ParentChild.parent_id == f.partner1_id)).scalars()}
            k2 = {r.child_id for r in db.execute(select(ParentChild).where(ParentChild.parent_id == f.partner2_id)).scalars()}
            children_per_family.append(len(k1 & k2))
    distribution = []
    for name, yrs in surname_years.items():
        if not yrs:
            continue
        distribution.append({"surname": name, "first_year": min(yrs), "last_year": max(yrs), "count": len([p for p in persons if (p.surname or "").upper() == name]),
                             "decades": [{"decade": d, "count": c} for d, c in sorted(surname_decades[name].items())]})
    distribution.sort(key=lambda d: (-d["count"], d["first_year"]))
    avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None  # noqa: E731
    cited = {c.target_id for c in db.execute(select(Citation).where(Citation.target_type == "person")).scalars()}
    return {
        "persons": len(persons), "sexes": dict(sexes), "living": sum(1 for p in persons if p.is_living),
        "age_at_death": {"histogram": histogram, "average": avg(ages), "average_m": avg(ages_by_sex["M"]),
                         "average_f": avg(ages_by_sex["F"]), "max": max(ages) if ages else None, "count": len(ages)},
        "lifespan_by_century": [{"century": c, "average": avg(v), "count": len(v)} for c, v in sorted(lifespan_by_century.items())],
        "births_by_decade": [{"decade": d, "count": c} for d, c in sorted(births_by_decade.items())],
        "deaths_by_decade": [{"decade": d, "count": c} for d, c in sorted(deaths_by_decade.items())],
        "surname_distribution": distribution[:40],
        "top_given_names_m": given_m.most_common(15), "top_given_names_f": given_f.most_common(15),
        "top_birth_places": places.most_common(15), "top_occupations": occupations.most_common(15),
        "countries": countries.most_common(20),
        "marriage_age": {"average": avg(marriage_ages), "count": len(marriage_ages)},
        "children_per_family": {"average": avg(children_per_family), "count": len(children_per_family),
                                "max": max(children_per_family) if children_per_family else None},
        "with_sources": len(cited & {p.id for p in persons}),
    }


def database_state(db: Session) -> dict:
    """Rapport « État de la base » : volumes et points à compléter."""
    persons = db.execute(select(Person)).scalars().all()
    no_birth, no_parents, no_sources, no_death_old = [], [], [], []
    cited = {c.target_id for c in db.execute(select(Citation).where(Citation.target_type == "person")).scalars()}
    child_ids = {r.child_id for r in db.execute(select(ParentChild)).scalars()}
    this_year = date.today().year
    for p in persons:
        s = person_summary(db, p).model_dump()
        if not s["birth_year"]:
            no_birth.append(s)
        if p.id not in child_ids:
            no_parents.append(s)
        if p.id not in cited:
            no_sources.append(s)
        if s["birth_year"] and not s["death_year"] and this_year - s["birth_year"] > 105 and not p.is_living:
            no_death_old.append(s)
    places = db.execute(select(Place)).scalars().all()
    return {
        "counts": {"persons": len(persons), "families": db.query(Family).count(), "events": db.query(Event).count(),
                   "places": len(places), "relations": db.query(ParentChild).count(),
                   "questions_pending": db.query(Question).filter(Question.status == "pending").count(),
                   "contradictions_open": db.query(Contradiction).filter(Contradiction.status == "open").count()},
        "missing_birth": no_birth[:200], "missing_parents": no_parents[:200], "without_sources": no_sources[:200],
        "probably_deceased_without_date": no_death_old[:200],
        "places_without_coordinates": [{"id": pl.id, "name": pl.display()} for pl in places if pl.latitude is None][:200],
    }
