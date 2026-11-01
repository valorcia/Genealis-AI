"""Questions intelligentes à l'utilisateur : pertinentes, courtes, contextualisées, non répétitives."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import utcnow, Question
from ..services.journal import log, notify


def ask(db: Session, *, title: str, problem: str, person_id: str | None = None, task_id: str | None = None,
        known_facts: list | None = None, hypotheses: list | None = None, documents: list | None = None,
        impact: str | None = None, priority: int = 50, dedupe_key: str | None = None) -> Question | None:
    """Crée une question si une question équivalente n'est pas déjà en attente ou déjà répondue."""
    key = dedupe_key or f"{person_id}:{title}"
    existing = db.execute(select(Question).where(Question.dedupe_key == key)).scalars().first()
    if existing is not None:
        if existing.status == "pending":
            existing.priority = max(existing.priority, priority)
            return None
        if existing.status == "answered":
            return None  # ne pas reposer une question déjà tranchée
    q = Question(title=title[:500], problem=problem, person_id=person_id, task_id=task_id,
                 known_facts=known_facts or [], hypotheses=hypotheses or [], documents=documents or [],
                 impact=impact, priority=priority, dedupe_key=key)
    db.add(q)
    db.flush()
    log(db, f"Nouvelle question en attente : {title}", category="question", task_id=task_id, person_id=person_id)
    notify({"type": "question", "id": q.id, "title": q.title, "priority": q.priority})
    return q


def answer(db: Session, q: Question, answer_type: str, text: str | None, payload: dict | None = None) -> Question:
    q.status = "dismissed" if answer_type == "dismiss" else "answered"
    q.answer_type = answer_type
    q.answer = text
    q.answered_at = utcnow()
    db.flush()
    log(db, f"Réponse à « {q.title} » : {answer_type}" + (f" — {text}" if text else ""), category="question",
        task_id=q.task_id, person_id=q.person_id, outcome={"answer_type": answer_type, "payload": payload or {}})
    return q


def pending(db: Session, limit: int = 100) -> list[Question]:
    return db.execute(select(Question).where(Question.status == "pending")
                      .order_by(Question.priority.desc(), Question.created_at.asc()).limit(limit)).scalars().all()


def suggest_onboarding_questions(db: Session, person) -> list[Question]:
    """Questions initiales utiles pour une personne mal renseignée."""
    out = []
    from ..services.persons import parents_of

    pars = parents_of(db, person.id)
    sexes = {p.sex for p, _ in pars}
    if "F" not in sexes:
        q = ask(db, title=f"Connais-tu le nom et le prénom de la mère de {person.display_name()} ?",
                problem="La mère n'est pas renseignée : l'acte de naissance la mentionnera, mais la connaître à l'avance "
                        "permet de distinguer les homonymes.", person_id=person.id,
                known_facts=[f"Parents connus : {', '.join(p.display_name() for p, _ in pars) or 'aucun'}"],
                impact="Permet de départager les homonymes et d'ouvrir la branche maternelle.", priority=70,
                dedupe_key=f"{person.id}:mother_name")
        if q:
            out.append(q)
    if "M" not in sexes:
        q = ask(db, title=f"Connais-tu le nom et le prénom du père de {person.display_name()} ?",
                problem="Le père n'est pas renseigné.", person_id=person.id,
                impact="Ouvre la branche paternelle.", priority=70, dedupe_key=f"{person.id}:father_name")
        if q:
            out.append(q)
    has_birth_place = any(e.event_type == "birth" and (e.place_id or e.place_original) for e in person.events)
    if not has_birth_place:
        q = ask(db, title=f"Sais-tu où est né(e) {person.display_name()} (commune, département, pays) ?",
                problem="Sans commune de naissance, la recherche dans l'état civil n'est pas ciblée.",
                person_id=person.id, impact="Détermine le service d'archives à interroger.", priority=80,
                dedupe_key=f"{person.id}:birth_place")
        if q:
            out.append(q)
    return out
