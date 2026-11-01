"""Routeur « Livre de famille » : sommaire, chapitres par personne, annexes (métiers, villages, à trouver)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Person
from ..services import book as svc

router = APIRouter(prefix="/api", tags=["book"])


def _person_or_404(db: Session, person_id: str) -> Person:
    p = db.get(Person, person_id)
    if p is None:
        raise HTTPException(404, "Personne introuvable")
    return p


@router.get("/book/outline")
def book_outline(db: Session = Depends(get_session)):
    """Sommaire : ascendance directe par numéro Sosa, puis les autres personnes par génération."""
    return svc.outline(db)


@router.get("/book/person/{person_id}")
def book_person(person_id: str, wiki: bool = Query(True, description="Contexte Wikipédia (mis en cache)"),
                db: Session = Depends(get_session)):
    p = _person_or_404(db, person_id)
    out = svc.chapter(db, p, with_wiki=wiki)
    db.commit()  # cache Wikipédia
    return out


@router.post("/book/person/{person_id}/rewrite")
def book_rewrite(person_id: str, db: Session = Depends(get_session)):
    """Reformulation optionnelle par l'IA, à partir des seuls faits du chapitre ; stockée à part et étiquetée."""
    from ..ai.providers import AIUnavailable

    p = _person_or_404(db, person_id)
    try:
        out = svc.rewrite(db, p)
    except (AIUnavailable, ValueError) as exc:
        db.rollback()
        raise HTTPException(400, str(exc))
    except Exception as exc:  # erreur du fournisseur (réseau, quota…)
        db.rollback()
        raise HTTPException(400, f"La reformulation par l'IA a échoué : {exc}")
    db.commit()
    return out


@router.delete("/book/person/{person_id}/rewrite")
def book_rewrite_delete(person_id: str, db: Session = Depends(get_session)):
    _person_or_404(db, person_id)
    removed = svc.delete_rewrite(db, person_id)
    db.commit()
    return {"removed": removed}


@router.get("/book/annexes/trades")
def book_trades(wiki: bool = True, db: Session = Depends(get_session)):
    out = svc.trades_annex(db, with_wiki=wiki)
    db.commit()
    return out


@router.get("/book/annexes/places")
def book_places(wiki: bool = True, db: Session = Depends(get_session)):
    out = svc.places_annex(db, with_wiki=wiki)
    db.commit()
    return out


@router.get("/book/todo")
def book_todo(db: Session = Depends(get_session)):
    """« Dates à trouver » et « Actes à retrouver » pour tout l'arbre, par personne (avec numéro Sosa)."""
    return svc.todo_lists(db)
