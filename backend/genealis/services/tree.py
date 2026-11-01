"""Graphes d'arbre (ascendant / descendant) et chronologie."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Event, Person
from .persons import children_of, parents_of, person_summary


def ancestors_graph(db: Session, root_id: str, max_generations: int = 12) -> dict:
    """Retourne nœuds + arêtes pour l'arbre ascendant, avec numérotation Sosa."""
    root = db.get(Person, root_id)
    if not root:
        return {"nodes": [], "edges": [], "generations": 0}
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    frontier = [(root, 1, 0)]
    max_gen = 0
    while frontier:
        person, sosa, gen = frontier.pop(0)
        if person.id in nodes and nodes[person.id]["generation"] <= gen:
            # implexe : même personne atteinte par deux chemins
            if sosa:
                nodes[person.id]["sosa"].append(sosa)
            continue
        nodes[person.id] = {**person_summary(db, person).model_dump(), "generation": gen, "sosa": [sosa] if sosa else []}
        max_gen = max(max_gen, gen)
        if gen >= max_generations:
            continue
        pars = parents_of(db, person.id)
        # Numérotation Sosa-Stradonitz : seuls les parents de filiation (biologique, adoptive, légale, incertaine)
        # occupent les cases père = 2n et mère = 2n+1 ; les beaux-parents et parents nourriciers sont montrés sans numéro.
        lineal = [(p, r) for p, r in pars if r.relation_type in ("biological", "uncertain", "adoptive", "legal")]
        lineal.sort(key=lambda t: ({"biological": 0, "uncertain": 1, "legal": 2, "adoptive": 3}.get(t[1].relation_type, 4),
                                   {"M": 0, "F": 1}.get(t[0].sex or "", 2)))
        slots: dict[int, tuple] = {}
        for parent, rel in lineal:
            want = 0 if parent.sex == "M" else 1 if parent.sex == "F" else None
            if want is None:
                want = 0 if 0 not in slots else 1
            if want in slots:
                continue  # case déjà occupée (deuxième père/mère : contradiction signalée ailleurs)
            slots[want] = (parent, rel)
        numbered = {id(v[0]) for v in slots.values()}
        for offset, (parent, rel) in sorted(slots.items()):
            edges.append({"id": rel.id, "source": parent.id, "target": person.id, "relation_type": rel.relation_type,
                          "confidence": rel.confidence})
            frontier.append((parent, sosa * 2 + offset if sosa else None, gen + 1))
        for parent, rel in pars:
            if id(parent) in numbered:
                continue
            edges.append({"id": rel.id, "source": parent.id, "target": person.id, "relation_type": rel.relation_type,
                          "confidence": rel.confidence})
            frontier.append((parent, None, gen + 1))
    return {"nodes": list(nodes.values()), "edges": edges, "generations": max_gen + 1, "root_id": root_id}


def descendants_graph(db: Session, root_id: str, max_generations: int = 8) -> dict:
    root = db.get(Person, root_id)
    if not root:
        return {"nodes": [], "edges": [], "generations": 0}
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    frontier = [(root, 0)]
    max_gen = 0
    while frontier:
        person, gen = frontier.pop(0)
        if person.id in nodes:
            continue
        nodes[person.id] = {**person_summary(db, person).model_dump(), "generation": gen}
        max_gen = max(max_gen, gen)
        if gen >= max_generations:
            continue
        for child, rel in children_of(db, person.id):
            edges.append({"id": rel.id, "source": person.id, "target": child.id, "relation_type": rel.relation_type,
                          "confidence": rel.confidence})
            frontier.append((child, gen + 1))
    return {"nodes": list(nodes.values()), "edges": edges, "generations": max_gen + 1, "root_id": root_id}


def timeline(db: Session, root_id: str | None = None) -> dict:
    """Personnes avec période de vie estimée, pour la frise chronologique."""
    if root_id:
        g = ancestors_graph(db, root_id)
        gen_of = {n["id"]: n["generation"] for n in g["nodes"]}
        persons = [db.get(Person, n["id"]) for n in g["nodes"]]
    else:
        persons = db.execute(select(Person)).scalars().all()
        gen_of = {}
    items = []
    for p in persons:
        if not p:
            continue
        s = person_summary(db, p)
        years = [e.sort_year for e in p.events if e.sort_year]
        current_year = datetime.now().year
        start = s.birth_year or (min(years) if years else None)
        end = s.death_year
        estimated = False
        if start and not end:
            # Vivant ou décès non documenté : durée estimée (80 ans), jamais au-delà d'aujourd'hui,
            # et jamais avant le dernier événement connu.
            end = min(max(start + 80, max(years) if years else start), current_year)
            estimated = True
        if end and not start:
            start = end - 60
            estimated = True
        if not start and not end:
            continue
        items.append({**s.model_dump(), "start": start, "end": end, "estimated": estimated,
                      "generation": gen_of.get(p.id),
                      "events": [{"type": e.event_type, "year": e.sort_year,
                                  "place": e.place.display() if e.place else e.place_original}
                                 for e in p.events if e.sort_year]})
    items.sort(key=lambda i: (i["generation"] if i["generation"] is not None else 99, i["start"] or 0))
    years = [i["start"] for i in items] + [i["end"] for i in items]
    return {"items": items, "min_year": min(years) if years else 1800, "max_year": max(years) if years else 2026}


def map_data(db: Session) -> dict:
    """Lieux et déplacements pour la carte."""
    points: dict[str, dict] = {}
    moves: list[dict] = []
    for p in db.execute(select(Person)).scalars():
        evs = sorted([e for e in p.events if e.place and e.place.latitude is not None],
                     key=lambda e: e.sort_year or 0)
        prev = None
        for e in evs:
            pl = e.place
            key = pl.id
            pt = points.setdefault(key, {"place_id": pl.id, "name": pl.display(), "lat": pl.latitude, "lon": pl.longitude,
                                         "events": []})
            pt["events"].append({"person_id": p.id, "person": p.display_name(), "type": e.event_type, "year": e.sort_year})
            if prev and prev.place_id != e.place_id:
                moves.append({"person_id": p.id, "person": p.display_name(), "from": prev.place.display(),
                              "to": pl.display(), "from_lat": prev.place.latitude, "from_lon": prev.place.longitude,
                              "to_lat": pl.latitude, "to_lon": pl.longitude, "year": e.sort_year})
            prev = e
    unlocated = [{"id": pl.id, "name": pl.display()} for pl in db.execute(select(__import__("genealis.models", fromlist=["Place"]).Place)).scalars()
                 if pl.latitude is None]
    return {"points": list(points.values()), "moves": moves, "unlocated_places": unlocated}
