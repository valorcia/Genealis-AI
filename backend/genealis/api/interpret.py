"""Routeur « interpret » (rempli par la suite)."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["interpret"])
