import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BookOpen, Bot, FileText, LayoutDashboard, LayoutGrid, MessageCircleQuestion, Maximize2, Minimize2, Search, Settings, Sparkles, Star, User, X } from 'lucide-react'
import { useApp, startLiveStream } from './store'
import { api } from './api'
import { SECTIONS, sectionForPath, type Section, type SectionId } from './navigation/sections'
import { SECTION_STYLE } from './navigation/sectionStyle'
import { NamedIcon } from './navigation/icons'
import { Medallion, Monogram, Wordmark } from './components/brand/Brand'

/** Routes qui affichent leur propre barre d'actions (ChartFrame) : pas de barre d'onglets en bas. */
const FRAME_ROUTES = ['/graphiques', '/vues', '/arbre', '/arbre-interactif', '/chronologie', '/carte', '/rapports', '/histoire']
const AI = SECTION_STYLE.recherche.tone

function sectionRoute(s: Section) { return s.id === 'recherche' ? '/section/recherche' : s.id === 'favoris' ? '/favoris' : `/section/${s.id}` }

type SearchHit = { entity_type: string; entity_id: string; title: string; snippet: string }

export default function Layout() {
  const { dashboard, refreshDashboard, refreshSettings, connected, toast } = useApp()
  const location = useLocation()
  const nav = useNavigate()
  const path = location.pathname
  const current = sectionForPath(path)
  const framed = FRAME_ROUTES.some((p) => path.startsWith(p))
  const hub = path.startsWith('/section/') || path.startsWith('/favoris')
  const [searchOpen, setSearchOpen] = useState(false)
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const [full, setFull] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => { refreshSettings(); refreshDashboard(); startLiveStream(); const t = setInterval(refreshDashboard, 20000); return () => clearInterval(t) }, [refreshDashboard, refreshSettings])
  // Retour en haut de page à chaque changement de route (la zone principale défile seule).
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }) }, [path])
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
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFull = () => {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen?.().catch(() => {}) } else { document.exitFullscreen?.().catch(() => {}) }
  }
  const pending = dashboard?.questions_pending ?? 0
  const go = (to: string) => { setChaptersOpen(false); nav(to) }

  return (
    <div className="relative isolate flex h-full overflow-hidden">
      {/* Lavis très léger de la couleur du chapitre, en fondu enchaîné sur le papier. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 print:hidden">
        {SECTIONS.map((s) => (
          <div key={s.id} className="absolute inset-0 transition-opacity duration-700 ease-out" style={{ opacity: s.id === current ? 1 : 0, background: `radial-gradient(70% 45% at 100% 0%, color-mix(in srgb, ${SECTION_STYLE[s.id].tint} 85%, transparent) 0%, transparent 70%)` }} />
        ))}
      </div>

      <Rail current={current} path={path} connected={connected} pending={pending} full={full} onToggleFull={toggleFull} onSearch={() => setSearchOpen(true)} onGo={go} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar connected={connected} onSearch={() => setSearchOpen(true)} onGo={go} path={path} />
        {hub && <ChapterRibbon current={current} onSelect={(s) => go(sectionRoute(s))} />}

        <main ref={mainRef} className={`scrollbar-thin safe-x min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain ${framed ? '' : 'pb-[calc(var(--dock-h)+12px)]'}`}>
          <div className="mx-auto w-full max-w-[1400px] p-3 sm:p-6">
            <Outlet />
          </div>
        </main>
      </div>

      {!framed && <Dock path={path} current={current} pending={pending} chaptersOpen={chaptersOpen} onChapters={() => setChaptersOpen((v) => !v)} onGo={go} />}

      {chaptersOpen && <ChaptersSheet current={current} onClose={() => setChaptersOpen(false)} onGo={(to) => { setChaptersOpen(false); go(to) }} onSearch={() => { setChaptersOpen(false); setSearchOpen(true) }} />}
      {searchOpen && <SearchSheet onClose={() => setSearchOpen(false)} onPick={(to) => { setSearchOpen(false); go(to) }} />}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fade-up fixed z-[100] mx-auto w-fit max-w-[min(92vw,480px)] rounded-xl border px-4 py-3 text-sm font-medium shadow-[0_16px_40px_-14px_rgba(14,24,40,0.55)] ${toast.kind === 'error' ? 'border-white/10 bg-conf-red text-white' : toast.kind === 'success' ? 'border-white/10 bg-sage-600 text-white' : 'border-brass-400/30 bg-night-900 text-ivory-50'}`}
          style={{ left: 'calc(var(--rail-w) + 16px)', right: 16, bottom: framed ? 'calc(var(--safe-bottom) + 92px)' : 'calc(var(--dock-h) + 14px)' }}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Bureau : rail « dos de livre » (bleu nuit, filets dorés)             */
/* ------------------------------------------------------------------ */

function Rail({ current, path, connected, pending, full, onToggleFull, onSearch, onGo }: {
  current: SectionId; path: string; connected: boolean; pending: number; full: boolean; onToggleFull: () => void; onSearch: () => void; onGo: (to: string) => void
}) {
  const aiActive = current === 'recherche' && !path.startsWith('/section/') && !path.startsWith('/questions') && !path.startsWith('/assistant')
  const chapters = SECTIONS.filter((s) => s.id !== 'recherche' && s.id !== 'favoris')
  return (
    <aside
      aria-label="Navigation principale"
      className="relative z-30 hidden h-full w-[var(--rail-w)] shrink-0 flex-col overflow-hidden text-ivory-100 lg:flex print:hidden"
      style={{ background: 'linear-gradient(180deg, #1b2840 0%, #142035 55%, #0f192b 100%)' }}
    >
      {/* Nervures de reliure : doubles filets dorés. */}
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-brass-400/40" />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-[4px] w-px bg-brass-400/15" />
      <span aria-hidden className="pointer-events-none absolute inset-0 opacity-60" style={{ background: 'repeating-linear-gradient(115deg, rgba(255,255,255,0.012) 0 1px, transparent 1px 4px)' }} />

      <div className="relative px-5 pb-4 pt-6">
        <button onClick={() => onGo('/')} className="flex items-center gap-2.5 text-left" aria-label="Genealis — accueil">
          <span className="relative">
            <Monogram size={38} />
            <ConnDot connected={connected} className="absolute -bottom-0.5 -right-0.5 ring-[#172338]" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-display text-[23px] leading-none text-ivory-50" style={{ fontWeight: 560, letterSpacing: '-0.02em' }}>Genealis<span className="ml-[3px] align-super font-sans text-[10px] font-semibold tracking-[0.08em] text-[#b7a6ff]">IA</span></span>
            <span className="eyebrow mt-1.5 !text-[9px] !tracking-[0.24em] text-brass-300/80">Archives de famille</span>
          </span>
        </button>
        <SpineBand className="mt-5" />
        <button onClick={onSearch} className="mt-4 flex w-full items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2 text-left text-[13.5px] text-ivory-200/70 ring-1 ring-white/10 transition-colors hover:bg-white/[0.1]">
          <Search size={15} /> <span className="flex-1">Rechercher…</span>
          <kbd className="rounded-md bg-white/10 px-1.5 py-0.5 font-sans text-[10.5px] text-ivory-200/70">⌘K</kbd>
        </button>
      </div>

      <nav className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <button
          onClick={() => onGo('/')}
          aria-current={aiActive ? 'page' : undefined}
          className="group relative mb-4 flex w-full items-center gap-3 overflow-hidden rounded-2xl px-3 py-3 text-left text-white transition-transform active:scale-[0.98]"
          style={{ background: 'radial-gradient(120% 140% at 100% 0%, #8a72f4 0%, #5b3fd6 45%, #3d2799 100%)', boxShadow: aiActive ? '0 0 0 1.5px #d8ccff, 0 12px 26px -12px rgba(91,63,214,0.9)' : '0 10px 24px -14px rgba(91,63,214,0.9)' }}
        >
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30">
            <Sparkles size={19} strokeWidth={2} />
            <span aria-hidden className="ai-glow absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#e7dfff]" />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold leading-tight">Recherche IA</span>
            <span className="block text-[12px] leading-tight text-white/75">Votre généalogiste au travail</span>
          </span>
        </button>

        <p className="eyebrow mb-1.5 px-3 text-brass-300/70">Chapitres</p>
        <ul className="space-y-0.5">
          <li><RailItem label="Centre de recherche" icon="Sparkles" numeral="I" tone={AI} active={path === '/section/recherche'} onClick={() => onGo('/section/recherche')} /></li>
          {chapters.map((s) => (
            <li key={s.id}>
              <RailItem label={s.label} icon={s.icon} numeral={SECTION_STYLE[s.id].numeral} tone={SECTION_STYLE[s.id].tone} active={current === s.id} onClick={() => onGo(sectionRoute(s))} />
            </li>
          ))}
        </ul>
        <div className="my-3 px-3"><span className="block h-px bg-brass-400/20" /></div>
        <RailItem label="Favoris" icon="Star" numeral="★" tone={SECTION_STYLE.favoris.tone} active={current === 'favoris'} onClick={() => onGo('/favoris')} />
      </nav>

      <div className="relative border-t border-brass-400/20 px-3 pb-4 pt-3">
        <div className="grid grid-cols-4 gap-1">
          <RailTool label={pending > 0 ? `Questions (${pending} en attente)` : 'Questions'} active={path.startsWith('/questions')} onClick={() => onGo('/questions')} badge={pending}>
            <MessageCircleQuestion size={19} />
          </RailTool>
          <RailTool label="Assistant IA" active={path.startsWith('/assistant')} onClick={() => onGo('/assistant')}><Bot size={19} /></RailTool>
          <RailTool label="Paramètres" active={path.startsWith('/parametres')} onClick={() => onGo('/parametres')}><Settings size={19} /></RailTool>
          <RailTool label={full ? 'Quitter le plein écran' : 'Plein écran'} onClick={onToggleFull}>{full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</RailTool>
        </div>
        <p className="mt-2.5 flex items-center gap-2 px-1 text-[11.5px] text-ivory-200/55">
          <ConnDot connected={connected} className="ring-transparent" />
          {connected ? 'Moteur local connecté' : 'Connexion au moteur…'}
        </p>
      </div>
    </aside>
  )
}

/** Bande décorative de reliure (deux filets dorés et un losange). */
function SpineBand({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`flex items-center gap-2 ${className}`}>
      <span className="flex-1 border-y border-brass-400/35 py-[1.5px]" />
      <span className="h-[6px] w-[6px] rotate-45 bg-brass-400/80" />
      <span className="flex-1 border-y border-brass-400/35 py-[1.5px]" />
    </div>
  )
}

function RailItem({ label, icon, numeral, tone, active, onClick }: { label: string; icon: string; numeral: string; tone: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex w-full items-center gap-3 rounded-xl py-2 pl-3 pr-2 text-left transition-colors duration-150 ${active ? 'bg-ivory-50 text-night-900 shadow-[0_8px_20px_-12px_rgba(0,0,0,0.6)]' : 'text-ivory-100/85 hover:bg-white/[0.06] hover:text-ivory-50'}`}
    >
      {/* Signet : ruban de la couleur du chapitre. */}
      {active && <span aria-hidden className="absolute -left-3 top-1.5 bottom-1.5 w-[5px] rounded-r-full" style={{ background: tone }} />}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={active ? { background: `color-mix(in srgb, ${tone} 12%, white)`, color: tone, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone} 25%, transparent)` } : { color: `color-mix(in srgb, ${tone} 45%, #f3ead6)`, background: 'rgba(255,255,255,0.05)' }}>
        <NamedIcon name={icon} size={15} strokeWidth={1.9} className={icon === 'Star' ? 'fill-current' : ''} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{label}</span>
      <span className={`font-display text-[11.5px] ${active ? '' : 'text-brass-300/50'}`} style={active ? { color: tone } : undefined}>{numeral}</span>
    </button>
  )
}

function RailTool({ label, active, onClick, badge = 0, children }: { label: string; active?: boolean; onClick: () => void; badge?: number; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={`relative flex h-10 items-center justify-center rounded-xl transition-colors ${active ? 'bg-ivory-50 text-night-900' : 'text-ivory-100/75 hover:bg-white/[0.07] hover:text-ivory-50'}`}>
      {children}
      {badge > 0 && <Badge n={badge} className="ring-[#142035]" />}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Téléphone / tablette : barre du haut, ruban des chapitres, dock     */
/* ------------------------------------------------------------------ */

function TopBar({ connected, onSearch, onGo, path }: { connected: boolean; onSearch: () => void; onGo: (to: string) => void; path: string }) {
  return (
    <header className="relative z-40 shrink-0 border-b border-[var(--hairline)] bg-[rgb(250_246_237/0.9)] backdrop-blur-xl lg:hidden print:hidden" style={{ paddingTop: 'var(--safe-top)' }}>
      <div className="flex h-[54px] items-center gap-1 pl-[calc(var(--safe-left)+12px)] pr-[calc(var(--safe-right)+8px)] sm:pl-[calc(var(--safe-left)+20px)] sm:pr-[calc(var(--safe-right)+16px)]">
        <button onClick={() => onGo('/')} className="relative mr-auto flex items-center" aria-label="Genealis — accueil">
          <Wordmark size="sm" subtitle={false} />
          <ConnDot connected={connected} className="absolute bottom-0 left-[22px] ring-[#faf6ed]" />
        </button>
        <BarButton label="Recherche rapide" onClick={onSearch}><Search size={20} strokeWidth={2} /></BarButton>
        <BarButton label="Assistant IA" active={path.startsWith('/assistant')} onClick={() => onGo('/assistant')}><Bot size={20} strokeWidth={2} /></BarButton>
        <BarButton label="Paramètres" active={path.startsWith('/parametres')} onClick={() => onGo('/parametres')}><Settings size={20} strokeWidth={2} /></BarButton>
      </div>
    </header>
  )
}

function BarButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors active:scale-95 ${active ? 'bg-night-900 text-ivory-50' : 'text-night-800 hover:bg-black/[0.05]'}`}>
      {children}
    </button>
  )
}

/** Ruban des chapitres (pages de chapitre, téléphone/tablette) : intitulés façon table des matières, signet sous l'actif. */
function ChapterRibbon({ current, onSelect }: { current: SectionId; onSelect: (s: Section) => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [current])
  return (
    <div className="relative z-30 shrink-0 border-b border-[var(--hairline)] bg-[rgb(250_246_237/0.75)] backdrop-blur-xl lg:hidden print:hidden">
      <div ref={scroller} role="tablist" aria-label="Chapitres" className="no-scrollbar flex items-stretch gap-1 overflow-x-auto pl-[calc(var(--safe-left)+8px)] pr-[calc(var(--safe-right)+8px)] sm:pl-[calc(var(--safe-left)+16px)]">
        {SECTIONS.map((s) => {
          const st = SECTION_STYLE[s.id]
          const active = s.id === current
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={active}
              data-active={active}
              onClick={() => onSelect(s)}
              className={`relative flex shrink-0 items-center gap-1.5 px-2.5 pb-2.5 pt-2 text-[13.5px] transition-colors ${active ? 'font-semibold' : 'font-medium text-mist-500'}`}
              style={active ? { color: st.tone } : undefined}
            >
              <span className="font-display text-[11px] opacity-70">{st.numeral}</span>
              {s.id === 'recherche' && <Sparkles size={13} />}
              <span className="whitespace-nowrap">{s.label}</span>
              {active && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full" style={{ background: st.tone }} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Dock du bas (téléphone/tablette) : Recherche IA en bouton central surélevé. */
function Dock({ path, current, pending, chaptersOpen, onChapters, onGo }: { path: string; current: SectionId; pending: number; chaptersOpen: boolean; onChapters: () => void; onGo: (to: string) => void }) {
  const aiActive = path === '/' || (current === 'recherche' && !path.startsWith('/questions') && !path.startsWith('/assistant'))
  return (
    <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-40 lg:hidden print:hidden">
      <div className="relative border-t border-[var(--hairline-strong)] bg-[rgb(250_246_237/0.94)] shadow-[0_-10px_30px_-20px_rgba(40,32,18,0.45)] backdrop-blur-xl" style={{ paddingBottom: 'var(--safe-bottom)' }}>
        <span aria-hidden className="absolute inset-x-0 top-[3px] h-px bg-brass-400/25" />
        <div className="mx-auto grid h-[64px] max-w-xl grid-cols-5 items-stretch pl-[calc(var(--safe-left)+4px)] pr-[calc(var(--safe-right)+4px)]">
          <DockItem label="Favoris" active={current === 'favoris' && !chaptersOpen} onClick={() => onGo('/favoris')}><Star size={21} strokeWidth={1.9} /></DockItem>
          <DockItem label="Livre" active={current === 'livre' && !chaptersOpen} onClick={() => onGo('/section/livre')}><BookOpen size={21} strokeWidth={1.9} /></DockItem>
          <div className="relative flex justify-center">
            <button
              onClick={() => onGo('/')}
              aria-label="Recherche IA"
              aria-current={aiActive ? 'page' : undefined}
              className="absolute -top-[22px] flex flex-col items-center gap-1 transition-transform active:scale-95"
            >
              <span className="relative flex h-[60px] w-[60px] items-center justify-center rounded-full text-white ring-[5px] ring-[#faf6ed]" style={{ background: 'radial-gradient(120% 120% at 30% 20%, #8f78f6 0%, #5b3fd6 50%, #3a2596 100%)', boxShadow: '0 12px 24px -10px rgba(91,63,214,0.9), inset 0 1px 0 rgba(255,255,255,0.35)' }}>
                <Sparkles size={25} strokeWidth={2} />
                {!aiActive && <span aria-hidden className="ai-glow pointer-events-none absolute -inset-[5px] rounded-full ring-2 ring-[#5b3fd6]/30" />}
              </span>
              <span className={`text-[11px] leading-none ${aiActive ? 'font-semibold' : 'font-medium'}`} style={{ color: AI }}>Recherche IA</span>
            </button>
          </div>
          <DockItem label="Questions" active={path.startsWith('/questions') && !chaptersOpen} onClick={() => onGo('/questions')} badge={pending}><MessageCircleQuestion size={21} strokeWidth={1.9} /></DockItem>
          <DockItem label="Chapitres" active={chaptersOpen || (!chaptersOpen && path.startsWith('/section/') && current !== 'livre' && current !== 'recherche')} onClick={onChapters}><LayoutGrid size={21} strokeWidth={1.9} /></DockItem>
        </div>
      </div>
    </nav>
  )
}

function DockItem({ label, active, onClick, badge = 0, children }: { label: string; active: boolean; onClick: () => void; badge?: number; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={badge > 0 ? `${label} (${badge} en attente)` : label} aria-current={active ? 'page' : undefined} className={`relative flex flex-col items-center justify-center gap-1 pt-1 transition-colors active:scale-95 ${active ? 'text-night-900' : 'text-mist-500'}`}>
      {active && <span aria-hidden className="absolute top-[7px] h-[5px] w-[5px] rotate-45 bg-brass-500" />}
      <span className="relative mt-1.5">
        {children}
        {badge > 0 && <Badge n={badge} className="ring-[#faf6ed]" />}
      </span>
      <span className={`text-[11px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>{label}</span>
    </button>
  )
}

/** Sommaire : toutes les catégories et les outils généraux (téléphone/tablette). */
function ChaptersSheet({ current, onClose, onGo, onSearch }: { current: SectionId; onClose: () => void; onGo: (to: string) => void; onSearch: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fade-in fixed inset-0 z-[35] bg-night-950/30 backdrop-blur-[2px] lg:hidden" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sommaire des chapitres"
        className="paper-grain sheet-up absolute inset-x-0 max-h-[78dvh] overflow-y-auto rounded-t-[24px] border-t border-[var(--hairline-strong)] px-4 pb-6 pt-3 shadow-[0_-16px_40px_-16px_rgba(14,24,40,0.5)]"
        style={{ bottom: 'calc(var(--safe-bottom) + 64px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-mist-300" />
        <div className="mb-3 flex items-end justify-between px-1">
          <div>
            <p className="eyebrow text-brass-600">Sommaire</p>
            <h2 className="font-display text-[24px] leading-tight text-night-900">Tous les chapitres</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-mist-500 hover:bg-black/[0.05]" aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SECTIONS.filter((s) => s.id !== 'favoris').map((s) => {
            const st = SECTION_STYLE[s.id]
            const active = s.id === current
            return (
              <button
                key={s.id}
                onClick={() => onGo(sectionRoute(s))}
                className={`relative flex items-center gap-2.5 overflow-hidden rounded-2xl border bg-ivory-50 p-2.5 text-left transition-transform active:scale-[0.98] ${active ? 'border-transparent' : 'border-[var(--hairline)]'}`}
                style={active ? { boxShadow: `inset 0 0 0 1.5px ${st.tone}` } : undefined}
              >
                <Medallion icon={s.icon} color={st.tone} size={38} solid={s.id === 'recherche'} />
                <span className="min-w-0">
                  <span className="font-display block text-[11px] leading-none" style={{ color: st.tone }}>{st.numeral}</span>
                  <span className="mt-0.5 block truncate text-[14.5px] font-semibold leading-tight text-night-900">{s.label}</span>
                </span>
              </button>
            )
          })}
        </div>
        <p className="eyebrow mb-1.5 mt-5 px-1 text-mist-500">Outils</p>
        <div className="divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl border border-[var(--hairline)] bg-ivory-50">
          <SheetRow icon={<Search size={17} />} label="Recherche rapide" hint="Personnes, sources, documents" onClick={onSearch} />
          <SheetRow icon={<Bot size={17} />} label="Assistant IA" hint="Poser une question en langage courant" onClick={() => onGo('/assistant')} />
          <SheetRow icon={<LayoutDashboard size={17} />} label="Tableau de bord" hint="L’état de votre arbre en un coup d’œil" onClick={() => onGo('/tableau-de-bord')} />
          <SheetRow icon={<Settings size={17} />} label="Paramètres" hint="IA, sauvegardes, confidentialité" onClick={() => onGo('/parametres')} />
        </div>
      </div>
    </div>
  )
}

function SheetRow({ icon, label, hint, onClick }: { icon: ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-black/[0.03]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-night-900 text-ivory-50">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-medium text-night-900">{label}</span>
        <span className="block truncate text-[12px] text-mist-500">{hint}</span>
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Communs                                                             */
/* ------------------------------------------------------------------ */

function ConnDot({ connected, className = '' }: { connected: boolean; className?: string }) {
  return (
    <span
      role="img"
      aria-label={connected ? 'Moteur local connecté' : 'Connexion au moteur…'}
      title={connected ? 'Moteur local connecté' : 'Connexion au moteur…'}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ${connected ? 'bg-sage-400' : 'ai-glow bg-conf-orange'} ${className}`}
    />
  )
}

function Badge({ n, className = '' }: { n: number; className?: string }) {
  return <span className={`absolute -right-2 -top-1.5 min-w-[18px] rounded-full bg-conf-red px-1 text-center text-[10.5px] font-semibold leading-[18px] text-white ring-2 ${className}`}>{n > 99 ? '99+' : n}</span>
}

/** Feuille de recherche rapide (personnes, sources, documents). */
function SearchSheet({ onClose, onPick }: { onClose: () => void; onPick: (to: string) => void }) {
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
  const tone = (r: SearchHit) => r.entity_type === 'person' ? SECTION_STYLE.editer.tone : r.entity_type === 'source' ? SECTION_STYLE.rapports.tone : SECTION_STYLE.graphiques.tone
  return (
    <div className="fade-in fixed inset-0 z-[90] bg-night-950/35 backdrop-blur-[2px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Recherche rapide" className="paper-grain sheet-up mx-3 mt-[max(16px,calc(var(--safe-top)+10px))] overflow-hidden rounded-[20px] border border-[var(--hairline-strong)] shadow-[0_24px_60px_-20px_rgba(14,24,40,0.55)] sm:mx-auto sm:mt-24 sm:max-w-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-3">
          <div className="relative flex-1">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
            <input autoFocus className="input !rounded-xl !py-2.5 pl-10 !text-[16px]" placeholder="Nom, lieu, source…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher" />
          </div>
          <button onClick={onClose} className="px-2 text-[15px] font-medium text-night-800">Annuler</button>
        </div>
        {(results.length > 0 || (query.trim() && !loading)) && (
          <ul className="max-h-[60vh] overflow-y-auto border-t border-[var(--hairline)] px-2 pb-2 pt-1">
            {results.slice(0, 20).map((r) => (
              <li key={r.entity_type + r.entity_id}>
                <button className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left hover:bg-black/[0.035] active:scale-[0.99]" onClick={() => onPick(target(r))}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${tone(r)} 12%, #fffdf8)`, color: tone(r), boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tone(r)} 22%, transparent)` }}>
                    {r.entity_type === 'person' ? <User size={17} /> : <FileText size={17} />}
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
        {!query.trim() && <p className="border-t border-[var(--hairline)] px-4 py-3 text-xs text-mist-500">Astuce : ⌘K ou « / » ouvre cette recherche depuis n’importe quelle page.</p>}
      </div>
      <button className="sr-only" onClick={onClose} aria-label="Fermer la recherche"><X /></button>
    </div>
  )
}
