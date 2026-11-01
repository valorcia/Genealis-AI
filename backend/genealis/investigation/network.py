"""Réseau des personnes citées dans les documents : témoins, parrains, déclarants, relations indirectes.

Priorité de l'enquête : une mention comme « Pierre Martin, oncle maternel de l'épouse » est
1. analysée (type de lien, côté, personne de référence),
2. confrontée à l'arbre (l'oncle maternel de l'épouse doit être un frère de sa mère, ou le mari d'une sœur de sa mère),
3. enregistrée comme hypothèse `indirect_relation` (jamais comme fait), avec avertissements,
4. transformée en piste : recherche d'actes complémentaires sur cette personne.

Règles : une mention n'est JAMAIS fusionnée automatiquement avec une personne de l'arbre ; un témoin homonyme
n'est jamais présumé parent (hypothèse `witness_homonym` avec avertissement explicite).
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Hypothesis, Investigation, InvestigationTask, Media, Person, PersonMention
from ..services.names import given_names_similarity, name_similarity
from ..services.persons import children_of, parents_of, siblings_of, spouses_of
from . import memory, queue

# ------------------------------------------------------------------ analyse du lien déclaré
# (motif, kind, sexe attendu) — l'ordre compte : formes composées d'abord
_KIND_PATTERNS: list[tuple[str, str, Optional[str]]] = [
    (r"\bgrand[- ]oncle\b", "great_uncle", "M"), (r"\bgrand[- ]tante\b", "great_aunt", "F"),
    (r"\barriere[- ]grand[- ]pere\b", "great_grandfather", "M"), (r"\barriere[- ]grand[- ]mere\b", "great_grandmother", "F"),
    (r"\bgrand[- ]pere\b|\baieul\b", "grandfather", "M"), (r"\bgrand[- ]mere\b|\baieule\b", "grandmother", "F"),
    (r"\bbeau[- ]frere\b", "brother_in_law", "M"), (r"\bbelle[- ]soeur\b", "sister_in_law", "F"),
    (r"\bbeau[- ]pere\b", "father_in_law", "M"), (r"\bbelle[- ]mere\b", "mother_in_law", "F"),
    (r"\bcousine?s? germaine?s?\b", "first_cousin", None), (r"\bcousine?s?\b", "cousin", None),
    (r"\boncle\b|\bavunculus\b|\bpatruus\b", "uncle", "M"), (r"\btante\b|\bmatertera\b|\bamita\b", "aunt", "F"),
    (r"\bneveu\b", "nephew", "M"), (r"\bniece\b", "niece", "F"),
    (r"\bfrere\b|\bfrater\b", "brother", "M"), (r"\bsoeur\b|\bsoror\b", "sister", "F"),
    (r"\bpere\b|\bpater\b", "father", "M"), (r"\bmere\b|\bmater\b", "mother", "F"),
    (r"\bfils\b", "son", "M"), (r"\bfille\b", "daughter", "F"),
    (r"\bparrain\b|\bpatrinus\b", "godfather", "M"), (r"\bmarraine\b|\bmatrina\b", "godmother", "F"),
    (r"\bami\b|\bamie\b", "friend", None), (r"\bvoisine?\b", "neighbour", None),
]
_TO_ROLE: list[tuple[str, str]] = [
    (r"\bdes (epoux|maries|futurs)\b", "couple"),
    (r"\bde l ?epouse\b|\bde la mariee\b|\bde l ?epousee\b|\bde la future\b|\bsponsae\b", "bride"),
    (r"\bde l ?epoux\b|\bdu marie\b|\bdu futur\b|\bsponsi\b", "groom"),
    (r"\bde l ?enfant\b|\bdu nouveau[- ]ne\b|\bde la nouvelle[- ]nee\b|\binfantis\b", "subject"),
    (r"\bdu defunt\b|\bde la defunte\b|\bdu decede\b|\bde la decedee\b", "deceased"),
    (r"\bdu declarant\b|\bdu comparant\b", "declarant"),
    (r"\bde la mere\b|\bmatris\b", "mother"), (r"\bdu pere\b|\bpatris\b", "father"),
]
KIND_FR = {"uncle": "oncle", "aunt": "tante", "great_uncle": "grand-oncle", "great_aunt": "grand-tante",
           "grandfather": "grand-père", "grandmother": "grand-mère", "brother": "frère", "sister": "sœur",
           "brother_in_law": "beau-frère", "sister_in_law": "belle-sœur", "father_in_law": "beau-père",
           "mother_in_law": "belle-mère", "first_cousin": "cousin germain", "cousin": "cousin", "nephew": "neveu",
           "niece": "nièce", "father": "père", "mother": "mère", "son": "fils", "daughter": "fille",
           "godfather": "parrain", "godmother": "marraine", "friend": "ami", "neighbour": "voisin"}
ROLE_FR = {"bride": "l'épouse", "groom": "l'époux", "subject": "la personne principale", "deceased": "le défunt",
           "declarant": "le déclarant", "mother": "la mère", "father": "le père", "couple": "des époux"}
KIN_SEX = {k: s for _, k, s in _KIND_PATTERNS}
# rôles des mentions qui peuvent désigner la personne de référence
REF_ROLES = {"bride": ("bride", "spouse"), "groom": ("groom", "subject"), "subject": ("subject",),
             "deceased": ("deceased", "subject"), "declarant": ("declarant",), "mother": ("mother",), "father": ("father",)}
LIVING_YEARS = 100


def _plain(text: str | None) -> str:
    from unidecode import unidecode

    return re.sub(r"[’'`]", " ", unidecode((text or "").lower()))


def parse_relation(text: str | None) -> dict:
    """« oncle maternel de l'épouse » → {kind: uncle, side: maternal, to_role: bride, sex: M}."""
    t = _plain(text)
    out = {"kind": None, "side": "unknown", "to_role": None, "sex": None}
    if not t.strip():
        return out
    for pat, kind, sex in _KIND_PATTERNS:
        if re.search(pat, t):
            out["kind"], out["sex"] = kind, sex
            break
    if re.search(r"\bmaternel(le)?s?\b|\bdu cote maternel\b|\bmaterne", t):
        out["side"] = "maternal"
    elif re.search(r"\bpaternel(le)?s?\b|\bdu cote paternel\b|\bpaterne", t):
        out["side"] = "paternal"
    for pat, role in _TO_ROLE:
        if re.search(pat, t):
            out["to_role"] = role
            break
    # « frère de la mère de l'enfant » = oncle maternel de l'enfant
    via = re.search(r"\b(?:frere|soeur)\s+(de la mere|du pere)\b(.*)$", t)
    if out["kind"] in ("brother", "sister") and via:
        sub = next((r for p, r in _TO_ROLE[:-2] if re.search(p, via.group(2))), None)
        out["side"] = "maternal" if via.group(1) == "de la mere" else "paternal"
        out["kind"] = "uncle" if out["kind"] == "brother" else "aunt"
        out["sex"] = "M" if out["kind"] == "uncle" else "F"
        out["to_role"] = sub or "subject"
    return out


