"""Exécution périodique du Director : APScheduler en local, cron Vercel en mode hébergé.

- au démarrage : `queue.requeue_expired` (tâches interrompues remises en attente, reprise automatique) ;
- en local : un job toutes les `INTERVAL_S` secondes fait avancer les enquêtes pendant un budget de temps ;
- en mode hébergé (Vercel, sans processus permanent) : le cron `/api/research/cron` appelle `run_budget` ;
- un verrou en base empêche deux exécutions simultanées (cron + interface + planificateur).
"""
from __future__ import annotations

import logging
from datetime import datetime

from ..db import session_scope
from ..models import Setting, utcnow
from . import queue

logger = logging.getLogger("genealis.director")

INTERVAL_S = 30
LOCK_KEY = "investigation_step_lock"
_scheduler = None


def on_startup() -> int:
    """Reprise après redémarrage : remet en attente les tâches dont le bail a expiré."""
    try:
        with session_scope() as db:
            return queue.requeue_expired(db)
    except Exception:  # pragma: no cover - ne doit jamais empêcher le démarrage
        logger.exception("Reprise des tâches d'enquête impossible")
        return 0


def run_budget(budget_s: float = 20.0, max_tasks: int = 50) -> dict:
    """Fait avancer toutes les enquêtes actives pendant `budget_s` secondes (verrou en base)."""
    from . import director

    now = utcnow()
    with session_scope() as db:
        row = db.get(Setting, LOCK_KEY)
        if row and row.value:
            try:
                held = (now - datetime.fromisoformat(row.value)).total_seconds() < budget_s + 60
            except ValueError:
                held = False
            if held:
                return {"executed": [], "locked": True}
        if row is None:
            db.add(Setting(key=LOCK_KEY, value=now.isoformat()))
        else:
            row.value = now.isoformat()
    try:
        with session_scope() as db:
            res = director.step(db, None, budget_s=budget_s, max_tasks=max_tasks)
    finally:
        with session_scope() as db:
            row = db.get(Setting, LOCK_KEY)
            if row:
                row.value = None
    return {**res, "locked": False}


def _job() -> None:
    try:
        run_budget(20.0)
    except Exception:  # pragma: no cover
        logger.exception("Pas d'enquête du Director en échec")


def start_local_scheduler(interval_s: int = INTERVAL_S):
    """Planificateur local (PC de l'utilisateur) : avance les enquêtes sans intervention."""
    import os

    global _scheduler
    if _scheduler is not None:
        return _scheduler
    if os.environ.get("GENEALIS_DIRECTOR_SCHEDULER") == "0" or "PYTEST_CURRENT_TEST" in os.environ:
        return None  # désactivé (tests automatisés ou réglage explicite)
    try:
        from apscheduler.schedulers.background import BackgroundScheduler

        sched = BackgroundScheduler()
        sched.add_job(_job, "interval", seconds=max(5, interval_s), id="investigation_director", max_instances=1,
                      coalesce=True)
        sched.start()
        _scheduler = sched
    except Exception:  # pragma: no cover
        logger.exception("Planificateur des enquêtes indisponible")
    return _scheduler


def stop_local_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:  # pragma: no cover
            pass
        _scheduler = None
