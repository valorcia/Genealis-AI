"""Exceptions communes de la couche IA (importables sans dépendances circulaires)."""
from __future__ import annotations


class AIUnavailable(Exception):
    pass


class ExternalTransferRefused(AIUnavailable):
    pass


class QuotaExceeded(AIUnavailable):
    """Plafond atteint (jour, minute, enquête, budget) ou quota du fournisseur épuisé : AUCUN appel n'est envoyé."""

    def __init__(self, message: str, *, scope: str = "daily", retry_after_s: int | None = None):
        super().__init__(message)
        self.scope = scope  # daily | minute | investigation | budget | provider | mode
        self.retry_after_s = retry_after_s
