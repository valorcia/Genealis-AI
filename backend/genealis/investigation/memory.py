"""Mémoire persistante d'une enquête (colonne JSON `Investigation.memory`).

Structure (toutes les listes sont dédupliquées et bornées) :

    {
      "person_id": "...", "objective": "...",
      "sites":     [{"key", "domain", "first_seen", "visits"}],
      "pages":     [{"key", "url", "title", "outcome", "ts", "task_id"}],
      "queries":   [{"key", "query", "strategy", "ts", "task_id", "outcome", "count"}],
      "documents": [{"key", "media_id", "url", "archival_reference", "ts", "status"}],
      "results":   [{"key", "query_key", "findings": [...], "ts"}],
      "failures":  [{"key", "what", "reason", "ts", "task_id"}],
      "hypotheses":[{"key", "hypothesis_id", "title", "ts"}],
      "filiations":[{"key", "relation_id", "child_id", "parent_id", "source_id", "ts"}],
      "next_searches": [{"task_id", "title", "priority"}],
      "blocked":   {"scope", "message", "retry_after_until"} | absent
    }

Une recherche déjà faite n'est jamais refaite : `already_done(inv, "queries", texte)` et `result_for(inv, texte)`
permettent de reprendre après un redémarrage sans renvoyer la même requête (ni payer un nouvel appel IA).
"""
from __future__ import annotations

import re
from typing import Any, Optional

from ..models import Investigation, utcnow

LISTS = ("sites", "pages", "queries", "documents", "results", "failures", "hypotheses", "filiations")
MAX_ITEMS = 500


def norm_key(value: Any) -> str:
    """Clé de déduplication : minuscules, sans accents ni ponctuation, espaces réduits."""
    try:
        from unidecode import unidecode

        s = unidecode(str(value or ""))
    except ImportError:  # pragma: no cover
        s = str(value or "")
    s = re.sub(r"[^a-z0-9:/._-]+", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()[:300]


def load(inv: Investigation) -> dict:
    mem = dict(inv.memory or {})
    for k in LISTS:
        mem[k] = list(mem.get(k) or [])
    mem.setdefault("next_searches", [])
    return mem


def save(inv: Investigation, mem: dict) -> None:
    """Réaffecte un NOUVEL objet : SQLAlchemy ne suit pas les mutations JSON en place."""
    for k in LISTS:
        if len(mem.get(k) or []) > MAX_ITEMS:
            mem[k] = mem[k][-MAX_ITEMS:]
    inv.memory = dict(mem)


def _find(mem: dict, key_list: str, key: str) -> Optional[dict]:
    return next((x for x in mem.get(key_list) or [] if x.get("key") == key), None)


def add(inv: Investigation, key_list: str, item: dict, *, key: Any) -> bool:
    """Ajoute `item` à la liste si sa clé n'y figure pas ; sinon met à jour l'entrée existante. Renvoie True si nouveau."""
    if key_list not in LISTS:
        raise ValueError(f"Liste de mémoire inconnue : {key_list}")
    mem = load(inv)
    k = norm_key(key)
    existing = _find(mem, key_list, k)
    if existing is not None:
        merged = {**existing, **{a: b for a, b in item.items() if b is not None}, "key": k}
        mem[key_list] = [merged if x.get("key") == k else x for x in mem[key_list]]
        save(inv, mem)
        return False
    mem[key_list].append({"key": k, "ts": utcnow().isoformat(timespec="seconds"), **item})
    save(inv, mem)
    return True


def already_done(inv: Investigation, key_list: str, key: Any) -> bool:
    """Vrai si cette requête / page / ce document figure déjà dans la mémoire (avec une issue connue)."""
    entry = _find(load(inv), key_list, norm_key(key))
    if entry is None:
        return False
    return entry.get("outcome") not in ("started",) and entry.get("status") not in ("started",)


def get(inv: Investigation, key_list: str, key: Any) -> Optional[dict]:
    return _find(load(inv), key_list, norm_key(key))


# ---- raccourcis ----
def record_query(inv: Investigation, query: str, *, strategy: str, task_id: str | None, outcome: str, count: int = 0) -> bool:
    return add(inv, "queries", {"query": query, "strategy": strategy, "task_id": task_id, "outcome": outcome, "count": count},
               key=f"{strategy}:{query}")


def query_done(inv: Investigation, query: str, strategy: str) -> bool:
    return already_done(inv, "queries", f"{strategy}:{query}")


def record_result(inv: Investigation, query: str, strategy: str, findings: list[dict], extra: dict | None = None) -> None:
    add(inv, "results", {"query": query, "strategy": strategy, "findings": findings[:50], **(extra or {})},
        key=f"{strategy}:{query}")


def result_for(inv: Investigation, query: str, strategy: str) -> Optional[dict]:
    return get(inv, "results", f"{strategy}:{query}")


def record_site(inv: Investigation, domain: str | None) -> None:
    if not domain:
        return
    mem = load(inv)
    k = norm_key(domain)
    e = _find(mem, "sites", k)
    if e:
        e = {**e, "visits": int(e.get("visits") or 0) + 1}
        mem["sites"] = [e if x.get("key") == k else x for x in mem["sites"]]
        save(inv, mem)
    else:
        add(inv, "sites", {"domain": domain, "visits": 1}, key=domain)


def record_page(inv: Investigation, url: str, *, title: str | None = None, outcome: str = "ok",
                task_id: str | None = None) -> bool:
    return add(inv, "pages", {"url": url, "title": title, "outcome": outcome, "task_id": task_id}, key=url)


def record_document(inv: Investigation, media_id: str, *, url: str | None = None, archival_reference: str | None = None,
                    status: str = "found") -> bool:
    return add(inv, "documents", {"media_id": media_id, "url": url, "archival_reference": archival_reference,
                                  "status": status}, key=media_id)


def record_failure(inv: Investigation, what: str, reason: str, task_id: str | None = None) -> None:
    add(inv, "failures", {"what": what, "reason": reason[:500], "task_id": task_id}, key=f"{what}:{reason[:80]}")


def record_hypothesis(inv: Investigation, hypothesis_id: str, title: str) -> None:
    add(inv, "hypotheses", {"hypothesis_id": hypothesis_id, "title": title}, key=hypothesis_id)


def record_filiation(inv: Investigation, relation_id: str, *, child_id: str, parent_id: str, source_id: str | None) -> None:
    add(inv, "filiations", {"relation_id": relation_id, "child_id": child_id, "parent_id": parent_id, "source_id": source_id},
        key=relation_id)


def set_next_searches(inv: Investigation, items: list[dict]) -> None:
    mem = load(inv)
    mem["next_searches"] = items[:20]
    save(inv, mem)


def set_blocked(inv: Investigation, info: dict | None) -> None:
    mem = load(inv)
    if info:
        mem["blocked"] = info
    else:
        mem.pop("blocked", None)
    save(inv, mem)


def summary(inv: Investigation) -> dict:
    mem = load(inv)
    return {k: len(mem.get(k) or []) for k in LISTS}
