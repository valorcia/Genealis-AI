"""Tables v0.4 : enquêtes autonomes, file de tâches persistante, navigation, coûts IA, lectures paléographiques,
réseau des personnes citées dans les documents (témoins, parrains, relations indirectes).

Toutes ces tables sont additives : aucune table existante n'est modifiée (migration non destructive).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from .core import TimestampMixin, new_id, utcnow

# États demandés : EN ATTENTE, EN COURS, TERMINÉE, BLOQUÉE, À VÉRIFIER, ÉCHEC (+ pause et arrêt manuels)
INVESTIGATION_STATUSES = ("pending", "running", "paused", "done", "blocked", "to_verify", "failed", "stopped")
TASK_STATES = ("pending", "running", "done", "blocked", "to_verify", "failed", "cancelled")
STATUS_LABELS_FR = {"pending": "EN ATTENTE", "running": "EN COURS", "paused": "EN PAUSE", "done": "TERMINÉE",
                    "blocked": "BLOQUÉE", "to_verify": "À VÉRIFIER", "failed": "ÉCHEC", "stopped": "ARRÊTÉE",
                    "cancelled": "ANNULÉE"}
# Stratégies, de la moins chère à la plus chère
STRATEGIES = ("web_search", "playwright", "browser_agent", "human")


class Investigation(Base, TimestampMixin):
    """Une enquête autonome menée par le GENEALIS RESEARCH DIRECTOR autour d'une personne."""

    __tablename__ = "investigations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(512))
    person_id: Mapped[Optional[str]] = mapped_column(ForeignKey("persons.id", ondelete="SET NULL"), index=True)
    objective: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    cost_mode: Mapped[str] = mapped_column(String(16), default="free")  # free | hybrid | commercial
    max_generations: Mapped[int] = mapped_column(Integer, default=3)
    current_generation: Mapped[int] = mapped_column(Integer, default=0)
    ai_call_ceiling: Mapped[int] = mapped_column(Integer, default=60)
    ai_calls_used: Mapped[int] = mapped_column(Integer, default=0)
    # Mémoire persistante : sites, pages, requêtes, documents, résultats, échecs, hypothèses, prochaines recherches
    memory: Mapped[dict] = mapped_column(JSON, default=dict)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    blocked_reason: Mapped[Optional[str]] = mapped_column(Text)
    last_error: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[Optional[datetime]] = mapped_column()
    finished_at: Mapped[Optional[datetime]] = mapped_column()
    last_activity_at: Mapped[Optional[datetime]] = mapped_column()
    active_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    owner_id: Mapped[Optional[str]] = mapped_column(String(64), index=True)  # préparation SaaS (séparation des clients)


class InvestigationTask(Base, TimestampMixin):
    """File de tâches persistante : reprise après redémarrage, déduplication par empreinte, bail de travail."""

    __tablename__ = "investigation_tasks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    investigation_id: Mapped[str] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    # plan | web_search | browse | analyze_document | extract | verify | compare | expand_generation
    # | witness_followup | human_assist
    title: Mapped[str] = mapped_column(String(512))
    person_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    strategy: Mapped[Optional[str]] = mapped_column(String(16))  # web_search | playwright | browser_agent | human
    priority: Mapped[int] = mapped_column(Integer, default=50)
    generation: Mapped[int] = mapped_column(Integer, default=0)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    fingerprint: Mapped[Optional[str]] = mapped_column(String(128), index=True)
    parent_task_id: Mapped[Optional[str]] = mapped_column(String(32))
    claimed_by: Mapped[Optional[str]] = mapped_column(String(64))  # « server » ou identifiant du worker local
    lease_until: Mapped[Optional[datetime]] = mapped_column()
    last_error: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[Optional[datetime]] = mapped_column()
    finished_at: Mapped[Optional[datetime]] = mapped_column()

    __table_args__ = (Index("ix_inv_task_queue", "status", "priority"),)


