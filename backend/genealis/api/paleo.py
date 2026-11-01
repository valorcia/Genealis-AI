"""Lecture des écritures anciennes (paléographie / HTR) — routes définies dans docs/ARCHITECTURE_V04.md."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["paleo"])
