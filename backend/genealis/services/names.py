"""Normalisation et comparaison de noms (variantes orthographiques, phonétique)."""
from __future__ import annotations

import re

from rapidfuzz import fuzz
from unidecode import unidecode

PARTICLES = {"de", "du", "des", "le", "la", "von", "van", "di", "da", "del", "della", "d", "l"}


def normalize_name(name: str | None) -> str:
    if not name:
        return ""
    s = unidecode(name).lower()
    s = re.sub(r"[^a-z\s'-]", " ", s)
    s = s.replace("'", " ").replace("-", " ")
    tokens = [t for t in s.split() if t]
    return " ".join(tokens)


def surname_key(name: str | None) -> str:
    """Clé de comparaison de patronyme (sans particules, sans doubles lettres)."""
    tokens = [t for t in normalize_name(name).split() if t not in PARTICLES]
    s = "".join(tokens)
    for prefix in ("della", "delle", "des", "de", "du", "la", "le", "von", "van", "di", "da"):
        if s.startswith(prefix) and len(s) - len(prefix) >= 4:
            s = s[len(prefix):]
            break
    s = re.sub(r"(.)\1+", r"\1", s)  # doubles lettres
    s = re.sub(r"[hy]", lambda m: "" if m.group(0) == "h" else "i", s)
    s = s.replace("ph", "f").replace("ck", "k").replace("qu", "k").replace("c", "k").replace("w", "v")
    s = s.replace("z", "s").replace("x", "s")
    return s


def soundex_fr(name: str | None) -> str:
    """Variante simplifiée de Soundex adaptée au français."""
    s = surname_key(name)
    if not s:
        return ""
    first = s[0]
    codes = {"b": "1", "p": "1", "f": "1", "v": "1", "k": "2", "g": "2", "j": "2", "s": "2", "d": "3",
             "t": "3", "l": "4", "m": "5", "n": "5", "r": "6"}
    out = first
    prev = codes.get(first, "")
    for ch in s[1:]:
        c = codes.get(ch, "")
        if c and c != prev:
            out += c
        prev = c
    return (out + "000")[:4]


def name_similarity(a: str | None, b: str | None) -> float:
    """Score 0-100 de similarité entre deux noms (tolère variantes orthographiques)."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 100.0
    ka, kb = surname_key(a), surname_key(b)
    if ka and ka == kb:
        return 92.0
    score = max(fuzz.ratio(na, nb), fuzz.token_sort_ratio(na, nb))
    if soundex_fr(a) == soundex_fr(b) and soundex_fr(a):
        score = max(score, 80.0)
    return float(score)


def given_names_similarity(a: str | None, b: str | None) -> float:
    """Compare des listes de prénoms : le premier prénom pèse le plus."""
    ta = normalize_name(a).split()
    tb = normalize_name(b).split()
    if not ta or not tb:
        return 0.0
    first = fuzz.ratio(ta[0], tb[0])
    overlap = len(set(ta) & set(tb)) / max(len(set(ta) | set(tb)), 1)
    score = 0.7 * first + 30 * overlap
    if ta[0] == tb[0]:
        score = max(score, 85.0)
    return float(min(score, 100.0))
