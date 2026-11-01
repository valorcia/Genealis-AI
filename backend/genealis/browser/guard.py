"""Mandataire réseau local (« garde ») : point de passage OBLIGATOIRE de toutes les connexions du navigateur.

Chromium (Playwright comme Browser Use) et les téléchargements du worker passent par ce mandataire, qui applique
`security.check_host` / `check_url` à CHAQUE connexion : page principale, redirections, sous-ressources, iframes,
requêtes de scripts. Il se connecte lui-même à l'adresse IP vérifiée (pas de seconde résolution DNS : protection
contre le « DNS rebinding »). Les adresses internes (boucle locale, réseau privé, métadonnées cloud…) sont refusées.

Il ne déchiffre jamais le trafic HTTPS : pour une connexion chiffrée, il vérifie l'hôte et le port demandés, puis
relaie les octets.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Optional
from urllib.parse import urlsplit

from .security import SecurityPolicy, check_host, check_url

logger = logging.getLogger("genealis.browser.guard")

MAX_HEAD = 64 * 1024
IDLE_TIMEOUT_S = 120.0


class EgressGuard:
    """Mandataire HTTP/HTTPS filtrant, exécuté dans son propre fil (utilisable depuis du code synchrone ou asynchrone)."""

    def __init__(self, policy: SecurityPolicy | None = None, host: str = "127.0.0.1"):
        self.policy = policy or SecurityPolicy.from_settings()
        self.host = host
        self.port = 0
        self.refusals: list[dict] = []
        self.connections = 0
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._server: Optional[asyncio.base_events.Server] = None
        self._thread: Optional[threading.Thread] = None
        self._ready = threading.Event()
        self._lock = threading.Lock()

    # ---- cycle de vie
    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def start(self) -> "EgressGuard":
        if self._thread:
            return self
        self._thread = threading.Thread(target=self._run, name="genealis-egress-guard", daemon=True)
        self._thread.start()
        if not self._ready.wait(10):  # pragma: no cover
            raise RuntimeError("Le mandataire de sécurité n'a pas démarré")
        return self

    def stop(self) -> None:
        loop = self._loop
        if loop and loop.is_running():
            async def _close():
                if self._server:
                    self._server.close()
                    await self._server.wait_closed()
            try:
                asyncio.run_coroutine_threadsafe(_close(), loop).result(5)
            except Exception:  # pragma: no cover
                pass
            loop.call_soon_threadsafe(loop.stop)
        if self._thread:
            self._thread.join(5)
        self._thread = None

    def __enter__(self) -> "EgressGuard":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)

        async def _serve():
            self._server = await asyncio.start_server(self._handle, self.host, 0, limit=MAX_HEAD)
            self.port = self._server.sockets[0].getsockname()[1]
            self._ready.set()

        loop.run_until_complete(_serve())
        try:
            loop.run_forever()
        finally:
            loop.close()

    def take_refusals(self) -> list[dict]:
        with self._lock:
            out, self.refusals = self.refusals, []
        return out

    def _refuse(self, decision) -> None:
        with self._lock:
            if len(self.refusals) < 200:
                self.refusals.append({**decision.flag(), "ts": time.time()})
        logger.info("Connexion refusée par la garde : %s (%s)", decision.url[:200], decision.code)

    # ---- traitement d'une connexion
    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.connections += 1
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 30)
        except Exception:
            writer.close()
            return
        try:
            request_line, *header_lines = head.decode("latin-1").split("\r\n")
            method, target, version = request_line.split(" ", 2)
        except ValueError:
            await self._reply(writer, 400, "Requête invalide")
            return
        if method.upper() == "CONNECT":
            await self._tunnel(target, reader, writer)
        else:
            await self._forward(method, target, version, header_lines, reader, writer)

    async def _reply(self, writer: asyncio.StreamWriter, status: int, message: str, code: str = "") -> None:
        body = (f"<!doctype html><meta charset='utf-8'><title>Adresse refusée</title>"
                f"<p>GENEALIS AI : {message}</p>").encode("utf-8")
        reason = {400: "Bad Request", 403: "Forbidden", 502: "Bad Gateway"}.get(status, "Error")
        head = (f"HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {len(body)}\r\n"
                f"X-Genealis-Blocked: {code or status}\r\nConnection: close\r\n\r\n").encode("latin-1")
        try:
            writer.write(head + body)
            await writer.drain()
        except Exception:  # pragma: no cover
            pass
        finally:
            writer.close()

    async def _tunnel(self, target: str, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        host, _, port_s = target.rpartition(":")
        host = host.strip("[]")
        try:
            port = int(port_s)
        except ValueError:
            await self._reply(writer, 400, "Adresse invalide")
            return
        decision = await asyncio.to_thread(check_host, host, port, self.policy, url=f"https://{target}", scheme="https")
        if not decision.allowed:
            self._refuse(decision)
            await self._reply(writer, 403, decision.reason, decision.code)
            return
        try:
            up_r, up_w = await asyncio.wait_for(asyncio.open_connection(decision.ips[0], port), 20)
        except Exception as exc:
            await self._reply(writer, 502, f"Connexion impossible ({exc.__class__.__name__})")
            return
        writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await writer.drain()
        await self._pipe(reader, writer, up_r, up_w)

    async def _forward(self, method: str, target: str, version: str, header_lines: list[str],
                       reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        decision = await asyncio.to_thread(check_url, target, self.policy)
        if not decision.allowed or decision.scheme != "http":
            if decision.allowed:  # requête directe non-HTTP (ne devrait pas arriver)
                decision.allowed, decision.code, decision.reason = False, "scheme", "Requête refusée par la garde."
            self._refuse(decision)
            await self._reply(writer, 403, decision.reason, decision.code)
            return
        parts = urlsplit(target)
        path = parts.path or "/"
        if parts.query:
            path += "?" + parts.query
        kept = [h for h in header_lines if h and not h.lower().startswith(("proxy-connection:", "proxy-authorization:",
                                                                               "connection:", "keep-alive:"))]
        new_head = f"{method} {path} {version}\r\n" + "\r\n".join(kept + ["Connection: close"]) + "\r\n\r\n"
        try:
            up_r, up_w = await asyncio.wait_for(asyncio.open_connection(decision.ips[0], decision.port), 20)
        except Exception as exc:
            await self._reply(writer, 502, f"Connexion impossible ({exc.__class__.__name__})")
            return
        up_w.write(new_head.encode("latin-1"))
        await up_w.drain()
        await self._pipe(reader, writer, up_r, up_w)

    async def _pipe(self, c_r, c_w, u_r, u_w) -> None:
        async def copy(src: asyncio.StreamReader, dst: asyncio.StreamWriter) -> None:
            try:
                while True:
                    data = await asyncio.wait_for(src.read(65536), IDLE_TIMEOUT_S)
                    if not data:
                        break
                    dst.write(data)
                    await dst.drain()
            except Exception:
                pass
            finally:
                try:
                    dst.close()
                except Exception:  # pragma: no cover
                    pass

        await asyncio.gather(copy(c_r, u_w), copy(u_r, c_w))
