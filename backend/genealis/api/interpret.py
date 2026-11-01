"""Interprétation des documents importés : lecture IA immédiate, propositions validées, application atomique."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..ai.documents import DOC_KINDS, analyze_media, tesseract_available
from ..ai.providers import AIClient
from ..db import get_session
from ..models import Media, Person
from ..services.interpret import ApplyError, apply_proposals, get_proposals
from ..services.journal import log
from ..services.persons import media_out

router = APIRouter(prefix="/api", tags=["interpret"])

NO_AI_MESSAGE = ("Aucune IA n'est configurée pour lire automatiquement ce document. Utilisez le mode copier-coller "
                 "(Claude ou ChatGPT avec votre abonnement), ou ajoutez une clé Gemini gratuite dans "
                 "Paramètres → Intelligence artificielle.")


class ReadingOptions(BaseModel):
    kind: str | None = None  # auto | birth | marriage | death | census | military_register | decennial_table | death_notice | family_photo | other
    person_id: str | None = None


class ApplyIn(BaseModel):
    actions: list[str] = Field(default_factory=list)
    person_overrides: dict[str, str] = Field(default_factory=dict)  # index extrait -> id de personne | "new" | "ignore"


def _media(db: Session, media_id: str) -> Media:
    m = db.get(Media, media_id)
    if not m:
        raise HTTPException(404, "Document introuvable")
    return m


def _set_options(db: Session, m: Media, opts: ReadingOptions | None) -> None:
    if opts is None:
        return
    if opts.kind is not None:
        if opts.kind not in DOC_KINDS:
            raise HTTPException(400, f"Type de document inconnu : {opts.kind}")
        m.analysis = {**(m.analysis or {}), "requested_kind": opts.kind}
    if opts.person_id:
        if not db.get(Person, opts.person_id):
            raise HTTPException(404, "Personne introuvable")
        m.person_id = opts.person_id


@router.get("/interpret/capabilities")
def capabilities(db: Session = Depends(get_session)):
    """Ce que l'application peut faire pour lire un document (sans appel réseau)."""
    ai = AIClient(db)
    info = ai.describe()
    return {"ai_available": ai.available(), "provider": info["provider"], "model": info.get("model"),
            "manual": info["provider"] == "manual", "reads_pdf": ai.provider in ("gemini", "anthropic") and ai.available(),
            "tesseract": bool(tesseract_available(db)), "kinds": [{"id": k, "label": v} for k, v in DOC_KINDS.items()],
            "message": None if ai.available() else NO_AI_MESSAGE}


@router.put("/media/{media_id}/reading-options")
def reading_options(media_id: str, body: ReadingOptions, db: Session = Depends(get_session)):
    """Type de document choisi et personne concernée (utilisés aussi par le texte du mode copier-coller)."""
    m = _media(db, media_id)
    _set_options(db, m, body)
    db.commit()
    return media_out(m, with_text=True)


@router.post("/media/{media_id}/analyze-now")
def analyze_now(media_id: str, body: ReadingOptions | None = None, db: Session = Depends(get_session)):
    """Lecture synchrone par l'IA configurée (un seul appel, fichier joint ; ~250 s au plus)."""
    m = _media(db, media_id)
    _set_options(db, m, body)
    ai = AIClient(db)
    if not ai.available() and not tesseract_available(db):
        db.commit()
        raise HTTPException(409, NO_AI_MESSAGE)
    kind = (body.kind if body else None) or (m.analysis or {}).get("requested_kind")
    m.analysis_status = "pending"
    db.flush()
    try:
        res = analyze_media(db, m, kind=kind)
    except Exception as exc:  # erreur de lecture du fichier, du modèle…
        m.analysis_status = "failed"
        m.analysis = {**(m.analysis or {}), "error": str(exc)}
        log(db, f"Lecture du document « {m.title} » échouée : {exc}", category="error", level="error", person_id=m.person_id)
        db.commit()
        raise HTTPException(502, f"La lecture du document a échoué : {exc}")
    data = res.to_dict()
    if kind:
        data["requested_kind"] = kind
    if (m.analysis or {}).get("applied"):
        data["applied"] = m.analysis["applied"]  # mémoire d'une interprétation déjà appliquée
    m.ocr_text = res.transcription
    m.language = res.language if res.language != "?" else m.language
    m.analysis = data
    m.analysis_status = "done" if (res.transcription or res.extraction.get("persons") or res.extraction.get("households")) else "failed"
    db.flush()
    n = len(res.extraction.get("persons") or []) + sum(len(h.get("members") or []) for h in res.extraction.get("households") or [])
    log(db, f"Document « {m.title} » lu ({res.method}) : {len(res.transcription)} caractères, {n} personne(s) repérée(s).",
        category="analysis", person_id=m.person_id, outcome={"method": res.method})
    if m.analysis_status == "failed":
        db.commit()
        msg = " ".join(res.warnings) or "Le document n'a pas pu être lu."
        raise HTTPException(422, msg)
    db.commit()
    return media_out(m, with_text=True)


@router.get("/media/{media_id}/proposals")
def proposals(media_id: str, refresh: bool = False, db: Session = Depends(get_session)):
    m = _media(db, media_id)
    if not (m.analysis or {}).get("extraction"):
        raise HTTPException(409, "Ce document n'a pas encore été lu : lancez la lecture (IA ou copier-coller).")
    props = get_proposals(db, m, refresh=refresh)
    db.commit()
    return props


@router.post("/media/{media_id}/apply")
def apply(media_id: str, body: ApplyIn, db: Session = Depends(get_session)):
    """Applique en une seule transaction les propositions cochées ; rien n'est écrit en cas d'erreur."""
    m = _media(db, media_id)
    if not (m.analysis or {}).get("extraction"):
        raise HTTPException(409, "Ce document n'a pas encore été lu.")
    try:
        summary = apply_proposals(db, m, body.actions, body.person_overrides)
    except ApplyError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))
    except Exception:
        db.rollback()
        raise
    db.commit()
    return summary