def apply_parsed(m: PersonMention) -> None:
    """Complète relation_kind / relation_side / relation_to_role à partir du texte du document (sans écraser)."""
    if not m.stated_relation:
        return
    p = parse_relation(m.stated_relation)
    if not m.relation_kind and p["kind"]:
        m.relation_kind = p["kind"]
    if (not m.relation_side or m.relation_side == "unknown") and p["side"]:
        m.relation_side = p["side"]
    if not m.relation_to_role and p["to_role"]:
        m.relation_to_role = p["to_role"]


# ------------------------------------------------------------------ outils
def full_name(m) -> str:
    if isinstance(m, Person):
        return m.display_name()
    return " ".join(x for x in (m.given_names or "", (m.surname or "").upper()) if x).strip() or (m.name_original or "?")


def name_score(m: PersonMention, p: Person) -> float:
    """Similarité de nom 0-100 entre une mention et une personne (prénoms ET nom ; un seul ne suffit pas)."""
    sn = max([name_similarity(m.surname, s) for s in (p.surname, p.married_name, *(p.name_variants or [])) if s] or [0])
    gn = given_names_similarity(m.given_names, p.given_names) if m.given_names and p.given_names else 0
    if not m.surname and not m.given_names:
        return 0.0
    if not m.given_names:
        return min(sn, 60.0)
    return round(0.55 * sn + 0.45 * gn, 1)


