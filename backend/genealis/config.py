"""Configuration de l'application. Toutes les données restent locales."""
from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def default_data_dir() -> Path:
    """Répertoire de données utilisateur selon la plateforme."""
    env = os.environ.get("GENEALIS_DATA_DIR")
    if env:
        return Path(env)
    if sys.platform.startswith("win"):
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "GenealisAI"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GENEALIS_", extra="ignore")

    data_dir: Path = default_data_dir()
    db_filename: str = "genealis.db"
    host: str = "127.0.0.1"
    port: int = 8765
    log_level: str = "INFO"
    # Limitation globale des requêtes vers les archives (secondes entre deux requêtes par connecteur)
    connector_min_interval: float = 2.0
    user_agent: str = "GenealisAI/0.1 (application personnelle de genealogie; usage non commercial; +https://github.com/valorcia/Genealis-AI)"
    # Sécurité : aucune donnée ne quitte la machine sans autorisation explicite
    allow_external_ai: bool = False
    # Mode hébergé (Vercel) : base distante, stockage objet, pas de processus permanent
    database_url: str | None = None  # ex. postgresql://user:pass@host/db (Neon) ; vide = SQLite local
    access_token: str | None = None  # mot de passe d'accès à l'API/interface (obligatoire si hébergé)
    secret_key: str | None = None  # clé Fernet (base64) pour chiffrer les clés API sans disque persistant
    blob_token: str | None = None  # BLOB_READ_WRITE_TOKEN (Vercel Blob) pour les documents
    cron_secret: str | None = None  # CRON_SECRET (Vercel) pour la tâche planifiée
    serverless: bool = False  # exécution à la demande (pas de boucle de travail)
    request_timeout: float = 25.0  # délai des requêtes vers les archives (plus court en serverless)

    @property
    def db_path(self) -> Path:
        return self.data_dir / self.db_filename

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def backup_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def log_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.media_dir, self.backup_dir, self.log_dir, self.cache_dir):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()

# Variables d'environnement standard des hébergeurs (Vercel, Neon, Blob)
if not settings.database_url:
    settings.database_url = (os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or os.environ.get("NEON_DATABASE_URL")
                             or os.environ.get("POSTGRES_PRISMA_URL") or os.environ.get("DATABASE_URL_UNPOOLED") or None)
if settings.database_url and "?" in settings.database_url:
    # Les paramètres propres à Prisma/Neon (pgbouncer, connect_timeout…) ne sont pas compris par psycopg
    base, _, query = settings.database_url.partition("?")
    keep = [kv for kv in query.split("&") if kv.split("=")[0] in ("sslmode", "options", "channel_binding")]
    settings.database_url = base + ("?" + "&".join(keep) if keep else "")
if settings.database_url and settings.database_url.startswith("postgres://"):
    settings.database_url = "postgresql://" + settings.database_url[len("postgres://"):]
if settings.database_url and settings.database_url.startswith("postgresql://") and "+psycopg" not in settings.database_url:
    settings.database_url = "postgresql+psycopg://" + settings.database_url[len("postgresql://"):]
if not settings.blob_token:
    settings.blob_token = os.environ.get("BLOB_READ_WRITE_TOKEN") or None
if not settings.cron_secret:
    settings.cron_secret = os.environ.get("CRON_SECRET") or None
if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
    settings.serverless = True
    settings.request_timeout = min(settings.request_timeout, 12.0)
    if not os.environ.get("GENEALIS_DATA_DIR"):
        settings.data_dir = Path("/tmp/genealis")  # éphémère : seuls le cache et les journaux y vivent
if not settings.access_token:
    settings.access_token = os.environ.get("ACCESS_TOKEN") or None
if not settings.secret_key:
    settings.secret_key = os.environ.get("SECRET_KEY") or None
