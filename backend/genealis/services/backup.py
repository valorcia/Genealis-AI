"""Sauvegardes automatiques (SQLite backup API), chiffrement optionnel, restauration."""
from __future__ import annotations

import os
import shutil
import sqlite3
import zipfile
from datetime import datetime
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64

from ..config import settings


def _derive(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=390_000)
    return base64.urlsafe_b64encode(kdf.derive(passphrase.encode("utf-8")))


def create_backup(*, passphrase: str | None = None, include_media: bool = True, keep: int = 14) -> Path:
    settings.ensure_dirs()
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    tmp_db = settings.backup_dir / f"genealis-{ts}.db"
    src = sqlite3.connect(settings.db_path)
    dst = sqlite3.connect(tmp_db)
    with dst:
        src.backup(dst)
    src.close()
    dst.close()
    zip_path = settings.backup_dir / f"genealis-backup-{ts}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(tmp_db, "genealis.db")
        if include_media and settings.media_dir.exists():
            for f in settings.media_dir.rglob("*"):
                if f.is_file():
                    z.write(f, f"media/{f.relative_to(settings.media_dir).as_posix()}")
    tmp_db.unlink(missing_ok=True)
    final = zip_path
    if passphrase:
        salt = os.urandom(16)
        token = Fernet(_derive(passphrase, salt)).encrypt(zip_path.read_bytes())
        final = zip_path.with_suffix(".zip.enc")
        final.write_bytes(salt + token)
        zip_path.unlink()
    _rotate(keep)
    return final


def _rotate(keep: int) -> None:
    files = sorted([p for p in settings.backup_dir.glob("genealis-backup-*") if p.is_file()], key=lambda p: p.stat().st_mtime)
    for old in files[:-keep] if keep > 0 else []:
        old.unlink(missing_ok=True)


def list_backups() -> list[dict]:
    out = []
    for p in sorted(settings.backup_dir.glob("genealis-backup-*"), reverse=True):
        out.append({"name": p.name, "size": p.stat().st_size, "created_at": datetime.fromtimestamp(p.stat().st_mtime).isoformat(),
                    "encrypted": p.suffix == ".enc"})
    return out


def restore_backup(name: str, *, passphrase: str | None = None) -> dict:
    path = settings.backup_dir / name
    if not path.exists() or not path.name.startswith("genealis-backup-"):
        raise FileNotFoundError(name)
    data = path.read_bytes()
    if path.suffix == ".enc":
        if not passphrase:
            raise ValueError("Phrase secrète requise pour cette sauvegarde chiffrée.")
        salt, token = data[:16], data[16:]
        data = Fernet(_derive(passphrase, salt)).decrypt(token)
        tmp = settings.backup_dir / "_restore_tmp.zip"
        tmp.write_bytes(data)
        path = tmp
    # Sauvegarde de sécurité de l'état courant avant restauration
    safety = create_backup(include_media=False, keep=9999)
    from ..db import get_engine

    get_engine().dispose()
    with zipfile.ZipFile(path) as z:
        z.extract("genealis.db", settings.backup_dir / "_restore")
        extracted = settings.backup_dir / "_restore" / "genealis.db"
        for suffix in ("", "-wal", "-shm"):
            Path(str(settings.db_path) + suffix).unlink(missing_ok=True)
        shutil.move(extracted, settings.db_path)
        media_members = [m for m in z.namelist() if m.startswith("media/")]
        for m in media_members:
            target = settings.media_dir / m[len("media/"):]
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(m) as srcf, open(target, "wb") as dstf:
                shutil.copyfileobj(srcf, dstf)
    shutil.rmtree(settings.backup_dir / "_restore", ignore_errors=True)
    (settings.backup_dir / "_restore_tmp.zip").unlink(missing_ok=True)
    from ..db import create_all, init_engine

    init_engine()
    create_all()
    return {"restored": name, "safety_backup": safety.name}


# ---------- Export / import JSON (portable, mode hébergé) ----------
TABLE_ORDER = ["places", "persons", "families", "parent_child", "events", "sources", "citations", "media", "hypotheses",
               "questions", "research_tasks", "research_logs", "contradictions", "settings", "transmission_logs",
               "agent_decisions", "connector_status", "chat_messages"]


def export_json(db) -> str:
    import json

    from sqlalchemy import text

    from .. import __version__
    from ..db import Base

    out = {"genealis_version": __version__, "exported_at": datetime.now().isoformat(), "tables": {}}
    for name in TABLE_ORDER:
        table = Base.metadata.tables.get(name)
        if table is None:
            continue
        rows = db.execute(table.select()).mappings().all()
        out["tables"][name] = [{k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in r.items()} for r in rows]
    try:
        out["tables"]["fts_index"] = [dict(r) for r in db.execute(text("SELECT entity_type, entity_id, title, body FROM fts_index")).mappings().all()]
    except Exception:
        pass
    return json.dumps(out, ensure_ascii=False)


def import_json(db, data: bytes, *, replace: bool = True) -> dict:
    """Restaure une sauvegarde JSON (remplace le contenu courant)."""
    import json
    from datetime import datetime as _dt

    from sqlalchemy import text

    from ..db import Base

    payload = json.loads(data.decode("utf-8"))
    tables = payload.get("tables", {})
    stats = {}
    if replace:
        for name in reversed(TABLE_ORDER):
            table = Base.metadata.tables.get(name)
            if table is not None:
                db.execute(table.delete())
        db.execute(text("DELETE FROM fts_index"))
    for name in TABLE_ORDER:
        table = Base.metadata.tables.get(name)
        rows = tables.get(name) or []
        if table is None or not rows:
            continue
        cols = {c.name: c for c in table.columns}
        cleaned = []
        for r in rows:
            row = {}
            for k, v in r.items():
                if k not in cols:
                    continue
                if v is not None and str(cols[k].type).upper().startswith("DATETIME") and isinstance(v, str):
                    try:
                        v = _dt.fromisoformat(v)
                    except ValueError:
                        pass
                row[k] = v
            cleaned.append(row)
        db.execute(table.insert(), cleaned)
        stats[name] = len(cleaned)
    for r in tables.get("fts_index") or []:
        db.execute(text("INSERT INTO fts_index(entity_type, entity_id, title, body) VALUES (:entity_type,:entity_id,:title,:body)"), r)
    db.flush()
    return stats
