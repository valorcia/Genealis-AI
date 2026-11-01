"""Navigation déterministe avec Playwright (stratégie 2 : aucun appel IA).

Chromium isolé : contexte neuf par tâche (aucun profil persistant, aucun cookie conservé), téléchargements vers un
dossier temporaire puis vérifiés, service workers bloqués, permissions refusées (géolocalisation, micro, caméra,
notifications), boîtes de dialogue refusées. TOUTES les connexions passent par la garde réseau (`guard.EgressGuard`) qui
applique `check_url` à chaque requête, redirections et sous-ressources comprises ; le routage Playwright refuse en plus
les schémas non http(s) et les sites dont les conditions interdisent l'automatisation.

Opérations génériques (aucun connecteur propre à un site) : ouvrir une adresse, capture, texte visible + liens, formulaire
de recherche (nom, prénom, commune, année repérés par libellé / texte indicatif / nom du champ), liste de résultats,
visionneuses IIIF (manifeste JSON → image d'une vue), liens directs vers des images / PDF, téléchargement contrôlé.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote, urljoin, urlsplit

from .detect import Detection, detect_blockers
from .guard import EgressGuard
from .security import (MAX_DOWNLOAD_BYTES, DomainThrottle, RobotsCache, SecurityPolicy, check_download, check_url,
                       detect_injection, domain_of, sanitize_page_text, site_policy)

logger = logging.getLogger("genealis.browser.playwright")

CHROMIUM_ENV = "GENEALIS_CHROMIUM_PATH"
DOC_EXT = (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".jp2", ".pdf")
SCRIPT_EXT = (".php", ".asp", ".aspx", ".jsp", ".cgi", ".do", ".action", ".pl", ".py")


def chromium_executable() -> Optional[str]:
    """Chemin de Chromium : variable `GENEALIS_CHROMIUM_PATH`, sinon celui installé par `playwright install chromium`."""
    p = (os.environ.get(CHROMIUM_ENV) or "").strip().strip('"')
    if p and Path(p).exists():
        return p
    return None


async def resolve_chromium_path() -> Optional[str]:
    """Chromium à utiliser aussi pour Browser Use : `GENEALIS_CHROMIUM_PATH`, sinon celui de `playwright install chromium`
    (plutôt que le Chrome personnel de l'utilisateur)."""
    p = chromium_executable()
    if p:
        return p
    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as pw:
            path = pw.chromium.executable_path
        return path if path and Path(path).exists() else None
    except Exception:  # pragma: no cover
        return None


def playwright_available() -> bool:
    import importlib.util

    return importlib.util.find_spec("playwright") is not None


@dataclass
class DriverConfig:
    downloads_dir: Path
    policy: SecurityPolicy = field(default_factory=SecurityPolicy.from_settings)
    headless: bool = True
    chromium_path: Optional[str] = None
    page_timeout_s: float = 30.0
    min_interval_s: float = 2.0
    respect_robots: bool = True
    max_text_chars: int = 20000
    screenshots: bool = True
    user_agent: Optional[str] = None  # None : agent utilisateur standard de Chromium (aucun déguisement)

    @classmethod
    def from_settings(cls, settings: dict, downloads_dir: Path, policy: SecurityPolicy | None = None, **kw) -> "DriverConfig":
        return cls(downloads_dir=downloads_dir, policy=policy or SecurityPolicy.from_settings(settings),
                   headless=bool(settings.get("browser_headless", True)), chromium_path=chromium_executable(),
                   page_timeout_s=float(settings.get("browser_page_timeout_s") or 30),
                   min_interval_s=float(settings.get("connector_min_interval") or 2.0), **kw)


@dataclass
class PageSnapshot:
    url: str
    final_url: str = ""
    status: Optional[int] = None
    title: str = ""
    text: str = ""
    hidden_text: str = ""
    html: str = ""
    links: list[dict] = field(default_factory=list)
    images: list[dict] = field(default_factory=list)
    forms: list[dict] = field(default_factory=list)
    manifests: list[str] = field(default_factory=list)
    password_fields: int = 0
    field_count: int = 0
    screenshot: Optional[bytes] = None
    detection: Detection = field(default_factory=Detection)
    security_flags: list[dict] = field(default_factory=list)
    outcome: str = "ok"  # ok | blocked_policy | robots_disallowed | captcha | login_required | paywall | not_found | error | timeout
    policy: str = "allowed"
    duration_ms: int = 0
    error: str = ""

    @property
    def domain(self) -> str:
        return domain_of(self.final_url or self.url)

    @property
    def content_hash(self) -> Optional[str]:
        return hashlib.sha256(self.text.encode("utf-8")).hexdigest() if self.text else None

    def excerpt(self, n: int = 1500) -> str:
        return sanitize_page_text(self.text, max_chars=n)


@dataclass
class DownloadedFile:
    path: Path
    filename: str
    mime: str
    size: int
    sha256: str
    source_url: str
    page_url: str = ""
    archival_reference: Optional[str] = None
    title: Optional[str] = None


class DownloadRefused(Exception):
    def __init__(self, flag: dict):
        super().__init__(flag.get("reason", "téléchargement refusé"))
        self.flag = flag


# ---------------------------------------------------------------- scripts exécutés dans la page (lecture seule)
_SNAPSHOT_JS = r"""
() => {
  const abs = (u) => { try { return new URL(u, document.baseURI).href } catch (e) { return null } };
  const body = document.body;
  const text = body ? body.innerText : '';
  const hidden = [];
  let hiddenLen = 0;
  const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','svg','SVG','HEAD','META','LINK']);
  if (body) {
    for (const el of body.querySelectorAll('*')) {
      if (hiddenLen > 6000) break;
      if (skip.has(el.tagName)) continue;
      const t = (el.textContent || '').trim();
      if (t.length < 12) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const isHidden = cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0 ||
        parseFloat(cs.fontSize) < 2 || r.right < -500 || r.bottom < -500 || r.left > 20000 ||
        (cs.clip && cs.clip.startsWith('rect(0') ) || cs.color === cs.backgroundColor || el.getAttribute('aria-hidden') === 'true';
      if (isHidden) {
        const parentHidden = el.parentElement && el.parentElement.dataset && el.parentElement.dataset.genealisHidden === '1';
        el.dataset.genealisHidden = '1';
        if (!parentHidden) { hidden.push(t.slice(0, 1500)); hiddenLen += t.length; }
      }
    }
  }
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    if (links.length >= 400) break;
    const href = abs(a.getAttribute('href'));
    if (!href || !/^https?:/i.test(href)) continue;
    const row = a.closest('tr,li,article,section,div');
    links.push({href, text: (a.innerText || a.getAttribute('title') || a.getAttribute('aria-label') || '').trim().slice(0, 200),
                context: row ? (row.innerText || '').trim().slice(0, 300) : ''});
  }
  const images = [];
  for (const img of document.querySelectorAll('img[src]')) {
    if (images.length >= 50) break;
    const src = abs(img.currentSrc || img.getAttribute('src'));
    if (!src || !/^https?:/i.test(src)) continue;
    images.push({src, w: img.naturalWidth || 0, h: img.naturalHeight || 0, alt: (img.alt || '').slice(0, 200)});
  }
  const manifests = new Set();
  const consider = (v) => { if (v && /manifest|iiif/i.test(v)) { const u = abs(v.trim()); if (u && /^https?:/i.test(u)) manifests.add(u) } };
  for (const el of document.querySelectorAll('[href],[src],[data-manifest],[data-iiif],[data-src],[content],[data-url]')) {
    for (const attr of ['href','src','data-manifest','data-iiif','data-src','content','data-url']) {
      const v = el.getAttribute(attr); if (v && v.length < 2000) consider(v);
    }
  }
  const html = document.documentElement ? document.documentElement.outerHTML : '';
  const re = /https?:\/\/[^"'\s<>\\]+?(?:manifest(?:\.json)?|\/info\.json)(?=["'\s<>\\?#]|$)/gi;
  let m; let n = 0;
  while ((m = re.exec(html)) && n < 50) { manifests.add(m[0]); n++; }
  const forms = [];
  let fieldId = 0;
  const labelOf = (el) => {
    const parts = [];
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) parts.push(l.innerText) }
    const pl = el.closest('label'); if (pl) parts.push(pl.innerText);
    for (const a of ['aria-label','placeholder','name','id','title']) { const v = el.getAttribute(a); if (v) parts.push(v) }
    const prev = el.previousElementSibling; if (prev && /^(LABEL|SPAN|B|STRONG|TD|TH|DIV)$/.test(prev.tagName)) parts.push(prev.innerText || '');
    const cell = el.closest('td'); if (cell && cell.previousElementSibling) parts.push(cell.previousElementSibling.innerText || '');
    return parts.join(' | ').replace(/\s+/g, ' ').slice(0, 300);
  };
  const groups = new Map();
  let pw = 0, fields = 0;
  for (const el of document.querySelectorAll('input,select,textarea')) {
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    if (type === 'password') { pw++; }
    if (['hidden','submit','button','image','reset','file','checkbox','radio','password'].includes(type)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    fields++;
    const form = el.form || el.closest('form') || document.body;
    if (!groups.has(form)) groups.set(form, []);
    const id = 'f' + (fieldId++);
    el.setAttribute('data-genealis-field', id);
    groups.get(form).push({id, type, label: labelOf(el), tag: el.tagName.toLowerCase()});
  }
  let fi = 0;
  for (const [form, list] of groups) {
    const fid = 'form' + (fi++);
    if (form !== document.body) form.setAttribute('data-genealis-form', fid);
    const action = form.getAttribute && form.getAttribute('action');
    forms.push({id: fid, fields: list, action: action ? abs(action) : null,
                method: (form.getAttribute && form.getAttribute('method') || 'get').toLowerCase(), isBody: form === document.body});
  }
  return {title: document.title || '', text, hidden: hidden.join('\n'), links, images, manifests: Array.from(manifests),
          forms, password_fields: pw, field_count: fields, html: html.slice(0, 400000)};
}
"""

# Rôles des champs d'un formulaire de recherche (mots entiers, plusieurs langues). L'ordre compte : prénom avant nom.
_FIELD_ROLES: list[tuple[str, tuple[str, ...]]] = [
    ("given_names", ("prenom", "prenoms", "firstname", "first", "given", "givenname", "forename", "vorname", "imie", "imiona",
                     "nome", "voornaam", "keresztnev")),
    ("surname", ("nom", "patronyme", "surname", "lastname", "last", "family", "familyname", "cognome", "nazwisko", "nachname",
                 "familienname", "achternaam", "name")),
    ("year_from", ("debut", "from", "start", "von", "dal", "min", "anneedebut", "yearfrom", "datedebut")),
    ("year_to", ("fin", "to", "end", "bis", "max", "anneefin", "yearto", "datefin")),
    ("year", ("annee", "year", "anno", "rok", "jahr", "date", "periode", "period", "jaar")),
    ("place", ("commune", "lieu", "ville", "localite", "place", "comune", "localita", "miejscowosc", "parafia", "ort", "gemeinde",
               "paroisse", "parish", "town", "city", "village", "municipality", "plaats", "location")),
]
_YEARISH = ("annee", "year", "anno", "rok", "jahr", "date", "periode", "period", "jaar")


def _norm(s: str) -> str:
    from unidecode import unidecode

    return unidecode(s or "").lower()


def classify_field(label: str, ftype: str = "text") -> Optional[str]:
    """Rôle probable d'un champ d'après son libellé / texte indicatif / nom (aucune règle propre à un site)."""
    words = re.findall(r"[a-z]+", _norm(re.sub(r"([a-z])([A-Z])", r"\1 \2", label or "")))
    joined = "".join(words)
    if not words:
        return None
    has_year = any(w in _YEARISH for w in words) or ftype in ("number", "date")
    for role, keys in _FIELD_ROLES:
        if role in ("year_from", "year_to"):
            if has_year and any(w in keys for w in words):
                return role
            if any(k in joined for k in keys if len(k) > 6):
                return role
            continue
        if role == "year":
            if has_year:
                return role
            continue
        if any(w in keys for w in words):
            # « nom de la commune » : un champ qui cite un lieu est un lieu
            if role == "surname" and any(w in dict(_FIELD_ROLES)["place"] for w in words):
                return "place"
            return role
    return None


def best_search_form(forms: list[dict]) -> Optional[tuple[dict, dict[str, str]]]:
    """Formulaire contenant un champ « nom » (+ autres rôles) ; renvoie (formulaire, {rôle: id du champ})."""
    best, best_map, best_score = None, {}, 0
    for f in forms:
        roles: dict[str, str] = {}
        for fld in f.get("fields", []):
            role = classify_field(fld.get("label", ""), fld.get("type", "text"))
            if role and role not in roles:
                roles[role] = fld["id"]
        if "surname" not in roles:
            continue
        score = len(roles) * 10 + (0 if f.get("isBody") else 1)
        if score > best_score:
            best, best_map, best_score = f, roles, score
    return (best, best_map) if best else None


def is_document_url(url: str) -> bool:
    path = urlsplit(url).path.lower()
    return path.endswith(DOC_EXT) or "/iiif/" in path and path.endswith(("/default.jpg", "/native.jpg", "/default.png"))


def iiif_image_urls(manifest: Any, base_url: str = "", limit: int = 1) -> list[dict]:
    """Images d'un manifeste IIIF Presentation 2 ou 3 (ou d'un info.json Image API) : [{url, label, canvas}]."""
    out: list[dict] = []

    def from_service(svc: Any, v3: bool) -> Optional[str]:
        if isinstance(svc, list):
            svc = svc[0] if svc else None
        if not isinstance(svc, dict):
            return None
        sid = svc.get("@id") or svc.get("id")
        if not sid:
            return None
        ctx = str(svc.get("@context") or svc.get("type") or "")
        size = "max" if (v3 or "image/3" in ctx or "ImageService3" in ctx) else "full"
        return sid.rstrip("/") + f"/full/{size}/0/default.jpg"

    def label_of(obj: dict) -> str:
        lab = obj.get("label")
        if isinstance(lab, dict):  # v3 : {"fr": ["vue 1"]}
            vals = next(iter(lab.values()), [])
            return str(vals[0] if isinstance(vals, list) and vals else vals)
        return str(lab or "")

    if not isinstance(manifest, dict):
        return out
    if "protocol" in manifest or str(manifest.get("@context", "")).endswith("image/2/context.json") \
            or manifest.get("type") == "ImageService3":
        u = from_service(manifest, manifest.get("type") == "ImageService3")
        return [{"url": u, "label": "", "canvas": None}] if u else []
    # Presentation 2
    for seq in manifest.get("sequences") or []:
        for canvas in seq.get("canvases") or []:
            for img in canvas.get("images") or []:
                res = img.get("resource") or {}
                url = from_service(res.get("service"), False) or res.get("@id")
                if url:
                    out.append({"url": urljoin(base_url, url), "label": label_of(canvas), "canvas": canvas.get("@id")})
                    break
            if len(out) >= limit:
                return out
    # Presentation 3
    for canvas in manifest.get("items") or []:
        if not isinstance(canvas, dict):
            continue
        for page in canvas.get("items") or []:
            for anno in page.get("items") or []:
                body = anno.get("body") or {}
                if isinstance(body, list):
                    body = body[0] if body else {}
                url = from_service(body.get("service"), True) or body.get("id")
                if url:
                    out.append({"url": urljoin(base_url, url), "label": label_of(canvas), "canvas": canvas.get("id")})
                    break
            if len(out) > 0 and out[-1].get("canvas") == canvas.get("id"):
                break
        if len(out) >= limit:
            return out
    return out


def archival_reference_from(manifest: Any) -> Optional[str]:
    """Cote / référence d'archive indiquée dans les métadonnées d'un manifeste IIIF, si présente."""
    if not isinstance(manifest, dict):
        return None
    for md in manifest.get("metadata") or []:
        if not isinstance(md, dict):
            continue
        lab = md.get("label")
        lab_s = json.dumps(lab, ensure_ascii=False) if not isinstance(lab, str) else lab
        if re.search(r"cote|segnatura|sygnatura|signatur|reference|référence|shelfmark|call number", lab_s, re.I):
            val = md.get("value")
            if isinstance(val, dict):
                val = next(iter(val.values()), "")
            if isinstance(val, list):
                val = val[0] if val else ""
            return re.sub(r"<[^>]+>", "", str(val))[:300] or None
    return None


def _filename_from(url: str, content_disposition: str | None) -> str:
    if content_disposition:
        m = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", content_disposition, re.I)
        if m:
            return unquote(m.group(1)).strip()
    name = unquote(Path(urlsplit(url).path).name)
    if name.lower().endswith(SCRIPT_EXT) or not name:
        return ""  # « image.php?id=… » : le nom vient du contenu, pas du script du serveur
    return name


class PlaywrightDriver:
    """Navigateur Chromium isolé pour une tâche. À utiliser avec `async with`."""

    def __init__(self, config: DriverConfig, *, guard: EgressGuard | None = None, robots: RobotsCache | None = None,
                 throttle: DomainThrottle | None = None):
        self.config = config
        self.guard = guard
        self._own_guard = guard is None
        self.robots = robots
        self.throttle = throttle or DomainThrottle(config.min_interval_s)
        self.history: list[dict] = []  # historique des pages (url, issue, durée)
        self.security_flags: list[dict] = []
        self.downloads: list[DownloadedFile] = []
        self._pw = None
        self.browser = None
        self.context = None
        self.page = None
        self._browser_downloads: list[asyncio.Task] = []
        self._fetcher: Optional[SafeFetcher] = None

    # ---- cycle de vie
    async def __aenter__(self) -> "PlaywrightDriver":
        from playwright.async_api import async_playwright

        if self.guard is None:
            self.guard = EgressGuard(self.config.policy).start()
        if self.robots is None:
            import httpx

            guard_url = self.guard.url
            self.robots = RobotsCache(lambda: httpx.Client(timeout=10, follow_redirects=False, trust_env=False, proxy=guard_url))
        self.config.downloads_dir.mkdir(parents=True, exist_ok=True)
        self._pw = await async_playwright().start()
        sandbox = os.name == "nt" or os.environ.get("GENEALIS_CHROMIUM_SANDBOX") == "1"
        self.browser = await self._pw.chromium.launch(
            executable_path=self.config.chromium_path or chromium_executable(), headless=self.config.headless,
            chromium_sandbox=sandbox, downloads_path=str(self.config.downloads_dir),
            proxy={"server": self.guard.url, "bypass": "<-loopback>"},
            args=["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync",
                  "--disable-component-update", "--disable-default-apps", "--disable-extensions",
                  "--disable-features=InterestFeedContentSuggestions,Translate,OptimizationHints,MediaRouter",
                  "--deny-permission-prompts", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"])
        self.context = await self.browser.new_context(
            accept_downloads=True, service_workers="block", permissions=[], locale="fr-FR", ignore_https_errors=False,
            user_agent=self.config.user_agent, viewport={"width": 1366, "height": 900})
        self.context.set_default_timeout(self.config.page_timeout_s * 1000)
        await self.context.route("**/*", self._route)
        self.context.on("page", self._watch_page)
        self.page = await self.context.new_page()
        return self

    async def __aexit__(self, *exc) -> None:
        await self.close()

    async def close(self) -> None:
        for t in self._browser_downloads:
            try:
                await asyncio.wait_for(t, 10)
            except Exception:
                pass
        for obj in (self.context, self.browser):
            try:
                if obj:
                    await obj.close()
            except Exception:  # pragma: no cover
                pass
        try:
            if self._pw:
                await self._pw.stop()
        except Exception:  # pragma: no cover
            pass
        self.context = self.browser = self._pw = None
        if self._own_guard and self.guard:
            self.security_flags.extend(self.guard.take_refusals())
            self.guard.stop()

    def _watch_page(self, page) -> None:
        page.on("dialog", lambda d: asyncio.ensure_future(d.dismiss()))
        page.on("download", lambda d: self._browser_downloads.append(asyncio.ensure_future(self._on_download(d, page.url))))
        page.on("filechooser", lambda fc: None)  # aucun fichier local n'est jamais envoyé

    async def _route(self, route) -> None:
        """Refus immédiat des schémas non http(s), des domaines bloqués et des sites « humain uniquement »."""
        req = route.request
        url = req.url
        scheme = url.split(":", 1)[0].lower()
        if scheme in ("data", "blob"):
            if req.is_navigation_request():
                self.security_flags.append({"kind": "url_refused", "code": "scheme", "url": url[:120],
                                            "reason": "Navigation vers une adresse data:/blob: refusée."})
                await route.abort("blockedbyclient")
                return
            await route.continue_()
            return
        if scheme not in ("http", "https"):
            self.security_flags.append({"kind": "url_refused", "code": "scheme", "url": url[:300],
                                        "reason": f"Schéma refusé ({scheme}:)."})
            await route.abort("blockedbyclient")
            return
        host = domain_of(url)
        pol = site_policy(host, blocked_domains=self.config.policy.blocked_domains)
        if pol != "allowed" and req.is_navigation_request():
            self.security_flags.append({"kind": "site_policy", "code": pol, "url": url[:300],
                                        "reason": "Site sans automatisation autorisée : ouverture réservée à l'utilisateur."
                                        if pol == "human_only" else "Domaine bloqué dans vos paramètres."})
            await route.abort("blockedbyclient")
            return
        if pol == "blocked":
            await route.abort("blockedbyclient")
            return
        await route.continue_()

    # ---- pages
    async def open(self, url: str, *, check_robots: bool | None = None) -> PageSnapshot:
        """Ouvre une adresse après vérification (adresse, politique du site, robots.txt, délai par domaine)."""
        t0 = time.monotonic()
        snap = PageSnapshot(url=url)
        decision = await asyncio.to_thread(check_url, url, self.config.policy)
        if not decision.allowed:
            snap.outcome, snap.error = "blocked_policy", decision.reason
            snap.security_flags.append(decision.flag())
            return self._record(snap, t0)
        pol = site_policy(domain_of(url), blocked_domains=self.config.policy.blocked_domains)
        snap.policy = pol
        if pol != "allowed":
            snap.outcome = "blocked_policy"
            snap.error = ("Les conditions d'utilisation de ce site n'autorisent pas la navigation automatique : "
                          "il est ouvert pour vous, sans collecte automatique." if pol == "human_only"
                          else "Domaine bloqué dans vos paramètres.")
            snap.detection = Detection("blocked_policy", pol == "human_only", snap.error)
            return self._record(snap, t0)
        if (self.config.respect_robots if check_robots is None else check_robots) and self.robots:
            if not await asyncio.to_thread(self.robots.allowed, url):
                snap.outcome, snap.error = "robots_disallowed", "robots.txt du site interdit cette page aux robots."
                return self._record(snap, t0)
        await self.throttle.wait(domain_of(url))
        status = None
        try:
            resp = await self.page.goto(url, wait_until="domcontentloaded", timeout=self.config.page_timeout_s * 1000)
            status = resp.status if resp else None
            try:
                await self.page.wait_for_load_state("networkidle", timeout=min(8000, self.config.page_timeout_s * 1000))
            except Exception:
                pass
        except Exception as exc:  # erreurs de navigation : délai, refus de la garde, téléchargement direct…
            msg = str(exc)
            refused = self.guard.take_refusals() if self.guard else []
            snap.security_flags.extend(refused)
            if "Download is starting" in msg:
                await asyncio.sleep(0.5)
                snap.outcome, snap.final_url = "ok", url
                snap.error = "Document téléchargé directement."
                return self._record(snap, t0)
            if refused or any(e in msg for e in ("ERR_BLOCKED_BY_CLIENT", "ERR_TUNNEL_CONNECTION_FAILED", "ERR_UNSAFE_PORT")):
                snap.outcome = "blocked_policy"
                snap.error = refused[0]["reason"] if refused else "Adresse refusée par la politique de sécurité."
                return self._record(snap, t0)
            snap.outcome = "timeout" if "Timeout" in msg or exc.__class__.__name__ == "TimeoutError" else "error"
            snap.error = msg.splitlines()[0][:300]
            return self._record(snap, t0)
        await self._fill_snapshot(snap, status)
        return self._record(snap, t0)

    async def snapshot(self) -> PageSnapshot:
        """Instantané de la page actuelle (après une action : formulaire envoyé, reprise après assistance humaine)."""
        t0 = time.monotonic()
        snap = PageSnapshot(url=self.page.url)
        await self._fill_snapshot(snap, None)
        return self._record(snap, t0)

    async def _fill_snapshot(self, snap: PageSnapshot, status: Optional[int]) -> None:
        snap.final_url = self.page.url
        snap.status = status
        try:
            data = await self.page.evaluate(_SNAPSHOT_JS)
        except Exception as exc:
            snap.outcome, snap.error = "error", f"Lecture de la page impossible : {str(exc).splitlines()[0][:200]}"
            return
        snap.title = sanitize_page_text(data.get("title"), 500)
        snap.text = sanitize_page_text(data.get("text"), self.config.max_text_chars)
        snap.hidden_text = sanitize_page_text(data.get("hidden"), 6000)
        snap.html = data.get("html") or ""
        snap.links = data.get("links") or []
        snap.images = data.get("images") or []
        snap.forms = data.get("forms") or []
        snap.manifests = list(dict.fromkeys(data.get("manifests") or []))[:20]
        snap.password_fields = int(data.get("password_fields") or 0)
        snap.field_count = int(data.get("field_count") or 0)
        if self.config.screenshots:
            try:
                snap.screenshot = await self.page.screenshot(type="jpeg", quality=70, full_page=False)
            except Exception:  # pragma: no cover
                snap.screenshot = None
        snap.detection = detect_blockers(html=snap.html, text=snap.text, status=status, title=snap.title, url=snap.final_url,
                                         password_fields=snap.password_fields, form_fields=snap.field_count)
        snap.security_flags.extend(detect_injection(snap.text, hidden_text=snap.hidden_text))
        if self.guard:
            snap.security_flags.extend(self.guard.take_refusals())
        if snap.detection.blocked:
            snap.outcome = snap.detection.issue or "blocked_policy"
        elif status == 404 or status == 410:
            snap.outcome = "not_found"
        elif status and status >= 500:
            snap.outcome = "error"

    def _record(self, snap: PageSnapshot, t0: float) -> PageSnapshot:
        snap.duration_ms = int((time.monotonic() - t0) * 1000)
        self.history.append({"url": snap.url, "final_url": snap.final_url, "outcome": snap.outcome, "status": snap.status,
                             "duration_ms": snap.duration_ms})
        self.security_flags.extend(f for f in snap.security_flags if f not in self.security_flags)
        return snap

    # ---- formulaires de recherche
    async def fill_search_form(self, person: dict, snap: PageSnapshot) -> Optional[PageSnapshot]:
        """Remplit le formulaire de recherche générique repéré sur la page et l'envoie. None si aucun formulaire adapté."""
        found = best_search_form(snap.forms)
        if not found:
            return None
        form, roles = found
        year = person.get("birth_year") or person.get("year")
        values = {"surname": person.get("surname"), "given_names": (person.get("given_names") or "").split(" ")[0] or None,
                  "place": person.get("place"), "year": year,
                  "year_from": (int(year) - 2) if year else None, "year_to": (int(year) + 2) if year else None}
        filled = 0
        last_sel = None
        for role, fid in roles.items():
            val = values.get(role)
            if val in (None, ""):
                continue
            sel = f'[data-genealis-field="{fid}"]'
            try:
                el = self.page.locator(sel).first
                tag = await el.evaluate("e => e.tagName.toLowerCase()")
                if tag == "select":
                    await self._select_option(el, str(val))
                else:
                    await el.fill(str(val), timeout=5000)
                filled += 1
                last_sel = sel
            except Exception as exc:
                logger.debug("Champ %s non rempli : %s", role, exc)
        if not filled or not last_sel:
            return None
        t0 = time.monotonic()
        form_sel = f'[data-genealis-form="{form["id"]}"]' if not form.get("isBody") else None
        submit = None
        if form_sel:
            cand = self.page.locator(f'{form_sel} button[type=submit], {form_sel} input[type=submit], '
                                     f'{form_sel} button:not([type])')
            if await cand.count():
                submit = cand.first
        try:
            async with self.page.expect_navigation(wait_until="domcontentloaded", timeout=self.config.page_timeout_s * 1000):
                if submit is not None:
                    await submit.click(timeout=5000)
                else:
                    await self.page.locator(last_sel).press("Enter")
        except Exception as exc:
            logger.debug("Envoi du formulaire : %s", exc)
        try:
            await self.page.wait_for_load_state("networkidle", timeout=5000)
        except Exception:
            pass
        snap2 = PageSnapshot(url=self.page.url)
        await self._fill_snapshot(snap2, None)
        snap2.error = snap2.error or ""
        return self._record(snap2, t0)

    async def _select_option(self, el, value: str) -> None:
        opts = await el.evaluate("e => Array.from(e.options).map(o => [o.value, o.text])")
        target = _norm(value)
        for v, label in opts:
            if _norm(label).strip() == target or _norm(v).strip() == target:
                await el.select_option(v)
                return
        for v, label in opts:
            if target and target in _norm(label):
                await el.select_option(v)
                return

    # ---- résultats et documents
    @staticmethod
    def result_links(snap: PageSnapshot, person: dict, allowed_domains: list[str] | None = None, limit: int = 5) -> list[dict]:
        """Liens d'une liste de résultats qui citent la personne recherchée (nom, + prénom / année si possible)."""
        surname = _norm(person.get("surname") or "")
        given = _norm((person.get("given_names") or "").split(" ")[0])
        year = str(person.get("birth_year") or "")
        out = []
        for link in snap.links:
            href = link.get("href") or ""
            txt = _norm(link.get("text") or "")
            ctx = _norm(link.get("context") or "")
            if not href.startswith(("http://", "https://")) or href.split("#")[0] == snap.final_url.split("#")[0]:
                continue
            if re.search(r"(login|connexion|signin|logout|panier|cart|javascript:)", href, re.I):
                continue
            if allowed_domains and not any(domain_of(href) == d or domain_of(href).endswith("." + d) for d in allowed_domains):
                continue
            hay = txt + " " + ctx
            if surname and surname not in hay:
                continue
            score = 10 + (5 if given and given in hay else 0) + (3 if year and year in hay else 0) + (2 if surname in txt else 0)
            out.append({"title": sanitize_page_text(link.get("text") or "", 200) or href, "url": href,
                        "snippet": sanitize_page_text(link.get("context") or "", 300), "score": score})
        out.sort(key=lambda x: -x["score"])
        seen, uniq = set(), []
        for r in out:
            if r["url"] not in seen:
                seen.add(r["url"])
                uniq.append(r)
        return uniq[:limit]

    @staticmethod
    def document_candidates(snap: PageSnapshot) -> list[dict]:
        """Liens directs vers des images / PDF et grandes images affichées dans la page."""
        out, seen = [], set()
        for link in snap.links:
            href = link.get("href") or ""
            if is_document_url(href) and href not in seen:
                seen.add(href)
                out.append({"url": href, "title": sanitize_page_text(link.get("text") or "", 200)})
        for img in snap.images:
            src = img.get("src") or ""
            if src not in seen and (img.get("w", 0) >= 800 or img.get("h", 0) >= 800):
                seen.add(src)
                out.append({"url": src, "title": sanitize_page_text(img.get("alt") or "", 200)})
        return out

    async def iiif_documents(self, snap: PageSnapshot, limit: int = 1) -> list[dict]:
        """Visionneuse IIIF : lit le(s) manifeste(s) de la page et renvoie les images des premières vues."""
        out: list[dict] = []
        for murl in snap.manifests[:4]:
            try:
                data = await self.fetch_json(murl, referer=snap.final_url)
            except Exception as exc:
                logger.debug("Manifeste IIIF illisible %s : %s", murl, exc)
                continue
            ref = archival_reference_from(data)
            for img in iiif_image_urls(data, murl, limit=limit):
                out.append({"url": img["url"], "title": img.get("label") or (data.get("label") if isinstance(data.get("label"), str)
                                                                              else None),
                            "manifest": murl, "canvas": img.get("canvas"), "archival_reference": ref})
            if len(out) >= limit:
                break
        return out[:limit]

    # ---- téléchargements contrôlés (passent par la garde réseau)
    @property
    def fetcher(self) -> "SafeFetcher":
        if self._fetcher is None:
            self._fetcher = SafeFetcher(self.config, guard=self.guard, throttle=self.throttle, sink=self.downloads,
                                        flags=self.security_flags)
        return self._fetcher

    async def fetch_json(self, url: str, referer: str = "") -> Any:
        return await self.fetcher.fetch_json(url, referer)

    async def download(self, url: str, *, referer: str = "", title: str | None = None,
                       archival_reference: str | None = None) -> DownloadedFile:
        return await self.fetcher.download(url, referer=referer, title=title, archival_reference=archival_reference)

    def _save(self, data: bytes, dec, source_url: str, page_url: str, title, archival_reference) -> DownloadedFile:
        return self.fetcher.save(data, dec, source_url, page_url, title, archival_reference)

    async def _on_download(self, download, page_url: str) -> None:
        """Téléchargement déclenché par la page : enregistré à part, vérifié, supprimé s'il est refusé."""
        try:
            tmp = self.config.downloads_dir / f"incoming-{int(time.time() * 1000)}.bin"
            await download.save_as(str(tmp))
            data = tmp.read_bytes()
            tmp.unlink(missing_ok=True)
            dec = check_download(download.suggested_filename, None, len(data), data[:64])
            if not dec.allowed:
                self.security_flags.append(dec.flag(download.suggested_filename, download.url))
                return
            self._save(data, dec, download.url, page_url, None, None)
        except Exception as exc:  # pragma: no cover
            logger.debug("Téléchargement ignoré : %s", exc)


class SafeFetcher:
    """Téléchargements hors du navigateur (manifestes IIIF, images, PDF) : garde réseau, redirections vérifiées une à une,
    politique par site, délai par domaine, taille plafonnée, signature contrôlée avant tout enregistrement."""

    def __init__(self, config: DriverConfig, *, guard: EgressGuard | None, throttle: DomainThrottle | None = None,
                 sink: list | None = None, flags: list | None = None):
        self.config = config
        self.guard = guard
        self.throttle = throttle or DomainThrottle(config.min_interval_s)
        self.downloads: list[DownloadedFile] = sink if sink is not None else []
        self.security_flags: list[dict] = flags if flags is not None else []

    def _http(self):
        import httpx

        return httpx.AsyncClient(proxy=self.guard.url if self.guard else None, trust_env=False, follow_redirects=False,
                                 timeout=self.config.page_timeout_s,
                                 headers={"User-Agent": self.config.user_agent or "Mozilla/5.0 (GenealisAI worker)"})

    async def _get_stream(self, client, url: str, referer: str, max_bytes: int) -> tuple[bytes, dict, str]:
        current = url
        for _ in range(6):
            decision = await asyncio.to_thread(check_url, current, self.config.policy)
            if not decision.allowed:
                raise DownloadRefused(decision.flag())
            if site_policy(domain_of(current), blocked_domains=self.config.policy.blocked_domains) != "allowed":
                raise DownloadRefused({"kind": "site_policy", "url": current[:300],
                                       "reason": "Site sans automatisation autorisée : téléchargement réservé à l'utilisateur."})
            await self.throttle.wait(domain_of(current))
            async with client.stream("GET", current, headers={"Referer": referer} if referer else None) as resp:
                if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                    current = urljoin(current, resp.headers["location"])
                    continue
                if resp.status_code == 403 and resp.headers.get("x-genealis-blocked"):
                    raise DownloadRefused({"kind": "url_refused", "code": resp.headers["x-genealis-blocked"], "url": current[:300],
                                           "reason": "Adresse refusée par la garde réseau."})
                if resp.status_code >= 400:
                    raise DownloadRefused({"kind": "download_refused", "url": current[:300],
                                           "reason": f"Le site a répondu HTTP {resp.status_code}."})
                declared = int(resp.headers.get("content-length") or 0)
                if declared > max_bytes:
                    raise DownloadRefused({"kind": "download_refused", "url": current[:300],
                                           "reason": f"Fichier trop volumineux ({declared / 1_048_576:.1f} Mo)."})
                chunks, size = [], 0
                async for chunk in resp.aiter_bytes(1 << 16):
                    size += len(chunk)
                    if size > max_bytes:
                        raise DownloadRefused({"kind": "download_refused", "url": current[:300],
                                               "reason": "Fichier trop volumineux (> 40 Mo)."})
                    chunks.append(chunk)
                return b"".join(chunks), dict(resp.headers), current
        raise DownloadRefused({"kind": "download_refused", "url": url[:300], "reason": "Trop de redirections."})

    async def fetch_json(self, url: str, referer: str = "") -> Any:
        async with self._http() as client:
            data, _, _ = await self._get_stream(client, url, referer, 5 * 1024 * 1024)
        return json.loads(data.decode("utf-8", errors="replace"))

    async def download(self, url: str, *, referer: str = "", title: str | None = None,
                       archival_reference: str | None = None) -> DownloadedFile:
        """Télécharge un document (PDF / image d'acte) : signature, taille et type vérifiés AVANT l'enregistrement."""
        async with self._http() as client:
            data, headers, final = await self._get_stream(client, url, referer, MAX_DOWNLOAD_BYTES)
        name = _filename_from(final, headers.get("content-disposition"))
        dec = check_download(name, headers.get("content-type"), len(data), data[:64])
        if not dec.allowed:
            flag = dec.flag(name, final)
            self.security_flags.append(flag)
            raise DownloadRefused(flag)
        return self.save(data, dec, final, referer, title, archival_reference)

    def save(self, data: bytes, dec, source_url: str, page_url: str, title, archival_reference) -> DownloadedFile:
        digest = hashlib.sha256(data).hexdigest()
        self.config.downloads_dir.mkdir(parents=True, exist_ok=True)
        path = self.config.downloads_dir / f"{digest[:16]}{dec.ext}"
        path.write_bytes(data)
        f = DownloadedFile(path=path, filename=dec.safe_filename or path.name, mime=dec.mime, size=len(data), sha256=digest,
                           source_url=source_url, page_url=page_url, archival_reference=archival_reference, title=title)
        if not any(d.sha256 == digest for d in self.downloads):
            self.downloads.append(f)
        return f
