"""Traçabilité des recherches et recherche web IA (Gemini simulé : aucun appel réseau)."""
import asyncio
import json

import pytest

from genealis.agents import engine
from genealis.agents.planner import plan_task
from genealis.ai import providers
from genealis.ai.providers import AIResponse
from genealis.connectors import registry_service  # noqa: F401
from genealis.connectors.base import AccessRestricted, ArchiveConnector, ConnectorCapabilities, SearchQuery, registry
from genealis.connectors.gemini_web import GeminiWebConnector, reliability_for
from genealis.models import ConnectorStatus, ResearchTask
from genealis.services import settings_service as cfg
from genealis.tests.fixtures import build_fictional_family

GROUNDING = {
    "queries": ["Pierre Durant 1960 Nancy naissance", "site:geneanet.org Durant Nancy"],
    "sources": [
        {"index": 0, "title": "geneanet.org", "url": "https://gw.geneanet.org/fictif?n=durant&p=pierre", "domain": "gw.geneanet.org"},
        {"index": 1, "title": "archives.meurthe-et-moselle.fr", "url": "https://archives.meurthe-et-moselle.fr/etat-civil/nancy",
         "domain": "archives.meurthe-et-moselle.fr"},
    ],
    "supports": [{"text": "Pierre Durant né le 3 février 1960 à Nancy, fils de Jean Marie Durant", "sources": [0]}],
}
ANSWER = {
    "findings": [
        {"type": "tree", "summary": "Arbre : Pierre Durant né en 1960 à Nancy, fils de Jean Marie Durant",
         "persons": {"subject": {"given_names": "Pierre", "surname": "Durant", "birth_year": 1960, "birth_place": "Nancy"},
                     "father": {"given_names": "Jean Marie", "surname": "Durant"}, "mother": {"given_names": "Marie", "surname": "Kowalski"}},
         "date": "1960", "place": "Nancy", "url": "https://gw.geneanet.org/fictif?n=durant&p=pierre", "site": "geneanet.org",
         "quote": "Pierre Durant né le 3 février 1960 à Nancy, fils de Jean Marie Durant", "confidence": "medium"},
        {"type": "birth", "summary": "Registre des naissances de Nancy 1960 (accès aux images)",
         "persons": {"subject": {"given_names": "Pierre", "surname": "Durant", "birth_year": "1960"}},
         "date": "1960", "place": "Nancy", "url": "https://archives.meurthe-et-moselle.fr/inventee/page", "site": "archives.meurthe-et-moselle.fr",
         "quote": "", "confidence": "low"},
        {"type": "death", "summary": "Page inventée", "persons": {"subject": {"surname": "Durant"}},
         "url": "https://filae.com/page-inventee", "site": "filae.com", "quote": "", "confidence": "low"},
    ],
    "not_found": ["FamilySearch : aucun acte indexé pour Pierre Durant"],
}


@pytest.fixture
def fake_gemini(monkeypatch):
    calls = []

    def complete(self, system, user, **kw):
        calls.append({"system": system, "user": user, **kw})
        assert kw.get("web_search") is True
        return AIResponse(json.dumps(ANSWER), "gemini", "gemini-test", {}, json.loads(json.dumps(GROUNDING)))

    monkeypatch.setattr(providers.AIClient, "can_search_web", lambda self: True)
    monkeypatch.setattr(providers.AIClient, "complete", complete)
    return calls


