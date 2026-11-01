"""Personnes citées dans une lecture (sujet, parents, témoins, parrains…) → `PersonMention`.

AUCUN lien automatique vers l'arbre : `linked_person_id` reste vide. Les rapprochements possibles avec des personnes
de l'arbre sont seulement proposés comme candidats (score explicable), jamais confirmés ici. Un témoin homonyme
n'est jamais présumé parent.
"""
from __future__ import annotations

import re
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session
from unidecode import unidecode

from ..models import DocumentReading, Media, PersonMention
from ..services.gendate import parse_gendate

ROLE_MAP = {"subject": "subject", "father": "father", "mother": "mother", "spouse": "spouse", "groom": "groom", "bride": "bride",
            "witness": "witness", "godfather": "godfather", "godmother": "godmother", "declarant": "declarant",
            "officiant": "officiant", "deceased": "deceased", "informant": "informant", "neighbour": "neighbour",
            "spouse_father": "father", "spouse_mother": "mother", "head_of_household": "other", "household_member": "other",
            "other": "other"}

# (motif, relation_kind, côté implicite)
_KIND_PATTERNS: list[tuple[str, str, Optional[str]]] = [
    (r"grand[- ]?p[eè]re|aieul\b|avus\b|grossvater|großvater|nonno|dziadek", "grandfather", None),
    (r"grand[- ]?m[eè]re|aieule|avia\b|grossmutter|großmutter|nonna|babka", "grandmother", None),
    (r"beau[- ]?fr[eè]re|schwager|cognato|szwagier", "brother_in_law", None),
    (r"belle[- ]?s(oe|œ)ur|schw[aä]gerin|cognata|szwagierka|bratowa", "sister_in_law", None),
    (r"beau[- ]?p[eè]re|schwiegervater|suocero|te[sś][cć]\b", "father_in_law", None),
    (r"belle[- ]?m[eè]re|schwiegermutter|suocera|te[sś]ciowa", "mother_in_law", None),
    (r"demi[- ]?fr[eè]re|halbbruder", "half_brother", None),
    (r"demi[- ]?s(oe|œ)ur|halbschwester", "half_sister", None),
    (r"\bavunculus\b|\bwuj\b|\bwujek\b", "uncle", "maternal"),
    (r"\bpatruus\b|\bstryj\b|\bstryjek\b", "uncle", "paternal"),
    (r"\bmatertera\b|\bciotka\b", "aunt", "maternal"),
    (r"\bamita\b|\bstryjenka\b", "aunt", "paternal"),
    (r"\boncle\b|\bonkel\b|\boheim\b|\bohm\b|\bzio\b", "uncle", None),
    (r"\btante\b|\bmuhme\b|\bzia\b", "aunt", None),
    (r"\bneveu\b|\bneffe\b|\bnepos\b|\bnipote\b|\bbratanek\b|\bsiostrzeniec\b", "nephew", None),
    (r"\bni[eè]ce\b|\bnichte\b|\bneptis\b|\bbratanica\b|\bsiostrzenica\b", "niece", None),
    (r"\bcousine?\b|\bvetter\b|\bbase\b|\bconsobrin|\bcugin|\bkuzyn", "cousin", None),
    (r"\bfr[eè]re\b|\bbruder\b|\bfrater\b|\bfratello\b|\bbrat\b", "brother", None),
    (r"\bs(oe|œ)ur\b|\bschwester\b|\bsoror\b|\bsorella\b|\bsiostra\b", "sister", None),
    (r"\bparrain\b|\bpatrinus\b|\bpate\b|\bpadrino\b|\bojciec chrzestny\b", "godfather", None),
    (r"\bmarraine\b|\bmatrina\b|\bpatin\b|\bmadrina\b|\bmatka chrzestna\b", "godmother", None),
    (r"\btuteur\b|\bcurateur\b|\btutor\b|\bvormund\b", "guardian", None),
    (r"\bvoisin|\bnachbar|\bvicin|\bs[aą]siad", "neighbour", None),
    (r"\bami\b|\bamie\b|\bfreund|\bamic", "friend", None),
    (r"\bveuve\b|\bvidua\b|\bwitwe\b|\bvedova\b|\bwdowa\b", "widow", None),
    (r"\bveuf\b|\bviduus\b|\bwitwer\b|\bvedovo\b|\bwdowiec\b", "widower", None),
    (r"\bfils\b|\bfilius\b|\bsohn\b|\bfiglio\b|\bsyn\b", "son", None),
    (r"\bfille\b|\bfilia\b|\btochter\b|\bfiglia\b|\bc[oó]rka\b", "daughter", None),
    (r"\bp[eè]re\b|\bpater\b|\bvater\b|\bpadre\b|\bojciec\b", "father", None),
    (r"\bm[eè]re\b|\bmater\b|\bmutter\b|\bmadre\b|\bmatka\b", "mother", None),
    (r"\bmaitre\b|\bpatron\b|\bdienstherr", "employer", None),
    (r"\bdomestique\b|\bservante?\b|\bmagd\b|\bknecht\b|\bfamul", "servant", None),
]
_SIDE = [(r"maternel|maternelle|du c[oô]t[eé] (de la|maternel) m[eè]re|mutterlich|mütterlich|materno|materna|ze strony matki", "maternal"),
         (r"paternel|paternelle|du c[oô]t[eé] (du|paternel) p[eè]re|vaterlich|väterlich|paterno|paterna|ze strony ojca", "paternal")]
