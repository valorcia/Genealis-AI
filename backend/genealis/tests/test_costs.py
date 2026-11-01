"""Gestionnaire de coûts : plafonds, quota simulé (TEST 9), cache, protection des personnes vivantes, migration."""
from __future__ import annotations

import json

import httpx
import pytest

from genealis.ai.errors import ExternalTransferRefused, QuotaExceeded
from genealis.ai.providers import AIClient
from genealis.models import AICallLog, Investigation
from genealis.services import cost
from genealis.services import settings_service as cfg
from genealis.tests.fixtures import build_fictional_family


class FakeGemini:
    """Remplace le réseau : compte les requêtes réellement envoyées et enregistre leur contenu."""

    def __init__(self, status: int = 200, body: dict | None = None, text: str = ""):
        self.calls: list[dict] = []
        self.status, self.body, self.text = status, body, text

    def post(self, url, params=None, json=None, timeout=None, **kw):
        self.calls.append({"url": url, "json": json})
        req = httpx.Request("POST", url)
        if self.status != 200:
            return httpx.Response(self.status, text=self.text, request=req)
        return httpx.Response(200, json=self.body or {
            "candidates": [{"content": {"parts": [{"text": "réponse"}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 120, "candidatesTokenCount": 30, "thoughtsTokenCount": 50}}, request=req)


@pytest.fixture
def gemini(db, monkeypatch):
    cfg.set_value(db, "ai_provider", "gemini")
    cfg.set_value(db, "gemini_api_key", "cle-de-test")
    cfg.set_value(db, "allow_external_ai", True)
    fake = FakeGemini()
    monkeypatch.setattr(httpx, "post", fake.post)
    return fake


def test_comptage_jetons_et_cache(db, gemini):
    ai = AIClient(db)
    r1 = ai.complete("sys", "Lis cet acte", purpose="lecture", personal=False)
    r2 = ai.complete("sys", "Lis cet acte", purpose="lecture", personal=False)
    assert len(gemini.calls) == 1, "la seconde demande identique doit venir du cache"
    assert not r1.cached and r2.cached and r2.text == "réponse"
    assert r1.usage == {"input_tokens": 120, "output_tokens": 30, "thinking_tokens": 50}
    s = cost.summary(db)
    assert s["today"]["calls"] == 1 and s["today"]["cache_hits"] == 1


def test_quota_quotidien_simule_arrete_les_appels(db, gemini):
    """TEST 9 : un quota atteint stoppe les appels AVANT tout envoi réseau."""
    cfg.set_value(db, "ai_daily_call_limit", 2)
    cfg.set_value(db, "ai_minute_call_limit", 0)
    ai = AIClient(db)
    ai.complete("s", "a", personal=False, cacheable=False)
    ai.complete("s", "b", personal=False, cacheable=False)
    with pytest.raises(QuotaExceeded) as exc:
        ai.complete("s", "c", personal=False, cacheable=False)
    assert exc.value.scope == "daily"
    assert len(gemini.calls) == 2
    assert db.query(AICallLog).filter_by(status="quota_refused").count() == 1


def test_429_suspend_les_appels(db, monkeypatch):
    cfg.set_value(db, "ai_provider", "gemini")
    cfg.set_value(db, "gemini_api_key", "k")
    cfg.set_value(db, "allow_external_ai", True)
    fake = FakeGemini(status=429, text=json.dumps({"error": {"details": [{"retryDelay": "40s"}]}}))
    monkeypatch.setattr(httpx, "post", fake.post)
    ai = AIClient(db)
    with pytest.raises(QuotaExceeded) as e1:
        ai.complete("s", "x", personal=False)
    assert e1.value.scope == "provider" and e1.value.retry_after_s >= 40
    with pytest.raises(QuotaExceeded):
        ai.complete("s", "y", personal=False)
    assert len(fake.calls) == 1, "après un 429, plus aucun appel n'est envoyé pendant la suspension"


def test_plafond_par_enquete(db, gemini):
    cfg.set_value(db, "ai_minute_call_limit", 0)
    inv = Investigation(title="Test", ai_call_ceiling=1)
    db.add(inv)
    db.flush()
    ai = AIClient(db)
    with cost.ai_context(investigation_id=inv.id):
        ai.complete("s", "1", personal=False)
        with pytest.raises(QuotaExceeded) as exc:
            ai.complete("s", "2", personal=False)
    assert exc.value.scope == "investigation" and inv.ai_calls_used == 1


def test_mode_gratuit_refuse_service_payant(db):
    cfg.set_value(db, "ai_provider", "anthropic")
    cfg.set_value(db, "anthropic_api_key", "k")
    cfg.set_value(db, "allow_external_ai", True)
    with pytest.raises(QuotaExceeded) as exc:
        AIClient(db).complete("s", "u", personal=False)
    assert exc.value.scope == "mode"


def test_mode_commercial_refuse_abonnements_personnels(db):
    cfg.set_value(db, "ai_provider", "manual")
    cfg.set_value(db, "cost_mode", "commercial")
    with pytest.raises(QuotaExceeded):
        AIClient(db).complete("s", "u")


def test_personnes_vivantes_pseudonymisees(db, gemini):
    f = build_fictional_family(db)  # Camille Durant : vivante (is_living=True)
    ai = AIClient(db)
    r = ai.complete("Analyse", "Camille Durant est la petite-fille de Jean Marie Durant.", purpose="analyse")
    sent = json.dumps(gemini.calls[0]["json"], ensure_ascii=False)
    assert "Camille Durant" not in sent and "Jean Marie Durant" in sent  # l'ancêtre décédé reste lisible
    assert r.text == "réponse"
    with pytest.raises(ExternalTransferRefused):  # document rattaché à une personne vivante
        ai.complete("s", "Lis", attachments=[(b"\x89PNG....", "image/png")], subject_person_ids=[f["me"].id])
    with pytest.raises(ExternalTransferRefused):  # recherche web nominative sur une personne vivante
        ai.complete("s", "Cherche Camille Durant", web_search=True)
    cfg.set_value(db, "allow_living_data_external", True)
    ai.complete("s", "Camille Durant 2", purpose="analyse")
    assert "Camille Durant" in json.dumps(gemini.calls[-1]["json"], ensure_ascii=False)


def test_api_couts(client):
    r = client.get("/api/costs/summary")
    assert r.status_code == 200 and r.json()["mode"] == "free" and r.json()["mode_label"] == "GRATUIT"
    assert client.get("/api/ai/gemini/audit").json()["key_set"] is False


def test_migration_additive_sur_base_v03(tmp_path):
    """Une base v0.3 (sans les tables v0.4) est mise à niveau sans perte."""
    import sqlalchemy as sa

    from genealis import db as dbmod
    from genealis.db import Base

    path = tmp_path / "v03.db"
    eng = dbmod.init_engine(path)
    from genealis import models  # noqa: F401

    v04 = {"investigations", "investigation_tasks", "investigation_events", "page_visits", "ai_call_logs", "ai_cache",
           "document_readings", "reading_corrections", "person_mentions"}
    Base.metadata.create_all(eng, tables=[t for n, t in Base.metadata.tables.items() if n not in v04])
    with eng.begin() as c:
        c.execute(sa.text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))
        c.execute(sa.text("INSERT INTO alembic_version VALUES ('4d14b1ed1de1')"))
        c.execute(sa.text("INSERT INTO persons (id, given_names, surname, is_root, confidence, name_variants, "
                          "confidence_details, research_status, created_at, updated_at) VALUES ('p1','Jean','Test',0,'grey',"
                          "'[]','{}','{}','2026-01-01','2026-01-01')"))
    dbmod._stamp_or_upgrade(eng)
    insp = sa.inspect(eng)
    assert v04 <= set(insp.get_table_names())
    with eng.connect() as c:
        assert c.execute(sa.text("SELECT version_num FROM alembic_version")).scalar() == "7b2c4e9a0f11"
        assert c.execute(sa.text("SELECT given_names FROM persons WHERE id='p1'")).scalar() == "Jean"
    eng.dispose()


GOOGLE_DAILY_429 = json.dumps({"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "You exceeded your current quota.",
    "details": [{"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [
        {"quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
         "quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
         "quotaDimensions": {"location": "global", "model": "gemini-3.8-flash"}, "quotaValue": "250"}]},
        {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "21s"}]}})