def test_connecteur_gemini_urls_uniquement_issues_du_grounding(fake_gemini):
    c = registry.get("gemini_web")
    assert isinstance(c, GeminiWebConnector) and c.capabilities.access_mode == "api" and c.capabilities.country == "*"
    q = SearchQuery(surname="Durant", given_names="Pierre", year_from=1958, year_to=1962, commune="Nancy", department="54",
                    register_type="birth", extra={"father": "Jean Marie DURANT", "country": "FR", "countries": ["FR"]})
    res = asyncio.run(c.search(q))
    urls = {s["url"] for s in GROUNDING["sources"]}
    assert len(res) == 2 and all(r.url in urls for r in res)  # la page inventée n'est jamais retenue comme résultat
    tree, birth = res
    assert tree.reliability == "derivative" and birth.reliability == "secondary"
    assert birth.url == "https://archives.meurthe-et-moselle.fr/etat-civil/nancy"  # remplacée par la vraie page consultée
    assert tree.candidate["father_name"] == "Jean Marie Durant" and tree.candidate["birth_year"] == 1960
    assert tree.raw["finding"]["source_indices"] == [0]
    g = res.grounding
    assert g["queries"] == GROUNDING["queries"] and len(g["sources"]) == 2 and g["not_found"]
    assert len(g["notes"]) == 1 and g["notes"][0]["url"] == "https://filae.com/page-inventee"
    prompt = fake_gemini[0]["user"]
    for site in ("Geneanet", "Filae", "FamilySearch", "archives.meurthe-et-moselle.fr", "Mémoire des Hommes", "Jean Marie DURANT"):
        assert site in prompt
    assert reliability_for("familysearch.org", "https://www.familysearch.org/tree/person/x", "birth") == "derivative"
    assert reliability_for("familysearch.org", "https://www.familysearch.org/ark:/61903/1:1:X", "birth") == "secondary"


def test_connecteur_gemini_indisponible_sans_cle(db):
    with pytest.raises(AccessRestricted) as exc:
        asyncio.run(registry.get("gemini_web").search(SearchQuery(surname="Durant")))
    assert "Paramètres" in str(exc.value)


def test_planificateur_inclut_gemini_seulement_si_disponible(db, monkeypatch):
    f = build_fictional_family(db)
    t = engine.enqueue(db, "find_parents", f["father"].id, force=True)
    assert not any(s["connector_id"] == "gemini_web" for s in t.plan)
    monkeypatch.setattr(providers.AIClient, "can_search_web", lambda self: True)
    t2 = engine.enqueue(db, "find_parents", f["father"].id, force=True)
    web = [s for s in t2.plan if s["connector_id"] == "gemini_web"]
    assert len(web) == 1 and t2.plan[0]["connector_id"] == "gemini_web"
    extra = web[0]["query"]["extra"]
    assert "Jean Marie DURANT" in extra.get("father", "") and "Marie KOWALSKI" in extra.get("mother", "")
    assert "Anna ROSSI" in " ".join(extra.get("spouses", []))
    # Décès : l'index INSEE local passe en premier, la recherche web juste après
    t3 = engine.enqueue(db, "find_death", f["gf"].id, force=True)
    assert [s["connector_id"] for s in t3.plan[:2]] == ["insee_deces_local", "gemini_web"]
    # Types non concernés
    t4 = ResearchTask(task_type="find_census", title="x", person_id=f["gf"].id)
    assert not any(s.connector_id == "gemini_web" for s in plan_task(db, t4, f["gf"]))


class _Failing(ArchiveConnector):
    capabilities = ConnectorCapabilities(id="trace_fail", name="Archive en panne (test)", country="*", organization="t", collections=[],
                                         areas=["*"], period_start=None, period_end=None, search_fields=[], access_mode="api",
                                         limitations=[], terms_url=None, reuse_terms="", formats=[], homepage="https://panne.example.org")
    min_interval = 0.0

    async def search(self, query):
        raise RuntimeError("connexion refusée")

    async def self_test(self):
        return {"ok": False, "status": "failed", "details": {"error": "connexion refusée"}}


