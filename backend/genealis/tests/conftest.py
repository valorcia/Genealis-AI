"""Fixtures : base de données temporaire isolée (jamais l'arbre réel de l'utilisateur)."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

_tmp = tempfile.mkdtemp(prefix="genealis-test-")
os.environ["GENEALIS_DATA_DIR"] = _tmp

from genealis import config  # noqa: E402

config.settings.data_dir = Path(_tmp)
config.settings.ensure_dirs()

from genealis import db as dbmod  # noqa: E402


TEST_DB_URL = os.environ.get("GENEALIS_TEST_DATABASE_URL")  # ex. postgresql+psycopg://genealis@127.0.0.1:5433/genealis_test


@pytest.fixture(autouse=True)
def fresh_db():
    if TEST_DB_URL:
        from sqlalchemy import text

        dbmod.init_engine(url=TEST_DB_URL)
        from genealis import models  # noqa: F401

        dbmod.Base.metadata.drop_all(dbmod.get_engine())
        with dbmod.get_engine().begin() as conn:
            conn.execute(text("DROP TABLE IF EXISTS fts_index"))
            conn.execute(text("DROP TABLE IF EXISTS alembic_version"))
        dbmod.create_all()
        yield
        dbmod.get_engine().dispose()
        return
    path = Path(_tmp) / "test.db"
    for suffix in ("", "-wal", "-shm"):
        Path(str(path) + suffix).unlink(missing_ok=True)
    dbmod.init_engine(path)
    dbmod.create_all()
    yield
    dbmod.get_engine().dispose()


@pytest.fixture
def db():
    with dbmod.session_scope() as s:
        yield s


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from genealis.main import app

    with TestClient(app) as c:
        yield c
