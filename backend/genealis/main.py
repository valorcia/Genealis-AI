"""Point d'entrée de l'API locale GENEALIS AI."""
from __future__ import annotations

import logging
import logging.handlers
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse

from . import __version__
from .agents import engine
from .api import documents, persons, research, sources, system, tree
from .config import settings
from .db import create_all, init_engine, session_scope
from .services import settings_service as cfg


def setup_logging() -> None:
    settings.ensure_dirs()
    root = logging.getLogger()
    root.setLevel(settings.log_level)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    fh = logging.handlers.RotatingFileHandler(settings.log_dir / "genealis.log", maxBytes=2_000_000, backupCount=5, encoding="utf-8")
    fh.setFormatter(fmt)
    root.addHandler(fh)
    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(fmt)
    root.addHandler(sh)


def _frontend_dir() -> Path | None:
    candidates = [Path(getattr(sys, "_MEIPASS", "")) / "frontend" if getattr(sys, "_MEIPASS", None) else None,
                  Path(__file__).resolve().parent / "static",
                  Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"]
    for c in candidates:
        if c and (c / "index.html").exists():
            return c
    return None


_initialized = False


def ensure_initialized() -> None:
    """Initialise journal, base et migrations une seule fois par processus (lifespan ou première requête)."""
    global _initialized
    if _initialized:
        return
    setup_logging()
    init_engine()
    create_all()
    with session_scope() as db:
        engine.recover_interrupted(db)
    _initialized = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_initialized()
    if not settings.serverless:
        engine.worker.start()
        _schedule_backups()
    logging.getLogger("genealis").info("GENEALIS AI %s démarré — %s — données : %s", __version__,
                                       "mode hébergé (à la demande)" if settings.serverless else "mode local", settings.data_dir)
    yield
    if not settings.serverless:
        await engine.worker.stop()


def _schedule_backups() -> None:
    try:
        from apscheduler.schedulers.background import BackgroundScheduler

        from .services.backup import create_backup

        def job():
            with session_scope() as db:
                if not cfg.get(db, "backup_enabled", True):
                    return
                keep = int(cfg.get(db, "backup_keep", 14))
            try:
                create_backup(keep=keep)
            except Exception:  # pragma: no cover
                logging.getLogger("genealis").exception("Sauvegarde automatique échouée")

        with session_scope() as db:
            hours = int(cfg.get(db, "backup_interval_hours", 24))
        sched = BackgroundScheduler()
        sched.add_job(job, "interval", hours=max(hours, 1), id="backup")
        sched.start()
    except Exception:  # pragma: no cover
        logging.getLogger("genealis").exception("Planificateur de sauvegarde indisponible")


def create_app() -> FastAPI:
    app = FastAPI(title="GENEALIS AI", version=__version__, lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost",
                                                      "http://tauri.localhost", "https://tauri.localhost"],
                       allow_methods=["*"], allow_headers=["*"])
    for r in (system.router, persons.router, tree.router, sources.router, research.router, documents.router):
        app.include_router(r)

    @app.middleware("http")
    async def access_control(request, call_next):
        """Protection par mot de passe (obligatoire en mode hébergé) : en-tête X-Genealis-Token ou cookie."""
        ensure_initialized()
        path = request.url.path
        if settings.access_token and path.startswith("/api/") and path not in ("/api/health", "/api/auth/login") \
                and not path.startswith("/api/research/cron"):
            token = request.headers.get("x-genealis-token") or request.cookies.get("genealis_token") \
                or request.query_params.get("token")
            if token != settings.access_token:
                from starlette.responses import JSONResponse

                return JSONResponse({"detail": "Mot de passe requis"}, status_code=401)
        return await call_next(request)
    front = _frontend_dir()
    if front:
        app.mount("/assets", StaticFiles(directory=front / "assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            target = front / full_path
            if full_path and target.is_file():
                return FileResponse(target)
            return FileResponse(front / "index.html")
    return app


app = create_app()


def main() -> None:
    import uvicorn

    host = settings.host
    port = settings.port
    for i, a in enumerate(sys.argv):
        if a == "--port" and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
        if a == "--host" and i + 1 < len(sys.argv):
            host = sys.argv[i + 1]
    if "--open" in sys.argv:
        import threading
        import webbrowser

        threading.Timer(1.5, lambda: webbrowser.open(f"http://{host}:{port}/")).start()
    uvicorn.run(app, host=host, port=port, log_level=settings.log_level.lower())


if __name__ == "__main__":
    main()
