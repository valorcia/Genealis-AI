import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { ApiError } from '../../api'

/** Message d'erreur lisible en français à partir d'une exception quelconque. */
export function errMsg(e: unknown, fallback = 'Une erreur est survenue'): string {
  if (e instanceof ApiError) return e.message || `Erreur ${e.status}`
  if (e instanceof TypeError) return 'Moteur local injoignable. Vérifiez que GENEALIS est bien démarré.'
  if (e instanceof Error) return e.message || fallback
  return fallback
}

export function Modal({ title, onClose, children, footer, wide = false }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-night-950/50 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === ref.current) onClose() }} ref={ref}>
      <div className={`panel fade-up flex max-h-[90vh] w-full flex-col ${wide ? 'max-w-4xl' : 'max-w-xl'}`} role="dialog" aria-modal="true">
        <header className="flex items-center justify-between gap-3 border-b border-ivory-300/70 px-5 py-3">
          <h3 className="font-display text-xl text-night-900">{title}</h3>
          <button className="btn-ghost !p-1.5" onClick={onClose} title="Fermer"><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-ivory-300/70 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export interface TabDef { id: string; label: string; count?: number }
export function Tabs({ tabs, value, onChange }: { tabs: TabDef[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-2xl border border-ivory-300/70 bg-ivory-50 p-1">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition-colors cursor-pointer ${value === t.id ? 'bg-night-900 text-ivory-50' : 'text-night-900 hover:bg-ivory-200'}`}>
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className={`rounded-full px-1.5 text-[11px] font-semibold ${value === t.id ? 'bg-gold-500 text-night-950' : 'bg-mist-200 text-mist-500'}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function JsonView({ value, label = 'Détails' }: { value: unknown; label?: string }) {
  if (value === null || value === undefined || (typeof value === 'object' && Object.keys(value as object).length === 0)) return null
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-mist-500 hover:text-night-900">{label}</summary>
      <pre className="mt-1 max-h-64 overflow-auto scrollbar-thin rounded-lg bg-night-900 p-2 text-[11px] leading-snug text-ivory-100">{JSON.stringify(value, null, 2)}</pre>
    </details>
  )
}

export const RELIABILITY_LABEL: Record<string, string> = { primary: 'Acte original', secondary: 'Table / index / transcription', derivative: 'Arbre tiers (piste)', unknown: 'Fiabilité inconnue' }
export const RELIABILITY_CLASS: Record<string, string> = { primary: 'conf-green', secondary: 'conf-orange', derivative: 'conf-red', unknown: 'conf-grey' }
export const ANALYSIS_STATUS_LABEL: Record<string, string> = { none: 'Non analysé', pending: 'Analyse en attente', queued: 'Analyse en attente', running: 'Analyse en cours', done: 'Analysé', failed: 'Analyse échouée', error: 'Analyse échouée', manual: 'Transcription manuelle' }

export function isImage(mime: string | null | undefined, filename?: string | null): boolean {
  if (mime) return mime.startsWith('image/')
  return /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(filename ?? '')
}

export function initials(given: string | null, surname: string | null, fallback: string): string {
  const g = (given ?? '').trim().charAt(0)
  const s = (surname ?? '').trim().charAt(0)
  const r = (g + s).toUpperCase()
  return r || fallback.trim().charAt(0).toUpperCase() || '?'
}
