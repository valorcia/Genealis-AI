/** Client de la lecture des écritures anciennes (paléographie) : lectures, corrections, seconde analyse, mentions, CER/WER. */
import { API_BASE, q, req } from '../api'

/** Zone [x, y, largeur, hauteur] en millièmes (0-1000) de l'image ORIGINALE. */
export type BBox = [number, number, number, number]

export interface RankedReading { text: string; confidence: number | null; source: 'first_pass' | 'second_pass'; evidence?: string | null }
export interface SecondPass {
  status: 'concordant' | 'discordant' | 'undecided'; best: string | null; agrees: boolean; notes: string | null
  crop_bbox: number[]; sent_size: number[]; engine: string; model: string | null; cached: boolean
}
export interface UncertainPassage {
  text: string; alternatives: string[]; reason: string | null; confidence: number; bbox: BBox | null; bbox_is_line?: boolean
  status: 'uncertain' | 'second_pass_concordant' | 'human_verified'; second_pass?: SecondPass; ranked?: RankedReading[]
  resolved_by_human?: boolean
}
export interface Suggestion { before: string; after: string; same_hand: boolean; correction_id: number; message: string }
export interface ReadingLine {
  n: number; bbox: BBox | null; zone?: number | null; diplomatic: string; normalized: string | null; translation: string | null
  uncertain: UncertainPassage[]; suggestions?: Suggestion[]; human?: Record<string, { by: string; note: string | null }>; location?: string | null
}
export interface ReadingSummary {
  id: string; media_id: string; version: number; is_latest: boolean; engine: string; model: string | null
  status: 'draft' | 'reviewed' | 'validated'; document_kind: string | null; script_type: string | null; script_label: string | null
  language: string | null; language_label: string | null; period_estimate: string | null; scribe_key: string | null
  created_at: string | null; updated_at: string | null; uncertain_count: number; quality: Quality; warnings: string[]
}
export interface Quality {
  lines?: number; lines_with_bbox?: number; chars?: number; uncertain_passages?: number; uncertain_char_ratio?: number | null
  verified_by_human?: boolean; self_assessment?: string | null; legibility?: string | null; problems?: string[]
  second_pass_done?: number; second_pass_interrupted?: string; human_corrections?: number; benchmarks?: BenchmarkEntry[]; note?: string
}
export interface PersonExtracted {
  role?: string; mention_role?: string; name_original?: string; given_names?: string | null; surname?: string | null
  stated_relation?: string | null; age?: number | null; age_stated?: string | null; occupation?: string | null; residence?: string | null
  confidence?: string
}
export interface PhotoAnalysis {
  description?: string | null; visible_elements?: string[]; people_count?: number
  people?: { position: string | null; clothing: string | null; objects: string | null; posture: string | null; apparent_age_group: string | null }[]
  inscriptions?: { text: string; location: string | null; bbox: BBox | null; uncertain: boolean; alternatives: string[] }[]
  photographer_stamp?: { text: string | null; studio: string | null; city: string | null }
  geographic_clues?: string[]; period_estimate?: { range: string | null; clues: string[]; confidence: string }
  photo_format?: string | null; condition?: string | null; face_identification?: string
}
export interface Reading extends ReadingSummary {
  preprocessing: { operations?: string[]; transform?: { crop: number[] | null; rotate: number }; sent_size?: number[]; original_size?: number[]; cached?: boolean; original_sha256?: string }
  zones: { bbox: BBox; kind: string }[]; lines: ReadingLine[]; diplomatic: string | null; normalized: string | null
  translation: string | null; translation_language: string | null; uncertain: (UncertainPassage & { line_n: number; index: number })[]
  extraction: { document_type?: string; date?: string | null; place?: string | null; summary_fr?: string | null; persons?: PersonExtracted[] } & Record<string, unknown>
  photo_analysis: PhotoAnalysis
  corrections: { id: number; ts: string | null; line_n: number | null; layer: string; before: string | null; after: string; note: string | null; author: string }[]
  mentions_count: number
}
export interface Mention {
  id: string; media_id: string | null; reading_id: string | null; name_original: string; given_names: string | null; surname: string | null
  sex: string | null; role: string; stated_relation: string | null; relation_kind: string | null; relation_side: string | null
  relation_to_role: string | null; relation_to_mention_id: string | null; age_stated: string | null; occupation: string | null
  residence: string | null; signed: boolean | null; excerpt: string | null
  image_region: { media_id: string; reading_id: string; line_n: number; bbox: BBox | null } | null
  reading_confidence: number | null; linked_person_id: string | null; link_status: string
  candidates: { person_id: string; score: number; level: string; reasons: string[]; warnings: string[] }[]
}
export interface ScriptInfo { id: string; label: string; period: string; languages: string[]; letterforms: string[]; abbreviations: Record<string, string>; vocabulary: Record<string, string> }
export interface PaleoCatalog {
  scripts: ScriptInfo[]; languages: { id: string; label: string }[]
  abbreviation_sets: { id: string; label: string; items: Record<string, string> }[]
  engines: { id: string; available: boolean; reason: string | null; label: string }[]
  max_second_pass: number; translate_targets: { id: string; label: string }[]
}
export interface ReadOptions {
  script_type?: string | null; language?: string | null; translate_to?: string | null; second_pass?: boolean; scribe_key?: string | null
  engine?: 'gemini' | 'manual' | 'external'; manual_text?: string; rotate?: number; contrast?: boolean; document_kind?: string | null
}
export interface BenchmarkEntry { ts: string; layer: string; ref_id: string | null; ref_title: string | null; synthetic: boolean; cer: number | null; wer: number | null; cer_normalized: number | null; wer_normalized: number | null; reference_chars: number; reference_words: number }
export interface BenchmarkReport extends BenchmarkEntry {
  reading_id: string; lines: { n: number; reference: string; hypothesis: string; cer: number | null; cer_normalized: number | null; distance: number }[]
  explanation: string; line_count_matches: boolean
}
export interface ReferenceInfo { id: string; title: string; script_type: string; language: string; period: string; licence: string; synthetic?: boolean; notes?: string }

