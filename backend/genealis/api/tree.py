from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Person
from ..services import tree as svc
from ..services.narrative import family_narrative, historical_events, person_narrative
from ..services.dashboard import stats

router = APIRouter(prefix="/api", tags=["tree"])


def _root_or_404(db: Session, root_id: str | None) -> Person:
    p = db.get(Person, root_id) if root_id else db.execute(select(Person).where(Person.is_root == True)).scalars().first()  # noqa: E712
    if not p:
        p = db.execute(select(Person)).scalars().first()
    if not p:
        raise HTTPException(404, "Aucune personne dans la base")
    return p


@router.get("/tree/ancestors")
def ancestors(root_id: str | None = None, generations: int = Query(12, le=30), db: Session = Depends(get_session)):
    return svc.ancestors_graph(db, _root_or_404(db, root_id).id, generations)


@router.get("/tree/descendants")
def descendants(root_id: str | None = None, generations: int = Query(8, le=30), db: Session = Depends(get_session)):
    return svc.descendants_graph(db, _root_or_404(db, root_id).id, generations)


@router.get("/timeline")
def timeline(root_id: str | None = None, all_persons: bool = False, db: Session = Depends(get_session)):
    rid = None if all_persons else _root_or_404(db, root_id).id
    data = svc.timeline(db, rid)
    data["historical_events"] = historical_events()
    return data


@router.get("/map")
def map_data(db: Session = Depends(get_session)):
    return svc.map_data(db)


@router.get("/narrative/{person_id}")
def narrative(person_id: str, db: Session = Depends(get_session)):
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Personne introuvable")
    return person_narrative(db, p)


@router.get("/narrative")
def family_story(root_id: str | None = None, generations: int = 6, db: Session = Depends(get_session)):
    return family_narrative(db, _root_or_404(db, root_id).id, generations)


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_session)):
    return stats(db)


@router.get("/places")
def list_places(db: Session = Depends(get_session)):
    from ..models import Place

    return [{"id": p.id, "name": p.name, "department": p.department, "country": p.country, "country_code": p.country_code,
             "lat": p.latitude, "lon": p.longitude, "historical_names": p.historical_names or []} for p in db.execute(select(Place)).scalars()]


@router.put("/places/{place_id}")
def update_place(place_id: str, body: dict, db: Session = Depends(get_session)):
    from ..models import Place

    p = db.get(Place, place_id)
    if not p:
        raise HTTPException(404, "Lieu introuvable")
    for k in ("name", "department", "region", "country", "country_code", "latitude", "longitude", "historical_names", "notes"):
        if k in body:
            setattr(p, k, body[k])
    db.commit()
    return {"id": p.id, "name": p.name, "lat": p.latitude, "lon": p.longitude}


@router.post("/places/geocode")
async def geocode_places(db: Session = Depends(get_session)):
    """Géocode les lieux sans coordonnées via des services gratuits (geo.api.gouv.fr puis Nominatim, sans clé)."""
    from ..connectors.base import SearchQuery, registry
    from ..connectors import registry_service  # noqa: F401
    from ..models import Place
    from ..services.journal import log

    todo = [p for p in db.execute(select(Place)).scalars() if p.latitude is None]
    done, errors = 0, []
    for p in todo:
        found = False
        for cid in (("geo_api_gouv", "nominatim") if (p.country_code in (None, "FR") and (p.country or "France").lower().startswith("fr")) else ("nominatim",)):
            c = registry.get(cid)
            if not c:
                continue
            try:
                res = await c.search(SearchQuery(commune=p.name if cid == "geo_api_gouv" else ", ".join(x for x in (p.name, p.department, p.country) if x)))
            except Exception as exc:
                errors.append(f"{p.name}: {exc}")
                continue
            if res and res[0].raw.get("lat") is not None:
                p.latitude, p.longitude = res[0].raw["lat"], res[0].raw["lon"]
                p.department = p.department or res[0].raw.get("department")
                p.country_code = p.country_code or res[0].raw.get("country_code") or ("FR" if cid == "geo_api_gouv" else None)
                p.country = p.country or res[0].raw.get("country") or ("France" if cid == "geo_api_gouv" else None)
                found = True
                break
        done += 1 if found else 0
    if done:
        log(db, f"Géocodage : {done}/{len(todo)} lieu(x) localisé(s) via des services gratuits.", category="connector")
    db.commit()
    return {"total": len(todo), "geocoded": done, "errors": errors[:20]}


@router.get("/stats")
def stats_endpoint(db: Session = Depends(get_session)):
    from ..services.stats import compute

    return compute(db)


@router.get("/reports/state")
def database_state(db: Session = Depends(get_session)):
    from ..services.stats import database_state as state

    return state(db)


@router.get("/events")
def list_events(event_type: str | None = None, year_from: int | None = None, year_to: int | None = None,
                place: str | None = None, limit: int = Query(2000, le=10000), db: Session = Depends(get_session)):
    """Tous les événements (personnes et familles), pour les listes, la chronique et les anniversaires."""
    from ..models import Event, Family
    from ..services.persons import gendate_of

    stmt = select(Event).order_by(Event.sort_year).limit(limit)
    if event_type:
        stmt = stmt.where(Event.event_type.in_(event_type.split(",")))
    if year_from:
        stmt = stmt.where(Event.sort_year >= year_from)
    if year_to:
        stmt = stmt.where(Event.sort_year <= year_to)
    out = []
    for e in db.execute(stmt).scalars():
        place_name = e.place.display() if e.place else e.place_original
        if place and (not place_name or place.lower() not in place_name.lower()):
            continue
        persons = []
        if e.person_id and e.person:
            persons.append({"id": e.person.id, "name": e.person.display_name(), "sex": e.person.sex})
        if e.family_id:
            f = db.get(Family, e.family_id)
            for pid in (f.partner1_id, f.partner2_id) if f else ():
                q = db.get(Person, pid) if pid else None
                if q:
                    persons.append({"id": q.id, "name": q.display_name(), "sex": q.sex})
        out.append({"id": e.id, "event_type": e.event_type, "date_display": gendate_of(e).display(), "date_start": e.date_start,
                    "date_kind": e.date_kind, "sort_year": e.sort_year, "place": place_name, "lat": e.place.latitude if e.place else None,
                    "lon": e.place.longitude if e.place else None, "description": e.description, "confidence": e.confidence,
                    "persons": persons, "family_id": e.family_id})
    return out
