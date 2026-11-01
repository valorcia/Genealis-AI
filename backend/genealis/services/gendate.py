"""Dates généalogiques : exactes, approximatives, périodes, inconnues, calendriers historiques.

Produit une représentation normalisée (date_kind, date_start, date_end, calendar, sort_year)
tout en conservant la forme originale.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from datetime import date, timedelta
from typing import Optional

MONTHS_FR = {
    "janvier": 1, "fevrier": 2, "février": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7,
    "aout": 8, "août": 8, "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12, "décembre": 12,
    "jan": 1, "fev": 2, "fév": 2, "mar": 3, "avr": 4, "jun": 6, "jul": 7, "aou": 8, "sep": 9, "oct": 10,
    "nov": 11, "dec": 12, "déc": 12,
    # GEDCOM / anglais
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12, "feb": 2, "apr": 4, "aug": 8,
    # italien
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6, "luglio": 7,
    "agosto": 8, "settembre": 9, "ottobre": 10, "dicembre": 12,
    # latin
    "januarii": 1, "februarii": 2, "martii": 3, "aprilis": 4, "maii": 5, "junii": 6, "julii": 7,
    "augusti": 8, "septembris": 9, "octobris": 10, "novembris": 11, "decembris": 12,
    # polonais
    "stycznia": 1, "lutego": 2, "marca": 3, "kwietnia": 4, "maja": 5, "czerwca": 6, "lipca": 7,
    "sierpnia": 8, "września": 9, "wrzesnia": 9, "października": 10, "pazdziernika": 10, "listopada": 11,
    "grudnia": 12,
    # allemand
    "januar": 1, "februar": 2, "märz": 3, "maerz": 3, "juni": 6, "juli": 7, "oktober": 10, "dezember": 12,
}

REPUBLICAN_MONTHS = [
    "vendemiaire", "brumaire", "frimaire", "nivose", "pluviose", "ventose", "germinal", "floreal",
    "prairial", "messidor", "thermidor", "fructidor", "sansculottides",
]
ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10,
         "xi": 11, "xii": 12, "xiii": 13, "xiv": 14}


def _strip_accents(s: str) -> str:
    from unidecode import unidecode

    return unidecode(s)


@dataclass
class GenDate:
    original: Optional[str]
    kind: str = "unknown"  # exact | approx | before | after | between | calculated | unknown
    start: Optional[str] = None  # ISO partiel
    end: Optional[str] = None
    calendar: str = "gregorian"
    sort_year: Optional[int] = None

    def to_dict(self) -> dict:
        return asdict(self)

    def display(self) -> str:
        if self.kind == "unknown":
            return "?"
        s = _fmt(self.start)
        if self.kind == "exact":
            return s
        if self.kind == "approx":
            return f"vers {s}"
        if self.kind == "calculated":
            return f"calc. {s}"
        if self.kind == "before":
            return f"avant {s}"
        if self.kind == "after":
            return f"après {s}"
        if self.kind == "between":
            return f"entre {s} et {_fmt(self.end)}"
        return s

    @property
    def year(self) -> Optional[int]:
        return self.sort_year


def _fmt(iso: Optional[str]) -> str:
    if not iso:
        return "?"
    parts = iso.split("-")
    if len(parts) == 3:
        return f"{int(parts[2]):02d}/{int(parts[1]):02d}/{parts[0]}"
    if len(parts) == 2:
        return f"{int(parts[1]):02d}/{parts[0]}"
    return parts[0]


def _iso(y: int, m: Optional[int] = None, d: Optional[int] = None) -> str:
    if m and d:
        return f"{y:04d}-{m:02d}-{d:02d}"
    if m:
        return f"{y:04d}-{m:02d}"
    return f"{y:04d}"


def republican_to_gregorian(day: int, month_index: int, year: int) -> date:
    """Convertit une date du calendrier républicain (méthode de l'équinoxe, années I-XIV)."""
    # 1er vendémiaire de chaque année (Paris, équinoxe d'automne)
    starts = {1: date(1792, 9, 22), 2: date(1793, 9, 22), 3: date(1794, 9, 22), 4: date(1795, 9, 23),
              5: date(1796, 9, 22), 6: date(1797, 9, 22), 7: date(1798, 9, 22), 8: date(1799, 9, 23),
              9: date(1800, 9, 23), 10: date(1801, 9, 23), 11: date(1802, 9, 23), 12: date(1803, 9, 24),
              13: date(1804, 9, 23), 14: date(1805, 9, 23)}
    if year not in starts:
        raise ValueError("année républicaine hors de l'intervalle I-XIV")
    return starts[year] + timedelta(days=month_index * 30 + (day - 1))


_RE_ISO = re.compile(r"^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$")
_RE_DMY = re.compile(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$")
_RE_MY = re.compile(r"^(\d{1,2})[/.\-](\d{4})$")
_RE_DAY_MONTH_YEAR = re.compile(r"^(?:le\s+)?(\d{1,2})(?:er)?\s+([a-zéûô]+)\s+(\d{4})$", re.I)
_RE_MONTH_YEAR = re.compile(r"^([a-zéûô]+)\s+(\d{4})$", re.I)
_RE_YEAR = re.compile(r"^(\d{3,4})$")
_RE_REPUBLICAN = re.compile(r"^(\d{1,2})(?:er)?\s+([a-zéô]+)\s+an\s+([ivx]+|\d{1,2})$", re.I)


def _parse_simple(text: str) -> Optional[tuple[str, int, str]]:
    """Retourne (iso, year, calendar) pour une date simple, sans modificateur."""
    t = text.strip().strip(".").strip()
    if not t:
        return None
    m = _RE_ISO.match(t)
    if m:
        y, mo, d = int(m.group(1)), m.group(2), m.group(3)
        return _iso(y, int(mo) if mo else None, int(d) if d else None), y, "gregorian"
    m = _RE_DMY.match(t)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return _iso(y, mo, d), y, "gregorian"
    m = _RE_MY.match(t)
    if m:
        mo, y = int(m.group(1)), int(m.group(2))
        if 1 <= mo <= 12:
            return _iso(y, mo), y, "gregorian"
    m = _RE_REPUBLICAN.match(_strip_accents(t))
    if m:
        d = int(m.group(1))
        mon = m.group(2).lower()
        yr = m.group(3).lower()
        year = ROMAN.get(yr) or (int(yr) if yr.isdigit() else None)
        if mon in REPUBLICAN_MONTHS and year:
            try:
                g = republican_to_gregorian(d, REPUBLICAN_MONTHS.index(mon), year)
                return g.isoformat(), g.year, "republican"
            except ValueError:
                return None
    m = _RE_DAY_MONTH_YEAR.match(t)
    if m:
        d, mon, y = int(m.group(1)), m.group(2).lower(), int(m.group(3))
        mo = MONTHS_FR.get(mon) or MONTHS_FR.get(_strip_accents(mon))
        if mo:
            return _iso(y, mo, d), y, "gregorian"
    m = _RE_MONTH_YEAR.match(t)
    if m:
        mon, y = m.group(1).lower(), int(m.group(2))
        mo = MONTHS_FR.get(mon) or MONTHS_FR.get(_strip_accents(mon))
        if mo:
            return _iso(y, mo), y, "gregorian"
    m = _RE_YEAR.match(t)
    if m:
        y = int(m.group(1))
        return _iso(y), y, "gregorian"
    return None


def parse_gendate(text: Optional[str]) -> GenDate:
    """Analyse une date libre (français, GEDCOM, ISO, républicain)."""
    if text is None or not str(text).strip():
        return GenDate(original=text, kind="unknown")
    original = str(text)
    t = original.strip()
    low = _strip_accents(t.lower())

    # Modificateurs
    between = re.match(r"^(?:entre|bet|between)\s+(.+?)\s+(?:et|and)\s+(.+)$", low)
    if between:
        a = _parse_simple(between.group(1))
        b = _parse_simple(between.group(2))
        if a and b:
            return GenDate(original, "between", a[0], b[0], a[2], a[1])
    for prefix, kind in (("vers", "approx"), ("abt", "approx"), ("about", "approx"), ("circa", "approx"),
                         ("ca", "approx"), ("env", "approx"), ("environ", "approx"), ("~", "approx"),
                         ("avant", "before"), ("bef", "before"), ("before", "before"), ("<", "before"),
                         ("apres", "after"), ("aft", "after"), ("after", "after"), (">", "after"),
                         ("cal", "calculated"), ("est", "calculated"), ("calc", "calculated")):
        if low.startswith(prefix + " ") or low.startswith(prefix + ".") or (len(prefix) == 1 and low.startswith(prefix)):
            rest = t[len(prefix):].lstrip(". ")
            simple = _parse_simple(rest)
            if simple:
                return GenDate(original, kind, simple[0], None, simple[2], simple[1])
    # GEDCOM "FROM x TO y"
    span = re.match(r"^(?:from|de)\s+(.+?)\s+(?:to|a)\s+(.+)$", low)
    if span:
        a = _parse_simple(span.group(1))
        b = _parse_simple(span.group(2))
        if a and b:
            return GenDate(original, "between", a[0], b[0], a[2], a[1])
    simple = _parse_simple(t)
    if simple:
        iso, y, cal = simple
        kind = "exact" if len(iso) == 10 else ("approx" if len(iso) == 4 else "exact")
        # Une année seule reste "exact" au sens d'une précision à l'année, mais signalée comme année seule.
        return GenDate(original, "exact", iso, None, cal, y)
    # Année isolée dans un texte libre ("né en 1895 à Nancy")
    m = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", t)
    if m:
        return GenDate(original, "approx", _iso(int(m.group(1))), None, "gregorian", int(m.group(1)))
    return GenDate(original, "unknown")


def year_of(iso: Optional[str]) -> Optional[int]:
    if not iso:
        return None
    try:
        return int(iso[:4])
    except ValueError:
        return None


def to_gedcom(gd: GenDate) -> Optional[str]:
    def one(iso: Optional[str]) -> str:
        if not iso:
            return ""
        parts = iso.split("-")
        names = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
        if len(parts) == 3:
            return f"{int(parts[2])} {names[int(parts[1]) - 1]} {parts[0]}"
        if len(parts) == 2:
            return f"{names[int(parts[1]) - 1]} {parts[0]}"
        return parts[0]

    if gd.kind == "unknown" or not gd.start:
        return None
    if gd.kind == "exact":
        return one(gd.start)
    if gd.kind == "approx":
        return f"ABT {one(gd.start)}"
    if gd.kind == "before":
        return f"BEF {one(gd.start)}"
    if gd.kind == "after":
        return f"AFT {one(gd.start)}"
    if gd.kind == "between":
        return f"BET {one(gd.start)} AND {one(gd.end)}"
    if gd.kind == "calculated":
        return f"CAL {one(gd.start)}"
    return one(gd.start)