class _Restricted(_Failing):
    capabilities = ConnectorCapabilities(id="trace_restricted", name="Archive protégée (test)", country="*", organization="t", collections=[],
                                         areas=["*"], period_start=None, period_end=None, search_fields=[], access_mode="html",
                                         limitations=[], terms_url=None, reuse_terms="", formats=[], homepage="https://protege.example.org")

    async def search(self, query):
        raise AccessRestricted("CAPTCHA")

    async def self_test(self):
        return {"ok": False, "status": "manual", "details": {"error": "CAPTCHA"}}


class _Ok(_Failing):
    capabilities = ConnectorCapabilities(id="trace_ok", name="Archive qui marche (test)", country="*", organization="t", collections=[],
                                         areas=["*"], period_start=None, period_end=None, search_fields=[], access_mode="api",
                                         limitations=[], terms_url=None, reuse_terms="", formats=[], homepage="https://ok.example.org")

    async def self_test(self):
        return {"ok": True, "status": "ok", "details": {"sample_results": 3}}


class _Slow(_Failing):
    capabilities = ConnectorCapabilities(id="trace_slow", name="Archive lente (test)", country="*", organization="t", collections=[],
                                         areas=["*"], period_start=None, period_end=None, search_fields=[], access_mode="api",
                                         limitations=[], terms_url=None, reuse_terms="", formats=[], homepage="https://lent.example.org")

    async def self_test(self):
        await asyncio.sleep(5)
        return {"ok": True, "status": "ok", "details": {}}


def _run_traced_task(db, f):
    cfg.set_value(db, "autonomy_mode", 2)
    for c in (_Failing(), _Restricted()):
        registry.register(c)
    t = engine.enqueue(db, "find_parents", f["father"].id, force=True)
    web = next(s for s in t.plan if s["connector_id"] == "gemini_web")
    q = web["query"]
    t.plan = [web, {"action": "search", "connector_id": "trace_fail", "label": "Interroger l'archive en panne", "query": q, "status": "pending", "result": {}},
              {"action": "search", "connector_id": "trace_restricted", "label": "Interroger l'archive protégée", "query": q, "status": "pending", "result": {}},
              *[s for s in t.plan if s["action"] in ("browse", "compare", "record")]]
    db.commit()
    asyncio.run(engine.coordinator.execute(db, t))
    db.commit()
    return t


@pytest.fixture
def cleanup_fakes():
    yield
    for cid in ("trace_fail", "trace_restricted", "trace_ok", "trace_slow"):
        registry._connectors.pop(cid, None)


def test_execution_trace_complete(db, fake_gemini, cleanup_fakes):
    f = build_fictional_family(db)
    t = _run_traced_task(db, f)
    steps = {s["connector_id"]: s for s in t.plan}
    g = steps["gemini_web"]["result"]
    assert g["status"] == "ok" and g["count"] == 2 and g["duration_ms"] >= 0 and g["started_at"] and g["finished_at"]
    assert g["verify_url"].startswith("https://www.google.com/search?q=Pierre+Durant")
    assert g["grounding"]["queries"] == GROUNDING["queries"] and g["grounding"]["not_found"]
    assert {r["url"] for r in g["results"]} <= {s["url"] for s in GROUNDING["sources"]}
    assert g["searched"]["name"] == "Pierre DURANT"
    fail = steps["trace_fail"]["result"]
    assert fail["status"] == "error" and "connexion refusée" in fail["message"] and fail["verify_url"] == "https://panne.example.org"
    rest = steps["trace_restricted"]["result"]
    assert rest["status"] == "restricted" and rest["count"] == 0 and rest["verify_url"]
    ad54 = steps.get("ad54")
    assert ad54 and ad54["result"]["status"] == "manual" and ad54["result"]["verify_url"]
    # Le journal porte les mêmes éléments essentiels
    from genealis.models import ResearchLog
    rlog = db.query(ResearchLog).filter(ResearchLog.task_id == t.id, ResearchLog.connector_id == "gemini_web",
                                        ResearchLog.category == "result").one()
    assert rlog.outcome["count"] == 2 and "gw.geneanet.org" in rlog.outcome["sources"] and rlog.outcome["verify_url"]


