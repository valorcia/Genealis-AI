"""Assistant IA conversationnel : s'appuie sur la base et les sources ; distingue faits, hypothèses, manques.

Fonctionne sans modèle (analyse d'intentions en français) et, si un fournisseur IA est configuré,
reformule la réponse à partir des données structurées (jamais l'inverse : le modèle n'invente pas de faits).
"""
from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai.providers import AIClient, AIUnavailable
from ..models import ChatMessage, Contradiction, Hypothesis, Person, ResearchTask
from ..services.persons import person_summary, search_persons, parents_of, citations_for
from ..services.tree import ancestors_graph
from .engine import enqueue, explore_branch
from .planner import prioritized_branches, missing_info_score

COUNTRY_WORDS = {"italien": "IT", "italienne": "IT", "italie": "IT", "polonais": "PL", "polonaise": "PL", "pologne": "PL",
                 "allemand": "DE", "allemande": "DE", "belge": "BE", "luxembourgeois": "LU"}


def _find_person(db: Session, text: str) -> Person | None:
    # 1. relation à la racine : "mon arrière-grand-père", "ma grand-mère"
    root = db.execute(select(Person).where(Person.is_root == True)).scalars().first()  # noqa: E712
    low = text.lower()
    if root:
        depth = None
        if "arrière-arrière-grand" in low or "arriere-arriere-grand" in low:
            depth = 4
        elif "arrière-grand" in low or "arriere-grand" in low:
            depth = 3
        elif "grand-père" in low or "grand-mère" in low or "grand-parent" in low or "grands-parents" in low:
            depth = 2
        elif re.search(r"\b(mon père|ma mère|mes parents)\b", low):
            depth = 1
        if depth:
            g = ancestors_graph(db, root.id, depth)
            cands = [n for n in g["nodes"] if n["generation"] == depth]
            male = "père" in low
            female = "mère" in low
            if male:
                cands = [n for n in cands if n["sex"] == "M"] or cands
            elif female:
                cands = [n for n in cands if n["sex"] == "F"] or cands
            if len(cands) == 1:
                return db.get(Person, cands[0]["id"])
    # 2. nom propre cité
    words = re.findall(r"[A-ZÀ-Ý][\wÀ-ÿ'\-]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ'\-]+)*", text)
    for w in sorted(words, key=len, reverse=True):
        if w.lower() in ("recherche", "remonte", "vérifie", "verifie", "montre", "quels", "pourquoi", "trouve", "meurthe", "nancy"):
            continue
        hits = search_persons(db, w, limit=3)
        if hits:
            return hits[0]
    return None


def _facts_block(db: Session, p: Person) -> str:
    s = person_summary(db, p)
    lines = [f"**{s.display_name}** — confiance {s.confidence.upper()}"]
    lines.append(f"- Naissance : {s.birth_display or 'inconnue'}{' à ' + s.birth_place if s.birth_place else ''}")
    lines.append(f"- Décès : {s.death_display or 'inconnu'}{' à ' + s.death_place if s.death_place else ''}")
    pars = parents_of(db, p.id)
    lines.append("- Parents : " + (", ".join(f"{pp.display_name()} ({r.confidence})" for pp, r in pars) or "inconnus"))
    cits = citations_for(db, "person", p.id)
    lines.append(f"- Sources rattachées : {len(cits)}")
    return "\n".join(lines)


