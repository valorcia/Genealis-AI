"""Interprétation d'un document lu par l'IA : propositions explicables que l'utilisateur valide, puis application.

Principes :
- rien n'est écrit dans l'arbre sans validation (les propositions sont cochées par défaut uniquement si elles sont sûres) ;
- une identité n'est jamais déduite du seul patronyme (score explicable de `matching`) ;
- une date de l'acte différente de celle de l'arbre devient une « contradiction à vérifier » (question + hypothèse),
  jamais un écrasement silencieux ;
- les propositions sont déterministes pour une analyse donnée et stockées dans Media.analysis["proposals"].
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Citation, Event, Family, Hypothesis, Media, ParentChild, Person, Question, Source, utcnow
from ..schemas import EventIn, PersonIn, RelativeIn
from .gendate import GenDate, parse_gendate
from .journal import log
from .matching import Candidate, MatchResult, find_matches, score_candidate
from .names import name_similarity, normalize_name
from .persons import (add_event, add_relative, children_of, create_person, families_of, find_or_create_family,
                      index_person, parents_of, siblings_of, spouses_of)

PROPOSALS_VERSION = 3

DOC_LABEL = {"birth": "Acte de naissance", "baptism": "Acte de baptême", "marriage": "Acte de mariage",
             "death": "Acte de décès", "burial": "Acte de sépulture", "census": "Recensement de population",
             "military_register": "Registre matricule militaire", "decennial_table": "Table décennale",
             "death_notice": "Faire-part de décès", "family_photo": "Photographie de famille", "other": "Document"}
PRIMARY_DOCS = {"birth", "baptism", "marriage", "death", "burial", "census", "military_register"}
DOC_EVENT = {"birth": "birth", "baptism": "baptism", "marriage": "marriage", "death": "death", "burial": "burial",
             "death_notice": "death", "military_register": "military"}
EVENT_FR = {"birth": "Naissance", "baptism": "Baptême", "marriage": "Mariage", "death": "Décès", "burial": "Inhumation",
            "residence": "Domicile", "occupation": "Profession", "military": "Service militaire", "census": "Recensement"}
SINGLE_EVENTS = {"birth", "baptism", "death", "burial", "marriage", "military"}
REGISTER_TYPE = {"birth": "état civil — naissances", "baptism": "registre paroissial — baptêmes",
                 "marriage": "état civil — mariages", "death": "état civil — décès", "burial": "registre paroissial — sépultures",
                 "census": "recensement", "military_register": "registre matricule", "decennial_table": "table décennale",
                 "death_notice": "faire-part", "family_photo": "photographie"}
ROLE_FR = {"subject": "personne principale", "father": "père", "mother": "mère", "spouse": "conjoint(e)",
           "spouse_father": "père du conjoint", "spouse_mother": "mère du conjoint", "witness": "témoin",
           "declarant": "déclarant", "godfather": "parrain", "godmother": "marraine", "deceased": "défunt(e)",
           "head_of_household": "chef de ménage", "household_member": "membre du ménage", "other": "autre"}
MAJOR_ROLES = {"subject", "father", "mother", "spouse", "spouse_father", "spouse_mother", "deceased", "head_of_household"}
PRINCIPAL_ROLES = ("subject", "deceased", "head_of_household", "spouse")
_PLACEHOLDER_SURNAMES = {"id", "id.", "idem", "do", "d°", "d.", "-", "—", "\"", "''", "»", "«"}
KIN_FR = {"parent": "parent", "child": "enfant", "spouse": "conjoint(e)", "sibling": "frère ou sœur"}


# ------------------------------------------------------------------ outils

def _fp(analysis: dict, person_id: Optional[str]) -> str:
    ex = analysis.get("extraction") or {}
    raw = json.dumps({"v": PROPOSALS_VERSION, "ex": ex, "t": (analysis.get("transcription") or "")[:5000], "p": person_id},
                     sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _full(given: Optional[str], surname: Optional[str]) -> str:
    return " ".join(x for x in (given or "", (surname or "").upper()) if x).strip()


def kin_of(relation: Optional[str]) -> Optional[str]:
    """Lien déclaré (« fils », « épouse », « sa mère »…) → parent | child | spouse | sibling | head | None."""
    if not relation:
        return None
    from unidecode import unidecode

    t = unidecode(relation.lower()).strip()
    t = re.sub(r"^(sa|son|ses|le|la|les|du|de la|de l')\s+", "", t)
    if t.startswith(("petit", "arriere")):
        return None
    if t.startswith(("beau", "belle", "gendre", "bru")):
        return None
    if t.startswith(("chef", "head")):
        return "head"
    if t.startswith(("fils", "fille", "enfant")):
        return "child"
    if t.startswith(("epouse", "epoux", "femme", "mari", "conjoint", "veuve", "veuf", "wife", "husband")):
        return "spouse"
    if t.startswith(("pere", "mere", "father", "mother")):
        return "parent"
    if t.startswith(("frere", "soeur", "brother", "sister")):
        return "sibling"
    return None


def _sex_from_relation(relation: Optional[str]) -> Optional[str]:
    if not relation:
        return None
    from unidecode import unidecode

    t = unidecode(relation.lower())
    t = re.sub(r"^(sa|son|ses)\s+", "", t.strip())
    if t.startswith(("fils", "frere", "pere", "epoux", "mari", "veuf", "beau-", "gendre", "neveu", "oncle", "petit-fils", "domestique (h")):
        return "M"
    if t.startswith(("fille", "soeur", "mere", "epouse", "femme", "veuve", "belle", "bru", "niece", "tante", "petite-fille", "servante")):
        return "F"
    return None


def _year(gd: Optional[dict]) -> Optional[int]:
    return gd.get("sort_year") if isinstance(gd, dict) else None


def _first_seg(place: Optional[str]) -> Optional[str]:
    return place.split(",")[0].strip() if place else None


def _place_compatible(a: Optional[str], b: Optional[str]) -> bool:
    if not a or not b:
        return True
    na, nb = normalize_name(_first_seg(a)), normalize_name(_first_seg(b))
    if not na or not nb or na == nb or na in nb or nb in na:
        return True
    return name_similarity(na, nb) >= 80


def dates_compatible(e: Event, gd: GenDate) -> bool:
    """Vrai si la date de l'arbre et celle du document peuvent désigner le même événement."""
    if not e.sort_year or not gd.sort_year:
        return True
    ey, gy = e.sort_year, gd.sort_year
    if e.date_kind == "before":
        return gy <= ey
    if e.date_kind == "after":
        return gy >= ey
    if e.date_kind == "between" and e.date_end:
        try:
            return ey <= gy <= int(e.date_end[:4])
        except ValueError:
            return True
    if gd.kind == "before":
        return ey <= gy
    if gd.kind == "after":
        return ey >= gy
    loose = {"approx", "calculated", "unknown"}
    if e.date_kind in loose or gd.kind in loose:
        return abs(ey - gy) <= 2
    if ey != gy:
        return False
    a, b = e.date_start or "", gd.start or ""
    n = min(len(a), len(b))
    return a[:n] == b[:n]


def _more_precise(e: Event, gd: GenDate) -> bool:
    if gd.kind != "exact" or not gd.start:
        return False
    if not e.date_start or e.date_kind in ("unknown", "approx", "calculated"):
        return True
    return len(gd.start) > len(e.date_start)


def _excerpt(transcription: str, *needles: Optional[str], width: int = 160) -> Optional[str]:
    t = transcription or ""
    if not t.strip():
        return None
    low = t.lower()
    for n in needles:
        if n and len(n) > 2:
            i = low.find(n.lower())
            if i != -1:
                a, b = max(0, i - width), min(len(t), i + len(n) + width)
                return ("…" if a else "") + t[a:b].strip().replace("\n", " ") + ("…" if b < len(t) else "")
    return t[:2 * width].strip().replace("\n", " ") + ("…" if len(t) > 2 * width else "")


def _elide(text: str) -> str:
    """« de Anna » → « d'Anna » (devant un nom commençant par une voyelle)."""
    return re.sub(r"\b([Dd])e ([AEIOUYÉÈÊÀÂÎÔ])", r"\1'\2", text)


def _when(date: Optional[str], written: Optional[str] = None, quote: bool = True) -> Optional[str]:
    """Date lisible (12/04/1956) suivie de la forme écrite dans l'acte quand elle diffère."""
    gd = parse_gendate(date)
    if gd.kind == "unknown":
        return written or date
    shown = gd.display()
    if quote and written and written.strip() != (date or "").strip() and not re.match(r"^[\d/ .-]+$", written.strip()):
        shown += f" (« {written.strip()} »)"
    return shown


# ------------------------------------------------------------------ personnes extraites

