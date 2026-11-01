/** Client typé de l'API locale GENEALIS AI. */
export const API_BASE = (window as unknown as { __GENEALIS_API__?: string }).__GENEALIS_API__ ?? ''

export type Confidence = 'green' | 'orange' | 'red' | 'grey'

export interface PersonSummary {
  id: string; display_name: string; given_names: string | null; surname: string | null; married_name: string | null
  sex: 'M' | 'F' | null; confidence: Confidence; is_root: boolean; is_living: boolean | null
  birth_year: number | null; death_year: number | null; birth_display: string | null; death_display: string | null
  birth_place: string | null; death_place: string | null; occupation: string | null; portrait_media_id: string | null
}
export interface CitationOut { id: string; source_id: string; target_type: string; target_id: string; excerpt: string | null; image_region: Record<string, number> | null; confidence: Confidence; note: string | null; source_title: string | null; source_reliability: string | null }
export interface EventOut { id: string; person_id: string | null; family_id: string | null; event_type: string; date_original: string | null; date_kind: string; date_start: string | null; date_end: string | null; calendar: string; sort_year: number | null; date_display: string; place_id: string | null; place_name: string | null; place_original: string | null; description: string | null; value_original: string | null; attributes: Record<string, unknown>; confidence: Confidence; citations: CitationOut[] }
export interface RelationOut { id: string; parent_id: string; child_id: string; relation_type: string; confidence: Confidence; confidence_details: { criteria?: string[]; sources?: number; contradictions?: string[] } & Record<string, unknown>; notes: string | null }
export interface FamilyOut { id: string; partner1_id: string | null; partner2_id: string | null; union_type: string; confidence: Confidence; notes: string | null; events: EventOut[]; children_ids: string[] }
export interface MediaOut { id: string; path: string; original_filename: string | null; mime_type: string | null; kind: string; title: string | null; person_id: string | null; source_id: string | null; language: string | null; analysis_status: string; analysis: Record<string, unknown>; ocr_text?: string | null; created_at: string }
export interface HypothesisOut { id: string; kind: string; title: string; description: string | null; subject_person_id: string | null; candidate: Record<string, unknown>; evidence: unknown[]; score: number | null; score_details: Record<string, unknown>; status: string; created_by: string; task_id: string | null; group_key: string | null; created_at: string }
export interface QuestionOut { id: string; title: string; problem: string | null; known_facts: unknown[]; hypotheses: unknown[]; documents: { title?: string; url?: string; media_id?: string }[]; impact: string | null; priority: number; status: string; answer_type: string | null; answer: string | null; person_id: string | null; task_id: string | null; created_at: string; answered_at: string | null }
export interface ContradictionOut { id: string; kind: string; severity: 'orange' | 'red'; description: string; person_ids: string[]; event_ids: string[]; relation_ids: string[]; status: string; resolution_note: string | null; created_at: string }
export interface PersonDetail extends PersonSummary {
  name_variants: string[]; nationality: string | null; notes: string | null; confidence_details: { criteria?: string[] } & Record<string, unknown>
  events: EventOut[]; parents: PersonSummary[]; parent_relations: RelationOut[]; children: PersonSummary[]; child_relations: RelationOut[]
  spouses: PersonSummary[]; families: FamilyOut[]; siblings: PersonSummary[]; media: MediaOut[]; citations: CitationOut[]
  hypotheses: HypothesisOut[]; contradictions: ContradictionOut[]; questions: QuestionOut[]; research_status: Record<string, unknown>
  created_at: string; updated_at: string
}
export interface PersonIn { given_names?: string | null; surname?: string | null; married_name?: string | null; name_variants?: string[]; sex?: string | null; nationality?: string | null; occupation?: string | null; notes?: string | null; is_living?: boolean | null; is_root?: boolean | null; confidence?: Confidence | null; birth_date?: string | null; birth_place?: string | null; death_date?: string | null; death_place?: string | null }
export interface EventIn { event_type: string; date?: string | null; place?: string | null; description?: string | null; value_original?: string | null; attributes?: Record<string, unknown>; confidence?: Confidence | null; family_id?: string | null }
export interface SourceOut { id: string; title: string; repository: string | null; fonds: string | null; commune: string | null; register_type: string | null; reference: string | null; year: number | null; page: string | null; url: string | null; consulted_at: string | null; local_copy_path: string | null; local_copy_allowed: boolean | null; transcription: string | null; translation: string | null; interpretation: string | null; language: string | null; reliability: string; connector_id: string | null; external_id: string | null; extra: Record<string, unknown>; content_hash: string | null; created_at: string; citation_count: number }
export type SourceIn = Omit<SourceOut, 'id' | 'content_hash' | 'created_at' | 'citation_count'>
export interface TaskOut { id: string; task_type: string; title: string; person_id: string | null; status: string; priority: number; plan: PlanStep[]; params: Record<string, unknown>; attempts: number; last_error: string | null; result: Record<string, unknown>; started_at: string | null; finished_at: string | null; parent_task_id: string | null; requires_approval: boolean; approved: boolean | null; created_at: string; updated_at: string }
export interface PlanStep { action: string; connector_id: string | null; label: string; query: Record<string, unknown>; status: string; result: Record<string, unknown> }
export interface LogOut { id: number; ts: string; task_id: string | null; person_id: string | null; level: string; category: string; message: string; connector_id: string | null; query: Record<string, unknown> | null; outcome: Record<string, unknown> | null }
export interface ConnectorInfo { id: string; name: string; country: string; organization: string; collections: string[]; areas: string[]; period_start: number | null; period_end: number | null; search_fields: string[]; access_mode: string; limitations: string[]; terms_url: string | null; reuse_terms: string; formats: string[]; homepage: string; languages: string[]; requires_credentials: boolean; notes: string; status: string; last_test_at: string | null; test_details: Record<string, unknown>; enabled: boolean; operational: boolean }
export interface TreeNode extends PersonSummary { generation: number; sosa?: number[] }
export interface TreeEdge { id: string; source: string; target: string; relation_type: string; confidence: Confidence }
export interface TreeGraph { nodes: TreeNode[]; edges: TreeEdge[]; generations: number; root_id: string }
export interface TimelineItem extends PersonSummary { start: number; end: number; estimated: boolean; generation: number | null; events: { type: string; year: number | null; place: string | null }[] }
export interface HistoricalEvent { start: number; end: number; label: string; region: string; kind: string }
export interface TimelineData { items: TimelineItem[]; min_year: number; max_year: number; historical_events: HistoricalEvent[] }
export interface MapData { points: { place_id: string; name: string; lat: number; lon: number; events: { person_id: string; person: string; type: string; year: number | null }[] }[]; moves: { person_id: string; person: string; from: string; to: string; from_lat: number; from_lon: number; to_lat: number; to_lon: number; year: number | null }[]; unlocated_places: { id: string; name: string }[] }
export interface Dashboard { persons: number; generations: number; oldest_ancestor: { id: string; name: string; year: number; generation: number } | null; relations_total: number; relations_verified: number; relations_by_confidence: Record<string, number>; hypotheses_open: number; documents_total: number; documents_analyzed: number; sources: number; countries: string[]; archives_consulted: string[]; tasks_running: number; tasks_queued: number; tasks_waiting: number; questions_pending: number; contradictions_open: number; log_entries: number; root_person: { id: string; name: string } | null }
export interface NarrativeParagraph { text: string; sources: CitationOut[]; confidence: Confidence; year: number | null }
export interface Narrative { person_id: string; name: string; paragraphs: NarrativeParagraph[]; historical_context: HistoricalEvent[]; unsourced_count: number }
export interface Settings { autonomy_mode: number; ai_provider: string; ollama_url: string; ollama_model: string; ollama_vision_model: string; anthropic_model: string; allow_external_ai: boolean; external_ai_scope: string; ocr_engine: string; tesseract_cmd: string; backup_enabled: boolean; backup_interval_hours: number; backup_keep: number; living_persons_privacy: boolean; onboarding_done: boolean; research_pause: boolean; anthropic_api_key_set: boolean; [k: string]: unknown }
export interface ChatOut { role: string; content: string; meta: Record<string, unknown>; ts: string }
export interface Priority { person_id: string; name: string; missing: string[]; availability: number; country: string; birth_year: number | null; estimated_minutes: number; score: number; already_tried: string[] }

