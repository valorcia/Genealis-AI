"""Rapprochement probabiliste et explicable d'identités.

Compare un « candidat » (données extraites d'un acte ou d'un résultat d'archive) avec une personne
connue de la base. Chaque critère produit une contribution signée et documentée.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import Person
from .names import given_names_similarity, name_similarity, normalize_name
from .persons import children_of, parents_of, spouses_of, person_summary


@dataclass
class Candidate:
    """Représentation neutre d'une personne telle qu'elle apparaît dans un document."""

    surname: Optional[str] = None
    given_names: Optional[str] = None
    sex: Optional[str] = None
    birth_year: Optional[int] = None
    birth_place: Optional[str] = None
    death_year: Optional[int] = None
    death_place: Optional[str] = None
    event_year: Optional[int] = None  # année de l'acte (mariage, recensement...)
    event_place: Optional[str] = None
    age_at_event: Optional[int] = None
    father_name: Optional[str] = None
    mother_name: Optional[str] = None
    spouse_name: Optional[str] = None
    occupation: Optional[str] = None
    residence: Optional[str] = None
    witnesses: list[str] = field(default_factory=list)
    children_names: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict) -> "Candidate":
        known = {k: v for k, v in d.items() if k in cls.__dataclass_fields__}
        return cls(**known)


@dataclass
class Criterion:
    name: str
    label: str
    score: float  # contribution (peut être négative)
    weight: float
    detail: str


@dataclass
class MatchResult:
    person_id: str
    total: float  # 0-100
    level: str  # green / orange / red / grey
    criteria: list[Criterion]
    blocking: list[str]  # contradictions bloquantes

    def to_dict(self) -> dict:
        return {"person_id": self.person_id, "total": round(self.total, 1), "level": self.level,
                "criteria": [c.__dict__ for c in self.criteria], "blocking": self.blocking}


def _year(p: Person, *types: str) -> Optional[int]:
    for t in types:
        for e in p.events:
            if e.event_type == t and e.sort_year:
                return e.sort_year
    return None


def _place(p: Person, *types: str) -> Optional[str]:
    for t in types:
        for e in p.events:
            if e.event_type == t:
                return e.place.name if e.place else e.place_original
    return None


def _place_sim(a: Optional[str], b: Optional[str]) -> Optional[float]:
    if not a or not b:
        return None
    na, nb = normalize_name(a.split(",")[0]), normalize_name(b.split(",")[0])
    if na == nb:
        return 1.0
    return name_similarity(na, nb) / 100.0


def level_for(total: float, blocking: list[str]) -> str:
    if blocking:
        return "red"
    if total >= 80:
        return "green"
    if total >= 50:
        return "orange"
    if total > 0:
        return "red"
    return "grey"


def score_candidate(db: Session, cand: Candidate, person: Person) -> MatchResult:
    crits: list[Criterion] = []
    blocking: list[str] = []

    def add(name, label, score, weight, detail):
        crits.append(Criterion(name, label, score, weight, detail))

    # 1. Patronyme (pondération forte, mais jamais suffisant seul — RÈGLE 2)
    if cand.surname and person.surname:
        s = name_similarity(cand.surname, person.surname)
        variants = [person.married_name] + list(person.name_variants or [])
        for v in variants:
            if v:
                s = max(s, name_similarity(cand.surname, v))
        add("surname", "Patronyme", s / 100, 3.0, f"« {cand.surname} » vs « {person.surname} » : {s:.0f}%")
        if s < 60:
            blocking.append("Patronymes incompatibles")
    # 2. Prénoms
    if cand.given_names and person.given_names:
        s = given_names_similarity(cand.given_names, person.given_names)
        add("given_names", "Prénoms", s / 100, 2.5, f"« {cand.given_names} » vs « {person.given_names} » : {s:.0f}%")
        if s < 40:
            blocking.append("Prénoms incompatibles")
    # 3. Sexe
    if cand.sex and person.sex:
        ok = cand.sex == person.sex
        add("sex", "Sexe", 1.0 if ok else 0.0, 1.0, "identique" if ok else "différent")
        if not ok:
            blocking.append("Sexe différent")
    # 4. Dates
    pby = _year(person, "birth", "baptism")
    cby = cand.birth_year
    if cby is None and cand.event_year and cand.age_at_event is not None:
        cby = cand.event_year - cand.age_at_event
        approx = True
    else:
        approx = False
    if cby and pby:
        diff = abs(cby - pby)
        tol = 2 if approx else 0
        if diff <= tol:
            sc = 1.0
        elif diff <= 3:
            sc = 0.6
        elif diff <= 5:
            sc = 0.3
        else:
            sc = 0.0
        add("birth_year", "Année de naissance", sc, 3.0, f"{cby}{' (calculée)' if approx else ''} vs {pby} : écart {diff} an(s)")
        if diff > 10:
            blocking.append(f"Écart de naissance de {diff} ans")
    pdy = _year(person, "death", "burial")
    if cand.death_year and pdy:
        diff = abs(cand.death_year - pdy)
        add("death_year", "Année de décès", 1.0 if diff == 0 else (0.5 if diff <= 1 else 0.0), 2.0,
            f"{cand.death_year} vs {pdy}")
        if diff > 3:
            blocking.append("Années de décès incompatibles")
    # Chronologie : l'acte doit être compatible avec la vie de la personne
    if cand.event_year:
        if pby and cand.event_year < pby:
            blocking.append(f"Acte de {cand.event_year} antérieur à la naissance ({pby})")
        if pdy and cand.event_year > pdy and cand.extra.get("event_type") not in ("death", "burial", "probate"):
            blocking.append(f"Acte de {cand.event_year} postérieur au décès ({pdy})")
    # 5. Lieux
    for label, cval, pval, w in (("Lieu de naissance", cand.birth_place, _place(person, "birth", "baptism"), 2.0),
                                 ("Lieu de décès", cand.death_place, _place(person, "death", "burial"), 1.5),
                                 ("Résidence", cand.residence, _place(person, "residence", "census"), 1.0)):
        s = _place_sim(cval, pval)
        if s is not None:
            add(label.lower().replace(" ", "_"), label, s, w, f"« {cval} » vs « {pval} » : {s * 100:.0f}%")
    # 6. Parents
    for label, cname, plist, w in (("Père", cand.father_name, [p for p, r in parents_of(db, person.id) if p.sex != "F"], 3.0),
                                   ("Mère", cand.mother_name, [p for p, r in parents_of(db, person.id) if p.sex != "M"], 3.0)):
        if cname and plist:
            best = max((max(name_similarity(cname, p.surname), given_names_similarity(cname, f"{p.given_names} {p.surname}"))
                        for p in plist), default=0)
            full = max(name_similarity(cname, f"{p.given_names or ''} {p.surname or ''}") for p in plist)
            s = max(best, full) / 100
            add(label.lower(), label, s, w, f"« {cname} » vs {', '.join(p.display_name() for p in plist)} : {s * 100:.0f}%")
            if s < 0.4:
                blocking.append(f"{label} incompatible")
    # 7. Conjoint
    if cand.spouse_name:
        sp = spouses_of(db, person.id)
        if sp:
            s = max(name_similarity(cand.spouse_name, f"{p.given_names or ''} {p.surname or ''}") for p in sp) / 100
            add("spouse", "Conjoint", s, 2.5, f"« {cand.spouse_name} » vs {', '.join(p.display_name() for p in sp)}")
    # 8. Enfants
    if cand.children_names:
        kids = [c for c, _ in children_of(db, person.id)]
        if kids:
            hits = 0
            for cn in cand.children_names:
                if any(given_names_similarity(cn, k.given_names) > 80 for k in kids):
                    hits += 1
            s = hits / len(cand.children_names)
            add("children", "Enfants", s, 2.0, f"{hits}/{len(cand.children_names)} prénoms d'enfants retrouvés")
    # 9. Profession
    if cand.occupation and person.occupation:
        s = name_similarity(cand.occupation, person.occupation) / 100
        add("occupation", "Profession", s, 0.8, f"« {cand.occupation} » vs « {person.occupation} »")
    # 10. Témoins / parrains (indice faible)
    if cand.witnesses:
        rel_names = [p.display_name() for p in spouses_of(db, person.id)] + \
                    [p.display_name() for p, _ in parents_of(db, person.id)] + \
                    [c.display_name() for c, _ in children_of(db, person.id)]
        hits = sum(1 for w in cand.witnesses if any(name_similarity(w, n) > 85 for n in rel_names))
        if hits:
            add("witnesses", "Témoins / parrains", min(hits / 2, 1.0), 1.0, f"{hits} témoin(s) apparenté(s)")

    if not crits:
        return MatchResult(person.id, 0.0, "grey", [], blocking)
    total_w = sum(c.weight for c in crits)
    total = 100 * sum(c.score * c.weight for c in crits) / total_w
    # Pénalité si seuls les noms concordent (RÈGLE 2 : jamais de filiation sur le seul patronyme)
    informative = [c for c in crits if c.name not in ("surname", "given_names", "sex")]
    if not informative:
        total = min(total, 45.0)
    elif len(informative) == 1:
        total = min(total, 70.0)
    return MatchResult(person.id, total, level_for(total, blocking), crits, blocking)


def find_matches(db: Session, cand: Candidate, persons: list[Person] | None = None, min_total: float = 30.0) -> list[MatchResult]:
    from sqlalchemy import select

    pool = persons if persons is not None else db.execute(select(Person)).scalars().all()
    results = []
    for p in pool:
        if cand.surname and p.surname and name_similarity(cand.surname, p.surname) < 55 and \
                not any(name_similarity(cand.surname, v) >= 55 for v in [p.married_name] + list(p.name_variants or []) if v):
            continue
        r = score_candidate(db, cand, p)
        if r.total >= min_total or r.blocking:
            results.append(r)
    results.sort(key=lambda r: (-r.total, len(r.blocking)))
    return results