def extract_people(ex: dict) -> list[dict]:
    """Liste plate et stable des personnes citées (acte, ménages de recensement, entrées de table)."""
    doc = ex.get("document_type") or "other"
    people: list[dict] = []
    for p in ex.get("persons") or []:
        people.append({**p, "household": None, "entry": None})
    seen = {(normalize_name(p.get("given_names")), normalize_name(p.get("surname")), p.get("age")) for p in people}
    for hi, h in enumerate(ex.get("households") or []):
        head_surname = None
        for mi, m in enumerate(h.get("members") or []):
            rel = m.get("relation_to_head") or m.get("relation")
            kin = kin_of(rel)
            is_head = kin == "head" or (mi == 0 and not any(kin_of(x.get("relation_to_head")) == "head" for x in h["members"]))
            q = {**m, "role": "head_of_household" if is_head else "household_member", "relation": rel,
                 "residence": h.get("address") or m.get("residence"), "household": hi, "entry": None}
            sn = (q.get("surname") or "").strip().lower()
            if (not sn or sn in _PLACEHOLDER_SURNAMES) and head_surname and not is_head:
                if kin == "spouse" and (q.get("sex") or _sex_from_relation(rel)) == "F":
                    q["surname"] = None
                    q["married_name"] = head_surname
                else:
                    q["surname"] = head_surname
                q["surname_inherited"] = True
            if is_head:
                head_surname = q.get("surname")
            key = (normalize_name(q.get("given_names")), normalize_name(q.get("surname")), q.get("age"))
            if key in seen and doc == "census":
                # déjà présent dans « persons » : on remplace par la version « ménage », plus riche
                people = [x for x in people if (normalize_name(x.get("given_names")), normalize_name(x.get("surname")), x.get("age")) != key]
            seen.add(key)
            people.append(q)
    for ei, e in enumerate(ex.get("entries") or []):
        people.append({"role": "subject", "given_names": e.get("given_names"), "surname": e.get("surname"), "sex": None,
                       "age": None, "confidence": "medium", "household": None, "entry": ei,
                       "relation": None, "entry_event": e.get("event_type"), "entry_date": e.get("date_iso") or e.get("date"),
                       "entry_date_written": e.get("date"), "spouse_name": e.get("spouse")})
    for i, p in enumerate(people):
        p["index"] = i
    return people


@dataclass
class Ctx:
    db: Session
    media: Media
    ex: dict
    transcription: str
    doc: str
    year: Optional[int]
    place: Optional[str]
    people: list[dict]
    subject: Optional[int] = None
    spouse: Optional[int] = None
    anchors: dict[int, tuple[int, str]] = field(default_factory=dict)  # idx -> (idx ancre, parent|child|spouse|sibling)
    heads: dict[int, int] = field(default_factory=dict)  # ménage -> idx du chef
    resolution: dict[int, dict] = field(default_factory=dict)
    checked_person: dict[int, bool] = field(default_factory=dict)
    actions: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _infer_roles(ctx: Ctx) -> None:
    ppl = ctx.people
    first = lambda *roles: next((p["index"] for p in ppl if p["role"] in roles and p.get("entry") is None), None)  # noqa: E731
    death_doc = ctx.doc in ("death", "burial", "death_notice")
    ctx.subject = first("deceased") if death_doc and first("deceased") is not None else first("subject", "deceased")
    ctx.spouse = first("spouse")
    for p in ppl:
        i, role = p["index"], p["role"]
        if p.get("household") is not None and role == "head_of_household":
            ctx.heads[p["household"]] = i
    for p in ppl:
        i, role = p["index"], p["role"]
        if p.get("household") is not None:
            head = ctx.heads.get(p["household"])
            kin = kin_of(p.get("relation"))
            if head is not None and i != head and kin in ("parent", "child", "spouse", "sibling"):
                ctx.anchors[i] = (head, kin)
            continue
        if p.get("entry") is not None:
            continue
        if role in ("father", "mother") and ctx.subject is not None:
            ctx.anchors[i] = (ctx.subject, "parent")
        elif role == "spouse" and ctx.subject is not None and i != ctx.subject:
            ctx.anchors[i] = (ctx.subject, "spouse")
        elif role in ("spouse_father", "spouse_mother") and ctx.spouse is not None:
            ctx.anchors[i] = (ctx.spouse, "parent")
        elif role in ("other", "household_member", "witness", "declarant") and ctx.subject is not None and i != ctx.subject:
            kin = kin_of(p.get("relation"))
            if kin in ("parent", "child", "spouse", "sibling") and (role in ("other", "household_member") or ctx.doc == "death_notice"):
                ctx.anchors[i] = (ctx.subject, kin)
    # Sexe : explicite, sinon déduit du rôle ou du lien (jamais du prénom)
    for p in ppl:
        if p.get("sex"):
            continue
        role = p["role"]
        s = {"father": "M", "spouse_father": "M", "godfather": "M", "mother": "F", "spouse_mother": "F", "godmother": "F"}.get(role)
        if not s:
            s = _sex_from_relation(p.get("relation"))
        if not s and ctx.doc == "marriage" and p["index"] == ctx.subject:
            s = "M"
        if not s and ctx.doc == "marriage" and p["index"] == ctx.spouse:
            subj = ppl[ctx.subject] if ctx.subject is not None else None
            s = "F" if not subj or subj.get("sex") != "F" else "M"
        if s:
            p["sex"] = s
            p["sex_inferred"] = True


def _role_label(ctx: Ctx, p: dict) -> str:
    role = p["role"]
    if p.get("household") is not None:
        return "chef de ménage" if role == "head_of_household" else (p.get("relation") or "membre du ménage")
    if p.get("entry") is not None:
        return f"{EVENT_FR.get(p.get('entry_event') or '', 'acte')} (table)"
    if ctx.doc == "marriage":
        sp = {"subject": "époux", "spouse": "épouse", "father": "père de l'époux", "mother": "mère de l'époux",
              "spouse_father": "père de l'épouse", "spouse_mother": "mère de l'épouse"}
        if role in sp:
            lab = sp[role]
            subj = ctx.people[ctx.subject] if ctx.subject is not None else None
            if subj and subj.get("sex") == "F":  # mariage décrit depuis l'épouse
                lab = lab.replace("époux", "§").replace("épouse", "époux").replace("§", "épouse")
            return lab
    if role == "subject":
        return {"birth": "enfant", "baptism": "baptisé(e)", "military_register": "conscrit", "death": "défunt(e)",
                "burial": "défunt(e)", "death_notice": "défunt(e)"}.get(ctx.doc, "personne principale")
    lab = ROLE_FR.get(role, role)
    if p.get("relation") and role in ("other", "witness", "declarant"):
        lab += f" ({p['relation']})"
    return lab


def _name(p: dict) -> str:
    n = _full(p.get("given_names"), p.get("surname"))
    if not p.get("surname") and p.get("married_name"):
        n = f"{p.get('given_names') or ''} (épouse {p['married_name'].upper()})".strip()
    return n or "(nom illisible)"


def _candidate(ctx: Ctx, p: dict, *, drop_surname: bool = False) -> Candidate:
    i = p["index"]
    by = p.get("birth_year") or _year(p.get("birth_date_normalized"))
    cand = Candidate(surname=None if drop_surname else (p.get("surname") or p.get("married_name")),
                     given_names=p.get("given_names"), sex=p.get("sex"), birth_year=by,
                     birth_place=p.get("birth_place"), event_year=ctx.year, event_place=ctx.place,
                     age_at_event=p.get("age") if by is None else None, occupation=p.get("occupation"),
                     residence=p.get("residence") if ctx.doc != "census" else (ctx.place or p.get("residence")),
                     extra={"event_type": DOC_EVENT.get(ctx.doc, ctx.doc)})
    ppl = ctx.people
    by_role = {q["role"]: q for q in reversed(ppl) if q.get("household") is None and q.get("entry") is None}
    if i == ctx.subject:
        f, m, s = by_role.get("father"), by_role.get("mother"), by_role.get("spouse")
    elif i == ctx.spouse:
        f, m = by_role.get("spouse_father"), by_role.get("spouse_mother")
        s = ppl[ctx.subject] if ctx.subject is not None else None
    else:
        f = m = s = None
    if p.get("household") is not None:
        hh = [q for q in ppl if q.get("household") == p["household"]]
        if p["role"] == "head_of_household":
            s = next((q for q in hh if kin_of(q.get("relation")) == "spouse"), None)
            cand.children_names = [q["given_names"] for q in hh if kin_of(q.get("relation")) == "child" and q.get("given_names")]
        elif kin_of(p.get("relation")) == "spouse":
            s = ppl[ctx.heads[p["household"]]] if p["household"] in ctx.heads else None
    if f:
        cand.father_name = _full(f.get("given_names"), f.get("surname")) or None
    if m:
        cand.mother_name = _full(m.get("given_names"), m.get("surname")) or None
    if s:
        cand.spouse_name = _full(s.get("given_names"), s.get("surname") or s.get("married_name")) or None
    if (i == ctx.subject and ctx.doc in ("death", "burial", "death_notice")) or p["role"] == "deceased":
        cand.death_year = _year(ctx.ex.get("event_date_normalized")) or ctx.year
        cand.extra["event_type"] = "death"
    if p.get("entry") is not None:
        gd = parse_gendate(p.get("entry_date"))
        cand.event_year = gd.sort_year
        if p.get("entry_event") == "birth":
            cand.birth_year = gd.sort_year
        elif p.get("entry_event") == "death":
            cand.death_year = gd.sort_year
            cand.extra["event_type"] = "death"
        if p.get("spouse_name"):
            cand.spouse_name = p["spouse_name"]
    return cand


