"""Modèle relationnel généalogique.

Principe : chaque information conserve séparément la forme brute telle qu'elle figure
dans le document (`*_original`) et son interprétation normalisée.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ----- Niveaux de confiance -----
CONFIDENCE_LEVELS = ("green", "orange", "red", "grey")
# green : suffisamment établi ; orange : plausible à vérifier ; red : contradiction / insuffisant ; grey : inconnu


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class Place(Base, TimestampMixin):
    __tablename__ = "places"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(255), index=True)
    name_original: Mapped[Optional[str]] = mapped_column(String(255))
    commune: Mapped[Optional[str]] = mapped_column(String(255))
    department: Mapped[Optional[str]] = mapped_column(String(255))
    region: Mapped[Optional[str]] = mapped_column(String(255))
    country: Mapped[Optional[str]] = mapped_column(String(128))
    country_code: Mapped[Optional[str]] = mapped_column(String(8))
    latitude: Mapped[Optional[float]] = mapped_column(Float)
    longitude: Mapped[Optional[float]] = mapped_column(Float)
    historical_names: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[Optional[str]] = mapped_column(Text)

    def display(self) -> str:
        parts = [p for p in (self.name, self.department, self.country) if p]
        return ", ".join(dict.fromkeys(parts))


class Person(Base, TimestampMixin):
    __tablename__ = "persons"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    given_names: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    surname: Mapped[Optional[str]] = mapped_column(String(255), index=True)  # nom de naissance
    married_name: Mapped[Optional[str]] = mapped_column(String(255))
    name_variants: Mapped[list] = mapped_column(JSON, default=list)
    sex: Mapped[Optional[str]] = mapped_column(String(1))  # M / F / None si non documenté
    nationality: Mapped[Optional[str]] = mapped_column(String(128))
    occupation: Mapped[Optional[str]] = mapped_column(String(255))
    notes: Mapped[Optional[str]] = mapped_column(Text)
    is_living: Mapped[Optional[bool]] = mapped_column(Boolean)
    is_root: Mapped[bool] = mapped_column(Boolean, default=False)  # personne de départ (utilisateur)
    confidence: Mapped[str] = mapped_column(String(8), default="grey")
    confidence_details: Mapped[dict] = mapped_column(JSON, default=dict)
    portrait_media_id: Mapped[Optional[str]] = mapped_column(String(32))
    gedcom_xref: Mapped[Optional[str]] = mapped_column(String(64))
    research_status: Mapped[dict] = mapped_column(JSON, default=dict)  # mémoire des recherches par type

    events: Mapped[list["Event"]] = relationship(back_populates="person", cascade="all, delete-orphan",
                                                 foreign_keys="Event.person_id")
    media: Mapped[list["Media"]] = relationship(back_populates="person")

    def display_name(self) -> str:
        parts = [self.given_names or "", (self.surname or "").upper()]
        name = " ".join(p for p in parts if p).strip()
        return name or "Inconnu(e)"


class ParentChild(Base, TimestampMixin):
    """Filiation : biologique, adoptive, légale, recomposée, incertaine."""

    __tablename__ = "parent_child"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    parent_id: Mapped[str] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    child_id: Mapped[str] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    relation_type: Mapped[str] = mapped_column(String(16), default="biological")
    # biological | adoptive | legal | step | foster | uncertain
    confidence: Mapped[str] = mapped_column(String(8), default="grey")
    confidence_details: Mapped[dict] = mapped_column(JSON, default=dict)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    hypothesis_id: Mapped[Optional[str]] = mapped_column(String(32))

    __table_args__ = (Index("ix_parent_child_pair", "parent_id", "child_id", unique=True),)


class Family(Base, TimestampMixin):
    """Union entre deux personnes (mariage, union libre, inconnue)."""

    __tablename__ = "families"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    partner1_id: Mapped[Optional[str]] = mapped_column(ForeignKey("persons.id", ondelete="SET NULL"), index=True)
    partner2_id: Mapped[Optional[str]] = mapped_column(ForeignKey("persons.id", ondelete="SET NULL"), index=True)
    union_type: Mapped[str] = mapped_column(String(16), default="marriage")  # marriage | union | unknown
    confidence: Mapped[str] = mapped_column(String(8), default="grey")
    notes: Mapped[Optional[str]] = mapped_column(Text)
    gedcom_xref: Mapped[Optional[str]] = mapped_column(String(64))

    events: Mapped[list["Event"]] = relationship(back_populates="family", cascade="all, delete-orphan",
                                                 foreign_keys="Event.family_id")


EVENT_TYPES = (
    "birth", "baptism", "marriage", "marriage_banns", "marriage_contract", "divorce", "death", "burial",
    "residence", "census", "occupation", "military", "immigration", "emigration", "naturalization",
    "will", "probate", "other",
)
DATE_KINDS = ("exact", "approx", "before", "after", "between", "calculated", "unknown")
CALENDARS = ("gregorian", "julian", "republican", "hebrew", "unknown")


class Event(Base, TimestampMixin):
    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    person_id: Mapped[Optional[str]] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    family_id: Mapped[Optional[str]] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(32), index=True)
    # Date : forme originale + interprétation normalisée
    date_original: Mapped[Optional[str]] = mapped_column(String(255))
    date_kind: Mapped[str] = mapped_column(String(16), default="unknown")
    date_start: Mapped[Optional[str]] = mapped_column(String(10))  # ISO partiel : 1895 / 1895-03 / 1895-03-12
    date_end: Mapped[Optional[str]] = mapped_column(String(10))
    calendar: Mapped[str] = mapped_column(String(16), default="gregorian")
    sort_year: Mapped[Optional[int]] = mapped_column(Integer, index=True)
    place_id: Mapped[Optional[str]] = mapped_column(ForeignKey("places.id", ondelete="SET NULL"))
    place_original: Mapped[Optional[str]] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text)
    value_original: Mapped[Optional[str]] = mapped_column(Text)  # texte tel que dans le document
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)  # témoins, parrain/marraine, âge déclaré...
    confidence: Mapped[str] = mapped_column(String(8), default="grey")

    person: Mapped[Optional[Person]] = relationship(back_populates="events", foreign_keys=[person_id])
    family: Mapped[Optional[Family]] = relationship(back_populates="events", foreign_keys=[family_id])
    place: Mapped[Optional[Place]] = relationship()


class Source(Base, TimestampMixin):
    """Provenance d'une information. Conserve la chaîne complète de justification."""

    __tablename__ = "sources"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(512))
    repository: Mapped[Optional[str]] = mapped_column(String(255), index=True)  # organisme d'archives
    fonds: Mapped[Optional[str]] = mapped_column(String(255))  # fonds et collection
    commune: Mapped[Optional[str]] = mapped_column(String(255))
    register_type: Mapped[Optional[str]] = mapped_column(String(64))  # état civil, paroissial, TD, recensement...
    reference: Mapped[Optional[str]] = mapped_column(String(255))  # cote
    year: Mapped[Optional[int]] = mapped_column(Integer)
    page: Mapped[Optional[str]] = mapped_column(String(64))  # page ou vue
    url: Mapped[Optional[str]] = mapped_column(Text)
    consulted_at: Mapped[Optional[datetime]] = mapped_column()
    local_copy_path: Mapped[Optional[str]] = mapped_column(Text)
    local_copy_allowed: Mapped[Optional[bool]] = mapped_column(Boolean)
    transcription: Mapped[Optional[str]] = mapped_column(Text)
    translation: Mapped[Optional[str]] = mapped_column(Text)
    interpretation: Mapped[Optional[str]] = mapped_column(Text)
    language: Mapped[Optional[str]] = mapped_column(String(8))
    reliability: Mapped[str] = mapped_column(String(16), default="unknown")
    # primary (acte original) | secondary (table, transcription) | derivative (arbre tiers) | unknown
    connector_id: Mapped[Optional[str]] = mapped_column(String(64))
    external_id: Mapped[Optional[str]] = mapped_column(String(255))
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), index=True)  # détecte les copies d'un même acte
    extra: Mapped[dict] = mapped_column(JSON, default=dict)
    gedcom_xref: Mapped[Optional[str]] = mapped_column(String(64))

    citations: Mapped[list["Citation"]] = relationship(back_populates="source", cascade="all, delete-orphan")


