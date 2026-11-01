"""Niveaux de preuve et enregistrement des filiations découvertes par l'enquête.

Règle (docs/ARCHITECTURE_V04.md §8) : une filiation n'est enregistrée que si
  1. le document est un acte PRIMAIRE (naissance, baptême, mariage, décès… original, pas un arbre en ligne) ;
  2. il nomme explicitement les parents, avec une lecture suffisamment sûre ;
  3. la personne est identifiée AU-DELÀ DU SEUL NOM (date, lieu, âge, conjoint…), sans homonyme compatible dans l'arbre ;
  4. les règles d'autonomie le permettent (mode 3 « autonome contrôlé ») — sinon proposition à valider.
Dans tous les autres cas : hypothèse « À VÉRIFIER » (jamais supprimée, hypothèses concurrentes conservées)
ou question à l'utilisateur. Toute divergence avec l'arbre devient une contradiction visible.

Chaque relation enregistrée garde : la source (document original, URL, cote, transcription), une citation avec
l'extrait et la zone de l'image, la confiance calculée et la justification.
"""
from __future__ import annotations

import hashlib
import re
from typing import Optional

from sqlalchemy.orm import Session

from ..models import (Citation, Contradiction, Hypothesis, Investigation, InvestigationTask, Media, ParentChild, Person,
                      PersonMention, Source, utcnow)
from ..schemas import EventIn, PersonIn, RelationIn
from ..services import settings_service as cfg
from ..services.confidence import score_relation
from ..services.interpret import DOC_LABEL, PRIMARY_DOCS, REGISTER_TYPE, _excerpt
from ..services.matching import Candidate, find_matches, score_candidate
from ..services.names import given_names_similarity, name_similarity
from ..services.persons import add_event, add_relation, create_person, find_or_create_family, index_person, parents_of
from . import memory, queue
from .network import full_name, name_score

TREE_DOMAINS = ("geneanet", "roglo", "myheritage", "ancestry", "wikitree", "geni.com", "familysearch.org/tree", "filae.com/arbre")
READING_MIN = 0.5  # en dessous : nom mal lu → jamais une preuve
PARENT_ROLES = ("father", "mother")


# ------------------------------------------------------------------ source
def reliability_of(doc_type: str | None, url: str | None) -> str:
    if url and any(d in url.lower() for d in TREE_DOMAINS):
        return "derivative"  # arbre en ligne : piste, jamais une preuve
    if doc_type in PRIMARY_DOCS:
        return "primary"
    if doc_type in ("decennial_table", "death_notice", "other"):
        return "secondary"
    return "unknown"


def _year(ex: dict) -> Optional[int]:
    for k in ("event_date_normalized", "date_normalized"):
        v = ex.get(k)
        if isinstance(v, dict) and v.get("sort_year"):
            return int(v["sort_year"])
    m = re.search(r"\b(1[5-9]\d{2}|20\d{2})\b", " ".join(str(ex.get(k) or "") for k in ("event_date_iso", "date_iso", "event_date", "date")))
    return int(m.group(1)) if m else None