def test_429_quota_du_jour_attend_le_lendemain(db, monkeypatch):
    """Quota QUOTIDIEN de Google : aucun nouvel essai avant le renouvellement (et pas toutes les minutes)."""
    from datetime import datetime

    cfg.set_value(db, "ai_provider", "gemini")
    cfg.set_value(db, "gemini_api_key", "k")
    cfg.set_value(db, "allow_external_ai", True)
    fake = FakeGemini(status=429, text=GOOGLE_DAILY_429)
    monkeypatch.setattr(httpx, "post", fake.post)
    with pytest.raises(QuotaExceeded) as exc:
        AIClient(db).complete("s", "x", personal=False)
    msg = str(exc.value)
    assert "quota GRATUIT DU JOUR" in msg and "gemini-3.8-flash" in msg and "250" in msg
    assert exc.value.retry_after_s > 3600, "un quota du jour n'est pas réessayé au bout d'une minute"
    until = datetime.fromisoformat(cfg.get(db, "ai_quota_blocked_until"))
    assert until == cost._next_pacific_midnight()
    with pytest.raises(QuotaExceeded) as exc2:
        AIClient(db).complete("s", "y", personal=False)
    assert "quota GRATUIT DU JOUR" in str(exc2.value) and len(fake.calls) == 1
    assert cost.summary(db)["quota_detail"]["per_day"] is True


def test_429_repetes_attente_croissante(db, monkeypatch):
    cfg.set_value(db, "ai_provider", "gemini")
    cfg.set_value(db, "gemini_api_key", "k")
    cfg.set_value(db, "allow_external_ai", True)
    fake = FakeGemini(status=429, text=json.dumps({"error": {"details": [{"retryDelay": "10s"}]}}))
    monkeypatch.setattr(httpx, "post", fake.post)
    waits = []
    for i in range(3):
        cfg.set_value(db, "ai_quota_blocked_until", None)  # délai écoulé
        with pytest.raises(QuotaExceeded) as exc:
            AIClient(db).complete("s", f"q{i}", personal=False)
        waits.append(exc.value.retry_after_s)
    assert waits[0] >= 59 and waits[1] >= 2 * 59 and waits[2] >= 4 * 59
