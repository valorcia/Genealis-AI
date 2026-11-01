"""Point d'entrée Vercel (fonction serverless Python) : expose l'API FastAPI de GENEALIS AI."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("VERCEL", "1")

from genealis.main import app  # noqa: E402,F401
