"""Export d'un site internet statique de l'arbre (personnes vivantes masquées)."""
from __future__ import annotations

import html
import io
import zipfile
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Person
from ..services.persons import children_of, citations_for, gendate_of, parents_of, person_summary, siblings_of, spouses_of

CSS = """body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#eef3fb;color:#1d2a44}
header{background:linear-gradient(135deg,#3b6fd8,#5aa0e8);color:#fff;padding:28px 20px}header h1{margin:0;font-size:28px}
main{max-width:900px;margin:0 auto;padding:20px}a{color:#2c5fc4;text-decoration:none}.card{background:#fff;border-radius:18px;
padding:18px;margin:12px 0;box-shadow:0 6px 20px -10px rgba(30,60,120,.35)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.muted{color:#6b7790;font-size:13px}.ev{padding:6px 0;border-bottom:1px solid #eef}.tag{display:inline-block;font-size:11px;border-radius:999px;padding:2px 8px;background:#e6eefc}"""


def _hidden(p: Person) -> bool:
    if p.is_living:
        return True
    by = next((e.sort_year for e in p.events if e.event_type in ("birth", "baptism") and e.sort_year), None)
    dead = any(e.event_type in ("death", "burial") for e in p.events) or p.is_living is False
    return bool(by and date.today().year - by < 100 and not dead)


def _page(title: str, body: str) -> str:
    return (f"<!doctype html><html lang=fr><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>{html.escape(title)}</title><style>{CSS}</style><header><h1>{html.escape(title)}</h1>"
            f"<div class=muted style='color:#e8f0ff'>Arbre publié avec GENEALIS AI · <a style='color:#fff' href='../index.html'>Accueil</a></div>"
            f"</header><main>{body}</main></html>")


def build_site(db: Session, root_id: str | None = None) -> bytes:
    persons = db.execute(select(Person)).scalars().all()
    visible = {p.id for p in persons if not _hidden(p)}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        cards = []
        for p in sorted(persons, key=lambda x: ((x.surname or "").upper(), x.given_names or "")):
            if p.id not in visible:
                continue
            s = person_summary(db, p)
            cards.append(f"<a class=card href='p/{p.id}.html'><b>{html.escape(s.display_name)}</b><div class=muted>"
                         f"{html.escape(s.birth_display or '?')} – {html.escape(s.death_display or '?')}"
                         f"{' · ' + html.escape(s.birth_place) if s.birth_place else ''}</div></a>")
        z.writestr("index.html", _page("Notre histoire familiale", f"<p class=muted>{len(cards)} personnes publiées. "
                                                                   "Les personnes vivantes ne sont pas publiées.</p><div class=grid>"
                                                                   + "".join(cards) + "</div>").replace("../index.html", "index.html"))

        def link(q: Person) -> str:
            if q.id in visible:
                return f"<a href='{q.id}.html'>{html.escape(q.display_name())}</a>"
            return "<span class=muted>Personne vivante</span>"

        for p in persons:
            if p.id not in visible:
                continue
            s = person_summary(db, p)
            evs = "".join(f"<div class=ev><b>{html.escape(gendate_of(e).display())}</b> — {html.escape(e.event_type)}"
                          f"{' à ' + html.escape(e.place.display() if e.place else e.place_original) if (e.place or e.place_original) else ''}</div>"
                          for e in sorted(p.events, key=lambda e: e.sort_year or 0))
            fam = (f"<p><b>Parents :</b> {', '.join(link(q) for q, _ in parents_of(db, p.id)) or '—'}</p>"
                   f"<p><b>Conjoint(s) :</b> {', '.join(link(q) for q in spouses_of(db, p.id)) or '—'}</p>"
                   f"<p><b>Enfants :</b> {', '.join(link(q) for q, _ in children_of(db, p.id)) or '—'}</p>"
                   f"<p><b>Frères et sœurs :</b> {', '.join(link(q) for q in siblings_of(db, p.id)) or '—'}</p>")
            srcs = "".join(f"<li>{html.escape(c.source_title or '')}</li>" for c in citations_for(db, "person", p.id))
            age = f" · {html.escape(s.age_display)} {html.escape(s.age_context or '')}" if s.age_display else ""
            body = (f"<div class=card><div class=muted>{html.escape(s.occupation or '')}{age}</div>{evs or '<p class=muted>Aucun événement.</p>'}</div>"
                    f"<div class=card>{fam}</div><div class=card><b>Sources</b><ul>{srcs or '<li class=muted>Aucune source citée</li>'}</ul></div>")
            z.writestr(f"p/{p.id}.html", _page(s.display_name, body))
    return buf.getvalue()
