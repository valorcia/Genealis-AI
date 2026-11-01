"""GENEALIS RESEARCH DIRECTOR : enquêtes autonomes, réseau des témoins, niveaux de preuve, reprise, quotas, API.

Tous les appels Gemini sont SIMULÉS (httpx.post remplacé) : aucun accès réseau. Les données sont FICTIVES.
"""
from __future__ import annotations

import json
import sys
import types
from datetime import timedelta

import httpx
import pytest

from genealis.investigation import director, handlers, memory, network, queue, strategy, verification
from genealis.models import (AICallLog, Citation, Contradiction, Hypothesis, Investigation, InvestigationTask, Media, ParentChild,
                             Person, PersonMention, Question, Source, utcnow)
from genealis.schemas import PersonIn, RelationIn
from genealis.services import settings_service as cfg
from genealis.services.media_service import import_file
from genealis.services.persons import add_relation, create_person, parents_of


# ------------------------------------------------------------------ Gemini simulé
class FakeGemini:
    """Remplace le réseau : lecture de document (pièce jointe) et recherche web (outil google_search)."""

    def __init__(self):
        self.calls: list[dict] = []
        self.documents: list[dict] = []  # réponses successives aux lectures de documents
        self.web: dict = {"findings": [], "not_found": ["rien"]}
        self.web_sources: list[dict] = []

    def kind(self, body: dict) -> str:
        if body.get("tools"):
            return "web"
        parts = body["contents"][0]["parts"]
        return "document" if any("inline_data" in p for p in parts) else "text"

    def post(self, url, params=None, json=None, timeout=None, **kw):  # noqa: A002 - signature de httpx.post
        k = self.kind(json)
        self.calls.append({"kind": k, "json": json})
        req = httpx.Request("POST", url)
        cand: dict = {"finishReason": "STOP"}
        if k == "document":
            ans = self.documents.pop(0) if len(self.documents) > 1 else (self.documents[0] if self.documents else {})
            cand["content"] = {"parts": [{"text": _json(ans)}]}
        elif k == "web":
            cand["content"] = {"parts": [{"text": _json(self.web)}]}
            cand["groundingMetadata"] = {"webSearchQueries": ["jean dupont toul 1850"],
                                         "groundingChunks": [{"web": s} for s in self.web_sources], "groundingSupports": []}
        else:
            cand["content"] = {"parts": [{"text": "{}"}]}
        return httpx.Response(200, json={"candidates": [cand], "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 20}},
                              request=req)

    def count(self, kind: str) -> int:
        return sum(1 for c in self.calls if c["kind"] == kind)


def _json(x) -> str:
    return json.dumps(x, ensure_ascii=False)


@pytest.fixture
def gemini(db, monkeypatch):
    cfg.set_value(db, "ai_provider", "gemini")
    cfg.set_value(db, "gemini_api_key", "cle-de-test")
    cfg.set_value(db, "allow_external_ai", True)
    cfg.set_value(db, "ai_minute_call_limit", 0)
    cfg.set_value(db, "autonomy_mode", 3)
    fake = FakeGemini()
    monkeypatch.setattr(httpx, "post", fake.post)
    return fake


@pytest.fixture(autouse=True)
def isolate(monkeypatch):
    """Aucun connecteur réseau réel ; module paléographique absent → chemin de repli testé de façon déterministe."""
    monkeypatch.setattr(strategy, "free_connectors", lambda db, q: [])
    monkeypatch.setitem(sys.modules, "genealis.paleo.pipeline", None)
    monkeypatch.setitem(sys.modules, "genealis.paleo.mentions", None)


# ------------------------------------------------------------------ données fictives
BIRTH_TEXT = ("L'an mil huit cent cinquante, le douze mars, à dix heures du matin, par devant nous maire de Toul, est comparu "
              "Nicolas DUPONT, laboureur, lequel nous a présenté un enfant du sexe masculin né ce jour de lui et de Marie LEROY, "
              "son épouse, auquel il a donné le prénom de Jean ; en présence de Pierre LEROY, oncle maternel de l'enfant, "
              "et de Joseph DUPONT, tisserand, témoins.")


def birth_act(*, father=("Nicolas", "DUPONT"), mother=("Marie", "LEROY"), date_iso="1850-03-12", place="Toul, Meurthe-et-Moselle",
              confidence="high", witnesses=True) -> dict:
    persons = [{"role": "subject", "given_names": "Jean", "surname": "DUPONT", "sex": "M", "confidence": "high"},
               {"role": "father", "given_names": father[0], "surname": father[1], "sex": "M", "occupation": "laboureur",
                "confidence": confidence},
               {"role": "mother", "given_names": mother[0], "surname": mother[1], "sex": "F", "confidence": confidence}]
    if witnesses:
        persons += [{"role": "witness", "given_names": "Pierre", "surname": "LEROY", "sex": "M", "age": 30,
                     "relation": "oncle maternel de l'enfant", "confidence": "medium"},
                    {"role": "witness", "given_names": "Joseph", "surname": "DUPONT", "sex": "M", "age": 45,
                     "occupation": "tisserand", "confidence": "medium"}]
    return {"transcription": BIRTH_TEXT.replace("Nicolas DUPONT", f"{father[0]} {father[1]}").replace("Marie LEROY", f"{mother[0]} {mother[1]}"),
            "document_type": "birth", "language": "fr", "date": "le douze mars mil huit cent cinquante", "date_iso": date_iso,
            "place": place, "act_number": "34", "persons": persons, "households": [], "entries": [], "relations": [],
            "uncertain_passages": [], "summary_fr": "Naissance de Jean Dupont à Toul en 1850."}


MARRIAGE_TEXT = ("L'an mil huit cent soixante-dix-huit, le quatre mai, à Toul, mariage de Jean DUPONT, cultivateur, âgé de "
                 "vingt-huit ans, fils de Nicolas DUPONT et de Marie LEROY, et de Louise THOMAS, âgée de vingt-trois ans, fille de "
                 "Joseph THOMAS et de Catherine MARTIN ; en présence de Pierre MARTIN, oncle maternel de l'épouse, et de "
                 "Jacques BERNARD, oncle maternel de l'épouse.")


def marriage_act() -> dict:
    return {"transcription": MARRIAGE_TEXT, "document_type": "marriage", "language": "fr", "date": "quatre mai 1878",
            "date_iso": "1878-05-04", "place": "Toul, Meurthe-et-Moselle", "act_number": "12",
            "persons": [
                {"role": "subject", "given_names": "Jean", "surname": "DUPONT", "sex": "M", "age": 28, "confidence": "high"},
                {"role": "spouse", "given_names": "Louise", "surname": "THOMAS", "sex": "F", "age": 23, "confidence": "high"},
                {"role": "father", "given_names": "Nicolas", "surname": "DUPONT", "sex": "M", "confidence": "high"},
                {"role": "mother", "given_names": "Marie", "surname": "LEROY", "sex": "F", "confidence": "high"},
                {"role": "spouse_father", "given_names": "Joseph", "surname": "THOMAS", "sex": "M", "confidence": "high"},
                {"role": "spouse_mother", "given_names": "Catherine", "surname": "MARTIN", "sex": "F", "confidence": "high"},
                {"role": "witness", "given_names": "Pierre", "surname": "MARTIN", "sex": "M", "age": 50,
                 "relation": "oncle maternel de l'épouse", "confidence": "medium"},
                {"role": "witness", "given_names": "Jacques", "surname": "BERNARD", "sex": "M", "age": 52,
                 "relation": "oncle maternel de l'épouse", "confidence": "medium"}],
            "households": [], "entries": [], "relations": [], "uncertain_passages": []}


def jean(db, **kw) -> Person:
    data = {"given_names": "Jean", "surname": "Dupont", "sex": "M", "birth_date": "12/03/1850", "birth_place": "Toul",
            "death_date": "1910", "death_place": "Toul", **kw}
    return create_person(db, PersonIn(**data))


_counter = {"n": 0}


def media_for(db, tmp_path, person: Person | None, name: str = "acte.png") -> Media:
    from PIL import Image

    _counter["n"] += 1
    p = tmp_path / f"{_counter['n']}-{name}"
    Image.new("RGB", (60 + _counter["n"], 40), "white").save(p)  # contenu distinct → empreinte distincte
    return import_file(db, p, person_id=person.id if person else None, title=name)


def run(db, inv, rounds: int = 10) -> None:
    for _ in range(rounds):
        res = director.step(db, inv.id, budget_s=30)
        if not res["executed"]:
            break


def tasks_of(db, inv, kind=None) -> list[InvestigationTask]:
    q = db.query(InvestigationTask).filter(InvestigationTask.investigation_id == inv.id)
    if kind:
        q = q.filter(InvestigationTask.kind == kind)
    return q.all()


# ------------------------------------------------------------------ analyse du lien déclaré
def test_analyse_des_liens_declares():
    p = network.parse_relation("oncle maternel de l'épouse")
    assert (p["kind"], p["side"], p["to_role"], p["sex"]) == ("uncle", "maternal", "bride", "M")
    p = network.parse_relation("tante paternelle de l'époux")
    assert (p["kind"], p["side"], p["to_role"]) == ("aunt", "paternal", "groom")
    p = network.parse_relation("frère de la mère de l'enfant")
    assert (p["kind"], p["side"], p["to_role"]) == ("uncle", "maternal", "subject")
    assert network.parse_relation("beau-frère du marié")["kind"] == "brother_in_law"
    assert network.parse_relation("cousin germain de l'épouse")["kind"] == "first_cousin"
    assert network.parse_relation("grand-père paternel de l'enfant")["kind"] == "grandfather"
    assert network.parse_relation(None)["kind"] is None


# ------------------------------------------------------------------ TEST 3 / 4
def test_test3_4_analyse_image_mentions_parents_et_temoins(db, gemini, tmp_path):
    """TEST 3/4 : une image d'acte → mentions (parents, témoins avec lien déclaré), source, vérification, pistes."""
    p = jean(db)
    med = media_for(db, tmp_path, p)
    gemini.documents = [birth_act()]
    inv = director.start_investigation(db, p.id, max_generations=0)
    db.commit()
    run(db, inv)
    ms = db.query(PersonMention).filter(PersonMention.media_id == med.id).all()
    roles = sorted(m.role for m in ms)
    assert roles == ["father", "mother", "subject", "witness", "witness"]
    uncle = next(m for m in ms if m.surname == "LEROY" and m.role == "witness")
    assert uncle.stated_relation == "oncle maternel de l'enfant"
    assert (uncle.relation_kind, uncle.relation_side, uncle.relation_to_role) == ("uncle", "maternal", "subject")
    assert all(m.investigation_id == inv.id for m in ms)
    assert gemini.count("document") == 1, "un document n'est lu qu'une seule fois"
    # Pistes « réseau » créées pour les témoins
    assert {t.params["mention_id"] for t in tasks_of(db, inv, "witness_followup")} == {m.id for m in ms if m.role == "witness"}
    assert all(t.status == "done" for t in tasks_of(db, inv, "witness_followup"))
    # Une seconde lecture n'est jamais refaite : les mentions existantes sont réutilisées
    t2, created = queue.enqueue(db, inv.id, "analyze_document", "relire", person_id=p.id, params={"media_id": med.id, "bis": 1})
    res, status = handlers.handle_analyze_document(db, inv, t2)
    assert status == "done" and sorted(res["mentions"]) == sorted(m.id for m in ms) and gemini.count("document") == 1


# ------------------------------------------------------------------ TEST 5
def _bride_family(db):
    nicolas = create_person(db, PersonIn(given_names="Nicolas", surname="Martin", sex="M", birth_date="1800", death_date="1860"))
    catherine = create_person(db, PersonIn(given_names="Catherine", surname="Martin", sex="F", birth_date="1830", death_date="1890"))
    pierre = create_person(db, PersonIn(given_names="Pierre", surname="Martin", sex="M", birth_date="1828", death_date="1895"))
    louise = create_person(db, PersonIn(given_names="Louise", surname="Thomas", sex="F", birth_date="1855", birth_place="Toul",
                                        death_date="1920"))
    add_relation(db, RelationIn(parent_id=nicolas.id, child_id=catherine.id))
    add_relation(db, RelationIn(parent_id=nicolas.id, child_id=pierre.id))
    add_relation(db, RelationIn(parent_id=catherine.id, child_id=louise.id))
    homonym = create_person(db, PersonIn(given_names="Pierre", surname="Martin", sex="M", birth_date="1890", death_date="1960"))
    return {"nicolas": nicolas, "catherine": catherine, "pierre": pierre, "louise": louise, "homonym": homonym}


def test_test5_relation_indirecte_oncle_maternel_de_l_epouse(db, gemini, tmp_path):
    """TEST 5 : « Pierre Martin, oncle maternel de l'épouse » est confronté à l'arbre (frère de la mère de l'épouse)."""
    p = jean(db)
    fam = _bride_family(db)
    med = media_for(db, tmp_path, p, "mariage.png")
    gemini.documents = [marriage_act()]
    inv = director.start_investigation(db, p.id, max_generations=0)
    db.commit()
    run(db, inv)
    ms = {(m.given_names, m.surname): m for m in db.query(PersonMention).filter(PersonMention.media_id == med.id)}
    bride = ms[("Louise", "THOMAS")]
    assert bride.role == "bride" and bride.candidates[0]["person_id"] == fam["louise"].id
    assert bride.link_status == "candidate", "jamais de fusion automatique"
    pierre_m = ms[("Pierre", "MARTIN")]
    h = db.query(Hypothesis).filter(Hypothesis.kind == "indirect_relation", Hypothesis.group_key == f"indirect:{pierre_m.id}").one()
    check = h.candidate["check"]
    assert check["status"] == "consistent"
    assert h.candidate["tree_person_id"] == fam["pierre"].id
    assert "frère de Catherine MARTIN" in check["matches"][0]["position"]
    assert any("homonymie possible" in w for w in check["warnings"]), "l'homonyme de 1890 est signalé, jamais retenu"
    assert h.status == "open" and pierre_m.linked_person_id is None, "un lien déclaré reste une hypothèse"
    # Jacques BERNARD : nom différent de la mère → oncle par alliance plausible, à vérifier
    jb = ms[("Jacques", "BERNARD")]
    hb = db.query(Hypothesis).filter(Hypothesis.group_key == f"indirect:{jb.id}").one()
    assert hb.candidate["check"]["status"] == "plausible" and "alliance" in hb.candidate["check"]["explanation"]
    # Piste : recherche d'actes complémentaires (document de 1878 → personnes décédées)
    lead = db.get(InvestigationTask, pierre_m.lead_task_id)
    assert lead is not None and lead.kind == "web_search" and lead.params["mention_id"] == pierre_m.id


def test_test5_bis_lien_non_verifiable_sans_mere_dans_l_arbre(db):
    louise = create_person(db, PersonIn(given_names="Louise", surname="Thomas", sex="F", birth_date="1855"))
    m = PersonMention(name_original="Pierre MARTIN", given_names="Pierre", surname="MARTIN", sex="M", role="witness",
                      stated_relation="oncle maternel de l'épouse")
    db.add(m)
    db.flush()
    res = network.check_relation(db, m, louise, ref_status="confirmed")
    assert res["status"] == "unknown" and "la mère de Louise THOMAS" in res["missing"][0]
    # Sexe incompatible avec « oncle » : incohérence signalée
    m2 = PersonMention(name_original="Pierre", given_names="Pierre", surname="MARTIN", sex="F", role="witness",
                       stated_relation="oncle maternel de l'épouse")
    db.add(m2)
    db.flush()
    assert network.check_relation(db, m2, louise)["status"] == "inconsistent"


# ------------------------------------------------------------------ TEST 6 / 7
def _worker_finished_browse(db, inv, person, med, url, ref):
    t, _ = queue.enqueue(db, inv.id, "browse", "Ouvrir le registre de Toul", person_id=person.id,
                         params={"goal": "acte", "start_url": url, "expect": "documents"}, strategy="playwright")
    queue.claim(db, "worker-pc", kinds=["browse"])
    queue.complete(db, t, {"outcome": "ok", "documents": [med.id], "pages": [], "strategy_used": "playwright",
                           "findings": [{"title": "Naissances 1850", "url": url, "archival_reference": ref}]})
    return t


def test_test6_enregistrement_source_url_reference_transcription_confiance_justification(db, gemini, tmp_path):
    """TEST 6 : document téléchargé par le worker → source complète, filiation avec citation et justification."""
    p = jean(db)
    inv = director.start_investigation(db, p.id, max_generations=0)
    med = media_for(db, tmp_path, None, "toul-1850.png")  # fichier téléchargé par le navigateur
    url = "https://archives.meurthe-et-moselle.fr/ark:/52669/toul-1850/v12"
    t = _worker_finished_browse(db, inv, p, med, url, "5 Mi 528/R 3")
    gemini.documents = [birth_act(witnesses=False)]
    db.commit()
    run(db, inv)
    assert t.result["director_processed"] is True
    src = db.get(Source, db.get(Media, med.id).source_id)
    assert src.url == url and src.reference == "5 Mi 528/R 3" and src.reliability == "primary"
    assert "Nicolas DUPONT" in src.transcription and src.year == 1850 and src.local_copy_path == med.id
    assert src.extra["ai_reading"] is True and "vérifier" in src.extra["warning"]
    pars = {pp.given_names: (pp, r) for pp, r in parents_of(db, p.id)}
    assert set(pars) == {"Nicolas", "Marie"}
    rel = pars["Nicolas"][1]
    cit = db.query(Citation).filter(Citation.target_type == "parent_child", Citation.target_id == rel.id).one()
    assert cit.source_id == src.id and cit.excerpt and "Acte primaire" in cit.note and "Identité concordante" in cit.note
    assert rel.confidence == "orange", "une seule source primaire : à corroborer (jamais « vert » d'emblée)"
    assert rel.confidence_details["primary_sources"] == 1
    h = db.query(Hypothesis).filter(Hypothesis.kind == "filiation", Hypothesis.subject_person_id == p.id).one()
    assert h.status == "confirmed" and h.score_details["proof"] == "sufficient"
    assert h.evidence[0]["url"] == url and h.evidence[0]["reference"] == "5 Mi 528/R 3"
    assert db.get(Investigation, inv.id).stats is not None
    assert director.stats(db, inv)["filiations_verified"] == 2


def test_test7_generation_precedente(db, gemini, tmp_path):
    """TEST 7 : parents établis avec preuve → tâches de la génération suivante, jusqu'à max_generations."""
    p = jean(db)
    media_for(db, tmp_path, p)
    gemini.documents = [birth_act(witnesses=False)]
    inv = director.start_investigation(db, p.id, max_generations=1)
    db.commit()
    run(db, inv, rounds=3)
    parent_ids = {pp.id for pp, _ in parents_of(db, p.id)}
    assert len(parent_ids) == 2
    plans = [t for t in tasks_of(db, inv, "plan") if t.generation == 1]
    assert {t.person_id for t in plans} == parent_ids
    searches = [t for t in tasks_of(db, inv, "web_search") if t.generation == 1]
    assert searches and {t.person_id for t in searches} <= parent_ids and all(t.priority < 100 for t in searches)
    assert db.get(Investigation, inv.id).current_generation == 1
    # Limite : la génération 2 n'est pas planifiée
    run(db, inv, rounds=10)
    assert not [t for t in tasks_of(db, inv, "plan") if t.generation >= 2]
    exp = [t for t in tasks_of(db, inv, "expand_generation") if t.generation == 1]
    assert all(t.result.get("limit_reached") or t.result.get("created") == [] for t in exp)


# ------------------------------------------------------------------ TEST 8
def test_test8_interruption_puis_reprise_sans_repeter_la_recherche(db, gemini):
    """TEST 8 : arrêt brutal après une recherche web ; reprise (bail expiré) sans renvoyer la même requête."""
    p = jean(db)
    gemini.web = {"findings": [{"type": "birth", "summary": "Naissance de Jean Dupont à Toul", "url": "https://example.org/acte/1",
                                "site": "example.org", "quote": "Jean Dupont né le 12 mars 1850", "confidence": "medium",
                                "persons": {"subject": {"given_names": "Jean", "surname": "Dupont", "birth_year": 1850,
                                                        "birth_place": "Toul"}}}], "not_found": []}
    gemini.web_sources = [{"uri": "https://example.org/acte/1", "title": "example.org"}]
    inv = Investigation(title="Test reprise", person_id=p.id, status="running", max_generations=0, ai_call_ceiling=20)
    db.add(inv)
    db.flush()
    t, _ = queue.enqueue(db, inv.id, "web_search", "Naissance de Jean", person_id=p.id,
                         params={"query": "Jean DUPONT naissance 1850 Toul", "register_type": "parents", "person_id": p.id})
    claimed = queue.claim(db, "server", kinds=handlers.SERVER_KINDS, lease_s=60)
    assert claimed.id == t.id
    # La recherche est faite (1 appel Gemini), puis le processus s'arrête AVANT d'avoir terminé la tâche
    handlers.handle_web_search(db, inv, t)
    assert gemini.count("web") == 1
    t.status, t.lease_until = "running", utcnow() - timedelta(seconds=5)
    db.commit()
    # Redémarrage : bail expiré → EN ATTENTE → reprise ; la mémoire évite de refaire la recherche
    res = director.step(db, inv.id, budget_s=30)
    assert t.id in res["executed"] and t.status == "done" and t.attempts == 2
    assert gemini.count("web") == 1, "aucune nouvelle requête envoyée"
    assert t.result["reused"] is True and t.result["findings"][0]["url"] == "https://example.org/acte/1"
    assert db.query(AICallLog).filter(AICallLog.status == "ok").count() == 1
    assert db.query(AICallLog).filter(AICallLog.status == "cache_hit").count() == 0
    assert memory.query_done(inv, "Jean DUPONT naissance 1850 Toul", "web_search")
    # La piste (page d'acte) est confiée au worker local, une seule fois
    browse = tasks_of(db, inv, "browse")
    assert len(browse) == 1 and browse[0].params["start_url"] == "https://example.org/acte/1"
    assert browse[0].params["person"]["surname"] == "Dupont"
    assert db.query(Hypothesis).filter(Hypothesis.kind == "identity_match").count() == 1


# ------------------------------------------------------------------ TEST 9
def test_test9_quota_simule_enquete_bloquee_plus_aucun_appel(db, gemini, tmp_path):
    """TEST 9 : le quota quotidien est atteint → enquête BLOQUÉE avec la raison, plus aucun appel envoyé."""
    cfg.set_value(db, "ai_daily_call_limit", 1)
    p = jean(db)
    for i in range(2):
        media_for(db, tmp_path, p, f"doc{i}.png")
    gemini.documents = [birth_act(witnesses=False)]
    inv = director.start_investigation(db, p.id, max_generations=0)
    db.commit()
    run(db, inv)
    inv = db.get(Investigation, inv.id)
    sent = len(gemini.calls)
    assert sent == 1
    assert inv.status == "blocked" and "Plafond quotidien" in inv.blocked_reason
    assert inv.memory["blocked"]["scope"] == "daily"
    assert db.query(AICallLog).filter(AICallLog.status == "quota_refused").count() == 1
    pending = [t for t in tasks_of(db, inv) if t.status == "pending"]
    assert pending, "la tâche non faite reste EN ATTENTE (reprise possible)"
    # Plus aucun appel : l'enquête bloquée ne distribue plus de tâches
    assert director.step(db, inv.id, budget_s=5)["executed"] == []
    assert len(gemini.calls) == sent
    # Reprise manuelle possible ; le quota étant toujours atteint, l'enquête se rebloque sans rien envoyer
    director.resume(db, inv)
    assert inv.status == "running" and inv.blocked_reason is None
    director.step(db, inv.id, budget_s=5)
    assert inv.status == "blocked" and len(gemini.calls) == sent


def test_test9_bis_plafond_de_l_enquete(db, gemini, tmp_path):
    p = jean(db)
    media_for(db, tmp_path, p)
    gemini.documents = [birth_act(witnesses=False)]
    inv = director.start_investigation(db, p.id, max_generations=0, ai_call_ceiling=0)
    inv.ai_call_ceiling = 1
    inv.ai_calls_used = 1
    db.commit()
    run(db, inv)
    assert db.get(Investigation, inv.id).status == "blocked" and gemini.calls == []


# ------------------------------------------------------------------ TEST 10
def test_test10_seul_le_nom_concorde_hypothese_pas_de_filiation(db, gemini, tmp_path):
    """TEST 10 : seuls les noms concordent (aucune date/lieu connu) → Hypothesis À VÉRIFIER, aucun ParentChild."""
    p = create_person(db, PersonIn(given_names="Jean", surname="Dupont", sex="M", death_date="1910"))
    media_for(db, tmp_path, p)
    gemini.documents = [birth_act()]
    inv = director.start_investigation(db, p.id, max_generations=2)
    db.commit()
    run(db, inv)
    assert parents_of(db, p.id) == []
    assert db.query(ParentChild).count() == 0
    h = db.query(Hypothesis).filter(Hypothesis.kind == "filiation").one()
    assert h.status == "open" and h.score_details["proof"] == "insufficient"
    assert any("Seuls les noms concordent" in x for x in h.score_details["missing"])
    v = tasks_of(db, inv, "verify")[0]
    assert v.status == "to_verify"
    assert not tasks_of(db, inv, "expand_generation"), "pas de génération précédente sans preuve"
    assert db.get(Investigation, inv.id).status in ("running", "to_verify")


def test_test10_source_derivee_jamais_preuve(db, gemini, tmp_path):
    """TEST 10 : une seule source dérivée (arbre en ligne) → hypothèse, jamais de filiation."""
    p = jean(db)
    inv = director.start_investigation(db, p.id, max_generations=0)
    med = media_for(db, tmp_path, None, "capture-arbre.png")
    _worker_finished_browse(db, inv, p, med, "https://gw.geneanet.org/arbre?n=dupont&p=jean", None)
    gemini.documents = [birth_act(witnesses=False)]
    db.commit()
    run(db, inv)
    src = db.get(Source, db.get(Media, med.id).source_id)
    assert src.reliability == "derivative"
    assert parents_of(db, p.id) == []
    h = db.query(Hypothesis).filter(Hypothesis.kind == "filiation").one()
    assert h.status == "open" and any("dérivée" in x for x in h.score_details["missing"])


def test_test10_lecture_incertaine_et_mode_assiste(db, gemini, tmp_path):
    """Lecture incertaine des parents → hypothèse ; en mode assisté, même une preuve suffisante attend la validation."""
    cfg.set_value(db, "autonomy_mode", 1)
    p = jean(db)
    media_for(db, tmp_path, p)
    gemini.documents = [birth_act(witnesses=False)]
    inv = director.start_investigation(db, p.id, max_generations=0)
    db.commit()
    run(db, inv)
    h = db.query(Hypothesis).filter(Hypothesis.kind == "filiation").one()
    assert h.status == "open" and h.score_details["proof"] == "sufficient" and h.score_details["level"] == "green"
    assert parents_of(db, p.id) == []
    q = db.query(Question).filter(Question.dedupe_key.like(f"inv:{inv.id}:filiation-check:%")).one()
    assert q.hypotheses[0]["hypothesis_id"] == h.id
    # Validation par l'utilisateur : filiation créée avec les citations conservées
    verification.validate_hypothesis(db, h)
    assert {pp.given_names for pp, _ in parents_of(db, p.id)} == {"Nicolas", "Marie"}
    rel = parents_of(db, p.id)[0][1]
    assert db.query(Citation).filter(Citation.target_type == "parent_child", Citation.target_id == rel.id).count() == 1
    assert "Validé par l'utilisateur" in db.query(Citation).filter(Citation.target_id == rel.id).one().note


def test_test10_lecture_incertaine_des_noms(db, gemini, tmp_path):
    p = jean(db)
    media_for(db, tmp_path, p)
    gemini.documents = [birth_act(confidence="low", witnesses=False)]
    inv = director.start_investigation(db, p.id, max_generations=0)
    db.commit()
    run(db, inv)
    assert parents_of(db, p.id) == []
    h = db.query(Hypothesis).filter(Hypothesis.kind == "filiation").one()
    assert any("hypothèse de lecture" in x for x in h.score_details["missing"])


def test_temoin_homonyme_non_presume_parent(db, gemini, tmp_path):
    """Joseph DUPONT, témoin, porte le nom de la famille : hypothèse avec avertissement, jamais un parent."""
    p = jean(db)
    media_for(db, tmp_path, p)
    gemini.documents = [birth_act()]
    inv = director.start_investigation(db, p.id, max_generations=0)
    db.commit()
    run(db, inv)
    joseph = db.query(PersonMention).filter(PersonMention.given_names == "Joseph").one()
    h = db.query(Hypothesis).filter(Hypothesis.kind == "witness_homonym").one()
    assert h.candidate["mention_id"] == joseph.id and "JAMAIS présumé parent" in h.description
    assert joseph.linked_person_id is None
    assert "Joseph" not in {pp.given_names for pp, _ in parents_of(db, p.id)}
    assert not db.query(Person).filter(Person.given_names == "Joseph").count(), "aucune fiche créée pour le témoin"


def test_hypotheses_concurrentes_conservees_et_contradiction(db, gemini, tmp_path):
    """Deux actes nomment des pères différents : la contradiction est visible, aucune hypothèse supprimée."""
    p = jean(db)
    media_for(db, tmp_path, p, "a.png")
    media_for(db, tmp_path, p, "b.png")
    gemini.documents = [birth_act(witnesses=False), birth_act(father=("Claude", "DUPONT"), witnesses=False)]
    inv = director.start_investigation(db, p.id, max_generations=0)
    db.commit()
    run(db, inv)
    hyps = db.query(Hypothesis).filter(Hypothesis.kind == "filiation", Hypothesis.subject_person_id == p.id).all()
    assert len(hyps) == 2 and len({h.group_key for h in hyps}) == 1
    assert all(h.status in ("open", "confirmed") for h in hyps), "aucune hypothèse concurrente rejetée automatiquement"
    c = db.query(Contradiction).filter(Contradiction.kind == "document_vs_tree").one()
    assert "Claude DUPONT" in c.description and c.status == "open"
    fathers = [pp for pp, _ in parents_of(db, p.id) if pp.sex == "M"]
    assert len(fathers) == 1 and fathers[0].given_names == "Nicolas", "le second acte n'écrase rien"
    assert db.query(Question).filter(Question.dedupe_key.like(f"inv:{inv.id}:filiation-check:%")).count() >= 1


def test_personne_vivante_aucune_recherche_externe(db, gemini):
    me = create_person(db, PersonIn(given_names="Camille", surname="Dupont", sex="F", birth_date="1990", is_living=True))
    inv = director.start_investigation(db, me.id)
    db.commit()
    run(db, inv)
    assert gemini.calls == []
    assert not tasks_of(db, inv, "web_search")
    assert db.query(Question).filter(Question.dedupe_key == f"inv:{inv.id}:parents:{me.id}").count() == 1


def test_strategie_la_moins_chere(db, gemini):
    inv = Investigation(title="s", ai_call_ceiling=10, ai_calls_used=0)
    db.add(inv)
    db.flush()
    assert strategy.for_search(db, inv).strategy == "web_search"
    inv.ai_calls_used = 9  # réserve pour la lecture des documents
    assert strategy.for_search(db, inv).strategy == "playwright"
    assert strategy.for_browse(db, inv, "https://www.geneanet.org/x").strategy == "human"
    assert strategy.for_browse(db, inv, "https://archives57.com/x").strategy == "playwright"
    inv.ai_calls_used = 0
    assert strategy.for_browse(db, inv, "https://archives57.com/x", attempts_failed=1).strategy == "browser_agent"
    cfg.set_value(db, "browser_mode", "off")
    assert strategy.for_search(db, Investigation(title="t", ai_call_ceiling=0)).kind in ("web_search", "human_assist")


def test_connecteurs_gratuits_avant_l_ia(db, gemini, monkeypatch):
    from genealis.connectors.base import ArchiveConnector, ConnectorCapabilities, SearchResult

    class Free(ArchiveConnector):
        capabilities = ConnectorCapabilities(id="free_test", name="Index gratuit fictif", country="*", organization="test",
                                             collections=[], areas=["*"], period_start=None, period_end=None, search_fields=[],
                                             access_mode="api", limitations=[], terms_url=None, reuse_terms="", formats=[],
                                             homepage="http://localhost/none")
        min_interval = 0.0

        async def search(self, q):
            return [SearchResult(connector_id="free_test", title="Relevé naissance Jean DUPONT 1850", url="http://index.test/1",
                                 record_type="birth", year=1850, reliability="secondary")]

    monkeypatch.setattr(strategy, "free_connectors", lambda db, q: [Free()])
    p = jean(db)
    inv = Investigation(title="t", person_id=p.id, status="running", ai_call_ceiling=20)
    db.add(inv)
    db.flush()
    t, _ = queue.enqueue(db, inv.id, "web_search", "n", person_id=p.id, params={"query": "Jean DUPONT 1850", "register_type": "birth"})
    res, status = handlers.handle_web_search(db, inv, t)
    assert res["connectors"] == ["Index gratuit fictif"] and res["findings"][0]["url"] == "http://index.test/1"
    t2, _ = queue.enqueue(db, inv.id, "web_search", "n2", person_id=p.id, params={"query": "Jean DUPONT 1850", "register_type": "birth", "x": 1})
    res2, _ = handlers.handle_web_search(db, inv, t2)
    assert gemini.count("web") == 1, "même requête : mémoire de l'enquête, aucun nouvel appel"


def test_module_paleographique_utilise_quand_present(db, gemini, tmp_path, monkeypatch):
    """Contrat §6 : si genealis.paleo existe, read_document + mentions_from_reading sont utilisés."""
    from genealis.models import DocumentReading

    p = jean(db)
    med = media_for(db, tmp_path, p)
    calls = {"read": 0}

    def read_document(db_, media, *, options=None):
        calls["read"] += 1
        r = DocumentReading(media_id=media.id, diplomatic=BIRTH_TEXT, language="fr", extraction=birth_act(witnesses=False))
        db_.add(r)
        db_.flush()
        return r

    def mentions_from_reading(db_, reading, investigation_id=None):
        out = []
        for x in reading.extraction["persons"]:
            m = PersonMention(media_id=reading.media_id, reading_id=reading.id, investigation_id=investigation_id,
                              name_original=f"{x['given_names']} {x['surname']}", given_names=x["given_names"],
                              surname=x["surname"], sex=x.get("sex"), role=x["role"], reading_confidence=0.9,
                              relation_to_role="subject" if x["role"] in ("father", "mother") else None,
                              excerpt="fils de Nicolas DUPONT", image_region={"x": 100, "y": 200, "w": 300, "h": 40})
            db_.add(m)
            out.append(m)
        db_.flush()
        return out

    monkeypatch.setitem(sys.modules, "genealis.paleo.pipeline", types.SimpleNamespace(read_document=read_document))
    monkeypatch.setitem(sys.modules, "genealis.paleo.mentions", types.SimpleNamespace(mentions_from_reading=mentions_from_reading))
    inv = director.start_investigation(db, p.id, max_generations=0)
    db.commit()
    run(db, inv)
    assert calls["read"] == 1 and gemini.count("document") == 0
    assert db.query(PersonMention).filter(PersonMention.media_id == med.id).count() == 3
    rel = parents_of(db, p.id)[0][1]
    cit = db.query(Citation).filter(Citation.target_type == "parent_child", Citation.target_id == rel.id).one()
    assert cit.image_region == {"x": 100, "y": 200, "w": 300, "h": 40} and cit.excerpt == "fils de Nicolas DUPONT"


def test_resultat_browse_bloque_demande_humaine(db, gemini):
    p = jean(db)
    inv = director.start_investigation(db, p.id, max_generations=0)
    t, _ = queue.enqueue(db, inv.id, "browse", "Ouvrir AD", person_id=p.id, params={"start_url": "https://archives57.com/x"})
    queue.claim(db, "worker", kinds=["browse"])
    queue.block(db, t, "CAPTCHA détecté : aucun contournement", needs_human=True)
    director.process_browse_results(db, inv.id)
    q = db.query(Question).filter(Question.dedupe_key == f"inv:{inv.id}:human:{t.id}").one()
    assert "CAPTCHA" in q.problem


# ------------------------------------------------------------------ API
def test_api_enquetes(client, db, tmp_path, monkeypatch):
    cfg.set_value(db, "ai_provider", "gemini")
    cfg.set_value(db, "gemini_api_key", "k")
    cfg.set_value(db, "allow_external_ai", True)
    cfg.set_value(db, "ai_minute_call_limit", 0)
    cfg.set_value(db, "autonomy_mode", 1)
    cfg.set_value(db, "worker_last_seen", utcnow().isoformat())
    cfg.set_value(db, "worker_id", "pc-test")
    fake = FakeGemini()
    fake.documents = [marriage_act()]
    monkeypatch.setattr(httpx, "post", fake.post)
    p = jean(db)
    fam = _bride_family(db)
    med = media_for(db, tmp_path, p, "mariage.png")
    db.commit()
    r = client.post("/api/investigations", json={"person_id": p.id, "max_generations": 1, "ai_call_ceiling": 30})
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["status"] == "pending" and inv["status_label"] == "EN ATTENTE" and inv["person_name"] == "Jean DUPONT"
    assert inv["task_counts"] == {"pending": 1} and inv["stats"]["documents_found"] == 0
    assert client.post("/api/investigations", json={"person_id": "inconnu"}).status_code == 400
    iid = inv["id"]
    assert [i["id"] for i in client.get("/api/investigations").json()] == [iid]
    r = client.post(f"/api/investigations/{iid}/pause")
    assert r.json()["status"] == "paused" and r.json()["status_label"] == "EN PAUSE"
    assert client.post(f"/api/investigations/{iid}/step?budget_s=5").json()["executed"] == []
    assert client.post(f"/api/investigations/{iid}/resume").json()["status"] == "running"
    for _ in range(8):
        s = client.post(f"/api/investigations/{iid}/step?budget_s=20").json()
        if not s["executed"]:
            break
    d = client.get(f"/api/investigations/{iid}").json()
    assert d["stats"]["acts_analyzed"] == 1 and d["stats"]["documents_found"] == 1
    assert {t["kind"] for t in d["tasks"]} >= {"plan", "analyze_document", "verify", "witness_followup", "web_search"}
    assert all("status_label" in t for t in d["tasks"]) and len(d["next_searches"]) <= 10
    assert d["persons"][0]["id"] == p.id and d["persons"][0]["generation"] == 0
    assert set(d["memory"]) >= {"queries", "documents", "failures", "hypotheses", "next_searches"}
    kinds = {x["kind"] for x in d["discoveries"]}
    assert {"hypothesis", "mention"} <= kinds
    ev = client.get(f"/api/investigations/{iid}/events").json()
    assert ev and {"id", "ts", "kind", "message", "data", "task_id"} <= set(ev[0])
    later = client.get(f"/api/investigations/{iid}/events?after={ev[-2]['id']}").json()
    assert [e["id"] for e in later] == [ev[-1]["id"]]
    dash = client.get("/api/investigations/dashboard").json()
    assert dash["worker"] == {"online": True, "last_seen": dash["worker"]["last_seen"], "worker_id": "pc-test"}
    assert dash["acts_analyzed"] == 1 and dash["ai_calls"] >= 1 and sum(dash["by_status"].values()) == 1
    assert {"active", "persons_searched", "documents_found", "ancestors_identified", "filiations_verified", "hypotheses_open",
            "errors", "research_seconds", "estimated_cost_usd"} <= set(dash)
    # Mentions et réseau
    ms = client.get(f"/api/mentions?media_id={med.id}").json()
    assert len(ms) == 8 and {"stated_relation", "relation_kind", "candidates", "link_status", "image_region"} <= set(ms[0])
    assert len(client.get(f"/api/mentions?investigation_id={iid}").json()) == 8
    pierre_m = next(m for m in ms if m["given_names"] == "Pierre")
    net = client.get(f"/api/network/{fam['louise'].id}").json()
    assert any(n["kind"] == "document" for n in net["nodes"]) and any(e["stated_relation"] == "oncle maternel de l'épouse"
                                                                       for e in net["edges"])
    assert client.get("/api/network/inconnu").status_code == 404
    # Valider la relation indirecte (lien vers la personne de l'arbre), rejeter une autre hypothèse (jamais supprimée)
    hyp = next(x for x in d["discoveries"] if x["kind"] == "hypothesis" and x["subkind"] == "indirect_relation"
               and "Pierre MARTIN" in x["title"])
    r = client.post(f"/api/discoveries/hypothesis/{hyp['id']}/validate", json={})
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    assert client.get(f"/api/mentions?person_id={fam['pierre'].id}").json()[0]["id"] == pierre_m["id"]
    other = next(x for x in d["discoveries"] if x["kind"] == "hypothesis" and "BERNARD" in x["title"])
    r = client.post(f"/api/discoveries/hypothesis/{other['id']}/reject", json={"note": "lecture douteuse"})
    assert r.json()["status"] == "rejected"
    db.expire_all()
    assert db.get(Hypothesis, other["id"]) is not None
    fil = next(x for x in d["discoveries"] if x["kind"] == "hypothesis" and x["subkind"] == "filiation")
    r = client.post(f"/api/discoveries/hypothesis/{fil['id']}/validate", json={"note": "vérifié sur l'image"})
    assert r.status_code == 200 and r.json()["kind"] == "filiation"
    db.expire_all()
    assert {pp.given_names for pp, _ in parents_of(db, p.id)} == {"Nicolas", "Marie"}
    jb = next(m for m in ms if m["given_names"] == "Jacques")
    assert client.post(f"/api/discoveries/mention/{jb['id']}/reject").json()["status"] == "rejected"
    assert client.post(f"/api/discoveries/mention/{jb['id']}/validate", json={}).status_code == 400  # aucune personne indiquée
    r = client.post(f"/api/discoveries/mention/{jb['id']}/validate", json={"person_id": fam["nicolas"].id})
    assert r.json()["status"] == "confirmed"
    assert client.post("/api/discoveries/autre/x/validate").status_code == 400
    # Tâches : nouvel essai et assistance humaine
    task = next(t for t in d["tasks"] if t["kind"] == "analyze_document")
    r = client.post(f"/api/investigation-tasks/{task['id']}/retry")
    assert r.json()["status"] == "pending" and r.json()["params"]["_force"] is True
    b = client.get(f"/api/investigations/{iid}").json()
    browse = [t for t in b["tasks"] if t["kind"] in ("browse", "human_assist")]
    if browse:
        r = client.post(f"/api/investigation-tasks/{browse[0]['id']}/human-done", json={"note": "fait"})
        assert r.json()["status"] in ("pending", "done")
    # Arrêt : les tâches en attente sont annulées, rien n'est supprimé
    r = client.post(f"/api/investigations/{iid}/stop").json()
    assert r["status"] == "stopped" and r["task_counts"].get("pending", 0) == 0 and r["task_counts"].get("cancelled", 0) >= 1
    assert client.get("/api/investigations/inconnue").status_code == 404