_TO_ROLE = [(r"(de l'|de la |d'la )?(epouse|mariee|future|sponsa|braut|sposa)\b|\bbride\b", "bride"),
            (r"(de l'|du )?(epoux|marie|futur|sponsus|brautigam|br[aä]utigam|sposo)\b|\bgroom\b", "groom"),
            (r"(de l'|du )(enfant|baptise|baptisee|nouveau[- ]ne)|baptizat|infantis|des kindes|del bambino|dziecka", "subject"),
            (r"(du |de la )(defunt|defunte|decede|decedee)|defuncti|des verstorbenen|del defunto|zmar", "deceased"),
            (r"(du |de la )(comparant|declarant|declarante)", "declarant"),
            (r"\bdu pere\b|\bpatris\b", "father"), (r"\bde la mere\b|\bmatris\b", "mother")]


def parse_relation(text: str | None) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """« oncle maternel de l'épouse » → ("uncle", "maternal", "bride"). Rien n'est déduit hors du texte."""
    if not text or not str(text).strip():
        return None, None, None
    low = unidecode(str(text)).lower().replace("œ", "oe")
    raw_low = str(text).lower()
    kind = side = None
    for pat, k, s in _KIND_PATTERNS:
        if re.search(pat, low) or re.search(pat, raw_low):
            kind, side = k, s
            break
    for pat, s in _SIDE:
        if re.search(pat, low) or re.search(pat, raw_low):
            side = s
            break
    to_role = None
    for pat, r in _TO_ROLE:
        if re.search(pat, low):
            to_role = r
            break
    if kind and not side and kind in ("uncle", "aunt", "cousin", "grandfather", "grandmother", "nephew", "niece"):
        side = "unknown"
    return kind, side, to_role


def _s(v) -> Optional[str]:
    if v is None or isinstance(v, (dict, list)):
        return None
    t = str(v).strip()
    return t if t and t.lower() not in ("null", "none") else None


def _find_line(reading: DocumentReading, name: str, line_n: Optional[int]) -> Optional[dict]:
    lines = reading.lines or []
    if line_n:
        ln = next((x for x in lines if x.get("n") == line_n), None)
        if ln:
            return ln
    if not name:
        return None
    key = unidecode(name).lower()
    parts = [p for p in re.split(r"\W+", key) if len(p) > 2]
    best, best_n = None, 0
    for ln in lines:
        t = unidecode(ln.get("diplomatic") or "").lower() + " " + unidecode(ln.get("normalized") or "").lower()
        n = sum(1 for p in parts if p in t)
        if n > best_n:
            best, best_n = ln, n
    return best


_CONF = {"high": 0.85, "medium": 0.6, "low": 0.3}


def _event_year(reading: DocumentReading) -> Optional[int]:
    ex = reading.extraction or {}
    d = ex.get("date_normalized") or {}
    y = d.get("sort_year") if isinstance(d, dict) else None
    if isinstance(y, int):
        return y
    for v in (ex.get("date_iso"), ex.get("date"), reading.period_estimate):
        if v:
            gd = parse_gendate(str(v))
            if getattr(gd, "sort_year", None):
                return gd.sort_year
            m = re.search(r"1[0-9]{3}", str(v))
            if m:
                return int(m.group(0))
    return None


def _candidates(db: Session, m: PersonMention, year: Optional[int], place: Optional[str]) -> list[dict]:
    """Rapprochements possibles (jamais confirmés) avec les personnes de l'arbre."""
    if not m.surname:
        return []
    from ..services.matching import Candidate, find_matches

    age = None
    if m.age_stated:
        mm = re.search(r"\d{1,3}", m.age_stated)
        age = int(mm.group(0)) if mm else None
    cand = Candidate(surname=m.surname, given_names=m.given_names, sex=m.sex, event_year=year, event_place=place,
                     age_at_event=age, occupation=m.occupation, residence=m.residence,
                     birth_year=(year - age) if (year and age is not None and m.role not in ("subject",)) else
                     (year if m.role == "subject" and year else None))
    out = []
    try:
        results = find_matches(db, cand, min_total=45.0)[:3]
    except Exception:  # le rapprochement est une aide : il ne doit jamais empêcher l'extraction
        return []
    for r in results:
        d = r.to_dict()
        out.append({"person_id": r.person_id, "score": d["total"], "level": d["level"],
                    "reasons": [c["detail"] for c in d["criteria"] if c["score"] > 0][:6],
                    "warnings": (d["blocking"] or []) + ["Rapprochement proposé à partir du document : à vérifier, jamais automatique."]})
    return out


