"""Lecture des écritures anciennes (paléographie / HTR) — voir docs/PALEOGRAPHIE.md et docs/ARCHITECTURE_V04.md §6.

Points d'entrée :
- `read_document(db, media, options=...) -> DocumentReading` (nouvelle version à chaque lecture, original intact) ;
- `mentions_from_reading(db, reading, investigation_id=None) -> list[PersonMention]` (aucun lien automatique vers l'arbre).
"""
from __future__ import annotations

from .mentions import mentions_from_reading
from .pipeline import ReadOptions, read_document

__all__ = ["ReadOptions", "mentions_from_reading", "read_document"]
