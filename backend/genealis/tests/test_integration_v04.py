"""Intégration v0.4 : module paléographique RÉEL + GENEALIS RESEARCH DIRECTOR + gestionnaire de coûts (Gemini simulé)."""
from __future__ import annotations

import httpx
import pytest

from genealis.investigation import director, queue, strategy
from genealis.models import AICallLog, DocumentReading, Hypothesis, InvestigationTask, ParentChild, PersonMention
from genealis.schemas import PersonIn
from genealis.services import settings_service as cfg
from genealis.services.persons import create_person, parents_of
from genealis.tests.test_paleo import FakeGemini, _import, draw_document, reading_payload

LINES = ["Le douze mars mil huit cent cinquante a Toul", "est ne Jean fils de Nicolas Dupont laboureur",
         "et de Marie Leroy son epouse", "en presence de Pierre Leroy oncle maternel de lenfant"]


def act(date_iso="1850-03-12", place="Toul"):
    data, boxes = draw_document(LINES)
    persons = [
        {"role": "subject", "name_original": "Jean", "given_names": "Jean", "surname": "Dupont", "sex": "M", "line_n": 2,
         "confidence": "high"},
        {"role": "father", "name_original": "Nicolas Dupont", "given_names": "Nicolas", "surname": "Dupont", "sex": "M",
         "occupation": "laboureur", "line_n": 2, "confidence": "high"},
        {"role": "mother", "name_original": "Marie Leroy", "given_names": "Marie", "surname": "Leroy", "sex": "F", "line_n": 3,
         "confidence": "high"},
        {"role": "witness", "name_original": "Pierre Leroy", "given_names": "Pierre", "surname": "Leroy", "sex": "M",
         "stated_relation": "oncle maternel de lenfant", "line_n": 4, "confidence": "high"}]
    payload = reading_payload(LINES, boxes, persons=persons, uncertain_line=0)
    payload["extraction"].update({"document_type": "birth", "date_iso": date_iso, "place": place,
                                  "date": "le douze mars mil huit cent cinquante"})
    return data, payload


@pytest.fixture
def gemini(db, monkeypatch):
    cfg.set_value(db, "ai_provider", "gemini")
    cfg.set_value(db, "gemini_api_key", "cle-de-test")
    cfg.set_value(db, "allow_external_ai", True)
    cfg.set_value(db, "ai_minute_call_limit", 0)
    cfg.set_value(db, "autonomy_mode", 3)
    fake = FakeGemini()
    monkeypatch.setattr(httpx, "post", fake.post)
    monkeypatch.setattr(strategy, "free_connectors", lambda db, q: [])
    return fake


def _jean(db):
    return create_person(db, PersonIn(given_names="Jean", surname="Dupont", sex="M", birth_date="12/03/1850", birth_place="Toul",
                                      death_date="1910", death_place="Toul"))


def _browse_done(db, inv, person, media):
    t, _ = queue.enqueue(db, inv.id, "browse", "Registre de Toul", person_id=person.id,
                         params={"goal": "acte de naissance", "start_url": "https://archives.example.fr/toul/1850"}, strategy="playwright")
    queue.claim(db, "worker-pc", kinds=["browse"])
    queue.complete(db, t, {"outcome": "ok", "documents": [media.id], "pages": [],
                           "findings": [{"title": "Naissances 1850", "url": "https://archives.example.fr/toul/1850/v12",
                                         "archival_reference": "2 E 538/12"}]})
    return t


def _run(db, inv, rounds=12):
    for _ in range(rounds):
        if not director.step(db, inv.id, budget_s=30)["executed"]:
            break


