/** Traçabilité des recherches : où l'IA a cherché, avec quel résultat, et diagnostic du moteur. */
import { req, q, type Discovery, type HypothesisOut, type QuestionOut } from '../api'

export type StepOutcome = 'ok' | 'no_result' | 'restricted' | 'error' | 'manual' | 'pending' | 'running' | 'skipped' | 'done' | string

export interface TraceResultItem { title: string; url: string | null; snippet: string | null; year: number | null; date_text?: string | null; place: string | null; reliability: string; connector_id: string; record_type?: string | null; repository?: string | null }
export interface GroundingSource { index: number; title: string; url: string; domain: string }
export interface GroundingSupport { text: string; sources: number[] }
export interface GroundingFinding {
  type: string; summary?: string; date?: string; place?: string; url?: string; site?: string; quote?: string; confidence?: string
  resolved_url: string | null; resolved_domain: string | null; match: string | null; kept: boolean; source_indices: number[]
}
export interface Grounding {
  queries: string[]; sources: GroundingSource[]; supports: GroundingSupport[]; not_found: string[]
  findings?: GroundingFinding[]; notes?: GroundingFinding[]; sites_requested?: string[]; model?: string; parse_error?: string; raw_text?: string
}
export interface StepSearched { name: string | null; years: string | null; commune: string | null; department: string | null; register_type: string | null }
export interface TraceStepResult {
  status?: StepOutcome; message?: string; count?: number; results?: TraceResultItem[]; verify_url?: string | null; browse_url?: string | null
  site?: string | null; homepage?: string; connector_name?: string; access_mode?: string; searched?: StepSearched
  started_at?: string; finished_at?: string; duration_ms?: number; error?: string; grounding?: Grounding; note?: string; evaluated?: number
}
export interface TraceStep {
  index: number; action: string; label: string; connector_id: string | null; connector_name: string | null; site: string | null
  homepage: string | null; access_mode: string | null; query: Record<string, unknown>; status: string; outcome: StepOutcome; result: TraceStepResult
}
export interface TraceSiteBrief { connector_id: string | null; name: string | null; site: string | null; status: StepOutcome; count: number; action: string }
export interface TraceSummary {
  sites: TraceSiteBrief[]; sites_queried: number; sites_answered: number; sites_failed: number; sites_restricted: number; sites_manual: number
  results: number; web_pages: number; hypotheses: number; questions: number; sources: number; media: number; found: boolean; sentence: string
}
export interface TraceTaskBrief {
  id: string; title: string; task_type: string; type_label: string; status: string; person_id: string | null; person_name: string | null
  created_at: string; started_at: string | null; finished_at: string | null; last_error: string | null; attempts: number; summary: TraceSummary
}
export interface TraceLog { id: number; ts: string; level: string; category: string; message: string; connector_id: string | null; query: Record<string, unknown> | null; outcome: Record<string, unknown> | null }
export interface TraceSource { id: string; title: string; url: string | null; repository: string | null; reliability: string; connector_id: string | null; year: number | null; created_at: string }
export interface TraceMedia { id: string; title: string | null; kind: string; mime_type: string | null; archived_from: string | null; created_at: string }
export interface TraceTaskDetail extends TraceTaskBrief {
  priority: number; params: Record<string, unknown>; result: Record<string, unknown>; parent_task_id: string | null
  requires_approval: boolean; approved: boolean | null
  person: { id: string; name: string; sex: string | null; birth_year: number | null; death_year: number | null } | null
  conclusion: string; steps: TraceStep[]; logs: TraceLog[]; hypotheses: HypothesisOut[]; questions: QuestionOut[]; sources: TraceSource[]; media: TraceMedia[]
}
export interface TraceSite {
  connector_id: string; name: string; domain: string | null; homepage: string; access_mode: string; country: string; organization: string
  searches: number; results: number; last_search_at: string | null; last_status: StepOutcome | null; last_message: string | null; last_error: string | null
  proposed_manual: number; operational_status: string; last_test_at: string | null; test_details: Record<string, unknown>
  color: 'green' | 'orange' | 'red' | 'grey'; explanation: string
}
export interface TraceSites { sites: TraceSite[]; web_domains: { domain: string; count: number; last_at: string | null }[] }
export interface DiagnosticItem {
  connector_id: string; name: string; domain: string | null; homepage: string; access_mode: string
  result: 'ok' | 'degraded' | 'failed' | 'restricted'; status: string; ok: boolean; latency_ms: number | null; message: string; details: Record<string, unknown>
}
export interface Diagnostic { started_at: string; duration_ms: number; summary: Record<'ok' | 'degraded' | 'failed' | 'restricted', number>; verdict: string; results: DiagnosticItem[] }

/** Découverte enrichie de la recherche qui l'a produite (champ ajouté côté serveur). */
export type DiscoveryWithTask = Discovery & { task_id?: string | null }

export const traceApi = {
  tasks: (opts: { person_id?: string; status?: string; limit?: number } = {}) => req<TraceTaskBrief[]>(`/api/trace/tasks${q(opts)}`),
  task: (id: string) => req<TraceTaskDetail>(`/api/trace/tasks/${encodeURIComponent(id)}`),
  sites: () => req<TraceSites>('/api/trace/sites'),
  diagnostic: () => req<Diagnostic>('/api/trace/diagnostic', { method: 'POST' }),
}

export function hostOf(u: string | null | undefined): string {
  if (!u) return ''
  try { return new URL(u.includes('//') ? u : `https://${u}`).hostname.replace(/^www\./, '') } catch { return u }
}
export const faviconUrl = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
export const googleSearchUrl = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`