def _match_dict(db: Session, r: MatchResult, context: Optional[str] = None) -> dict:
    p = db.get(Person, r.person_id)
    by = next((e.sort_year for e in p.events if e.event_type in ("birth", "baptism") and e.sort_year), None) if p else None
    dy = next((e.sort_year for e in p.events if e.event_type in ("death", "burial") and e.sort_year), None) if p else None
    bp = next(((e.place.name if e.place else e.place_original) for e in p.events if e.event_type in ("birth", "baptism")), None) if p else None
    return {"person_id": r.person_id, "name": p.display_name() if p else "?", "total": round(r.total, 1), "level": r.level,
            "criteria": [{"label": c.label, "score": round(c.score * 100), "weight": c.weight, "detail": c.detail} for c in r.criteria],
            "blocking": list(r.blocking), "birth_year": by, "death_year": dy, "birth_place": bp, "context": context}


def _relatives(db: Session, person_id: str, kin: str, sex: Optional[str]) -> list[Person]:
    if kin == "parent":
        return [p for p, r in parents_of(db, person_id) if r.relation_type in ("biological", "uncertain") and (not sex or not p.sex or p.sex == sex)]
    if kin == "child":
        return [c for c, _ in children_of(db, person_id)]
    if kin == "spouse":
        return spouses_of(db, person_id)
    if kin == "sibling":
        return siblings_of(db, person_id)
    return []


def _resolve_people(ctx: Ctx) -> None:
    db, ppl = ctx.db, ctx.people
    used: set[str] = set()
    pinned_person = db.get(Person, ctx.media.person_id) if ctx.media.person_id else None
    pinned_idx: Optional[int] = None
    pinned_res: Optional[MatchResult] = None
    if pinned_person is not None:
        best: Optional[tuple[float, int, MatchResult]] = None
        for p in ppl:
            if p["role"] not in PRINCIPAL_ROLES and p["role"] != "household_member" and p.get("entry") is None:
                continue
            if not (p.get("given_names") or p.get("surname")):
                continue
            r = score_candidate(db, _candidate(ctx, p), pinned_person)
            if r.blocking:
                continue
            bonus = 5 if p["index"] == ctx.subject else 0
            if best is None or r.total + bonus > best[0]:
                best = (r.total + bonus, p["index"], r)
        if best is not None and best[2].total >= 35:
            pinned_idx, pinned_res = best[1], best[2]
    principals = [p["index"] for p in ppl if p["role"] in PRINCIPAL_ROLES or p["index"] == pinned_idx]
    order = sorted(range(len(ppl)), key=lambda i: (0 if i == pinned_idx else 1 if i in principals and i not in ctx.anchors else 2 if i in principals else 3, i))
    # les ancres d'abord : un parent est résolu après la personne à laquelle il se rattache
    resolved_order: list[int] = []
    pending = list(order)
    while pending:
        progressed = False
        for i in list(pending):
            anc = ctx.anchors.get(i)
            if anc is None or anc[0] in resolved_order or anc[0] not in pending:
                resolved_order.append(i)
                pending.remove(i)
                progressed = True
        if not progressed:
            resolved_order.extend(pending)
            break
    for i in resolved_order:
        p = ppl[i]
        res: dict[str, Any] = {"resolution": "ignore", "person_id": None, "matches": [], "reason": None, "tree_conflict": None}
        ctx.resolution[i] = res
        if not (p.get("given_names") or p.get("surname") or p.get("married_name")):
            res["reason"] = "Nom illisible ou absent : personne seulement mentionnée."
            continue
        cand = _candidate(ctx, p)
        matches: list[dict] = []
        if i == pinned_idx and pinned_res is not None and pinned_person is not None:
            matches.append(_match_dict(db, pinned_res, "Personne choisie à l'import"))
            res.update(resolution="match", person_id=pinned_person.id,
                       reason=f"Vous avez indiqué que ce document concerne {pinned_person.display_name()} "
                              f"(concordance {pinned_res.total:.0f} %).")
            used.add(pinned_person.id)
            res["matches"] = matches
            continue
        # Contexte familial : la personne d'ancrage est déjà dans l'arbre avec ce lien
        anc = ctx.anchors.get(i)
        context_hit: Optional[tuple[MatchResult, Person]] = None
        if anc is not None:
            ares = ctx.resolution.get(anc[0]) or {}
            if ares.get("person_id"):
                anchor_person = db.get(Person, ares["person_id"])
                rels = _relatives(db, ares["person_id"], anc[1], p.get("sex")) if anchor_person else []
                for rp in rels:
                    if rp.id in used:
                        continue
                    r = score_candidate(db, _candidate(ctx, p, drop_surname=bool(p.get("surname_inherited"))), rp)
                    # Le lien déjà présent dans l'arbre est lui-même un indice fort : des noms concordants suffisent ici
                    names = [c for c in r.criteria if c.name in ("surname", "given_names")]
                    names_ok = bool(names) and any(c.name == "given_names" for c in names) and all(c.score >= 0.8 for c in names)
                    if not r.blocking and (r.total >= 50 or names_ok):
                        if context_hit is None or r.total > context_hit[0].total:
                            context_hit = (r, rp)
                    elif anc[1] == "parent" and r.blocking and any(b.startswith(("Prénoms", "Patronymes")) for b in r.blocking):
                        res["tree_conflict"] = {"person_id": rp.id, "name": rp.display_name(),
                                                "kin": "père" if (p.get("sex") or rp.sex) == "M" else "mère",
                                                "anchor": anchor_person.display_name() if anchor_person else ""}
                if context_hit is not None:
                    r, rp = context_hit
                    kin_txt = KIN_FR.get(anc[1], anc[1])
                    matches.append(_match_dict(db, r, f"Déjà relié(e) comme {kin_txt} de {anchor_person.display_name()} dans l'arbre"))
                    res["tree_conflict"] = None
        if cand.surname and (cand.given_names or cand.birth_year):
            found = [m for m in find_matches(db, cand, min_total=30) if not m.blocking and m.person_id not in used]
            found.sort(key=lambda m: (-round(m.total, 1), m.person_id))
            for m in found:
                if context_hit is not None and m.person_id == context_hit[1].id:
                    continue
                matches.append(_match_dict(db, m))
                if len(matches) >= 3:
                    break
        res["matches"] = matches[:3]
        if context_hit is not None:
            r, rp = context_hit
            res.update(resolution="match", person_id=rp.id, reason=matches[0]["context"] + f" (concordance {r.total:.0f} %).")
            used.add(rp.id)
            continue
        if matches:
            top = matches[0]
            second = matches[1]["total"] if len(matches) > 1 else 0
            if top["level"] == "green" and top["total"] - second >= 10:
                res.update(resolution="match", person_id=top["person_id"],
                           reason=f"Correspondance forte avec {top['name']} ({top['total']:.0f} %) : "
                                  + ", ".join(c["label"].lower() for c in top["criteria"] if c["score"] >= 80) + ".")
                used.add(top["person_id"])
                continue
            if top["total"] >= 50:
                why = "plusieurs personnes possibles" if top["level"] == "green" else f"concordance moyenne ({top['total']:.0f} %)"
                res.update(resolution="weak", person_id=top["person_id"],
                           reason=f"Peut-être {top['name']} : {why}. À vérifier avant de relier.")
                continue
        res.update(resolution="new", reason="Aucune personne correspondante dans l'arbre." if not matches else
                   f"Ressemblance trop faible avec {matches[0]['name']} ({matches[0]['total']:.0f} %) : nouvelle fiche proposée.")


# ------------------------------------------------------------------ actions

def _add_action(ctx: Ctx, aid: str, kind: str, group: str, label: str, *, detail: Optional[str] = None,
                requires: list[int] | None = None, recommended: bool = True, mode: Optional[str] = None,
                payload: dict | None = None, conflict: dict | None = None) -> dict:
    requires = sorted(set(requires or []))
    label = _elide(label)
    if any(a["id"] == aid for a in ctx.actions):
        return next(a for a in ctx.actions if a["id"] == aid)
    checked = recommended and all(ctx.checked_person.get(i, False) for i in requires)
    a = {"id": aid, "kind": kind, "group": group, "label": label, "detail": detail, "requires": requires,
         "recommended": recommended, "checked": checked, "mode": mode, "payload": payload or {}, "conflict": conflict}
    ctx.actions.append(a)
    return a


def _existing_person(ctx: Ctx, i: Optional[int]) -> Optional[Person]:
    if i is None:
        return None
    pid = (ctx.resolution.get(i) or {}).get("person_id")
    if pid and (ctx.resolution[i]["resolution"] in ("match", "weak")):
        return ctx.db.get(Person, pid)
    return None


def _event_mode(ctx: Ctx, holder_events: list[Event], etype: str, date: Optional[str], place: Optional[str]) -> tuple[str, Optional[dict]]:
    gd = parse_gendate(date)
    same = [e for e in holder_events if e.event_type == etype]
    if not same:
        return "add", None
    if etype not in SINGLE_EVENTS:
        if any(e.sort_year == gd.sort_year and _place_compatible(e.place_original or (e.place.name if e.place else None), place) for e in same):
            return "complete", None
        return "add", None
    e = same[0]
    eplace = e.place.display() if e.place else e.place_original
    if dates_compatible(e, gd) and _place_compatible(eplace, place):
        return "complete", None
    return "conflict", {"tree": {"event_id": e.id, "date": e.date_original or e.date_start, "place": eplace},
                        "document": {"date": date, "place": place}}


