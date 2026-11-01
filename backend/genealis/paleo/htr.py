"""Abstraction des moteurs de lecture (HTR) : un seul modèle ne lit pas toutes les écritures.

- `GeminiHTR` : modèle multimodal configuré (Gemini recommandé, niveau gratuit) via `AIClient.complete`
  (protection des personnes vivantes, cache, quotas, journal des transmissions).
- `ManualHTR` : mode copier-coller (claude.ai / chatgpt.com par abonnement) — l'application prépare la consigne,
  l'utilisateur colle la réponse.
- `ExternalHTR` : moteur spécialisé (Transkribus, modèle local Kraken/TrOCR…) branché par une adresse HTTP.
  DÉSACTIVÉ par défaut ; refuse de fonctionner sans configuration ET autorisation explicite ; en mode GRATUIT,
  seules les adresses locales (127.0.0.1 / localhost) sont acceptées pour ne jamais déclencher un service payant.
"""
from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol
from urllib.parse import urlparse

import httpx
from sqlalchemy.orm import Session

from ..ai.errors import AIUnavailable, ExternalTransferRefused
from ..ai.providers import AIClient
from ..services import settings_service as cfg


@dataclass
class HTRRequest:
    image: bytes
    mime: str
    system: str
    prompt: str
    purpose: str = "lecture paléographique"
    subject_person_ids: Optional[list[str]] = None
    max_tokens: int = 12000


@dataclass
class HTRResult:
    payload: dict
    raw_text: str
    engine: str
    model: Optional[str] = None
    cached: bool = False
    usage: dict = field(default_factory=dict)


class HTRProvider(Protocol):
    name: str

    def available(self) -> tuple[bool, str]: ...

    def read(self, req: HTRRequest) -> HTRResult: ...


def parse_json_payload(text: str) -> dict:
    """Extrait l'objet JSON d'une réponse (tolère ```json et du texte autour)."""
    t = (text or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1)
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("Pas d'objet JSON dans la réponse")
    data = json.loads(t[start:end + 1])
    if isinstance(data, list):
        data = data[0] if data and isinstance(data[0], dict) else {}
    if not isinstance(data, dict):
        raise ValueError("Réponse JSON inattendue")
    return data


class GeminiHTR:
    """Lecture par le modèle multimodal configuré (Gemini en priorité) au travers d'AIClient."""

    name = "gemini"

    def __init__(self, db: Session):
        self.db = db
        self.ai = AIClient(db)

    def available(self) -> tuple[bool, str]:
        if self.ai.provider not in ("gemini", "anthropic", "ollama"):
            return False, "Aucun modèle de lecture configuré (Paramètres → Intelligence artificielle : Gemini, gratuit)."
        if not self.ai.available():
            return False, "Le modèle configuré n'est pas utilisable (clé absente ou transmission externe non autorisée)."
        return True, ""

    @property
    def engine(self) -> str:
        return self.ai.provider

    def read(self, req: HTRRequest) -> HTRResult:
        r = self.ai.complete(req.system, req.prompt, purpose=req.purpose[:64], personal=True, json_mode=True,
                             max_tokens=req.max_tokens, attachments=[(req.image, req.mime)],
                             subject_person_ids=req.subject_person_ids)
        try:
            payload = parse_json_payload(r.text)
        except ValueError:
            payload = {"lines": [{"n": i + 1, "diplomatic": ln} for i, ln in enumerate(r.text.strip().splitlines()) if ln.strip()],
                       "warnings": ["Le modèle n'a pas renvoyé de JSON : texte brut conservé, sans coordonnées."]}
        return HTRResult(payload, r.text, r.provider, r.model, r.cached, r.usage or {})


class ManualHTR:
    """Mode copier-coller : la consigne est copiée dans claude.ai / chatgpt.com avec l'image, la réponse est collée ici."""

    name = "manual"

    def __init__(self, db: Session):
        self.db = db

    def available(self) -> tuple[bool, str]:
        from ..services import cost

        if not cost.COST_MODES[cost.mode(self.db)]["manual_allowed"]:
            return False, "Mode COMMERCIAL : les abonnements personnels (claude.ai, chatgpt.com) ne peuvent pas servir."
        return True, ""

    @staticmethod
    def prompt(system: str, user: str) -> str:
        from .prompts import MANUAL_INTRO

        return MANUAL_INTRO + system + "\n\n" + user

    def parse(self, text: str) -> HTRResult:
        """Réponse collée : JSON paléographique (lignes) ou, à défaut, format v0.3 (transcription + ===JSON===)."""
        raw = (text or "").strip()
        if not raw:
            raise ValueError("Réponse vide.")
        try:
            payload = parse_json_payload(raw)
        except ValueError:
            payload = {}
        if not isinstance(payload.get("lines"), list):
            from ..ai.documents import parse_manual_answer

            res = parse_manual_answer(raw)
            lines = [{"n": i + 1, "diplomatic": ln} for i, ln in enumerate(res.transcription.splitlines()) if ln.strip()]
            payload = {"lines": lines, "language": res.language, "extraction": res.extraction,
                       "translation": res.extraction.get("translation_fr"), "warnings": res.warnings}
        payload.setdefault("warnings", []).append("Réponse d'un assistant externe collée manuellement : vérifiez l'image avant toute validation.")
        return HTRResult(payload, raw, "manual_llm", None, False, {})

    def read(self, req: HTRRequest) -> HTRResult:  # pragma: no cover - le mode manuel n'appelle rien automatiquement
        raise AIUnavailable("Mode copier-coller : copiez la consigne, collez la réponse de l'assistant dans le lecteur.")


