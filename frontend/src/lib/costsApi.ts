/** Client du gestionnaire de coûts et de l'audit Gemini (backend/genealis/api/costs.py). */
import { req, q } from '../api'

export interface CostSummary {
  mode: string; mode_label: string; mode_description: string
  modes: Record<string, { label: string; description: string }>
  today: { calls: number; cache_hits: number; refused: number; errors: number }
  month: { calls: number; cache_hits: number; estimated_cost_usd: number; input_tokens: number; output_tokens: number; thinking_tokens: number }
  limits: { daily: number; per_minute: number; investigation: number; monthly_budget_usd: number; concurrency: number }
  prices_configured: boolean
  quota_blocked_until: string | null
  cache: { enabled: boolean; entries: number; hits_total: number }
  by_purpose: { purpose: string; calls: number; cost_usd: number }[]
  by_day: { day: string; calls: number }[]
}
export type CallStatus = 'ok' | 'cache_hit' | 'quota_refused' | 'error' | 'rate_limited' | string
export interface CostCall {
  id: number; ts: string; provider: string; model: string | null; purpose: string; status: CallStatus
  input_tokens: number; output_tokens: number; thinking_tokens: number; estimated_cost_usd: number; duration_ms: number | null
  web_search: boolean; attachments: number; investigation_id: string | null; error: string | null
}
export interface GeminiModelInfo {
  name: string; display_name: string | null; version: string | null; description: string; input_token_limit: number | null
  output_token_limit: number | null; thinking: boolean | null; methods: string[]
}
export interface GeminiAuditReport {
  provider: string; configured_model: string; key_set: boolean; external_allowed: boolean
  checks: { name: string; ok: boolean | null; detail: string }[]
  available_models?: GeminiModelInfo[]; recommended_model?: string | null
}

export const costsApi = {
  summary: () => req<CostSummary>('/api/costs/summary'),
  calls: (limit = 50, investigationId?: string) => req<CostCall[]>(`/api/costs/calls${q({ limit, investigation_id: investigationId })}`),
  unblock: () => req<CostSummary>('/api/costs/unblock', { method: 'POST' }),
  clearCache: () => req<{ deleted: number }>('/api/costs/cache', { method: 'DELETE' }),
  geminiAudit: () => req<GeminiAuditReport>('/api/ai/gemini/audit'),
  geminiProbe: () => req<GeminiAuditReport>('/api/ai/gemini/audit', { method: 'POST' }),
}

export const CALL_STATUS_LABEL: Record<string, string> = {
  ok: 'Réussi', cache_hit: 'Évité (cache)', quota_refused: 'Refusé (plafond)', error: 'Erreur', rate_limited: 'Quota Google atteint',
}
export const CALL_STATUS_CLASS: Record<string, string> = {
  ok: 'conf-green', cache_hit: 'conf-grey', quota_refused: 'conf-orange', error: 'conf-red', rate_limited: 'conf-orange',
}
/** Libellés lisibles des usages (`purpose`) les plus courants ; sinon le libellé technique est affiché tel quel. */
export const PURPOSE_LABEL: Record<string, string> = {
  test: 'Tests de configuration', web_search: 'Recherche sur Internet', gemini_web: 'Recherche Google (Gemini)', paleo: 'Lecture d’écriture ancienne',
  read_document: 'Lecture de documents', transcription: 'Transcription', interpret: 'Interprétation de documents', advice: 'Pistes de recherche',
  chat: 'Assistant', browser_agent: 'Agent navigateur', plan: 'Planification d’enquête', verify: 'Vérification', story: 'Livre de famille',
}

export function formatUsd(v: number): string {
  if (!v) return '0 $'
  return `${v < 0.01 ? v.toFixed(4) : v.toFixed(2)} $`.replace('.', ',')
}
export function formatInt(v: number): string { return new Intl.NumberFormat('fr-FR').format(v) }
