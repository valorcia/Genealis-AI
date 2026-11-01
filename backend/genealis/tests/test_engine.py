import asyncio

import pytest

from genealis.agents import engine
from genealis.agents.questions import ask
from genealis.connectors.base import ArchiveConnector, ConnectorCapabilities, SearchQuery, SearchResult, registry
from genealis.models import Hypothesis, Question, ResearchTask
from genealis.services import settings_service as cfg
from genealis.tests.fixtures import build_fictional_family


class FakeArchive(ArchiveConnector):
    """Connecteur fictif de test : renvoie des résultats contrôlés (jamais utilisé en production)."""

    capabilities = ConnectorCapabilities(id="fake_test", name="Archive fictive de test", country="*", organization="test",
                                         collections=["test"], areas=["*"], period_start=1500, period_end=2100,
                                         search_fields=["surname"], access_mode="api", limitations=[], terms_url=None,
                                         reuse_terms="test", formats=["json"], homepage="http://localhost/none")
    min_interval = 0.0
    results: list[SearchResult] = []

    async def search(self, query):
        return list(self.results)


@pytest.fixture
def fake():
    c = FakeArchive()
    registry.register(c)
    yield c
    registry._connectors.pop("fake_test", None)


def test_planification_et_execution_avec_homonymes(db, fake):
    f = build_fictional_family(db)
    cfg.set_value(db, "autonomy_mode", 3)
    FakeArchive.results = [SearchResult(connector_id="fake_test", title="Jean DURANT, né 1929 Nancy (fictif)", url="http://x/1",
                                        record_type="birth", year=1929, repository="test", reliability="primary",
                                        candidate={"surname": "Durant", "given_names": "Jean", "birth_year": 1929, "birth_place": "Nancy"})]
    t = engine.enqueue(db, "find_birth", f["gf"].id)
    assert t.status == "queued" and any(s["connector_id"] == "fake_test" for s in t.plan)
    assert any(s["action"] == "browse" and s["connector_id"] == "ad54" for s in t.plan)  # AD54 proposé en navigateur
    asyncio.run(engine.coordinator.execute(db, t))
    db.flush()
    # Homonyme Jean Durant 1928 : pas d'attribution automatique, question posée, hypothèses concurrentes conservées
    qs = db.query(Question).filter(Question.status == "pending").all()
    assert any("Plusieurs personnes correspondent" in q.title for q in qs)
    hyps = db.query(Hypothesis).filter(Hypothesis.subject_person_id == f["gf"].id).all()
    assert hyps and all(h.status == "open" for h in hyps)
    assert t.result["ambiguous"] >= 1
    # Mémoire : recherche identique non relancée
    t2 = engine.enqueue(db, "find_birth", f["gf"].id)
    assert t2.id == t.id


def test_mode_autonome_enregistre_une_correspondance_forte(db, fake):
    f = build_fictional_family(db)
    cfg.set_value(db, "autonomy_mode", 3)
    FakeArchive.results = [SearchResult(connector_id="fake_test", title="Décès Giuseppe ROSSI 1990 (fictif)", url="http://x/2",
                                        record_type="death", year=1990, date_text="1990-04-02", repository="INSEE test", reliability="secondary",
                                        candidate={"surname": "Rossi", "given_names": "Giuseppe", "birth_year": 1928, "birth_place": "Udine",
                                                   "death_year": 1990, "event_year": 1990, "extra": {"event_type": "death"}})]
    t = engine.enqueue(db, "find_death", f["mgf"].id, force=True)
    asyncio.run(engine.coordinator.execute(db, t))
    from genealis.models import Citation, Source
    assert db.query(Source).filter(Source.connector_id == "fake_test").count() == 1
    assert db.query(Citation).filter(Citation.target_type == "person", Citation.target_id == f["mgf"].id).count() == 1


def test_mode_assiste_demande_validation(db, fake):
    f = build_fictional_family(db)
    cfg.set_value(db, "autonomy_mode", 2)
    FakeArchive.results = [SearchResult(connector_id="fake_test", title="Décès Giuseppe ROSSI 1990 (fictif)", url="http://x/3",
                                        record_type="death", year=1990, repository="t", reliability="secondary",
                                        candidate={"surname": "Rossi", "given_names": "Giuseppe", "birth_year": 1928, "birth_place": "Udine",
                                                   "death_year": 1990, "event_year": 1990, "extra": {"event_type": "death"}})]
    t = engine.enqueue(db, "find_death", f["mgf"].id, force=True)
    asyncio.run(engine.coordinator.execute(db, t))
    from genealis.models import Source
    assert db.query(Source).filter(Source.connector_id == "fake_test").count() == 0
    assert any("Confirmer" in q.title for q in db.query(Question).all())


def test_questions_non_repetitives(db):
    f = build_fictional_family(db)
    q1 = ask(db, title="Question test", problem="p", person_id=f["me"].id, dedupe_key="k1")
    q2 = ask(db, title="Question test", problem="p", person_id=f["me"].id, dedupe_key="k1")
    assert q1 is not None and q2 is None


def test_reprise_apres_interruption(db):
    f = build_fictional_family(db)
    cfg.set_value(db, "autonomy_mode", 2)
    t = engine.enqueue(db, "find_birth", f["father"].id)
    t.status = "running"
    db.flush()
    assert engine.recover_interrupted(db) == 1
    db.refresh(t)
    assert t.status == "queued" and t.attempts == 1


def test_exploration_equilibree_des_branches(db):
    f = build_fictional_family(db)
    cfg.set_value(db, "autonomy_mode", 2)
    tasks = engine.explore_branch(db, f["me"].id, generations=3)
    pids = {t.person_id for t in tasks}
    # branches paternelle (gf, gm) et maternelle (mgf) toutes planifiées
    assert f["gf"].id in pids and f["gm"].id in pids and f["mgf"].id in pids
    prio = {t.person_id: t.priority for t in tasks if t.task_type == "find_parents"}
    assert prio[f["gf"].id] == prio[f["mgf"].id]  # aucune branche privilégiée