def _participants(ctx: Ctx, only: Optional[list[int]] = None) -> list[dict]:
    out = []
    for p in ctx.people:
        if only is not None and p["index"] not in only:
            continue
        if p.get("entry") is not None:
            continue
        out.append({"name": _name(p), "role": p["role"], "role_label": _role_label(ctx, p), "age": p.get("age"),
                    "occupation": p.get("occupation"), "residence": p.get("residence"), "relation": p.get("relation"),
                    "index": p["index"]})
    return out


def _event_action(ctx: Ctx, aid: str, etype: str, *, idx: Optional[int] = None, couple: Optional[tuple[int, int]] = None,
                  date: Optional[str] = None, date_written: Optional[str] = None, place: Optional[str] = None,
                  description: Optional[str] = None, main: bool = False, recommended: bool = True,
                  participants_of: Optional[list[int]] = None, extra_attrs: dict | None = None) -> None:
    holder_events: list[Event] = []
    who = ""
    requires: list[int] = []
    if couple is not None:
        a, b = couple
        requires = [a, b]
        pa, pb = _existing_person(ctx, a), _existing_person(ctx, b)
        if pa and pb:
            for f in families_of(ctx.db, pa.id):
                if {f.partner1_id, f.partner2_id} == {pa.id, pb.id}:
                    holder_events = list(f.events)
        who = f"{_name(ctx.people[a])} et {_name(ctx.people[b])}"
    elif idx is not None:
        requires = [idx]
        pe = _existing_person(ctx, idx)
        holder_events = list(pe.events) if pe else []
        who = _name(ctx.people[idx])
    mode, conflict = _event_mode(ctx, holder_events, etype, date, place)
    gdl = parse_gendate(date)
    when = (("le " if gdl.kind == "exact" and gdl.start and len(gdl.start) == 10 else "") + gdl.display()) if gdl.kind != "unknown" else date_written
    bits = [x for x in (when, place and f"à {place}") if x]
    label = f"{EVENT_FR.get(etype, etype)} de {who}" + (f" — {', '.join(bits)}" if bits else "")
    if mode == "complete":
        label = f"Compléter : {label} (déjà dans l'arbre, ajout de la source)"
    group = "events"
    if mode == "conflict":
        group = "verify"
        t, d = conflict["tree"], conflict["document"]
        label = (f"Contradiction à vérifier : {EVENT_FR.get(etype, etype).lower()} de {who} — l'acte indique "
                 f"{_when(d['date'], date_written, quote=False) or '?'}{(' à ' + d['place']) if d['place'] else ''}, l'arbre indique "
                 f"{t['date'] or '?'}{(' à ' + t['place']) if t['place'] else ''}")
        description = "L'arbre ne sera pas modifié : une question « contradiction à vérifier » sera créée."
    payload = {"event_type": etype, "idx": idx, "couple": list(couple) if couple else None, "date": date,
               "date_written": date_written, "place": place, "description": description, "main": main,
               "participants_of": participants_of, "extra_attrs": extra_attrs or {}}
    _add_action(ctx, aid, "event", group, label, detail=description, requires=requires, recommended=recommended,
                mode=mode, payload=payload, conflict=conflict)


def _relation_action(ctx: Ctx, kin: str, a: int, b: int, *, recommended: bool = True, note: Optional[str] = None) -> None:
    """kin=parent : a parent de b ; spouse : a et b en couple ; sibling : a et b frères/sœurs."""
    pa, pb = ctx.people[a], ctx.people[b]
    ea, eb = _existing_person(ctx, a), _existing_person(ctx, b)
    mode = "add"
    conflict = None
    if kin == "parent":
        aid = f"rel:parent:{a}:{b}"
        role = "père" if pa.get("sex") == "M" else "mère" if pa.get("sex") == "F" else "parent"
        label = f"{_name(pa)} est le {role} de {_name(pb)}" if role == "père" else f"{_name(pa)} est la {role} de {_name(pb)}" if role == "mère" else f"{_name(pa)} est parent de {_name(pb)}"
        if ea and eb and ctx.db.execute(select(ParentChild).where(ParentChild.parent_id == ea.id, ParentChild.child_id == eb.id)).scalars().first():
            mode = "exists"
        elif eb:
            others = [p for p, r in parents_of(ctx.db, eb.id) if r.relation_type in ("biological", "uncertain")
                      and p.sex and p.sex == pa.get("sex") and (not ea or p.id != ea.id)]
            if others:
                mode = "conflict"
                conflict = {"tree": {"person_id": others[0].id, "name": others[0].display_name()},
                            "document": {"name": _name(pa)}}
                label = (f"Contradiction à vérifier : l'arbre indique {others[0].display_name()} comme {role} de "
                         f"{eb.display_name()}, le document indique {_name(pa)}")
    elif kin == "spouse":
        x, y = sorted((a, b))
        aid = f"rel:union:{x}:{y}"
        label = f"{_name(pa)} et {_name(pb)} forment un couple"
        if ea and eb and any({f.partner1_id, f.partner2_id} == {ea.id, eb.id} for f in families_of(ctx.db, ea.id)):
            mode = "exists"
    else:
        x, y = sorted((a, b))
        aid = f"rel:sibling:{x}:{y}"
        label = f"{_name(pa)} et {_name(pb)} sont frère(s) / sœur(s)"
        if ea and eb and any(s.id == eb.id for s in siblings_of(ctx.db, ea.id)):
            mode = "exists"
    if mode == "exists":
        label = f"Lien déjà présent : {label} (ajout de la source)"
        recommended, note = True, None  # le lien existe déjà : seule la source est ajoutée
    if note:
        label += f" {note}"
    _add_action(ctx, aid, "relation", "verify" if mode == "conflict" else "relations", label, requires=[a, b],
                recommended=recommended, mode=mode, payload={"kin": kin, "a": a, "b": b}, conflict=conflict)


