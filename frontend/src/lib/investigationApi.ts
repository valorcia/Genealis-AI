/**
 * Client du Centre d'investigation (enquêtes autonomes v0.4) — contrats de docs/ARCHITECTURE_V04.md.
 * Les routes peuvent être absentes d'une installation (404/501) : `isUnavailable` permet d'afficher
 * un état vide explicatif au lieu d'une erreur.
 */
import { ApiError, req, q } from '../api'

export type InvestigationStatus = 'pending' | 'running' | 'paused' | 'done' | 'blocked' | 'to_verify' | 'failed' | 'stopped'
export type TaskStatus = 'pending' | 'running' | 'done' | 'blocked' | 'to_verify' | 'failed' | 'cancelled'
export type CostMode = 'free' | 'hybrid' | 'commercial'
export type TaskKind = 'plan' | 'web_search' | 'browse' | 'analyze_document' | 'verify' | 'witness_followup' | 'expand_generation' | 'human_assist'
export type EventKind = 'info' | 'plan' | 'search' | 'page' | 'document' | 'analysis' | 'discovery' | 'filiation' | 'hypothesis' | 'question' | 'cost' | 'error' | 'human'
export type DiscoveryKind = 'hypothesis' | 'mention' | 'filiation' | 'question'

export interface InvestigationStats {
  documents_found: number; acts_analyzed: number; ancestors_identified: number; filiations_verified: number
  hypotheses: number; errors: number; pages_visited: number; persons_searched: number
}
export interface InvestigationOut {
  id: string; title: string; person_id: string; person_name: string | null; objective: string | null
  status: InvestigationStatus | string; status_label: string; cost_mode: CostMode | string
  max_generations: number; current_generation: number; ai_call_ceiling: number; ai_calls_used: number
  stats: InvestigationStats; blocked_reason: string | null; last_error: string | null
  started_at: string | null; finished_at: string | null; last_activity_at: string | null; active_seconds: number
  task_counts: Record<string, number>
}
export interface TaskOut {
  id: string; kind: TaskKind | string; title: string; person_id: string | null; status: TaskStatus | string; status_label: string
  strategy: string | null; priority: number; generation: number | null; attempts: number; last_error: string | null
  result: Record<string, unknown>; params: Record<string, unknown>; created_at: string; started_at: string | null; finished_at: string | null
}
export interface Evidence { source_id?: string | null; media_id?: string | null; url?: string | null; excerpt?: string | null }
export interface DiscoveryOut {
  kind: DiscoveryKind | string; id: string; title: string; description: string | null; score: number | null
  confidence: string | null; status: string; evidence: Evidence[]; person_id: string | null; created_at: string
}
export interface PageVisitOut {
  id: string; ts: string; url: string; domain: string | null; title: string | null; strategy: string | null; outcome: string | null
  screenshot_media_id: string | null; text_excerpt: string | null; downloads: unknown[]; security_flags: unknown[]
}
export interface InvestigationPerson { id: string; name: string; generation: number | null; sosa: number[]; status: string }
export interface InvestigationDetail extends InvestigationOut {
  tasks: TaskOut[]; discoveries: DiscoveryOut[]; next_searches: TaskOut[]; persons: InvestigationPerson[]
  memory: Record<string, unknown>; recent_pages: PageVisitOut[]
}
export interface InvestigationEvent { id: number; ts: string; kind: EventKind | string; message: string; data: Record<string, unknown> | null; task_id: string | null }
export interface WorkerInfo { online: boolean; last_seen: string | null; worker_id: string | null }
export interface InvestigationDashboard {
  active: number; persons_searched: number; documents_found: number; acts_analyzed: number; ancestors_identified: number
  filiations_verified: number; hypotheses_open: number; errors: number; research_seconds: number; ai_calls: number
  estimated_cost_usd: number; by_status: Record<string, number>; worker: WorkerInfo
}
export interface WorkerStatus extends WorkerInfo { playwright: boolean | null; browser_use: boolean | null; mode: string | null }
export interface CreateInvestigationIn {
  person_id: string; objective?: string; max_generations?: number; ai_call_ceiling?: number; cost_mode?: CostMode; start?: boolean
}
export interface MentionOut { id: string; [k: string]: unknown }
export interface NetworkGraph {
  nodes: { id: string; label: string; kind: string }[]
  edges: { source: string; target: string; role: string; stated_relation: string | null }[]
}

