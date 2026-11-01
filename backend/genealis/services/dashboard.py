"""Statistiques du tableau de bord."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (Contradiction, Hypothesis, Media, ParentChild, Person, Place, Question, ResearchLog, ResearchTask,
                      Source)
from .tree import ancestors_graph


def stats(db: Session) -> dict:
    root = db.execute(select(Person).where(Person.is_root == True)).scalars().first()  # noqa: E712
    generations, oldest = 0, None
    if root:
        g = ancestors_graph(db, root.id)
        generations = g["generations"]
        with_year = [n for n in g["nodes"] if n.get("birth_year")]
        if with_year:
            o = min(with_year, key=lambda n: n["birth_year"])
            oldest = {"id": o["id"], "name": o["display_name"], "year": o["birth_year"], "generation": o["generation"]}
    rel_counts = dict(db.execute(select(ParentChild.confidence, func.count()).group_by(ParentChild.confidence)).all())
    countries = sorted({(p.country or "").strip() for p in db.execute(select(Place)).scalars() if p.country})
    archives = sorted({s.repository for s in db.execute(select(Source)).scalars() if s.repository})
    return {
        "persons": db.scalar(select(func.count(Person.id))) or 0,
        "generations": generations,
        "oldest_ancestor": oldest,
        "relations_total": sum(rel_counts.values()),
        "relations_verified": rel_counts.get("green", 0),
        "relations_by_confidence": rel_counts,
        "hypotheses_open": db.scalar(select(func.count(Hypothesis.id)).where(Hypothesis.status == "open")) or 0,
        "documents_total": db.scalar(select(func.count(Media.id))) or 0,
        "documents_analyzed": db.scalar(select(func.count(Media.id)).where(Media.analysis_status == "done")) or 0,
        "sources": db.scalar(select(func.count(Source.id))) or 0,
        "countries": countries,
        "archives_consulted": archives,
        "tasks_running": db.scalar(select(func.count(ResearchTask.id)).where(ResearchTask.status == "running")) or 0,
        "tasks_queued": db.scalar(select(func.count(ResearchTask.id)).where(ResearchTask.status == "queued")) or 0,
        "tasks_waiting": db.scalar(select(func.count(ResearchTask.id)).where(ResearchTask.status == "waiting_user")) or 0,
        "questions_pending": db.scalar(select(func.count(Question.id)).where(Question.status == "pending")) or 0,
        "contradictions_open": db.scalar(select(func.count(Contradiction.id)).where(Contradiction.status == "open")) or 0,
        "log_entries": db.scalar(select(func.count(ResearchLog.id))) or 0,
        "root_person": {"id": root.id, "name": root.display_name()} if root else None,
    }