def _birth_year(p: Person) -> Optional[int]:
    return next((e.sort_year for e in p.events if e.event_type in ("birth", "baptism") and e.sort_year), None)


def _age(m: PersonMention) -> Optional[int]:
    mt = re.search(r"\d{1,3}", m.age_stated or "")
    return int(mt.group(0)) if mt else None


def document_year(db: Session, m: PersonMention) -> Optional[int]:
    from ..models import DocumentReading

    ex: dict = {}
    if m.reading_id:
        r = db.get(DocumentReading, m.reading_id)
        ex = (r.extraction or {}) if r else {}
    if not ex and m.media_id:
        med = db.get(Media, m.media_id)
        ex = ((med.analysis or {}).get("extraction") or {}) if med else {}
    for k in ("date_normalized", "event_date_normalized"):
        if isinstance(ex.get(k), dict) and ex[k].get("sort_year"):
            return int(ex[k]["sort_year"])
    mt = re.search(r"\b(1[5-9]\d{2}|20\d{2})\b", " ".join(str(ex.get(k) or "") for k in ("date_iso", "date", "event_date")))
    return int(mt.group(1)) if mt else None


def same_document(db: Session, m: PersonMention) -> list[PersonMention]:
    q = db.query(PersonMention).filter(PersonMention.id != m.id)
    if m.reading_id:
        q = q.filter(PersonMention.reading_id == m.reading_id)
    elif m.media_id:
        q = q.filter(PersonMention.media_id == m.media_id)
    else:
        return []
    return q.all()


def reference_mention(db: Session, m: PersonMention) -> Optional[PersonMention]:
    if m.relation_to_mention_id:
        ref = db.get(PersonMention, m.relation_to_mention_id)
        if ref:
            return ref
    roles = REF_ROLES.get(m.relation_to_role or "", ())
    for role in roles:
        ref = next((x for x in same_document(db, m) if x.role == role), None)
        if ref:
            return ref
    return None


def reference_person(db: Session, ref: Optional[PersonMention]) -> tuple[Optional[Person], str]:
    """Personne de l'arbre désignée par la mention de référence : liée (validée) ou meilleur candidat (à confirmer)."""
    if ref is None:
        return None, "none"
    if ref.linked_person_id and ref.link_status == "confirmed":
        p = db.get(Person, ref.linked_person_id)
        if p:
            return p, "confirmed"
    best = sorted([c for c in ref.candidates or [] if isinstance(c, dict) and c.get("person_id")],
                  key=lambda c: -(c.get("score") or 0))
    if best and (best[0].get("score") or 0) >= 80 and not best[0].get("blocking"):
        p = db.get(Person, best[0]["person_id"])
        if p:
            return p, "candidate"
    return None, "none"


# ------------------------------------------------------------------ positions attendues dans l'arbre
def _side_parents(db: Session, ref: Person, side: str) -> list[Person]:
    pars = [p for p, r in parents_of(db, ref.id) if r.relation_type in ("biological", "uncertain")]
    if side == "maternal":
        return [p for p in pars if p.sex == "F"]
    if side == "paternal":
        return [p for p in pars if p.sex == "M"]
    return pars


