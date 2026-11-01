"""Livre de famille : un chapitre par personne, rédigé à la première personne À PARTIR DES SEULS FAITS DE LA BASE.

Règle absolue : aucune phrase biographique n'invente un fait. Chaque paragraphe biographique est construit par
des règles à partir des événements, relations, participants d'actes et sources enregistrés, et porte la liste des
citations qui le justifient. Le contexte général (village, métier, époque, vie quotidienne) est séparé, étiqueté
et sourcé (Wikipédia / Wikidata, dictionnaire des métiers GENEALIS, liste d'événements historiques).
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from datetime import date, datetime, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..data.book_context import DAILY_LIFE, REGIONAL_TIMELINE, region_of
from ..data.historical_events_data import HISTORICAL_EVENTS
from ..data.trades import lookup_trade, split_occupations
from ..models import (Citation, Contradiction, Event, Family, Hypothesis, Media, ParentChild, Person, Place, Question,
                      ResearchTask, Setting, Source)
from . import wiki
from .persons import children_of, citations_for, compute_age, families_of, gendate_of, parents_of, siblings_of
from .sosa import generation_of, root_id, sosa_map

MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
CONF_RANK = {"green": 0, "orange": 1, "grey": 2, "red": 3}
LINEAL = ("biological", "uncertain", "legal", "adoptive")
MARRIAGE_TYPES = ("marriage", "civil_marriage", "religious_marriage")
BIRTH_TYPES = ("birth", "baptism", "child_baptism", "adult_baptism")
DEATH_TYPES = ("death", "burial", "cremation", "funeral")
OPEN_TASK = ("queued", "running", "waiting_user", "paused")

EVENT_LABEL = {
    "birth": "Naissance", "baptism": "Baptême", "child_baptism": "Baptême", "adult_baptism": "Baptême d'adulte",
    "marriage": "Mariage", "civil_marriage": "Mariage civil", "religious_marriage": "Mariage religieux",
    "marriage_banns": "Publication des bans", "marriage_contract": "Contrat de mariage", "marriage_license": "Dispense de mariage",
    "prenuptial_contract": "Contrat de mariage", "engagement": "Fiançailles", "pacs": "PACS", "separation": "Séparation",
    "divorce": "Divorce", "annulment": "Annulation de mariage", "death": "Décès", "burial": "Inhumation", "cremation": "Crémation",
    "funeral": "Obsèques", "residence": "Résidence", "census": "Recensement", "occupation": "Profession", "education": "Études",
    "graduation": "Diplôme", "training": "Formation", "apprenticeship": "Apprentissage", "military": "Service militaire",
    "military_enlistment": "Engagement militaire", "military_discharge": "Libération du service", "military_award": "Distinction militaire",
    "immigration": "Immigration", "emigration": "Émigration", "naturalization": "Naturalisation", "nationality": "Nationalité",
    "will": "Testament", "probate": "Succession", "retirement": "Retraite", "confirmation": "Confirmation",
    "first_communion": "Première communion", "land_transaction": "Transaction foncière", "illness": "Maladie",
    "documents": "Document", "signature": "Signature", "adoption": "Adoption", "other": "Événement",
}
ACT_TITLE = {
    "birth": "Acte de naissance", "baptism": "Acte de baptême", "child_baptism": "Acte de baptême", "marriage": "Acte de mariage",
    "civil_marriage": "Acte de mariage", "religious_marriage": "Acte de mariage religieux", "marriage_banns": "Publication des bans",
    "marriage_contract": "Contrat de mariage", "prenuptial_contract": "Contrat de mariage", "death": "Acte de décès",
    "burial": "Acte de sépulture", "census": "Recensement", "military": "Registre matricule", "divorce": "Acte de divorce",
}
ROLE_LABEL = {"declarant": "déclarant", "witness": "témoin", "godfather": "parrain", "godmother": "marraine",
              "officer": "officier", "father": "père", "mother": "mère", "spouse": "conjoint", "other": "présent"}
ORDINAL = {1: "1re"}


# =====================================================================================
# Petits outils de rédaction
# =====================================================================================

def g(p: Optional[Person], m: str, f: str, n: Optional[str] = None) -> str:
    """Accord selon le sexe : g(p, "né", "née") ; sexe inconnu -> forme neutre « né(e) »."""
    sex = p.sex if p is not None else None
    if sex == "M":
        return m
    if sex == "F":
        return f
    if n is not None:
        return n
    return f"{m}({f[len(m):]})" if f.startswith(m) else f"{m}/{f}"


def ordinal(n: int) -> str:
    return ORDINAL.get(n, f"{n}e")


def _iso_parts(iso: Optional[str]) -> tuple[Optional[int], Optional[int], Optional[int]]:
    if not iso:
        return None, None, None
    try:
        parts = [int(x) for x in iso.split("-")]
    except ValueError:
        return None, None, None
    return (parts + [None, None])[0], (parts + [None, None])[1] if len(parts) > 1 else None, parts[2] if len(parts) > 2 else None


def _long(iso: Optional[str]) -> Optional[str]:
    y, m, d = _iso_parts(iso)
    if y is None:
        return None
    if m and d:
        return f"{'1er' if d == 1 else d} {MONTHS[m - 1]} {y}"
    if m:
        return f"{MONTHS[m - 1]} {y}"
    return str(y)


def date_phrase(ev: Optional[Event]) -> Optional[str]:
    """« le 15 novembre 1856 », « en 1856 », « vers 1930 », « entre 1850 et 1856 »… ou None si inconnue."""
    if ev is None or not ev.date_start or ev.date_kind == "unknown":
        return None
    y, m, d = _iso_parts(ev.date_start)
    if y is None:
        return None
    k = ev.date_kind
    if k == "exact":
        out = f"le {_long(ev.date_start)}" if (m and d) else f"en {_long(ev.date_start)}"
    elif k in ("approx", "calculated"):
        out = f"vers {y}"
    elif k == "before":
        out = f"avant {'le ' if m and d else ''}{_long(ev.date_start)}"
    elif k == "after":
        out = f"après {'le ' if m and d else ''}{_long(ev.date_start)}"
    elif k == "between":
        out = f"entre {_long(ev.date_start)} et {_long(ev.date_end) or '?'}"
    else:
        out = f"en {y}"
    if ev.calendar == "republican" and ev.date_original:
        out += f" ({ev.date_original.strip()})"
    return out


def cap(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s


def place_short(ev: Optional[Event]) -> Optional[str]:
    if ev is None:
        return None
    if ev.place is not None and ev.place.name:
        return ev.place.name
    if ev.place_original:
        return ev.place_original.split(",")[0].strip() or None
    return None


def at(ev: Optional[Event]) -> str:
    p = place_short(ev)
    return f" à {p}" if p else ""


def years_of(p: Person) -> tuple[Optional[int], Optional[int]]:
    b = best_event(p.events, BIRTH_TYPES)
    d = best_event(p.events, DEATH_TYPES)
    return (b.sort_year if b else None), (d.sort_year if d else None)


def years_text(p: Person) -> str:
    b, d = years_of(p)
    if b is None and d is None:
        return ""
    return f"{b or '?'} – {d}" if d else (f"{b} – ?" if p.is_living is False else f"{b}")


def best_event(events: Iterable[Event], types: tuple[str, ...]) -> Optional[Event]:
    """Événement le plus fiable d'un type (dans l'ordre de `types`, puis confiance)."""
    evs = [e for e in events if e.event_type in types]
    if not evs:
        return None
    evs.sort(key=lambda e: (types.index(e.event_type), CONF_RANK.get(e.confidence, 2), 0 if e.date_start else 1))
    return evs[0]


def age_between(birth: Optional[Event], other: Optional[Event]) -> Optional[tuple[int, bool]]:
    """Âge (années, approximatif ?) d'une personne née à `birth` au moment de `other`. None si incalculable."""
    if birth is None or other is None or not birth.date_start or not other.date_start:
        return None
    if birth.date_kind not in ("exact", "approx", "calculated") or other.date_kind not in ("exact", "approx", "calculated"):
        return None
    by, bm, bd = _iso_parts(birth.date_start)
    oy, om, od = _iso_parts(other.date_start)
    if by is None or oy is None:
        return None
    exact = birth.date_kind == "exact" and other.date_kind == "exact" and all(v is not None for v in (bm, bd, om, od))
    years = oy - by
    if exact and (om, od) < (bm, bd):
        years -= 1
    if years < 0 or years > 120:
        return None
    return years, not exact


def age_text(a: Optional[tuple[int, bool]]) -> Optional[str]:
    if a is None:
        return None
    n, approx = a
    if n == 0 and not approx:
        return "moins d'un an"
    s = f"{n} an{'s' if n > 1 else ''}"
    return f"environ {s}" if approx else s


def join_fr(items: list[str], last: str = "et") -> str:
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + f" {last} " + items[-1]


# =====================================================================================
# Citations, participants
# =====================================================================================

def _cits(db: Session, target_type: str, target_id: Optional[str]) -> list[dict]:
    if not target_id:
        return []
    return [{"citation_id": c.id, "source_id": c.source_id, "title": c.source_title, "excerpt": c.excerpt,
             "confidence": c.confidence} for c in citations_for(db, target_type, target_id)]


