"""Service personnes / relations / familles + sérialisation."""
from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from ..models import Citation, Contradiction, Event, Family, Hypothesis, Media, ParentChild, Person, Question, SiblingLink, Source
from ..schemas import (CitationOut, ContradictionOut, EventIn, EventOut, FamilyIn, FamilyOut, HypothesisOut, MediaOut,
                       PersonDetail, PersonIn, PersonSummary, QuestionOut, RelationIn, RelationOut, RelativeIn)
from .fts import index_entity, remove_entity
from .gendate import GenDate, parse_gendate
from .places import resolve_place

VITAL_ORDER = {"birth": 0, "baptism": 1, "marriage_banns": 2, "marriage_contract": 3, "marriage": 4,
               "residence": 5, "census": 6, "occupation": 7, "military": 8, "immigration": 9, "emigration": 10,
               "naturalization": 11, "divorce": 12, "will": 13, "death": 14, "burial": 15, "probate": 16, "other": 17}


# ---------- Sérialisation ----------

def gendate_of(ev: Event) -> GenDate:
    return GenDate(ev.date_original, ev.date_kind, ev.date_start, ev.date_end, ev.calendar, ev.sort_year)


def event_out(db: Session, ev: Event, with_citations: bool = True) -> EventOut:
    cits = citations_for(db, "event", ev.id) if with_citations else []
    return EventOut(
        id=ev.id, person_id=ev.person_id, family_id=ev.family_id, event_type=ev.event_type,
        date_original=ev.date_original, date_kind=ev.date_kind, date_start=ev.date_start, date_end=ev.date_end,
        calendar=ev.calendar, sort_year=ev.sort_year, date_display=gendate_of(ev).display(),
        place_id=ev.place_id, place_name=ev.place.display() if ev.place else None, place_original=ev.place_original,
        description=ev.description, value_original=ev.value_original, attributes=ev.attributes or {},
        confidence=ev.confidence, citations=cits,
    )


def citations_for(db: Session, target_type: str, target_id: str) -> list[CitationOut]:
    rows = db.execute(select(Citation).where(Citation.target_type == target_type, Citation.target_id == target_id)).scalars()
    out = []
    for c in rows:
        out.append(CitationOut(id=c.id, source_id=c.source_id, target_type=c.target_type, target_id=c.target_id,
                               excerpt=c.excerpt, image_region=c.image_region, confidence=c.confidence, note=c.note,
                               source_title=c.source.title if c.source else None,
                               source_reliability=c.source.reliability if c.source else None))
    return out


def _vital(db: Session, person: Person, etype: str) -> Optional[Event]:
    evs = [e for e in person.events if e.event_type == etype]
    if not evs:
        return None
    evs.sort(key=lambda e: {"green": 0, "orange": 1, "grey": 2, "red": 3}.get(e.confidence, 2))
    return evs[0]


def _date_parts(iso: Optional[str]) -> tuple[Optional[int], Optional[int], Optional[int]]:
    if not iso:
        return None, None, None
    parts = iso.split("-")
    try:
        return int(parts[0]), (int(parts[1]) if len(parts) > 1 else None), (int(parts[2]) if len(parts) > 2 else None)
    except ValueError:
        return None, None, None


def compute_age(p: Person, birth: Optional[Event], death: Optional[Event]) -> dict:
    """Âge au décès (ou âge actuel d'une personne vivante). « ≈ » dès qu'une date n'est pas exacte."""
    from datetime import date, timedelta

    empty = {"age_years": None, "age_display": None, "age_detail": None, "age_context": None}
    if not birth or not birth.date_start or birth.date_kind not in ("exact", "approx", "calculated"):
        return empty
    by, bm, bd = _date_parts(birth.date_start)
    if by is None:
        return empty
    today = date.today()
    if death is not None:
        if not death.date_start or death.date_kind not in ("exact", "approx", "calculated"):
            return empty
        ey, em, ed = _date_parts(death.date_start)
        context = "au décès"
        exact_end = death.date_kind == "exact"
    else:
        if p.is_living is not True or today.year - by > 110:
            return empty  # vivant non confirmé ou décédé sans date : on ne calcule rien
        ey, em, ed = today.year, today.month, today.day
        context = "aujourd'hui"
        exact_end = True
    if ey is None or ey < by:
        return empty
    exact = birth.date_kind == "exact" and exact_end and all(v is not None for v in (bm, bd, em, ed))
    if exact:
        b, e = date(by, bm, bd), date(ey, em, ed)
        y, m, d = e.year - b.year, e.month - b.month, e.day - b.day
        if d < 0:
            m -= 1
            d += (date(e.year, e.month, 1) - timedelta(days=1)).day
        if m < 0:
            y -= 1
            m += 12
        return {"age_years": y, "age_display": f"{y} an{'s' if y > 1 else ''}", "age_detail": f"{y} a {m} m {d} j",
                "age_context": context}
    years = ey - by
    if bm and em and (em, ed or 0) < (bm, bd or 0):
        years -= 1
    return {"age_years": years, "age_display": f"≈ {years} an{'s' if years > 1 else ''}", "age_detail": None, "age_context": context}


