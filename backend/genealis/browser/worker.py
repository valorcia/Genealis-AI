"""Worker navigateur LOCAL : `python -m genealis.browser.worker --server https://… --token …` (ou `--local`).

Il tourne sur le PC de l'utilisateur (Vercel ne peut pas exécuter de navigateur) :
réserve les tâches `browse` par l'API → bail renouvelé (heartbeat) → exécution (Playwright, puis Browser Use si
nécessaire) → envoi des pages visitées, captures, documents et du résultat.

- Ctrl+C : arrêt propre, la tâche en cours est remise en attente ;
- redémarrage : une tâche interrompue est libérée au démarrage suivant (fichier d'état local) ou reprise par le serveur
  quand son bail expire ;
- assistance humaine : CAPTCHA, connexion, abonnement → fenêtre visible sur la page bloquée, l'utilisateur agit
  lui-même puis confirme (Entrée dans la console ou bouton « J'ai terminé » de l'application) ; le worker ne remplit
  JAMAIS d'identifiants ;
- clé Gemini : JAMAIS reçue d'un serveur distant. Elle est lue sur ce PC : variable d'environnement `GEMINI_API_KEY`
  (ou `GENEALIS_GEMINI_API_KEY`), sinon base locale chiffrée (saisie avec `--set-gemini-key`, ou dans Paramètres de
  l'application locale).
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import logging
import os
import platform
import shutil
import signal
import socket
import sys
import threading
import time
from pathlib import Path
from typing import Any, Optional

from .. import __version__
from ..config import settings as app_settings  # importe la configuration (télémétrie Browser Use coupée) en premier
from .playwright_driver import DownloadedFile, chromium_executable, playwright_available
from .service import BrowseEnv, HumanRequest, execute_browse_task

logger = logging.getLogger("genealis.worker")

HEARTBEAT_S = 30
LEASE_S = 300
ASSIST_TIMEOUT_S = 15 * 60


def say(msg: str) -> None:
    """Message lisible pour l'utilisateur dans la console."""
    print(f"[GENEALIS worker {time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- client HTTP de l'API worker
class WorkerApiError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(f"HTTP {status} : {detail}")
        self.status, self.detail = status, detail


class WorkerApi:
    def __init__(self, base_url: str, token: str | None = None, *, client: Any = None, timeout: float = 60.0):
        import httpx

        self.base = base_url.rstrip("/")
        self.token = token
        self._own = client is None
        self.client = client or httpx.Client(timeout=timeout, follow_redirects=False)

    def close(self) -> None:
        if self._own:
            self.client.close()

    def _headers(self) -> dict:
        return {"X-Genealis-Token": self.token} if self.token else {}

    def _req(self, method: str, path: str, **kw) -> dict:
        import httpx

        last: Exception | None = None
        for attempt in range(4):
            try:
                r = self.client.request(method, self.base + path, headers=self._headers(), **kw)
            except httpx.TransportError as exc:
                last = exc
                time.sleep(min(30, 2 ** attempt))
                continue
            if r.status_code >= 400:
                try:
                    detail = r.json().get("detail", r.text)
                except Exception:
                    detail = r.text
                raise WorkerApiError(r.status_code, str(detail)[:500])
            return r.json() if r.content else {}
        raise WorkerApiError(0, f"Serveur injoignable ({last.__class__.__name__ if last else '?'})")

    def status(self) -> dict:
        return self._req("GET", "/api/worker/status")

    def claim(self, worker_id: str, capabilities: dict) -> dict:
        return self._req("POST", "/api/worker/claim", json={"worker_id": worker_id, "capabilities": capabilities,
                                                            "lease_s": LEASE_S})

    def heartbeat(self, task_id: str, worker_id: str, message: str | None = None) -> dict:
        return self._req("POST", f"/api/worker/tasks/{task_id}/heartbeat",
                         json={"worker_id": worker_id, "lease_s": LEASE_S, "message": message})

    def visit(self, task_id: str, meta: dict, screenshot: bytes | None) -> dict:
        files = {"screenshot": ("capture.jpg" if screenshot and screenshot[:2] == b"\xff\xd8" else "capture.png", screenshot,
                                "application/octet-stream")} if screenshot else None
        return self._req("POST", f"/api/worker/tasks/{task_id}/visit",
                         data={"meta": json.dumps(meta, ensure_ascii=False, default=str)}, files=files)

    def document(self, task_id: str, worker_id: str, f: DownloadedFile, page_visit_id: str | None) -> dict:
        data = {"worker_id": worker_id, "source_url": f.source_url or f.page_url or "", "page_url": f.page_url or "",
                "mime": f.mime, "title": f.title or "", "archival_reference": f.archival_reference or "",
                "page_visit_id": page_visit_id or ""}
        with open(f.path, "rb") as fh:
            return self._req("POST", f"/api/worker/tasks/{task_id}/document", data={k: v for k, v in data.items() if v},
                             files={"file": (f.filename, fh, f.mime or "application/octet-stream")})

    def result(self, task_id: str, worker_id: str, result: dict, ai_calls: list, ai_refused: str | None) -> dict:
        return self._req("POST", f"/api/worker/tasks/{task_id}/result",
                         json={"worker_id": worker_id, "result": result, "ai_calls": ai_calls, "ai_refused": ai_refused})

    def release(self, task_id: str, worker_id: str, reason: str = "") -> dict:
        return self._req("POST", f"/api/worker/tasks/{task_id}/release", json={"worker_id": worker_id, "reason": reason})


class ApiReporter:
    """Envoie au serveur chaque page visitée (avec capture) et chaque document téléchargé."""

    def __init__(self, api: WorkerApi, task_id: str, worker_id: str):
        self.api, self.task_id, self.worker_id = api, task_id, worker_id

    def visit(self, *, screenshot: bytes | None = None, **meta) -> Optional[str]:
        r = self.api.visit(self.task_id, {"worker_id": self.worker_id, **meta}, screenshot)
        return r.get("page_visit_id")

    def document(self, f: DownloadedFile, page_visit_id: Optional[str]) -> Optional[str]:
        try:
            return self.api.document(self.task_id, self.worker_id, f, page_visit_id).get("media_id")
        except WorkerApiError as exc:
            if exc.status == 415:  # refusé par la vérification du serveur
                raise ValueError(exc.detail)
            raise

    def progress(self, message: str) -> None:
        self.api.heartbeat(self.task_id, self.worker_id, message=message[:1000])


# ---------------------------------------------------------------- clé Gemini locale
def _local_db():
    """Base SQLite locale du PC (jamais la base distante) : sert uniquement à lire / ranger la clé Gemini chiffrée."""
    from .. import db as dbmod

    if dbmod._engine is None:
        dbmod.init_engine(app_settings.db_path)
        dbmod.create_all()
    return dbmod.session_scope()


def local_gemini_key() -> Optional[str]:
    for k in ("GENEALIS_GEMINI_API_KEY", "GEMINI_API_KEY"):
        if os.environ.get(k):
            return os.environ[k].strip()
    try:
        from ..services import settings_service as cfg

        with _local_db() as db:
            return cfg.get(db, "gemini_api_key") or None
    except Exception as exc:  # pragma: no cover
        logger.debug("Clé locale illisible : %s", exc)
        return None


def store_local_gemini_key(key: str) -> None:
    from ..services import settings_service as cfg

    with _local_db() as db:
        cfg.set_value(db, "gemini_api_key", key.strip())


# ---------------------------------------------------------------- worker
def capabilities(gemini_key: Optional[str], headless: bool) -> dict:
    from .agent_driver import browser_use_available

    return {"playwright": playwright_available(), "browser_use": browser_use_available(), "mode": "local_worker",
            "version": __version__, "headless": headless, "chromium": bool(chromium_executable()) or "playwright",
            "gemini_key_configured": bool(gemini_key), "platform": platform.system()}


class Worker:
    def __init__(self, api: WorkerApi, worker_id: str, *, gemini_key: Optional[str] = None, headless: Optional[bool] = None,
                 assist: bool = True, poll_s: float = 15.0, workdir: Optional[Path] = None, llm_factory=None,
                 assist_headless: bool = False, policy=None, chromium_path: Optional[str] = None,
                 interactive: Optional[bool] = None, respect_robots: bool = True, assist_timeout_s: float = ASSIST_TIMEOUT_S):
        self.api = api
        self.worker_id = worker_id[:64]
        self.gemini_key = gemini_key
        self.headless = headless
        self.assist = assist
        self.poll_s = poll_s
        self.workdir = workdir or (app_settings.cache_dir / "browser-worker")
        self.llm_factory = llm_factory
        self.assist_headless = assist_headless
        self.policy = policy
        self.chromium_path = chromium_path
        self.interactive = sys.stdin.isatty() if interactive is None else interactive
        self.respect_robots = respect_robots
        self.assist_timeout_s = assist_timeout_s
        self.stop = asyncio.Event()
        self.current_task: Optional[str] = None
        self.processed = 0

    @property
    def state_file(self) -> Path:
        return self.workdir / "worker-state.json"

    def _save_state(self, task_id: Optional[str]) -> None:
        self.workdir.mkdir(parents=True, exist_ok=True)
        if task_id:
            self.state_file.write_text(json.dumps({"task_id": task_id, "worker_id": self.worker_id}), encoding="utf-8")
        else:
            self.state_file.unlink(missing_ok=True)

    def recover(self) -> None:
        """Après un arrêt brutal : la tâche notée dans le fichier d'état est remise en attente."""
        try:
            st = json.loads(self.state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        tid = st.get("task_id")
        if tid:
            try:
                self.api.release(tid, self.worker_id, "redémarrage du worker")
                say(f"Tâche interrompue {tid} remise en attente.")
            except WorkerApiError as exc:
                logger.info("Libération de %s impossible : %s", tid, exc)
        self._save_state(None)

    async def run_forever(self, *, once: bool = False) -> None:
        self.recover()
        caps = capabilities(self.gemini_key, bool(self.headless))
        say(f"Prêt (Playwright : {'oui' if caps['playwright'] else 'NON'}, Browser Use : {'oui' if caps['browser_use'] else 'non'}, "
            f"clé Gemini locale : {'oui' if caps['gemini_key_configured'] else 'non'}). En attente de missions…")
        while not self.stop.is_set():
            try:
                did = await self.run_one()
            except WorkerApiError as exc:
                say(f"Serveur : {exc}")
                if exc.status == 401:
                    say("Mot de passe d'accès refusé : vérifiez --token (ACCESS_TOKEN de l'application).")
                    return
                did = False
            if once and did:
                return
            if not did:
                try:
                    await asyncio.wait_for(self.stop.wait(), timeout=self.poll_s)
                except asyncio.TimeoutError:
                    pass
                if once:
                    return

    async def run_one(self) -> bool:
        caps = capabilities(self.gemini_key, bool(self.headless))
        resp = await asyncio.to_thread(self.api.claim, self.worker_id, caps)
        task = resp.get("task")
        if not task:
            return False
        await self.execute(task, resp.get("ai") or {}, resp.get("settings") or {})
        return True

    async def execute(self, task: dict, ai: dict, settings: dict) -> None:
        tid = task["id"]
        self.current_task = tid
        self._save_state(tid)
        say(f"Mission : « {task.get('title')} »")
        cancel = asyncio.Event()
        workdir = self.workdir / tid
        env = BrowseEnv(settings=settings, reporter=ApiReporter(self.api, tid, self.worker_id), workdir=workdir, ai=ai,
                        gemini_key=self.gemini_key, llm_factory=self.llm_factory,
                        human_assist=(lambda req: self._human_assist(tid, req, cancel)) if self.assist else None,
                        policy=self.policy, cancel=cancel, headless=self.headless, assist_headless=self.assist_headless,
                        respect_robots=self.respect_robots, chromium_path=self.chromium_path)
        hb = asyncio.create_task(self._heartbeat_loop(tid, cancel))
        job = asyncio.create_task(execute_browse_task(task.get("params") or {}, env))
        stop_wait = asyncio.create_task(self.stop.wait())
        cancel_wait = asyncio.create_task(cancel.wait())
        try:
            done, _ = await asyncio.wait({job, stop_wait, cancel_wait}, return_when=asyncio.FIRST_COMPLETED)
            if job in done:
                out = job.result()
                r = out.result
                await asyncio.to_thread(self.api.result, tid, self.worker_id, r, out.ai_calls, out.ai_refused)
                self.processed += 1
                say(f"Terminé : {r.get('outcome')} — {len(r.get('documents') or [])} document(s), "
                    f"{len(r.get('findings') or [])} piste(s)" + (f" — {r.get('blocked_reason')}" if r.get("blocked_reason") else ""))
            else:
                job.cancel()
                try:
                    await job
                except (asyncio.CancelledError, Exception):
                    pass
                if self.stop.is_set():
                    try:
                        await asyncio.to_thread(self.api.release, tid, self.worker_id, "arrêt demandé (Ctrl+C)")
                        say("Arrêt : la mission en cours a été remise en attente.")
                    except WorkerApiError as exc:
                        say(f"Arrêt : remise en attente impossible ({exc}) ; elle sera reprise à l'expiration du bail.")
                else:
                    say("Mission interrompue par le serveur (enquête en pause ou annulée).")
        finally:
            for t in (hb, stop_wait, cancel_wait):
                t.cancel()
            self.current_task = None
            self._save_state(None)
            shutil.rmtree(workdir, ignore_errors=True)

    async def _heartbeat_loop(self, tid: str, cancel: asyncio.Event) -> None:
        while True:
            await asyncio.sleep(HEARTBEAT_S)
            try:
                r = await asyncio.to_thread(self.api.heartbeat, tid, self.worker_id)
            except WorkerApiError as exc:
                if exc.status in (404, 409):
                    cancel.set()
                    return
                continue
            if r.get("cancel"):
                cancel.set()
                return

    async def _human_assist(self, tid: str, req: HumanRequest, cancel: asyncio.Event) -> bool:
        """Pause pour l'utilisateur. Ne remplit jamais d'identifiants, ne résout jamais de CAPTCHA à sa place."""
        if not req.automation_allowed:
            say(f"{req.reason}\n  → {req.url}")
            if self.interactive and not self.assist_headless:
                try:
                    import webbrowser

                    webbrowser.open(req.url)  # navigateur habituel de l'utilisateur, sans aucune automatisation
                except Exception:  # pragma: no cover
                    pass
            return True
        msg = f"Action requise : {req.reason} Une fenêtre est ouverte sur {req.url}. Agissez vous-même, puis confirmez."
        say(msg + (" Appuyez sur Entrée ici quand c'est fait (ou cliquez « J'ai terminé » dans l'application)."
                   if self.interactive else " Cliquez « J'ai terminé » dans l'application."))
        try:
            hb = await asyncio.to_thread(self.api.heartbeat, tid, self.worker_id, msg)
        except WorkerApiError:
            return False
        since = hb.get("server_time") or ""
        confirmed = asyncio.Event()
        if self.interactive:
            threading.Thread(target=lambda: (sys.stdin.readline(), confirmed.set()), daemon=True).start()
        deadline = time.monotonic() + self.assist_timeout_s
        while time.monotonic() < deadline and not cancel.is_set() and not self.stop.is_set():
            if confirmed.is_set():
                return True
            try:
                r = await asyncio.to_thread(self.api.heartbeat, tid, self.worker_id)
                if r.get("cancel"):
                    cancel.set()
                    return False
                if r.get("human_done_at") and r["human_done_at"] >= since:
                    return True
            except WorkerApiError:
                pass
            try:
                await asyncio.wait_for(confirmed.wait(), timeout=3)
            except asyncio.TimeoutError:
                pass
        say("Aucune confirmation reçue : la mission reste BLOQUÉE en attente de votre action.")
        return False


# ---------------------------------------------------------------- ligne de commande
def _check(api: Optional[WorkerApi], key: Optional[str]) -> int:
    """Diagnostic d'installation : dépendances, Chromium, clé locale, serveur."""
    ok = True
    say(f"Python {platform.python_version()} ({platform.system()})")
    pw = playwright_available()
    say(f"Playwright : {'installé' if pw else 'ABSENT (pip install -e \"backend[browser]\")'}")
    ok &= pw
    if pw:
        async def launch() -> str:
            from playwright.async_api import async_playwright

            async with async_playwright() as p:
                b = await p.chromium.launch(executable_path=chromium_executable(), headless=True)
                v = b.version
                await b.close()
                return v
        try:
            say(f"Chromium : démarre correctement (version {asyncio.run(launch())})")
        except Exception as exc:
            ok = False
            say(f"Chromium : NE DÉMARRE PAS ({str(exc).splitlines()[0][:200]}) → python -m playwright install chromium")
    from .agent_driver import browser_use_available

    say(f"Browser Use : {'installé' if browser_use_available() else 'absent (agent IA indisponible)'}")
    say(f"Clé Gemini locale : {'configurée' if key else 'non configurée (agent IA indisponible ; --set-gemini-key)'}")
    if api:
        try:
            st = api.status()
            say(f"Serveur : joignable (worker connu : {st.get('worker_id') or 'aucun'})")
        except WorkerApiError as exc:
            ok = False
            say(f"Serveur : {exc}")
    say("Diagnostic : tout est prêt." if ok else "Diagnostic : à corriger (voir ci-dessus).")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m genealis.browser.worker",
                                 description="Worker navigateur local GENEALIS (Playwright + Browser Use open source).")
    ap.add_argument("--server", help="Adresse de l'application (ex. https://mon-genealis.vercel.app)")
    ap.add_argument("--token", help="Mot de passe d'accès (ACCESS_TOKEN). Sinon : variable GENEALIS_ACCESS_TOKEN ou saisie.")
    ap.add_argument("--local", action="store_true", help="Backend de ce PC (http://127.0.0.1:8765)")
    ap.add_argument("--worker-id", default=f"pc-{socket.gethostname()}"[:64])
    ap.add_argument("--once", action="store_true", help="Traiter au plus une mission puis quitter")
    ap.add_argument("--poll", type=float, default=15.0, help="Délai entre deux demandes de mission (secondes)")
    vis = ap.add_mutually_exclusive_group()
    vis.add_argument("--visible", action="store_true", help="Navigateur visible")
    vis.add_argument("--headless", action="store_true", help="Navigateur invisible (défaut : réglage de l'application)")
    ap.add_argument("--no-assist", action="store_true", help="Ne jamais ouvrir de fenêtre pour l'assistance humaine")
    ap.add_argument("--set-gemini-key", action="store_true", help="Saisir la clé Gemini et la ranger chiffrée sur ce PC")
    ap.add_argument("--check", action="store_true", help="Diagnostic de l'installation")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

    if a.set_gemini_key:
        key = getpass.getpass("Clé API Gemini (Google AI Studio) — rien ne s'affiche pendant la saisie : ").strip()
        if not key:
            say("Aucune clé saisie.")
            return 1
        store_local_gemini_key(key)
        say(f"Clé enregistrée chiffrée dans {app_settings.db_path} (elle ne quitte jamais ce PC, sauf vers Google).")
        return 0
    server = a.server or os.environ.get("GENEALIS_SERVER_URL")
    token = a.token or os.environ.get("GENEALIS_ACCESS_TOKEN")
    if a.local or not server:
        server = server or f"http://127.0.0.1:{app_settings.port}"
        token = token or app_settings.access_token
    if server.startswith("http://") and not any(h in server for h in ("127.0.0.1", "localhost", "[::1]")):
        say("Attention : adresse non chiffrée (http://). Utilisez https:// pour une application en ligne.")
    key = local_gemini_key()
    api = WorkerApi(server, token)
    if a.check:  # sans --server ni --local : diagnostic du PC seulement (utilisé par le script d'installation)
        return _check(api if (a.server or a.local or os.environ.get("GENEALIS_SERVER_URL")) else None, key)
    try:
        api.status()
    except WorkerApiError as exc:
        if exc.status == 401 and sys.stdin.isatty():
            api.token = getpass.getpass("Mot de passe d'accès de l'application : ").strip()
        elif exc.status == 401:
            say("Mot de passe d'accès requis : --token ou GENEALIS_ACCESS_TOKEN.")
            return 2
        else:
            say(f"Serveur injoignable ({exc}). Nouvel essai automatique…")
    headless = True if a.headless else (False if a.visible else None)
    worker = Worker(api, a.worker_id, gemini_key=key, headless=headless, assist=not a.no_assist, poll_s=a.poll)
    say(f"Connecté à {server} — identifiant du worker : {a.worker_id}. Ctrl+C pour arrêter proprement.")

    async def runner() -> None:
        loop = asyncio.get_running_loop()
        hits = {"n": 0}

        def on_sigint(*_):
            hits["n"] += 1
            if hits["n"] > 1:
                os._exit(130)
            say("Arrêt demandé : fin propre en cours (Ctrl+C à nouveau pour forcer)…")
            loop.call_soon_threadsafe(worker.stop.set)

        signal.signal(signal.SIGINT, on_sigint)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, on_sigint)
        await worker.run_forever(once=a.once)

    try:
        asyncio.run(runner())
    finally:
        api.close()
    say("Worker arrêté.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
