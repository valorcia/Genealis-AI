"""Browser Use Cloud (service PAYANT) — abstraction prête, désactivée par défaut.

GENEALIS utilise Browser Use open source sur votre PC. Le service cloud de Browser Use est facturé à l'usage : il n'est
jamais appelé sans autorisation explicite (`browser_use_cloud_authorized`) et jamais en mode GRATUIT. Même autorisé,
cette version n'envoie AUCUNE requête au cloud : l'intégration réelle sera ajoutée plus tard derrière cette interface.
"""
from __future__ import annotations

from dataclasses import dataclass


class CloudNotAuthorized(Exception):
    """Refus clair : service payant, autorisation requise."""


@dataclass
class BrowserUseCloudProvider:
    authorized: bool = False
    cost_mode: str = "free"
    budget_usd: float = 0.0

    @classmethod
    def from_settings(cls, settings: dict) -> "BrowserUseCloudProvider":
        return cls(authorized=bool(settings.get("browser_use_cloud_authorized")), cost_mode=str(settings.get("cost_mode") or "free"),
                   budget_usd=float(settings.get("ai_monthly_budget_usd") or 0.0))

    def check(self) -> None:
        if self.cost_mode == "free":
            raise CloudNotAuthorized("Browser Use Cloud est un service payant : il est désactivé en mode GRATUIT. "
                                     "La navigation se fait sur votre PC avec Browser Use open source.")
        if not self.authorized:
            raise CloudNotAuthorized("Browser Use Cloud est un service payant : autorisation requise "
                                     "(Paramètres → Navigation → « Autoriser Browser Use Cloud »).")
        if self.budget_usd <= 0:
            raise CloudNotAuthorized("Browser Use Cloud est un service payant : fixez d'abord un budget mensuel supérieur à 0.")

    @property
    def available(self) -> bool:
        try:
            self.check()
        except CloudNotAuthorized:
            return False
        return False  # aucune intégration active dans cette version

    async def run_task(self, task: str, **kwargs) -> dict:
        self.check()
        raise CloudNotAuthorized("Browser Use Cloud n'est pas encore intégré à cette version : aucune requête n'a été envoyée "
                                 "et aucun coût n'a été engagé. La navigation locale reste utilisée.")