def person_summary(db: Session, p: Person, sosa: Optional[dict[str, list[int]]] = None) -> PersonSummary:
    b = _vital(db, p, "birth") or _vital(db, p, "baptism")
    d = _vital(db, p, "death") or _vital(db, p, "burial")
    return PersonSummary(**compute_age(p, b, d), sosa=(sosa or {}).get(p.id, []),
        id=p.id, display_name=p.display_name(), given_names=p.given_names, surname=p.surname,
        married_name=p.married_name, sex=p.sex, confidence=p.confidence, is_root=p.is_root, is_living=p.is_living,
        birth_year=b.sort_year if b else None, death_year=d.sort_year if d else None,
        birth_display=gendate_of(b).display() if b else None, death_display=gendate_of(d).display() if d else None,
        birth_place=b.place.display() if b and b.place else (b.place_original if b else None),
        death_place=d.place.display() if d and d.place else (d.place_original if d else None),
        occupation=p.occupation, portrait_media_id=p.portrait_media_id,
    )


def relation_out(r: ParentChild) -> RelationOut:
    return RelationOut(id=r.id, parent_id=r.parent_id, child_id=r.child_id, relation_type=r.relation_type,
                       confidence=r.confidence, confidence_details=r.confidence_details or {}, notes=r.notes)


def family_out(db: Session, f: Family) -> FamilyOut:
    children: list[str] = []
    if f.partner1_id and f.partner2_id:
        c1 = {r.child_id for r in db.execute(select(ParentChild).where(ParentChild.parent_id == f.partner1_id)).scalars()}
        c2 = {r.child_id for r in db.execute(select(ParentChild).where(ParentChild.parent_id == f.partner2_id)).scalars()}
        children = sorted(c1 & c2)
    elif f.partner1_id or f.partner2_id:
        pid = f.partner1_id or f.partner2_id
        children = [r.child_id for r in db.execute(select(ParentChild).where(ParentChild.parent_id == pid)).scalars()]
    return FamilyOut(id=f.id, partner1_id=f.partner1_id, partner2_id=f.partner2_id, union_type=f.union_type,
                     confidence=f.confidence, notes=f.notes, events=[event_out(db, e) for e in f.events],
                     children_ids=children)


def hypothesis_out(h: Hypothesis) -> HypothesisOut:
    return HypothesisOut(id=h.id, kind=h.kind, title=h.title, description=h.description,
                         subject_person_id=h.subject_person_id, candidate=h.candidate or {}, evidence=h.evidence or [],
                         score=h.score, score_details=h.score_details or {}, status=h.status, created_by=h.created_by,
                         task_id=h.task_id, group_key=h.group_key, created_at=h.created_at)


def question_out(q: Question) -> QuestionOut:
    return QuestionOut(id=q.id, title=q.title, problem=q.problem, known_facts=q.known_facts or [],
                       hypotheses=q.hypotheses or [], documents=q.documents or [], impact=q.impact,
                       priority=q.priority, status=q.status, answer_type=q.answer_type, answer=q.answer,
                       person_id=q.person_id, task_id=q.task_id, created_at=q.created_at, answered_at=q.answered_at)


def contradiction_out(c: Contradiction) -> ContradictionOut:
    return ContradictionOut(id=c.id, kind=c.kind, severity=c.severity, description=c.description,
                            person_ids=c.person_ids or [], event_ids=c.event_ids or [], relation_ids=c.relation_ids or [],
                            status=c.status, resolution_note=c.resolution_note, created_at=c.created_at)


