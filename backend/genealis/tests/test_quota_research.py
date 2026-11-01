"""Recherche web Gemini (moteur v0.3) face aux limites d'appels : reportée et relancée, jamais « faite sans résultat »."""
from __future__ import annotations

import asyncio
from datetime import timedelta

import httpx
import pytest

from genealis.agents import engine
from genealis.models import ResearchTask, utcnow
from genealis.services import settings_service as cfg
from genealis.tests.fixtures import build_fictional_family


@pytest.fixture
def gemini_cfg(db, monkeypatch):
    cfg.set_value(db, "ai_provider", "gemini")
    cfg.set_value(db, "gemini_api_key", "cle-de-test")
    cfg.set_value(db, "allow_external_ai", True)
    cfg.set_value(db, "autonomy_mode", 2)
    sent = []

    def no_network(*a, **k):
        sent.append(a)
        raise AssertionError("aucun appel ne doit partir vers Google pendant une suspension")

    monkeypatch.setattr(httpx, "post", no_network)
    return sent


def _gemini_only_task(db, person_id):
    t = engine.enqueue(db, "find_parents", person_id, force=True)
    t.plan = [s for s in t.plan if s.get("connector_id") == "gemini_web"]
    assert t.plan, "Gemini doit être planifié quand il est configuré"
    db.commit()
    return t.id


@pytest.mark.parametrize("scope", ["provider", "minute"])
def test_recherche_reportee_puis_relancee(db, gemini_cfg, scope):
    f = build_fictional_family(db)  # Jean Marie Durant : décédé (pas de protection « personne vivante »)
    if scope == "provider":
        cfg.set_value(db, "ai_quota_blocked_until", (utcnow() + timedelta(minutes=5)).isoformat(timespec="seconds"))
    else:
        cfg.set_value(db, "ai_minute_call_limit", 1)
        from genealis.models import AICallLog

        db.add(AICallLog(provider="gemini", model="m", purpose="x", status="ok"))
    tid = _gemini_only_task(db, f["gf"].id)
    assert asyncio.run(engine.worker.run_once()) is True
    db.expire_all()
    t = db.get(ResearchTask, tid)
    step = t.plan[0]
    assert t.status == "queued" and t.result.get("retry_after"), "la tâche revient en file au lieu d'être « terminée »"
    assert step["status"] == "deferred" and "relancée automatiquement" in step["result"]["message"]
    expected = "Google indique" if scope == "provider" else "limite de sécurité de GENEALIS"
    assert expected in step["result"]["message"]
    assert gemini_cfg == [], "rien n'a été envoyé à Google"
    # Pas de relance avant l'heure prévue (pas de boucle)
    assert asyncio.run(engine.worker.run_once()) is False
    # Une nouvelle demande identique n'est pas bloquée par « recherche déjà effectuée »
    again = engine.enqueue(db, "find_parents", f["gf"].id)
    assert again.id == tid


def test_relance_apres_l_heure_prevue(db, gemini_cfg, monkeypatch):
    f = build_fictional_family(db)
    cfg.set_value(db, "ai_quota_blocked_until", (utcnow() + timedelta(minutes=5)).isoformat(timespec="seconds"))
    tid = _gemini_only_task(db, f["gf"].id)
    asyncio.run(engine.worker.run_once())
    # Le quota est rétabli et l'heure de reprise passée
    cfg.set_value(db, "ai_quota_blocked_until", None)
    t = db.get(ResearchTask, tid)
    t.result = {**t.result, "retry_after": (utcnow() - timedelta(seconds=1)).isoformat(timespec="seconds")}
    db.commit()
    from genealis.connectors.base import registry

    async def ok_search(q):
        return []

    monkeypatch.setattr(registry.get("gemini_web"), "search", ok_search)
    assert asyncio.run(engine.worker.run_once()) is True
    db.expire_all()
    t = db.get(ResearchTask, tid)
    assert t.status == "done" and "retry_after" not in t.result and t.plan[0]["status"] != "deferred"