def test_acte_lu_par_le_module_paleo_puis_verifie_par_le_director(db, gemini, tmp_path):
    p = _jean(db)
    inv = director.start_investigation(db, p.id, max_generations=0)
    data, payload = act()
    gemini.reading = payload
    media = _import(db, tmp_path, data, "toul-1850.png")
    _browse_done(db, inv, p, media)
    db.commit()
    _run(db, inv)
    reading = db.query(DocumentReading).filter_by(media_id=media.id).one()
    assert reading.lines and reading.lines[0]["bbox"], "lecture paléographique ligne par ligne avec zones"
    mentions = db.query(PersonMention).filter_by(media_id=media.id).all()
    assert {m.role for m in mentions} >= {"subject", "father", "mother", "witness"}
    assert all(m.reading_id == reading.id for m in mentions)
    uncle = next(m for m in mentions if m.surname == "Leroy" and m.role == "witness")
    assert uncle.relation_kind == "uncle" and uncle.relation_side == "maternal" and uncle.linked_person_id is None
    parents = {pp.given_names: r for pp, r in parents_of(db, p.id)}
    assert set(parents) == {"Nicolas", "Marie"}
    assert all(r.confidence != "green" for r in parents.values()), "une seule source : jamais « vert » d'emblée"
    assert db.query(AICallLog).filter(AICallLog.investigation_id == inv.id, AICallLog.status == "ok").count() >= 1
    assert db.query(InvestigationTask).filter_by(investigation_id=inv.id, kind="witness_followup").count() >= 1


def test_seul_le_nom_concorde_aucune_filiation(db, gemini, tmp_path):
    """TEST 10 avec le vrai module : acte d'un autre Jean Dupont (autre lieu, autre date) → hypothèse, jamais de filiation."""
    p = _jean(db)
    inv = director.start_investigation(db, p.id, max_generations=0)
    data, payload = act(date_iso="1871-09-02", place="Marseille")
    gemini.reading = payload
    media = _import(db, tmp_path, data, "marseille-1871.png")
    _browse_done(db, inv, p, media)
    db.commit()
    _run(db, inv)
    assert db.query(ParentChild).filter_by(child_id=p.id).count() == 0
    assert db.query(DocumentReading).filter_by(media_id=media.id).count() == 1
    hyps = db.query(Hypothesis).filter(Hypothesis.subject_person_id == p.id).all()
    assert all(h.status != "confirmed" for h in hyps)


def test_quota_pendant_lecture_bloque_l_enquete(db, gemini, tmp_path):
    p = _jean(db)
    inv = director.start_investigation(db, p.id, max_generations=0)
    data, payload = act()
    gemini.reading = payload
    gemini.status = 429
    media = _import(db, tmp_path, data, "toul.png")
    _browse_done(db, inv, p, media)
    db.commit()
    _run(db, inv)
    db.refresh(inv)
    assert inv.status == "blocked" and inv.blocked_reason
    sent = len(gemini.calls)
    _run(db, inv)
    assert len(gemini.calls) == sent, "aucun nouvel appel pendant la suspension"


def test_j_ai_termine_pendant_assistance_ne_coupe_pas_le_worker(client, db):
    """« J'ai terminé » dans le Centre d'investigation pendant que le worker attend l'utilisateur : la navigation reprend."""
    from genealis.models import Investigation

    inv = Investigation(title="Assistance", status="running")
    db.add(inv)
    db.flush()
    t, _ = queue.enqueue(db, inv.id, "browse", "Site avec vérification humaine", params={"start_url": "https://archives.example.fr"})
    queue.claim(db, "pc-1", kinds=["browse"])
    db.commit()
    assert client.post(f"/api/investigation-tasks/{t.id}/human-done", json={"note": "CAPTCHA fait"}).status_code == 200
    hb = client.post(f"/api/worker/tasks/{t.id}/heartbeat", json={"worker_id": "pc-1"}).json()
    assert hb["cancel"] is False and hb["human_done_at"]


def test_enquete_sans_aucun_resultat_n_est_pas_terminee(db, monkeypatch):
    """Sans IA, sans navigateur et sans réponse des sources : l'enquête dit ce qui manque au lieu de s'afficher TERMINÉE."""
    monkeypatch.setattr(strategy, "free_connectors", lambda db, q: [])
    cfg.set_value(db, "browser_mode", "off")
    p = _jean(db)
    inv = director.start_investigation(db, p.id, max_generations=0)
    db.commit()
    _run(db, inv)
    db.refresh(inv)
    assert inv.status == "blocked" and "Gemini" in inv.blocked_reason