def _build_actions(ctx: Ctx) -> None:
    db, ppl, doc = ctx.db, ctx.people, ctx.doc
    # 1. Personnes (dans l'ordre de résolution : les ancres d'abord)
    order = sorted(ctx.resolution.keys(), key=lambda i: (0 if i not in ctx.anchors else 1, i))
    pending = list(order)
    done: list[int] = []
    while pending:
        moved = False
        for i in list(pending):
            anc = ctx.anchors.get(i)
            if anc is None or anc[0] in done or anc[0] not in pending:
                done.append(i)
                pending.remove(i)
                moved = True
        if not moved:
            done.extend(pending)
            break
    for i in done:
        p, res = ppl[i], ctx.resolution[i]
        lab = _role_label(ctx, p)
        if res["resolution"] == "ignore":
            ctx.checked_person[i] = False
            continue
        anc = ctx.anchors.get(i)
        anchor_ok = anc is None or ctx.checked_person.get(anc[0], False)
        major = p["role"] in MAJOR_ROLES or (anc is not None and p.get("entry") is None)
        if res["resolution"] in ("match", "weak"):
            m = res["matches"][0] if res["matches"] else {"name": "?", "total": 0}
            existing = db.get(Person, res["person_id"])
            weak = res["resolution"] == "weak"
            label = (f"Est-ce {existing.display_name() if existing else m['name']} ? « {_name(p)} » ({lab}) — à vérifier" if weak
                     else f"« {_name(p)} » ({lab}) = {existing.display_name() if existing else m['name']}, déjà dans l'arbre")
            a = _add_action(ctx, f"person:{i}", "match_person", "persons", label, detail=res["reason"], requires=[],
                            recommended=not weak, payload={"idx": i, "person_id": res["person_id"]})
        else:
            recommended = major and anchor_ok and not res.get("tree_conflict") and p.get("entry") is None
            label = f"Créer la fiche de {_name(p)} ({lab})"
            extra = [x for x in (p.get("age") is not None and f"{p['age']} ans", p.get("occupation"), p.get("residence") and f"domicile : {p['residence']}") if x]
            if extra:
                label += " — " + ", ".join(extra)
            a = _add_action(ctx, f"person:{i}", "create_person", "persons", label, detail=res["reason"], requires=[],
                            recommended=recommended, payload={"idx": i})
            if res.get("tree_conflict"):
                tc = res["tree_conflict"]
                a["detail"] = (f"L'arbre indique déjà {tc['name']} comme {tc['kin']} de {tc['anchor']} : "
                               "vérifiez avant de créer une autre fiche.")
        ctx.checked_person[i] = a["checked"]
        # Variante orthographique du nom (Kowalska / Kowalski…)
        ex_p = _existing_person(ctx, i)
        if ex_p and p.get("surname") and ex_p.surname and normalize_name(p["surname"]) != normalize_name(ex_p.surname) \
                and normalize_name(p["surname"]) not in [normalize_name(v) for v in (ex_p.name_variants or []) + [ex_p.married_name]]:
            _add_action(ctx, f"variant:{i}", "name_variant", "persons",
                        f"Ajouter la variante « {p['surname']} » au nom de {ex_p.display_name()}", requires=[i],
                        payload={"idx": i, "variant": p["surname"]})
    # 2. Source et rattachement
    title = source_title(ctx)
    existing_src = ctx.db.get(Source, ctx.media.source_id) if ctx.media.source_id else None
    if existing_src is None and ctx.media.sha256:
        existing_src = db.execute(select(Source).where(Source.content_hash == ctx.media.sha256)).scalars().first()
    rel = reliability_for(doc)
    if existing_src is not None:
        _add_action(ctx, "source", "use_source", "source", f"Utiliser la source existante « {existing_src.title} »",
                    payload={"source_id": existing_src.id})
    else:
        _add_action(ctx, "source", "create_source", "source", f"Créer la source « {title} »",
                    detail={"primary": "Source primaire : image d'un acte original.",
                            "secondary": "Source secondaire : table, index ou document dérivé — à confirmer par l'acte.",
                            "unknown": "Fiabilité à préciser."}.get(rel),
                    recommended=doc != "family_photo", payload={"title": title, "reliability": rel})
    linkable = [i for i, r in ctx.resolution.items() if r["resolution"] != "ignore"]
    if linkable:
        main = ctx.subject if ctx.subject is not None else (ctx.heads.get(0) if ctx.heads else linkable[0])
        _add_action(ctx, "link", "link_media", "source",
                    f"Rattacher ce document à la fiche de {_name(ppl[main])} et aux personnes citées",
                    payload={"main": main})
    # 3. Événements de l'acte
    subj = ctx.subject
    ex = ctx.ex
    act_date = ex.get("date_iso") or ex.get("date")
    act_written = ex.get("date")
    ev_date = ex.get("event_date_iso") or ex.get("event_date")
    ev_written = ex.get("event_date")
    place = ctx.place
    if doc in ("birth", "baptism") and subj is not None:
        sp = ppl[subj]
        bdate = ev_date or sp.get("birth_date") or (act_date if doc == "birth" else None)
        bwritten = ev_written or sp.get("birth_date") or (act_written if doc == "birth" else None)
        if doc == "baptism":
            _event_action(ctx, "event:main", "baptism", idx=subj, date=act_date, date_written=act_written, place=place, main=True)
            if bdate:
                _event_action(ctx, f"event:birth:{subj}", "birth", idx=subj, date=bdate, date_written=bwritten,
                              place=sp.get("birth_place") or place)
        else:
            _event_action(ctx, "event:main", "birth", idx=subj, date=bdate, date_written=bwritten,
                          place=sp.get("birth_place") or place, main=True)
    elif doc == "marriage" and subj is not None and ctx.spouse is not None:
        _event_action(ctx, "event:main", "marriage", couple=(subj, ctx.spouse), date=ev_date or act_date,
                      date_written=ev_written or act_written, place=place, main=True)
    elif doc in ("death", "burial", "death_notice") and subj is not None:
        etype = "burial" if doc == "burial" else "death"
        d = ev_date or act_date
        _event_action(ctx, "event:main", etype, idx=subj, date=d, date_written=ev_written or act_written,
                      place=place, main=True, recommended=True)
    elif doc == "military_register" and subj is not None:
        mil = ex.get("military") or {}
        cls = str(mil.get("class_year") or "") or None
        parts = [f"Matricule {mil['matricule']}" if mil.get("matricule") else None, f"classe {cls}" if cls else None,
                 f"bureau de recrutement de {mil['recruitment_office']}" if mil.get("recruitment_office") else None]
        phys = mil.get("physical_description") or {}
        sig = ", ".join(f"{k} : {v}" for k, v in (("taille", phys.get("height")), ("cheveux", phys.get("hair")),
                                                  ("yeux", phys.get("eyes")), ("visage", phys.get("face")),
                                                  ("signes particuliers", phys.get("marks"))) if v)
        desc = ", ".join(x for x in parts if x)
        if sig:
            desc += f". Signalement : {sig}"
        if mil.get("campaigns"):
            desc += ". Campagnes : " + ", ".join(str(c) for c in mil["campaigns"])
        _event_action(ctx, "event:main", "military", idx=subj, date=cls or act_date, date_written=cls or act_written,
                      place=mil.get("recruitment_office") or place, description=desc or None, main=True,
                      extra_attrs={"military": mil})
    elif doc == "census":
        for hi, head in sorted(ctx.heads.items()):
            members = [q["index"] for q in ppl if q.get("household") == hi]
            addr = (ex.get("households") or [{}])[hi].get("address") if hi < len(ex.get("households") or []) else None
            for i in members:
                _event_action(ctx, f"event:census:{i}", "residence", idx=i, date=str(ctx.year) if ctx.year else act_date,
                              date_written=act_written or (str(ctx.year) if ctx.year else None), place=place,
                              description=f"Recensement{(' de ' + str(ctx.year)) if ctx.year else ''}"
                                          f"{(' — ' + addr) if addr else ''} ({_role_label(ctx, ppl[i])})",
                              main=True, participants_of=members, extra_attrs={"address": addr, "household": hi})
    elif doc == "decennial_table":
        for p in ppl:
            if p.get("entry") is None:
                continue
            i = p["index"]
            et = p.get("entry_event") or "birth"
            _event_action(ctx, f"event:entry:{i}", et, idx=i, date=p.get("entry_date"), date_written=p.get("entry_date_written"),
                          place=place, description="D'après la table décennale (source secondaire : à confirmer par l'acte).",
                          main=True, participants_of=[i],
                          recommended=ctx.resolution[i]["resolution"] == "match")
    # 4. Faits secondaires sur chaque personne
    for p in ppl:
        i = p["index"]
        if ctx.resolution[i]["resolution"] == "ignore" or p.get("entry") is not None:
            continue
        major = p["role"] in MAJOR_ROLES or i in ctx.anchors
        is_main_birth = doc in ("birth", "baptism") and i == subj
        if not is_main_birth and (p.get("birth_date") or p.get("birth_place") or p.get("birth_year")):
            if p.get("birth_date"):
                bd, bw = (p.get("birth_date_normalized") or {}).get("start") or p["birth_date"], p["birth_date"]
            elif p.get("birth_year"):
                bd, bw = f"vers {p['birth_year']}", f"vers {p['birth_year']}"
            else:
                bd = bw = None
            _event_action(ctx, f"event:birth:{i}", "birth", idx=i, date=bd, date_written=bw, place=p.get("birth_place"),
                          description="D'après les renseignements donnés dans le document.", recommended=major)
        elif not is_main_birth and p.get("age") is not None and ctx.year and major:
            ex_p = _existing_person(ctx, i)
            has_birth = ex_p is not None and any(e.event_type in ("birth", "baptism") for e in ex_p.events)
            if not has_birth:
                y = ctx.year - int(p["age"])
                _event_action(ctx, f"event:birth:{i}", "birth", idx=i, date=f"cal {y}", date_written=f"vers {y} (âge déclaré : {p['age']} ans)",
                              place=None, description=f"Année calculée d'après l'âge déclaré ({p['age']} ans) dans le document.",
                              recommended=True)
        if p.get("deceased") and i != subj and p["role"] != "deceased" and act_date:
            gd = parse_gendate(act_date)
            if gd.start:
                ex_p = _existing_person(ctx, i)
                if ex_p is None or not any(e.event_type in ("death", "burial") for e in ex_p.events):
                    _event_action(ctx, f"event:death:{i}", "death", idx=i, date=f"avant {gd.start}",
                                  date_written=f"avant le {re.sub(r'^le ', '', act_written or gd.display())}",
                                  description="Mentionné(e) comme décédé(e) dans le document.", recommended=major)
        if p.get("occupation") and major:
            ex_p = _existing_person(ctx, i)
            if ex_p is None or not ex_p.occupation:
                _add_action(ctx, f"occupation:{i}", "occupation", "events",
                            f"Profession de {_name(p)} : {p['occupation']}", requires=[i],
                            payload={"idx": i, "value": p["occupation"], "year": ctx.year})
            elif name_similarity(ex_p.occupation, p["occupation"]) < 80:
                _event_action(ctx, f"event:occupation:{i}", "occupation", idx=i, date=str(ctx.year) if ctx.year else None,
                              place=None, description=p["occupation"],
                              recommended=True)
                ctx.actions[-1]["label"] = (f"Profession de {_name(p)} en {ctx.year or '?'} : {p['occupation']} "
                                            f"(l'arbre indique « {ex_p.occupation} », conservé)")
        if p.get("residence") and major and doc != "census":
            _event_action(ctx, f"event:residence:{i}", "residence", idx=i, date=str(ctx.year) if ctx.year else None,
                          date_written=act_written, place=p["residence"], description=f"Domicile déclaré : {p['residence']}")
    # 5. Liens familiaux
    for i, (a, kin) in sorted(ctx.anchors.items()):
        if ctx.resolution[i]["resolution"] == "ignore" or ctx.resolution[a]["resolution"] == "ignore":
            continue
        if kin == "parent":
            _relation_action(ctx, "parent", i, a)
        elif kin == "child":
            _relation_action(ctx, "parent", a, i)
            # Le second parent (épouse du chef de ménage) n'est pas écrit dans un recensement : proposé, non coché
            if ppl[i].get("household") is not None:
                sp = next((q["index"] for q in ppl if q.get("household") == ppl[i]["household"] and kin_of(q.get("relation")) == "spouse"), None)
                if sp is not None and ctx.resolution[sp]["resolution"] != "ignore":
                    _relation_action(ctx, "parent", sp, i, recommended=False, note="(probable : le recensement ne le précise pas)")
        elif kin == "spouse":
            if doc == "marriage" and {i, a} == {subj, ctx.spouse}:
                continue  # le mariage lui-même crée le couple
            _relation_action(ctx, "spouse", a, i)
        elif kin == "sibling":
            _relation_action(ctx, "sibling", a, i)


