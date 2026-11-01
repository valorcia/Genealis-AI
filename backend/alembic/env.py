"""Environnement Alembic : utilise la base locale de l'application."""
from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from genealis.config import settings  # noqa: E402
from genealis.db import Base  # noqa: E402
from genealis import models  # noqa: E402,F401

config = context.config
if config.config_file_name is not None and not os.environ.get("GENEALIS_NO_ALEMBIC_LOGGING"):
    fileConfig(config.config_file_name)
url = os.environ.get("GENEALIS_ALEMBIC_URL") or f"sqlite:///{settings.db_path.as_posix()}"
config.set_main_option("sqlalchemy.url", url)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
