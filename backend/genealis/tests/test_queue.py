from datetime import timedelta

from genealis.investigation import queue
from genealis.models import Investigation, InvestigationEvent, utcnow


def _inv(db):
    inv = Investigation(title="Enquête test", status="running")
    db.add(inv)
    db.flush()
    return inv


def test_deduplication_et_priorite(db):
    inv = _inv(db)
    a, created = queue.enqueue(db, inv.id, "web_search", "Naissance", params={"q": "Jean Durant 1850"}, priority=40)
    b, created2 = queue.enqueue(db, inv.id, "web_search", "Naissance bis", params={"q": "Jean Durant 1850"})
    assert created and not created2 and a.id == b.id  # jamais deux fois la même recherche
    c, _ = queue.enqueue(db, inv.id, "browse", "Ouvrir registre", params={"url": "https://x"}, priority=90)
    t = queue.claim(db, "server")
    assert t.id == c.id and t.status == "running" and t.attempts == 1


def test_reprise_apres_interruption(db):
    """TEST 8 : une tâche en cours dont le processus s'est arrêté est reprise."""
    inv = _inv(db)
    t, _ = queue.enqueue(db, inv.id, "browse", "Ouvrir", params={"url": "https://a"})
    queue.claim(db, "worker-pc", lease_s=60)
    t.lease_until = utcnow() - timedelta(seconds=1)  # le PC a été éteint
    assert queue.requeue_expired(db) == 1 and t.status == "pending"
    again = queue.claim(db, "worker-pc")
    assert again.id == t.id and again.attempts == 2
    assert db.query(InvestigationEvent).filter_by(investigation_id=inv.id).count() >= 1


def test_echecs_et_pause(db):
    inv = _inv(db)
    t, _ = queue.enqueue(db, inv.id, "browse", "Ouvrir", params={"url": "https://b"}, max_attempts=2)
    queue.claim(db, "s")
    queue.fail(db, t, "timeout", delay_s=0)
    assert t.status == "pending"
    t.lease_until = None
    queue.claim(db, "s")
    queue.fail(db, t, "timeout")
    assert t.status == "failed"
    t2, _ = queue.enqueue(db, inv.id, "browse", "Autre", params={"url": "https://c"})
    inv.status = "paused"
    db.flush()
    assert queue.claim(db, "s") is None  # une enquête en pause ne distribue plus de tâches
    inv.status = "running"
    assert queue.claim(db, "s").id == t2.id
