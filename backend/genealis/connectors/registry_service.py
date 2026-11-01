"""Chargement, test et état des connecteurs."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import utcnow, ConnectorStatus
from . import france, free_sources, insee_local, international  # noqa: F401 - enregistre les connecteurs
from .base import registry


def connector_overview(db: Session) -> list[dict]:
    statuses = {s.connector_id: s for s in db.execute(select(ConnectorStatus)).scalars()}
    out = []
    for c in registry.all():
        st = statuses.get(c.id)
        caps = c.capabilities.to_dict()
        out.append({**caps,
                    "status": st.status if st else ("manual" if c.capabilities.access_mode in ("browser", "manual") else "untested"),
                    "last_test_at": st.last_test_at.isoformat() if st and st.last_test_at else None,
                    "test_details": st.details if st else {}, "enabled": st.enabled if st else True,
                    "operational": bool(st and st.status == "ok")})
    out.sort(key=lambda x: (x["country"] != "FR", x["access_mode"] not in ("api", "html"), x["name"]))
    return out


async def test_connector(db: Session, cid: str) -> dict:
    c = registry.get(cid)
    if not c:
        raise KeyError(cid)
    if c.capabilities.access_mode in ("browser", "manual"):
        result = await c.self_test()
        result["status"] = "manual" if result.get("ok") else result.get("status", "failed")
        result["details"]["note"] = "Connecteur assisté par navigateur : seule la joignabilité du site est testée."
    else:
        result = await c.self_test()
    st = db.get(ConnectorStatus, cid)
    if st is None:
        st = ConnectorStatus(connector_id=cid)
        db.add(st)
    st.status = result["status"]
    st.last_test_at = utcnow()
    st.details = result.get("details", {})
    db.flush()
    return {"connector_id": cid, **result}