class Citation(Base, TimestampMixin):
    """Lie une source à une personne, un événement, une relation ou une famille."""

    __tablename__ = "citations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    target_type: Mapped[str] = mapped_column(String(16), index=True)  # person | event | parent_child | family
    target_id: Mapped[str] = mapped_column(String(32), index=True)
    excerpt: Mapped[Optional[str]] = mapped_column(Text)  # passage justificatif
    image_region: Mapped[Optional[dict]] = mapped_column(JSON)  # {x,y,w,h} sur l'image si disponible
    confidence: Mapped[str] = mapped_column(String(8), default="orange")
    note: Mapped[Optional[str]] = mapped_column(Text)

    source: Mapped[Source] = relationship(back_populates="citations")


class Media(Base, TimestampMixin):
    __tablename__ = "media"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    path: Mapped[str] = mapped_column(Text)
    original_filename: Mapped[Optional[str]] = mapped_column(String(512))
    mime_type: Mapped[Optional[str]] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(16), default="document")  # document | photo | portrait
    title: Mapped[Optional[str]] = mapped_column(String(512))
    sha256: Mapped[Optional[str]] = mapped_column(String(64), index=True)
    person_id: Mapped[Optional[str]] = mapped_column(ForeignKey("persons.id", ondelete="SET NULL"), index=True)
    source_id: Mapped[Optional[str]] = mapped_column(ForeignKey("sources.id", ondelete="SET NULL"))
    language: Mapped[Optional[str]] = mapped_column(String(8))
    ocr_text: Mapped[Optional[str]] = mapped_column(Text)
    analysis: Mapped[dict] = mapped_column(JSON, default=dict)  # transcription, mots incertains, extractions
    analysis_status: Mapped[str] = mapped_column(String(16), default="none")  # none | pending | done | failed

    person: Mapped[Optional[Person]] = relationship(back_populates="media")


