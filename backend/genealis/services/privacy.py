"""Protection des personnes vivantes avant toute transmission vers un service externe.

Une personne est considérée comme possiblement vivante si `is_living` est vrai, ou si son statut est inconnu,
qu'elle est née il y a moins de 100 ans et qu'aucun décès / inhumation n'est connu.
Sans autorisation explicite (`allow_living_data_external`), les noms de ces personnes sont remplacés par des jetons
avant l'envoi, et les documents qui leur sont rattachés ne sont pas transmis.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from ..models import Event, Person
from . import settings_service as cfg

LIVING_YEARS = 100


def possibly_living_ids(db: Session) -> set[str]:
    year = date.today().year
    dead = {pid for (pid,) in db.query(Event.person_id).filter(Event.event_type.in_(("death", "burial", "cremation", "funeral")),
                                                                Event.person_id.isnot(None))}
    births = {pid: y for pid, y in db.query(Event.person_id, Event.sort_year)
              .filter(Event.event_type.in_(("birth", "baptism")), Event.sort_year.isnot(None))}
    out: set[str] = set()
    for pid, living in db.query(Person.id, Person.is_living):
        if living is True:
            out.add(pid)
        elif living is None and pid not in dead and pid in births and year - births[pid] < LIVING_YEARS:
            out.add(pid)
    return out


def is_possibly_living(db: Session, person_id: str | None) -> bool:
    return bool(person_id) and person_id in possibly_living_ids(db)


def living_names(db: Session) -> list[str]:
    """Formes de noms complets à masquer (« Prénom Nom », « NOM Prénom », premier prénom seul + nom)."""
    ids = possibly_living_ids(db)
    if not ids:
        return []
    names: set[str] = set()
    for p in db.query(Person).filter(Person.id.in_(ids)):
        surnames = [s for s in (p.surname, p.married_name) if s]
        given = (p.given_names or "").strip()
        first = given.split()[0] if given else ""
        for s in surnames:
            for g in {given, first} - {""}:
                names.add(f"{g} {s}")
                names.add(f"{s} {g}")
    return [n for n in names if len(n) > 3]


def protection_active(db: Session) -> bool:
    return bool(cfg.get(db, "living_persons_privacy", True)) and not bool(cfg.get(db, "allow_living_data_external", False))


REFUSAL = ("Ce contenu concerne une personne peut-être vivante : il n'est pas envoyé à l'IA externe sans votre autorisation "
           "(Paramètres → Confidentialité → « Autoriser l'envoi de données de personnes vivantes »).")
