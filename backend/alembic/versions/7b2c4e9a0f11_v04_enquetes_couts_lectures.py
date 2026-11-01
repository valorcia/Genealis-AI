"""v0.4 : enquêtes autonomes, file de tâches, navigation, coûts IA, cache, lectures paléographiques, mentions

Revision ID: 7b2c4e9a0f11
Revises: 4d14b1ed1de1
Create Date: 2026-11-01 14:00:00

Migration purement additive : crée uniquement les tables absentes (aucune table existante n'est modifiée).
"""
from alembic import op
import sqlalchemy as sa

revision = '7b2c4e9a0f11'
down_revision = '4d14b1ed1de1'
branch_labels = None
depends_on = None

TABLES = ("investigations", "investigation_tasks", "investigation_events", "page_visits", "ai_call_logs",
          "ai_cache", "document_readings", "reading_corrections", "person_mentions")


def upgrade() -> None:
    from genealis.db import Base
    from genealis import models  # noqa: F401 - enregistre les tables

    bind = op.get_bind()
    insp = sa.inspect(bind)
    missing = [Base.metadata.tables[t] for t in TABLES if not insp.has_table(t)]
    if missing:
        Base.metadata.create_all(bind, tables=missing)


def downgrade() -> None:
    # Volontairement non destructif : la suppression de ces tables effacerait l'historique des enquêtes.
    raise RuntimeError("Retour arrière v0.4 non destructif : supprimez les tables manuellement après sauvegarde.")