class Hypothesis(Base, TimestampMixin):
    """Hypothèse de travail (identité, filiation...) jamais promue en fait sans justification."""

    __tablename__ = "hypotheses"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(32), index=True)  # identity_match | filiation | union | event | other
    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[Optional[str]] = mapped_column(Text)
    subject_person_id: Mapped[Optional[str]] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    candidate: Mapped[dict] = mapped_column(JSON, default=dict)  # données candidates (personne/acte)
    evidence: Mapped[list] = mapped_column(JSON, default=list)  # liste {source_id, note, weight}
    score: Mapped[Optional[float]] = mapped_column(Float)
    score_details: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | confirmed | rejected | superseded
    created_by: Mapped[str] = mapped_column(String(32), default="user")  # user | agent:<nom>
    task_id: Mapped[Optional[str]] = mapped_column(String(32))
    group_key: Mapped[Optional[str]] = mapped_column(String(128), index=True)  # hypothèses concurrentes


class Question(Base, TimestampMixin):
    __tablename__ = "questions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(512))
    problem: Mapped[Optional[str]] = mapped_column(Text)
    known_facts: Mapped[list] = mapped_column(JSON, default=list)
    hypotheses: Mapped[list] = mapped_column(JSON, default=list)
    documents: Mapped[list] = mapped_column(JSON, default=list)
    impact: Mapped[Optional[str]] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(Integer, default=50)  # 0-100
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending | answered | dismissed
    answer_type: Mapped[Optional[str]] = mapped_column(String(32))  # yes | no | unknown | info | document | search_other
    answer: Mapped[Optional[str]] = mapped_column(Text)
    answered_at: Mapped[Optional[datetime]] = mapped_column()
    person_id: Mapped[Optional[str]] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    dedupe_key: Mapped[Optional[str]] = mapped_column(String(255), index=True)  # évite les questions répétitives