def expected_positions(db: Session, ref: Person, kind: str | None, side: str) -> tuple[list[tuple[Person, str]], list[str]]:
    """Personnes de l'arbre qui occupent la position du lien déclaré, et ce qui manque pour vérifier."""
    out: list[tuple[Person, str]] = []
    missing: list[str] = []
    if kind in ("uncle", "aunt"):
        pars = _side_parents(db, ref, side)
        if not pars:
            missing.append({"maternal": "la mère", "paternal": "le père"}.get(side, "les parents") + f" de {ref.display_name()}")
        for par in pars:
            sibs = siblings_of(db, par.id)
            if not sibs:
                missing.append(f"les frères et sœurs de {par.display_name()}")
            for s in sibs:
                out.append((s, f"{'frère' if s.sex == 'M' else 'sœur' if s.sex == 'F' else 'frère ou sœur'} de {par.display_name()}"))
                for sp in spouses_of(db, s.id):
                    out.append((sp, f"conjoint(e) de {s.display_name()}, {'sœur' if s.sex == 'F' else 'frère'} de {par.display_name()} (par alliance)"))
    elif kind in ("brother", "sister"):
        for s in siblings_of(db, ref.id):
            out.append((s, f"frère ou sœur de {ref.display_name()}"))
        if not out:
            missing.append(f"les frères et sœurs de {ref.display_name()}")
    elif kind in ("first_cousin", "cousin"):
        for par in _side_parents(db, ref, side):
            for s in siblings_of(db, par.id):
                for c, _ in children_of(db, s.id):
                    out.append((c, f"enfant de {s.display_name()}, {'frère' if s.sex == 'M' else 'sœur'} de {par.display_name()}"))
        if not out:
            missing.append(f"les oncles, tantes et cousins de {ref.display_name()}")
    elif kind in ("grandfather", "grandmother"):
        for par in _side_parents(db, ref, side):
            for gp, _ in parents_of(db, par.id):
                out.append((gp, f"parent de {par.display_name()}"))
        if not out:
            missing.append(f"les grands-parents de {ref.display_name()}")
    elif kind in ("father", "mother"):
        out = [(p, f"parent de {ref.display_name()}") for p, _ in parents_of(db, ref.id)]
        if not out:
            missing.append(f"les parents de {ref.display_name()}")
    elif kind in ("brother_in_law", "sister_in_law"):
        for sp in spouses_of(db, ref.id):
            out += [(s, f"frère ou sœur du conjoint {sp.display_name()}") for s in siblings_of(db, sp.id)]
        for s in siblings_of(db, ref.id):
            out += [(sp, f"conjoint(e) de {s.display_name()}") for sp in spouses_of(db, s.id)]
        if not out:
            missing.append(f"la fratrie et les conjoints autour de {ref.display_name()}")
    elif kind in ("nephew", "niece"):
        for s in siblings_of(db, ref.id):
            out += [(c, f"enfant de {s.display_name()}") for c, _ in children_of(db, s.id)]
        if not out:
            missing.append(f"les neveux et nièces de {ref.display_name()}")
    if kind in ("father", "mother", "grandfather", "grandmother") and kind:
        want = KIN_SEX.get(kind)
        out = [(p, why) for p, why in out if not want or not p.sex or p.sex == want]
    return out, missing


