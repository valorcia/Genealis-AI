from genealis.services.confidence import recompute_all, score_relation
from genealis.services.consistency import run_all
from genealis.services.matching import Candidate, find_matches, score_candidate
from genealis.tests.fixtures import build_fictional_family


def test_contradiction_enfant_apres_deces_mere(db):
    f = build_fictional_family(db)
    rows = run_all(db)
    kinds = {c.kind for c in rows}
    assert "born_after_mother_death" in kinds
    c = next(c for c in rows if c.kind == "born_after_mother_death")
    assert f["late_child"].id in c.person_ids and c.severity == "red"
    # Les données ne sont jamais supprimées
    assert db.get(type(f["late_child"]), f["late_child"].id) is not None


def test_confiance_sources_independantes(db):
    f = build_fictional_family(db)
    run_all(db)
    recompute_all(db)
    db.refresh(f["rel_gf"])
    db.refresh(f["rel_gm"])
    # Deux sources indépendantes primaires -> vert
    assert f["rel_gf"].confidence == "green"
    # Deux copies du même acte -> comptent pour une seule source -> orange
    assert f["rel_gm"].confidence == "orange"
    assert f["rel_gm"].confidence_details["sources"] == 1
    # Relation sans source -> gris
    rel_me = [r for r in db.query(__import__("genealis.models", fromlist=["ParentChild"]).ParentChild).all() if r.child_id == f["me"].id and r.relation_type == "biological"][0]
    assert rel_me.confidence == "grey"


def test_homonymes_jamais_choisis_arbitrairement(db):
    f = build_fictional_family(db)
    cand = Candidate(surname="Durant", given_names="Jean", birth_year=1929, birth_place="Nancy")
    matches = find_matches(db, cand, min_total=40)
    ids = [m.person_id for m in matches]
    assert f["gf"].id in ids and f["homonym"].id in ids
    # Le seul patronyme ne suffit jamais à établir une correspondance verte
    only_name = score_candidate(db, Candidate(surname="Durant"), f["father"])
    assert only_name.level != "green" and only_name.total <= 45
    # Contradiction chronologique bloquante
    late = score_candidate(db, Candidate(surname="Durant", given_names="Pierre", event_year=1950, extra={"event_type": "marriage"}), f["father"])
    assert late.blocking and late.level == "red"
    # Correspondance riche -> vert, avec critères explicables
    rich = score_candidate(db, Candidate(surname="Durant", given_names="Pierre", birth_year=1960, birth_place="Nancy",
                                         father_name="Jean Marie Durant", mother_name="Marie Kowalski"), f["father"])
    assert rich.level == "green"
    assert any(c.name == "père" for c in rich.criteria)
