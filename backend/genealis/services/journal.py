"""Journal des opérations réelles (recherches en direct) + décisions des agents."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy.orm import Session

from ..models import AgentDecision, ResearchLog

logger = logging.getLogger("genealis.journal")

_subscribers: set[asyncio.Queue] = set()


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


def _broadcast(payload: dict) -> None:
    dead = []
    for q in _subscribers:
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _subscribers.discard(q)


def log(db: Session, message: str, *, category: str = "general", level: str = "info", task_id: str | None = None,
        person_id: str | None = None, connector_id: str | None = None, query: dict | None = None,
        outcome: dict | None = None) -> ResearchLog:
    entry = ResearchLog(message=message, category=category, level=level, task_id=task_id, person_id=person_id,
                        connector_id=connector_id, query=query, outcome=outcome)
    db.add(entry)
    db.flush()
    logger.log(logging.getLevelName(level.upper()) if level.upper() in logging._nameToLevel else logging.INFO,
               "[%s] %s", category, message)
    _broadcast({"type": "log", "id": entry.id, "ts": entry.ts.isoformat(), "level": level, "category": category,
                "message": message, "task_id": task_id, "person_id": person_id, "connector_id": connector_id})
    return entry


def decide(db: Session, agent: str, decision: str, rationale: dict[str, Any] | None = None,
           task_id: str | None = None) -> AgentDecision:
    d = AgentDecision(agent=agent, decision=decision, rationale=rationale or {}, task_id=task_id)
    db.add(d)
    db.flush()
    _broadcast({"type": "decision", "agent": agent, "decision": decision, "task_id": task_id})
    return d


def notify(payload: dict) -> None:
    _broadcast(payload)
