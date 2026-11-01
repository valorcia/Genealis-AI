"""Stockage des documents : disque local (application de bureau) ou Vercel Blob (mode hébergé).

Les fichiers originaux ne sont jamais modifiés ; seule leur localisation change.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import httpx

from ..config import settings

BLOB_API = "https://blob.vercel-storage.com"


DB_PREFIX = "db://"


def is_remote(path: str) -> bool:
    """Vrai si le fichier n'est pas sur le disque local (Blob ou base de données)."""
    return path.startswith("http://") or path.startswith("https://") or path.startswith(DB_PREFIX)


def _use_db() -> bool:
    """Mode hébergé sans stockage objet : les fichiers vont dans la base (persistante), jamais sur le disque éphémère."""
    return not settings.blob_token and bool(settings.database_url)


def _db_put(key: str, data: bytes, mime: str | None) -> None:
    from sqlalchemy import select

    from ..db import session_scope
    from ..models import StoredFile

    with session_scope() as db:
        if db.get(StoredFile, key) is None:
            db.add(StoredFile(key=key, data=data, mime=mime, size=len(data)))


def _db_get(key: str) -> bytes:
    from ..db import session_scope
    from ..models import StoredFile

    with session_scope() as db:
        row = db.get(StoredFile, key)
        if row is None:
            raise FileNotFoundError(key)
        return bytes(row.data)


def store(src: Path, relative_name: str) -> str:
    """Enregistre le fichier et retourne son chemin (local), son URL (Blob) ou sa clé en base (db://)."""
    if _use_db():
        import mimetypes

        _db_put(relative_name, src.read_bytes(), mimetypes.guess_type(relative_name)[0])
        return DB_PREFIX + relative_name
    if settings.blob_token:
        with open(src, "rb") as f:
            r = httpx.put(f"{BLOB_API}/{relative_name}", content=f.read(), timeout=120,
                          headers={"Authorization": f"Bearer {settings.blob_token}", "x-api-version": "7",
                                   "x-content-type": "application/octet-stream", "x-add-random-suffix": "0"})
        r.raise_for_status()
        return r.json()["url"]
    settings.ensure_dirs()
    dest = settings.media_dir / relative_name
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        shutil.copy2(src, dest)
    return str(dest)


def read_bytes(path: str) -> bytes:
    if path.startswith(DB_PREFIX):
        return _db_get(path[len(DB_PREFIX):])
    if is_remote(path):
        r = httpx.get(path, timeout=120, headers={"Authorization": f"Bearer {settings.blob_token}"} if settings.blob_token else None)
        r.raise_for_status()
        return r.content
    return Path(path).read_bytes()


def local_copy(path: str) -> Path:
    """Retourne un chemin local (téléchargement dans le cache si distant)."""
    if not is_remote(path):
        return Path(path)
    settings.ensure_dirs()
    name = path.rsplit("/", 1)[-1].replace(":", "_")
    dest = settings.cache_dir / "blob" / name
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(read_bytes(path))
    return dest


def delete(path: str) -> None:
    if path.startswith(DB_PREFIX):
        from ..db import session_scope
        from ..models import StoredFile

        with session_scope() as db:
            row = db.get(StoredFile, path[len(DB_PREFIX):])
            if row:
                db.delete(row)
        return
    if is_remote(path):
        if settings.blob_token:
            httpx.post(f"{BLOB_API}/delete", timeout=60, content=json.dumps({"urls": [path]}),
                       headers={"Authorization": f"Bearer {settings.blob_token}", "x-api-version": "7", "Content-Type": "application/json"})
        return
    Path(path).unlink(missing_ok=True)


def exists(path: str) -> bool:
    if path.startswith(DB_PREFIX):
        try:
            _db_get(path[len(DB_PREFIX):])
            return True
        except FileNotFoundError:
            return False
    return True if is_remote(path) else Path(path).exists()
