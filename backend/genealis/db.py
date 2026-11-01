"""Accès à la base SQLite locale (SQLAlchemy 2.x)."""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


_engine = None
_SessionLocal: sessionmaker | None = None


def _sqlite_url(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


def init_engine(db_path: Path | None = None, *, echo: bool = False, url: str | None = None):
    """Initialise (ou ré-initialise) le moteur SQLAlchemy : SQLite local ou base hébergée (Postgres)."""
    global _engine, _SessionLocal
    url = url or (None if db_path else settings.database_url)
    if url:
        _engine = create_engine(url, echo=echo, future=True, pool_pre_ping=True, pool_size=2, max_overflow=3,
                                pool_recycle=300)
    else:
        path = db_path or settings.db_path
        path.parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(_sqlite_url(path), echo=echo, future=True, connect_args={"check_same_thread": False})

        @event.listens_for(_engine, "connect")
        def _set_pragmas(dbapi_conn, _):  # pragma: no cover - trivial
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.close()

    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False, class_=Session)
    return _engine


def is_sqlite(engine=None) -> bool:
    return (engine or get_engine()).dialect.name == "sqlite"


def get_engine():
    if _engine is None:
        init_engine()
    return _engine


def create_all() -> None:
    """Crée/migre le schéma : Alembic (migrations versionnées) avec repli sur create_all."""
    from . import models  # noqa: F401 - enregistre les tables

    engine = get_engine()
    Base.metadata.create_all(engine)
    _stamp_or_upgrade(engine)
    from .services.fts import ensure_fts

    ensure_fts(engine)


def _stamp_or_upgrade(engine) -> None:
    """Base neuve → create_all + stamp head ; base existante → upgrade head."""
    try:
        from alembic import command
        from alembic.config import Config
        from alembic.runtime.migration import MigrationContext
        from alembic.script import ScriptDirectory
        import os

        here = Path(__file__).resolve().parent.parent
        ini = here / "alembic.ini"
        if not ini.exists():
            return
        cfg = Config(str(ini))
        cfg.set_main_option("script_location", str(here / "alembic"))
        os.environ["GENEALIS_ALEMBIC_URL"] = engine.url.render_as_string(hide_password=False)
        os.environ["GENEALIS_NO_ALEMBIC_LOGGING"] = "1"
        head = ScriptDirectory.from_config(cfg).get_current_head()
        with engine.connect() as conn:
            current = MigrationContext.configure(conn).get_current_revision()
        if current is None:
            command.stamp(cfg, "head")
        elif current != head:
            command.upgrade(cfg, "head")
    except Exception:  # pragma: no cover - les migrations ne doivent jamais empêcher le démarrage
        import logging

        logging.getLogger("genealis").exception("Migration Alembic ignorée")


def get_session() -> Iterator[Session]:
    """Dépendance FastAPI."""
    if _SessionLocal is None:
        init_engine()
    assert _SessionLocal is not None
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    if _SessionLocal is None:
        init_engine()
    assert _SessionLocal is not None
    db = _SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