def check_relation(db: Session, m: PersonMention, ref: Person | None, *, ref_status: str = "none") -> dict:
    """Confronte un lien déclaré dans un document à l'arbre. Ne modifie rien."""
    apply_parsed(m)
    kind, side = m.relation_kind, m.relation_side or "unknown"
    res: dict = {"status": "unknown", "relation_kind": kind, "relation_side": side, "reference_person_id": ref.id if ref else None,
                 "reference_status": ref_status, "matches": [], "expected": [], "missing": [], "warnings": [], "explanation": ""}
    label = (KIND_FR.get(kind or "", kind or "lien") + (" maternel" if side == "maternal" and kind in ("uncle", "cousin", "first_cousin", "grandfather")
                                                     else " maternelle" if side == "maternal" else
                                                     " paternel" if side == "paternal" and kind in ("uncle", "cousin", "first_cousin", "grandfather")
                                                     else " paternelle" if side == "paternal" else ""))
    res["relation_label"] = label
    want_sex = KIN_SEX.get(kind or "")
    if want_sex and m.sex and m.sex != want_sex:
        res["status"] = "inconsistent"
        res["warnings"].append(f"Le lien « {m.stated_relation} » suppose une personne de sexe {want_sex}, la mention indique {m.sex} "
                               "(lecture à vérifier).")
    if ref is None:
        res["explanation"] = ("La personne de référence du lien n'est pas encore identifiée dans l'arbre : "
                              "le lien est conservé comme piste, sans conclusion.")
        return res
    if ref_status == "candidate":
        res["warnings"].append(f"La personne de référence ({ref.display_name()}) n'est qu'un rapprochement probable, pas une identité validée.")
    if kind in (None, "friend", "neighbour", "godfather", "godmother"):
        res["explanation"] = "Lien social ou non généalogique : réseau de la famille, aucune position à vérifier dans l'arbre."
        res["status"] = "unknown" if res["status"] != "inconsistent" else res["status"]
        return res
    positions, missing = expected_positions(db, ref, kind, side)
    res["missing"] = missing
    res["expected"] = [{"person_id": p.id, "name": p.display_name(), "position": why} for p, why in positions]
    scored = sorted(((name_score(m, p), p, why) for p, why in positions), key=lambda t: -t[0])
    res["matches"] = [{"person_id": p.id, "name": p.display_name(), "position": why, "name_score": s} for s, p, why in scored if s >= 80]
    # Homonymes ailleurs dans l'arbre : jamais une preuve d'identité
    pos_ids = {p.id for p, _ in positions}
    homs = []
    if m.surname:
        for p in db.execute(select(Person).where(Person.surname.isnot(None))).scalars():
            if p.id in pos_ids or p.id == ref.id:
                continue
            if name_score(m, p) >= 85:
                homs.append(p)
    for p in homs[:5]:
        res["warnings"].append(f"{p.display_name()} porte le même nom dans l'arbre mais n'occupe pas la position « {label} » : "
                               "homonymie possible, ce n'est pas une preuve d'identité.")
    res["homonyms"] = [{"person_id": p.id, "name": p.display_name()} for p in homs[:5]]
    if res["status"] == "inconsistent":
        res["explanation"] = "Le lien déclaré est incompatible avec la mention elle-même (sexe) : à vérifier sur l'image."
        return res
    if res["matches"]:
        best = res["matches"][0]
        res["status"] = "consistent"
        res["explanation"] = (f"Cohérent avec l'arbre : {best['name']} est {best['position']} et son nom correspond "
                              f"({best['name_score']:.0f} %). Le lien reste une hypothèse tant que vous ne l'avez pas validé.")
        return res
    # Pas de personne correspondante : plausibilité selon le nom de famille du côté concerné
    if kind in ("uncle", "aunt", "first_cousin", "cousin", "grandfather", "grandmother"):
        pars = _side_parents(db, ref, side)
        same = [p for p in pars if p.surname and m.surname and name_similarity(m.surname, p.surname) >= 85]
        if same:
            res["status"] = "plausible"
            res["explanation"] = (f"{full_name(m)} porte le nom de naissance de {same[0].display_name()} : compatible avec "
                                  f"un {label} par le sang, mais cette personne n'est pas encore dans l'arbre.")
        elif pars:
            res["status"] = "plausible"
            res["explanation"] = (f"Nom différent de celui de {', '.join(p.display_name() for p in pars)} : "
                                  "pourrait être un lien par alliance (conjoint d'une tante ou d'un oncle) ; à vérifier.")
        else:
            res["explanation"] = "Les parents de la personne de référence ne sont pas dans l'arbre : vérification impossible pour l'instant."
    elif positions:
        res["status"] = "plausible"
        res["explanation"] = "Aucune personne de l'arbre à cette position ne porte ce nom : personne à ajouter ou lecture à vérifier."
    else:
        res["explanation"] = "Position encore vide dans l'arbre : le document apporte une information nouvelle à confirmer."
    # Âge : un frère ou une sœur du parent naît rarement à plus de 25 ans d'écart
    age, year = _age(m), document_year(db, m)
    if age is not None and year and kind in ("uncle", "aunt"):
        for par in _side_parents(db, ref, side):
            by = _birth_year(par)
            if by and abs((year - age) - by) > 30:
                res["warnings"].append(f"Âge déclaré ({age} ans en {year}) : né vers {year - age}, très éloigné de "
                                       f"{par.display_name()} (né(e) en {by}) — lien par alliance ou lecture à vérifier.")
    return res


# ------------------------------------------------------------------ pistes (tâche witness_followup)
def _evidence(m: PersonMention) -> list[dict]:
    return [{"source_id": m.source_id, "media_id": m.media_id, "mention_id": m.id, "excerpt": m.excerpt,
             "image_region": m.image_region, "note": "mention dans le document (lecture IA à vérifier)"}]


