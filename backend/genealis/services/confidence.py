"""Calcul explicable des niveaux de confiance (VERT / ORANGE / ROUGE / GRIS)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Citation, Contradiction, ParentChild, Person, Source

RELIABILITY_WEIGHT = {"primary": 1.0, "secondary": 0.6, "derivative": 0.2, "unknown": 0.3}


def _independent_sources(db: Session, target_type: str, target_id: str) -> list[Source]:
    """Sources distinctes : deux copies du même acte (même hash ou même cote) comptent pour une."""
    cits = db.execute(select(Citation).where(Citation.target_type == target_type, Citation.target_id == target_id)).scalars().all()
    seen: dict[str, Source] = {}
    for c in cits:
        s = c.source
        if not s:
            continue
        key = s.content_hash or f"{s.repository}|{s.reference}|{s.page}" if (s.reference or s.content_hash) else s.id
        if key not in seen or RELIABILITY_WEIGHT.get(s.reliability, 0.3) > RELIABILITY_WEIGHT.get(seen[key].reliability, 0.3):
            seen[key] = s
    return list(seen.values())


def score_relation(db: Session, rel: ParentChild) -> tuple[str, dict]:
    sources = _independent_sources(db, "parent_child", rel.id)
    weight = sum(RELIABILITY_WEIGHT.get(s.reliability, 0.3) for s in sources)
    primary = sum(1 for s in sources if s.reliability == "primary")
    contras = [c for c in db.execute(select(Contradiction).where(Contradiction.status == "open")).scalars()
               if rel.id in (c.relation_ids or [])]
    details = {"sources": len(sources), "primary_sources": primary, "weight": round(weight, 2),
               "contradictions": [c.description for c in contras], "relation_type": rel.relation_type,
               "criteria": []}
    if any(c.severity == "red" for c in contras):
        details["criteria"].append("Contradiction importante ouverte → ROUGE")
        return "red", details
    if rel.relation_type == "uncertain":
        details["criteria"].append("Relation déclarée incertaine → au mieux ORANGE")
        return ("orange" if sources else "grey"), details
    if not sources:
        details["criteria"].append("Aucune source → GRIS")
        return "grey", details
    if primary >= 1 and weight >= 1.5:
        details["criteria"].append("≥1 source primaire + corroboration indépendante → VERT")
        return "green", details
    if primary >= 1 and not contras:
        details["criteria"].append("Une source primaire, sans corroboration indépendante → ORANGE (à corroborer)")
        return "orange", details
    if weight >= 0.6:
        details["criteria"].append("Sources secondaires/dérivées seulement → ORANGE")
        return "orange", details
    details["criteria"].append("Sources dérivées seulement (arbres tiers) → ROUGE (insuffisant)")
    return "red", details


def score_person(db: Session, p: Person) -> tuple[str, dict]:
    sources = _independent_sources(db, "person", p.id)
    ev_sources = 0
    for e in p.events:
        ev_sources += len(_independent_sources(db, "event", e.id))
    contras = [c for c in db.execute(select(Contradiction).where(Contradiction.status == "open")).scalars()
               if p.id in (c.person_ids or [])]
    details = {"person_sources": len(sources), "event_sources": ev_sources,
               "contradictions": [c.description for c in contras], "criteria": []}
    if any(c.severity == "red" for c in contras):
        details["criteria"].append("Contradiction importante → ROUGE")
        return "red", details
    primary = sum(1 for s in sources if s.reliability == "primary")
    if (primary or ev_sources >= 2) and not contras:
        details["criteria"].append("Existence attestée par source primaire ou ≥2 sources d'événements → VERT")
        return "green", details
    if sources or ev_sources:
        details["criteria"].append("Sources présentes mais insuffisantes ou contradiction mineure → ORANGE")
        return "orange", details
    if p.is_root:
        details["criteria"].append("Personne de départ déclarée par l'utilisateur → ORANGE")
        return "orange", details
    details["criteria"].append("Aucune source → GRIS")
    return "grey", details


def recompute_all(db: Session) -> dict:
    counts = {"green": 0, "orange": 0, "red": 0, "grey": 0}
    for rel in db.execute(select(ParentChild)).scalars():
        lvl, det = score_relation(db, rel)
        rel.confidence, rel.confidence_details = lvl, det
    for p in db.execute(select(Person)).scalars():
        lvl, det = score_person(db, p)
        p.confidence, p.confidence_details = lvl, det
        counts[lvl] += 1
    db.flush()
    return counts
