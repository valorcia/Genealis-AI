import { create } from 'zustand'
import { api, type Dashboard, type LogOut, type Settings } from './api'

export interface LiveEvent { type: string; [k: string]: unknown }

interface AppState {
  settings: Settings | null
  dashboard: Dashboard | null
  liveLogs: LogOut[]
  connected: boolean
  toast: { kind: 'info' | 'error' | 'success'; text: string } | null
  refreshSettings: () => Promise<void>
  refreshDashboard: () => Promise<void>
  pushLog: (l: LogOut) => void
  setConnected: (v: boolean) => void
  notify: (kind: 'info' | 'error' | 'success', text: string) => void
}

export const useApp = create<AppState>((set) => ({
  settings: null, dashboard: null, liveLogs: [], connected: false, toast: null,
  refreshSettings: async () => { try { set({ settings: await api.settings() }) } catch { /* backend absent */ } },
  refreshDashboard: async () => { try { set({ dashboard: await api.dashboard() }) } catch { /* ignore */ } },
  pushLog: (l) => set((s) => ({ liveLogs: [l, ...s.liveLogs].slice(0, 300) })),
  setConnected: (v) => set({ connected: v }),
  notify: (kind, text) => { set({ toast: { kind, text } }); setTimeout(() => set({ toast: null }), 4500) },
}))

/**
 * Suivi en direct par interrogation périodique du journal (fonctionne aussi bien avec le moteur local
 * qu'en mode hébergé sans processus permanent). En mode hébergé, l'interface « pulse » le moteur
 * régulièrement pour faire avancer les enquêtes tant que l'application est ouverte.
 */
let started = false
let lastId = 0
let serverless = false
export function startLiveStream() {
  if (started) return
  started = true
  const poll = async () => {
    const st = useApp.getState()
    try {
      const rows = await api.logs(lastId ? { since_id: lastId, limit: 100 } : { limit: 50 })
      st.setConnected(true)
      if (!rows.length) return
      const fresh = lastId ? rows : []
      lastId = Math.max(lastId, ...rows.map((r) => r.id))
      if (!fresh.length) { rows.slice().reverse().forEach((r) => st.pushLog(r)); return }
      fresh.slice().reverse().forEach((r) => {
        st.pushLog(r)
        if (r.category === 'question') { st.notify('info', r.message.replace(/^Nouvelle question en attente : /, 'Nouvelle question : ')); window.dispatchEvent(new CustomEvent('genealis:event', { detail: { type: 'question' } })) }
        if (r.category === 'decision' && /^Tâche (terminée|créée|approuvée|refusée)/.test(r.message)) { window.dispatchEvent(new CustomEvent('genealis:event', { detail: { type: 'task', status: r.message.startsWith('Tâche terminée') ? 'done' : 'queued' } })) }
        if (r.category === 'decision' && r.message.startsWith('Tâche terminée')) st.refreshDashboard()
      })
    } catch { useApp.getState().setConnected(false) }
  }
  api.health().then((h) => { serverless = h.serverless }).catch(() => {})
  poll()
  setInterval(poll, 4000)
  // Impulsion du moteur en mode hébergé : fait avancer la file tant que l'onglet est ouvert.
  const pulse = async () => {
    if (!serverless || document.hidden) return
    const s = useApp.getState().settings
    if (s?.research_pause) return
    try { await api.runNow(50) } catch { /* budget épuisé ou verrou : on réessaiera */ }
  }
  setTimeout(pulse, 3000)
  setInterval(pulse, 45000)
  window.addEventListener('genealis:pulse', () => { pulse() })
}
export function pulseEngine() { window.dispatchEvent(new CustomEvent('genealis:pulse')) }