def media_out(m: Media, with_text: bool = False) -> MediaOut:
    return MediaOut(id=m.id, path=m.path, original_filename=m.original_filename, mime_type=m.mime_type, kind=m.kind,
                    title=m.title, person_id=m.person_id, source_id=m.source_id, language=m.language,
                    analysis_status=m.analysis_status, analysis=m.analysis or {},
                    ocr_text=m.ocr_text if with_text else None, created_at=m.created_at)


# ---------- Requêtes ----------

def get_person(db: Session, person_id: str) -> Person | None:
    return db.get(Person, person_id)


def parents_of(db: Session, person_id: str) -> list[tuple[Person, ParentChild]]:
    rels = db.execute(select(ParentChild).where(ParentChild.child_id == person_id)).scalars().all()
    return [(db.get(Person, r.parent_id), r) for r in rels if db.get(Person, r.parent_id)]


def children_of(db: Session, person_id: str) -> list[tuple[Person, ParentChild]]:
    rels = db.execute(select(ParentChild).where(ParentChild.parent_id == person_id)).scalars().all()
    return [(db.get(Person, r.child_id), r) for r in rels if db.get(Person, r.child_id)]


def families_of(db: Session, person_id: str) -> list[Family]:
    return db.execute(select(Family).where(or_(Family.partner1_id == person_id, Family.partner2_id == person_id))).scalars().all()


def spouses_of(db: Session, person_id: str) -> list[Person]:
    out = []
    for f in families_of(db, person_id):
        other = f.partner2_id if f.partner1_id == person_id else f.partner1_id
        if other:
            p = db.get(Person, other)
            if p:
                out.append(p)
    return out


def siblings_of(db: Session, person_id: str) -> list[Person]:
    """Frères et sœurs : enfants des mêmes parents + liens de fratrie déclarés sans parents connus."""
    parent_ids = [p.id for p, _ in parents_of(db, person_id)]
    seen: dict[str, Person] = {}
    for pid in parent_ids:
        for c, _ in children_of(db, pid):
            if c.id != person_id:
                seen[c.id] = c
    for link in db.execute(select(SiblingLink).where(or_(SiblingLink.person1_id == person_id,
                                                         SiblingLink.person2_id == person_id))).scalars():
        other = link.person2_id if link.person1_id == person_id else link.person1_id
        o = db.get(Person, other)
        if o:
            seen[o.id] = o
    # Fratrie transitive : les frères et sœurs liés à mes frères et sœurs déclarés
    return sorted(seen.values(), key=lambda x: (next((e.sort_year for e in x.events if e.event_type == "birth" and e.sort_year), 9999)))


def person_detail(db: Session, p: Person, sosa: Optional[dict[str, list[int]]] = None) -> PersonDetail:
    from .sosa import sosa_map

    sosa = sosa if sosa is not None else sosa_map(db)
    base = person_summary(db, p, sosa).model_dump()
    parents = parents_of(db, p.id)
    children = children_of(db, p.id)
    fams = families_of(db, p.id)
    events = sorted(p.events, key=lambda e: (e.sort_year or 9999, VITAL_ORDER.get(e.event_type, 50)))
    hyps = db.execute(select(Hypothesis).where(Hypothesis.subject_person_id == p.id)).scalars().all()
    contras = [c for c in db.execute(select(Contradiction).where(Contradiction.status == "open")).scalars()
               if p.id in (c.person_ids or [])]
    qs = db.execute(select(Question).where(Question.person_id == p.id, Question.status == "pending")).scalars().all()
    media = db.execute(select(Media).where(Media.person_id == p.id)).scalars().all()
    return PersonDetail(
        **base, name_variants=p.name_variants or [], nationality=p.nationality, notes=p.notes,
        confidence_details=p.confidence_details or {}, events=[event_out(db, e) for e in events],
        parents=[person_summary(db, pp, sosa) for pp, _ in parents], parent_relations=[relation_out(r) for _, r in parents],
        children=[person_summary(db, c, sosa) for c, _ in children], child_relations=[relation_out(r) for _, r in children],
        spouses=[person_summary(db, s, sosa) for s in spouses_of(db, p.id)], families=[family_out(db, f) for f in fams],
        siblings=[person_summary(db, s, sosa) for s in siblings_of(db, p.id)], media=[media_out(m) for m in media],
        citations=citations_for(db, "person", p.id), hypotheses=[hypothesis_out(h) for h in hyps],
        contradictions=[contradiction_out(c) for c in contras], questions=[question_out(q) for q in qs],
        research_status=p.research_status or {}, created_at=p.created_at, updated_at=p.updated_at,
    )


# ---------- Écriture ----------