export class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status } }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, { headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }, ...init })
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new CustomEvent('genealis:auth'))
  if (!res.ok) {
    let msg = res.statusText
    try { const j = await res.json(); msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j) } catch { /* ignore */ }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
const q = (o: Record<string, unknown>) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, String(v)) }); const s = p.toString(); return s ? `?${s}` : '' }

export const api = {
  health: () => req<{ status: string; version: string; data_dir: string; serverless: boolean; auth_required: boolean; database: string }>('/api/health'),
  login: (password: string) => req<{ ok: boolean; auth_required: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  runNow: (budget = 50) => req<{ ran: number; locked?: boolean; paused?: boolean; elapsed?: number }>(`/api/research/run${q({ budget })}`, { method: 'POST' }),
  exportJsonUrl: () => `${API_BASE}/api/export/json`,
  importJson: (file: File) => { const fd = new FormData(); fd.append('file', file); return req<Record<string, number>>('/api/import/json', { method: 'POST', body: fd }) },
  settings: () => req<Settings>('/api/settings'),
  patchSettings: (values: Record<string, unknown>) => req<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify({ values }) }),
  aiStatus: () => req<{ provider: string; available: boolean; ok: boolean; message: string; models?: string[] }>('/api/ai/status'),
  ollamaModels: () => req<string[]>('/api/ai/ollama/models'),
  transmissions: () => req<{ id: number; ts: string; provider: string; purpose: string; payload_summary: string; bytes_sent: number; contains_personal_data: boolean; authorized: boolean }[]>('/api/transmissions'),
  search: (query: string) => req<{ entity_type: string; entity_id: string; title: string; snippet: string }[]>(`/api/search${q({ q: query })}`),
  dashboard: () => req<Dashboard>('/api/dashboard'),
  persons: (query?: string, limit = 500) => req<PersonSummary[]>(`/api/persons${q({ q: query, limit })}`),
  person: (id: string) => req<PersonDetail>(`/api/persons/${id}`),
  createPerson: (data: PersonIn) => req<PersonDetail>('/api/persons', { method: 'POST', body: JSON.stringify(data) }),
  updatePerson: (id: string, data: PersonIn) => req<PersonDetail>(`/api/persons/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePerson: (id: string) => req<void>(`/api/persons/${id}`, { method: 'DELETE' }),
  addEvent: (personId: string, data: EventIn) => req<EventOut>(`/api/persons/${personId}/events`, { method: 'POST', body: JSON.stringify(data) }),
  updateEvent: (id: string, data: EventIn) => req<EventOut>(`/api/persons/events/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEvent: (id: string) => req<void>(`/api/persons/events/${id}`, { method: 'DELETE' }),
  addRelation: (data: { parent_id: string; child_id: string; relation_type?: string; notes?: string; source_ids?: string[] }) => req<RelationOut>('/api/persons/relations', { method: 'POST', body: JSON.stringify(data) }),
  deleteRelation: (id: string) => req<void>(`/api/persons/relations/${id}`, { method: 'DELETE' }),
  createFamily: (data: { partner1_id?: string | null; partner2_id?: string | null; union_type?: string; marriage_date?: string | null; marriage_place?: string | null }) => req<FamilyOut>('/api/persons/families', { method: 'POST', body: JSON.stringify(data) }),
  ancestors: (rootId?: string, generations = 12) => req<TreeGraph>(`/api/tree/ancestors${q({ root_id: rootId, generations })}`),
  descendants: (rootId?: string, generations = 8) => req<TreeGraph>(`/api/tree/descendants${q({ root_id: rootId, generations })}`),
  timeline: (rootId?: string, all = false) => req<TimelineData>(`/api/timeline${q({ root_id: rootId, all_persons: all })}`),
  map: () => req<MapData>('/api/map'),
  narrative: (personId: string) => req<Narrative>(`/api/narrative/${personId}`),
  familyNarrative: (rootId?: string, generations = 6) => req<Narrative[]>(`/api/narrative${q({ root_id: rootId, generations })}`),
  sources: (query?: string) => req<SourceOut[]>(`/api/sources${q({ q: query })}`),
  source: (id: string) => req<SourceOut>(`/api/sources/${id}`),
  createSource: (data: Partial<SourceIn>) => req<SourceOut>('/api/sources', { method: 'POST', body: JSON.stringify(data) }),
  updateSource: (id: string, data: Partial<SourceIn>) => req<SourceOut>(`/api/sources/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSource: (id: string) => req<void>(`/api/sources/${id}`, { method: 'DELETE' }),
  sourceCitations: (id: string) => req<CitationOut[]>(`/api/sources/${id}/citations`),
  addCitation: (data: { source_id: string; target_type: string; target_id: string; excerpt?: string; confidence?: Confidence; note?: string }) => req<CitationOut>('/api/sources/citations', { method: 'POST', body: JSON.stringify(data) }),
  deleteCitation: (id: string) => req<void>(`/api/sources/citations/${id}`, { method: 'DELETE' }),
  tasks: (status?: string) => req<TaskOut[]>(`/api/research/tasks${q({ status })}`),
  createTask: (data: { task_type: string; person_id?: string; title?: string; priority?: number; params?: Record<string, unknown> }) => req<TaskOut>('/api/research/tasks', { method: 'POST', body: JSON.stringify(data) }),
  explore: (personId: string, generations = 3) => req<TaskOut[]>(`/api/research/explore/${personId}${q({ generations })}`, { method: 'POST' }),
  approveTask: (id: string, approved = true) => req<TaskOut>(`/api/research/tasks/${id}/approve${q({ approved })}`, { method: 'POST' }),
  cancelTask: (id: string) => req<TaskOut>(`/api/research/tasks/${id}/cancel`, { method: 'POST' }),
  retryTask: (id: string) => req<TaskOut>(`/api/research/tasks/${id}/retry`, { method: 'POST' }),
  worker: () => req<{ running: boolean; current_task_id: string | null; paused: boolean; autonomy_mode: number; serverless: boolean; queued: number }>('/api/research/worker'),
  pauseWorker: (paused: boolean) => req<{ paused: boolean }>(`/api/research/worker/pause${q({ paused })}`, { method: 'POST' }),
  priorities: () => req<Priority[]>('/api/research/priorities'),
  logs: (opts: { limit?: number; task_id?: string; person_id?: string; since_id?: number } = {}) => req<LogOut[]>(`/api/research/logs${q(opts)}`),
  decisions: () => req<{ id: number; ts: string; agent: string; task_id: string | null; decision: string; rationale: Record<string, unknown> }[]>('/api/research/decisions'),
  questions: (status = 'pending') => req<QuestionOut[]>(`/api/research/questions${q({ status })}`),
  answerQuestion: (id: string, data: { answer_type: string; answer?: string; payload?: Record<string, unknown> }) => req<QuestionOut>(`/api/research/questions/${id}/answer`, { method: 'POST', body: JSON.stringify(data) }),
  hypotheses: (status = 'open', personId?: string) => req<HypothesisOut[]>(`/api/research/hypotheses${q({ status, person_id: personId })}`),
  setHypothesisStatus: (id: string, status: string) => req<HypothesisOut>(`/api/research/hypotheses/${id}/status${q({ status })}`, { method: 'POST' }),
  contradictions: (status = 'open') => req<ContradictionOut[]>(`/api/research/contradictions${q({ status })}`),
  checkContradictions: () => req<ContradictionOut[]>('/api/research/contradictions/check', { method: 'POST' }),
  setContradictionStatus: (id: string, status: string, note?: string) => req<ContradictionOut>(`/api/research/contradictions/${id}/status${q({ status, note })}`, { method: 'POST' }),
  connectors: () => req<ConnectorInfo[]>('/api/research/connectors'),
  testConnector: (id: string) => req<{ connector_id: string; ok: boolean; status: string; details: Record<string, unknown> }>(`/api/research/connectors/${id}/test`, { method: 'POST' }),
  connectorSearch: (id: string, query: Record<string, unknown>) => req<{ ok: boolean; error?: string; browse_url: string | null; results: Record<string, unknown>[] }>(`/api/research/connectors/${id}/search`, { method: 'POST', body: JSON.stringify(query) }),
  connectorBrowse: (id: string, query: Record<string, unknown>) => req<{ url: string }>(`/api/research/connectors/${id}/browse${q(query)}`),
  media: (personId?: string) => req<MediaOut[]>(`/api/media${q({ person_id: personId })}`),
  mediaDetail: (id: string) => req<MediaOut>(`/api/media/${id}`),
  mediaFileUrl: (id: string) => `${API_BASE}/api/media/${id}/file`,
  uploadMedia: (file: File, opts: { person_id?: string; kind?: string; title?: string; analyze?: boolean } = {}) => { const fd = new FormData(); fd.append('file', file); Object.entries(opts).forEach(([k, v]) => { if (v !== undefined) fd.append(k, String(v)) }); return req<MediaOut>('/api/media', { method: 'POST', body: fd }) },
  analyzeMedia: (id: string) => req<{ task_id: string; status: string }>(`/api/media/${id}/analyze`, { method: 'POST' }),
  setTranscription: (id: string, data: { transcription?: string; person_id?: string; title?: string }) => req<MediaOut>(`/api/media/${id}/transcription`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMedia: (id: string) => req<void>(`/api/media/${id}`, { method: 'DELETE' }),
  importGedcom: (file: File) => { const fd = new FormData(); fd.append('file', file); return req<{ persons: number; families: number; sources: number; relations: number; events: number; warnings: string[] }>('/api/import/gedcom', { method: 'POST', body: fd }) },
  importCsv: (file: File) => { const fd = new FormData(); fd.append('file', file); return req<{ created: number; skipped: number }>('/api/import/csv', { method: 'POST', body: fd }) },
  exportUrl: (kind: 'gedcom' | 'persons.csv' | 'sources.csv' | 'report.pdf', extra: Record<string, unknown> = {}) => `${API_BASE}/api/export/${kind}${q(extra)}`,
  personPdfUrl: (id: string) => `${API_BASE}/api/export/person/${id}.pdf`,
  chat: (message: string) => req<ChatOut>('/api/chat', { method: 'POST', body: JSON.stringify({ message }) }),
  chatHistory: () => req<ChatOut[]>('/api/chat/history'),
  clearChat: () => req<void>('/api/chat/history', { method: 'DELETE' }),
  backups: () => req<{ name: string; size: number; created_at: string; encrypted: boolean }[]>('/api/backups'),
  createBackup: (passphrase?: string) => req<{ name: string; path: string }>(`/api/backups${q({ passphrase })}`, { method: 'POST' }),
  restoreBackup: (name: string, passphrase?: string) => req<{ restored: string; safety_backup: string }>(`/api/backups/${encodeURIComponent(name)}/restore${q({ passphrase })}`, { method: 'POST' }),
  technicalLog: () => req<{ path: string; lines: string[] }>('/api/logs/technical'),
  onboarding: (data: Record<string, unknown>) => req<{ root: PersonDetail; parents: string[]; grandparents: string[]; tasks: string[] }>('/api/onboarding', { method: 'POST', body: JSON.stringify(data) }),
  streamUrl: () => `${API_BASE}/api/research/stream`,
  // Fichier des décès INSEE : index local gratuit, hors ligne
  inseeStatus: () => req<{ files: { name: string; lines: number; imported_at: string }[]; records: number; db_path: string }>('/api/research/insee/status'),
  inseeResources: () => req<{ title: string; url: string; year: number; month: number | null; size: number | null; format: string }[]>('/api/research/insee/resources'),
  inseeImport: (url: string, name: string) => req<{ started: boolean; name: string }>('/api/research/insee/import', { method: 'POST', body: JSON.stringify({ url, name }) }),
  inseeImportLocal: (path: string) => req<{ imported: number }>('/api/research/insee/import-local', { method: 'POST', body: JSON.stringify({ path }) }),
  // Lieux
  places: () => req<{ id: string; name: string; department: string | null; country: string | null; country_code: string | null; lat: number | null; lon: number | null; historical_names: string[] }[]>('/api/places'),
  updatePlace: (id: string, data: Record<string, unknown>) => req<{ id: string; name: string; lat: number | null; lon: number | null }>(`/api/places/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  geocodePlaces: () => req<{ total: number; geocoded: number; errors: string[] }>('/api/places/geocode', { method: 'POST' }),
}

export const CONF_LABEL: Record<Confidence, string> = { green: 'Établi', orange: 'À vérifier', red: 'Contradiction', grey: 'Inconnu' }
export const EVENT_LABEL: Record<string, string> = { birth: 'Naissance', baptism: 'Baptême', marriage: 'Mariage', marriage_banns: 'Publication de bans', marriage_contract: 'Contrat de mariage', divorce: 'Divorce', death: 'Décès', burial: 'Inhumation', residence: 'Résidence', census: 'Recensement', occupation: 'Profession', military: 'Service militaire', immigration: 'Immigration', emigration: 'Émigration', naturalization: 'Naturalisation', will: 'Testament', probate: 'Succession', other: 'Autre' }
export const RELATION_LABEL: Record<string, string> = { biological: 'biologique', adoptive: 'adoptive', legal: 'légale', step: 'beau-parent', foster: 'nourricière', uncertain: 'incertaine' }
export const TASK_STATUS_LABEL: Record<string, string> = { queued: 'En file', running: 'En cours', waiting_user: 'Attend votre accord', done: 'Terminée', failed: 'Échec', paused: 'En pause', cancelled: 'Annulée' }

export function openExternal(url: string) {
  const w = window as unknown as { __TAURI__?: { shell?: { open: (u: string) => Promise<void> }; opener?: { openUrl: (u: string) => Promise<void> } } }
  if (w.__TAURI__?.opener) { w.__TAURI__.opener.openUrl(url).catch(() => window.open(url, '_blank')); return }
  if (w.__TAURI__?.shell) { w.__TAURI__.shell.open(url).catch(() => window.open(url, '_blank')); return }
  window.open(url, '_blank', 'noopener')
}