def reliability_for(doc: str) -> str:
    if doc in PRIMARY_DOCS:
        return "primary"
    if doc in ("decennial_table", "death_notice", "other"):
        return "secondary"
    return "unknown"


def source_title(ctx: Ctx) -> str:
    ppl, doc = ctx.people, ctx.doc
    subj = ppl[ctx.subject] if ctx.subject is not None else None
    base = DOC_LABEL.get(doc, "Document")
    if doc == "marriage" and subj and ctx.spouse is not None:
        base += f" de {_name(subj)} et {_name(ppl[ctx.spouse])}"
    elif doc in ("birth", "baptism", "death", "burial", "death_notice", "military_register") and subj:
        base += f" de {_name(subj)}"
    elif doc == "census" and ctx.heads:
        heads = [ppl[h] for h in sorted(ctx.heads.values())]
        if len(heads) == 1:
            base += f" — ménage de {_name(heads[0])}"
    elif doc == "other" and ctx.media.title:
        base = ctx.media.title
    bits = [base]
    if ctx.place:
        bits.append(_first_seg(ctx.place) or ctx.place)
    mil = ctx.ex.get("military") or {}
    if doc == "military_register" and mil.get("class_year"):
        bits.append(f"classe {mil['class_year']}")
    elif ctx.year:
        bits.append(str(ctx.year))
    return ", ".join(bits)[:500]


# ------------------------------------------------------------------ API du service

def _context(db: Session, media: Media) -> Optional[Ctx]:
    a = media.analysis or {}
    ex = a.get("extraction") or {}
    if not isinstance(ex, dict):
        return None
    from ..ai.documents import normalize_extraction

    transcription = a.get("transcription") or media.ocr_text or ""
    if "households" not in ex or "entries" not in ex:
        ex = normalize_extraction(ex, transcription)  # analyses anciennes / règles
    if ex.get("requested_kind") and ex.get("document_type") in (None, "other") and ex["requested_kind"] != "auto":
        ex["document_type"] = ex["requested_kind"]
    doc = ex.get("document_type") or "other"
    year = _year(ex.get("date_normalized")) or _year(ex.get("event_date_normalized"))
    if not year and isinstance(ex.get("military"), dict):
        try:
            year = int(str(ex["military"].get("class_year"))[:4])
        except (TypeError, ValueError):
            year = None
    if not year:
        m = re.search(r"\b(1[5-9]\d{2}|20\d{2})\b", " ".join(str(ex.get(k) or "") for k in ("date", "event_date")))
        year = int(m.group(1)) if m else None
    ctx = Ctx(db=db, media=media, ex=ex, transcription=transcription, doc=doc, year=year, place=ex.get("place"),
              people=extract_people(ex))
    _infer_roles(ctx)
    return ctx


GROUP_ORDER = {"persons": 0, "events": 1, "relations": 2, "source": 3, "verify": 4}


def build_proposals(db: Session, media: Media) -> dict:
    a = media.analysis or {}
    fp = _fp(a, media.person_id)
    ctx = _context(db, media)
    base = {"version": PROPOSALS_VERSION, "fingerprint": fp, "media_id": media.id, "generated_at": utcnow().isoformat()}
    if ctx is None or not ctx.people:
        return {**base, "document_type": (ctx.doc if ctx else "other"), "document_label": DOC_LABEL.get(ctx.doc if ctx else "other"),
                "people": [], "actions": [], "warnings": ["Aucune personne n'a été repérée dans ce document : "
                                                          "vérifiez la transcription ou relancez la lecture."],
                "source_title": None, "reliability": None, "year": ctx.year if ctx else None, "place": ctx.place if ctx else None}
    _resolve_people(ctx)
    _build_actions(ctx)
    people_out = []
    for p in ctx.people:
        r = ctx.resolution.get(p["index"], {})
        people_out.append({
            "index": p["index"], "role": p["role"], "role_label": _role_label(ctx, p), "name": _name(p),
            "given_names": p.get("given_names"), "surname": p.get("surname"), "married_name": p.get("married_name"),
            "sex": p.get("sex"), "sex_inferred": bool(p.get("sex_inferred")), "age": p.get("age"),
            "birth_year": p.get("birth_year") or _year(p.get("birth_date_normalized")), "birth_date": p.get("birth_date"),
            "birth_place": p.get("birth_place"), "occupation": p.get("occupation"), "residence": p.get("residence"),
            "relation": p.get("relation"), "household": p.get("household"), "entry": p.get("entry"),
            "deceased": bool(p.get("deceased")), "confidence": p.get("confidence"),
            "anchor": (ctx.anchors.get(p["index"]) or (None, None))[0], "kin": (ctx.anchors.get(p["index"]) or (None, None))[1],
            "resolution": r.get("resolution", "ignore"), "person_id": r.get("person_id"),
            "person_name": (db.get(Person, r["person_id"]).display_name() if r.get("person_id") and db.get(Person, r["person_id"]) else None),
            "reason": r.get("reason"), "matches": r.get("matches", []), "tree_conflict": r.get("tree_conflict"),
            "action_id": f"person:{p['index']}" if any(x["id"] == f"person:{p['index']}" for x in ctx.actions) else None,
        })
    actions = sorted(ctx.actions, key=lambda x: (GROUP_ORDER.get(x["group"], 9), ctx.actions.index(x)))
    if ctx.doc not in PRIMARY_DOCS:
        ctx.warnings.append("Document secondaire : les informations sont des pistes à confirmer par l'acte original.")
    return {**base, "document_type": ctx.doc, "document_label": DOC_LABEL.get(ctx.doc, "Document"), "year": ctx.year,
            "place": ctx.place, "source_title": source_title(ctx), "reliability": reliability_for(ctx.doc),
            "summary_fr": ctx.ex.get("summary_fr"), "people": people_out, "actions": actions, "warnings": ctx.warnings}


def get_proposals(db: Session, media: Media, *, refresh: bool = False) -> dict:
    a = dict(media.analysis or {})
    stored = a.get("proposals")
    if not refresh and isinstance(stored, dict) and stored.get("fingerprint") == _fp(a, media.person_id) \
            and stored.get("version") == PROPOSALS_VERSION:
        return stored
    props = build_proposals(db, media)
    a["proposals"] = props
    media.analysis = a  # nouvelle valeur : SQLAlchemy ne suit pas les mutations JSON en place
    db.flush()
    return props


# ------------------------------------------------------------------ application

class ApplyError(ValueError):
    pass


@dataclass
class _Run:
    db: Session
    media: Media
    props: dict
    transcription: str
    source: Optional[Source] = None
    persons: dict[int, Person] = field(default_factory=dict)
    summary: dict = field(default_factory=lambda: {"created_persons": [], "linked_persons": [], "events": [], "relations": [],
                                                    "sources": [], "questions": [], "hypotheses": [], "updated_persons": [],
                                                    "skipped": []})

    def log(self, msg: str, person_id: Optional[str] = None, outcome: dict | None = None) -> None:
        log(self.db, f"Document « {self.media.title or self.media.original_filename} » : {msg}", category="decision",
            person_id=person_id, outcome=outcome)

    def cite(self, target_type: str, target_id: str, excerpt: Optional[str], confidence: str = "orange") -> None:
        if self.source is None:
            return
        exists = self.db.execute(select(Citation).where(Citation.source_id == self.source.id, Citation.target_type == target_type,
                                                        Citation.target_id == target_id)).scalars().first()
        if exists is None:
            self.db.add(Citation(source_id=self.source.id, target_type=target_type, target_id=target_id,
                                 excerpt=(excerpt or "")[:2000] or None, confidence=confidence,
                                 note="Lecture IA du document validée par l'utilisateur (à vérifier sur l'image)."))
            self.db.flush()


def _person_in(p: dict, media: Media) -> PersonIn:
    return PersonIn(given_names=p.get("given_names"), surname=p.get("surname"), married_name=p.get("married_name"),
                    sex=p.get("sex"), notes=f"Fiche créée d'après le document « {media.title or media.original_filename} ».",
                    confidence="grey")