class InvestigationEvent(Base):
    """Fil d'activité en temps réel d'une enquête (affiché dans le Centre d'investigation)."""

    __tablename__ = "investigation_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    investigation_id: Mapped[str] = mapped_column(String(32), index=True)
    task_id: Mapped[Optional[str]] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(32), default="info")
    # info | plan | search | page | document | analysis | discovery | filiation | hypothesis | question | cost | error | human
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class PageVisit(Base):
    """Page réellement ouverte par le navigateur (jamais simulée)."""

    __tablename__ = "page_visits"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    ts: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    investigation_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    task_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    url: Mapped[str] = mapped_column(Text)
    domain: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    title: Mapped[Optional[str]] = mapped_column(String(512))
    strategy: Mapped[str] = mapped_column(String(16), default="playwright")
    outcome: Mapped[str] = mapped_column(String(24), default="ok")
    # ok | blocked_policy | robots_disallowed | captcha | login_required | paywall | not_found | error | timeout
    http_status: Mapped[Optional[int]] = mapped_column(Integer)
    screenshot_media_id: Mapped[Optional[str]] = mapped_column(String(32))
    text_excerpt: Mapped[Optional[str]] = mapped_column(Text)
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), index=True)
    downloads: Mapped[list] = mapped_column(JSON, default=list)  # [{media_id, filename, mime, size, sha256}]
    security_flags: Mapped[list] = mapped_column(JSON, default=list)  # injections détectées, téléchargements refusés…
    worker_id: Mapped[Optional[str]] = mapped_column(String(64))
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer)
    notes: Mapped[Optional[str]] = mapped_column(Text)


class AICallLog(Base):
    """Chaque appel IA (ou appel évité grâce au cache / refusé par le quota) pour le tableau de bord des coûts."""

    __tablename__ = "ai_call_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    provider: Mapped[str] = mapped_column(String(32), index=True)
    model: Mapped[Optional[str]] = mapped_column(String(128))
    purpose: Mapped[str] = mapped_column(String(64), default="analyse")
    status: Mapped[str] = mapped_column(String(16), default="ok")  # ok | cache_hit | quota_refused | error | rate_limited
    investigation_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    task_id: Mapped[Optional[str]] = mapped_column(String(32))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    thinking_tokens: Mapped[int] = mapped_column(Integer, default=0)
    attachments: Mapped[int] = mapped_column(Integer, default=0)
    web_search: Mapped[bool] = mapped_column(Boolean, default=False)
    estimated_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer)
    request_hash: Mapped[Optional[str]] = mapped_column(String(64), index=True)
    error: Mapped[Optional[str]] = mapped_column(Text)
    owner_id: Mapped[Optional[str]] = mapped_column(String(64), index=True)


class AICacheEntry(Base):
    """Réponses IA réutilisables : un même document ou une même question n'est jamais renvoyé deux fois."""

    __tablename__ = "ai_cache"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider: Mapped[str] = mapped_column(String(32))
    model: Mapped[Optional[str]] = mapped_column(String(128))
    purpose: Mapped[str] = mapped_column(String(64))
    text: Mapped[str] = mapped_column(Text)
    grounding: Mapped[Optional[dict]] = mapped_column(JSON)
    usage: Mapped[dict] = mapped_column(JSON, default=dict)
    hits: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[Optional[datetime]] = mapped_column()


