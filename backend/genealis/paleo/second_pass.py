"""Seconde analyse des passages difficiles, sur une découpe agrandie de la zone (avec contexte).

Jamais de remplacement silencieux : la lecture retenue reste celle de la première passe, marquée incertaine ;
la seconde passe ajoute des lectures alternatives classées et un avis (concordant / discordant / indécis).
Même concordante, une lecture reste une hypothèse tant qu'une personne ne l'a pas vérifiée.
"""
from __future__ import annotations

import copy
import re
from typing import Any, Optional

from sqlalchemy.orm import Session
from unidecode import unidecode

from ..models import DocumentReading
from . import preprocess, prompts
from .htr import GeminiHTR, HTRProvider, HTRRequest


def _norm(s: str | None) -> str:
    return re.sub(r"[^\w]+", "", unidecode(s or "").lower().replace("ſ", "s"))


def reference_words(lines: list[dict], passage: str, limit: int = 40) -> list[str]:
    """Mots du même document lus sans incertitude et partageant des lettres avec le passage (comparaison des formes)."""
    uncertain = {(_norm(u.get("text"))) for ln in lines for u in ln.get("uncertain") or []}
    letters = set(_norm(passage))
    seen, out = set(), []
    for ln in lines:
        for w in re.findall(r"[^\W\d_][\w'ſ]{2,}", ln.get("diplomatic") or ""):
            n = _norm(w)
            if n in seen or n in uncertain or "[" in w:
                continue
            seen.add(n)
            if letters & set(n):
                out.append(w)
    out.sort(key=lambda w: -len(letters & set(_norm(w))))
    return out[:limit]


def rank_alternatives(initial: str, initial_alts: list[str], sp: dict) -> list[dict]:
    ranked: list[dict] = []
    seen = {_norm(initial)}
    for r in sorted([x for x in sp.get("readings") or [] if isinstance(x, dict) and x.get("text")],
                    key=lambda x: -float(x.get("confidence") or 0)):
        n = _norm(str(r["text"]))
        if n and n not in seen:
            seen.add(n)
            ranked.append({"text": str(r["text"]), "confidence": max(0.0, min(1.0, float(r.get("confidence") or 0))),
                           "source": "second_pass", "evidence": r.get("evidence")})
    for a in initial_alts:
        n = _norm(a)
        if n and n not in seen:
            seen.add(n)
            ranked.append({"text": a, "confidence": None, "source": "first_pass"})
    return ranked


def recheck_passage(db: Session, reading: DocumentReading, image: bytes, line_n: int, *, passage: Optional[str] = None,
                    bbox: Optional[list[float]] = None, index: Optional[int] = None, provider: HTRProvider | None = None,
                    subjects: list[str] | None = None, guidance: str = "", scribe_text: str = "") -> dict:
    """Relit un passage d'une ligne sur une découpe agrandie. Met à jour (sans remplacer le texte) l'entrée incertaine."""
    lines = copy.deepcopy(reading.lines or [])
    line = next((ln for ln in lines if ln.get("n") == line_n), None)
    if line is None:
        raise ValueError(f"Ligne {line_n} introuvable")
    uncertain = line.setdefault("uncertain", [])
    entry: dict[str, Any] | None = None
    if index is not None and 0 <= index < len(uncertain):
        entry = uncertain[index]
    elif passage:
        entry = next((u for u in uncertain if u.get("text") == passage), None)
    if entry is None:  # passage choisi par l'utilisateur : nouvelle entrée incertaine (rien n'est remplacé)
        entry = {"text": passage or line.get("diplomatic") or "", "alternatives": [], "reason": "relecture demandée par l'utilisateur",
                 "confidence": 0.5, "bbox": bbox or line.get("bbox"), "bbox_is_line": bbox is None, "status": "uncertain"}
        uncertain.append(entry)
    region = bbox or entry.get("bbox") or line.get("bbox")
    if not region:
        raise ValueError("Pas de zone connue pour ce passage : sélectionnez-la sur l'image.")
    im = preprocess.open_oriented(image)
    data, mime, transform, size = preprocess.crop_region(im, region)
    prov = provider or GeminiHTR(db)
    user = prompts.second_pass_prompt(passage=entry["text"], line_text=line.get("diplomatic") or "",
                                      alternatives=entry.get("alternatives") or [],
                                      reference_words=reference_words(lines, entry["text"]), scribe_context=scribe_text,
                                      guidance=guidance)
    res = prov.read(HTRRequest(data, mime, prompts.SYSTEM_SECOND_PASS, user, purpose=f"seconde passe {reading.media_id}",
                               subject_person_ids=subjects, max_tokens=2000))
    sp = res.payload or {}
    best = str(sp.get("best") or "").strip() or None
    agrees = bool(best) and _norm(best) == _norm(entry["text"]) and sp.get("can_decide", True) is not False
    status = "concordant" if agrees else ("undecided" if not best or sp.get("can_decide") is False else "discordant")
    ranked = rank_alternatives(entry["text"], entry.get("alternatives") or [], sp)
    entry["second_pass"] = {"status": status, "best": best, "agrees": agrees, "notes": sp.get("notes"),
                            "readings": sp.get("readings") or [], "crop_bbox": list(transform.crop or []),
                            "sent_size": list(size), "engine": res.engine, "model": res.model, "cached": res.cached}
    entry["ranked"] = ranked
    entry["alternatives"] = [r["text"] for r in ranked][:8]
    # la lecture retenue reste celle de la ligne, toujours marquée incertaine
    entry["status"] = "second_pass_concordant" if agrees else "uncertain"
    if not agrees:
        entry["confidence"] = min(float(entry.get("confidence") or 0.5), 0.5)
    from .pipeline import save_lines

    save_lines(reading, lines)
    return entry


def run_second_pass(db: Session, reading: DocumentReading, image: bytes, *, provider: HTRProvider, limit: int = 6,
                    subjects: list[str] | None = None, guidance: str = "", scribe_text: str = "") -> int:
    """Seconde passe automatique sur les passages les plus incertains ayant une zone (plafonnée à `limit`)."""
    todo = []
    for ln in reading.lines or []:
        for j, u in enumerate(ln.get("uncertain") or []):
            if (u.get("bbox") or ln.get("bbox")) and not u.get("second_pass"):
                todo.append((float(u.get("confidence") or 0.5), ln["n"], j))
    todo.sort()
    done = 0
    for _, n, j in todo[:limit]:
        recheck_passage(db, reading, image, n, index=j, provider=provider, subjects=subjects, guidance=guidance,
                        scribe_text=scribe_text)
        done += 1
    if len(todo) > limit:
        reading.warnings = list(reading.warnings or []) + [
            f"{len(todo) - limit} passage(s) incertain(s) non relu(s) automatiquement (plafond de {limit} par document) : "
            "utilisez « Relire cette zone »."]
    return done