def apply_proposals(db: Session, media: Media, action_ids: list[str], overrides: dict[str, str] | None = None) -> dict:
    from ..agents.questions import ask

    overrides = {str(k): v for k, v in (overrides or {}).items() if v}
    props = get_proposals(db, media)
    by_id = {a["id"]: a for a in props["actions"]}
    wanted = set(action_ids)
    selected = [a for a in props["actions"] if a["id"] in wanted]
    unknown = sorted(wanted - set(by_id))
    people = {p["index"]: p for p in props["people"]}
    run = _Run(db=db, media=media, props=props, transcription=(media.analysis or {}).get("transcription") or media.ocr_text or "")
    for u in unknown:
        run.summary["skipped"].append({"id": u, "reason": "Proposition inconnue ou périmée (actualisez les propositions)."})
    title = media.title or media.original_filename or "document"
    ex = (media.analysis or {}).get("extraction") or {}
    high = {i for i, p in people.items() if p.get("confidence") == "high"}
    primary = props.get("reliability") == "primary"

    # 1. Source
    src_action = next((a for a in selected if a["id"] == "source"), None)
    if src_action is not None:
        if src_action["kind"] == "use_source":
            run.source = db.get(Source, src_action["payload"]["source_id"])
        else:
            mil = ex.get("military") or {}
            run.source = Source(title=src_action["payload"]["title"], commune=_first_seg(props.get("place")),
                                register_type=REGISTER_TYPE.get(props.get("document_type") or "", None),
                                year=props.get("year"), page=(f"acte n° {ex['act_number']}" if ex.get("act_number")
                                                              else (f"matricule {mil['matricule']}" if mil.get("matricule") else None)),
                                transcription=run.transcription or None, translation=ex.get("translation_fr"),
                                language=(media.language or ex.get("language") or None),
                                interpretation=ex.get("summary_fr"), reliability=src_action["payload"]["reliability"],
                                local_copy_path=media.id, local_copy_allowed=True, content_hash=media.sha256,
                                extra={"media_id": media.id, "document_type": props.get("document_type"),
                                       "officer": ex.get("officer"), "act_number": ex.get("act_number")})
            db.add(run.source)
            db.flush()
            from .fts import index_entity

            index_entity(db.connection(), "source", run.source.id, run.source.title, run.transcription[:5000])
            run.log(f"source créée « {run.source.title} » ({run.source.reliability})")
        if run.source is not None:
            media.source_id = run.source.id
            run.summary["sources"].append({"id": run.source.id, "title": run.source.title, "reliability": run.source.reliability})

    # 2. Personnes (identité choisie, fiche existante ou nouvelle)
    for i, p in sorted(people.items()):
        ov = overrides.get(str(i))
        person: Optional[Person] = None
        if ov == "new" or (ov is None and f"person:{i}" in wanted and p["resolution"] == "new"):
            if not (p.get("given_names") or p.get("surname") or p.get("married_name")):
                continue
            person = create_person(db, _person_in(p, media))
            run.summary["created_persons"].append({"id": person.id, "name": person.display_name(), "index": i, "role": p["role_label"]})
            run.log(f"création de la fiche {person.display_name()} ({p['role_label']})", person.id)
        elif ov and ov != "ignore":
            person = db.get(Person, ov)
            if person is None:
                raise ApplyError(f"Personne choisie introuvable pour « {p['name']} ».")
        elif ov is None and f"person:{i}" in wanted and p["resolution"] in ("match", "weak") and p.get("person_id"):
            person = db.get(Person, p["person_id"])
        if person is not None:
            run.persons[i] = person
            if not any(x["id"] == person.id for x in run.summary["created_persons"]):
                run.summary["linked_persons"].append({"id": person.id, "name": person.display_name(), "index": i, "role": p["role_label"]})
                if ov or p["resolution"] == "weak":
                    run.log(f"identité confirmée par l'utilisateur : « {p['name']} » = {person.display_name()}", person.id)
            run.cite("person", person.id, _excerpt(run.transcription, p.get("surname"), p.get("given_names")),
                     "green" if primary and i in high else "orange")

    def ok(a: dict) -> bool:
        missing = [i for i in a["requires"] if i not in run.persons]
        if missing:
            run.summary["skipped"].append({"id": a["id"], "reason": "Personne non retenue : " + ", ".join(people[i]["name"] for i in missing)})
            return False
        return True

    # 3. Rattachement du document
    link = next((a for a in selected if a["id"] == "link"), None)
    if link is not None:
        main = link["payload"].get("main")
        target = run.persons.get(main) if main is not None else None
        target = target or next(iter(run.persons.values()), None)
        if target is not None and not media.person_id:
            media.person_id = target.id
        if target is not None:
            run.log(f"document rattaché à {target.display_name()}", target.id)

    # 4. Variantes, professions, liens, événements (dans l'ordre des propositions)
    for a in selected:
        kind = a["kind"]
        if kind in ("create_person", "match_person", "use_source", "create_source", "link_media"):
            continue
        if not ok(a):
            continue
        pl = a["payload"]
        if kind == "name_variant":
            person = run.persons[pl["idx"]]
            variants = list(person.name_variants or [])
            if pl["variant"] not in variants:
                person.name_variants = variants + [pl["variant"]]
                index_person(db, person)
                run.summary["updated_persons"].append({"id": person.id, "name": person.display_name(), "change": f"variante {pl['variant']}"})
                run.log(f"variante de nom « {pl['variant']} » ajoutée à {person.display_name()}", person.id)
        elif kind == "occupation":
            person = run.persons[pl["idx"]]
            if not person.occupation:
                person.occupation = pl["value"]
                run.summary["updated_persons"].append({"id": person.id, "name": person.display_name(), "change": f"profession : {pl['value']}"})
                run.log(f"profession de {person.display_name()} : {pl['value']}", person.id)
            elif name_similarity(person.occupation, pl["value"]) < 80:
                ev = add_event(db, person.id, EventIn(event_type="occupation", date=str(pl.get("year") or ""), description=pl["value"],
                                                      value_original=pl["value"], attributes={"media_id": media.id}, confidence="orange"))
                run.cite("event", ev.id, _excerpt(run.transcription, pl["value"]))
                run.summary["events"].append({"id": ev.id, "event_type": "occupation", "person_id": person.id, "family_id": None, "mode": "added",
                                              "who": person.display_name()})
        elif kind == "relation":
            _apply_relation(run, a, people, ask)
        elif kind == "event":
            _apply_event(run, a, people, ask, primary=primary, high=high)

    # 5. Identités incertaines non tranchées → question (rien n'est relié)
    for i, p in sorted(people.items()):
        if p["resolution"] == "weak" and i not in run.persons and str(i) not in overrides:
            m = p["matches"][0] if p["matches"] else None
            if not m:
                continue
            q = ask(db, title=f"« {p['name']} » ({p['role_label']}) dans « {title} » est-il/elle {m['name']} ?"[:500],
                    problem=(f"Le document cite {p['name']} ({p['role_label']}). L'arbre contient {m['name']} avec une concordance de "
                             f"{m['total']:.0f} % : ce n'est pas suffisant pour relier automatiquement."),
                    person_id=m["person_id"], known_facts=[f"{c['label']} : {c['detail']}" for c in m["criteria"]],
                    documents=[{"media_id": media.id, "title": title}],
                    impact="Si oui, le document sera rattaché à cette personne et ses informations ajoutées.",
                    priority=60, dedupe_key=f"interpret:{media.id}:{i}:identity")
            if q:
                run.summary["questions"].append({"id": q.id, "title": q.title})

    # 6. La question générique du coordinateur (mode copier-coller) est tranchée par cette validation
    if media.person_id:
        for q in db.execute(select(Question).where(Question.dedupe_key == f"{media.person_id}:filiation:{media.id}",
                                                   Question.status == "pending")).scalars():
            q.status, q.answer_type, q.answer, q.answered_at = "answered", "info", "Traité par l'interprétation du document.", utcnow()
    db.flush()
    from .confidence import recompute_all
    from .consistency import run_all as run_consistency

    run_consistency(db)
    recompute_all(db)
    counts = {k: len(v) for k, v in run.summary.items()}
    run.log(f"interprétation appliquée ({counts['created_persons']} fiche(s) créée(s), {counts['events']} événement(s), "
            f"{counts['relations']} lien(s), {counts['questions']} question(s))", media.person_id, outcome=counts)
    a = dict(media.analysis or {})
    a["applied"] = {"at": utcnow().isoformat(), "actions": sorted(wanted), "overrides": overrides, "summary": run.summary}
    media.analysis = a
    db.flush()
    db.refresh(media)
    get_proposals(db, media, refresh=True)  # l'arbre a changé : propositions recalculées pour un éventuel second passage
    return run.summary


def _ask_conflict(run: _Run, a: dict, person: Optional[Person], text: str, facts: list[str], candidate: dict, ask) -> None:
    title = run.media.title or run.media.original_filename or "document"
    h = Hypothesis(kind="event", title=f"Contradiction à vérifier : {text}"[:500],
                   description="Le document et l'arbre ne concordent pas. Rien n'a été modifié : choisissez la version à retenir "
                               "après examen de l'image.", subject_person_id=person.id if person else None,
                   candidate={**candidate, "media_id": run.media.id}, created_by="agent:interprete",
                   evidence=[{"media_id": run.media.id, "source_id": run.source.id if run.source else None,
                              "note": "lecture IA validée par l'utilisateur"}], status="open",
                   group_key=f"interpret:{run.media.id}:{a['id']}")
    run.db.add(h)
    run.db.flush()
    run.summary["hypotheses"].append({"id": h.id, "title": h.title})
    q = ask(run.db, title=f"Contradiction à vérifier : {text}"[:500],
            problem=f"Le document « {title} » ne dit pas la même chose que l'arbre. L'arbre n'a pas été modifié.",
            person_id=person.id if person else None, known_facts=facts, documents=[{"media_id": run.media.id, "title": title}],
            hypotheses=[{"label": text, "hypothesis_id": h.id}], impact="Évite de garder une date ou un lien erroné.",
            priority=75, dedupe_key=f"interpret:{run.media.id}:conflict:{a['id']}")
    if q:
        run.summary["questions"].append({"id": q.id, "title": q.title})
    run.log(f"contradiction à vérifier : {text}", person.id if person else None)


