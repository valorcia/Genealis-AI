from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Event, Family, ParentChild, Person
from ..schemas import EventIn, EventOut, FamilyIn, FamilyOut, PersonDetail, PersonIn, PersonSummary, RelationIn, RelationOut, RelativeIn
from ..services import persons as svc
from ..services.confidence import recompute_all
from ..services.consistency import run_all as run_consistency
from ..services.journal import log

router = APIRouter(prefix="/api/persons", tags=["persons"])


def _recalc(db: Session) -> None:
    run_consistency(db)
    recompute_all(db)


@router.get("", response_model=list[PersonSummary])
def list_persons(db: Session = Depends(get_session), q: str | None = None, limit: int = Query(200, le=20000), offset: int = 0):
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


@router.get("/{person_id}/kinship/{other_id}")
def kinship(person_id: str, other_id: str, db: Session = Depends(get_session)):
    """Lien de parenté : ce que `other_id` est pour `person_id`."""
    from ..services.kinship import kinship as compute

    try:
        return compute(db, person_id, other_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))


@router.post("/{person_id}/relatives", status_code=201)
def add_relative(person_id: str, data: RelativeIn, db: Session = Depends(get_session)):
    """Ajoute un proche (père, mère, frère, sœur, enfant, conjoint, grand-parent) en une seule action."""
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Personne introuvable")
    try:
        res = svc.add_relative(db, p, data)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    _recalc(db)
    log(db, res["message"], category="decision", person_id=res["person"].id)
    task_ids = []
    if data.research:
        from ..agents.engine import explore_branch

        task_ids = [t.id for t in explore_branch(db, res["person"].id, generations=1, priority=70)]
    db.commit()
    return {"person": svc.person_detail(db, res["person"]).model_dump(), "relations": res["relations"],
            "placeholders": res["placeholders"], "message": res["message"], "task_ids": task_ids}


@router.delete("/{person_id}/subtree")
def delete_subtree(person_id: str, scope: str = "descendants", include_self: bool = False, confirm: str = "",
                   db: Session = Depends(get_session)):
    """Supprime définitivement un sous-arbre (ascendants ou descendants). Exige confirm=SUPPRIMER."""
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Personne introuvable")
    if scope not in ("descendants", "ancestors"):
        raise HTTPException(400, "scope doit valoir descendants ou ancestors")
    ids = svc.subtree_ids(db, person_id, scope)
    if include_self:
        ids.add(person_id)
    if confirm != "SUPPRIMER":
        return {"would_delete": len(ids), "names": [db.get(Person, i).display_name() for i in list(ids)[:50] if db.get(Person, i)]}
    for i in ids:
        q = db.get(Person, i)
        if q:
            svc.delete_person(db, q)
    _recalc(db)
    log(db, f"Sous-arbre supprimé ({scope}) depuis {p.display_name() if not include_self else 'la personne'} : {len(ids)} fiche(s)",
        category="decision")
    db.commit()
    return {"deleted": len(ids)}


@router.post("/families/{family_id}/events", response_model=EventOut, status_code=201)
def add_family_event(family_id: str, data: EventIn, db: Session = Depends(get_session)):
    f = db.get(Family, family_id)
    if not f:
        raise HTTPException(404, "Famille introuvable")
    data.family_id = family_id
    ev = svc.add_event(db, None, data)
    if data.event_type in ("marriage", "civil_marriage", "religious_marriage"):
        f.union_type = "marriage"
    elif data.event_type == "pacs":
        f.union_type = "union"
    _recalc(db)
    db.commit()
    return svc.event_out(db, ev)


@router.put("/families/{family_id}", response_model=FamilyOut)
def update_family(family_id: str, data: FamilyIn, db: Session = Depends(get_session)):
    f = db.get(Family, family_id)
    if not f:
        raise HTTPException(404, "Famille introuvable")
    f.union_type = data.union_type or f.union_type
    f.notes = data.notes if data.notes is not None else f.notes
    db.commit()
    return svc.family_out(db, f)


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