def ensure_source(db: Session, inv: Investigation | None, media: Media, *, extraction: dict, transcription: str,
                  url: str | None = None, archival_reference: str | None = None, reading_id: str | None = None,
                  translation: str | None = None, language: str | None = None) -> Source:
    """Source de l'acte : document original (média), URL, cote, transcription, fiabilité. Jamais dupliquée."""
    doc = extraction.get("document_type") or "other"
    src = db.get(Source, media.source_id) if media.source_id else None
    if src is None and media.sha256:
        src = db.query(Source).filter(Source.content_hash == media.sha256).first()
    year, place = _year(extraction), extraction.get("place")
    ref = archival_reference or extraction.get("archival_reference") or extraction.get("reference")
    if not ref and extraction.get("act_number"):
        ref = f"acte n° {extraction['act_number']}"
    if src is None:
        subj = next((p for p in extraction.get("persons") or [] if p.get("role") in ("subject", "deceased")), None)
        title = DOC_LABEL.get(doc, "Document")
        if subj:
            title += " de " + " ".join(x for x in (subj.get("given_names"), (subj.get("surname") or "").upper()) if x)
        title += "".join(f", {x}" for x in ((place or "").split(",")[0] or None, str(year) if year else None) if x)
        src = Source(title=title[:512], connector_id="investigation", content_hash=media.sha256 or
                     hashlib.sha256((url or media.id).encode()).hexdigest())
        db.add(src)
    src.repository = src.repository or extraction.get("repository") or (re.sub(r"^www\.", "", (url or "").split("/")[2]) if url and "//" in url else None)
    src.commune = src.commune or ((place or "").split(",")[0] or None)
    src.register_type = src.register_type or REGISTER_TYPE.get(doc)
    src.reference = src.reference or ref
    src.year = src.year or year
    src.url = src.url or url
    src.consulted_at = src.consulted_at or utcnow()
    src.transcription = src.transcription or transcription or None
    src.translation = src.translation or translation or extraction.get("translation_fr")
    src.language = src.language or (language if language and language != "?" else None)
    if src.reliability in (None, "unknown"):
        src.reliability = reliability_of(doc, url)
    src.local_copy_path, src.local_copy_allowed = src.local_copy_path or media.id, True
    src.extra = {**(src.extra or {}), "media_id": media.id, "reading_id": reading_id, "document_type": doc,
                 "act_number": extraction.get("act_number"), "investigation_id": inv.id if inv else None,
                 "ai_reading": True, "warning": "Transcription produite par l'IA : à vérifier sur l'image originale."}
    db.flush()
    media.source_id = src.id
    db.query(PersonMention).filter(PersonMention.media_id == media.id, PersonMention.source_id.is_(None)) \
        .update({PersonMention.source_id: src.id}, synchronize_session="fetch")
    db.flush()
    return src


# ------------------------------------------------------------------ identité
def _age(m: PersonMention) -> Optional[int]:
    mt = re.search(r"\d{1,3}", m.age_stated or "")
    return int(mt.group(0)) if mt else None


def principals(mentions: list[PersonMention], doc: str) -> list[tuple[PersonMention, dict]]:
    """Personnes principales d'un acte et leurs parents cités : [(mention, {"father": m, "mother": m, "spouse": m})]."""
    by_role = lambda *roles: [m for m in mentions if m.role in roles]  # noqa: E731
    out = []
    if doc == "marriage":
        groom = next(iter(by_role("groom", "subject")), None)
        bride = next(iter(by_role("bride", "spouse")), None)
        for me, other, key in ((groom, bride, ("groom", "subject", None)), (bride, groom, ("bride", "spouse"))):
            if me is None:
                continue
            pars = {}
            for r in PARENT_ROLES:
                pars[r] = next((m for m in by_role(r) if (m.relation_to_role or None) in key), None)
            pars["spouse"] = other
            out.append((me, pars))
    else:
        subj = next(iter(by_role("subject", "deceased")), None)
        if subj is not None:
            pars = {r: next((m for m in by_role(r) if m.relation_to_role in (None, "subject", "deceased")), None) for r in PARENT_ROLES}
            pars["spouse"] = next(iter(by_role("spouse")), None)
            out.append((subj, pars))
    return out


def candidate_for(m: PersonMention, doc: str, year: Optional[int], place: Optional[str], rel: dict) -> Candidate:
    c = Candidate(surname=m.surname, given_names=m.given_names, sex=m.sex, event_year=year, event_place=place,
                  occupation=m.occupation, residence=m.residence, extra={"event_type": doc})
    if doc in ("birth", "baptism"):
        c.birth_year, c.birth_place = year, place
    else:
        c.age_at_event = _age(m)
    if doc in ("death", "burial"):
        c.death_year, c.death_place = year, place
    if rel.get("spouse") is not None and doc == "marriage":
        c.spouse_name = full_name(rel["spouse"])
    return c