def apply_event_fields(db: Session, ev: Event, data: EventIn) -> Event:
    ev.event_type = data.event_type
    gd = parse_gendate(data.date if data.date is not None else data.date_original)
    ev.date_original = data.date_original or data.date
    ev.date_kind, ev.date_start, ev.date_end, ev.calendar, ev.sort_year = gd.kind, gd.start, gd.end, gd.calendar, gd.sort_year
    if data.place_id:
        ev.place_id = data.place_id
    elif data.place is not None:
        pl = resolve_place(db, data.place)
        ev.place_id = pl.id if pl else None
        ev.place_original = data.place or None
    ev.description = data.description
    ev.value_original = data.value_original
    ev.attributes = data.attributes or {}
    if data.confidence:
        ev.confidence = data.confidence
    if data.family_id:
        ev.family_id = data.family_id
    return ev


def add_event(db: Session, person_id: str | None, data: EventIn) -> Event:
    ev = Event(person_id=person_id)
    apply_event_fields(db, ev, data)
    db.add(ev)
    db.flush()
    return ev


def index_person(db: Session, p: Person) -> None:
    body_parts = [p.given_names or "", p.surname or "", p.married_name or "", " ".join(p.name_variants or []),
                  p.occupation or "", p.notes or ""]
    for e in p.events:
        body_parts.append(e.place.display() if e.place else (e.place_original or ""))
        body_parts.append(e.date_original or "")
        body_parts.append(e.value_original or "")
    index_entity(db.connection(), "person", p.id, p.display_name(), " ".join(body_parts))


def create_person(db: Session, data: PersonIn) -> Person:
    p = Person(given_names=data.given_names, surname=data.surname, married_name=data.married_name,
               name_variants=data.name_variants or [], sex=data.sex, nationality=data.nationality,
               occupation=data.occupation, notes=data.notes, is_living=data.is_living, is_root=bool(data.is_root),
               confidence=data.confidence or "grey")
    db.add(p)
    db.flush()
    if data.birth_date or data.birth_place:
        add_event(db, p.id, EventIn(event_type="birth", date=data.birth_date, place=data.birth_place))
    if data.death_date or data.death_place:
        add_event(db, p.id, EventIn(event_type="death", date=data.death_date, place=data.death_place))
    db.refresh(p)
    index_person(db, p)
    return p


def update_person(db: Session, p: Person, data: PersonIn) -> Person:
    fields = data.model_dump(exclude_unset=True)
    for k in ("given_names", "surname", "married_name", "name_variants", "sex", "nationality", "occupation", "notes",
              "is_living", "is_root", "confidence"):
        if k in fields and fields[k] is not None:
            setattr(p, k, fields[k])
    for etype, dkey, pkey in (("birth", "birth_date", "birth_place"), ("death", "death_date", "death_place")):
        if dkey in fields or pkey in fields:
            ev = _vital(db, p, etype)
            if ev is None:
                add_event(db, p.id, EventIn(event_type=etype, date=fields.get(dkey), place=fields.get(pkey)))
            else:
                apply_event_fields(db, ev, EventIn(event_type=etype, date=fields.get(dkey, ev.date_original),
                                                   place=fields.get(pkey, ev.place_original),
                                                   description=ev.description, attributes=ev.attributes,
                                                   confidence=ev.confidence))
    db.flush()
    db.refresh(p)
    index_person(db, p)
    return p


def delete_person(db: Session, p: Person) -> None:
    remove_entity(db.connection(), "person", p.id)
    db.execute(Citation.__table__.delete().where(Citation.target_type == "person", Citation.target_id == p.id))
    db.delete(p)
    db.flush()


def add_relation(db: Session, data: RelationIn) -> ParentChild:
    if data.parent_id == data.child_id:
        raise ValueError("Une personne ne peut pas être son propre parent.")
    existing = db.execute(select(ParentChild).where(ParentChild.parent_id == data.parent_id,
                                                    ParentChild.child_id == data.child_id)).scalar_one_or_none()
    if existing:
        return existing
    # Empêche les cycles (un ancêtre ne peut pas devenir descendant)
    if data.parent_id in descendant_ids(db, data.child_id):
        raise ValueError("Cette filiation créerait une boucle dans l'arbre.")
    rel = ParentChild(parent_id=data.parent_id, child_id=data.child_id, relation_type=data.relation_type,
                      confidence=data.confidence or "grey", notes=data.notes)
    db.add(rel)
    db.flush()
    for sid in data.source_ids:
        db.add(Citation(source_id=sid, target_type="parent_child", target_id=rel.id, confidence="orange"))
    db.flush()
    return rel


