import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bot, FileText, MessageCircleQuestion, Maximize2, Minimize2, Search, Settings, Sparkles, User, X } from 'lucide-react'
import { useApp, startLiveStream } from './store'
import { api } from './api'
import { SECTIONS, SECTION_BY_ID, sectionForPath, type Section } from './navigation/sections'
import { NamedIcon } from './navigation/icons'

/** Routes qui affichent leur propre barre flottante (ChartFrame) : pas de barre d'outils globale. */
const FRAME_ROUTES = ['/graphiques', '/vues', '/arbre', '/arbre-interactif', '/chronologie', '/carte', '/rapports', '/histoire']
const VIOLET = SECTION_BY_ID.recherche.color

function sectionRoute(s: Section) { return s.id === 'recherche' ? '/' : s.id === 'favoris' ? '/favoris' : `/section/${s.id}` }

type SearchHit = { entity_type: string; entity_id: string; title: string; snippet: string }

export default function Layout() {
  const { dashboard, refreshDashboard, refreshSettings, connected, toast } = useApp()
  const location = useLocation()
  const nav = useNavigate()
  const current = sectionForPath(location.pathname)
  const section = SECTION_BY_ID[current] ?? SECTION_BY_ID.recherche
  const framed = FRAME_ROUTES.some((p) => location.pathname.startsWith(p))
  const [searchOpen, setSearchOpen] = useState(false)
  const [full, setFull] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => { refreshSettings(); refreshDashboard(); startLiveStream(); const t = setInterval(refreshDashboard, 20000); return () => clearInterval(t) }, [refreshDashboard, refreshSettings])
  // Retour en haut de page à chaque changement de route (la zone principale défile seule).
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }) }, [location.pathname])
  // Raccourcis clavier : ⌘K / Ctrl+K ou « / » ouvrent la recherche rapide.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if ((e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); setSearchOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleFull = () => {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen?.().catch(() => {}); setFull(true) } else { document.exitFullscreen?.().catch(() => {}); setFull(false) }
  }
  const pending = dashboard?.questions_pending ?? 0

  return (
    <div className="relative isolate flex h-full flex-col overflow-hidden">
      {/* Fonds dégradés : un calque par catégorie, fondu enchaîné à l'ouverture d'une autre catégorie. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        {SECTIONS.map((s) => (
          <div key={s.id} className="absolute inset-0 transition-opacity duration-700 ease-out" style={{ opacity: s.id === current ? 1 : 0, background: `linear-gradient(180deg, ${s.gradient[0]} 0%, ${s.gradient[1]} 100%)` }} />
        ))}
        <div className="absolute inset-x-0 top-0 h-[55vh]" style={{ background: 'radial-gradient(120% 70% at 50% 0%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 70%)' }} />
      </div>

      <CategoryBar current={current} compact={framed} connected={connected} onSelect={(s) => nav(sectionRoute(s))} />

      <main ref={mainRef} className={`scrollbar-thin safe-x min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain ${framed ? '' : 'pb-[calc(var(--safe-bottom)+92px)]'}`}>
        <div className="mx-auto w-full max-w-[1400px] p-3 sm:p-6">
          <Outlet />
        </div>
      </main>

      {!framed && (
        <nav aria-label="Barre d’outils" className="glass fixed inset-x-3 z-40 mx-auto flex max-w-3xl items-center gap-1 rounded-[26px] px-2.5 py-2 print:hidden" style={{ bottom: 'calc(var(--safe-bottom) + 10px)' }}>
          <ToolButton label="Recherche rapide" color={section.color} onClick={() => setSearchOpen(true)}><Search size={22} strokeWidth={2.2} /></ToolButton>
          <ToolButton label={pending > 0 ? `Questions (${pending} en attente)` : 'Questions'} color={section.color} onClick={() => nav('/questions')} active={location.pathname.startsWith('/questions')}>
            <MessageCircleQuestion size={22} strokeWidth={2.2} />
            {pending > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[#ff3b30] px-1 text-center text-[11px] font-semibold leading-[18px] text-white shadow-sm ring-2 ring-white">{pending > 99 ? '99+' : pending}</span>}
          </ToolButton>
          <ToolButton label="Assistant IA" color={section.color} onClick={() => nav('/assistant')} active={location.pathname.startsWith('/assistant')}><Bot size={22} strokeWidth={2.2} /></ToolButton>
          <ToolButton label="Paramètres" color={section.color} onClick={() => nav('/parametres')} active={location.pathname.startsWith('/parametres')}><Settings size={22} strokeWidth={2.2} /></ToolButton>
          <span className="hidden sm:inline-flex">
            <ToolButton label={full ? 'Quitter le plein écran' : 'Plein écran'} color={section.color} onClick={toggleFull}>{full ? <Minimize2 size={20} strokeWidth={2.2} /> : <Maximize2 size={20} strokeWidth={2.2} />}</ToolButton>
          </span>
          <button
            onClick={() => nav('/')}
            aria-label="Recherche IA : centre de recherche"
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-[15px] font-semibold text-white transition-transform duration-150 active:scale-95"
            style={{ background: `linear-gradient(135deg, #7a5cf0 0%, ${VIOLET} 55%, #4529b8 100%)`, boxShadow: '0 8px 20px -8px rgba(91,63,214,0.85), inset 0 1px 0 rgba(255,255,255,0.3)' }}
          >
            <Sparkles size={17} strokeWidth={2.3} /> Recherche IA
          </button>
        </nav>
      )}

      {searchOpen && <SearchSheet color={section.color} onClose={() => setSearchOpen(false)} onPick={(to) => { setSearchOpen(false); nav(to) }} />}

      {toast && (
        <div role="status" aria-live="polite" className={`fade-up fixed inset-x-4 z-[100] mx-auto w-fit max-w-[min(92vw,480px)] rounded-2xl px-4 py-3 text-sm font-medium shadow-[0_16px_40px_-14px_rgba(28,35,51,0.5)] ${toast.kind === 'error' ? 'bg-conf-red text-white' : toast.kind === 'success' ? 'bg-sage-500 text-white' : 'bg-night-900 text-white'}`} style={{ bottom: `calc(var(--safe-bottom) + ${framed ? 92 : 86}px)` }}>
          {toast.text}
        </div>
      )}
    </div>
  )
}

function ToolButton({ label, color, onClick, active, children }: { label: string; color: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform duration-150 hover:bg-black/[0.05] active:scale-90" style={{ color, background: active ? `color-mix(in srgb, ${color} 14%, transparent)` : undefined }}>
      {children}
    </button>
  )
}

/** Barre de catégories façon MacFamilyTree : onglets colorés dans un conteneur vitré. */
function CategoryBar({ current, compact, connected, onSelect }: { current: string; compact: boolean; connected: boolean; onSelect: (s: Section) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [current])
  return (
    <header className="relative z-40 shrink-0 px-3 pb-1 sm:px-6 print:hidden" style={{ paddingTop: 'max(10px, calc(var(--safe-top) + 6px))' }}>
      <div className="glass relative mx-auto w-fit max-w-full rounded-[28px] p-1.5">
        <div ref={scroller} role="tablist" aria-label="Catégories" className="no-scrollbar flex items-stretch gap-1.5 overflow-x-auto overscroll-x-contain rounded-[22px]">
          {SECTIONS.map((s) => {
            const active = s.id === current
            const ai = s.id === 'recherche'
            const bg = active
              ? (ai ? `linear-gradient(160deg, #8064f2 0%, ${s.color} 55%, #4428b6 100%)` : `linear-gradient(180deg, color-mix(in srgb, ${s.color} 82%, white) 0%, ${s.color} 100%)`)
              : (ai ? 'linear-gradient(160deg, #f6f2ff 0%, #e9e1ff 100%)' : `linear-gradient(180deg, #ffffff 0%, color-mix(in srgb, ${s.color} 7%, white) 100%)`)
            const shadow = active
              ? `0 8px 18px -8px color-mix(in srgb, ${s.color} 80%, transparent), inset 0 1px 0 rgba(255,255,255,0.28)`
              : ai ? `0 0 0 1px color-mix(in srgb, ${s.color} 28%, transparent), 0 6px 16px -10px ${s.color}` : '0 1px 2px rgba(28,35,51,0.08)'
            return (
              <div key={s.id} className="flex shrink-0 items-stretch gap-1.5">
                <button
                  role="tab"
                  aria-selected={active}
                  aria-label={s.label}
                  data-active={active}
                  onClick={() => onSelect(s)}
                  className={`relative flex shrink-0 items-center justify-center rounded-[18px] transition-transform duration-150 active:scale-95 ${compact ? 'gap-1.5 px-3 py-2' : `flex-col gap-0.5 px-2 pt-2 pb-1.5 sm:gap-1 sm:px-3 sm:pt-2.5 sm:pb-2 ${ai ? 'min-w-[84px] sm:min-w-[116px]' : 'min-w-[64px] sm:min-w-[100px]'}`}`}
                  style={{ background: bg, boxShadow: shadow, color: active ? '#fff' : s.color }}
                >
                  {ai && !active && <span aria-hidden className="ai-glow pointer-events-none absolute inset-0 rounded-[18px]" style={{ boxShadow: `0 0 18px -2px color-mix(in srgb, ${s.color} 45%, transparent)` }} />}
                  <span className="relative">
                    <NamedIcon name={s.icon} size={compact ? 17 : 25} strokeWidth={active ? 2.3 : 2.1} className={`${compact ? '' : 'sm:h-[30px] sm:w-[30px]'} ${s.id === 'favoris' ? 'fill-current' : ''}`} />
                    {ai && <span aria-hidden className={`absolute -right-1.5 -top-1 h-1.5 w-1.5 rounded-full ${active ? 'bg-white' : ''}`} style={active ? undefined : { background: s.color }} />}
                  </span>
                  <span className={`whitespace-nowrap leading-tight ${compact ? 'text-[13px] font-semibold' : `text-[11.5px] sm:text-[14px] ${ai ? 'font-semibold' : 'font-medium'}`}`}>{s.label}</span>
                </button>
                {ai && <span aria-hidden className="my-2 w-px shrink-0 bg-black/10" />}
              </div>
            )
          })}
        </div>
        <span
          role="img"
          aria-label={connected ? 'Moteur local connecté' : 'Connexion au moteur…'}
          title={connected ? 'Moteur local connecté' : 'Connexion au moteur…'}
          className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${connected ? 'bg-sage-500' : 'bg-conf-orange ai-glow'}`}
        />
      </div>
    </header>
  )
}

/** Feuille de recherche rapide (personnes, sources, documents). */
function SearchSheet({ color, onClose, onPick }: { color: string; onClose: () => void; onPick: (to: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!query.trim()) { setResults([]); setLoading(false); return }
    setLoading(true)
    const t = setTimeout(() => api.search(query).then(setResults).catch(() => setResults([])).finally(() => setLoading(false)), 220)
    return () => clearTimeout(t)
  }, [query])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const target = (r: SearchHit) => r.entity_type === 'person' ? `/personnes/${r.entity_id}` : r.entity_type === 'source' ? `/archives?source=${r.entity_id}` : `/archives?media=${r.entity_id}`
  const kind = (r: SearchHit) => r.entity_type === 'person' ? 'Personne' : r.entity_type === 'source' ? 'Source' : 'Document'
  return (
    <div className="fade-in fixed inset-0 z-[90] bg-night-950/25 backdrop-blur-[2px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Recherche rapide" className="glass sheet-up mx-3 mt-[max(16px,calc(var(--safe-top)+10px))] overflow-hidden rounded-[26px] !bg-white/90 sm:mx-auto sm:mt-24 sm:max-w-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-3">
          <div className="relative flex-1">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
            <input autoFocus className="input !rounded-2xl !border-transparent !bg-black/[0.05] !py-2.5 pl-10 !text-[16px] !shadow-none" placeholder="Nom, lieu, source…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher" />
          </div>
          <button onClick={onClose} className="px-2 text-[16px] font-medium" style={{ color }}>Annuler</button>
        </div>
        {(results.length > 0 || (query.trim() && !loading)) && (
          <ul className="max-h-[60vh] overflow-y-auto border-t border-black/5 px-2 pb-2">
            {results.slice(0, 20).map((r) => (
              <li key={r.entity_type + r.entity_id}>
                <button className="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-transform hover:bg-black/[0.04] active:scale-[0.99]" onClick={() => onPick(target(r))}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: r.entity_type === 'person' ? '#2f6fd1' : r.entity_type === 'source' ? '#c4651a' : '#13918c' }}>
                    {r.entity_type === 'person' ? <User size={18} /> : <FileText size={18} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-night-900">{r.title}</span>
                    <span className="block truncate text-xs text-mist-500">{kind(r)}{r.snippet ? ` · ${r.snippet}` : ''}</span>
                  </span>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-mist-500">Aucun résultat pour « {query} ».</li>}
          </ul>
        )}
        {!query.trim() && <p className="border-t border-black/5 px-4 py-3 text-xs text-mist-500">Astuce : ⌘K ou « / » ouvre cette recherche depuis n’importe quelle page.</p>}
      </div>
      <button className="sr-only" onClick={onClose} aria-label="Fermer la recherche"><X /></button>
    </div>
  )
}
