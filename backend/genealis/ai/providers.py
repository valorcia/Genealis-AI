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
    # Recherche web (Gemini + Google Search) : requêtes lancées, pages consultées, phrases justifiées par source
    grounding: Optional[dict] = None

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
        """Vrai si le fournisseur peut être appelé automatiquement (le mode copier-coller ne l'est pas)."""
        if self.provider == "ollama":
            return not __import__("genealis.config", fromlist=["settings"]).settings.serverless
        if self.provider == "anthropic":
            return bool(cfg.get(self.db, "anthropic_api_key")) and bool(cfg.get(self.db, "allow_external_ai"))
        if self.provider == "gemini":
            return bool(cfg.get(self.db, "gemini_api_key")) and bool(cfg.get(self.db, "allow_external_ai"))
        return False

    def describe(self) -> dict:
        model = {"ollama": cfg.get(self.db, "ollama_model"), "anthropic": cfg.get(self.db, "anthropic_model"),
                 "gemini": cfg.get(self.db, "gemini_model"), "manual": "claude.ai / chatgpt.com (abonnement, copier-coller)"}.get(self.provider)
        return {"provider": self.provider, "available": self.available(), "model": model,
                "external": self.provider in ("anthropic", "gemini"), "manual": self.provider == "manual"}

    # ---- journal des transmissions ----
    def _log_transfer(self, purpose: str, payload: str, personal: bool, authorized: bool) -> None:
        self.db.add(TransmissionLog(provider=self.provider, purpose=purpose, payload_summary=payload[:300],
                                    bytes_sent=len(payload.encode("utf-8")), contains_personal_data=personal,
                                    authorized=authorized))
        self.db.flush()

    def _check_external(self, purpose: str, payload: str, personal: bool) -> None:
        if self.provider not in ("anthropic", "gemini"):
            return
        allowed = bool(cfg.get(self.db, "allow_external_ai"))
        self._log_transfer(purpose, payload, personal, allowed)
        if not allowed:
            raise ExternalTransferRefused(
                "Transmission vers un modèle hébergé refusée : activez « Autoriser l'IA externe » dans les paramètres.")

    # ---- appels ----
    def can_search_web(self) -> bool:
        """La recherche web vérifiable (avec sources) n'est disponible qu'avec Gemini (outil Google Search)."""
        return self.provider == "gemini" and self.available()

    def complete(self, system: str, user: str, *, purpose: str = "analyse", personal: bool = True,
                 json_mode: bool = False, max_tokens: int = 2000, images: list[bytes] | None = None,
                 tools: list[dict] | None = None, attachments: list[tuple[bytes, str]] | None = None,
                 web_search: bool = False) -> AIResponse:
        """Appel du modèle. `attachments` = [(octets, type MIME)] (images, PDF) ; `web_search` = recherche Google (Gemini)."""
        if web_search and self.provider != "gemini":
            raise AIUnavailable("La recherche web avec sources nécessite Gemini (Paramètres → Intelligence artificielle).")
        files: list[tuple[bytes, str]] = [(i, _guess_mime(i)) for i in (images or [])] + list(attachments or [])
        if self.provider == "ollama":
            return self._ollama(system, user, json_mode, max_tokens, [b for b, m in files if m.startswith("image/")] or None)
        if self.provider == "anthropic":
            self._check_external(purpose, user, personal)
            return self._anthropic(system, user, max_tokens, files, tools)
        if self.provider == "gemini":
            self._check_external(purpose, user, personal)
            return self._gemini(system, user, json_mode and not web_search, max_tokens, files, web_search)
        if self.provider == "manual":
            raise AIUnavailable("Mode copier-coller : utilisez « Analyser avec Claude / ChatGPT » sur le document, puis collez la réponse.")
        raise AIUnavailable("Aucun fournisseur IA configuré (Paramètres → Intelligence artificielle).")

    def _gemini(self, system: str, user: str, json_mode: bool, max_tokens: int, files: list[tuple[bytes, str]],
                web_search: bool = False) -> AIResponse:
        """Google Gemini (API REST, niveau gratuit disponible sans carte bancaire sur aistudio.google.com)."""
        key = cfg.get(self.db, "gemini_api_key")
        if not key:
            raise AIUnavailable("Clé Gemini absente.")
        model = cfg.get(self.db, "gemini_model") or "gemini-3.8-flash"
        if model in ("gemini-2.5-flash", "gemini-1.5-flash"):  # anciens noms retirés par Google
            model = "gemini-3.8-flash"
        parts: list[dict] = [{"text": user}]
        for data, mime in files:
            parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}})
        # Les modèles Gemini récents « réfléchissent » avant de répondre : ces jetons comptent dans la limite de sortie,
        # on réserve donc une marge large pour ne jamais recevoir une réponse vide (finishReason MAX_TOKENS).
        budget = min(max(max_tokens * 4, 4096), 32768)
        body: dict[str, Any] = {"system_instruction": {"parts": [{"text": system}]}, "contents": [{"role": "user", "parts": parts}],
                                "generationConfig": {"temperature": 0.1, "maxOutputTokens": budget}}
        if json_mode:
            body["generationConfig"]["responseMimeType"] = "application/json"
        if web_search:
            body["tools"] = [{"google_search": {}}]
        try:
            r = httpx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                           params={"key": key}, json=body, timeout=120)
            if r.status_code == 404:
                # Le modèle configuré n'existe plus : on choisit automatiquement un modèle « flash » disponible.
                fallback = next((m for m in self.gemini_models() if "flash" in m and "lite" not in m), None)
                if fallback and fallback != model:
                    logger.warning("Gemini : modèle %s indisponible, repli sur %s", model, fallback)
                    cfg.set_value(self.db, "gemini_model", fallback)
                    model = fallback
                    r = httpx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                   params={"key": key}, json=body, timeout=120)
            if r.status_code != 200:
                raise AIUnavailable(f"Gemini HTTP {r.status_code} : {r.text[:200]}")
        except httpx.HTTPError as exc:
            raise AIUnavailable(f"Gemini injoignable : {exc}") from exc
        data = r.json()
        text = _gemini_text(data)
        if text is None and (data.get("candidates") or [{}])[0].get("finishReason") == "MAX_TOKENS":
            # Réponse vide car la réflexion a consommé le budget : second essai avec le maximum.
            body["generationConfig"]["maxOutputTokens"] = 32768
            r = httpx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                           params={"key": key}, json=body, timeout=180)
            data = r.json() if r.status_code == 200 else {}
            text = _gemini_text(data)
        if text is None:
            block = (data.get("promptFeedback") or {}).get("blockReason")
            raise AIUnavailable("Gemini : contenu bloqué par les filtres de sécurité du modèle." if block else f"Réponse Gemini inattendue : {str(data)[:200]}")
        grounding = parse_grounding(data) if web_search else None
        return AIResponse(text, "gemini", model, data, grounding)

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

    def _anthropic(self, system: str, user: str, max_tokens: int, files: list[tuple[bytes, str]],
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
        for data, mime in files:
            kind = "document" if mime == "application/pdf" else "image"
            content.append({"type": kind, "source": {"type": "base64", "media_type": mime, "data": base64.b64encode(data).decode()}})
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

    def gemini_models(self) -> list[str]:
        """Modèles Gemini disponibles pour cette clé (ceux qui acceptent generateContent), les plus récents d'abord."""
        key = cfg.get(self.db, "gemini_api_key")
        if not key:
            return []
        try:
            r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models", params={"key": key, "pageSize": 200}, timeout=20)
            r.raise_for_status()
        except httpx.HTTPError:
            return []
        names = [m["name"].split("/", 1)[-1] for m in r.json().get("models", [])
                 if "generateContent" in (m.get("supportedGenerationMethods") or [])]
        names = [n for n in names if n.startswith("gemini")]
        return sorted(names, reverse=True)

    def ollama_models(self) -> list[str]:
        url = cfg.get(self.db, "ollama_url", "http://127.0.0.1:11434").rstrip("/")
        try:
            r = httpx.get(f"{url}/api/tags", timeout=5)
            r.raise_for_status()
            return [m["name"] for m in r.json().get("models", [])]
        except httpx.HTTPError:
            return []


def resolve_redirect(uri: str, timeout: float = 6.0) -> str:
    """Les sources Google sont des liens de redirection : on récupère l'adresse réelle de la page (sans la télécharger)."""
    if "grounding-api-redirect" not in uri and "vertexaisearch" not in uri:
        return uri
    try:
        r = httpx.get(uri, follow_redirects=False, timeout=timeout)
        loc = r.headers.get("location")
        if loc and loc.startswith("http"):
            return loc
    except httpx.HTTPError:
        pass
    return uri


def parse_grounding(data: dict) -> dict:
    """Extrait de la réponse Gemini les requêtes Google lancées, les pages sources et les passages qu'elles justifient."""
    from concurrent.futures import ThreadPoolExecutor
    from urllib.parse import urlparse

    try:
        meta = data["candidates"][0].get("groundingMetadata") or {}
    except (KeyError, IndexError, TypeError):
        meta = {}
    chunks = [c.get("web") or {} for c in meta.get("groundingChunks") or []]
    uris = [c.get("uri", "") for c in chunks]
    with ThreadPoolExecutor(max_workers=8) as ex:
        resolved = list(ex.map(resolve_redirect, uris)) if uris else []
    sources = []
    for i, c in enumerate(chunks):
        url = resolved[i] if i < len(resolved) else c.get("uri")
        domain = (urlparse(url).netloc or c.get("title") or "").replace("www.", "")
        sources.append({"index": i, "title": c.get("title") or domain, "url": url, "domain": domain or c.get("title")})
    supports = []
    for sup in meta.get("groundingSupports") or []:
        seg = (sup.get("segment") or {}).get("text")
        idx = sup.get("groundingChunkIndices") or []
        if seg:
            supports.append({"text": seg, "sources": [i for i in idx if i < len(sources)]})
    return {"queries": meta.get("webSearchQueries") or [], "sources": sources, "supports": supports,
            "search_entry_point": bool(meta.get("searchEntryPoint"))}


def _gemini_text(data: dict) -> str | None:
    try:
        parts = data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError, TypeError):
        return None
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    return text if text.strip() else None


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
    if client.provider == "manual":
        return {**info, "ok": True, "message": "Mode copier-coller : l'application prépare le texte à coller dans claude.ai ou chatgpt.com "
                                               "(votre abonnement), puis analyse la réponse que vous collez. Rien n'est automatique."}
    if client.provider == "ollama" and __import__("genealis.config", fromlist=["settings"]).settings.serverless:
        return {**info, "ok": False, "message": "Ollama tourne sur votre ordinateur : l'application hébergée (Vercel) ne peut pas le joindre. "
                                                "Choisissez Gemini (gratuit) ou le mode copier-coller."}
    if client.provider == "gemini":
        if not cfg.get(db, "gemini_api_key"):
            return {**info, "ok": False, "message": "Clé Gemini absente (gratuite sur https://aistudio.google.com/apikey)."}
        if not cfg.get(db, "allow_external_ai"):
            return {**info, "ok": False, "message": "Clé présente mais transmission externe non autorisée."}
        try:
            r = client.complete("Réponds uniquement OK.", "Test de connexion.", purpose="test", personal=False, max_tokens=5)
            return {**info, "ok": True, "message": f"Réponse reçue de {r.model}."}
        except AIUnavailable as exc:
            return {**info, "ok": False, "message": str(exc)}
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
