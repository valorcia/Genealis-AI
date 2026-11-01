"""Mode hébergé : export/import JSON, exécution bornée, protection par mot de passe."""
import asyncio
import io

from genealis import config
from genealis.agents import engine
from genealis.models import Person
from genealis.services import settings_service as cfg
from genealis.services.backup import export_json, import_json
from genealis.tests.fixtures import build_fictional_family


def test_export_import_json(db):
    build_fictional_family(db)
    dump = export_json(db)
    assert '"persons"' in dump and "Kowalski" in dump
    db.query(Person).delete()
    db.flush()
    stats = import_json(db, dump.encode("utf-8"))
    assert stats["persons"] == 10 and stats["parent_child"] >= 7 and stats["sources"] == 3
    assert db.query(Person).count() == 10


def test_run_budget_sans_processus_permanent(db):
    f = build_fictional_family(db)
    cfg.set_value(db, "autonomy_mode", 2)
    engine.enqueue(db, "find_birth", f["father"].id)
    db.commit()
    res = asyncio.run(engine.run_budget(20, max_tasks=1))
    assert res["ran"] == 1 and not res["locked"]
    db.expire_all()
    from genealis.models import ResearchTask
    assert db.query(ResearchTask).filter(ResearchTask.status == "done").count() == 1


def test_protection_par_mot_de_passe(client):
    config.settings.access_token = "secret-test"
    try:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/persons").status_code == 401
        assert client.post("/api/auth/login", json={"password": "faux"}).status_code == 401
        r = client.post("/api/auth/login", json={"password": "secret-test"})
        assert r.status_code == 200
        assert client.get("/api/persons").status_code == 200  # cookie posé
        assert client.get("/api/persons", headers={"X-Genealis-Token": "secret-test"}).status_code == 200
    finally:
        config.settings.access_token = None


def test_recherche_plein_texte_portable(client):
    client.post("/api/persons", json={"given_names": "Józef", "surname": "Kowalski", "birth_date": "1900", "birth_place": "Łódź"})
    assert any("KOWALSKI" in r["title"] for r in client.get("/api/search?q=kowalski").json())
    assert any("KOWALSKI" in r["title"] for r in client.get("/api/search?q=jozef").json())
