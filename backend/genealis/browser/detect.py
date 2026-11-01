"""Détection des blocages : CAPTCHA, page de connexion, abonnement, refus d'accès, défi anti-robot.

Aucun de ces blocages n'est jamais contourné : la tâche passe en BLOQUÉE avec `needs_human=True`, et l'utilisateur
peut agir lui-même dans une fenêtre visible (le worker ne remplit jamais d'identifiants et ne résout aucun CAPTCHA).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

ISSUE_LABELS_FR = {
    "captcha": "Vérification anti-robot (CAPTCHA) : une action humaine est nécessaire.",
    "login_required": "Le site demande une connexion à un compte : connectez-vous vous-même si vous le souhaitez.",
    "paywall": "Contenu réservé aux abonnés ou payant : aucune dépense n'est faite sans vous.",
    "blocked_policy": "Le site refuse l'accès automatique (refus d'accès ou trop de requêtes).",
}

_CAPTCHA_MARKERS = [
    r"g-recaptcha", r"www\.google\.com/recaptcha", r"recaptcha/api", r"grecaptcha", r"h-captcha", r"hcaptcha\.com",
    r"challenges\.cloudflare\.com/turnstile", r"cf-turnstile", r"data-sitekey", r"friendlycaptcha", r"captcha-delivery\.com",
    r"geo\.captcha-delivery", r"arkoselabs", r"funcaptcha", r"\bcaptcha\b",
]
_CAPTCHA_TEXT = [
    r"je ne suis pas un robot", r"i'?m not a robot", r"i am not a robot", r"non sono un robot", r"nie jestem robotem",
    r"ich bin kein roboter", r"vérifiez que vous (êtes|etes) (un )?humain", r"verify (that )?you are (a )?human",
    r"prove you('re| are) human", r"confirmez que vous n'êtes pas un robot", r"complete the security check",
    r"press (&|and) hold", r"appuyez (et|puis) maintenez",
]
_CLOUDFLARE = [
    r"cf-browser-verification", r"cf_chl_opt", r"/cdn-cgi/challenge-platform", r"checking your browser before accessing",
    r"just a moment\.\.\.", r"vérification de (votre )?navigateur", r"attention required! \| cloudflare",
    r"ddos protection by", r"enable javascript and cookies to continue",
]
_LOGIN_TEXT = [
    r"connectez-vous pour", r"veuillez vous (connecter|identifier)", r"identifiez-vous pour", r"connexion requise",
    r"vous devez (être|etre) connecté", r"login required", r"please (log|sign) in", r"sign in to (continue|view|access)",
    r"log in to (continue|view|access)", r"accedi per", r"effettua il login", r"bitte melden sie sich an", r"anmeldung erforderlich",
    r"zaloguj się", r"session expirée",
]
_LOGIN_WEAK = [r"mot de passe oublié", r"forgot (your )?password", r"se connecter", r"sign in", r"log in"]
_PAYWALL_TEXT = [
    r"réservé aux abonnés", r"reserve aux abonnes", r"abonnez-vous pour", r"devenez (membre )?premium", r"accès premium",
    r"offre premium", r"souscrire un abonnement", r"subscribe to (view|access|continue|unlock)", r"subscription required",
    r"members only", r"premium members", r"upgrade (your|to) (account|premium)", r"unlock (this|full) (record|document)",
    r"pass premium", r"acheter des crédits", r"buy credits", r"abbonati per", r"nur für abonnenten",
]


@dataclass
class Detection:
    issue: Optional[str] = None  # captcha | login_required | paywall | blocked_policy | None
    needs_human: bool = False
    reason: str = ""
    evidence: list[str] = field(default_factory=list)

    @property
    def blocked(self) -> bool:
        return self.issue is not None

    def as_dict(self) -> dict:
        return {"issue": self.issue, "needs_human": self.needs_human, "reason": self.reason, "evidence": self.evidence[:5]}


def _found(patterns: list[str], text: str) -> list[str]:
    out = []
    for p in patterns:
        m = re.search(p, text, re.I)
        if m:
            out.append(m.group(0)[:80])
    return out


def _blocked(issue: str, evidence: list[str], extra: str = "") -> Detection:
    return Detection(issue=issue, needs_human=True, reason=(ISSUE_LABELS_FR[issue] + (" " + extra if extra else "")).strip(),
                     evidence=evidence)


def detect_blockers(*, html: str = "", text: str = "", status: int | None = None, title: str = "", url: str = "",
                    password_fields: int | None = None, form_fields: int | None = None) -> Detection:
    """Analyse une page (HTML, texte visible, code HTTP). `password_fields` / `form_fields` : comptés dans le DOM si disponibles."""
    html_l = (html or "")[:400_000].lower()
    text_l = (text or "")[:200_000].lower()
    title_l = (title or "").lower()
    both = title_l + "\n" + text_l
    cf = _found(_CLOUDFLARE, html_l + "\n" + both)
    if cf and (status in (403, 429, 503) or "just a moment" in title_l or "cloudflare" in title_l or "challenge-platform" in html_l):
        return _blocked("captcha", cf, "(défi anti-robot du site)")
    cap = _found(_CAPTCHA_MARKERS, html_l) + _found(_CAPTCHA_TEXT, both)
    # « captcha » seul dans un texte d'aide ne suffit pas : il faut un widget ou une phrase explicite
    strong = [c for c in cap if c.lower() != "captcha"]
    if strong:
        return _blocked("captcha", strong)
    if status == 401:
        return _blocked("login_required", [f"HTTP {status}"])
    if status in (402,):
        return _blocked("paywall", [f"HTTP {status}"])
    if status in (403, 429):
        extra = "Trop de requêtes : nouvel essai plus tard." if status == 429 else ""
        return _blocked("blocked_policy", [f"HTTP {status}"], extra)
    pw = password_fields if password_fields is not None else len(re.findall(r"<input[^>]+type\s*=\s*[\"']?password", html_l))
    login_txt = _found(_LOGIN_TEXT, both)
    url_l = (url or "").lower()
    login_url = bool(re.search(r"/(login|signin|sign-in|connexion|identification|auth|account/login)\b", url_l))
    small_page = len(text_l) < 1500 and (form_fields is None or form_fields <= 4)
    if pw and (login_txt or login_url or (small_page and _found(_LOGIN_WEAK, both))):
        return _blocked("login_required", (login_txt or [url_l[:80] if login_url else "champ mot de passe"]))
    if login_txt and login_url:
        return _blocked("login_required", login_txt)
    pay = _found(_PAYWALL_TEXT, both)
    if pay:
        return _blocked("paywall", pay)
    return Detection()
