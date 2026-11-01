"""Archivage dans l'application des documents trouvés en ligne (images, PDF, pages web).

Respecte robots.txt et les conditions des sites : si un site refuse l'archivage automatique, l'utilisateur est invité
à télécharger ou capturer le document lui-même puis à l'importer. Les pages web sont archivées en instantané HTML
nettoyé (scripts retirés) et affichées dans un bac à sable.
"""
from __future__ import annotations

import hashlib
import mimetypes
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Media
from .journal import log
from .media_service import import_file

MAX_BYTES = 20_000_000
EXT_BY_MIME = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp", "image/tiff": ".tif",
               "image/bmp": ".bmp", "application/pdf": ".pdf", "text/html": ".html", "text/plain": ".txt",
               "application/xhtml+xml": ".html", "image/heic": ".heic"}
# Sites dont les conditions interdisent la collecte automatisée : pas d'archivage automatique.
NO_AUTO = ("geneanet.org", "familysearch.org", "ancestry.", "myheritage.", "filae.com")


class ArchiveRefused(Exception):
    pass


def _client(transport: Optional[httpx.BaseTransport] = None) -> httpx.Client:
    return httpx.Client(timeout=min(settings.request_timeout * 2, 40), follow_redirects=True, transport=transport,
                        headers={"User-Agent": settings.user_agent, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5"})


def robots_allows(url: str, client: httpx.Client) -> bool:
    parsed = urlparse(url)
    try:
        r = client.get(f"{parsed.scheme}://{parsed.netloc}/robots.txt")
    except httpx.HTTPError:
        return True  # robots.txt injoignable : pas d'interdiction connue
    if r.status_code != 200:
        return True
    rp = RobotFileParser()
    rp.parse(r.text.splitlines())
    return rp.can_fetch(settings.user_agent, url) and rp.can_fetch("*", url)


def sanitize_html(html: str, url: str) -> str:
    html = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.S | re.I)
    html = re.sub(r"<noscript\b[^>]*>.*?</noscript>", "", html, flags=re.S | re.I)
    html = re.sub(r"<iframe\b[^>]*>.*?</iframe>", "", html, flags=re.S | re.I)
    html = re.sub(r"\son[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", "", html, flags=re.I)
    html = re.sub(r"javascript:", "", html, flags=re.I)
    banner = (f'<div style="font:13px system-ui;background:#fff8e1;border-bottom:1px solid #e0c060;padding:8px 12px">'
              f'Page archivée par GENEALIS AI le {datetime.now():%d/%m/%Y %H:%M} depuis '
              f'<a href="{url}">{url}</a></div>')
    base = f'<base href="{url}">'
    if re.search(r"<head[^>]*>", html, flags=re.I):
        html = re.sub(r"(<head[^>]*>)", r"\1" + base, html, count=1, flags=re.I)
    else:
        html = base + html
    if re.search(r"<body[^>]*>", html, flags=re.I):
        html = re.sub(r"(<body[^>]*>)", r"\1" + banner, html, count=1, flags=re.I)
    else:
        html = banner + html
    return html


def html_text(html: str) -> str:
    t = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    import html as _h

    return re.sub(r"\s+", " ", _h.unescape(t)).strip()


def _title_of(html: str) -> Optional[str]:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.S | re.I)
    import html as _h

    return _h.unescape(re.sub(r"\s+", " ", m.group(1))).strip()[:300] if m else None


def related_urls(url: str) -> list[tuple[str, str]]:
    """Fichiers complémentaires à archiver pour certains sites (image de la page d'un document)."""
    out = []
    m = re.search(r"gallica\.bnf\.fr/(ark:/12148/[a-z0-9]+)", url)
    if m:
        out.append((f"https://gallica.bnf.fr/iiif/{m.group(1)}/f1/full/1500,/0/native.jpg", "Gallica – page 1 (image)"))
    m = re.search(r"archive\.org/details/([^/?#]+)", url)
    if m:
        out.append((f"https://archive.org/services/img/{m.group(1)}", "Internet Archive – couverture"))
    return out