def assess(db: Session, person: Person, mentions: list[PersonMention], source: Source, extraction: dict) -> Optional[dict]:
    """Évalue un document contre une personne : identité, parents cités, niveau de preuve. Ne modifie rien."""
    doc = extraction.get("document_type") or "other"
    year, place = _year(extraction), extraction.get("place")
    best = None
    for me, rel in principals(mentions, doc):
        cand = candidate_for(me, doc, year, place, rel)
        match = score_candidate(db, cand, person)
        if best is None or match.total > best[2].total:
            best = (me, rel, match, cand)
    if best is None:
        return None
    me, rel, match, cand = best
    informative = [c for c in match.criteria if c.name not in ("surname", "given_names", "sex") and c.score >= 0.6]
    homonyms = [r for r in find_matches(db, cand, min_total=50)
                if r.person_id != person.id and not r.blocking and r.level in ("green", "orange")]
    parents = {r: rel.get(r) for r in PARENT_ROLES if rel.get(r) is not None}
    reasons, missing = [], []
    if source.reliability == "primary":
        reasons.append(f"Acte primaire ({DOC_LABEL.get(doc, doc)}).")
    else:
        missing.append(f"Source {'dérivée (arbre en ligne)' if source.reliability == 'derivative' else source.reliability} : "
                       "il faut l'acte original.")
    if parents:
        reasons.append("Parents nommés explicitement : " + ", ".join(f"{'père' if r == 'father' else 'mère'} {full_name(m)}"
                                                                      for r, m in parents.items()) + ".")
    else:
        missing.append("Le document ne nomme pas les parents.")
    low = [m for m in parents.values() if m.reading_confidence is not None and m.reading_confidence < READING_MIN]
    if low:
        missing.append("Lecture incertaine du nom de : " + ", ".join(full_name(m) for m in low) + " (hypothèse de lecture).")
    if match.blocking:
        missing.append("Incompatibilités avec la personne : " + "; ".join(match.blocking) + ".")
    if informative:
        reasons.append("Identité concordante au-delà du nom : " + "; ".join(f"{c.label} ({c.detail})" for c in informative) + ".")
    else:
        missing.append("Seuls les noms concordent : identité non démontrée (jamais de filiation sur le seul nom).")
    if match.level != "green":
        missing.append(f"Score d'identité {match.total:.0f} % (« vert » exigé : ≥ 80 %).")
    if homonyms:
        names = ", ".join(db.get(Person, h.person_id).display_name() for h in homonyms if db.get(Person, h.person_id))
        missing.append(f"Homonyme(s) compatible(s) dans l'arbre : {names}.")
    sufficient = not missing
    # Parents déjà connus dans l'arbre : corroboration ou contradiction
    plan = []
    known = parents_of(db, person.id)
    for role, m in parents.items():
        sex = "M" if role == "father" else "F"
        existing = next((p for p, r in known if p.sex == sex and r.relation_type in ("biological", "uncertain")), None)
        entry = {"role": role, "mention_id": m.id, "name": full_name(m), "given_names": m.given_names, "surname": m.surname,
                 "sex": sex, "occupation": m.occupation, "existing_person_id": None, "relation_id": None}
        if existing is not None:
            s = name_score(m, existing)
            rel_row = next(r for p, r in known if p.id == existing.id)
            gn = given_names_similarity(m.given_names, existing.given_names) if m.given_names and existing.given_names else None
            sn = name_similarity(m.surname, existing.surname) if m.surname and existing.surname else None
            clash = (gn is not None and gn < 60) or (sn is not None and sn < 60) or s < 60
            entry.update(existing_person_id=existing.id, relation_id=rel_row.id, name_score=s,
                         action="conflict" if clash else ("corroborate" if s >= 80 else "uncertain"))
        else:
            entry["action"] = "create"
            pc = Candidate(surname=m.surname, given_names=m.given_names, sex=sex, occupation=m.occupation,
                           children_names=[person.given_names] if person.given_names else [])
            other = parents.get("mother" if role == "father" else "father")
            if other is not None:
                pc.spouse_name = full_name(other)
            hits = [r for r in find_matches(db, pc, min_total=80) if not r.blocking and r.level == "green" and r.person_id != person.id]
            if len(hits) == 1:
                entry.update(action="link", existing_person_id=hits[0].person_id)
        plan.append(entry)
    level = "green" if sufficient else ("orange" if match.level in ("green", "orange") and not match.blocking else "red")
    return {"mention_id": me.id, "match": match.to_dict(), "level": level, "sufficient": sufficient, "reasons": reasons,
            "missing": missing, "parents": plan, "homonyms": [h.to_dict() for h in homonyms], "document_type": doc,
            "year": year, "place": place}