def _dedupe_sources(items: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    for c in items:
        seen.setdefault(c["source_id"], c)
    return list(seen.values())


def participants_of(ev: Optional[Event]) -> list[dict]:
    """Participants d'un acte (contrat partagé avec l'import de documents), nettoyés."""
    if ev is None:
        return []
    raw = (ev.attributes or {}).get("participants") or []
    out = []
    if not isinstance(raw, list):
        return out
    for x in raw:
        if not isinstance(x, dict) or not str(x.get("name") or "").strip():
            continue
        role = str(x.get("role") or "other")
        out.append({"name": str(x.get("name")).strip(), "role": role if role in ROLE_LABEL else "other",
                    "role_label": ROLE_LABEL.get(role, "présent"),
                    "age": _clean(x.get("age")), "occupation": _clean(x.get("occupation")),
                    "residence": _clean(x.get("residence")), "relation": _clean(x.get("relation"))})
    return out


def _clean(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def officer_of(ev: Optional[Event]) -> Optional[str]:
    if ev is None:
        return None
    o = _clean((ev.attributes or {}).get("officer"))
    if o:
        return o
    for pt in participants_of(ev):
        if pt["role"] == "officer":
            return pt["name"] + (f", {pt['occupation']}" if pt.get("occupation") else "")
    return None


def participant_text(pt: dict, with_relation: bool = True) -> str:
    details = []
    if pt.get("age"):
        a = pt["age"]
        details.append(a if re.search(r"[a-zA-Z]", a) else f"{a} ans")
    if pt.get("occupation"):
        details.append(pt["occupation"])
    if pt.get("residence"):
        details.append(f"demeurant à {pt['residence']}")
    if with_relation and pt.get("relation"):
        details.append(pt["relation"])
    return pt["name"] + (f" ({', '.join(details)})" if details else "")


# =====================================================================================
# Ordre des chapitres
# =====================================================================================

def relative_generations(db: Session, root: Optional[str]) -> dict[str, int]:
    """Génération relative à la personne de départ (racine = 1, parents = 2, enfants = 0), par parcours du graphe."""
    if not root:
        return {}
    up: dict[str, list[str]] = {}
    down: dict[str, list[str]] = {}
    for pid, cid in db.execute(select(ParentChild.parent_id, ParentChild.child_id)).all():
        up.setdefault(cid, []).append(pid)
        down.setdefault(pid, []).append(cid)
    partners: dict[str, list[str]] = {}
    for a, b in db.execute(select(Family.partner1_id, Family.partner2_id)).all():
        if a and b:
            partners.setdefault(a, []).append(b)
            partners.setdefault(b, []).append(a)
    gen = {root: 1}
    frontier = [root]
    while frontier:
        nxt = []
        for pid in frontier:
            for q, delta in [(x, 1) for x in up.get(pid, [])] + [(x, -1) for x in down.get(pid, [])] + [(x, 0) for x in partners.get(pid, [])]:
                if q not in gen:
                    gen[q] = gen[pid] + delta
                    nxt.append(q)
        frontier = nxt
    return gen


def _fresh(db: Session) -> None:
    """Relit les collections (événements…) : une session longue peut contenir des relations périmées."""
    db.flush()
    db.expire_all()


def outline(db: Session) -> dict:
    _fresh(db)
    sosa = sosa_map(db)
    root = root_id(db)
    rel_gen = relative_generations(db, root)
    persons = db.execute(select(Person)).scalars().all()
    ancestors, others = [], []
    for p in persons:
        (ancestors if p.id in sosa else others).append(p)
    ancestors.sort(key=lambda p: min(sosa[p.id]))

    def other_key(p: Person):
        gnum = rel_gen.get(p.id)
        b, _ = years_of(p)
        return (gnum is None, abs((gnum or 1) - 1) if gnum is not None else 0, -(gnum or 0), b or 9999,
                (p.surname or "").lower(), (p.given_names or "").lower())

    others.sort(key=other_key)
    chapters = []
    for i, p in enumerate(ancestors + others, start=1):
        nums = sosa.get(p.id, [])
        b_ev = best_event(p.events, BIRTH_TYPES)
        d_ev = best_event(p.events, DEATH_TYPES)
        by, dy = years_of(p)
        chapters.append({
            "number": i, "person_id": p.id, "name": p.display_name(), "given_names": p.given_names, "surname": p.surname,
            "sex": p.sex, "sosa": nums, "is_ancestor": bool(nums), "is_root": p.is_root,
            "generation": generation_of(nums[0]) if nums else rel_gen.get(p.id),
            "birth_year": by, "death_year": dy, "years": years_text(p),
            "birth_place": place_short(b_ev), "death_place": place_short(d_ev), "place": main_place_name(p),
            "occupation": p.occupation, "portrait_media_id": p.portrait_media_id, "confidence": p.confidence,
        })
    todo = todo_lists(db, sosa)
    anc_years = [y for p in ancestors for y in years_of(p) if y]
    by_sosa = {n: p for p in ancestors for n in sosa[p.id]}
    names = [x.surname for x in (by_sosa.get(2), by_sosa.get(3)) if x is not None and x.surname]
    if not names and root:
        r = db.get(Person, root)
        names = [r.surname] if r and r.surname else []
    if not names:
        names = [s for s, _ in Counter(p.surname for p in persons if p.surname).most_common(2)]
    return {
        "title": "Livre de la famille " + " · ".join(n.upper() for n in dict.fromkeys(names)) if names else "Livre de la famille",
        "surnames": list(dict.fromkeys(n.upper() for n in names)),
        "span": {"start": min(anc_years) if anc_years else None, "end": max(anc_years) if anc_years else None},
        "root_id": root,
        "counts": {
            "persons": len(persons), "ancestors": len(ancestors),
            "generations": max((generation_of(min(v)) for v in sosa.values()), default=0),
            "places": len(_places_used(db)), "sources": db.query(Source).count(), "media": db.query(Media).count(),
        },
        "chapters": chapters,
        "annexes": {"trades": len(trades_annex(db, with_wiki=False)), "places": len(_places_used(db)),
                    "dates_to_find": sum(len(r["items"]) for r in todo["dates"]),
                    "acts_to_find": sum(len(r["items"]) for r in todo["acts"])},
    }


def main_place_name(p: Person) -> Optional[str]:
    b = best_event(p.events, BIRTH_TYPES)
    if place_short(b):
        return place_short(b)
    names = Counter(place_short(e) for e in p.events if place_short(e))
    return names.most_common(1)[0][0] if names else None


def _places_used(db: Session) -> set[str]:
    return {pid for (pid,) in db.execute(select(Event.place_id).where(Event.place_id.is_not(None))).all()}


# =====================================================================================
# Faits manquants (« Dates à trouver » / « Actes à retrouver »)
# =====================================================================================

class _Evidence:
    """Pré-charge les cibles citées et les médias pour éviter des milliers de requêtes."""

    def __init__(self, db: Session) -> None:
        self.cited = {(t, i) for t, i in db.execute(select(Citation.target_type, Citation.target_id)).all()}

    def has_act(self, ev: Optional[Event]) -> bool:
        if ev is None:
            return False
        a = ev.attributes or {}
        if a.get("media_id") or a.get("transcription"):
            return True
        if ("event", ev.id) in self.cited:
            return True
        return bool(ev.family_id and ("family", ev.family_id) in self.cited and ev.event_type in MARRIAGE_TYPES)


def _probably_dead(p: Person, birth: Optional[Event]) -> bool:
    if p.is_living is True:
        return False
    if p.is_living is False:
        return True
    return bool(birth and birth.sort_year and birth.sort_year < date.today().year - 100)


def missing_for(db: Session, p: Person, ev_cache: Optional[_Evidence] = None) -> dict:
    """{"dates": [...], "acts": [...]} : ce qu'il reste à trouver pour cette personne (jamais inventé, seulement constaté)."""
    evidence = ev_cache or _Evidence(db)
    dates, acts = [], []
    birth = best_event(p.events, BIRTH_TYPES)
    death = best_event(p.events, DEATH_TYPES)
    if birth is None or not birth.date_start or birth.date_kind == "unknown":
        dates.append({"key": "birth_date", "label": "Date de naissance à trouver", "event_id": birth.id if birth else None})
    elif birth.date_kind != "exact" or len(birth.date_start) < 10:
        dates.append({"key": "birth_exact", "label": f"Date de naissance exacte à préciser (connue : {gendate_of(birth).display()})",
                      "event_id": birth.id})
    if not evidence.has_act(birth):
        acts.append({"key": "birth_act", "label": "Acte de naissance à retrouver" if (birth is None or birth.event_type == "birth")
                     else "Acte de baptême à retrouver", "event_id": birth.id if birth else None})
    if _probably_dead(p, birth) or death is not None:
        if death is None or not death.date_start or death.date_kind == "unknown":
            dates.append({"key": "death_date", "label": "Date de décès à trouver", "event_id": death.id if death else None})
        elif death.date_kind != "exact" or len(death.date_start) < 10:
            dates.append({"key": "death_exact", "label": f"Date de décès exacte à préciser (connue : {gendate_of(death).display()})",
                          "event_id": death.id})
        if not evidence.has_act(death):
            acts.append({"key": "death_act", "label": "Acte de décès à retrouver", "event_id": death.id if death else None})
    for f in families_of(db, p.id):
        other_id = f.partner2_id if f.partner1_id == p.id else f.partner1_id
        other = db.get(Person, other_id) if other_id else None
        who = other.display_name() if other else "un conjoint non identifié"
        m = best_event(f.events, MARRIAGE_TYPES)
        if m is None and f.union_type != "marriage":
            continue
        if m is None or not m.date_start or m.date_kind == "unknown":
            dates.append({"key": f"marriage_date:{f.id}", "label": f"Date de mariage avec {who} à trouver", "event_id": m.id if m else None})
        if not evidence.has_act(m):
            acts.append({"key": f"marriage_act:{f.id}", "label": f"Acte de mariage avec {who} à retrouver", "event_id": m.id if m else None})
    return {"dates": dates, "acts": acts}


def todo_lists(db: Session, sosa: Optional[dict[str, list[int]]] = None) -> dict:
    if sosa is None:
        _fresh(db)
        sosa = sosa_map(db)
    evidence = _Evidence(db)
    dates, acts = [], []
    persons = db.execute(select(Person)).scalars().all()
    persons.sort(key=lambda p: (0 if p.id in sosa else 1, min(sosa.get(p.id, [10 ** 12])), (p.surname or "").lower(),
                                (p.given_names or "").lower()))
    for p in persons:
        miss = missing_for(db, p, evidence)
        head = {"person_id": p.id, "name": p.display_name(), "sex": p.sex, "sosa": sosa.get(p.id, []), "years": years_text(p)}
        if miss["dates"]:
            dates.append({**head, "items": miss["dates"]})
        if miss["acts"]:
            acts.append({**head, "items": miss["acts"]})
    return {"dates": dates, "acts": acts,
            "counts": {"dates": sum(len(r["items"]) for r in dates), "acts": sum(len(r["items"]) for r in acts),
                       "persons_dates": len(dates), "persons_acts": len(acts)}}


# =====================================================================================
# Chapitre
# =====================================================================================

class _Writer:
    def __init__(self) -> None:
        self.blocks: list[dict] = []

    def para(self, kind: str, sentences: list[str], sources: list[dict] | None = None, event_ids: list[str] | None = None,
             confidence: Optional[str] = None) -> None:
        text = " ".join(s.strip() for s in sentences if s and s.strip())
        if not text:
            return
        self.blocks.append({"type": "paragraph", "kind": kind, "text": text, "sources": _dedupe_sources(sources or []),
                            "event_ids": [e for e in (event_ids or []) if e], "confidence": confidence})

    def box(self, kind: str, data: Optional[dict]) -> None:
        if data:
            self.blocks.append({"type": "box", "kind": kind, **data})


def _parents_split(db: Session, p: Person):
    rels = parents_of(db, p.id)
    lineal = [(pp, r) for pp, r in rels if r.relation_type in LINEAL]
    father = next((pp for pp, r in lineal if pp.sex == "M"), None)
    mother = next((pp for pp, r in lineal if pp.sex == "F"), None)
    unknown = [pp for pp, r in lineal if pp.sex not in ("M", "F")]
    other = [(pp, r) for pp, r in rels if r.relation_type not in LINEAL]
    return father, mother, unknown, other, rels


def _occupations(p: Person) -> list[dict]:
    """Métiers documentés : champ « profession » + événements « profession » (avec l'année)."""
    out: dict[str, dict] = {}
    for e in sorted(p.events, key=lambda e: e.sort_year or 9999):
        if e.event_type == "occupation":
            for o in split_occupations(e.value_original or e.description):
                out.setdefault(o.lower(), {"label": o, "years": [], "event_ids": []})
                if e.sort_year:
                    out[o.lower()]["years"].append(e.sort_year)
                out[o.lower()]["event_ids"].append(e.id)
    for o in split_occupations(p.occupation):
        out.setdefault(o.lower(), {"label": o, "years": [], "event_ids": []})
    return list(out.values())


def _person_ref(p: Optional[Person], sosa: dict[str, list[int]]) -> Optional[dict]:
    if p is None:
        return None
    return {"id": p.id, "name": p.display_name(), "sex": p.sex, "years": years_text(p), "sosa": sosa.get(p.id, []),
            "occupation": p.occupation}


def _child_detail(db: Session, c: Person) -> str:
    b = best_event(c.events, BIRTH_TYPES)
    d = best_event(c.events, ("death", "burial"))
    bits = []
    if b and date_phrase(b):
        bits.append(f"{g(c, 'né', 'née')} {_year_phrase(b)}")
    if d and date_phrase(d):
        bits.append(f"{g(c, 'mort', 'morte')} {_year_phrase(d)}")
    spouses = []
    for f in families_of(db, c.id):
        oid = f.partner2_id if f.partner1_id == c.id else f.partner1_id
        o = db.get(Person, oid) if oid else None
        if o and (f.union_type == "marriage" or best_event(f.events, MARRIAGE_TYPES)):
            spouses.append(o.display_name())
    if spouses:
        bits.append(f"{g(c, 'marié', 'mariée')} à " + join_fr(spouses, "puis"))
    return c.display_name() + (f" ({', '.join(bits)})" if bits else "")


def _year_phrase(ev: Event) -> str:
    y = ev.sort_year
    if ev.date_kind in ("approx", "calculated"):
        return f"vers {y}"
    if ev.date_kind == "before":
        return f"avant {y}"
    if ev.date_kind == "after":
        return f"après {y}"
    if ev.date_kind == "between":
        return f"entre {_iso_parts(ev.date_start)[0]} et {_iso_parts(ev.date_end)[0]}"
    return f"en {y}"


def _life_span(p: Person) -> tuple[Optional[int], Optional[int]]:
    years = [e.sort_year for e in p.events if e.sort_year]
    b, d = years_of(p)
    start = b or (min(years) if years else None)
    if d:
        end = d
    elif p.is_living:
        end = date.today().year
    else:
        end = max(years) if years else None
    return start, end


def _region_keys_for(p: Person) -> list[str]:
    ev = best_event(p.events, BIRTH_TYPES)
    pl = ev.place if ev is not None and ev.place is not None else next((e.place for e in p.events if e.place), None)
    if pl is None:
        return ["FR", "EU"]
    return region_of(pl.department, pl.region, pl.country)


def epoch_items(p: Person, limit: int = 3) -> list[dict]:
    start, end = _life_span(p)
    if start is None or end is None:
        return []
    by = years_of(p)[0]
    regions = _region_keys_for(p)
    pool = [{**e, "text": e.get("text"), "origin": "Événements historiques GENEALIS"} for e in HISTORICAL_EVENTS] + \
           [{**e, "origin": "Repères régionaux GENEALIS"} for e in REGIONAL_TIMELINE]
    seen, cands = set(), []
    for e in pool:
        if e["region"] not in regions or e["end"] < start or e["start"] > end:
            continue
        if e["label"] in seen:
            continue
        seen.add(e["label"])
        prio = regions.index(e["region"])
        kind_w = {"war": 0, "politics": 1, "law": 2, "economy": 2, "migration": 2}.get(e.get("kind", ""), 1)
        cands.append((prio, kind_w, e))
    cands.sort(key=lambda t: (t[0], t[1], t[2]["start"]))
    chosen = sorted([c[2] for c in cands[:limit]], key=lambda e: e["start"])
    out = []
    for e in chosen:
        when = f"En {e['start']}" if e["start"] == e["end"] else f"De {e['start']} à {e['end']}"
        if by is not None and e["start"] >= by:
            age = e["start"] - by
            age_s = f"j'avais environ {age} an{'s' if age > 1 else ''}" if age > 0 else "c'est l'année de ma naissance"
            line = f"{when}, {age_s}."
        elif by is not None:
            line = f"{when} : je suis {g(p, 'né', 'née')} pendant cette période."
        else:
            line = f"{when}."
        out.append({"start": e["start"], "end": e["end"], "label": e["label"], "text": e.get("text"), "age_line": line,
                    "origin": e["origin"]})
    return out


def daily_life_note(p: Person) -> Optional[dict]:
    start, end = _life_span(p)
    if start is None:
        return None
    by = years_of(p)[0]
    ref = None
    for f_ev in [e for e in p.events if e.event_type in MARRIAGE_TYPES and e.sort_year]:
        ref = f_ev.sort_year
    if ref is None:
        ref = (by + 25) if by else start
        if end is not None:
            ref = min(ref, end)
    regions = _region_keys_for(p)
    matches = [n for n in DAILY_LIFE if n["start"] <= ref <= n["end"] and n["region"] in regions]
    if not matches:
        return None
    matches.sort(key=lambda n: regions.index(n["region"]))
    n = matches[0]
    return {"title": n["title"], "text": n["text"], "period": f"{n['start']}–{n['end']}", "reference_year": ref,
            "origin": "Repère général GENEALIS (ne provient pas des actes de la famille)"}


def place_box(db: Session, place: Optional[Place], budget: Optional[wiki.Budget]) -> Optional[dict]:
    if place is None or not place.name:
        return None
    ctx = wiki.place_context(db, place.name, place.department, budget=budget)
    if not ctx:
        return None
    return {"title": place.name, "place_id": place.id, "text": ctx.get("extract"), "url": ctx.get("url"),
            "image": ctx.get("image"), "coat_of_arms": ctx.get("coat_of_arms"), "origin": ctx.get("source"),
            "description": ctx.get("description")}


def trade_box(db: Session, label: str, budget: Optional[wiki.Budget]) -> Optional[dict]:
    t = lookup_trade(label)
    if t:
        return {"title": t["label"], "occupation": label, "definition": t["definition"], "text": t["description"],
                "origin": "Définition — dictionnaire des métiers anciens GENEALIS (connaissances générales)", "url": None}
    ctx = wiki.trade_context(db, label, budget=budget)
    if ctx:
        return {"title": cap(label), "occupation": label, "definition": ctx.get("description"), "text": ctx.get("extract"),
                "origin": ctx.get("source"), "url": ctx.get("url"), "image": ctx.get("image")}
    return None


def _event_label(ev: Event) -> str:
    return EVENT_LABEL.get(ev.event_type, ev.event_type.replace("_", " ").capitalize())


def _life_event_sentence(p: Person, e: Event) -> Optional[str]:
    when = date_phrase(e)
    W = cap(when) if when else None
    where = at(e)
    desc = (e.description or "").strip()
    desc_s = f" ({desc})" if desc and len(desc) <= 160 else ""
    t = e.event_type
    if t == "residence":
        return f"{W}, je vivais{where}{desc_s}." if W else (f"J'ai vécu{where}{desc_s}." if where else None)
    if t == "census":
        return f"{W}, j'ai été {g(p, 'recensé', 'recensée')}{where}{desc_s}." if W else f"J'ai été {g(p, 'recensé', 'recensée')}{where}{desc_s}."
    if t == "immigration":
        return f"{W}, je suis {g(p, 'arrivé', 'arrivée')}{where}{desc_s}." if W else f"Je suis {g(p, 'arrivé', 'arrivée')}{where}{desc_s}."
    if t == "emigration":
        base = f"j'ai quitté {place_short(e)}" if place_short(e) else "j'ai émigré"
        return f"{W}, {base}{desc_s}." if W else f"{cap(base)}{desc_s}."
    if t == "naturalization":
        return f"{W}, j'ai été {g(p, 'naturalisé', 'naturalisée')}{where}{desc_s}." if W else f"J'ai été {g(p, 'naturalisé', 'naturalisée')}{where}{desc_s}."
    if t in ("military", "military_enlistment"):
        return (f"{W}, les registres militaires me mentionnent{where}{desc_s}." if W
                else f"Les registres militaires me mentionnent{where}{desc_s}.")
    if t == "military_discharge":
        return f"{W}, j'ai été {g(p, 'libéré', 'libérée')} du service militaire{desc_s}." if W else None
    if t == "will":
        return f"{W}, j'ai fait établir mon testament{where}{desc_s}." if W else f"J'ai fait établir un testament{where}{desc_s}."
    if t in ("occupation", "documents", "signature") or t in BIRTH_TYPES or t in DEATH_TYPES or t in MARRIAGE_TYPES:
        return None
    label = _event_label(e).lower()
    if W:
        return f"{W} : {label}{where}{desc_s}."
    if where or desc_s:
        return f"{cap(label)}{where}{desc_s}."
    return None


def _declaration_sentence(p: Person, ev: Event, kind: str) -> Optional[str]:
    parts = participants_of(ev)
    officer = officer_of(ev)
    if not parts and not officer:
        return None
    decl = [x for x in parts if x["role"] == "declarant"]
    if kind == "birth" and not decl:
        decl = [x for x in parts if x["role"] in ("father",)]
    wit = [x for x in parts if x["role"] == "witness"]
    gp = [x for x in parts if x["role"] in ("godfather", "godmother")]
    sentences = []
    if kind == "birth":
        if decl:
            s = "Ma naissance a été déclarée"
            if officer:
                s += f" devant {officer}{',' if ',' in officer else ''}"
            s += " par " + join_fr([participant_text(x) for x in decl])
            if wit:
                s += ", en présence de " + join_fr([participant_text(x) for x in wit])
            sentences.append(s + ".")
        elif officer or wit:
            s = "Mon acte de naissance a été dressé" + (f" par {officer}" if officer else "")
            if wit:
                s += ", en présence de " + join_fr([participant_text(x) for x in wit])
            sentences.append(s + ".")
    elif kind == "baptism":
        if gp:
            gf = [x for x in gp if x["role"] == "godfather"]
            gm = [x for x in gp if x["role"] == "godmother"]
            bits = []
            if gf:
                bits.append(f"mon parrain était {join_fr([participant_text(x) for x in gf])}")
            if gm:
                bits.append(f"ma marraine {join_fr([participant_text(x) for x in gm])}" if gf else
                            f"ma marraine était {join_fr([participant_text(x) for x in gm])}")
            sentences.append(cap(" et ".join(bits)) + ".")
        if officer:
            sentences.append(f"Le baptême a été célébré par {officer}.")
        if wit:
            sentences.append("Étaient présents : " + join_fr([participant_text(x) for x in wit]) + ".")
    elif kind == "death":
        if decl:
            s = "Mon décès a été déclaré"
            if officer:
                s += f" à {officer}{',' if ',' in officer else ''}"
            s += " par " + join_fr([participant_text(x) for x in decl])
            sentences.append(s + ".")
        elif officer:
            sentences.append(f"L'acte de décès a été dressé par {officer}.")
        if wit:
            sentences.append("Étaient présents : " + join_fr([participant_text(x) for x in wit]) + ".")
    elif kind == "marriage":
        if officer:
            sentences.append(f"Le mariage a été célébré par {officer}.")
        if wit:
            lead = "Nos témoins étaient " if len(wit) > 1 else "Notre témoin était "
            sentences.append(lead + join_fr([participant_text(x) for x in wit]) + ".")
        others = [x for x in parts if x["role"] in ("father", "mother", "other", "declarant")]
        if others:
            sentences.append("Étaient aussi présents : " + join_fr([participant_text(x) for x in others]) + ".")
    return " ".join(sentences) or None


def _sosa_sentence(db: Session, p: Person, sosa: dict[str, list[int]]) -> tuple[Optional[str], Optional[dict]]:
    nums = sosa.get(p.id, [])
    root = root_id(db)
    root_p = db.get(Person, root) if root else None
    if nums:
        n = nums[0]
        if n == 1:
            return ("Dans l'arbre, je porte le numéro Sosa 1 : je suis la personne de départ, à partir de laquelle "
                    "tous les ancêtres sont numérotés."), None
        gen_up = generation_of(n) - 1
        s = f"Dans l'arbre, je porte le numéro Sosa {n}"
        anc = g(p, "un ancêtre", "une ancêtre", "un ancêtre")
        s += f" : je suis {anc}{' de ' + root_p.display_name() if root_p else ''} à la {ordinal(gen_up)} génération"
        line_child = None
        for c, r in children_of(db, p.id):
            if r.relation_type in LINEAL and any(x == n // 2 for x in sosa.get(c.id, [])):
                line_child = c
                break
        if line_child is not None and n // 2 >= 1:
            rel = g(line_child, "mon fils", "ma fille", "mon enfant")
            s += f", et la lignée continue par {rel} {line_child.display_name()}"
        s += "."
        if len(nums) > 1:
            s += (f" J'apparais plusieurs fois dans l'ascendance (implexe) : numéros Sosa "
                  f"{join_fr([str(x) for x in nums])}.")
        return s, ({"id": line_child.id, "name": line_child.display_name(), "sex": line_child.sex} if line_child else None)
    if root_p is not None and root_p.id != p.id:
        try:
            from .kinship import kinship

            k = kinship(db, root_p.id, p.id)
            if k.get("found") and k.get("relation") and "votre" not in k["relation"]:
                return (f"Je ne fais pas partie de l'ascendance directe de {root_p.display_name()} : dans l'arbre, "
                        f"je suis {k['relation']} de {root_p.display_name()}."), None
        except Exception:
            pass
        return f"Je ne fais pas partie de l'ascendance directe de {root_p.display_name()}.", None
    return None, None


def story_key(person_id: str) -> str:
    return f"story:{person_id}"


def facts_hash(paragraphs: list[str]) -> str:
    return hashlib.sha1("\n".join(paragraphs).encode("utf-8")).hexdigest()[:16]


def chapter(db: Session, p: Person, *, with_wiki: bool = True, budget_seconds: float = 6.0) -> dict:
    _fresh(db)
    sosa = sosa_map(db)
    budget = wiki.Budget(budget_seconds) if with_wiki else None
    use_wiki = with_wiki
    w = _Writer()
    events = list(p.events)
    birth = best_event(events, ("birth",))
    bapt = best_event(events, ("baptism", "child_baptism", "adult_baptism"))
    death = best_event(events, ("death",))
    burial = best_event(events, ("burial", "cremation", "funeral"))
    first = birth or bapt
    father, mother, unknown_parents, other_parents, rels = _parents_split(db, p)
    rel_cits = [c for _, r in rels for c in _cits(db, "parent_child", r.id)]
    placeholder_parent = lambda x: x is not None and not (x.given_names or x.surname)  # noqa: E731

    # ---- 1. Naissance + parents ----
    s1: list[str] = []
    if birth is not None and (date_phrase(birth) or place_short(birth)):
        dp = date_phrase(birth)
        s1.append(f"Je suis {g(p, 'né', 'née')} {dp}{at(birth)}." if dp else
                  f"Je suis {g(p, 'né', 'née')}{at(birth)}, à une date que les documents réunis ne précisent pas.")
    if bapt is not None and (date_phrase(bapt) or place_short(bapt)):
        dp = date_phrase(bapt)
        s1.append(f"J'ai été {g(p, 'baptisé', 'baptisée')} {dp}{at(bapt)}." if dp else
                  f"J'ai été {g(p, 'baptisé', 'baptisée')}{at(bapt)}.")
    if not s1:
        s1.append(f"Les documents réunis ne disent pas encore quand ni où je suis {g(p, 'né', 'née')}.")
    ref_birth = first
    parent_bits = []
    for role_m, par in (("père", father), ("mère", mother)):
        if par is None or placeholder_parent(par):
            continue
        rel = next((r for pp, r in rels if pp.id == par.id), None)
        adj = " adoptif" if rel is not None and rel.relation_type == "adoptive" else ""
        if role_m == "mère" and adj:
            adj = " adoptive"
        details = []
        if par.occupation:
            details.append(par.occupation)
        a = age_text(age_between(best_event(par.events, BIRTH_TYPES), ref_birth)) if ref_birth else None
        txt = par.display_name() + (f", {', '.join(details)}" if details else "")
        if a:
            txt += f", qui avait {a} à ma naissance"
        parent_bits.append((role_m, adj, txt))
    if parent_bits:
        if len(parent_bits) == 2:
            (r1, a1, t1), (r2, a2, t2) = parent_bits
            s1.append(f"Mon {r1}{a1} était {t1} ; ma {r2}{a2}, {t2}.")
        else:
            r1, a1, t1 = parent_bits[0]
            s1.append(f"{'Mon' if r1 == 'père' else 'Ma'} {r1}{a1} était {t1}.")
    for par in unknown_parents:
        if not placeholder_parent(par):
            s1.append(f"Un de mes parents connus est {par.display_name()}.")
    if not parent_bits and not unknown_parents:
        s1.append("Mes parents ne sont pas encore identifiés dans l'arbre.")
    elif father is None or placeholder_parent(father):
        if mother is not None and not placeholder_parent(mother):
            s1.append("Mon père n'est pas encore identifié dans l'arbre.")
    elif mother is None or placeholder_parent(mother):
        s1.append("Ma mère n'est pas encore identifiée dans l'arbre.")
    for par, r in other_parents:
        lbl = {"step": g(par, "mon beau-père", "ma belle-mère", "mon beau-parent"),
               "foster": g(par, "mon père nourricier", "ma mère nourricière", "mon parent nourricier")}.get(r.relation_type, "un parent")
        s1.append(f"Dans l'arbre, {par.display_name()} est {lbl}.")
    w.para("birth", s1, _cits(db, "event", birth.id if birth else None) + _cits(db, "event", bapt.id if bapt else None) + rel_cits,
           [birth.id if birth else None, bapt.id if bapt else None], first.confidence if first else None)

    # ---- 2. Déclaration / baptême (participants des actes) ----
    if birth is not None:
        d = _declaration_sentence(p, birth, "birth")
        if d:
            w.para("birth_act", [d], _cits(db, "event", birth.id), [birth.id], birth.confidence)
    if bapt is not None:
        d = _declaration_sentence(p, bapt, "baptism")
        if d:
            w.para("baptism_act", [d], _cits(db, "event", bapt.id), [bapt.id], bapt.confidence)

    # ---- Encadré : village de naissance ----
    birth_place = (first.place if first is not None else None) or next((e.place for e in events if e.place), None)
    shown_places: set[str] = set()
    if use_wiki and birth_place is not None:
        b = place_box(db, birth_place, budget)
        if b:
            w.box("village", b)
            shown_places.add(birth_place.id)

    # ---- 3. Grands-parents ----
    gp_sentences = []
    for side, par in (("paternel", father), ("maternel", mother)):
        if par is None:
            continue
        gpar = [gp for gp, r in parents_of(db, par.id) if r.relation_type in LINEAL and not placeholder_parent(gp)]
        if not gpar:
            continue
        sidef = side + "le" if side.endswith("l") else side
        if len(gpar) >= 2:
            gp_sentences.append(f"mes grands-parents {side}s s'appelaient {join_fr([x.display_name() for x in gpar])}")
        else:
            x = gpar[0]
            gp_sentences.append(f"{g(x, 'mon grand-père', 'ma grand-mère', 'mon grand-parent')} "
                                f"{g(x, side, sidef, side)} s'appelait {x.display_name()}")
    if gp_sentences:
        w.para("grandparents", [cap(" ; ".join(gp_sentences)) + "."])

    # ---- 4. Fratrie ----
    sibs = siblings_of(db, p.id)
    if sibs:
        def sib_txt(s: Person) -> str:
            y = years_of(s)[0]
            return s.display_name() + (f" ({y})" if y else "")
        if len(sibs) == 1:
            s = sibs[0]
            w.para("siblings", [f"Dans l'arbre, on me connaît {g(s, 'un frère', 'une sœur', 'un frère ou une sœur')} : {sib_txt(s)}."])
        else:
            sexes = {s.sex for s in sibs}
            lbl = "frères" if sexes == {"M"} else "sœurs" if sexes == {"F"} else "frères et sœurs"
            w.para("siblings", [f"Dans l'arbre, on me connaît {len(sibs)} {lbl} : {join_fr([sib_txt(s) for s in sibs])}."])

    # ---- 5. Métier(s) ----
    occs = _occupations(p)
    if occs:
        labels = [o["label"] + (f" ({', '.join(str(y) for y in sorted(set(o['years'])))})" if o["years"] else "") for o in occs]
        occ_cits = _cits(db, "person", p.id) + [c for o in occs for eid in o["event_ids"] for c in _cits(db, "event", eid)]
        w.para("occupation", [f"Les documents me disent {join_fr(labels)}."], occ_cits, [e for o in occs for e in o["event_ids"]])
        n_boxes = 0
        seen_trades = set()
        for o in occs:
            if n_boxes >= 2:
                break
            if not use_wiki and not lookup_trade(o["label"]):
                continue
            tb = trade_box(db, o["label"], budget if use_wiki else None)
            if tb and tb["title"] not in seen_trades and tb["title"] != "Sans profession":
                seen_trades.add(tb["title"])
                w.box("metier", tb)
                n_boxes += 1

    # ---- 6. Vie : résidences, recensements… et unions, dans l'ordre chronologique ----
    timeline: list[tuple[int, int, Any]] = []
    for e in events:
        s = _life_event_sentence(p, e)
        if s:
            timeline.append((e.sort_year or 9999, 0, ("event", e, s)))
    fams = families_of(db, p.id)
    all_children = {c.id: (c, r) for c, r in children_of(db, p.id)}
    placed_children: set[str] = set()
    for f in fams:
        m = best_event(f.events, MARRIAGE_TYPES)
        timeline.append(((m.sort_year if m and m.sort_year else 9998), 1, ("family", f, m)))
    timeline.sort(key=lambda t: (t[0], t[1]))
    pending_events: list[tuple[Event, str]] = []

    def flush_events():
        if pending_events:
            w.para("life", [s for _, s in pending_events], [c for e, _ in pending_events for c in _cits(db, "event", e.id)],
                   [e.id for e, _ in pending_events])
            pending_events.clear()

    for _, _, item in timeline:
        if item[0] == "event":
            pending_events.append((item[1], item[2]))
            continue
        flush_events()
        f, m = item[1], item[2]
        other_id = f.partner2_id if f.partner1_id == p.id else f.partner1_id
        sp = db.get(Person, other_id) if other_id else None
        sp_name = sp.display_name() if sp else "une personne que les documents ne nomment pas encore"
        pron = g(sp, "il", "elle", None) if sp is not None and sp.sex in ("M", "F") else None
        sents = []
        if m is not None:
            dp = date_phrase(m)
            pl = place_short(m)
            lead = cap(dp) if dp else ""
            if lead and pl:
                s = f"{lead}, à {pl}, j'ai épousé {sp_name}"
            elif lead:
                s = f"{lead}, j'ai épousé {sp_name}"
            elif pl:
                s = f"J'ai épousé {sp_name} à {pl}"
            else:
                s = f"J'ai épousé {sp_name}"
            my_age = age_text(age_between(first, m))
            sp_age = age_text(age_between(best_event(sp.events, BIRTH_TYPES), m)) if sp is not None else None
            if my_age and sp_age and pron:
                s += f" ; j'avais alors {my_age} et {pron} {sp_age}"
            elif my_age:
                s += f" ; j'avais alors {my_age}"
            elif sp_age and pron:
                s += f" ; {pron} avait alors {sp_age}"
            sents.append(s + ".")
        elif f.union_type == "marriage":
            sents.append(f"J'ai épousé {sp_name}, à une date que les documents réunis ne précisent pas.")
        elif f.union_type == "union":
            sents.append(f"J'ai vécu en union avec {sp_name}.")
        else:
            sents.append(f"Dans l'arbre, je suis {g(p, 'uni', 'unie')} à {sp_name}.")
        if sp is not None:
            sp_par = [x for x, r in parents_of(db, sp.id) if r.relation_type in LINEAL and not placeholder_parent(x)]
            sp_f = next((x for x in sp_par if x.sex == "M"), None)
            sp_m = next((x for x in sp_par if x.sex == "F"), None)
            Pron = cap(pron) if pron else sp.given_names or sp.display_name()
            bits = []
            if sp_f or sp_m:
                fille = g(sp, "le fils", "la fille", "l'enfant")
                bits.append(f"{Pron} était {fille} de " + " et de ".join(x.display_name() for x in (sp_f, sp_m) if x))
            if sp.occupation:
                la = g(sp, "le", "la", "")
                bits.append(f"les documents {la + ' ' if la else ''}disent {sp.occupation}".replace("  ", " "))
            if bits:
                sents.append(cap(", et ".join(bits)) + ".")
        for e in sorted([e for e in f.events if e.event_type in ("marriage_banns", "marriage_contract", "prenuptial_contract")],
                        key=lambda e: e.sort_year or 0):
            dp = date_phrase(e)
            lbl = "Notre contrat de mariage a été passé" if "contract" in e.event_type else "Nos bans ont été publiés"
            if dp or place_short(e):
                sents.append(f"{lbl}{' ' + dp if dp else ''}{at(e)}.")
        if m is not None:
            d = _declaration_sentence(p, m, "marriage")
            if d:
                sents.append(d)
        for e in [e for e in f.events if e.event_type in ("divorce", "separation", "annulment")]:
            dp = date_phrase(e)
            verb = {"divorce": "nous avons divorcé", "separation": "nous nous sommes séparés", "annulment": "notre mariage a été annulé"}[e.event_type]
            sents.append(f"{cap(dp) + ', ' if dp else cap('')}{verb if dp else cap(verb)}{at(e)}.")
        w.para("marriage", sents, _cits(db, "event", m.id if m else None) + _cits(db, "family", f.id),
               [m.id if m else None], m.confidence if m else f.confidence)
        if use_wiki and m is not None and m.place is not None and m.place.id not in shown_places:
            b = place_box(db, m.place, budget)
            if b:
                w.box("village", b)
                shown_places.add(m.place.id)
        # Enfants de ce couple
        if sp is not None:
            sp_children = {c.id for c, _ in children_of(db, sp.id)}
            kids = [all_children[cid][0] for cid in all_children if cid in sp_children]
        else:
            kids = []
        kids.sort(key=lambda c: years_of(c)[0] or 9999)
        if kids:
            placed_children.update(c.id for c in kids)
            n = len(kids)
            lead = "Ensemble, nous avons eu un enfant connu" if n == 1 else f"Ensemble, nous avons eu {n} enfants connus"
            w.para("children", [f"{lead} : {join_fr([_child_detail(db, c) for c in kids])}."],
                   [c for k in kids for c in _cits(db, "parent_child", all_children[k.id][1].id)])
    flush_events()
    rest = [all_children[cid][0] for cid in all_children if cid not in placed_children]
    rest.sort(key=lambda c: years_of(c)[0] or 9999)
    if rest:
        n = len(rest)
        lead = ("Dans l'arbre, on me connaît aussi un enfant" if n == 1 else f"Dans l'arbre, on me connaît aussi {n} enfants") \
            if placed_children else ("Dans l'arbre, on me connaît un enfant" if n == 1 else f"Dans l'arbre, on me connaît {n} enfants")
        w.para("children", [f"{lead} : {join_fr([_child_detail(db, c) for c in rest])}."],
               [c for k in rest for c in _cits(db, "parent_child", all_children[k.id][1].id)])

    # ---- Encadrés : mon époque, la vie de tous les jours ----
    ep = epoch_items(p)
    if ep:
        w.box("epoque", {"title": "Mon époque", "items": ep,
                         "origin": "Repères historiques généraux GENEALIS — les âges sont calculés d'après ma date de naissance"})
    dl = daily_life_note(p)
    if dl:
        w.box("quotidien", dl)

    # ---- 7. Décès ----
    sd: list[str] = []
    end_ev = death or burial
    if death is not None:
        dp = date_phrase(death)
        s = f"Je suis {g(p, 'mort', 'morte')} {dp}{at(death)}" if dp else f"Je suis {g(p, 'mort', 'morte')}{at(death)}"
        age = compute_age(p, first, death)
        if age.get("age_years") is not None:
            n = age["age_years"]
            approx = (age.get("age_display") or "").startswith("≈")
            s += f", à l'âge {'d’environ' if approx else 'de'} {n} an{'s' if n > 1 else ''}".replace("d’environ", "d'environ")
        if not dp and not place_short(death):
            s = f"Je suis {g(p, 'mort', 'morte')} à une date et en un lieu que les documents réunis ne précisent pas"
        sd.append(s + ".")
        d = _declaration_sentence(p, death, "death")
        if d:
            sd.append(d)
    if burial is not None:
        dp = date_phrase(burial)
        verb = "incinéré" if burial.event_type == "cremation" else "inhumé"
        if dp or place_short(burial):
            sd.append(f"J'ai été {g(p, verb, verb + 'e')}{' ' + dp if dp else ''}{at(burial)}.")
        if death is None:
            d = _declaration_sentence(p, burial, "death")
            if d:
                sd.append(d)
    if end_ev is None and _probably_dead(p, first):
        sd.append(f"La date et le lieu de ma mort ne sont pas encore connus.")
    if sd:
        w.para("death", sd, _cits(db, "event", death.id if death else None) + _cits(db, "event", burial.id if burial else None),
               [death.id if death else None, burial.id if burial else None], end_ev.confidence if end_ev else None)

    # ---- 8. Sosa ----
    sosa_s, line_child = _sosa_sentence(db, p, sosa)
    if sosa_s:
        w.para("sosa", [sosa_s])

    nums = sosa.get(p.id, [])
    b_y, d_y = years_of(p)
    stored = db.get(Setting, story_key(p.id))
    fact_texts = [b["text"] for b in w.blocks if b["type"] == "paragraph"]
    fh = facts_hash(fact_texts)
    ai_story = None
    if stored is not None and isinstance(stored.value, dict) and stored.value.get("text"):
        ai_story = {**stored.value, "stale": stored.value.get("facts_hash") != fh,
                    "label": "Texte reformulé par l'IA à partir des faits ci-dessous"}
    root = root_id(db)
    return {
        "person_id": p.id, "name": p.display_name(), "given_names": p.given_names, "surname": p.surname,
        "married_name": p.married_name, "sex": p.sex, "is_living": p.is_living, "is_root": p.is_root,
        "portrait_media_id": p.portrait_media_id, "confidence": p.confidence,
        "birth_year": b_y, "death_year": d_y, "years": years_text(p), "place": main_place_name(p),
        "sosa": nums, "generation": generation_of(nums[0]) if nums else relative_generations(db, root).get(p.id),
        "ancestor_generation": (generation_of(nums[0]) - 1) if nums else None,
        "lineage_child": line_child, "root_id": root,
        "blocks": w.blocks, "facts_hash": fh,
        "places": life_places(db, p),
        "family": family_table(db, p, sosa),
        "landmarks": landmarks(db, p),
        "people_around": people_around(db, p),
        "documents": documents(db, p),
        "acts": acts(db, p),
        "research": research_items(db, p),
        "ai_story": ai_story,
        "wiki_offline": bool(budget and budget.offline),
        "sources_note": ("Les paragraphes biographiques sont rédigés automatiquement à partir des seuls faits enregistrés "
                         "(événements, liens, actes et sources). Les encadrés de contexte sont des repères généraux, "
                         "avec leur source."),
    }


# =====================================================================================
# Sections du chapitre
# =====================================================================================

def _all_events_with_family(db: Session, p: Person) -> list[Event]:
    evs = list(p.events)
    for f in families_of(db, p.id):
        evs.extend(f.events)
    return evs


def life_places(db: Session, p: Person) -> list[dict]:
    """Lieux de vie dans l'ordre chronologique (avec coordonnées si connues)."""
    items: list[tuple[int, str, Event]] = []
    for e in _all_events_with_family(db, p):
        if e.place is not None or e.place_original:
            items.append((e.sort_year or 9999, _event_label(e).lower(), e))
    for c, r in children_of(db, p.id):
        b = best_event(c.events, BIRTH_TYPES)
        if b is not None and (b.place is not None or b.place_original):
            items.append((b.sort_year or 9999, "naissance d'un enfant", b))
    items.sort(key=lambda t: t[0])
    groups: dict[str, dict] = {}
    order: list[str] = []
    for y, lbl, e in items:
        key = e.place.id if e.place is not None else f"raw:{(e.place_original or '').lower()}"
        if key not in groups:
            pl = e.place
            groups[key] = {"place_id": pl.id if pl else None, "name": place_short(e), "full_name": pl.display() if pl else e.place_original,
                           "lat": pl.latitude if pl else None, "lon": pl.longitude if pl else None, "years": [], "labels": []}
            order.append(key)
        gr = groups[key]
        if y != 9999 and y not in gr["years"]:
            gr["years"].append(y)
        if lbl not in gr["labels"]:
            gr["labels"].append(lbl)
    out = []
    for i, k in enumerate(order, start=1):
        gr = groups[k]
        ys = sorted(gr["years"])
        gr["n"] = i
        gr["year_start"], gr["year_end"] = (ys[0], ys[-1]) if ys else (None, None)
        out.append(gr)
    return out


def family_table(db: Session, p: Person, sosa: dict[str, list[int]]) -> list[dict]:
    father, mother, unknown, other, rels = _parents_split(db, p)
    rows = []
    if father is not None:
        rows.append({"role": "Père", "persons": [_person_ref(father, sosa)]})
    if mother is not None:
        rows.append({"role": "Mère", "persons": [_person_ref(mother, sosa)]})
    if unknown:
        rows.append({"role": "Parent", "persons": [_person_ref(x, sosa) for x in unknown]})
    for par, r in other:
        rows.append({"role": "Beau-parent" if r.relation_type == "step" else "Parent nourricier", "persons": [_person_ref(par, sosa)]})
    for f in families_of(db, p.id):
        oid = f.partner2_id if f.partner1_id == p.id else f.partner1_id
        sp = db.get(Person, oid) if oid else None
        if sp is None:
            continue
        m = best_event(f.events, MARRIAGE_TYPES)
        ref = _person_ref(sp, sosa)
        if m is not None and (m.date_start or place_short(m)):
            ref["extra"] = "mariage " + " à ".join(x for x in (gendate_of(m).display() if m.date_start else None, place_short(m)) if x)
        rows.append({"role": g(sp, "Époux", "Épouse", "Conjoint(e)"), "persons": [ref]})
    kids = sorted([c for c, _ in children_of(db, p.id)], key=lambda c: years_of(c)[0] or 9999)
    if kids:
        rows.append({"role": "Enfants" if len(kids) > 1 else "Enfant", "persons": [_person_ref(c, sosa) for c in kids]})
    sibs = siblings_of(db, p.id)
    if sibs:
        rows.append({"role": "Frères et sœurs" if len(sibs) > 1 else g(sibs[0], "Frère", "Sœur", "Frère ou sœur"),
                     "persons": [_person_ref(s, sosa) for s in sibs]})
    return rows


def landmarks(db: Session, p: Person) -> list[dict]:
    rows = []
    for e in sorted(_all_events_with_family(db, p), key=lambda e: (e.sort_year or 9999, e.event_type)):
        if e.event_type == "occupation":
            value = e.value_original or e.description
        else:
            value = None
        rows.append({"event_id": e.id, "event_type": e.event_type, "label": _event_label(e),
                     "date": gendate_of(e).display() if e.date_start else None, "place": place_short(e),
                     "value": value, "confidence": e.confidence})
    if p.occupation and not any(r["event_type"] == "occupation" for r in rows):
        rows.append({"event_id": None, "event_type": "occupation", "label": "Profession", "date": None, "place": None,
                     "value": p.occupation, "confidence": p.confidence})
    return rows


def people_around(db: Session, p: Person) -> list[dict]:
    out = []
    for e in sorted(_all_events_with_family(db, p), key=lambda e: e.sort_year or 9999):
        parts = participants_of(e)
        officer = officer_of(e)
        if not parts and not officer:
            continue
        out.append({"event_id": e.id, "event_type": e.event_type, "label": _event_label(e),
                    "date": gendate_of(e).display() if e.date_start else None, "place": place_short(e),
                    "officer": officer, "participants": [x for x in parts if x["role"] != "officer"]})
    return out


def _media_dict(m: Media) -> dict:
    a = m.analysis or {}
    tr = a.get("transcription") if isinstance(a.get("transcription"), str) else None
    mime = m.mime_type or ""
    return {"kind": "media", "id": m.id, "title": m.title or m.original_filename or "Document", "mime_type": mime,
            "media_kind": m.kind, "is_image": mime.startswith("image/"), "url": f"/api/media/{m.id}/file",
            "transcription": tr or m.ocr_text or None, "source_id": m.source_id}


def _source_dict(s: Source) -> dict:
    ref = " · ".join(x for x in (s.repository, s.reference, s.page) if x)
    return {"kind": "source", "id": s.id, "title": s.title, "repository": s.repository, "reference": ref or None,
            "year": s.year, "url": s.url, "reliability": s.reliability, "register_type": s.register_type,
            "transcription": s.transcription}


def _cited_sources(db: Session, p: Person) -> dict[str, list[str]]:
    """{source_id: [ids d'événements (ou '' pour la personne)]} : sources citées pour cette personne."""
    targets: list[tuple[str, str, str]] = [("person", p.id, "")]
    for e in _all_events_with_family(db, p):
        targets.append(("event", e.id, e.id))
    for f in families_of(db, p.id):
        targets.append(("family", f.id, ""))
    for r in db.execute(select(ParentChild).where(ParentChild.child_id == p.id)).scalars():
        targets.append(("parent_child", r.id, ""))
    out: dict[str, list[str]] = {}
    for tt, tid, ev in targets:
        for c in db.execute(select(Citation).where(Citation.target_type == tt, Citation.target_id == tid)).scalars():
            out.setdefault(c.source_id, [])
            if ev and ev not in out[c.source_id]:
                out[c.source_id].append(ev)
    return out


def documents(db: Session, p: Person) -> list[dict]:
    items: list[dict] = []
    seen_media: set[str] = set()
    media = list(db.execute(select(Media).where(Media.person_id == p.id)).scalars())
    for e in _all_events_with_family(db, p):
        mid = (e.attributes or {}).get("media_id")
        if isinstance(mid, str) and mid not in {m.id for m in media}:
            m = db.get(Media, mid)
            if m is not None:
                media.append(m)
    for m in media:
        if m.kind == "portrait" or m.id in seen_media:
            continue
        seen_media.add(m.id)
        items.append(_media_dict(m))
    for sid in _cited_sources(db, p):
        s = db.get(Source, sid)
        if s is not None:
            items.append(_source_dict(s))
    return items


def acts(db: Session, p: Person) -> list[dict]:
    """Actes : image + transcription, d'après Event.attributes (media_id, transcription), les sources citées et les médias."""
    out = []
    used_media: set[str] = set()
    cited = _cited_sources(db, p)
    ev_sources: dict[str, list[str]] = {}
    for sid, evs in cited.items():
        for eid in evs:
            ev_sources.setdefault(eid, []).append(sid)
    for e in sorted(_all_events_with_family(db, p), key=lambda e: (e.sort_year or 9999, e.event_type)):
        a = e.attributes or {}
        media = None
        mid = a.get("media_id")
        if isinstance(mid, str):
            media = db.get(Media, mid)
        srcs = [db.get(Source, sid) for sid in ev_sources.get(e.id, [])]
        srcs = [s for s in srcs if s is not None]
        if media is None:
            for s in srcs:
                media = db.execute(select(Media).where(Media.source_id == s.id)).scalars().first()
                if media is not None:
                    break
        transcription = _clean(a.get("transcription"))
        src_with_tr = next((s for s in srcs if s.transcription), None)
        if not transcription and src_with_tr is not None:
            transcription = src_with_tr.transcription
        if not transcription and media is not None:
            md = _media_dict(media)
            transcription = md["transcription"]
        if media is None and not transcription:
            continue
        title = ACT_TITLE.get(e.event_type, f"Acte — {_event_label(e).lower()}")
        if e.family_id:
            f = db.get(Family, e.family_id)
            names = [db.get(Person, x).display_name() for x in (f.partner1_id, f.partner2_id) if x and db.get(Person, x)] if f else []
            if names:
                title += " de " + " et ".join(names)
        else:
            title += f" de {p.display_name()}"
        md = _media_dict(media) if media is not None else None
        if md:
            used_media.add(md["id"])
        out.append({"event_id": e.id, "event_type": e.event_type, "title": title,
                    "date": gendate_of(e).display() if e.date_start else None, "place": place_short(e),
                    "act_number": _clean(a.get("act_number")), "officer": officer_of(e),
                    "image_url": md["url"] if md and md["is_image"] else None, "media_id": md["id"] if md else None,
                    "file_url": md["url"] if md else None, "transcription": transcription,
                    "source": {"id": (src_with_tr or (srcs[0] if srcs else None)).id, "title": (src_with_tr or srcs[0]).title}
                    if srcs else None})
    for m in db.execute(select(Media).where(Media.person_id == p.id)).scalars():
        if m.id in used_media or m.kind == "portrait":
            continue
        md = _media_dict(m)
        if md["transcription"] or (md["is_image"] and m.kind == "document"):
            out.append({"event_id": None, "event_type": None, "title": md["title"], "date": None, "place": None,
                        "act_number": None, "officer": None, "image_url": md["url"] if md["is_image"] else None,
                        "media_id": m.id, "file_url": md["url"], "transcription": md["transcription"], "source": None})
    return out


def research_items(db: Session, p: Person) -> list[dict]:
    items = []
    for t in db.execute(select(ResearchTask).where(ResearchTask.person_id == p.id, ResearchTask.status.in_(OPEN_TASK))).scalars():
        items.append({"kind": "task", "id": t.id, "title": t.title, "status": t.status, "link": f"/enquetes/{t.id}"})
    for q in db.execute(select(Question).where(Question.person_id == p.id, Question.status == "pending")).scalars():
        items.append({"kind": "question", "id": q.id, "title": q.title, "link": "/questions"})
    for h in db.execute(select(Hypothesis).where(Hypothesis.subject_person_id == p.id, Hypothesis.status == "open")).scalars():
        items.append({"kind": "hypothesis", "id": h.id, "title": h.title, "link": f"/personnes/{p.id}"})
    for c in db.execute(select(Contradiction).where(Contradiction.status == "open")).scalars():
        if p.id in (c.person_ids or []):
            items.append({"kind": "contradiction", "id": c.id, "title": c.description, "link": f"/personnes/{p.id}"})
    miss = missing_for(db, p)
    for m in miss["dates"] + miss["acts"]:
        items.append({"kind": "missing", "id": m["key"], "title": m["label"], "link": f"/personnes/{p.id}"})
    return items


# =====================================================================================
# Réécriture par l'IA (optionnelle, à partir des faits seulement)
# =====================================================================================

REWRITE_SYSTEM = (
    "Tu es un correcteur littéraire pour un livre de famille en français. On te donne des paragraphes biographiques "
    "écrits à la première personne, générés automatiquement à partir de faits d'archives. Réécris-les en un texte "
    "plus fluide, toujours à la première personne, en conservant STRICTEMENT les mêmes faits.\n"
    "Règles impératives :\n"
    "- N'ajoute AUCUN fait, date, lieu, nom, métier, chiffre, sentiment, motivation, anecdote ou hypothèse.\n"
    "- Ne supprime aucun fait et ne modifie aucune date, aucun lieu, aucun nom (garde les noms de famille en majuscules).\n"
    "- N'ajoute pas de contexte historique.\n"
    "- Respecte l'accord en genre déjà présent dans le texte.\n"
    "- Réponds uniquement par le texte réécrit, en paragraphes séparés par une ligne vide, sans titre ni commentaire."
)


def rewrite(db: Session, p: Person) -> dict:
    from ..ai.providers import AIClient, AIUnavailable

    client = AIClient(db)
    if not client.available():
        raise AIUnavailable("L'IA n'est pas disponible : choisissez un fournisseur dans Paramètres → Intelligence artificielle, "
                            "puis réessayez. Le texte factuel reste affiché.")
    ch = chapter(db, p, with_wiki=False)
    paragraphs = [b["text"] for b in ch["blocks"] if b["type"] == "paragraph"]
    if not paragraphs:
        raise ValueError("Aucun fait à reformuler pour cette personne.")
    facts = "\n\n".join(paragraphs)
    resp = client.complete(REWRITE_SYSTEM, f"Faits (texte à réécrire) :\n\n{facts}", purpose="livre : reformulation d'une biographie",
                           personal=True, max_tokens=2500)
    text = (resp.text or "").strip()
    if not text:
        raise AIUnavailable("L'IA n'a renvoyé aucun texte.")
    value = {"text": text, "provider": resp.provider, "model": resp.model, "facts_hash": ch["facts_hash"],
             "created_at": datetime.now(timezone.utc).isoformat(), "facts": paragraphs}
    row = db.get(Setting, story_key(p.id))
    if row is None:
        db.add(Setting(key=story_key(p.id), value=value, encrypted=False))
    else:
        row.value = value
    db.flush()
    return {**value, "stale": False, "label": "Texte reformulé par l'IA à partir des faits ci-dessous"}


def delete_rewrite(db: Session, person_id: str) -> bool:
    row = db.get(Setting, story_key(person_id))
    if row is None:
        return False
    db.delete(row)
    db.flush()
    return True


# =====================================================================================
# Annexes
# =====================================================================================

def trades_annex(db: Session, with_wiki: bool = True, budget_seconds: float = 8.0) -> list[dict]:
    _fresh(db)
    sosa = sosa_map(db)
    budget = wiki.Budget(budget_seconds) if with_wiki else None
    groups: dict[str, dict] = {}
    for p in db.execute(select(Person)).scalars():
        for o in _occupations(p):
            t = lookup_trade(o["label"])
            key = t["key"] if t else o["label"].strip().lower()
            if key == "sans profession":
                continue
            gr = groups.setdefault(key, {"key": key, "label": t["label"] if t else cap(o["label"].strip()),
                                         "in_dictionary": bool(t), "definition": t["definition"] if t else None,
                                         "description": t["description"] if t else None, "category": t["category"] if t else None,
                                         "origin": "Définition — dictionnaire des métiers anciens GENEALIS" if t else None,
                                         "forms": [], "persons": [], "wiki": None})
            if o["label"] not in gr["forms"]:
                gr["forms"].append(o["label"])
            if p.id not in {x["id"] for x in gr["persons"]}:
                ref = _person_ref(p, sosa)
                ref["years_mentioned"] = o["years"]
                gr["persons"].append(ref)
    out = sorted(groups.values(), key=lambda g_: g_["label"].lower())
    for gr in out:
        gr["persons"].sort(key=lambda x: (min(x["sosa"] or [10 ** 12]), x["name"]))
        gr["family_line"] = "Dans la famille : " + "; ".join(
            x["name"] + (f" ({x['years']})" if x["years"] else "") for x in gr["persons"]) + "."
        if with_wiki and budget is not None and budget.ok():
            gr["wiki"] = wiki.trade_context(db, gr["label"], budget=budget)
        elif with_wiki:
            gr["wiki"] = wiki.cached_only(db, "trade", gr["label"][:1].upper() + gr["label"][1:])
    return out


def places_annex(db: Session, with_wiki: bool = True, budget_seconds: float = 10.0) -> list[dict]:
    _fresh(db)
    sosa = sosa_map(db)
    budget = wiki.Budget(budget_seconds) if with_wiki else None
    groups: dict[str, dict] = {}
    rows = db.execute(select(Event).where(Event.place_id.is_not(None))).scalars().all()
    fam_partners: dict[str, list[str]] = {}
    for f in db.execute(select(Family)).scalars():
        fam_partners[f.id] = [x for x in (f.partner1_id, f.partner2_id) if x]
    for e in rows:
        pl = e.place
        if pl is None:
            continue
        gr = groups.setdefault(pl.id, {"place_id": pl.id, "name": pl.name, "department": pl.department, "region": pl.region,
                                       "country": pl.country, "lat": pl.latitude, "lon": pl.longitude,
                                       "historical_names": pl.historical_names or [], "years": [], "persons": {}})
        if e.sort_year:
            gr["years"].append(e.sort_year)
        pids = [e.person_id] if e.person_id else fam_partners.get(e.family_id or "", [])
        for pid in pids:
            per = gr["persons"].setdefault(pid, {"events": []})
            lbl = _event_label(e).lower()
            per["events"].append({"label": lbl, "year": e.sort_year})
    out = []
    for gr in sorted(groups.values(), key=lambda x: (x["name"] or "").lower()):
        ys = sorted(gr["years"])
        start, end = (ys[0], ys[-1]) if ys else (None, None)
        anc = []
        for pid, info in gr["persons"].items():
            p = db.get(Person, pid)
            if p is None:
                continue
            evs = sorted(info["events"], key=lambda x: x["year"] or 9999)
            detail = " · ".join(f"{x['label']} {x['year']}" if x["year"] else x["label"] for x in evs)
            anc.append({"id": p.id, "name": p.display_name(), "sex": p.sex, "sosa": sosa.get(p.id, []), "detail": detail,
                        "first_year": evs[0]["year"] if evs else None})
        anc.sort(key=lambda x: (0 if x["sosa"] else 1, x["first_year"] or 9999, x["name"]))
        regions = region_of(gr["department"], gr["region"], gr["country"])
        timeline = []
        if start is not None:
            lo, hi = start - 10, end + 10
            pool = [{**e, "origin": "Repères régionaux GENEALIS"} for e in REGIONAL_TIMELINE] + \
                   [{**e, "text": None, "origin": "Événements historiques GENEALIS"} for e in HISTORICAL_EVENTS]
            seen = set()
            for e in sorted(pool, key=lambda e: (regions.index(e["region"]) if e["region"] in regions else 99, e["start"])):
                if e["region"] in regions and e["end"] >= lo and e["start"] <= hi and e["label"] not in seen:
                    seen.add(e["label"])
                    timeline.append({"start": e["start"], "end": e["end"], "label": e["label"], "text": e.get("text"),
                                     "origin": e["origin"]})
            timeline = sorted(timeline[:3], key=lambda e: e["start"])
        w_ctx = None
        if with_wiki and budget is not None and budget.ok():
            w_ctx = wiki.place_context(db, gr["name"], gr["department"], budget=budget)
        elif with_wiki:
            w_ctx = wiki.cached_only(db, "place", f"{gr['name']} ({gr['department']})" if gr["department"] and gr["department"].lower() not in (gr["name"] or "").lower() else gr["name"])
        out.append({**{k: v for k, v in gr.items() if k not in ("persons", "years")}, "year_start": start, "year_end": end,
                    "ancestors": anc,
                    "ancestors_line": "Ancêtres : " + " ; ".join(f"{a['name']} ({a['detail']})" if a["detail"] else a["name"] for a in anc) + ".",
                    "timeline": timeline, "wiki": w_ctx})
    return out
