"""Fournisseurs IA : aucun (règles seules), Ollama (local), Anthropic (hébergé, sur autorisation explicite).

Toute transmission vers un service hébergé est journalisée (TransmissionLog) et refusée si l'utilisateur
n'a pas activé `allow_external_ai`. Les données personnelles peuvent être pseudonymisées avant envoi.
"""
from __future__ import annotations

import base64
import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from ..models import TransmissionLog
from ..services import settings_service as cfg

logger = logging.getLogger("genealis.ai")


class AIUnavailable(Exception):
    pass


class ExternalTransferRefused(AIUnavailable):
    pass


@dataclass
class AIResponse:
    text: str
    provider: str
    model: str
    raw: Any = None

    def json(self) -> Any:
        """Extrait un objet JSON de la réponse (tolère les blocs ```json)."""
        t = self.text.strip()
        m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
        if m:
            t = m.group(1)
        start = t.find("{")
        start_l = t.find("[")
        if start_l != -1 and (start == -1 or start_l < start):
            start = start_l
        if start == -1:
            raise ValueError("Pas de JSON dans la réponse IA")
        return json.loads(t[start:])


class Pseudonymizer:
    """Remplace les noms propres par des jetons réversibles avant envoi externe."""

    def __init__(self) -> None:
        self.map: dict[str, str] = {}
        self.rev: dict[str, str] = {}

    def protect(self, text: str, names: list[str]) -> str:
        for n in sorted({x for x in names if x and len(x) > 1}, key=len, reverse=True):
            if n not in self.map:
                token = f"NOM{len(self.map) + 1}"
                self.map[n] = token
                self.rev[token] = n
            text = re.sub(re.escape(n), self.map[n], text, flags=re.I)
        return text

    def restore(self, text: str) -> str:
        for token, n in self.rev.items():
            text = text.replace(token, n)
        return text