def match_mentions(db: Session, mentions: list[PersonMention], extraction: dict) -> int:
    """Compare les personnes principales du document à l'arbre : candidats explicables, JAMAIS de fusion automatique."""
    doc = extraction.get("document_type") or "other"
    year, place = _year(extraction), extraction.get("place")
    n = 0
    for me, rel in principals(mentions, doc):
        if me.link_status == "confirmed":
            continue
        cand = candidate_for(me, doc, year, place, rel)
        if rel.get("father") is not None:
            cand.father_name = full_name(rel["father"])
        if rel.get("mother") is not None:
            cand.mother_name = full_name(rel["mother"])
        hits = [r for r in find_matches(db, cand, min_total=50) if not r.blocking][:3]
        if not hits:
            continue
        me.candidates = [{"person_id": r.person_id, "score": round(r.total, 1), "level": r.level,
                          "reasons": [c.detail for c in r.criteria], "blocking": r.blocking,
                          "warnings": (["Plusieurs personnes compatibles : homonymie possible."] if len(hits) > 1 else [])}
                         for r in hits]
        me.link_status = "candidate"
        n += 1
    db.flush()
    return n


# ------------------------------------------------------------------ enregistrement
def justification(a: dict) -> str:
    return (" ".join(a.get("reasons") or []) + (" Manque : " + " ".join(a["missing"]) if a.get("missing") else "")
            + " Lecture IA à vérifier sur l'image originale.").strip()


def _cite(db: Session, source: Source, target_type: str, target_id: str, m: PersonMention | None, *, confidence: str,
          note: str, transcription: str = "") -> Citation:
    excerpt = (m.excerpt if m is not None else None) or _excerpt(transcription, *(x for x in ((m.surname if m else None),) if x))
    c = Citation(source_id=source.id, target_type=target_type, target_id=target_id, excerpt=excerpt,
                 image_region=m.image_region if m is not None else None, confidence=confidence, note=note[:2000])
    db.add(c)
    db.flush()
    return c


def apply_filiation(db: Session, inv: Investigation | None, h: Hypothesis, *, by_user: bool = False,
                    task: InvestigationTask | None = None) -> list[str]:
    """Crée/relie les parents et les filiations décrits par une hypothèse `filiation`, avec citations. Renvoie les liens."""
    cand = h.candidate or {}
    child = db.get(Person, cand.get("child_id") or h.subject_person_id or "")
    source = db.get(Source, cand.get("source_id") or "")
    if child is None or source is None:
        raise ValueError("Personne ou source introuvable pour cette filiation.")
    a = cand.get("assessment") or {}
    note = ("Validé par l'utilisateur. " if by_user else "Enregistré automatiquement (mode autonome contrôlé, preuve suffisante). ") \
        + justification(a)
    transcription = source.transcription or ""
    relation_ids, parent_ids = [], {}
    for p in a.get("parents") or []:
        m = db.get(PersonMention, p.get("mention_id") or "")
        if p.get("action") == "conflict" or (p.get("action") == "uncertain" and not by_user):
            continue  # désaccord avec l'arbre : la contradiction reste ouverte, rien n'est écrasé
        if p.get("existing_person_id") and p.get("relation_id"):
            rel = db.get(ParentChild, p["relation_id"])
            parent = db.get(Person, p["existing_person_id"])
        else:
            parent = db.get(Person, p["existing_person_id"]) if p.get("existing_person_id") else None
            if parent is None:
                parent = create_person(db, PersonIn(given_names=p.get("given_names"), surname=p.get("surname"), sex=p.get("sex"),
                                                    occupation=p.get("occupation"), confidence="orange",
                                                    notes=f"Fiche créée d'après « {source.title} » (enquête). Lecture IA à vérifier."))
                _cite(db, source, "person", parent.id, m, confidence="orange", note="Personne citée dans l'acte.", transcription=transcription)
                queue.emit(db, inv.id, "discovery", f"Nouvel ancêtre identifié : {parent.display_name()} ({'père' if p['role'] == 'father' else 'mère'} "
                                                    f"de {child.display_name()}).", {"person_id": parent.id}, task.id if task else None) if inv else None
            rel = add_relation(db, RelationIn(parent_id=parent.id, child_id=child.id, relation_type="biological",
                                              notes=f"D'après « {source.title} »"))
            rel.hypothesis_id = h.id
        _cite(db, source, "parent_child", rel.id, m, confidence="orange", note=note, transcription=transcription)
        lvl, det = score_relation(db, rel)
        rel.confidence, rel.confidence_details = lvl, det
        relation_ids.append(rel.id)
        parent_ids[p["role"]] = parent.id
        if m is not None:
            m.linked_person_id, m.link_status = parent.id, "confirmed"
        if inv is not None:
            memory.record_filiation(inv, rel.id, child_id=child.id, parent_id=parent.id, source_id=source.id)
        index_person(db, parent)
    if "father" in parent_ids and "mother" in parent_ids:
        find_or_create_family(db, parent_ids["father"], parent_ids["mother"])
    subj = db.get(PersonMention, a.get("mention_id") or "")
    if subj is not None:
        subj.linked_person_id, subj.link_status = child.id, "confirmed"
        _cite(db, source, "person", child.id, subj, confidence="orange", note="Personne principale de l'acte. " + justification(a),
              transcription=transcription)
    doc = a.get("document_type")
    if doc in ("birth", "baptism") and not any(e.event_type in ("birth", "baptism") for e in child.events):
        ev = add_event(db, child.id, EventIn(event_type=doc, date=str(a.get("event_date") or a.get("year") or "") or None,
                                             place=a.get("place"), confidence="orange"))
        _cite(db, source, "event", ev.id, subj, confidence="orange", note="Date et lieu lus dans l'acte (IA, à vérifier).",
              transcription=transcription)
    h.status = "confirmed"
    h.candidate = {**cand, "relation_ids": relation_ids, "parent_ids": parent_ids}
    db.flush()
    return relation_ids


