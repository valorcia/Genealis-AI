"""Détection des incohérences généalogiques. Signale, ne supprime jamais."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Contradiction, Event, Family, ParentChild, Person
from .names import name_similarity, given_names_similarity

MIN_PARENT_AGE = 13
MAX_MOTHER_AGE = 55
MAX_FATHER_AGE = 85
MAX_LIFESPAN = 115
POSTHUMOUS_MAX_DAYS_FATHER = 300


@dataclass
class Finding:
    kind: str
    severity: str
    description: str
    person_ids: list[str]
    event_ids: list[str]
    relation_ids: list[str]

    @property
    def key(self) -> str:
        return f"{self.kind}:{':'.join(sorted(self.person_ids))}:{':'.join(sorted(self.relation_ids))}"


def _event(p: Person, *types: str) -> Event | None:
    for t in types:
        for e in p.events:
            if e.event_type == t and e.sort_year:
                return e
    return None


def _year(e: Event | None) -> int | None:
    return e.sort_year if e else None


def _precision_days(e: Event) -> bool:
    return bool(e.date_start and len(e.date_start) == 10 and e.date_kind == "exact")


def check_person(db: Session, p: Person) -> list[Finding]:
    findings: list[Finding] = []
    birth = _event(p, "birth", "baptism")
    death = _event(p, "death", "burial")
    by, dy = _year(birth), _year(death)
    if by and dy:
        if dy < by:
            findings.append(Finding("death_before_birth", "red",
                                    f"{p.display_name()} : décès ({dy}) antérieur à la naissance ({by}).",
                                    [p.id], [birth.id, death.id], []))
        elif dy - by > MAX_LIFESPAN:
            findings.append(Finding("implausible_lifespan", "red",
                                    f"{p.display_name()} : durée de vie de {dy - by} ans, peu plausible.",
                                    [p.id], [birth.id, death.id], []))
    # Événements après le décès
    if dy:
        for e in p.events:
            if e.sort_year and e.event_type in ("marriage", "census", "residence", "occupation", "military") and e.sort_year > dy + 1:
                findings.append(Finding("event_after_death", "orange",
                                        f"{p.display_name()} : événement « {e.event_type} » en {e.sort_year} après le décès ({dy}).",
                                        [p.id], [e.id], []))
    # Doublons de naissance avec dates divergentes
    births = [e for e in p.events if e.event_type == "birth" and e.sort_year]
    if len({e.sort_year for e in births}) > 1:
        findings.append(Finding("conflicting_birth_dates", "orange",
                                f"{p.display_name()} : plusieurs dates de naissance contradictoires ({', '.join(str(e.sort_year) for e in births)}).",
                                [p.id], [e.id for e in births], []))
    # Relations parents
    rels = db.execute(select(ParentChild).where(ParentChild.child_id == p.id)).scalars().all()
    bio_parents = [r for r in rels if r.relation_type in ("biological", "uncertain")]
    fathers = [r for r in bio_parents if (db.get(Person, r.parent_id) or Person()).sex == "M"]
    mothers = [r for r in bio_parents if (db.get(Person, r.parent_id) or Person()).sex == "F"]
    if len(fathers) > 1:
        findings.append(Finding("multiple_fathers", "red", f"{p.display_name()} : plusieurs pères biologiques enregistrés.",
                                [p.id] + [r.parent_id for r in fathers], [], [r.id for r in fathers]))
    if len(mothers) > 1:
        findings.append(Finding("multiple_mothers", "red", f"{p.display_name()} : plusieurs mères biologiques enregistrées.",
                                [p.id] + [r.parent_id for r in mothers], [], [r.id for r in mothers]))
    for r in rels:
        parent = db.get(Person, r.parent_id)
        if not parent:
            continue
        pb = _event(parent, "birth", "baptism")
        pd = _event(parent, "death", "burial")
        pby, pdy = _year(pb), _year(pd)
        if by and pby:
            age = by - pby
            if age < MIN_PARENT_AGE and r.relation_type in ("biological", "uncertain"):
                findings.append(Finding("parent_too_young", "red",
                                        f"{parent.display_name()} aurait eu {age} ans à la naissance de {p.display_name()}.",
                                        [p.id, parent.id], [birth.id, pb.id], [r.id]))
            if parent.sex == "F" and age > MAX_MOTHER_AGE and r.relation_type == "biological":
                findings.append(Finding("mother_too_old", "red",
                                        f"{parent.display_name()} aurait eu {age} ans à la naissance de {p.display_name()}.",
                                        [p.id, parent.id], [birth.id, pb.id], [r.id]))
            if parent.sex == "M" and age > MAX_FATHER_AGE and r.relation_type == "biological":
                findings.append(Finding("father_too_old", "orange",
                                        f"{parent.display_name()} aurait eu {age} ans à la naissance de {p.display_name()}.",
                                        [p.id, parent.id], [birth.id, pb.id], [r.id]))
        if by and pdy and r.relation_type == "biological":
            if parent.sex == "F" and by > pdy:
                findings.append(Finding("born_after_mother_death", "red",
                                        f"{p.display_name()} né(e) en {by} après le décès de sa mère {parent.display_name()} ({pdy}).",
                                        [p.id, parent.id], [birth.id, pd.id], [r.id]))
            elif parent.sex != "F" and by > pdy + 1:
                findings.append(Finding("born_after_father_death", "red",
                                        f"{p.display_name()} né(e) en {by}, plus d'un an après le décès du père {parent.display_name()} ({pdy}).",
                                        [p.id, parent.id], [birth.id, pd.id], [r.id]))
            elif parent.sex != "F" and by == pdy + 1 and birth and pd and _precision_days(birth) and _precision_days(pd):
                from datetime import date

                b = date.fromisoformat(birth.date_start)
                d = date.fromisoformat(pd.date_start)
                if (b - d).days > POSTHUMOUS_MAX_DAYS_FATHER:
                    findings.append(Finding("born_after_father_death", "red",
                                            f"{p.display_name()} né(e) {(b - d).days} jours après le décès du père {parent.display_name()}.",
                                            [p.id, parent.id], [birth.id, pd.id], [r.id]))
    # Mariages
    for f in db.execute(select(Family).where((Family.partner1_id == p.id) | (Family.partner2_id == p.id))).scalars():
        m = next((e for e in f.events if e.event_type == "marriage" and e.sort_year), None)
        if m and by and m.sort_year - by < 12:
            findings.append(Finding("marriage_too_early", "red",
                                    f"{p.display_name()} : mariage en {m.sort_year} à {m.sort_year - by} ans.",
                                    [p.id], [m.id], []))
        if m and dy and m.sort_year > dy:
            findings.append(Finding("marriage_after_death", "red",
                                    f"{p.display_name()} : mariage en {m.sort_year} après le décès ({dy}).",
                                    [p.id], [m.id], []))
    return findings


def detect_duplicates(db: Session) -> list[Finding]:
    """Doublons probables : mêmes noms, années de naissance compatibles."""
    persons = db.execute(select(Person)).scalars().all()
    findings = []
    for i, a in enumerate(persons):
        ab = _year(_event(a, "birth", "baptism"))
        for b in persons[i + 1:]:
            if not a.surname or not b.surname:
                continue
            if name_similarity(a.surname, b.surname) < 90 or given_names_similarity(a.given_names, b.given_names) < 85:
                continue
            bb = _year(_event(b, "birth", "baptism"))
            if ab and bb and abs(ab - bb) > 2:
                continue
            if not ab and not bb:
                continue  # trop peu d'information pour affirmer un doublon
            findings.append(Finding("possible_duplicate", "orange",
                                    f"Doublon possible : {a.display_name()} ({ab or '?'}) et {b.display_name()} ({bb or '?'}).",
                                    [a.id, b.id], [], []))
    return findings


def run_all(db: Session) -> list[Contradiction]:
    """Exécute toutes les vérifications et synchronise la table des contradictions."""
    findings: list[Finding] = []
    for p in db.execute(select(Person)).scalars():
        findings.extend(check_person(db, p))
    findings.extend(detect_duplicates(db))
    existing = {c.dedupe_key: c for c in db.execute(select(Contradiction)).scalars()}
    keys_now = set()
    out = []
    for f in findings:
        keys_now.add(f.key)
        c = existing.get(f.key)
        if c is None:
            c = Contradiction(kind=f.kind, severity=f.severity, description=f.description, person_ids=f.person_ids,
                              event_ids=f.event_ids, relation_ids=f.relation_ids, dedupe_key=f.key)
            db.add(c)
        else:
            c.description = f.description
            c.severity = f.severity
            if c.status == "resolved":
                c.status = "open"  # réapparue
        out.append(c)
    # Les contradictions disparues (données corrigées) sont marquées résolues, jamais supprimées
    for key, c in existing.items():
        if key not in keys_now and c.status == "open":
            c.status = "resolved"
            c.resolution_note = (c.resolution_note or "") + " [auto] Non reproduite après vérification."
    db.flush()
    return out
