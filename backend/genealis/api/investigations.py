"""Enquêtes autonomes (GENEALIS RESEARCH DIRECTOR) — routes définies dans docs/ARCHITECTURE_V04.md."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["investigations"])