def record_contradiction(db: Session, inv: Investigation, person: Person, entry: dict, source: Source, task_id: str | None) -> Contradiction:
    key = f"inv-doc-parent:{person.id}:{entry['role']}:{source.id}"
    c = db.query(Contradiction).filter(Contradiction.dedupe_key == key).first()
    if c is None:
        existing = db.get(Person, entry["existing_person_id"])
        c = Contradiction(kind="document_vs_tree", severity="orange", dedupe_key=key,
                          description=f"« {source.title} » nomme comme {'père' if entry['role'] == 'father' else 'mère'} de "
                                      f"{person.display_name()} : {entry['name']}, alors que l'arbre indique "
                                      f"{existing.display_name() if existing else '?'}. Les deux versions sont conservées.",
                          person_ids=[person.id] + ([existing.id] if existing else []),
                          relation_ids=[entry["relation_id"]] if entry.get("relation_id") else [])
        db.add(c)
        db.flush()
        queue.emit(db, inv.id, "error", "Contradiction : " + c.description, {"contradiction_id": c.id}, task_id)
    return c


def evaluate_document(db: Session, inv: Investigation, person: Person, mentions: list[PersonMention], source: Source,
                      extraction: dict, task: InvestigationTask | None = None) -> dict:
    """Tâche `verify` : niveau de preuve → filiation enregistrée, proposée (vert à valider) ou hypothèse À VÉRIFIER."""
    from ..agents.questions import ask

    task_id = task.id if task else None
    a = assess(db, person, mentions, source, extraction)
    if a is None:
        return {"proposals": [], "status": "to_verify", "note": "Aucune personne principale dans le document."}
    a["event_date"] = extraction.get("event_date_iso") or extraction.get("date_iso") or extraction.get("event_date") or extraction.get("date")
    subj = db.get(PersonMention, a["mention_id"])
    if subj is not None:
        others = [c for c in subj.candidates or [] if isinstance(c, dict) and c.get("person_id") != person.id]
        subj.candidates = [{"person_id": person.id, "score": a["match"]["total"], "level": a["match"]["level"],
                            "reasons": [c["detail"] for c in a["match"]["criteria"]], "warnings": a["missing"],
                            "blocking": a["match"]["blocking"]}] + others + \
            [{"person_id": h["person_id"], "score": h["total"], "level": h["level"], "warnings": ["homonyme compatible"]}
             for h in a["homonyms"]]
        if subj.link_status != "confirmed":
            subj.link_status = "candidate"
    proposals: list[dict] = []
    if not a["parents"]:
        return {"proposals": proposals, "status": "done", "assessment": a,
                "note": "Le document ne cite pas de parents : identité notée, aucune filiation à proposer."}
    # Contradictions avec les parents déjà connus : toujours visibles, jamais d'écrasement
    for p in a["parents"]:
        if p["action"] == "conflict":
            c = record_contradiction(db, inv, person, p, source, task_id)
            proposals.append({"kind": "contradiction", "contradiction_id": c.id, "role": p["role"]})
    mode = int(cfg.get(db, "autonomy_mode", 1) or 1)
    group = f"filiation:{person.id}"
    desc = "; ".join(f"{'père' if p['role'] == 'father' else 'mère'} : {p['name']}" for p in a["parents"])
    h = Hypothesis(kind="filiation", title=f"Parents de {person.display_name()} d'après « {source.title} »"[:512],
                   description=f"{desc}. {justification(a)}", subject_person_id=person.id,
                   candidate={"child_id": person.id, "source_id": source.id, "media_id": (source.extra or {}).get("media_id"),
                              "assessment": a, "father": next((p for p in a["parents"] if p["role"] == "father"), None),
                              "mother": next((p for p in a["parents"] if p["role"] == "mother"), None)},
                   evidence=[{"source_id": source.id, "media_id": (source.extra or {}).get("media_id"), "url": source.url,
                              "reference": source.reference, "excerpt": (subj.excerpt if subj else None),
                              "image_region": subj.image_region if subj else None, "reliability": source.reliability}],
                   score=a["match"]["total"], score_details={"level": a["level"], "proof": "sufficient" if a["sufficient"] else "insufficient",
                                                             "reasons": a["reasons"], "missing": a["missing"],
                                                             "status_label": "PREUVE SUFFISANTE" if a["sufficient"] else "À VÉRIFIER",
                                                             "criteria": a["match"]["criteria"]},
                   status="open", created_by="agent:director", task_id=task_id, group_key=group)
    db.add(h)
    db.flush()
    memory.record_hypothesis(inv, h.id, h.title)
    competing = db.query(Hypothesis).filter(Hypothesis.group_key == group, Hypothesis.id != h.id,
                                            Hypothesis.status.in_(("open", "confirmed"))).count()
    status = "to_verify"
    has_conflict = any(p["action"] in ("conflict", "uncertain") for p in a["parents"])
    if a["sufficient"] and mode == 3 and not has_conflict:
        rel_ids = apply_filiation(db, inv, h, task=task)
        status = "done"
        proposals.append({"kind": "filiation", "hypothesis_id": h.id, "relation_ids": rel_ids, "level": "green", "recorded": True})
        queue.emit(db, inv.id, "filiation", f"Filiation enregistrée pour {person.display_name()} : {desc} (preuve suffisante : "
                                            f"acte primaire + identité concordante).", {"hypothesis_id": h.id, "relation_ids": rel_ids}, task_id)
    else:
        why = ("preuve suffisante mais votre validation est requise (mode d'autonomie)" if a["sufficient"] and not has_conflict
               else "désaccord avec l'arbre" if has_conflict else "preuve insuffisante")
        proposals.append({"kind": "hypothesis", "hypothesis_id": h.id, "level": a["level"], "recorded": False, "why": why})
        queue.emit(db, inv.id, "hypothesis", f"Filiation proposée À VÉRIFIER pour {person.display_name()} : {desc} — {why}.",
                   {"hypothesis_id": h.id, "missing": a["missing"]}, task_id)
        if a["sufficient"] or has_conflict or competing:
            q = ask(db, title=f"Le document « {source.title} » indique comme parents de {person.display_name()} : {desc}. Confirmer ?",
                    problem=("Une transcription IA n'est jamais une preuve parfaite : vérifiez l'image. " + justification(a)
                             + (f" {competing} autre(s) hypothèse(s) concurrente(s) sont conservées." if competing else "")),
                    person_id=person.id, task_id=task_id, hypotheses=[{"label": desc, "hypothesis_id": h.id}],
                    documents=[{"media_id": (source.extra or {}).get("media_id"), "title": source.title, "url": source.url}],
                    impact="Ouvre la génération précédente.", priority=80,
                    dedupe_key=f"inv:{inv.id}:filiation-check:{person.id}:{source.id}")
            if q is not None:
                proposals.append({"kind": "question", "question_id": q.id})
    if competing:
        queue.emit(db, inv.id, "hypothesis", f"{competing + 1} hypothèses concurrentes de filiation conservées pour "
                                             f"{person.display_name()} (aucune n'est supprimée).", {"group_key": group}, task_id)
    db.flush()
    return {"proposals": proposals, "status": status, "assessment": a, "hypothesis_id": h.id}