def mentions_from_reading(db: Session, reading: DocumentReading, investigation_id: str | None = None,
                          with_candidates: bool = True) -> list[PersonMention]:
    """Crée (ou met à jour) les mentions de personnes d'une lecture. Idempotent ; ne crée aucun lien vers l'arbre."""
    media = db.get(Media, reading.media_id)
    ex = reading.extraction or {}
    persons = [p for p in ex.get("persons") or [] if isinstance(p, dict)]
    existing = {(m.name_original, m.role): m for m in db.execute(
        select(PersonMention).where(PersonMention.reading_id == reading.id)).scalars()}
    doc_type = ex.get("document_type")
    year = _event_year(reading)
    place = _s(ex.get("place"))
    out: list[PersonMention] = []
    for p in persons:
        raw_role = (p.get("mention_role") or p.get("role") or "other").lower()
        role = ROLE_MAP.get(raw_role, "other")
        if doc_type == "marriage" and raw_role == "subject":
            role = "groom"
        elif doc_type == "marriage" and raw_role == "spouse":
            role = "bride"
        elif doc_type in ("death", "burial") and raw_role == "subject":
            role = "deceased"
        name = _s(p.get("name_original")) or " ".join(x for x in (_s(p.get("given_names")), _s(p.get("surname"))) if x) or "(nom illisible)"
        stated = _s(p.get("stated_relation")) or _s(p.get("relation"))
        kind, side, to_role = parse_relation(stated)
        kind = _s(p.get("relation_kind")) or kind
        side = _s(p.get("relation_side")) or side
        to_role = _s(p.get("relation_to_role")) or to_role
        if raw_role in ("spouse_father", "spouse_mother"):  # parents de l'épouse (convention v0.3)
            to_role = to_role or "bride"
            stated = stated or ("père de l'épouse" if raw_role == "spouse_father" else "mère de l'épouse")
        elif doc_type == "marriage" and raw_role in ("father", "mother") and not to_role:
            to_role = "groom"
        if kind == "none":
            kind = None
        line = _find_line(reading, name, p.get("line_n") if isinstance(p.get("line_n"), int) else None)
        region = {"media_id": reading.media_id, "reading_id": reading.id, "line_n": line.get("n"), "bbox": line.get("bbox")} if line else None
        conf = _CONF.get(str(p.get("confidence") or "medium"), 0.6)
        if line and any(u.get("status") != "human_verified" and any(t in (u.get("text") or "") for t in name.split() if len(t) > 2)
                        for u in line.get("uncertain") or []):
            conf = min(conf, 0.35)  # le nom touche un passage de lecture incertaine
        age = p.get("age_stated") or p.get("age")
        m = existing.get((name, role))
        if m is None:
            m = PersonMention(name_original=name, role=role, reading_id=reading.id, media_id=reading.media_id,
                              source_id=media.source_id if media else None)
            db.add(m)
        if m.link_status == "confirmed":  # validé par l'utilisateur : jamais réécrit
            out.append(m)
            continue
        m.investigation_id = investigation_id or m.investigation_id
        m.given_names, m.surname, m.sex = _s(p.get("given_names")), _s(p.get("surname")), _s(p.get("sex"))
        m.stated_relation, m.relation_kind, m.relation_side, m.relation_to_role = stated, kind, side, to_role
        m.age_stated = str(age) if age not in (None, "") else None
        m.occupation, m.residence = _s(p.get("occupation")), _s(p.get("residence"))
        m.signed = p.get("signed") if isinstance(p.get("signed"), bool) else None
        m.excerpt = _s(p.get("excerpt")) or (line.get("diplomatic") if line else None)
        m.image_region = region
        m.reading_confidence = conf
        m.linked_person_id = None  # jamais de lien automatique
        db.flush()
        if with_candidates and m.link_status != "rejected":
            m.candidates = _candidates(db, m, year, place)
            m.link_status = "candidate" if m.candidates else "unlinked"
        out.append(m)
    # relation explicite vers une autre mention (rôle de référence unique dans le document)
    by_role: dict[str, list[PersonMention]] = {}
    for m in out:
        by_role.setdefault(m.role, []).append(m)
    for m in out:
        if m.relation_to_role and len(by_role.get(m.relation_to_role, [])) == 1 and by_role[m.relation_to_role][0] is not m:
            m.relation_to_mention_id = by_role[m.relation_to_role][0].id
    db.flush()
    return out


def mention_dict(m: PersonMention) -> dict:
    return {"id": m.id, "media_id": m.media_id, "reading_id": m.reading_id, "investigation_id": m.investigation_id,
            "name_original": m.name_original, "given_names": m.given_names, "surname": m.surname, "sex": m.sex, "role": m.role,
            "stated_relation": m.stated_relation, "relation_kind": m.relation_kind, "relation_side": m.relation_side,
            "relation_to_role": m.relation_to_role, "relation_to_mention_id": m.relation_to_mention_id,
            "age_stated": m.age_stated, "occupation": m.occupation, "residence": m.residence, "signed": m.signed,
            "excerpt": m.excerpt, "image_region": m.image_region, "reading_confidence": m.reading_confidence,
            "linked_person_id": m.linked_person_id, "link_status": m.link_status, "candidates": m.candidates or []}
