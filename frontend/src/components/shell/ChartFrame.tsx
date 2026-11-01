import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, HelpCircle, Palette, Printer, SlidersHorizontal, User, X } from 'lucide-react'
import type { PersonSummary } from '../../api'

/**
 * Cadre commun des graphiques, vues et rapports (style MacFamilyTree) :
 * en-tête vitré avec retour, titre centré et aide ; zone de contenu ; barre flottante en bas
 * avec choix de la personne centrale, « Actions », style et options.
 */
export default function ChartFrame({
  title, subtitle, color = '#13918c', help, persons, focusId, onFocus, actions, styleOptions, options, children, fullBleed = true,
}: {
  title: string; subtitle?: string; color?: string; help?: ReactNode
  persons?: PersonSummary[]; focusId?: string | null; onFocus?: (id: string) => void
  actions?: ReactNode; styleOptions?: ReactNode; options?: ReactNode; children: ReactNode; fullBleed?: boolean
}) {
  const nav = useNavigate()
  const [panel, setPanel] = useState<null | 'person' | 'actions' | 'style' | 'options' | 'help'>(null)
  const [q, setQ] = useState('')
  const filtered = (persons ?? []).filter((p) => !q || p.display_name.toLowerCase().includes(q.toLowerCase())).slice(0, 200)
  const toggle = (k: typeof panel) => setPanel((p) => (p === k ? null : k))
  return (
    <div className={`relative flex min-h-[calc(100dvh-140px)] flex-col ${fullBleed ? '-mx-3 -my-3 sm:-mx-6 sm:-my-6' : ''}`}>
      <header className="sticky top-0 z-30 mx-2 mt-2 flex items-center gap-2 rounded-3xl border border-white/70 bg-white/75 px-3 py-2.5 shadow-[0_8px_30px_-12px_rgba(20,40,80,0.35)] backdrop-blur-xl sm:mx-4">
        <button onClick={() => nav(-1)} className="rounded-full p-1.5 hover:bg-black/5" aria-label="Retour" style={{ color }}><ChevronLeft size={26} strokeWidth={2.4} /></button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate text-lg font-semibold sm:text-xl" style={{ color }}>{title}</h1>
          {subtitle && <p className="truncate text-xs text-mist-500">{subtitle}</p>}
        </div>
        <button onClick={() => toggle('help')} className="rounded-full p-1.5 hover:bg-black/5" aria-label="Aide" style={{ color }}><HelpCircle size={24} strokeWidth={2.2} /></button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-auto px-2 pb-28 pt-3 sm:px-4">{children}</div>

      {panel && panel !== 'help' && (
        <div className="fixed inset-x-2 bottom-24 z-40 mx-auto max-h-[55vh] max-w-xl overflow-auto rounded-3xl border border-white/70 bg-white/90 p-4 shadow-2xl backdrop-blur-xl sm:bottom-28">
          <div className="mb-2 flex items-center justify-between"><span className="font-semibold" style={{ color }}>{{ person: 'Personne centrale', actions: 'Actions', style: 'Style', options: 'Options' }[panel]}</span><button onClick={() => setPanel(null)} className="rounded-full bg-black/5 p-1"><X size={15} /></button></div>
          {panel === 'person' && (
            <div>
              <input className="input mb-2" placeholder="Rechercher une personne…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              <div className="divide-y divide-black/5 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5">
                {filtered.map((p) => (
                  <button key={p.id} onClick={() => { onFocus?.(p.id); setPanel(null) }} className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-black/[0.03] ${p.id === focusId ? 'font-semibold' : ''}`}>
                    <span>{p.display_name}{p.is_root ? ' ★' : ''}</span><span className="text-xs text-mist-500">{p.birth_year ?? '?'}–{p.death_year ?? ''}</span>
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
      {panel === 'help' && help && (
        <div className="fixed inset-x-2 top-24 z-40 mx-auto max-w-xl rounded-3xl bg-white/95 p-4 text-sm shadow-2xl backdrop-blur-xl" onClick={() => setPanel(null)}>{help}</div>
      )}

      <nav className="fixed inset-x-2 bottom-3 z-40 mx-auto flex max-w-3xl items-center justify-between rounded-3xl border border-white/70 bg-white/80 px-4 py-2.5 shadow-[0_10px_40px_-12px_rgba(20,40,80,0.45)] backdrop-blur-xl print:hidden" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex w-1/3 items-center">{onFocus && <button onClick={() => toggle('person')} className="rounded-full p-1.5 hover:bg-black/5" style={{ color }} aria-label="Changer de personne"><User size={26} fill="currentColor" /></button>}</div>
        <button onClick={() => toggle('actions')} className="text-lg font-medium" style={{ color }}>Actions</button>
        <div className="flex w-1/3 items-center justify-end gap-3">
          {styleOptions && <button onClick={() => toggle('style')} className="rounded-full p-1.5 hover:bg-black/5" style={{ color }} aria-label="Style"><Palette size={24} /></button>}
          {options && <button onClick={() => toggle('options')} className="rounded-full p-1.5 hover:bg-black/5" style={{ color }} aria-label="Options"><SlidersHorizontal size={24} /></button>}
        </div>
      </nav>
    </div>
  )
}