class AIClient:
    def __init__(self, db: Session):
        self.db = db
        self.provider = cfg.get(db, "ai_provider", "none")

    # ---- état ----
    def available(self) -> bool:
        if self.provider == "ollama":
            return True
        if self.provider == "anthropic":
            return bool(cfg.get(self.db, "anthropic_api_key")) and bool(cfg.get(self.db, "allow_external_ai"))
        return False

    def describe(self) -> dict:
        return {"provider": self.provider, "available": self.available(),
                "model": cfg.get(self.db, "ollama_model") if self.provider == "ollama" else cfg.get(self.db, "anthropic_model"),
                "external": self.provider == "anthropic"}

    # ---- journal des transmissions ----
    def _log_transfer(self, purpose: str, payload: str, personal: bool, authorized: bool) -> None:
        self.db.add(TransmissionLog(provider=self.provider, purpose=purpose, payload_summary=payload[:300],
                                    bytes_sent=len(payload.encode("utf-8")), contains_personal_data=personal,
                                    authorized=authorized))
        self.db.flush()

    def _check_external(self, purpose: str, payload: str, personal: bool) -> None:
        if self.provider != "anthropic":
            return
        allowed = bool(cfg.get(self.db, "allow_external_ai"))
        self._log_transfer(purpose, payload, personal, allowed)
        if not allowed:
            raise ExternalTransferRefused(
                "Transmission vers un modèle hébergé refusée : activez « Autoriser l'IA externe » dans les paramètres.")

    # ---- appels ----
    def complete(self, system: str, user: str, *, purpose: str = "analyse", personal: bool = True,
                 json_mode: bool = False, max_tokens: int = 2000, images: list[bytes] | None = None,
                 tools: list[dict] | None = None) -> AIResponse:
        if self.provider == "ollama":
            return self._ollama(system, user, json_mode, max_tokens, images)
        if self.provider == "anthropic":
            self._check_external(purpose, user, personal)
            return self._anthropic(system, user, max_tokens, images, tools)
        raise AIUnavailable("Aucun fournisseur IA configuré (Paramètres → Intelligence artificielle).")

    def _ollama(self, system: str, user: str, json_mode: bool, max_tokens: int, images: list[bytes] | None) -> AIResponse:
        url = cfg.get(self.db, "ollama_url", "http://127.0.0.1:11434").rstrip("/")
        model = cfg.get(self.db, "ollama_vision_model") if images else cfg.get(self.db, "ollama_model")
        body: dict[str, Any] = {"model": model, "stream": False, "options": {"num_predict": max_tokens, "temperature": 0.1},
                                "messages": [{"role": "system", "content": system},
                                             {"role": "user", "content": user,
                                              **({"images": [base64.b64encode(i).decode() for i in images]} if images else {})}]}
        if json_mode:
            body["format"] = "json"
        try:
            r = httpx.post(f"{url}/api/chat", json=body, timeout=600)
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise AIUnavailable(f"Ollama injoignable ({url}) : {exc}") from exc
        data = r.json()
        return AIResponse(data.get("message", {}).get("content", ""), "ollama", model, data)

    def _anthropic(self, system: str, user: str, max_tokens: int, images: list[bytes] | None,
                   tools: list[dict] | None) -> AIResponse:
        try:
            import anthropic
        except ImportError as exc:  # pragma: no cover
            raise AIUnavailable("Le paquet anthropic n'est pas installé.") from exc
        key = cfg.get(self.db, "anthropic_api_key")
        if not key:
            raise AIUnavailable("Clé API Anthropic absente.")
        model = cfg.get(self.db, "anthropic_model", "claude-sonnet-5-5")
        client = anthropic.Anthropic(api_key=key)
        content: list[dict] = []
        for img in images or []:
            content.append({"type": "image", "source": {"type": "base64", "media_type": _guess_mime(img),
                                                        "data": base64.b64encode(img).decode()}})
        content.append({"type": "text", "text": user})
        kwargs: dict[str, Any] = {"model": model, "max_tokens": max_tokens, "system": system,
                                  "messages": [{"role": "user", "content": content}]}
        if tools:
            kwargs["tools"] = tools
        try:
            msg = client.messages.create(**kwargs)
        except Exception as exc:
            raise AIUnavailable(f"Erreur API Anthropic : {exc}") from exc
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        return AIResponse(text, "anthropic", model, msg)

    def ollama_models(self) -> list[str]:
        url = cfg.get(self.db, "ollama_url", "http://127.0.0.1:11434").rstrip("/")
        try:
            r = httpx.get(f"{url}/api/tags", timeout=5)
            r.raise_for_status()
            return [m["name"] for m in r.json().get("models", [])]
        except httpx.HTTPError:
            return []


def _guess_mime(data: bytes) -> str:
    if data[:4] == b"\x89PNG":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF":
        return "image/webp"
    return "image/jpeg"


def test_provider(db: Session) -> dict:
    client = AIClient(db)
    info = client.describe()
    if client.provider == "none":
        return {**info, "ok": False, "message": "Aucun fournisseur configuré : l'application fonctionne avec les règles seules."}
    if client.provider == "ollama":
        models = client.ollama_models()
        ok = bool(models)
        return {**info, "ok": ok, "models": models,
                "message": "Ollama joignable" if ok else "Ollama injoignable ou sans modèle installé."}
    if client.provider == "anthropic":
        if not cfg.get(db, "anthropic_api_key"):
            return {**info, "ok": False, "message": "Clé API absente."}
        if not cfg.get(db, "allow_external_ai"):
            return {**info, "ok": False, "message": "Clé présente mais transmission externe non autorisée."}
        try:
            r = client.complete("Réponds uniquement OK.", "Test de connexion.", purpose="test", personal=False, max_tokens=5)
            return {**info, "ok": True, "message": f"Réponse reçue de {r.model}."}
        except AIUnavailable as exc:
            return {**info, "ok": False, "message": str(exc)}
    return {**info, "ok": False, "message": "Fournisseur inconnu."}
