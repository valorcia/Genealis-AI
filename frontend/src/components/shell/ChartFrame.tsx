import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, HelpCircle, Palette, Printer, SlidersHorizontal, User, Wand2, X } from 'lucide-react'
import type { PersonSummary } from '../../api'
import { SECTION_BY_ID, sectionForPath } from '../../navigation/sections'
import { SECTION_STYLE, toneForColor } from '../../navigation/sectionStyle'

type PanelKey = 'person' | 'actions' | 'style' | 'options' | 'help'
const PANEL_TITLE: Record<Exclude<PanelKey, 'help'>, string> = { person: 'Personne centrale', actions: 'Actions', style: 'Style', options: 'Options' }

/**
 * Cadre commun des graphiques, vues et rapports (identité GENEALIS « archive ») :
 * en-tête papier avec retour, accroche du chapitre, titre serif souligné d'or et aide ;
 * zone de contenu ; barre d'actions bleu nuit en bas (personne centrale, actions, style, options).
 */
export default function ChartFrame({
  title, subtitle, color = '#13918c', help, persons, focusId, onFocus, actions, styleOptions, options, children, fullBleed = true,
}: {
  title: string; subtitle?: string; color?: string; help?: ReactNode
  persons?: PersonSummary[]; focusId?: string | null; onFocus?: (id: string) => void
  actions?: ReactNode; styleOptions?: ReactNode; options?: ReactNode; children: ReactNode; fullBleed?: boolean
}) {
  const nav = useNavigate()
  const location = useLocation()
  const sectionId = sectionForPath(location.pathname)
  const chapter = SECTION_BY_ID[sectionId]
  const tone = toneForColor(color)
  const [panel, setPanel] = useState<null | PanelKey>(null)
  const [q, setQ] = useState('')
  const filtered = (persons ?? []).filter((p) => !q || p.display_name.toLowerCase().includes(q.toLowerCase())).slice(0, 200)
  const toggle = (k: PanelKey) => setPanel((p) => (p === k ? null : k))
  const focused = (persons ?? []).find((p) => p.id === focusId)

  return (
    <div className={`relative flex min-h-[calc(100dvh-var(--top-h))] flex-col ${fullBleed ? '-mx-3 -my-3 sm:-mx-6 sm:-my-6' : ''}`}>
      <header className="sticky top-0 z-30 border-b border-[var(--hairline)] bg-[rgb(250_246_237/0.92)] backdrop-blur-xl print:static print:bg-transparent">
        <div className="flex items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3.5">
          <button onClick={() => nav(-1)} className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-full border border-[var(--hairline-strong)] bg-ivory-50 pl-1.5 pr-2.5 text-[13px] font-medium text-night-800 transition-colors hover:bg-white active:scale-95 print:hidden" aria-label="Retour">
            <ChevronLeft size={18} strokeWidth={2.2} /> <span className="hidden sm:inline">Retour</span>
          </button>
          <div className="relative min-w-0 flex-1">
            <p className="eyebrow truncate !text-[10px]" style={{ color: tone }}>
              <span className="font-display normal-case tracking-normal">{SECTION_STYLE[sectionId].numeral}</span>
              <span className="mx-1.5 opacity-50">·</span>{chapter.label}
              {focused && <span className="hidden normal-case tracking-normal text-mist-500 sm:inline"><span className="mx-1.5 opacity-50">·</span>{focused.display_name}</span>}
            </p>
            <h1 className="font-display truncate text-[20px] leading-tight text-night-900 sm:text-[26px]" style={{ fontWeight: 540 }}>{title}</h1>
            {subtitle && <p className="truncate text-[12.5px] text-mist-500">{subtitle}</p>}
          </div>
          {help && (
            <button onClick={() => toggle('help')} aria-expanded={panel === 'help'} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors print:hidden ${panel === 'help' ? 'border-night-900 bg-night-900 text-ivory-50' : 'border-[var(--hairline-strong)] bg-ivory-50 text-night-800 hover:bg-white'}`} aria-label="Aide">
              <HelpCircle size={18} strokeWidth={2} />
            </button>
          )}
        </div>
        {/* Soulignement doré, aligné sur le titre. */}
        <span aria-hidden className="absolute -bottom-px left-[60px] h-[2px] w-14 bg-brass-400 sm:left-[124px]" />
        {panel === 'help' && help && (
          <div className="paper-grain fade-up absolute inset-x-2 top-full z-40 mx-auto mt-2 max-w-xl rounded-2xl border border-[var(--hairline-strong)] p-4 text-sm text-night-800 shadow-[0_20px_40px_-18px_rgba(14,24,40,0.5)] sm:inset-x-6" onClick={() => setPanel(null)}>
            <p className="eyebrow mb-1.5 text-brass-600">Comment lire ce graphique</p>
            {help}
          </div>
        )}
      </header>

      <div className="relative min-h-0 flex-1 overflow-auto px-2 pb-[calc(var(--safe-bottom)+100px)] pt-3 sm:px-4">{children}</div>

      {panel && panel !== 'help' && (
        <div
          className="paper-grain sheet-up fixed z-40 mx-auto max-h-[55vh] max-w-xl overflow-auto rounded-2xl border border-[var(--hairline-strong)] p-4 shadow-[0_24px_50px_-20px_rgba(14,24,40,0.55)]"
          style={{ left: 'calc(var(--rail-w) + 10px)', right: 10, bottom: 'calc(var(--safe-bottom) + 88px)' }}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow !text-[10px]" style={{ color: tone }}>{title}</p>
              <h2 className="font-display text-[20px] leading-tight text-night-900">{PANEL_TITLE[panel]}</h2>
            </div>
            <button onClick={() => setPanel(null)} className="rounded-full p-1.5 text-mist-500 hover:bg-black/[0.05]" aria-label="Fermer"><X size={16} /></button>
          </div>
          {panel === 'person' && (
            <div>
              <input className="input mb-2" placeholder="Rechercher une personne…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              <div className="divide-y divide-[var(--hairline)] overflow-hidden rounded-xl border border-[var(--hairline)] bg-ivory-50">
                {filtered.map((p) => (
                  <button key={p.id} onClick={() => { onFocus?.(p.id); setPanel(null) }} className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-black/[0.025] ${p.id === focusId ? 'font-semibold' : ''}`} style={p.id === focusId ? { color: tone } : undefined}>
                    <span className="truncate">{p.display_name}{p.is_root ? ' ★' : ''}</span><span className="shrink-0 text-xs text-mist-500">{p.birth_year ?? '?'}–{p.death_year ?? ''}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {panel === 'actions' && (actions ?? <button className="btn-ghost" onClick={() => window.print()}><Printer size={15} /> Imprimer / PDF</button>)}
          {panel === 'style' && styleOptions}
          {panel === 'options' && options}
        </div>
      )}

      <nav
        aria-label="Actions du graphique"
        className="fixed z-40 mx-auto flex max-w-[520px] items-stretch gap-1 rounded-2xl border border-brass-400/30 p-1.5 shadow-[0_18px_40px_-16px_rgba(14,24,40,0.7)] print:hidden"
        style={{ left: 'calc(var(--rail-w) + 12px)', right: 12, bottom: 'calc(var(--safe-bottom) + 12px)', background: 'linear-gradient(180deg, #1d2b44 0%, #131f33 100%)' }}
      >
        {onFocus && <BarItem label="Personne" active={panel === 'person'} onClick={() => toggle('person')}><User size={19} /></BarItem>}
        <BarItem label="Actions" primary active={panel === 'actions'} onClick={() => toggle('actions')}><Wand2 size={18} /></BarItem>
        {styleOptions && <BarItem label="Style" active={panel === 'style'} onClick={() => toggle('style')}><Palette size={19} /></BarItem>}
        {options && <BarItem label="Options" active={panel === 'options'} onClick={() => toggle('options')}><SlidersHorizontal size={19} /></BarItem>}
      </nav>
    </div>
  )
}

function BarItem({ label, active, primary, onClick, children }: { label: string; active: boolean; primary?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-medium transition-colors active:scale-95 sm:flex-row sm:gap-2 sm:py-2.5 sm:text-[13.5px] ${active ? 'bg-ivory-50 text-night-900' : primary ? 'text-[#ecd9a6] ring-1 ring-inset ring-brass-400/40 hover:bg-white/[0.06]' : 'text-ivory-100/80 hover:bg-white/[0.06] hover:text-ivory-50'}`}
    >
      {children}
      <span className="leading-none">{label}</span>
    </button>
  )
}
