"""Lieux : résolution/création à partir d'un nom libre, géocodage local optionnel."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Place
from .names import normalize_name

_GAZETTEER: dict[str, dict] | None = None


def _gazetteer() -> dict[str, dict]:
    """Petit référentiel local de communes (coordonnées) pour fonctionner hors ligne."""
    global _GAZETTEER
    if _GAZETTEER is None:
        from ..data.gazetteer_data import GAZETTEER

        _GAZETTEER = {normalize_name(row["name"]): row for row in GAZETTEER}
    return _GAZETTEER


def parse_place_string(raw: str) -> dict:
    """"Nancy, Meurthe-et-Moselle, France" -> composantes."""
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    out: dict = {"name": parts[0] if parts else raw.strip()}
    if len(parts) >= 2:
        out["department"] = parts[1]
    if len(parts) >= 3:
        out["country"] = parts[-1]
    return out


def resolve_place(db: Session, raw: str | None, *, create: bool = True) -> Place | None:
    if not raw or not raw.strip():
        return None
    comp = parse_place_string(raw)
    key = normalize_name(comp["name"])
    for p in db.execute(select(Place)).scalars():
        if normalize_name(p.name) == key and (not comp.get("department") or not p.department
                                                or normalize_name(p.department) == normalize_name(comp["department"])):
            return p
    if not create:
        return None
    g = _gazetteer().get(key)
    place = Place(name=comp["name"], name_original=raw.strip(), department=comp.get("department"),
                  country=comp.get("country"))
    if g:
        place.department = place.department or g.get("department")
        place.region = g.get("region")
        place.country = place.country or g.get("country")
        place.country_code = g.get("country_code")
        place.latitude = g.get("lat")
        place.longitude = g.get("lon")
        place.historical_names = g.get("historical_names", [])
    db.add(place)
    db.flush()
    return place
