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


from .errors import AIUnavailable, ExternalTransferRefused, QuotaExceeded  # noqa: E402,F401


@dataclass
class AIResponse:
    text: str
    provider: str
    model: str
    raw: Any = None
    # Recherche web (Gemini + Google Search) : requêtes lancées, pages consultées, phrases justifiées par source
    grounding: Optional[dict] = None
    # Jetons consommés {input_tokens, output_tokens, thinking_tokens} et réponse servie depuis le cache
    usage: Optional[dict] = None
    cached: bool = False

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
                 web_search: bool = False, cacheable: bool | None = None,
                 subject_person_ids: list[str] | None = None) -> AIResponse:
        """Appel du modèle. `attachments` = [(octets, type MIME)] (images, PDF) ; `web_search` = recherche Google (Gemini).

        Chaque appel passe par : protection des personnes vivantes → cache → plafonds/quotas (aucun envoi si dépassé)
        → journal des transmissions → limite de simultanéité → appel → comptage des jetons → mise en cache.
        `subject_person_ids` : personnes concernées par le contenu (un document rattaché à une personne vivante
        n'est jamais transmis sans autorisation).
        """
        import time

        from ..services import cost, privacy

        if web_search and self.provider != "gemini":
            raise AIUnavailable("La recherche web avec sources nécessite Gemini (Paramètres → Intelligence artificielle).")
        if self.provider == "manual":
            cost.check_allowed(self.db, "manual", None, purpose)
            raise AIUnavailable("Mode copier-coller : utilisez « Analyser avec Claude / ChatGPT » sur le document, puis collez la réponse.")
        if self.provider not in ("ollama", "anthropic", "gemini"):
            raise AIUnavailable("Aucun fournisseur IA configuré (Paramètres → Intelligence artificielle).")
        files: list[tuple[bytes, str]] = [(i, _guess_mime(i)) for i in (images or [])] + list(attachments or [])
        external = self.provider in ("anthropic", "gemini")
        pseudo: Pseudonymizer | None = None
        if external and personal and privacy.protection_active(self.db):
            if subject_person_ids and any(privacy.is_possibly_living(self.db, pid) for pid in subject_person_ids):
                raise ExternalTransferRefused(privacy.REFUSAL)
            names = privacy.living_names(self.db)
            if names:
                lowered = (system + "\n" + user).lower()
                present = [n for n in names if n.lower() in lowered]
                if present:
                    if web_search:
                        raise ExternalTransferRefused(privacy.REFUSAL)
                    pseudo = Pseudonymizer()
                    user = pseudo.protect(user, present)
                    system = pseudo.protect(system, present)
        model = self._model_name()
        use_cache = (purpose != "test") if cacheable is None else cacheable
        key = cost.cache_key(self.provider, model, system, user, json_mode=json_mode, web_search=web_search, files=files)
        if use_cache:
            hit = cost.cache_get(self.db, key)
            if hit is not None:
                cost.record(self.db, provider=self.provider, model=hit.model, purpose=purpose, status="cache_hit",
                            request_hash=key, attachments=len(files), web_search=web_search)
                text = pseudo.restore(hit.text) if pseudo else hit.text
                return AIResponse(text, self.provider, hit.model or model or "", None, hit.grounding, hit.usage, cached=True)
        cost.check_allowed(self.db, self.provider, model, purpose)
        if external:
            self._check_external(purpose, user, personal)
        t0 = time.monotonic()
        try:
            with cost.concurrency_slot(self.db):
                if self.provider == "ollama":
                    resp = self._ollama(system, user, json_mode, max_tokens,
                                        [b for b, m in files if m.startswith("image/")] or None)
                elif self.provider == "anthropic":
                    resp = self._anthropic(system, user, max_tokens, files, tools)
                else:
                    resp = self._gemini(system, user, json_mode and not web_search, max_tokens, files, web_search)
        except QuotaExceeded as exc:
            if exc.scope == "provider":
                cost.record(self.db, provider=self.provider, model=model, purpose=purpose, status="rate_limited",
                            duration_ms=int((time.monotonic() - t0) * 1000), request_hash=key, error=str(exc),
                            attachments=len(files), web_search=web_search)
            raise
        except AIUnavailable as exc:
            cost.record(self.db, provider=self.provider, model=model, purpose=purpose, status="error",
                        duration_ms=int((time.monotonic() - t0) * 1000), request_hash=key, error=str(exc),
                        attachments=len(files), web_search=web_search)
            raise
        cost.record(self.db, provider=self.provider, model=resp.model, purpose=purpose, status="ok", usage=resp.usage,
                    duration_ms=int((time.monotonic() - t0) * 1000), request_hash=key, attachments=len(files),
                    web_search=web_search)
        if use_cache and resp.text.strip():
            cost.cache_put(self.db, key, provider=self.provider, model=resp.model, purpose=purpose, text=resp.text,
                           grounding=resp.grounding, usage=resp.usage, ttl_days=7 if web_search else None)
        if pseudo:
            resp.text = pseudo.restore(resp.text)
        return resp

    def _model_name(self) -> str | None:
        return {"ollama": cfg.get(self.db, "ollama_model"), "anthropic": cfg.get(self.db, "anthropic_model"),
                "gemini": cfg.get(self.db, "gemini_model") or "gemini-3.8-flash"}.get(self.provider)

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
            if r.status_code == 429:
                from ..services import cost

                wait, info = cost.note_rate_limited(self.db, r.text)
                raise QuotaExceeded(cost.quota_explanation(info, wait), scope="provider", retry_after_s=wait)
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
        um = data.get("usageMetadata") or {}
        usage = {"input_tokens": um.get("promptTokenCount", 0), "output_tokens": um.get("candidatesTokenCount", 0),
                 "thinking_tokens": um.get("thoughtsTokenCount", 0)}
        return AIResponse(text, "gemini", model, data, grounding, usage)

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
        usage = {"input_tokens": data.get("prompt_eval_count", 0) or 0, "output_tokens": data.get("eval_count", 0) or 0}
        return AIResponse(data.get("message", {}).get("content", ""), "ollama", model, data, None, usage)

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
        u = getattr(msg, "usage", None)
        usage = {"input_tokens": getattr(u, "input_tokens", 0) or 0, "output_tokens": getattr(u, "output_tokens", 0) or 0}
        return AIResponse(text, "anthropic", model, msg, None, usage)

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

    def gemini_model_details(self) -> list[dict]:
        """Fiche officielle de chaque modèle (API models.list de Google) : la référence exacte vient du service lui-même."""
        key = cfg.get(self.db, "gemini_api_key")
        if not key:
            return []
        try:
            r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models", params={"key": key, "pageSize": 200}, timeout=20)
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise AIUnavailable(f"Liste des modèles Gemini inaccessible : {exc}") from exc
        out = []
        for m in r.json().get("models", []):
            name = m.get("name", "").split("/", 1)[-1]
            if not name.startswith("gemini"):
                continue
            out.append({"name": name, "display_name": m.get("displayName"), "version": m.get("version"),
                        "description": (m.get("description") or "")[:300], "input_token_limit": m.get("inputTokenLimit"),
                        "output_token_limit": m.get("outputTokenLimit"), "thinking": m.get("thinking"),
                        "methods": m.get("supportedGenerationMethods") or []})
        return sorted(out, key=lambda d: d["name"], reverse=True)

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