def _apply_relation(run: _Run, a: dict, people: dict[int, dict], ask) -> None:
    db = run.db
    pl = a["payload"]
    pa, pb = run.persons[pl["a"]], run.persons[pl["b"]]
    excerpt = _excerpt(run.transcription, people[pl["a"]].get("surname"), people[pl["b"]].get("surname"))
    if pa.id == pb.id:
        run.summary["skipped"].append({"id": a["id"], "reason": "Une même fiche ne peut pas être reliée à elle-même."})
        return
    if pl["kin"] == "parent":
        relation = {"M": "father", "F": "mother"}.get(pa.sex or "", "parent")
        try:
            res = add_relative(db, pb, RelativeIn(relation=relation, existing_id=pa.id))
        except ValueError as exc:
            _ask_conflict(run, a, pb, f"{pa.display_name()} comme {'père' if relation == 'father' else 'mère' if relation == 'mother' else 'parent'} "
                                      f"de {pb.display_name()}", [str(exc)], {"parent_id": pa.id, "child_id": pb.id}, ask)
            return
        rel_id = res["relations"][0]
        run.cite("parent_child", rel_id, excerpt)
        run.summary["relations"].append({"id": rel_id, "kind": "parent", "parent_id": pa.id, "child_id": pb.id,
                                         "label": f"{pa.display_name()} → {pb.display_name()}"})
        run.log(f"filiation {pa.display_name()} → {pb.display_name()}", pb.id)
    elif pl["kin"] == "spouse":
        x, y = (pa, pb) if (pa.sex == "M" or pb.sex == "F") else (pb, pa)
        fam = find_or_create_family(db, x.id, y.id)
        run.cite("family", fam.id, excerpt)
        run.summary["relations"].append({"id": fam.id, "kind": "union", "label": f"{x.display_name()} & {y.display_name()}"})
        run.log(f"union {x.display_name()} & {y.display_name()}", x.id)
    else:
        if any(s.id == pb.id for s in siblings_of(db, pa.id)):
            run.summary["relations"].append({"id": None, "kind": "sibling", "label": f"{pa.display_name()} / {pb.display_name()} (déjà liés)"})
            return
        rel = {"M": "brother", "F": "sister"}.get(pb.sex or "", "sibling")
        try:
            res = add_relative(db, pa, RelativeIn(relation=rel, existing_id=pb.id))
        except ValueError as exc:
            run.summary["skipped"].append({"id": a["id"], "reason": str(exc)})
            return
        run.summary["relations"].append({"id": (res["relations"] or [None])[0], "kind": "sibling",
                                         "label": f"{pa.display_name()} / {pb.display_name()}"})
        run.log(f"fratrie {pa.display_name()} / {pb.display_name()}", pa.id)


def _apply_event(run: _Run, a: dict, people: dict[int, dict], ask, *, primary: bool, high: set[int]) -> None:
    db = run.db
    pl = a["payload"]
    media = run.media
    ex = (media.analysis or {}).get("extraction") or {}
    etype = pl["event_type"]
    person: Optional[Person] = None
    family: Optional[Family] = None
    if pl.get("couple"):
        x, y = run.persons[pl["couple"][0]], run.persons[pl["couple"][1]]
        if x.id == y.id:
            run.summary["skipped"].append({"id": a["id"], "reason": "Les deux époux désignent la même fiche."})
            return
        if y.sex == "M" and x.sex != "M":
            x, y = y, x
        family = find_or_create_family(db, x.id, y.id)
        if etype == "marriage" and family.union_type != "marriage":
            family.union_type = "marriage"
        holder_events = list(family.events)
        who = f"{x.display_name()} et {y.display_name()}"
        idxs = list(pl["couple"])
    else:
        person = run.persons[pl["idx"]]
        db.refresh(person)
        holder_events = list(person.events)
        who = person.display_name()
        idxs = [pl["idx"]]
    gd = parse_gendate(pl.get("date"))
    place = pl.get("place")
    excerpt = _excerpt(run.transcription, *(people[i].get("surname") for i in idxs), *(people[i].get("given_names") for i in idxs))
    conf = "green" if primary and all(i in high for i in idxs) else "orange"
    participants = []
    ids = pl.get("participants_of")
    for p in people.values():
        if p.get("entry") is not None or (ids is not None and p["index"] not in ids):
            continue
        if ids is None and not pl.get("main"):
            continue
        rp = run.persons.get(p["index"])
        participants.append({"name": rp.display_name() if rp else p["name"], "role": p["role"], "role_label": p["role_label"],
                             "age": p.get("age"), "occupation": p.get("occupation"), "residence": p.get("residence"),
                             "relation": p.get("relation"), "person_id": rp.id if rp else None})
    attrs: dict[str, Any] = {"participants": participants, "officer": ex.get("officer"), "act_number": ex.get("act_number"),
                             "media_id": media.id, "transcription": (run.transcription or "")[:6000] or None,
                             "document_type": run.props.get("document_type"), "source_id": run.source.id if run.source else None}
    attrs.update(pl.get("extra_attrs") or {})
    written = pl.get("date_written")
    value_original = ", ".join(x for x in (written, place) if x) or None
    same = [e for e in holder_events if e.event_type == etype]
    target: Optional[Event] = None
    if same:
        if etype in SINGLE_EVENTS:
            e = same[0]
            eplace = e.place.display() if e.place else e.place_original
            if not (dates_compatible(e, gd) and _place_compatible(eplace, place)):
                text = (f"{EVENT_FR.get(etype, etype).lower()} de {who} : l'acte indique {_when(pl.get('date'), written, quote=False) or '?'}"
                        f"{(' à ' + place) if place else ''}, l'arbre indique {e.date_original or e.date_start or '?'}"
                        f"{(' à ' + eplace) if eplace else ''}")
                _ask_conflict(run, a, person or (run.persons[idxs[0]] if idxs else None), text,
                              [f"Arbre : {e.date_original or e.date_start or '?'}{(' — ' + eplace) if eplace else ''}",
                               f"Document : {_when(pl.get('date'), written) or '?'}{(' — ' + place) if place else ''}"],
                              {"event_id": e.id, "event_type": etype, "date": pl.get("date"), "date_original": written, "place": place}, ask)
                return
            target = e
        else:
            target = next((e for e in same if e.sort_year == gd.sort_year and
                           _place_compatible(e.place.display() if e.place else e.place_original, place)), None)
    if target is not None:
        changes = []
        if _more_precise(target, gd) and etype in SINGLE_EVENTS:
            prev = target.date_original or target.date_start
            target.date_original = written or pl.get("date")
            target.date_kind, target.date_start, target.date_end, target.calendar, target.sort_year = gd.kind, gd.start, gd.end, gd.calendar, gd.sort_year
            changes.append(f"date précisée ({prev or 'aucune'} → {target.date_original})")
        if place and not target.place_id and not target.place_original:
            from .places import resolve_place

            plc = resolve_place(db, place)
            target.place_id = plc.id if plc else None
            target.place_original = place
            changes.append(f"lieu ajouté ({place})")
        if not target.value_original and value_original:
            target.value_original = value_original
        cur = dict(target.attributes or {})
        if pl.get("main") or etype in SINGLE_EVENTS:
            for k, v in attrs.items():
                if v and not cur.get(k):
                    cur[k] = v
            target.attributes = cur
        if not target.description and pl.get("description"):
            target.description = pl["description"]
        db.flush()
        run.cite("event", target.id, excerpt, conf)
        run.summary["events"].append({"id": target.id, "event_type": etype, "person_id": target.person_id, "family_id": target.family_id,
                                      "mode": "completed", "changes": changes, "who": who})
        run.log(f"{EVENT_FR.get(etype, etype).lower()} de {who} complété(e) avec la source" + (f" : {', '.join(changes)}" if changes else ""),
                person.id if person else None)
        return
    ev = add_event(db, person.id if person else None,
                   EventIn(event_type=etype, date=pl.get("date"), date_original=written, place=place,
                           description=pl.get("description"), value_original=value_original,
                           attributes=attrs if (pl.get("main") or etype in SINGLE_EVENTS) else {"media_id": media.id, "source_id": attrs["source_id"]},
                           confidence=conf, family_id=family.id if family else None))
    run.cite("event", ev.id, excerpt, conf)
    run.summary["events"].append({"id": ev.id, "event_type": etype, "person_id": ev.person_id, "family_id": ev.family_id, "mode": "added",
                                  "who": who, "date": ev.date_original or (ev.date_start or None)})
    run.log(f"{EVENT_FR.get(etype, etype).lower()} ajouté(e) pour {who}" + (f" ({', '.join(x for x in (_when(pl.get('date'), None), place) if x)})" if (pl.get("date") or place) else ""),
            person.id if person else None)
    if person is not None:
        db.refresh(person)
        index_person(db, person)