def validate_hypothesis(db: Session, h: Hypothesis, *, person_id: str | None = None, note: str | None = None) -> dict:
    """Validation par l'utilisateur (API) : applique avec les services existants en conservant les citations."""
    from ..models import InvestigationTask as _T

    inv = None
    if h.task_id:
        t = db.get(_T, h.task_id)
        inv = db.get(Investigation, t.investigation_id) if t else None
    out: dict = {"hypothesis_id": h.id, "kind": h.kind}
    if h.kind == "filiation" and h.status != "confirmed":
        out["relation_ids"] = apply_filiation(db, inv, h, by_user=True)
    elif h.kind == "identity_match" and h.status != "confirmed":
        r = h.candidate or {}
        person = db.get(Person, h.subject_person_id or "")
        if person is not None:
            src = Source(title=r.get("title") or h.title, url=r.get("url"), repository=r.get("repository"), year=r.get("year"),
                         reliability=r.get("reliability") or "unknown", connector_id=r.get("connector_id"), consulted_at=utcnow(),
                         extra={"hypothesis_id": h.id})
            db.add(src)
            db.flush()
            db.add(Citation(source_id=src.id, target_type="person", target_id=person.id, confidence="orange",
                            excerpt=r.get("snippet"), note=f"Validé par l'utilisateur. {note or ''}".strip()))
            out["source_id"] = src.id
    elif h.kind in ("indirect_relation", "witness_homonym"):
        target = person_id or (h.candidate or {}).get("tree_person_id")
        m = db.get(PersonMention, (h.candidate or {}).get("mention_id") or "")
        if m is not None and target and db.get(Person, target):
            m.linked_person_id, m.link_status = target, "confirmed"
            src = db.get(Source, m.source_id) if m.source_id else None
            if src is not None:
                _cite(db, src, "person", target, m, confidence="orange",
                      note=f"Mention « {m.stated_relation or m.role} » validée par l'utilisateur. {note or ''}".strip())
            out["linked_person_id"] = target
    h.status = "confirmed"
    sd = dict(h.score_details or {})
    sd["validated_by_user"] = utcnow().isoformat(timespec="seconds")
    if note:
        sd["user_note"] = note
    h.score_details = sd
    if inv is not None:
        queue.emit(db, inv.id, "decision", f"Validé par vous : {h.title}", {"hypothesis_id": h.id})
    db.flush()
    return out


def validate_mention(db: Session, m: PersonMention, *, person_id: str | None = None, note: str | None = None) -> dict:
    target = person_id or m.linked_person_id or next((c.get("person_id") for c in sorted(
        [c for c in m.candidates or [] if isinstance(c, dict)], key=lambda c: -(c.get("score") or 0))), None)
    if not target or db.get(Person, target) is None:
        raise ValueError("Indiquez la personne de l'arbre à relier à cette mention.")
    m.linked_person_id, m.link_status = target, "confirmed"
    src = db.get(Source, m.source_id) if m.source_id else None
    if src is not None:
        _cite(db, src, "person", target, m, confidence="orange",
              note=f"Mention ({m.role}) reliée par l'utilisateur. {note or ''}".strip())
    if m.investigation_id:
        queue.emit(db, m.investigation_id, "decision", f"Mention « {full_name(m)} » reliée par vous à "
                                                       f"{db.get(Person, target).display_name()}.", {"mention_id": m.id})
    db.flush()
    return {"mention_id": m.id, "linked_person_id": target}