const post = <T,>(path: string, body?: unknown) => req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const investigationApi = {
  list: () => req<InvestigationOut[]>('/api/investigations'),
  dashboard: () => req<InvestigationDashboard>('/api/investigations/dashboard'),
  get: (id: string) => req<InvestigationDetail>(`/api/investigations/${id}`),
  create: (data: CreateInvestigationIn) => post<InvestigationOut>('/api/investigations', data),
  events: (id: string, after?: number, limit = 100) => req<InvestigationEvent[]>(`/api/investigations/${id}/events${q({ after, limit })}`),
  pause: (id: string) => post<InvestigationOut>(`/api/investigations/${id}/pause`),
  resume: (id: string) => post<InvestigationOut>(`/api/investigations/${id}/resume`),
  stop: (id: string) => post<InvestigationOut>(`/api/investigations/${id}/stop`),
  step: (id: string, budgetS = 20) => post<{ executed: string[]; status: string }>(`/api/investigations/${id}/step${q({ budget_s: budgetS })}`),
  retryTask: (taskId: string) => post<TaskOut>(`/api/investigation-tasks/${taskId}/retry`),
  humanDone: (taskId: string, note?: string) => post<TaskOut>(`/api/investigation-tasks/${taskId}/human-done`, { note: note || undefined }),
  validate: (kind: 'hypothesis' | 'mention', id: string) => post<unknown>(`/api/discoveries/${kind}/${id}/validate`),
  reject: (kind: 'hypothesis' | 'mention', id: string) => post<unknown>(`/api/discoveries/${kind}/${id}/reject`),
  mentions: (opts: { media_id?: string; person_id?: string; investigation_id?: string }) => req<MentionOut[]>(`/api/mentions${q(opts)}`),
  network: (personId: string) => req<NetworkGraph>(`/api/network/${personId}`),
  workerStatus: () => req<WorkerStatus>('/api/worker/status'),
}

/** Vrai si la fonctionnalité n'est pas (encore) disponible sur ce moteur : route absente ou non implémentée. */
export function isUnavailable(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 404 || e.status === 405 || e.status === 501
  // Moteur local sans la route : la page d'accueil HTML est renvoyée à la place du JSON attendu.
  return e instanceof SyntaxError
}

export const INVESTIGATION_STATUS_LABEL: Record<string, string> = {
  pending: 'EN ATTENTE', running: 'EN COURS', paused: 'EN PAUSE', done: 'TERMINÉE', blocked: 'BLOQUÉE',
  to_verify: 'À VÉRIFIER', failed: 'ÉCHEC', stopped: 'ARRÊTÉE', cancelled: 'ANNULÉE',
}
export const ZERO_STATS: InvestigationStats = { documents_found: 0, acts_analyzed: 0, ancestors_identified: 0, filiations_verified: 0, hypotheses: 0, errors: 0, pages_visited: 0, persons_searched: 0 }
export const ACTIVE_STATUSES = new Set(['pending', 'running', 'paused', 'blocked'])

export const TASK_KIND_LABEL: Record<string, string> = {
  plan: 'Planification', web_search: 'Recherche sur Internet', browse: 'Navigation sur un site', analyze_document: 'Lecture d’un document',
  verify: 'Vérification', witness_followup: 'Piste d’un témoin', expand_generation: 'Génération suivante', human_assist: 'Votre aide est demandée',
}
export const STRATEGY_LABEL: Record<string, string> = {
  web_search: 'recherche web', playwright: 'navigation automatique (sans IA)', browser_agent: 'agent navigateur (IA)', human: 'action humaine',
}
export const COST_MODE_LABEL: Record<string, string> = { free: 'GRATUIT', hybrid: 'HYBRIDE', commercial: 'COMMERCIAL' }