_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


class ExternalHTR:
    """Moteur HTR spécialisé derrière une adresse HTTP (désactivé par défaut).

    Contrat attendu du service : POST JSON {"image_base64", "mime", "prompt", "script_type", "language"} →
    {"lines": [{"n", "text" | "diplomatic", "box_2d" | "bbox", "confidence"}], "model": "…"}.
    Réglages (aucun par défaut) : `htr_external_url`, `htr_external_name`, `htr_external_authorized` (autorisation
    explicite), `htr_external_paid` (le service est payant : refusé en mode GRATUIT).
    """

    name = "external"

    def __init__(self, db: Session):
        self.db = db
        self.url = (cfg.get(db, "htr_external_url", "") or "").strip()
        self.label = cfg.get(db, "htr_external_name", "") or "HTR externe"
        self.authorized = bool(cfg.get(db, "htr_external_authorized", False))
        self.paid = bool(cfg.get(db, "htr_external_paid", False))

    def _local(self) -> bool:
        return (urlparse(self.url).hostname or "") in _LOCAL_HOSTS

    def available(self) -> tuple[bool, str]:
        from ..services import cost

        if not self.url:
            return False, "Aucun moteur HTR spécialisé configuré (désactivé par défaut)."
        if urlparse(self.url).scheme not in ("http", "https"):
            return False, "Adresse du moteur HTR invalide."
        if not self.authorized:
            return False, "Moteur HTR externe configuré mais non autorisé : activez explicitement son utilisation."
        if cost.mode(self.db) == "free" and (self.paid or not self._local()):
            return False, ("Mode GRATUIT : seul un moteur HTR local (127.0.0.1) est accepté ; un service en ligne peut être "
                           "payant et nécessite le mode HYBRIDE avec votre accord.")
        return True, ""

    def read(self, req: HTRRequest) -> HTRResult:
        ok, why = self.available()
        if not ok:
            raise AIUnavailable(why)
        from ..services import privacy

        if not self._local() and privacy.protection_active(self.db) and req.subject_person_ids and \
                any(privacy.is_possibly_living(self.db, p) for p in req.subject_person_ids):
            raise ExternalTransferRefused(privacy.REFUSAL)
        try:
            r = httpx.post(self.url, json={"image_base64": base64.b64encode(req.image).decode(), "mime": req.mime,
                                           "prompt": req.prompt}, timeout=300)
            r.raise_for_status()
            data = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise AIUnavailable(f"{self.label} injoignable : {exc}") from exc
        lines = []
        for i, ln in enumerate(data.get("lines") or []):
            if not isinstance(ln, dict):
                continue
            conf = ln.get("confidence")
            text = ln.get("diplomatic") or ln.get("text") or ""
            entry: dict[str, Any] = {"n": ln.get("n") or i + 1, "diplomatic": text, "box_2d": ln.get("box_2d"),
                                     "bbox": ln.get("bbox")}
            if isinstance(conf, (int, float)) and conf < 0.6:
                entry["uncertain"] = [{"text": text, "alternatives": [], "reason": "confiance faible du moteur HTR",
                                       "confidence": float(conf), "box_2d": ln.get("box_2d")}]
            lines.append(entry)
        payload = {"lines": lines, "warnings": [f"Lecture par {self.label} (moteur spécialisé) : à vérifier."]}
        return HTRResult(payload, json.dumps(data)[:2000], f"htr:{self.label}", data.get("model"), False, {})


def get_provider(db: Session, name: str | None) -> HTRProvider:
    n = (name or "gemini").lower()
    if n in ("manual", "manual_llm"):
        return ManualHTR(db)
    if n in ("external", "htr") or n.startswith("htr:"):
        return ExternalHTR(db)
    return GeminiHTR(db)


def engines_status(db: Session) -> list[dict]:
    out = []
    for p in (GeminiHTR(db), ManualHTR(db), ExternalHTR(db)):
        ok, why = p.available()
        out.append({"id": p.name, "available": ok, "reason": why or None,
                    "label": {"gemini": "Modèle multimodal configuré (Gemini recommandé)", "manual": "Copier-coller (Claude / ChatGPT)",
                              "external": "Moteur HTR spécialisé (Transkribus, modèle local…) — désactivé par défaut"}[p.name]})
    return out
