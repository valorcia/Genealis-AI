from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Event, Family, ParentChild, Person
from ..schemas import EventIn, EventOut, FamilyIn, FamilyOut, PersonDetail, PersonIn, PersonSummary, RelationIn, RelationOut
from ..services import persons as svc
from ..services.confidence import recompute_all
from ..services.consistency import run_all as run_consistency
from ..services.journal import log

router = APIRouter(prefix="/api/persons", tags=["persons"])


def _recalc(db: Session) -> None:
    run_consistency(db)
    recompute_all(db)


@router.get("", response_model=list[PersonSummary])
def list_persons(db: Session = Depends(get_session), q: str | None = None, limit: int = Query(200, le=2000), offset: int = 0):
    if q:
        return [svc.person_summary(db, p) for p in svc.search_persons(db, q, limit=limit)]
    rows = db.execute(select(Person).order_by(Person.surname, Person.given_names).limit(limit).offset(offset)).scalars().all()
    return [svc.person_summary(db, p) for p in rows]


@router.post("", response_model=PersonDetail, status_code=201)
def create_person(data: PersonIn, db: Session = Depends(get_session)):
    p = svc.create_person(db, data)
    _recalc(db)
    log(db, f"Fiche créée : {p.display_name()}", category="decision", person_id=p.id)
    db.commit()
    return svc.person_detail(db, p)


@router.get("/{person_id}", response_model=PersonDetail)
def get_person(person_id: str, db: Session = Depends(get_session)):
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Personne introuvable")
    return svc.person_detail(db, p)


@router.put("/{person_id}", response_model=PersonDetail)
def update_person(person_id: str, data: PersonIn, db: Session = Depends(get_session)):
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Personne introuvable")
    svc.update_person(db, p, data)
    _recalc(db)
    db.commit()
    return svc.person_detail(db, p)


@router.delete("/{person_id}", status_code=204)
def delete_person(person_id: str, db: Session = Depends(get_session)):
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Personne introuvable")
    svc.delete_person(db, p)
    _recalc(db)
    db.commit()


@router.post("/{person_id}/events", response_model=EventOut, status_code=201)
def add_event(person_id: str, data: EventIn, db: Session = Depends(get_session)):
    if not db.get(Person, person_id):
        raise HTTPException(404, "Personne introuvable")
    ev = svc.add_event(db, person_id, data)
    _recalc(db)
    db.commit()
    return svc.event_out(db, ev)


@router.put("/events/{event_id}", response_model=EventOut)
def update_event(event_id: str, data: EventIn, db: Session = Depends(get_session)):
    ev = db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Événement introuvable")
    svc.apply_event_fields(db, ev, data)
    _recalc(db)
    db.commit()
    return svc.event_out(db, ev)


@router.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: str, db: Session = Depends(get_session)):
    ev = db.get(Event, event_id)
    if not ev:
        raise HTTPException(404, "Événement introuvable")
    db.delete(ev)
    _recalc(db)
    db.commit()


@router.post("/relations", response_model=RelationOut, status_code=201)
def add_relation(data: RelationIn, db: Session = Depends(get_session)):
    for pid in (data.parent_id, data.child_id):
        if not db.get(Person, pid):
            raise HTTPException(404, f"Personne {pid} introuvable")
    try:
        rel = svc.add_relation(db, data)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    _recalc(db)
    db.commit()
    return svc.relation_out(rel)


@router.put("/relations/{relation_id}", response_model=RelationOut)
def update_relation(relation_id: str, data: RelationIn, db: Session = Depends(get_session)):
    rel = db.get(ParentChild, relation_id)
    if not rel:
        raise HTTPException(404, "Relation introuvable")
    rel.relation_type = data.relation_type
    rel.notes = data.notes
    _recalc(db)
    db.commit()
    return svc.relation_out(rel)


@router.delete("/relations/{relation_id}", status_code=204)
def delete_relation(relation_id: str, db: Session = Depends(get_session)):
    rel = db.get(ParentChild, relation_id)
    if not rel:
        raise HTTPException(404, "Relation introuvable")
    db.delete(rel)
    _recalc(db)
    db.commit()


@router.post("/families", response_model=FamilyOut, status_code=201)
def create_family(data: FamilyIn, db: Session = Depends(get_session)):
    f = svc.create_family(db, data)
    _recalc(db)
    db.commit()
    return svc.family_out(db, f)


@router.get("/families/{family_id}", response_model=FamilyOut)
def get_family(family_id: str, db: Session = Depends(get_session)):
    f = db.get(Family, family_id)
    if not f:
        raise HTTPException(404, "Famille introuvable")
    return svc.family_out(db, f)


@router.delete("/families/{family_id}", status_code=204)
def delete_family(family_id: str, db: Session = Depends(get_session)):
    f = db.get(Family, family_id)
    if not f:
        raise HTTPException(404, "Famille introuvable")
    db.delete(f)
    db.commit()
