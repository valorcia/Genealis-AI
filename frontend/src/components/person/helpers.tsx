import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { API_BASE, ApiError } from '../../api'

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

/** Âge lisible : « 82 ans (82 a 5 m 12 j) au décès », « ≈ 71 ans au décès », « 45 ans aujourd'hui ». */
export function ageText(p: { age_display?: string | null; age_detail?: string | null; age_context?: string | null }): string | null {
  if (!p.age_display) return null
  return [p.age_display, p.age_detail ? `(${p.age_detail})` : null, p.age_context].filter(Boolean).join(' ')
}

/** Accent violet de la « Recherche IA ». */
export const AI = { color: '#5b3fd6', soft: '#ece6ff', dark: '#3f2aa8' }

/** Pastille ronde avec portrait ou initiales. */
export function Avatar({ p, size = 44 }: { p: { id: string; given_names: string | null; surname: string | null; display_name: string; sex: 'M' | 'F' | null; portrait_media_id?: string | null }; size?: number }) {
  const bg = p.sex === 'F' ? 'bg-[#fde3ee] text-[#b0336b]' : p.sex === 'M' ? 'bg-[#dfeafc] text-[#2f6fd1]' : 'bg-mist-200 text-mist-500'
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) }
  if (p.portrait_media_id) return <img src={`${API_BASE}/api/media/${p.portrait_media_id}/file`} alt="" style={style} className="shrink-0 rounded-full object-cover ring-2 ring-white" />
  return <span style={style} className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-white ${bg}`}>{initials(p.given_names, p.surname, p.display_name)}</span>
}

/**
 * Carte groupée « à la iOS » repliable, avec pastille d'icône colorée (comme MacFamilyTree).
 * `id` sert d'ancre de défilement.
 */
export function GroupCard({ id, title, icon, tint = '#2f6fd1', count, actions, children, defaultOpen = true, className = '' }: {
  id?: string; title: ReactNode; icon?: ReactNode; tint?: string; count?: number; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section id={id} className={`fade-up scroll-mt-20 overflow-hidden rounded-3xl bg-white shadow-[0_1px_2px_rgba(20,40,80,0.06),0_10px_30px_-18px_rgba(20,40,80,0.35)] ring-1 ring-black/5 ${className}`}>
      <header className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open}>
          {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: tint }}>{icon}</span>}
          <span className="min-w-0 truncate text-[17px] font-semibold text-night-900">{title}{count !== undefined && <span className="ml-1 font-normal text-mist-400">({count})</span>}</span>
          <ChevronDown size={17} className={`ml-auto shrink-0 text-mist-400 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  )
}

/** Petit bouton texte bleu iOS. */
export function LinkButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[14px] font-medium text-[#2f6fd1] hover:bg-[#2f6fd1]/10 disabled:opacity-40">{children}</button>
}

/** Mini état vide centré, ton gris. */
export function SoftEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="px-2 py-3 text-center"><div className="text-[15px] font-semibold text-mist-400">{title}</div>{children && <div className="mt-1 text-xs text-mist-400">{children}</div>}</div>
}

/** Rend les feuilles et fenêtres au niveau du document (sinon une carte animée les « emprisonne »). */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
