"""Paramètres persistants ; les clés API sont chiffrées sur disque (Fernet, clé locale)."""
from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet
from sqlalchemy.orm import Session

from ..config import settings as app_settings
from ..models import Setting

SECRET_KEYS = {"anthropic_api_key", "openai_api_key", "gemini_api_key", "familysearch_token", "geneanet_token"}

DEFAULTS: dict[str, Any] = {
    "autonomy_mode": 3,  # 1 assisté, 2 semi-autonome, 3 autonome contrôlé (défaut : le plus autonome, sans jamais enregistrer l'incertain)
    "ai_provider": "none",  # none | ollama | anthropic | gemini | manual
    "gemini_model": "gemini-3.8-flash",
    "ollama_url": "http://127.0.0.1:11434",
    "ollama_model": "llama3.1",
    "ollama_vision_model": "llava",
    "anthropic_model": "claude-sonnet-5-5",
    "allow_external_ai": False,  # autorise l'envoi de données vers un modèle hébergé
    "external_ai_scope": "anonymized",  # anonymized | full
    "ocr_engine": "auto",  # auto | tesseract | ai | none
    "tesseract_cmd": "",
    "ui_language": "fr",
    "backup_enabled": True,
    "backup_interval_hours": 24,
    "backup_keep": 14,
    "backup_encrypt": False,
    "backup_passphrase_set": False,
    "research_max_parallel": 1,
    "research_pause": False,
    "living_persons_privacy": True,
    "onboarding_done": False,
    "connector_min_interval": 2.0,
    "auto_archive": True,  # archiver automatiquement dans l'application les documents trouvés en ligne
}


def _key_path() -> Path:
    return app_settings.data_dir / ".secret.key"


def _fernet() -> Fernet:
    if app_settings.secret_key:
        key = app_settings.secret_key.encode("utf-8")
        if len(key) != 44:  # dérive une clé Fernet valide depuis un secret arbitraire
            import hashlib

            key = base64.urlsafe_b64encode(hashlib.sha256(key).digest())
        return Fernet(key)
    p = _key_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        key = Fernet.generate_key()
        p.write_bytes(key)
        try:
            os.chmod(p, 0o600)
        except OSError:
            pass
    return Fernet(p.read_bytes())


def get(db: Session, key: str, default: Any = None) -> Any:
    row = db.get(Setting, key)
    if row is None:
        return DEFAULTS.get(key, default)
    if row.encrypted and row.value:
        try:
            return _fernet().decrypt(base64.b64decode(row.value)).decode("utf-8")
        except Exception:
            return None
    return row.value


def set_value(db: Session, key: str, value: Any) -> None:
    encrypted = key in SECRET_KEYS
    stored = value
    if encrypted and value:
        stored = base64.b64encode(_fernet().encrypt(str(value).encode("utf-8"))).decode("ascii")
    row = db.get(Setting, key)
    if row is None:
        row = Setting(key=key, value=stored, encrypted=encrypted)
        db.add(row)
    else:
        row.value = stored
        row.encrypted = encrypted
    db.flush()


def all_public(db: Session) -> dict[str, Any]:
    out = dict(DEFAULTS)
    for row in db.query(Setting).all():
        if row.key.endswith("_lock"):
            continue
        if row.key in SECRET_KEYS:
            out[row.key + "_set"] = bool(row.value)
        else:
            out[row.key] = row.value
    for k in SECRET_KEYS:
        out.setdefault(k + "_set", False)
    return out
