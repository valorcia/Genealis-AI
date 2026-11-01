"""Histoire familiale narrative : chaque phrase est reliée à ses sources. Aucune anecdote inventée."""
from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.orm import Session

from ..models import Person
from .persons import citations_for, gendate_of, parents_of, spouses_of, children_of, families_of


def historical_events() -> list[dict]:
    path = Path(__file__).resolve().parent.parent / "data" / "historical_events.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _place(ev) -> str | None:
    return ev.place.display() if ev.place else ev.place_original


def person_narrative(db: Session, p: Person) -> dict:
    """Paragraphes {text, sources:[citation ids], confidence}."""
    parts = []
    name = p.display_name()
    birth = next((e for e in sorted(p.events, key=lambda e: e.sort_year or 0) if e.event_type in ("birth", "baptism")), None)
    if birth:
        verb = "naît" if birth.event_type == "birth" else "est baptisé(e)"
        where = f" à {_place(birth)}" if _place(birth) else ""
        parts.append({"text": f"{gendate_of(birth).display().capitalize()}, {name} {verb}{where}.",
                      "sources": [c.model_dump() for c in citations_for(db, "event", birth.id)], "confidence": birth.confidence,
                      "year": birth.sort_year})
    pars = parents_of(db, p.id)
    if pars:
        txt = f"{p.given_names or name} est l'enfant de " + " et de ".join(pp.display_name() for pp, _ in pars) + "."
        rels = [r for _, r in pars]
        srcs = []
        for r in rels:
            srcs.extend(c.model_dump() for c in citations_for(db, "parent_child", r.id))
        lowest = min((r.confidence for r in rels), key=lambda c: {"green": 0, "orange": 1, "grey": 2, "red": 3}.get(c, 2))
        parts.append({"text": txt, "sources": srcs, "confidence": lowest, "year": birth.sort_year if birth else None})
    if p.occupation:
        parts.append({"text": f"Les documents le/la décrivent comme {p.occupation}.",
                      "sources": [c.model_dump() for c in citations_for(db, "person", p.id)], "confidence": p.confidence, "year": None})
    for f in families_of(db, p.id):
        other_id = f.partner2_id if f.partner1_id == p.id else f.partner1_id
        other = db.get(Person, other_id) if other_id else None
        m = next((e for e in f.events if e.event_type == "marriage"), None)
        if m:
            where = f" à {_place(m)}" if _place(m) else ""
            parts.append({"text": f"{gendate_of(m).display().capitalize()}, {p.given_names or name} épouse {other.display_name() if other else 'un(e) conjoint(e) non identifié(e)'}{where}.",
                          "sources": [c.model_dump() for c in citations_for(db, "event", m.id)], "confidence": m.confidence, "year": m.sort_year})
        elif other:
            parts.append({"text": f"{p.given_names or name} forme une union avec {other.display_name()} (date non documentée).",
                          "sources": [c.model_dump() for c in citations_for(db, "family", f.id)], "confidence": f.confidence, "year": None})
    for e in sorted(p.events, key=lambda e: e.sort_year or 0):
        if e.event_type in ("residence", "census", "immigration", "emigration", "naturalization", "military"):
            label = {"residence": "réside", "census": "est recensé(e)", "immigration": "arrive", "emigration": "quitte le pays",
                     "naturalization": "est naturalisé(e)", "military": "est inscrit(e) au registre matricule"}[e.event_type]
            where = f" à {_place(e)}" if _place(e) else ""
            parts.append({"text": f"En {e.sort_year or '?'}, {p.given_names or name} {label}{where}.",
                          "sources": [c.model_dump() for c in citations_for(db, "event", e.id)], "confidence": e.confidence, "year": e.sort_year})
    kids = children_of(db, p.id)
    if kids:
        parts.append({"text": f"{len(kids)} enfant(s) documenté(s) : " + ", ".join(k.display_name() for k, _ in kids) + ".",
                      "sources": [], "confidence": "grey", "year": None})
    death = next((e for e in p.events if e.event_type in ("death", "burial")), None)
    if death:
        where = f" à {_place(death)}" if _place(death) else ""
        verb = "décède" if death.event_type == "death" else "est inhumé(e)"
        parts.append({"text": f"{gendate_of(death).display().capitalize()}, {name} {verb}{where}.",
                      "sources": [c.model_dump() for c in citations_for(db, "event", death.id)], "confidence": death.confidence, "year": death.sort_year})
    # Contexte historique (distinct des faits familiaux)
    years = [x["year"] for x in parts if x.get("year")]
    context = []
    if years:
        lo, hi = min(years), max(years)
        context = [ev for ev in historical_events() if ev["end"] >= lo and ev["start"] <= hi]
    return {"person_id": p.id, "name": name, "paragraphs": parts, "historical_context": context,
            "unsourced_count": sum(1 for x in parts if not x["sources"])}


def family_narrative(db: Session, root_id: str, max_generations: int = 6) -> list[dict]:
    from .tree import ancestors_graph

    g = ancestors_graph(db, root_id, max_generations)
    ordered = sorted(g["nodes"], key=lambda n: (-n["generation"], min(n["sosa"])))
    return [person_narrative(db, db.get(Person, n["id"])) for n in ordered if db.get(Person, n["id"])]