def descendant_ids(db: Session, person_id: str, limit: int = 10000) -> set[str]:
    seen: set[str] = set()
    frontier = [person_id]
    while frontier and len(seen) < limit:
        pid = frontier.pop()
        for r in db.execute(select(ParentChild).where(ParentChild.parent_id == pid)).scalars():
            if r.child_id not in seen:
                seen.add(r.child_id)
                frontier.append(r.child_id)
    return seen


def create_family(db: Session, data: FamilyIn) -> Family:
    f = Family(partner1_id=data.partner1_id, partner2_id=data.partner2_id, union_type=data.union_type,
               confidence=data.confidence or "grey", notes=data.notes)
    db.add(f)
    db.flush()
    if data.marriage_date or data.marriage_place:
        ev = Event(family_id=f.id)
        apply_event_fields(db, ev, EventIn(event_type="marriage", date=data.marriage_date, place=data.marriage_place))
        db.add(ev)
        db.flush()
    return f


def find_or_create_family(db: Session, p1: str | None, p2: str | None) -> Family:
    for f in db.execute(select(Family)).scalars():
        if {f.partner1_id, f.partner2_id} == {p1, p2}:
            return f
    return create_family(db, FamilyIn(partner1_id=p1, partner2_id=p2, union_type="unknown"))


def search_persons(db: Session, q: str, limit: int = 50) -> list[Person]:
    from .fts import search as fts_search

    hits = fts_search(db.connection(), q, limit=limit, entity_type="person")
    out = []
    for h in hits:
        p = db.get(Person, h["entity_id"])
        if p:
            out.append(p)
    if not out:
        like = f"%{q}%"
        out = db.execute(select(Person).where(or_(Person.given_names.ilike(like), Person.surname.ilike(like),
                                                   Person.married_name.ilike(like))).limit(limit)).scalars().all()
    return out



# ---------- Ajout rapide de proches ----------
RELATIVE_SEX = {"father": "M", "mother": "F", "son": "M", "daughter": "F", "brother": "M", "sister": "F", "husband": "M",
                "wife": "F", "paternal_grandfather": "M", "paternal_grandmother": "F", "maternal_grandfather": "M",
                "maternal_grandmother": "F"}
RELATIVE_LABEL = {"father": "père", "mother": "mère", "parent": "parent", "son": "fils", "daughter": "fille", "child": "enfant",
                  "brother": "frère", "sister": "sœur", "sibling": "frère ou sœur", "spouse": "conjoint(e)", "husband": "époux",
                  "wife": "épouse", "paternal_grandfather": "grand-père paternel", "paternal_grandmother": "grand-mère paternelle",
                  "maternal_grandfather": "grand-père maternel", "maternal_grandmother": "grand-mère maternelle"}


def _parent_by_sex(db: Session, person_id: str, sex: str) -> Optional[Person]:
    for p, r in parents_of(db, person_id):
        if p.sex == sex and r.relation_type in ("biological", "uncertain"):
            return p
    return None


def _link_parent(db: Session, parent: Person, child: Person, relation_type: str, notes: str | None = None) -> ParentChild:
    rel = add_relation(db, RelationIn(parent_id=parent.id, child_id=child.id, relation_type=relation_type, notes=notes))
    # Union des deux parents si l'autre parent est connu
    others = [p for p, r in parents_of(db, child.id) if p.id != parent.id and r.relation_type in ("biological", "uncertain")]
    for o in others:
        if (o.sex or "") != (parent.sex or "") or not o.sex:
            find_or_create_family(db, parent.id if parent.sex != "F" else o.id, o.id if parent.sex != "F" else parent.id)
    return rel


