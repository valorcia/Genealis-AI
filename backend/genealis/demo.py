"""Mode démonstration : charge la famille FICTIVE de test dans une base séparée (jamais l'arbre réel).

Usage : GENEALIS_DATA_DIR=<dossier démo> python -m genealis.demo
"""
from __future__ import annotations

import sys
from pathlib import Path

from .config import settings
from .db import create_all, init_engine, session_scope


def main() -> None:
    if "demo" not in settings.data_dir.name.lower() and "--force" not in sys.argv:
        print("Refus : le dossier de données doit contenir « demo » dans son nom pour éviter tout mélange avec votre arbre réel.")
        print(f"Dossier actuel : {settings.data_dir}. Exemple : GENEALIS_DATA_DIR=~/GenealisAI-demo")
        sys.exit(2)
    settings.ensure_dirs()
    init_engine()
    create_all()
    from .services.confidence import recompute_all
    from .services.consistency import run_all
    from .tests.fixtures import build_fictional_family

    with session_scope() as db:
        f = build_fictional_family(db)
        run_all(db)
        recompute_all(db)
        from .services import settings_service as cfg

        cfg.set_value(db, "onboarding_done", True)
        cfg.set_value(db, "autonomy_mode", 2)
        print(f"Famille fictive chargée dans {settings.db_path} ({len(f)} fiches). Lancez le moteur avec le même GENEALIS_DATA_DIR.")


if __name__ == "__main__":
    main()