class DocumentReading(Base, TimestampMixin):
    """Lecture paléographique d'un document : ORIGINAL (le média, intact) — TRANSCRIPTION — TRADUCTION.

    `lines` : [{"n": 1, "bbox": [x, y, w, h] (0-1000, relatif à l'image originale), "diplomatic": "...",
                "normalized": "...", "translation": "...",
                "uncertain": [{"text": "...", "alternatives": ["...", "..."], "reason": "...", "confidence": 0.4,
                               "bbox": [...], "second_pass": {...}}]}]
    """

    __tablename__ = "document_readings"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    media_id: Mapped[str] = mapped_column(ForeignKey("media.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    engine: Mapped[str] = mapped_column(String(64), default="gemini")  # gemini | htr:<nom> | manual_llm | human
    model: Mapped[Optional[str]] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft | reviewed | validated
    document_kind: Mapped[Optional[str]] = mapped_column(String(32))  # act | register_page | census | photo | letter | other
    script_type: Mapped[Optional[str]] = mapped_column(String(48))
    # french_cursive | humanistic | secretary | gothic_textura | kurrent | suetterlin | latin_ecclesiastical
    # | italian_cursive | polish_cursive | cyrillic_cursive | print | typewritten | unknown
    language: Mapped[Optional[str]] = mapped_column(String(16))
    period_estimate: Mapped[Optional[str]] = mapped_column(String(64))
    scribe_key: Mapped[Optional[str]] = mapped_column(String(128), index=True)  # même main / même registre
    preprocessing: Mapped[dict] = mapped_column(JSON, default=dict)  # opérations appliquées à la COPIE de travail
    zones: Mapped[list] = mapped_column(JSON, default=list)  # zones de texte détectées [{bbox, kind}]
    lines: Mapped[list] = mapped_column(JSON, default=list)
    diplomatic: Mapped[Optional[str]] = mapped_column(Text)  # transcription fidèle (abréviations conservées)
    normalized: Mapped[Optional[str]] = mapped_column(Text)  # version normalisée (abréviations développées)
    translation: Mapped[Optional[str]] = mapped_column(Text)
    translation_language: Mapped[Optional[str]] = mapped_column(String(8))
    uncertain: Mapped[list] = mapped_column(JSON, default=list)
    extraction: Mapped[dict] = mapped_column(JSON, default=dict)  # personnes, rôles, relations, dates, lieux
    photo_analysis: Mapped[dict] = mapped_column(JSON, default=dict)  # éléments visibles, inscriptions, période…
    quality: Mapped[dict] = mapped_column(JSON, default=dict)  # auto-évaluation + mesures CER/WER si référence
    warnings: Mapped[list] = mapped_column(JSON, default=list)


class ReadingCorrection(Base):
    """Correction humaine d'une lecture : conservée et réutilisée pour les lectures suivantes (même main, même mot)."""

    __tablename__ = "reading_corrections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    reading_id: Mapped[str] = mapped_column(ForeignKey("document_readings.id", ondelete="CASCADE"), index=True)
    media_id: Mapped[str] = mapped_column(String(32), index=True)
    scribe_key: Mapped[Optional[str]] = mapped_column(String(128), index=True)
    script_type: Mapped[Optional[str]] = mapped_column(String(48), index=True)
    line_n: Mapped[Optional[int]] = mapped_column(Integer)
    layer: Mapped[str] = mapped_column(String(16), default="diplomatic")  # diplomatic | normalized | translation
    before: Mapped[Optional[str]] = mapped_column(Text)
    after: Mapped[str] = mapped_column(Text)
    note: Mapped[Optional[str]] = mapped_column(Text)
    author: Mapped[str] = mapped_column(String(64), default="user")


class PersonMention(Base, TimestampMixin):
    """Personne citée dans un document (sujet, parents, témoins, parrains, déclarants…).

    Une mention n'est JAMAIS fusionnée automatiquement avec une personne de l'arbre : `linked_person_id` n'est
    renseigné qu'après validation (ou preuve suffisante) ; les rapprochements possibles restent des candidats.
    """

    __tablename__ = "person_mentions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    media_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    source_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    reading_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    investigation_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    name_original: Mapped[str] = mapped_column(String(512))  # tel qu'écrit dans le document
    given_names: Mapped[Optional[str]] = mapped_column(String(255))
    surname: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    sex: Mapped[Optional[str]] = mapped_column(String(1))
    role: Mapped[str] = mapped_column(String(32), index=True)
    # subject | father | mother | spouse | groom | bride | witness | godfather | godmother | declarant | officiant
    # | deceased | informant | neighbour | other
    stated_relation: Mapped[Optional[str]] = mapped_column(String(512))  # « oncle maternel de l'épouse »
    relation_kind: Mapped[Optional[str]] = mapped_column(String(48))  # uncle | aunt | cousin | brother | … | none
    relation_side: Mapped[Optional[str]] = mapped_column(String(16))  # maternal | paternal | unknown
    relation_to_role: Mapped[Optional[str]] = mapped_column(String(32))  # rôle de la personne de référence (bride…)
    relation_to_mention_id: Mapped[Optional[str]] = mapped_column(String(32))
    age_stated: Mapped[Optional[str]] = mapped_column(String(64))
    occupation: Mapped[Optional[str]] = mapped_column(String(255))
    residence: Mapped[Optional[str]] = mapped_column(String(255))
    signed: Mapped[Optional[bool]] = mapped_column(Boolean)
    excerpt: Mapped[Optional[str]] = mapped_column(Text)
    image_region: Mapped[Optional[dict]] = mapped_column(JSON)
    reading_confidence: Mapped[Optional[float]] = mapped_column(Float)  # lisibilité du nom (pas une preuve d'identité)
    linked_person_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    link_status: Mapped[str] = mapped_column(String(16), default="unlinked")  # unlinked | candidate | confirmed | rejected
    candidates: Mapped[list] = mapped_column(JSON, default=list)  # [{person_id, score, reasons, warnings}]
    lead_task_id: Mapped[Optional[str]] = mapped_column(String(32))  # piste de recherche créée