def followup(db: Session, inv: Investigation, m: PersonMention, task: InvestigationTask | None = None) -> dict:
    """Traite une mention (témoin, parrain, lien déclaré) : vérification, hypothèse, piste. Jamais de fusion."""
    from ..agents.questions import ask

    apply_parsed(m)
    if m.investigation_id is None:
        m.investigation_id = inv.id
    out: dict = {"mention_id": m.id, "hypothesis_id": None, "lead_task_id": None, "question_id": None}
    year = document_year(db, m)
    ref_m = reference_mention(db, m)
    ref, ref_status = reference_person(db, ref_m)
    task_id = task.id if task else None
    if m.stated_relation and m.relation_kind:
        check = check_relation(db, m, ref, ref_status=ref_status)
        ref_name = full_name(ref_m) if ref_m else ROLE_FR.get(m.relation_to_role or "", "la personne de référence")
        title = f"{full_name(m)}, {m.stated_relation} ({ref_name}) ?"
        verdict = {"consistent": "cohérent avec l'arbre", "plausible": "plausible, à confirmer", "unknown": "non vérifiable pour l'instant",
                   "inconsistent": "incohérence à vérifier"}[check["status"]]
        h = Hypothesis(kind="indirect_relation", title=title[:512],
                       description=f"Lien déclaré dans le document : « {m.stated_relation} ». Vérification : {verdict}. "
                                   f"{check['explanation']}",
                       subject_person_id=ref.id if ref else None,
                       candidate={"mention_id": m.id, "name": full_name(m), "role": m.role, "stated_relation": m.stated_relation,
                                  "relation_kind": m.relation_kind, "relation_side": m.relation_side,
                                  "relation_to_role": m.relation_to_role, "reference_mention_id": ref_m.id if ref_m else None,
                                  "media_id": m.media_id, "source_id": m.source_id, "check": check,
                                  "tree_person_id": check["matches"][0]["person_id"] if check["matches"] else None},
                       evidence=_evidence(m), score={"consistent": 70.0, "plausible": 45.0, "unknown": 25.0, "inconsistent": 10.0}[check["status"]],
                       score_details={"verification": check["status"], "warnings": check["warnings"],
                                      "rule": "Un lien déclaré par un document reste une hypothèse ; aucune fusion automatique."},
                       status="open", created_by="agent:director", task_id=task_id,
                       group_key=f"indirect:{m.id}")
        db.add(h)
        db.flush()
        memory.record_hypothesis(inv, h.id, h.title)
        out["hypothesis_id"], out["verification"] = h.id, check["status"]
        queue.emit(db, inv.id, "hypothesis", f"Relation indirecte : {title} — {verdict}.",
                   {"hypothesis_id": h.id, "mention_id": m.id, "verification": check["status"]}, task_id)
        if check["status"] == "inconsistent":
            q = ask(db, title=f"Le document dit que {full_name(m)} est « {m.stated_relation} ». Est-ce compatible avec ce que vous savez ?",
                    problem=check["explanation"] + " " + " ".join(check["warnings"]), person_id=ref.id if ref else None,
                    task_id=task_id, hypotheses=[{"label": title, "hypothesis_id": h.id}],
                    documents=[{"media_id": m.media_id}], impact="Évite d'enregistrer un lien erroné.", priority=60,
                    dedupe_key=f"inv:{inv.id}:indirect:{m.id}")
            out["question_id"] = q.id if q else None
    elif m.role in ("witness", "godfather", "godmother", "declarant", "informant", "neighbour"):
        # Témoin sans lien déclaré : homonymie avec la famille ? jamais présumé parent
        fam_names = set()
        principals = [x for x in same_document(db, m) if x.role in ("subject", "groom", "bride", "spouse", "deceased", "father", "mother")]
        for x in principals:
            if x.surname:
                fam_names.add(_plain(x.surname).strip())
        if m.surname and _plain(m.surname).strip() in fam_names:
            h = Hypothesis(kind="witness_homonym", title=f"{full_name(m)} ({m.role}) porte le nom de la famille : parent possible ?"[:512],
                           description="Un témoin portant le même nom que la famille n'est JAMAIS présumé parent : "
                                       "ce peut être un parent, un allié ou un homonyme. Seul un autre acte peut le dire.",
                           candidate={"mention_id": m.id, "name": full_name(m), "role": m.role, "media_id": m.media_id,
                                      "source_id": m.source_id},
                           evidence=_evidence(m), score=20.0,
                           score_details={"warnings": ["Homonymie : aucun lien de parenté n'est déduit du seul nom."]},
                           status="open", created_by="agent:director", task_id=task_id, group_key=f"witness:{m.id}")
            db.add(h)
            db.flush()
            memory.record_hypothesis(inv, h.id, h.title)
            out["hypothesis_id"] = h.id
            queue.emit(db, inv.id, "hypothesis", f"Témoin homonyme : {full_name(m)} — non présumé parent (piste).",
                       {"hypothesis_id": h.id, "mention_id": m.id}, task_id)
    # Piste : actes complémentaires sur cette personne (si le document a plus de 100 ans : personne décédée)
    if year and date.today().year - year >= LIVING_YEARS and (m.surname or m.given_names) and (m.stated_relation or out["hypothesis_id"]):
        name = " ".join(x for x in (m.given_names, m.surname) if x)
        ctx = f", {m.stated_relation}" if m.stated_relation else ""
        q = f"{name}{ctx}, acte de {year}" + (f", {m.residence}" if m.residence else "")
        lead, created = queue.enqueue(db, inv.id, "web_search", f"Piste témoin : {name}{ctx}", person_id=None,
                                      params={"query": q, "goal": "Actes complémentaires (naissance, mariage) pour confirmer le lien "
                                                                  "déclaré, sans présumer l'identité",
                                              "mention_id": m.id, "register_type": "any",
                                              "structured": {"given_names": m.given_names, "surname": m.surname,
                                                             "year_from": year - 60, "year_to": year,
                                                             "commune": (m.residence or "").split(",")[0] or None}},
                                      priority=30, strategy="web_search",
                                      generation=task.generation if task else 0, parent_task_id=task_id)
        m.lead_task_id = lead.id
        out["lead_task_id"] = lead.id
        if created:
            queue.emit(db, inv.id, "plan", f"Nouvelle piste : rechercher {name}{ctx}.", {"task_id": lead.id, "mention_id": m.id}, task_id)
    db.flush()
    return out


