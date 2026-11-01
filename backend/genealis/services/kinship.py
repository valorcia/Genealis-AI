"""Calcul des liens de parenté entre deux personnes (ancêtre commun le plus proche), libellés en français."""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import ParentChild, Person
from .persons import person_summary, spouses_of


def _ancestry(db: Session, pid: str, max_depth: int = 40) -> tuple[dict[str, int], dict[str, str]]:
    """{ancêtre: profondeur minimale} et pointeur « enfant par lequel on est monté » pour reconstruire le chemin."""
    depth = {pid: 0}
    via: dict[str, str] = {}
    frontier = [pid]
    while frontier:
        nxt = []
        for cur in frontier:
            if depth[cur] >= max_depth:
                continue
            for r in db.execute(select(ParentChild).where(ParentChild.child_id == cur,
                                                          ParentChild.relation_type.in_(["biological", "uncertain", "legal", "adoptive"]))).scalars():
                if r.parent_id not in depth:
                    depth[r.parent_id] = depth[cur] + 1
                    via[r.parent_id] = cur
                    nxt.append(r.parent_id)
        frontier = nxt
    return depth, via


def _arriere(n: int) -> str:
    return "arrière-" * max(n, 0)


def _w(sex: Optional[str], m: str, f: str, n: str) -> str:
    return m if sex == "M" else f if sex == "F" else n


def describe(ga: int, gb: int, sex: Optional[str], half: bool = False) -> str:
    """Ce que B est pour A, A étant à ga générations et B à gb générations de l'ancêtre commun."""
    if ga == 0 and gb == 0:
        return "même personne"
    if ga == 0:  # B descend de A
        if gb == 1:
            return _w(sex, "fils", "fille", "enfant")
        return _arriere(gb - 2) + _w(sex, "petit-fils", "petite-fille", "petit-enfant")
    if gb == 0:  # B est un ancêtre de A
        if ga == 1:
            return _w(sex, "père", "mère", "parent")
        return _arriere(ga - 2) + _w(sex, "grand-père", "grand-mère", "grand-parent")
    if ga == 1 and gb == 1:
        base = _w(sex, "frère", "sœur", "frère ou sœur")
        return ("demi-" + base) if half else base
    if ga == 1:  # B descend d'un frère/sœur de A
        if gb == 2:
            return _w(sex, "neveu", "nièce", "neveu ou nièce")
        return _arriere(gb - 3) + _w(sex, "petit-neveu", "petite-nièce", "petit-neveu ou petite-nièce")
    if gb == 1:  # B est frère/sœur d'un ancêtre de A
        if ga == 2:
            return _w(sex, "oncle", "tante", "oncle ou tante")
        return _arriere(ga - 3) + _w(sex, "grand-oncle", "grand-tante", "grand-oncle ou grand-tante")
    degree = min(ga, gb) - 1
    cousin = _w(sex, "cousin", "cousine", "cousin(e)")
    if degree == 1:
        name = f"{cousin} germain{_w(sex, '', 'e', '(e)')}"
    elif degree == 2:
        name = f"{cousin} issu{_w(sex, '', 'e', '(e)')} de germain (petit{_w(sex, '', 'e', '(e)')}-{cousin})"
    elif degree == 3:
        name = f"arrière-petit{_w(sex, '', 'e', '(e)')}-{cousin}"
    else:
        name = f"{cousin} au {degree}e degré"
    diff = gb - ga
    if diff == 0:
        return name
    if degree == 1 and diff == 1:
        return _w(sex, "neveu", "nièce", "neveu ou nièce") + " à la mode de Bretagne (enfant d'un cousin germain)"
    if degree == 1 and diff == -1:
        return _w(sex, "oncle", "tante", "oncle ou tante") + " à la mode de Bretagne (cousin germain d'un parent)"
    return f"{name}, {abs(diff)} génération{'s' if abs(diff) > 1 else ''} plus {'jeune' if diff > 0 else 'âgé'}"


def kinship(db: Session, a_id: str, b_id: str) -> dict:
    a, b = db.get(Person, a_id), db.get(Person, b_id)
    if not a or not b:
        raise ValueError("Personne introuvable")
    if a.id == b.id:
        return {"relation": "même personne", "found": True, "path": [person_summary(db, a).model_dump()], "common_ancestors": []}
    da, via_a = _ancestry(db, a.id)
    db_, via_b = _ancestry(db, b.id)
    common = set(da) & set(db_)
    if not common:
        if b in spouses_of(db, a.id):
            return {"relation": _w(b.sex, "époux / conjoint", "épouse / conjointe", "conjoint(e)"), "found": True, "by_marriage": True,
                    "path": [person_summary(db, a).model_dump(), person_summary(db, b).model_dump()], "common_ancestors": []}
        # Par alliance : B est parent par le sang d'un conjoint de A
        for sp in spouses_of(db, a.id):
            sub = kinship(db, sp.id, b.id) if sp.id != b.id else None
            if sub and sub.get("found") and not sub.get("by_marriage"):
                return {**sub, "relation": sub["relation"] + f" de votre conjoint(e) {sp.display_name()} (par alliance)", "by_marriage": True}
        return {"relation": "aucun lien de sang trouvé dans l'arbre", "found": False, "path": [], "common_ancestors": []}
    best = min(common, key=lambda c: (da[c] + db_[c], max(da[c], db_[c])))
    ga, gb = da[best], db_[best]
    tied = [c for c in common if da[c] == ga and db_[c] == gb]
    half = ga == 1 and gb == 1 and len(tied) == 1
    # Chemin A → ancêtre → B
    up = []
    cur = best
    while cur != a.id:
        up.append(cur)
        cur = via_a[cur]
    up.append(a.id)
    up.reverse()  # a ... best
    down = []
    cur = best
    while cur != b.id:
        cur_child = via_b.get(cur)
        if cur_child is None:
            break
        down.append(cur_child)
        cur = cur_child
    # via_b pointe de l'ancêtre vers l'enfant par lequel on est monté depuis B : on suit jusqu'à B
    path_ids = up + [x for x in down if x not in up]
    if path_ids[-1] != b.id:
        path_ids.append(b.id)
    return {"relation": describe(ga, gb, b.sex, half), "found": True, "generations_a": ga, "generations_b": gb,
            "civil_degree": ga + gb, "half": half,
            "common_ancestors": [person_summary(db, db.get(Person, c)).model_dump() for c in tied],
            "path": [person_summary(db, db.get(Person, x)).model_dump() for x in path_ids if db.get(Person, x)]}