def add_relative(db: Session, person: Person, data: RelativeIn) -> dict:
    """Crée (ou relie) un proche en une seule opération. Ne crée jamais de lien sans l'action explicite de l'utilisateur.

    Retourne {"person": Person, "relations": [ids], "placeholders": [ids], "message": str}.
    """
    relation = data.relation
    if relation not in RELATIVE_LABEL:
        raise ValueError(f"Type de proche inconnu : {relation}")
    placeholders: list[str] = []
    relations: list[str] = []
    if data.existing_id:
        other = db.get(Person, data.existing_id)
        if other is None:
            raise ValueError("Personne existante introuvable.")
        if other.id == person.id:
            raise ValueError("Une personne ne peut pas être son propre proche.")
    else:
        info = data.person or PersonIn()
        if not info.sex and relation in RELATIVE_SEX:
            info.sex = RELATIVE_SEX[relation]
        if not (info.given_names or info.surname):
            # Par défaut, un parent paternel porte souvent le même nom : on ne le présume pas, on laisse vide.
            pass
        other = create_person(db, info)

    if relation in ("father", "mother", "parent"):
        if relation != "parent":
            existing = _parent_by_sex(db, person.id, RELATIVE_SEX[relation])
            if existing and existing.id != other.id and data.relation_type in ("biological", "uncertain"):
                raise ValueError(f"{person.display_name()} a déjà un {RELATIVE_LABEL[relation]} biologique "
                                 f"({existing.display_name()}). Utilisez « adoptif » ou « incertain », ou modifiez la fiche existante.")
        relations.append(_link_parent(db, other, person, data.relation_type).id)
    elif relation in ("son", "daughter", "child"):
        relations.append(add_relation(db, RelationIn(parent_id=person.id, child_id=other.id, relation_type=data.relation_type)).id)
        if data.other_parent_id:
            op = db.get(Person, data.other_parent_id)
            if op:
                relations.append(add_relation(db, RelationIn(parent_id=op.id, child_id=other.id, relation_type=data.relation_type)).id)
                a, b = (person.id, op.id) if person.sex != "F" else (op.id, person.id)
                find_or_create_family(db, a, b)
    elif relation in ("brother", "sister", "sibling"):
        parents = [(p, r) for p, r in parents_of(db, person.id) if r.relation_type in ("biological", "uncertain")]
        if data.sibling_shared == "father":
            parents = [(p, r) for p, r in parents if p.sex == "M"]
        elif data.sibling_shared == "mother":
            parents = [(p, r) for p, r in parents if p.sex == "F"]
        if parents:
            for p, r in parents:
                relations.append(add_relation(db, RelationIn(parent_id=p.id, child_id=other.id, relation_type=r.relation_type)).id)
        else:
            link = SiblingLink(person1_id=person.id, person2_id=other.id,
                               relation_type={"both": "full", "father": "half", "mother": "half"}.get(data.sibling_shared, "unknown"),
                               notes="Fratrie déclarée sans parents identifiés")
            db.add(link)
            db.flush()
            relations.append(link.id)
    elif relation in ("spouse", "husband", "wife"):
        a, b = (person.id, other.id) if (person.sex == "M" or other.sex == "F") else (other.id, person.id)
        fam = find_or_create_family(db, a, b)
        if data.marriage_date or data.marriage_place:
            fam.union_type = "marriage"
            ev = Event(family_id=fam.id)
            apply_event_fields(db, ev, EventIn(event_type="marriage", date=data.marriage_date, place=data.marriage_place))
            db.add(ev)
            db.flush()
        relations.append(fam.id)
    else:  # grands-parents
        side_sex = "M" if relation.startswith("paternal") else "F"
        mid = _parent_by_sex(db, person.id, side_sex)
        if mid is None:
            # Un parent existe nécessairement : fiche d'attente explicite (identité à rechercher), jamais un ancêtre inventé.
            mid = create_person(db, PersonIn(sex=side_sex, notes="Fiche d'attente créée pour relier un grand-parent : "
                                                               "l'identité de ce parent reste à rechercher.", confidence="grey"))
            relations.append(_link_parent(db, mid, person, "biological", notes="Lien créé avec une fiche d'attente").id)
            placeholders.append(mid.id)
        relations.append(_link_parent(db, other, mid, data.relation_type).id)
    db.flush()
    db.refresh(other)
    index_person(db, other)
    return {"person": other, "relations": relations, "placeholders": placeholders,
            "message": f"{other.display_name()} ajouté(e) comme {RELATIVE_LABEL[relation]} de {person.display_name()}."}


def subtree_ids(db: Session, person_id: str, scope: str) -> set[str]:
    if scope == "descendants":
        return descendant_ids(db, person_id)
    out: set[str] = set()
    frontier = [person_id]
    while frontier:
        pid = frontier.pop()
        for r in db.execute(select(ParentChild).where(ParentChild.child_id == pid)).scalars():
            if r.parent_id not in out:
                out.add(r.parent_id)
                frontier.append(r.parent_id)
    return out