# ------------------------------------------------------------------ graphe
def graph(db: Session, person_id: str) -> dict:
    """Réseau d'une personne : documents qui la concernent, personnes citées, liens avec l'arbre."""
    p = db.get(Person, person_id)
    if p is None:
        raise ValueError("Personne introuvable")
    nodes: dict[str, dict] = {f"person:{p.id}": {"id": f"person:{p.id}", "label": p.display_name(), "kind": "person"}}
    edges: list[dict] = []
    mentions = [m for m in db.query(PersonMention).all()
                if m.linked_person_id == p.id or any(isinstance(c, dict) and c.get("person_id") == p.id for c in m.candidates or [])]
    media_ids = {m.media_id for m in mentions if m.media_id} | {mid for (mid,) in db.query(Media.id).filter(Media.person_id == p.id)}
    for mid in media_ids:
        med = db.get(Media, mid)
        if med is None:
            continue
        nodes[f"document:{mid}"] = {"id": f"document:{mid}", "label": med.title or med.original_filename or "Document", "kind": "document"}
        if med.person_id == p.id:
            edges.append({"source": f"person:{p.id}", "target": f"document:{mid}", "role": "document rattaché", "stated_relation": None})
        for m in db.query(PersonMention).filter(PersonMention.media_id == mid).all():
            nid = f"mention:{m.id}"
            nodes[nid] = {"id": nid, "label": f"{full_name(m)} — {m.role}", "kind": "mention"}
            edges.append({"source": nid, "target": f"document:{mid}", "role": m.role, "stated_relation": m.stated_relation})
            if m.relation_to_mention_id:
                edges.append({"source": nid, "target": f"mention:{m.relation_to_mention_id}", "role": "lien déclaré",
                              "stated_relation": m.stated_relation})
            linked = [(m.linked_person_id, "identifié" if m.link_status == "confirmed" else "candidat")] if m.linked_person_id else []
            linked += [(c["person_id"], "candidat") for c in m.candidates or [] if isinstance(c, dict) and c.get("person_id")
                       and c.get("person_id") != m.linked_person_id and (c.get("score") or 0) >= 50]
            for pid, how in linked[:3]:
                tp = db.get(Person, pid)
                if tp is None:
                    continue
                nodes.setdefault(f"person:{pid}", {"id": f"person:{pid}", "label": tp.display_name(), "kind": "person"})
                edges.append({"source": nid, "target": f"person:{pid}", "role": how, "stated_relation": None})
    return {"nodes": list(nodes.values()), "edges": edges}
