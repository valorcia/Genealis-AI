"""Mesure de la qualité d'une lecture sur un texte de référence VÉRIFIÉ : CER et WER (distance de Levenshtein).

CER = (substitutions + suppressions + insertions de caractères) / nombre de caractères de la référence.
WER = même calcul sur les mots. 0 = identique ; 0,05 = 5 % d'erreurs. Une transcription produite n'est pas une
transcription correcte : seule cette comparaison à une référence relue par un humain mesure la qualité.

Références : `genealis/data/paleo_refs/*.json` au format
{id, title, script_type, language, period, image_url_public?, licence, reference_text, notes, synthetic?}.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Optional

from rapidfuzz.distance import Levenshtein

REFS_DIR = Path(__file__).resolve().parent.parent / "data" / "paleo_refs"
_MARK = re.compile(r"\[\?([^\]]*)\]")


def strip_markup(text: str) -> str:
    """Retire les marques éditoriales de la transcription ([?mot] → mot, [illisible] conservé tel quel)."""
    return _MARK.sub(r"\1", text or "")


def normalize(text: str) -> str:
    """Normalisation « souple » : minuscules, sans accents ni ponctuation, ſ → s, u/v et i/j unifiés, espaces réduits."""
    t = strip_markup(text).replace("ſ", "s").replace("^", "")
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    t = t.replace("v", "u").replace("j", "i")
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def exact(text: str) -> str:
    """Comparaison stricte : seuls les espaces multiples et les fins de ligne sont uniformisés."""
    return re.sub(r"[ \t]+", " ", strip_markup(text).replace("\r\n", "\n")).strip()


def cer(reference: str, hypothesis: str) -> Optional[float]:
    if not reference:
        return None
    return Levenshtein.distance(reference, hypothesis) / len(reference)


def wer(reference: str, hypothesis: str) -> Optional[float]:
    ref, hyp = reference.split(), hypothesis.split()
    if not ref:
        return None
    return Levenshtein.distance(ref, hyp) / len(ref)


def _r(v: Optional[float]) -> Optional[float]:
    return None if v is None else round(v, 4)


def compare(reference_text: str, hypothesis_text: str) -> dict[str, Any]:
    """Rapport complet : global (strict et normalisé) et ligne par ligne."""
    ref_e, hyp_e = exact(reference_text), exact(hypothesis_text)
    ref_flat, hyp_flat = re.sub(r"\s+", " ", ref_e), re.sub(r"\s+", " ", hyp_e)
    ref_n, hyp_n = normalize(reference_text), normalize(hypothesis_text)
    ref_lines = [ln for ln in ref_e.split("\n")]
    hyp_lines = [ln for ln in hyp_e.split("\n")]
    per_line = []
    for i in range(max(len(ref_lines), len(hyp_lines))):
        r = ref_lines[i].strip() if i < len(ref_lines) else ""
        h = hyp_lines[i].strip() if i < len(hyp_lines) else ""
        per_line.append({"n": i + 1, "reference": r, "hypothesis": h, "cer": _r(cer(r, h)) if r else (None if not h else 1.0),
                         "cer_normalized": _r(cer(normalize(r), normalize(h))) if normalize(r) else None,
                         "distance": Levenshtein.distance(r, h)})
    return {"cer": _r(cer(ref_flat, hyp_flat)), "wer": _r(wer(ref_flat, hyp_flat)),
            "cer_normalized": _r(cer(ref_n, hyp_n)), "wer_normalized": _r(wer(ref_n, hyp_n)),
            "reference_chars": len(ref_flat), "reference_words": len(ref_flat.split()),
            "hypothesis_chars": len(hyp_flat), "lines_reference": len(ref_lines), "lines_hypothesis": len(hyp_lines),
            "line_count_matches": len(ref_lines) == len(hyp_lines), "lines": per_line,
            "explanation": ("CER = part de caractères à corriger, WER = part de mots à corriger (0 = parfait). "
                            "« normalisé » ignore majuscules, accents, ponctuation, ſ/s, u/v et i/j.")}


def load_refs(directory: Path | None = None) -> list[dict]:
    d = directory or REFS_DIR
    out = []
    for p in sorted(d.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and data.get("id") and data.get("reference_text"):
            out.append(data)
    return out


def get_ref(ref_id: str, directory: Path | None = None) -> Optional[dict]:
    return next((r for r in load_refs(directory) if r["id"] == ref_id), None)
