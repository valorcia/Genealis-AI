"""Numérotation Sosa-Stradonitz de toute la base, à partir de la personne de départ (racine).

Calcul en une seule lecture des liens de filiation (rapide, utilisable pour chaque liste) :
racine = 1, père = 2n, mère = 2n + 1. Seules les filiations biologique, adoptive, légale ou incertaine
occupent les cases ; les beaux-parents et parents nourriciers n'ont pas de numéro. Un ancêtre
présent par plusieurs chemins (implexe) reçoit plusieurs numéros.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import ParentChild, Person

LINEAL = ("biological", "uncertain", "legal", "adoptive")
RANK = {"biological": 0, "uncertain": 1, "legal": 2, "adoptive": 3}
MAX_GENERATIONS = 40


def root_id(db: Session) -> Optional[str]:
    p = db.execute(select(Person.id).where(Person.is_root == True)).first()  # noqa: E712
    return p[0] if p else None


def sosa_map(db: Session, root: Optional[str] = None) -> dict[str, list[int]]:
    """{person_id: [numéros Sosa]} pour tous les ancêtres de la racine (racine incluse)."""
    root = root or root_id(db)
    if not root:
        return {}
    sex = dict(db.execute(select(Person.id, Person.sex)).all())
    parents: dict[str, list[tuple[str, str]]] = {}
    for parent_id, child_id, rtype in db.execute(select(ParentChild.parent_id, ParentChild.child_id, ParentChild.relation_type)).all():
        if rtype in LINEAL:
            parents.setdefault(child_id, []).append((parent_id, rtype))
    out: dict[str, list[int]] = {}
    frontier = [(root, 1)]
    while frontier:
        nxt = []
        for pid, n in frontier:
            out.setdefault(pid, [])
            if n in out[pid]:
                continue
            out[pid].append(n)
            if n.bit_length() > MAX_GENERATIONS:
                continue
            slots: dict[int, str] = {}
            for parent_id, rtype in sorted(parents.get(pid, []), key=lambda t: (RANK.get(t[1], 9), {"M": 0, "F": 1}.get(sex.get(t[0]) or "", 2))):
                s = sex.get(parent_id)
                want = 0 if s == "M" else 1 if s == "F" else (0 if 0 not in slots else 1)
                if want not in slots:
                    slots[want] = parent_id
            for off, parent_id in slots.items():
                nxt.append((parent_id, n * 2 + off))
        frontier = nxt
    for v in out.values():
        v.sort()
    return out


def generation_of(sosa: int) -> int:
    """Génération d'un numéro Sosa : 1 → 1 (racine), 2-3 → 2, 4-7 → 3…"""
    return sosa.bit_length()