export interface ViewParams { rotate?: number; contrast?: number | 'auto'; negative?: boolean; gray?: boolean; crop?: string; max?: number }

export const paleoApi = {
  catalog: () => req<PaleoCatalog>('/api/paleo/scripts'),
  readings: (mediaId: string) => req<ReadingSummary[]>(`/api/media/${mediaId}/readings`),
  reading: (id: string) => req<Reading>(`/api/readings/${id}`),
  read: (mediaId: string, opts: ReadOptions) => req<Reading>(`/api/media/${mediaId}/readings`, { method: 'POST', body: JSON.stringify(opts) }),
  manualPrompt: (mediaId: string, p: { script_type?: string | null; language?: string | null; translate_to?: string | null } = {}) =>
    req<{ prompt: string; file_url: string; filename: string | null }>(`/api/media/${mediaId}/readings/manual-prompt${q(p)}`),
  correct: (id: string, n: number, body: { text: string; layer?: 'diplomatic' | 'normalized' | 'translation'; note?: string }) =>
    req<Reading>(`/api/readings/${id}/lines/${n}`, { method: 'PATCH', body: JSON.stringify(body) }),
  recheck: (id: string, body: { line_n: number; bbox?: BBox; text?: string; index?: number }) =>
    req<{ passage: UncertainPassage; reading: Reading }>(`/api/readings/${id}/recheck`, { method: 'POST', body: JSON.stringify(body) }),
  validate: (id: string, note?: string) => req<Reading>(`/api/readings/${id}/validate`, { method: 'POST', body: JSON.stringify({ note }) }),
  extractMentions: (id: string) => req<Mention[]>(`/api/readings/${id}/mentions`, { method: 'POST', body: '{}' }),
  mentions: (id: string) => req<Mention[]>(`/api/readings/${id}/mentions`),
  benchmark: (body: { reading_id: string; reference_text?: string; ref_id?: string; layer?: string }) =>
    req<BenchmarkReport>('/api/paleo/benchmark', { method: 'POST', body: JSON.stringify(body) }),
  benchmarks: () => req<{ results: (BenchmarkEntry & { reading_id: string })[]; references: ReferenceInfo[] }>('/api/paleo/benchmarks'),
  fileUrl: (mediaId: string) => `${API_BASE}/api/media/${mediaId}/file`,
  viewUrl: (mediaId: string, p: ViewParams = {}) => `${API_BASE}/api/media/${mediaId}/view${q({ ...p })}`,
}

export const ROLE_LABEL: Record<string, string> = {
  subject: 'personne principale', father: 'père', mother: 'mère', spouse: 'conjoint(e)', groom: 'époux', bride: 'épouse',
  witness: 'témoin', godfather: 'parrain', godmother: 'marraine', declarant: 'déclarant', officiant: 'officiant (curé, officier)',
  deceased: 'défunt(e)', informant: 'informateur', neighbour: 'voisin(e)', other: 'autre',
}
export const RELATION_LABEL: Record<string, string> = {
  father: 'père', mother: 'mère', son: 'fils', daughter: 'fille', brother: 'frère', sister: 'sœur', half_brother: 'demi-frère',
  half_sister: 'demi-sœur', uncle: 'oncle', aunt: 'tante', nephew: 'neveu', niece: 'nièce', cousin: 'cousin(e)', grandfather: 'grand-père',
  grandmother: 'grand-mère', brother_in_law: 'beau-frère', sister_in_law: 'belle-sœur', father_in_law: 'beau-père', mother_in_law: 'belle-mère',
  stepfather: 'beau-père (remariage)', stepmother: 'belle-mère (remariage)', spouse: 'conjoint(e)', widow: 'veuve', widower: 'veuf',
  godfather: 'parrain', godmother: 'marraine', guardian: 'tuteur', neighbour: 'voisin', friend: 'ami(e)', employer: 'employeur', servant: 'domestique',
}
export const SIDE_LABEL: Record<string, string> = { maternal: 'du côté maternel', paternal: 'du côté paternel', unknown: 'côté non précisé' }
export const STATUS_LABEL: Record<string, string> = { draft: 'À vérifier', reviewed: 'Relue en partie', validated: 'Relue et validée par vous' }
