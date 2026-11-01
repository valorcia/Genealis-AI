import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, HelpCircle, Search, X } from 'lucide-react'

/**
 * Cadre des listes et des pages de publication (style iOS) : en-tête vitré collant avec retour,
 * titre centré, aide, puis champ de recherche et barre d'outils (tri, filtres) qui restent visibles au défilement.
 */
export function PageFrame({ title, subtitle, color, help, search, onSearch, searchPlaceholder = 'Rechercher', autoFocus = false, toolbar, children, wide = false }: {
  title: string; subtitle?: ReactNode; color: string; help?: ReactNode
  search?: string; onSearch?: (v: string) => void; searchPlaceholder?: string; autoFocus?: boolean
  toolbar?: ReactNode; children: ReactNode; wide?: boolean
}) {
  const nav = useNavigate()
  const [showHelp, setShowHelp] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (autoFocus) setTimeout(() => input.current?.focus(), 50) }, [autoFocus])
  return (
    <div className={`mx-auto w-full ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>
      <div className="sticky top-0 z-30 -mx-1 px-1 pb-2 pt-0.5">
        <header className="rounded-[24px] border border-white/70 bg-white/80 px-3 py-2.5 shadow-[0_8px_30px_-12px_rgba(20,40,80,0.35)] backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <button onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))} className="rounded-full p-1.5 hover:bg-black/5" aria-label="Retour" style={{ color }}><ChevronLeft size={26} strokeWidth={2.4} /></button>
            <div className="min-w-0 flex-1 text-center">
              <h1 className="truncate text-lg font-semibold sm:text-xl" style={{ color }}>{title}</h1>
              {subtitle && <p className="truncate text-xs text-mist-500">{subtitle}</p>}
            </div>
            {help ? <button onClick={() => setShowHelp((v) => !v)} className="rounded-full p-1.5 hover:bg-black/5" aria-label="Aide" style={{ color }}><HelpCircle size={24} strokeWidth={2.2} /></button> : <span className="w-9" />}
          </div>
          {onSearch && (
            <div className="relative mt-2">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
              <input ref={input} type="search" inputMode="search" enterKeyHint="search" value={search ?? ''} onChange={(e) => onSearch(e.target.value)} placeholder={searchPlaceholder}
                className="w-full rounded-xl border-0 bg-black/[0.06] py-2 pl-9 pr-8 text-[15px] text-night-900 outline-none placeholder:text-mist-400 focus:bg-black/[0.08] [&::-webkit-search-cancel-button]:hidden" />
              {search && <button onClick={() => onSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-mist-400 p-0.5 text-white" aria-label="Effacer"><X size={12} strokeWidth={3} /></button>}
            </div>
          )}
          {toolbar && <div className="mt-2">{toolbar}</div>}
        </header>
        {showHelp && help && (
          <div className="fade-up mt-2 rounded-[22px] bg-white/95 p-4 text-sm shadow-xl backdrop-blur-xl" onClick={() => setShowHelp(false)}>{help}</div>
        )}
      </div>
      {children}
    </div>
  )
}

/** Section de liste groupée iOS : petit titre gris + carte blanche arrondie. */
export function Group({ title, id, children, footer, right }: { title?: ReactNode; id?: string; children: ReactNode; footer?: ReactNode; right?: ReactNode }) {
  return (
    <section id={id} className="mb-4 scroll-mt-40">
      {(title || right) && (
        <div className="mb-1.5 flex items-end justify-between px-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-mist-500">{title}</h2>
          {right}
        </div>
      )}
      <div className="overflow-hidden rounded-[20px] bg-white shadow-[0_4px_18px_-10px_rgba(20,40,80,0.25)] ring-1 ring-black/[0.04]">
        <ul className="divide-y divide-black/[0.06]">{children}</ul>
      </div>
      {footer && <p className="mt-1.5 px-4 text-xs text-mist-500">{footer}</p>}
    </section>
  )
}

/** Ligne de liste iOS (lien, bouton ou statique). */
export function Row({ to, onClick, left, title, subtitle, right, chevron = !!(to || onClick), children }: {
  to?: string; onClick?: () => void; left?: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; chevron?: boolean; children?: ReactNode
}) {
  const inner = (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      {left}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-night-900">{title}</div>
        {subtitle && <div className="truncate text-[13px] text-mist-500">{subtitle}</div>}
        {children}
      </div>
      {right && <div className="shrink-0 text-right text-[13px] text-mist-500">{right}</div>}
      {chevron && <ChevronRight size={18} className="shrink-0 text-mist-300" />}
    </div>
  )
  if (to) return <li><Link to={to} className="block transition-colors active:bg-black/[0.04] hover:bg-black/[0.02]">{inner}</Link></li>
  if (onClick) return <li><button onClick={onClick} className="block w-full text-left transition-colors active:bg-black/[0.04] hover:bg-black/[0.02]">{inner}</button></li>
  return <li>{inner}</li>
}

/** Index alphabétique vertical (comme Contacts sur iPhone) : toucher ou glisser pour sauter à une lettre. */
export function SectionIndex({ letters, color, onJump }: { letters: string[]; color: string; onJump: (l: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const last = useRef('')
  if (letters.length < 4) return null
  const pick = (y: number) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const i = Math.max(0, Math.min(letters.length - 1, Math.floor(((y - r.top) / r.height) * letters.length)))
    if (letters[i] !== last.current) { last.current = letters[i]; onJump(letters[i]) }
  }
  return (
    <div ref={ref} role="navigation" aria-label="Index alphabétique"
      className="fixed right-0.5 top-1/2 z-30 flex -translate-y-1/2 touch-none select-none flex-col items-center rounded-full bg-white/50 px-1 py-1.5 backdrop-blur sm:right-2"
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); last.current = ''; pick(e.clientY) }}
      onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') pick(e.clientY) }}>
      {letters.map((l) => <span key={l} className="px-1 text-[11px] font-semibold leading-[15px]" style={{ color }}>{l}</span>)}
    </div>
  )
}

/** Puce de filtre. */
export function Chip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: ReactNode; color: string }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition ${active ? 'text-white shadow-sm' : 'bg-black/[0.05] text-night-900'}`} style={active ? { background: color } : undefined}>{children}</button>
  )
}
export function ChipBar({ children }: { children: ReactNode }) {
  return <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">{children}</div>
}