TASK_STATUSES = ("queued", "running", "waiting_user", "done", "failed", "paused", "cancelled")


class ResearchTask(Base, TimestampMixin):
    __tablename__ = "research_tasks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    task_type: Mapped[str] = mapped_column(String(32), index=True)
    # find_birth | find_parents | find_marriage | find_death | find_census | find_siblings | analyze_document | explore_branch
    title: Mapped[str] = mapped_column(String(512))
    person_id: Mapped[Optional[str]] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    priority: Mapped[int] = mapped_column(Integer, default=50)
    plan: Mapped[list] = mapped_column(JSON, default=list)  # étapes planifiées
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[Optional[str]] = mapped_column(Text)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[Optional[datetime]] = mapped_column()
    finished_at: Mapped[Optional[datetime]] = mapped_column()
    parent_task_id: Mapped[Optional[str]] = mapped_column(String(32))
    fingerprint: Mapped[Optional[str]] = mapped_column(String(128), index=True)  # détecte les recherches déjà faites
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    approved: Mapped[Optional[bool]] = mapped_column(Boolean)


class ResearchLog(Base):
    """Journal horodaté des opérations réellement effectuées (jamais simulées)."""

    __tablename__ = "research_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    task_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    person_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    level: Mapped[str] = mapped_column(String(8), default="info")
    category: Mapped[str] = mapped_column(String(32), default="general")
    # search | result | analysis | compare | question | decision | error | connector
    message: Mapped[str] = mapped_column(Text)
    connector_id: Mapped[Optional[str]] = mapped_column(String(64))
    query: Mapped[Optional[dict]] = mapped_column(JSON)
    outcome: Mapped[Optional[dict]] = mapped_column(JSON)


class Contradiction(Base, TimestampMixin):
    __tablename__ = "contradictions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(48), index=True)
    severity: Mapped[str] = mapped_column(String(8), default="orange")  # orange | red
    description: Mapped[str] = mapped_column(Text)
    person_ids: Mapped[list] = mapped_column(JSON, default=list)
    event_ids: Mapped[list] = mapped_column(JSON, default=list)
    relation_ids: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)  # open | resolved | ignored
    dedupe_key: Mapped[Optional[str]] = mapped_column(String(255), unique=True)
    resolution_note: Mapped[Optional[str]] = mapped_column(Text)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    encrypted: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)


class TransmissionLog(Base):
    """Journal des données transmises à des services externes (IA hébergée, archives)."""

    __tablename__ = "transmission_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    provider: Mapped[str] = mapped_column(String(64))
    purpose: Mapped[str] = mapped_column(String(255))
    payload_summary: Mapped[Optional[str]] = mapped_column(Text)
    bytes_sent: Mapped[int] = mapped_column(Integer, default=0)
    contains_personal_data: Mapped[bool] = mapped_column(Boolean, default=False)
    authorized: Mapped[bool] = mapped_column(Boolean, default=False)


class AgentDecision(Base):
    __tablename__ = "agent_decisions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    agent: Mapped[str] = mapped_column(String(32), index=True)
    task_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    decision: Mapped[str] = mapped_column(Text)
    rationale: Mapped[dict] = mapped_column(JSON, default=dict)


class ConnectorStatus(Base):
    __tablename__ = "connector_status"
    connector_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(16), default="untested")  # untested | ok | degraded | failed | manual
    last_test_at: Mapped[Optional[datetime]] = mapped_column()
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    role: Mapped[str] = mapped_column(String(16))  # user | assistant | system
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
