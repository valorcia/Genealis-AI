"""Coûts, quotas et cache des appels IA ; audit du connecteur Gemini."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..ai.providers import gemini_audit
from ..db import get_session
from ..models import AICacheEntry
from ..services import cost
from ..services import settings_service as cfg
from ..services.journal import log

router = APIRouter(prefix="/api", tags=["costs"])


@router.get("/costs/summary")
def costs_summary(db: Session = Depends(get_session)):
    return cost.summary(db)


@router.get("/costs/calls")
def costs_calls(limit: int = 50, investigation_id: str | None = None, db: Session = Depends(get_session)):
    return cost.recent_calls(db, min(limit, 500), investigation_id)


@router.post("/costs/unblock")
def costs_unblock(db: Session = Depends(get_session)):
    """Lève la suspension après un quota fournisseur (à n'utiliser que si le quota est réellement rétabli)."""
    cfg.set_value(db, "ai_quota_blocked_until", None)
    log(db, "Suspension des appels IA levée manuellement", category="decision")
    db.commit()
    return cost.summary(db)


@router.delete("/costs/cache")
def costs_clear_cache(db: Session = Depends(get_session)):
    n = db.query(AICacheEntry).delete()
    log(db, f"Cache des réponses IA vidé ({n} entrées)", category="decision")
    db.commit()
    return {"deleted": n}


@router.get("/ai/gemini/audit")
def gemini_audit_get(db: Session = Depends(get_session)):
    """Audit sans appel de génération (liste officielle des modèles uniquement)."""
    rep = gemini_audit(db, probe=False)
    db.commit()
    return rep


@router.post("/ai/gemini/audit")
def gemini_audit_probe(db: Session = Depends(get_session)):
    """Audit avec 2 appels de test réels (image + recherche Google), sans aucune donnée personnelle."""
    rep = gemini_audit(db, probe=True)
    db.commit()
    return rep
