"""Schémas Pydantic de l'API locale."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class EventIn(BaseModel):
    event_type: str
    date: Optional[str] = None  # texte libre ou ISO ; interprété par gendate
    date_original: Optional[str] = None
    place: Optional[str] = None  # nom de lieu (résolu/créé automatiquement)
    place_id: Optional[str] = None
    description: Optional[str] = None
    value_original: Optional[str] = None
    attributes: dict = Field(default_factory=dict)
    confidence: Optional[str] = None
    family_id: Optional[str] = None


class EventOut(BaseModel):
    id: str
    person_id: Optional[str]
    family_id: Optional[str]
    event_type: str
    date_original: Optional[str]
    date_kind: str
    date_start: Optional[str]
    date_end: Optional[str]
    calendar: str
    sort_year: Optional[int]
    date_display: str
    place_id: Optional[str]
    place_name: Optional[str]
    place_original: Optional[str]
    description: Optional[str]
    value_original: Optional[str]
    attributes: dict
    confidence: str
    citations: list["CitationOut"] = Field(default_factory=list)


class PersonIn(BaseModel):
    given_names: Optional[str] = None
    surname: Optional[str] = None
    married_name: Optional[str] = None
    name_variants: list[str] = Field(default_factory=list)
    sex: Optional[str] = None
    nationality: Optional[str] = None
    occupation: Optional[str] = None
    notes: Optional[str] = None
    is_living: Optional[bool] = None
    is_root: Optional[bool] = None
    confidence: Optional[str] = None
    # Création rapide d'événements
    birth_date: Optional[str] = None
    birth_place: Optional[str] = None
    death_date: Optional[str] = None
    death_place: Optional[str] = None


class PersonSummary(BaseModel):
    id: str
    display_name: str
    given_names: Optional[str]
    surname: Optional[str]
    married_name: Optional[str]
    sex: Optional[str]
    confidence: str
    is_root: bool
    is_living: Optional[bool]
    birth_year: Optional[int] = None
    death_year: Optional[int] = None
    birth_display: Optional[str] = None
    death_display: Optional[str] = None
    birth_place: Optional[str] = None
    death_place: Optional[str] = None
    occupation: Optional[str] = None
    portrait_media_id: Optional[str] = None
    age_years: Optional[int] = None  # âge au décès, ou âge actuel si vivant
    age_display: Optional[str] = None  # « 82 ans » ou « ≈ 82 ans »
    age_detail: Optional[str] = None  # « 82 a 5 m 12 j » si dates exactes
    age_context: Optional[str] = None  # « au décès » | « aujourd'hui »
    sosa: list[int] = Field(default_factory=list)  # numéros Sosa par rapport à la personne de départ (vide si hors ascendance)


class RelativeIn(BaseModel):
    """Ajout rapide d'un proche depuis l'arbre ou la fiche."""

    relation: str  # father | mother | son | daughter | child | brother | sister | sibling | spouse | husband | wife
    # | paternal_grandfather | paternal_grandmother | maternal_grandfather | maternal_grandmother
    person: Optional[PersonIn] = None  # nouvelle personne
    existing_id: Optional[str] = None  # ou personne existante
    other_parent_id: Optional[str] = None  # pour un enfant : l'autre parent (conjoint)
    relation_type: str = "biological"
    sibling_shared: str = "both"  # both | father | mother (demi-frère / demi-sœur)
    marriage_date: Optional[str] = None
    marriage_place: Optional[str] = None
    research: bool = False  # lancer immédiatement la recherche IA sur ce proche


class QuickStartIn(BaseModel):
    """Démarrage direct par un couple (grands-parents, parents, ancêtres) sans se saisir soi-même."""

    people: list[PersonIn] = Field(default_factory=list)  # 1 ou 2 personnes
    couple: bool = True
    marriage_date: Optional[str] = None
    marriage_place: Optional[str] = None
    children: list[PersonIn] = Field(default_factory=list)  # enfants connus du couple (ex. votre père)
    research: bool = True


class RelationOut(BaseModel):
    id: str
    parent_id: str
    child_id: str
    relation_type: str
    confidence: str
    confidence_details: dict = Field(default_factory=dict)
    notes: Optional[str] = None


class FamilyOut(BaseModel):
    id: str
    partner1_id: Optional[str]
    partner2_id: Optional[str]
    union_type: str
    confidence: str
    notes: Optional[str] = None
    events: list[EventOut] = Field(default_factory=list)
    children_ids: list[str] = Field(default_factory=list)


class PersonDetail(PersonSummary):
    name_variants: list[str]
    nationality: Optional[str]
    notes: Optional[str]
    confidence_details: dict
    events: list[EventOut]
    parents: list[PersonSummary]
    parent_relations: list[RelationOut]
    children: list[PersonSummary]
    child_relations: list[RelationOut]
    spouses: list[PersonSummary]
    families: list[FamilyOut]
    siblings: list[PersonSummary]
    media: list["MediaOut"]
    citations: list["CitationOut"]
    hypotheses: list["HypothesisOut"]
    contradictions: list["ContradictionOut"]
    questions: list["QuestionOut"]
    research_status: dict
    created_at: datetime
    updated_at: datetime


class RelationIn(BaseModel):
    parent_id: str
    child_id: str
    relation_type: str = "biological"
    confidence: Optional[str] = None
    notes: Optional[str] = None
    source_ids: list[str] = Field(default_factory=list)


class FamilyIn(BaseModel):
    partner1_id: Optional[str] = None
    partner2_id: Optional[str] = None
    union_type: str = "marriage"
    confidence: Optional[str] = None
    notes: Optional[str] = None
    marriage_date: Optional[str] = None
    marriage_place: Optional[str] = None


class SourceIn(BaseModel):
    title: str
    repository: Optional[str] = None
    fonds: Optional[str] = None
    commune: Optional[str] = None
    register_type: Optional[str] = None
    reference: Optional[str] = None
    year: Optional[int] = None
    page: Optional[str] = None
    url: Optional[str] = None
    consulted_at: Optional[datetime] = None
    local_copy_path: Optional[str] = None
    local_copy_allowed: Optional[bool] = None
    transcription: Optional[str] = None
    translation: Optional[str] = None
    interpretation: Optional[str] = None
    language: Optional[str] = None
    reliability: str = "unknown"
    connector_id: Optional[str] = None
    external_id: Optional[str] = None
    extra: dict = Field(default_factory=dict)


class SourceOut(SourceIn):
    id: str
    content_hash: Optional[str] = None
    created_at: datetime
    citation_count: int = 0


class CitationIn(BaseModel):
    source_id: str
    target_type: str
    target_id: str
    excerpt: Optional[str] = None
    image_region: Optional[dict] = None
    confidence: str = "orange"
    note: Optional[str] = None


class CitationOut(CitationIn):
    id: str
    source_title: Optional[str] = None
    source_reliability: Optional[str] = None


class MediaOut(BaseModel):
    id: str
    path: str
    original_filename: Optional[str]
    mime_type: Optional[str]
    kind: str
    title: Optional[str]
    person_id: Optional[str]
    source_id: Optional[str]
    language: Optional[str]
    analysis_status: str
    analysis: dict
    ocr_text: Optional[str] = None
    created_at: datetime


class HypothesisOut(BaseModel):
    id: str
    kind: str
    title: str
    description: Optional[str]
    subject_person_id: Optional[str]
    candidate: dict
    evidence: list
    score: Optional[float]
    score_details: dict
    status: str
    created_by: str
    task_id: Optional[str]
    group_key: Optional[str]
    created_at: datetime


class HypothesisIn(BaseModel):
    kind: str = "other"
    title: str
    description: Optional[str] = None
    subject_person_id: Optional[str] = None
    candidate: dict = Field(default_factory=dict)
    evidence: list = Field(default_factory=list)
    group_key: Optional[str] = None


class QuestionOut(BaseModel):
    id: str
    title: str
    problem: Optional[str]
    known_facts: list
    hypotheses: list
    documents: list
    impact: Optional[str]
    priority: int
    status: str
    answer_type: Optional[str]
    answer: Optional[str]
    person_id: Optional[str]
    task_id: Optional[str]
    created_at: datetime
    answered_at: Optional[datetime]


class QuestionAnswer(BaseModel):
    answer_type: str  # yes | no | unknown | info | document | search_other
    answer: Optional[str] = None
    payload: dict = Field(default_factory=dict)


class ContradictionOut(BaseModel):
    id: str
    kind: str
    severity: str
    description: str
    person_ids: list
    event_ids: list
    relation_ids: list
    status: str
    resolution_note: Optional[str]
    created_at: datetime


class TaskIn(BaseModel):
    task_type: str
    person_id: Optional[str] = None
    title: Optional[str] = None
    priority: int = 50
    params: dict = Field(default_factory=dict)


class TaskOut(BaseModel):
    id: str
    task_type: str
    title: str
    person_id: Optional[str]
    status: str
    priority: int
    plan: list
    params: dict
    attempts: int
    last_error: Optional[str]
    result: dict
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    parent_task_id: Optional[str]
    requires_approval: bool
    approved: Optional[bool]
    created_at: datetime
    updated_at: datetime


class LogOut(BaseModel):
    id: int
    ts: datetime
    task_id: Optional[str]
    person_id: Optional[str]
    level: str
    category: str
    message: str
    connector_id: Optional[str]
    query: Optional[dict]
    outcome: Optional[dict]


class ChatIn(BaseModel):
    message: str


class ChatOut(BaseModel):
    role: str
    content: str
    meta: dict = Field(default_factory=dict)
    ts: datetime


class SettingsPatch(BaseModel):
    values: dict[str, Any]


class OnboardingIn(BaseModel):
    given_names: Optional[str] = None
    surname: Optional[str] = None
    birth_date: Optional[str] = None
    birth_place: Optional[str] = None
    sex: Optional[str] = None
    father: Optional[PersonIn] = None
    mother: Optional[PersonIn] = None
    grandparents: list[dict] = Field(default_factory=list)  # {side: 'father'|'mother', role: 'father'|'mother', ...PersonIn}
    origin_countries: list[str] = Field(default_factory=list)
    documents_note: Optional[str] = None
    autonomy_mode: int = 3
    start_research: bool = True
