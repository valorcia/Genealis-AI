/** Client de l'interprétation des documents (lecture IA, propositions, application). */
import { req, type MediaOut } from '../api'

export interface DocKind { id: string; label: string }
export interface InterpretCapabilities {
  ai_available: boolean; provider: string; model: string | null; manual: boolean; reads_pdf: boolean; tesseract: boolean
  kinds: DocKind[]; message: string | null
}

export interface MatchCriterion { label: string; score: number; weight: number; detail: string }
export interface PersonMatch {
  person_id: string; name: string; total: number; level: 'green' | 'orange' | 'red' | 'grey'; criteria: MatchCriterion[]; blocking: string[]
  birth_year: number | null; death_year: number | null; birth_place: string | null; context: string | null
}
export type Resolution = 'match' | 'weak' | 'new' | 'ignore'
export interface ProposedPerson {
  index: number; role: string; role_label: string; name: string; given_names: string | null; surname: string | null; married_name: string | null
  sex: 'M' | 'F' | null; sex_inferred: boolean; age: number | null; birth_year: number | null; birth_date: string | null; birth_place: string | null
  occupation: string | null; residence: string | null; relation: string | null; household: number | null; entry: number | null
  deceased: boolean; confidence: string | null; anchor: number | null; kin: string | null
  resolution: Resolution; person_id: string | null; person_name: string | null; reason: string | null; matches: PersonMatch[]
  tree_conflict: { person_id: string; name: string; kin: string; anchor: string } | null; action_id: string | null
}
export type ActionGroup = 'persons' | 'events' | 'relations' | 'source' | 'verify'
export interface ProposedAction {
  id: string; kind: string; group: ActionGroup; label: string; detail: string | null; requires: number[]; recommended: boolean
  checked: boolean; mode: 'add' | 'complete' | 'conflict' | 'exists' | null; payload: Record<string, unknown>
  conflict: { tree: Record<string, unknown>; document: Record<string, unknown> } | null
}
export interface Proposals {
  version: number; fingerprint: string; media_id: string; generated_at: string; document_type: string; document_label: string
  year: number | null; place: string | null; source_title: string | null; reliability: string | null; summary_fr?: string | null
  people: ProposedPerson[]; actions: ProposedAction[]; warnings: string[]
}
export interface ApplySummary {
  created_persons: { id: string; name: string; index: number; role: string }[]
  linked_persons: { id: string; name: string; index: number; role: string }[]
  events: { id: string; event_type: string; person_id: string | null; family_id: string | null; mode: string; changes?: string[]; who?: string; date?: string | null }[]
  relations: { id: string | null; kind: string; label: string }[]
  sources: { id: string; title: string; reliability: string }[]
  questions: { id: string; title: string }[]
  hypotheses: { id: string; title: string }[]
  updated_persons: { id: string; name: string; change: string }[]
  skipped: { id: string; reason: string }[]
}

/** Personnes extraites telles que stockées dans l'analyse (schéma commun IA / copier-coller). */
export interface ExtractedPerson {
  role?: string; given_names?: string | null; surname?: string | null; sex?: string | null; age?: number | null; birth_date?: string | null
  birth_place?: string | null; occupation?: string | null; residence?: string | null; relation?: string | null; deceased?: boolean; confidence?: string
}
export interface HouseholdMember extends ExtractedPerson { relation_to_head?: string | null; birth_year?: number | null; nationality?: string | null }
export interface Extraction {
  document_type?: string; language?: string; date?: string | null; date_iso?: string | null; event_date?: string | null; place?: string | null
  act_number?: string | null; officer?: string | null; persons?: ExtractedPerson[]; households?: { address?: string | null; number?: string | null; members?: HouseholdMember[] }[]
  military?: { matricule?: string | null; class_year?: string | number | null; recruitment_office?: string | null; physical_description?: Record<string, string | null> | null; campaigns?: string[]; decorations?: string[]; remarks?: string | null } | null
  entries?: { event_type?: string | null; date?: string | null; given_names?: string | null; surname?: string | null; spouse?: string | null; note?: string | null }[]
  translation_fr?: string | null; summary_fr?: string | null; method?: string; requested_kind?: string
}

export const interpretApi = {
  capabilities: () => req<InterpretCapabilities>('/api/interpret/capabilities'),
  setReadingOptions: (mediaId: string, opts: { kind?: string; person_id?: string }) =>
    req<MediaOut>(`/api/media/${mediaId}/reading-options`, { method: 'PUT', body: JSON.stringify(opts) }),
  analyzeNow: (mediaId: string, opts: { kind?: string; person_id?: string } = {}) =>
    req<MediaOut>(`/api/media/${mediaId}/analyze-now`, { method: 'POST', body: JSON.stringify(opts) }),
  proposals: (mediaId: string, refresh = false) => req<Proposals>(`/api/media/${mediaId}/proposals${refresh ? '?refresh=true' : ''}`),
  apply: (mediaId: string, actions: string[], personOverrides: Record<string, string>) =>
    req<ApplySummary>(`/api/media/${mediaId}/apply`, { method: 'POST', body: JSON.stringify({ actions, person_overrides: personOverrides }) }),
}

export function extractionOf(m: MediaOut | null): Extraction {
  const ex = m?.analysis?.extraction
  return (typeof ex === 'object' && ex !== null ? ex : {}) as Extraction
}
export function transcriptionOf(m: MediaOut | null): string {
  if (!m) return ''
  const t = m.analysis?.transcription
  return m.ocr_text ?? (typeof t === 'string' ? t : '')
}