def handle(db: Session, message: str) -> dict[str, Any]:
    low = message.lower().strip()
    meta: dict[str, Any] = {"intent": "unknown"}
    reply = ""

    if re.search(r"\b(contradiction|incohérence|incoherence)s?\b", low):
        meta["intent"] = "contradictions"
        rows = db.execute(select(Contradiction).where(Contradiction.status == "open").order_by(Contradiction.severity)).scalars().all()
        if not rows:
            reply = "Aucune contradiction ouverte dans la base actuellement."
        else:
            reply = f"**{len(rows)} contradiction(s) ouverte(s)** :\n" + "\n".join(f"- [{c.severity.upper()}] {c.description}" for c in rows[:20])
    elif re.search(r"\b(document|acte)s? manquant", low) or "quels sont les documents" in low or "manque" in low:
        meta["intent"] = "missing"
        rows = prioritized_branches(db, 15)
        reply = "**Informations manquantes, par ordre de priorité de recherche :**\n" + "\n".join(
            f"- {r['name']} : {', '.join(_label(m) for m in r['missing'])} (score {r['score']}, archives probables {int(r['availability'] * 100)}%)"
            for r in rows) if rows else "Aucun manque détecté : toutes les personnes ont naissance, mariage, décès et parents."
    elif low.startswith("pourquoi") or "penses-tu" in low or "pourquoi penses" in low:
        meta["intent"] = "explain"
        p = _find_person(db, message)
        if not p:
            reply = "Je n'ai pas identifié la personne concernée. Précise son nom."
        else:
            det = p.confidence_details or {}
            pars = parents_of(db, p.id)
            reply = _facts_block(db, p) + "\n\n**Pourquoi ce niveau de confiance :**\n" + "\n".join(f"- {c}" for c in det.get("criteria", []) or ["Aucun critère calculé pour l'instant."])
            for pp, r in pars:
                crit = (r.confidence_details or {}).get("criteria", [])
                reply += f"\n\n**Filiation avec {pp.display_name()} ({r.confidence.upper()})** : " + " ; ".join(crit) if crit else f"\n\n**Filiation avec {pp.display_name()}** : non évaluée."
            hyps = db.execute(select(Hypothesis).where(Hypothesis.subject_person_id == p.id, Hypothesis.status == "open")).scalars().all()
            if hyps:
                reply += "\n\n**Hypothèses ouvertes :**\n" + "\n".join(f"- {h.title} (score {h.score or '—'})" for h in hyps[:10])
            reply += "\n\n_Faits établis = sources primaires rattachées ; hypothèses = non confirmées ; tout le reste est manquant._"
    elif re.search(r"\b(recherche|retrouve|trouve|remonte|vérifie|verifie|explore)\b", low):
        meta["intent"] = "research"
        country = next((c for w, c in COUNTRY_WORDS.items() if w in low), None)
        p = _find_person(db, message)
        if country and not p:
            # branche par pays d'origine
            cands = [pp for pp in db.execute(select(Person)).scalars()
                     if any((e.place and (e.place.country_code == country)) for e in pp.events)]
            if not cands:
                reply = f"Aucune personne de la base n'a d'événement situé dans ce pays ({country}). Ajoute un lieu de naissance pour cibler la branche."
            else:
                tasks = []
                for pp in cands[:5]:
                    tasks.extend(explore_branch(db, pp.id, generations=2))
                reply = f"J'ai planifié {len(tasks)} recherche(s) sur la branche {country} à partir de : " + ", ".join(pp.display_name() for pp in cands[:5]) + "."
                meta["task_ids"] = [t.id for t in tasks]
        elif p:
            if "parent" in low or "remonte" in low or "explore" in low:
                tasks = explore_branch(db, p.id, generations=3 if "remonte" in low else 1)
                reply = f"Enquête planifiée pour **{p.display_name()}** : {len(tasks)} tâche(s) (acte de naissance, parents, mariage des parents). " \
                        "Suis l'avancement dans « Enquêtes IA »."
                meta["task_ids"] = [t.id for t in tasks]
            elif "décès" in low or "deces" in low:
                t = enqueue(db, "find_death", p.id)
                reply = f"Recherche de l'acte de décès de **{p.display_name()}** planifiée."
                meta["task_ids"] = [t.id]
            elif "mariage" in low:
                t = enqueue(db, "find_marriage", p.id)
                reply = f"Recherche de l'acte de mariage de **{p.display_name()}** planifiée."
                meta["task_ids"] = [t.id]
            else:
                t = enqueue(db, "find_birth", p.id)
                reply = f"Recherche de l'acte de naissance de **{p.display_name()}** planifiée."
                meta["task_ids"] = [t.id]
            mode = __import__("genealis.services.settings_service", fromlist=["get"]).get(db, "autonomy_mode", 1)
            if int(mode) == 1:
                reply += "\n\nMode assisté : la tâche attend ton accord dans « Enquêtes IA »."
        else:
            m = re.search(r"entre\s+(\d{4})\s+et\s+(\d{4})", low)
            place_m = re.search(r"(?:à|a|dans)\s+([A-ZÀ-Ý][\wÀ-ÿ'\-]+)", message)
            if m or place_m:
                y1, y2 = (int(m.group(1)), int(m.group(2))) if m else (0, 9999)
                place = place_m.group(1) if place_m else None
                hits = []
                for pp in db.execute(select(Person)).scalars():
                    for e in pp.events:
                        if e.sort_year and y1 <= e.sort_year <= y2 and (not place or (place.lower() in ((e.place.name if e.place else e.place_original) or "").lower())):
                            hits.append(pp)
                            break
                reply = (f"**{len(hits)} personne(s)** avec un événement" + (f" à {place}" if place else "") + (f" entre {y1} et {y2}" if m else "") + " :\n"
                         + "\n".join(f"- {person_summary(db, h).display_name} ({person_summary(db, h).birth_year or '?'}–{person_summary(db, h).death_year or '?'})" for h in hits[:30])) if hits else "Aucune personne ne correspond à ces critères dans la base."
                meta["intent"] = "query"
            else:
                reply = "Précise la personne (nom, ou « mon arrière-grand-père ») ou la branche (« la branche italienne »)."
    elif "hypoth" in low:
        meta["intent"] = "hypotheses"
        rows = db.execute(select(Hypothesis).where(Hypothesis.status == "open").order_by(Hypothesis.created_at.desc())).scalars().all()
        reply = f"**{len(rows)} hypothèse(s) ouverte(s)** :\n" + "\n".join(f"- {h.title} (score {h.score or '—'})" for h in rows[:20]) if rows else "Aucune hypothèse ouverte."
    elif re.search(r"\b(enquête|enquete|recherches? en cours|tâches?|taches?)\b", low):
        meta["intent"] = "tasks"
        rows = db.execute(select(ResearchTask).where(ResearchTask.status.in_(["queued", "running", "waiting_user"]))).scalars().all()
        reply = f"**{len(rows)} enquête(s) active(s)** :\n" + "\n".join(f"- [{t.status}] {t.title}" for t in rows[:20]) if rows else "Aucune enquête active."
    else:
        p = _find_person(db, message)
        if p:
            meta["intent"] = "person"
            reply = _facts_block(db, p)
        else:
            reply = ("Je peux : rechercher les parents d'une personne, remonter une branche, vérifier des ancêtres, "
                     "lister les documents manquants, expliquer un niveau de confiance, montrer les contradictions, "
                     "ou lister les personnes d'un lieu et d'une période.")

    # Reformulation optionnelle par un modèle, strictement à partir des faits ci-dessus
    ai = AIClient(db)
    if ai.available() and meta["intent"] not in ("unknown",):
        try:
            r = ai.complete(
                "Tu es l'assistant de GENEALIS AI. Reformule la réponse ci-dessous en français clair et concis, "
                "sans ajouter aucun fait, nom, date ou lieu qui n'y figure pas. Garde la distinction entre faits établis, "
                "hypothèses et informations manquantes. Conserve le Markdown.",
                f"Question de l'utilisateur : {message}\n\nRéponse factuelle :\n{reply}", purpose="assistant", max_tokens=800)
            if r.text.strip():
                meta["rephrased_by"] = r.provider
                reply = r.text.strip()
        except AIUnavailable:
            pass
    db.add(ChatMessage(role="user", content=message))
    db.add(ChatMessage(role="assistant", content=reply, meta=meta))
    db.flush()
    return {"role": "assistant", "content": reply, "meta": meta}


def _label(m: str) -> str:
    return {"birth": "acte de naissance", "marriage": "acte de mariage", "death": "acte de décès", "parents": "parents"}.get(m, m)