def archive_url(db: Session, url: str, *, person_id: str | None = None, source_id: str | None = None,
                title: str | None = None, check_robots: bool = True, with_related: bool = True,
                transport: Optional[httpx.BaseTransport] = None) -> list[Media]:
    """Télécharge et archive l'URL (et ses fichiers associés connus). Retourne les médias créés ou existants."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Adresse invalide : elle doit commencer par http:// ou https://")
    if any(d in parsed.netloc for d in NO_AUTO):
        raise ArchiveRefused(f"{parsed.netloc} n'autorise pas l'archivage automatique. Téléchargez ou capturez le document "
                             "puis importez-le dans « Archives et documents ».")
    out: list[Media] = []
    with _client(transport) as client:
        if check_robots and not robots_allows(url, client):
            raise ArchiveRefused(f"{parsed.netloc} interdit l'archivage automatique (robots.txt). Téléchargez ou capturez "
                                 "le document puis importez-le.")
        targets = [(url, title)] + (related_urls(url) if with_related else [])
        for target, ttl in targets:
            try:
                out.append(_fetch_one(db, client, target, ttl, person_id, source_id, origin=url))
            except (ValueError, httpx.HTTPError) as exc:
                if target == url:
                    raise ValueError(f"Archivage impossible : {exc}") from exc
    for m in out:
        log(db, f"Document archivé dans l'application : « {m.title} » ({(m.analysis or {}).get('content_type', '?')})",
            category="connector", person_id=person_id, outcome={"url": url, "media_id": m.id})
    return out


def _fetch_one(db: Session, client: httpx.Client, url: str, title: str | None, person_id: str | None,
               source_id: str | None, origin: str) -> Media:
    with client.stream("GET", url) as resp:
        if resp.status_code in (401, 403, 429):
            raise ArchiveRefused(f"Accès refusé par le site (HTTP {resp.status_code}). Téléchargez le document manuellement.")
        resp.raise_for_status()
        ctype = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        if ctype not in EXT_BY_MIME:
            guessed = mimetypes.guess_type(urlparse(url).path)[0]
            if guessed in EXT_BY_MIME:
                ctype = guessed
            else:
                raise ValueError(f"type de contenu non archivable ({ctype or 'inconnu'})")
        chunks, size = [], 0
        for chunk in resp.iter_bytes(1 << 16):
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError(f"fichier trop volumineux (> {MAX_BYTES // 1_000_000} Mo)")
            chunks.append(chunk)
        data = b"".join(chunks)
        final_url = str(resp.url)
    ext = EXT_BY_MIME[ctype]
    text_content = None
    kind = "photo" if ctype.startswith("image/") else "document"
    if ext == ".html":
        raw = data.decode(resp.encoding or "utf-8", errors="replace")
        title = title or _title_of(raw)
        text_content = html_text(raw)[:30000]
        data = sanitize_html(raw, final_url).encode("utf-8")
        kind = "webpage"
    elif ext == ".txt":
        text_content = data.decode("utf-8", errors="replace")[:30000]
    name_hint = Path(urlparse(final_url).path).name or urlparse(final_url).netloc
    filename = (name_hint if name_hint.lower().endswith(ext) else f"{name_hint or 'page'}{ext}")[:180]
    settings.ensure_dirs()
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext, dir=settings.cache_dir) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)
    try:
        m = import_file(db, tmp_path, original_filename=filename, kind=kind, person_id=person_id,
                        title=(title or filename)[:500], source_id=source_id)
    finally:
        tmp_path.unlink(missing_ok=True)
    m.analysis = {**(m.analysis or {}), "archived_from": final_url, "archived_origin": origin,
                  "archived_at": datetime.utcnow().isoformat(), "content_type": ctype, "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}
    if text_content and not m.ocr_text:
        m.ocr_text = text_content
    if ext in (".html", ".txt"):
        m.analysis_status = "done" if text_content else m.analysis_status
    db.flush()
    return m