GEMINI_EXCLUDE = ("embedding", "tts", "image", "live", "audio", "native", "computer-use", "robotics", "aqa", "veo", "lyria")


def recommend_gemini_model(models: list[dict]) -> str | None:
    """Choisit un modèle multimodal « flash » (niveau gratuit), stable de préférence, parmi ceux réellement disponibles."""
    usable = [m for m in models if "generateContent" in m["methods"] and not any(x in m["name"] for x in GEMINI_EXCLUDE)]
    flash = [m for m in usable if "flash" in m["name"] and "lite" not in m["name"]]

    def rank(m: dict) -> tuple:
        n = m["name"]
        nums = [int(x) for x in re.findall(r"\d+", n.split("-flash")[0])] or [0]
        return ("preview" not in n and "exp" not in n, "latest" not in n, nums)

    pool = flash or usable
    return max(pool, key=rank)["name"] if pool else None


_PROBE_PNG = base64.b64decode(  # image 8x8 noire : test de la lecture d'image sans aucune donnée personnelle
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGNgGAWjYBSMAggAAAQQAAGFP6pyAAAAAElFTkSuQmCC")


def gemini_audit(db: Session, probe: bool = False) -> dict:
    """Audit du connecteur Gemini : clé, autorisation, modèle configuré vs modèles réellement disponibles,
    capacités (image, recherche Google). `probe=True` envoie 2 petits appels de test (sans donnée personnelle)."""
    client = AIClient(db)
    configured = cfg.get(db, "gemini_model") or "gemini-3.8-flash"
    report: dict[str, Any] = {"provider": client.provider, "configured_model": configured,
                              "key_set": bool(cfg.get(db, "gemini_api_key")),
                              "external_allowed": bool(cfg.get(db, "allow_external_ai")), "checks": []}

    def check(name: str, ok: bool | None, detail: str) -> None:
        report["checks"].append({"name": name, "ok": ok, "detail": detail})

    check("Clé API Gemini", report["key_set"], "présente (chiffrée)" if report["key_set"] else
          "absente : créez-la gratuitement sur https://aistudio.google.com/apikey")
    check("Transmission externe autorisée", report["external_allowed"],
          "oui" if report["external_allowed"] else "non : activez « Autoriser l'IA externe »")
    if not report["key_set"]:
        return report
    try:
        models = client.gemini_model_details()
    except AIUnavailable as exc:
        check("Liste officielle des modèles", False, str(exc))
        return report
    report["available_models"] = models
    names = {m["name"] for m in models}
    exists = configured in names
    check("Modèle configuré disponible", exists, f"{configured} {'existe' if exists else 'introuvable'} dans la liste "
          f"renvoyée par Google ({len(names)} modèles)")
    rec = recommend_gemini_model(models)
    report["recommended_model"] = rec
    if rec and rec != configured:
        check("Modèle recommandé", None, f"{rec} (multimodal « flash », niveau gratuit en général — vérifiez les conditions "
              "sur https://ai.google.dev/gemini-api/docs/pricing)")
    if probe and report["external_allowed"] and (exists or rec):
        if not exists and rec:
            cfg.set_value(db, "gemini_model", rec)
            report["configured_model"] = rec
        try:
            r = client.complete("Réponds en un mot.", "De quelle couleur est cette image ?", purpose="test", personal=False,
                                max_tokens=20, attachments=[(_PROBE_PNG, "image/png")], cacheable=False)
            check("Lecture d'image (multimodal)", True, f"{r.model} a répondu : {r.text.strip()[:60]}")
        except AIUnavailable as exc:
            check("Lecture d'image (multimodal)", False, str(exc))
        try:
            r = client.complete("Réponds brièvement.", "Quel est le site officiel des Archives nationales françaises ?",
                                purpose="test", personal=False, max_tokens=200, web_search=True, cacheable=False)
            n = len((r.grounding or {}).get("sources") or [])
            check("Recherche Google avec sources", n > 0, f"{n} source(s) citée(s)" if n else "aucune source renvoyée")
        except AIUnavailable as exc:
            check("Recherche Google avec sources", False, str(exc))
    return report