def test_endpoints_trace(client, fake_gemini, cleanup_fakes):
    from genealis.db import session_scope

    with session_scope() as db:
        f = build_fictional_family(db)
        db.commit()
        t = _run_traced_task(db, f)
        tid, pid = t.id, f["father"].id
    lst = client.get("/api/trace/tasks", params={"person_id": pid}).json()
    item = next(x for x in lst if x["id"] == tid)
    assert item["person_name"] == "Pierre DURANT" and item["summary"]["sites_queried"] == 3
    assert item["summary"]["sites_failed"] == 1 and item["summary"]["sites_restricted"] == 1 and item["summary"]["results"] == 2
    assert "3 sites interrogés" in item["summary"]["sentence"]
    d = client.get(f"/api/trace/tasks/{tid}").json()
    assert d["conclusion"].startswith("3 sites interrogés") and d["person"]["name"] == "Pierre DURANT"
    web = next(s for s in d["steps"] if s["connector_id"] == "gemini_web")
    assert web["outcome"] == "ok" and web["result"]["grounding"]["sources"] and web["connector_name"].startswith("Recherche web IA")
    assert any(s["outcome"] == "manual" for s in d["steps"])
    assert d["logs"] and all(isinstance(h["id"], str) for h in d["hypotheses"])
    assert client.get("/api/trace/tasks/inexistant").status_code == 404
    sites = client.get("/api/trace/sites").json()
    gw = next(s for s in sites["sites"] if s["connector_id"] == "gemini_web")
    assert gw["searches"] == 1 and gw["results"] == 2 and gw["last_status"] == "ok"
    fail = next(s for s in sites["sites"] if s["connector_id"] == "trace_fail")
    assert fail["last_status"] == "error" and "connexion refusée" in fail["last_error"]
    assert any(w["domain"] == "gw.geneanet.org" for w in sites["web_domains"])
    geneanet = next(s for s in sites["sites"] if s["connector_id"] == "geneanet")
    assert geneanet["color"] == "orange" and "navigateur" in geneanet["explanation"]
    # Découvertes reliées à la recherche
    disc = client.get("/api/research/discoveries").json()
    assert all("task_id" in x for x in disc)


def test_diagnostic_sans_reseau(client, monkeypatch, cleanup_fakes):
    from genealis.api import trace

    fakes = {c.id: c for c in (_Ok(), _Failing(), _Restricted(), _Slow(), registry.get("gemini_web"), registry.get("geneanet"))}
    monkeypatch.setattr(registry, "_connectors", fakes)
    monkeypatch.setattr(trace, "DIAGNOSTIC_TIMEOUT", 1.0)
    r = client.post("/api/trace/diagnostic")
    assert r.status_code == 200, r.text
    data = r.json()
    by = {x["connector_id"]: x for x in data["results"]}
    assert by["trace_ok"]["result"] == "ok" and by["trace_ok"]["latency_ms"] is not None
    assert by["trace_fail"]["result"] == "failed" and "injoignable" in by["trace_fail"]["message"]
    assert by["trace_restricted"]["result"] == "restricted"
    assert by["trace_slow"]["result"] == "failed" and "pas de réponse" in by["trace_slow"]["message"]
    assert by["gemini_web"]["result"] == "restricted" and "clé absente ou recherche web désactivée" in by["gemini_web"]["message"]
    assert by["geneanet"]["result"] == "restricted" and "navigateur uniquement" in by["geneanet"]["message"]
    assert data["results"][0]["connector_id"] == "gemini_web" and data["summary"]["ok"] == 1
    from genealis.db import session_scope

    with session_scope() as db:
        assert db.get(ConnectorStatus, "trace_ok").status == "ok"
        assert db.get(ConnectorStatus, "trace_slow").status == "failed"
        assert db.get(ConnectorStatus, "gemini_web").status == "manual"
