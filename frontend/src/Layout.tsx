import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LayoutDashboard, GitFork, Clock, Map, Search, Archive, HelpCircle, MessageSquare, Settings, Maximize2, Minimize2, Wifi, WifiOff, MoreHorizontal, X } from 'lucide-react'
import { useApp, startLiveStream } from './store'
import { api } from './api'

const NAV = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard },
  { to: '/arbre', label: 'Mon arbre', icon: GitFork },
  { to: '/chronologie', label: 'Chronologie', icon: Clock },
  { to: '/carte', label: 'Carte familiale', icon: Map },
  { to: '/enquetes', label: 'Enquêtes IA', icon: Search },
  { to: '/archives', label: 'Archives et documents', icon: Archive },
  { to: '/questions', label: 'Questions', icon: HelpCircle },
  { to: '/assistant', label: 'Assistant IA', icon: MessageSquare },
  { to: '/parametres', label: 'Paramètres', icon: Settings },
]

export default function Layout() {
  const { dashboard, refreshDashboard, refreshSettings, connected, toast } = useApp()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ entity_type: string; entity_id: string; title: string; snippet: string }[]>([])
  const [full, setFull] = useState(false)
  const [more, setMore] = useState(false)
  const MOBILE_MAIN = NAV.filter((n) => ['/', '/arbre', '/enquetes', '/questions'].includes(n.to))
  const MOBILE_MORE = NAV.filter((n) => !['/', '/arbre', '/enquetes', '/questions'].includes(n.to))
  const nav = useNavigate()
  useEffect(() => { refreshSettings(); refreshDashboard(); startLiveStream(); const t = setInterval(refreshDashboard, 20000); return () => clearInterval(t) }, [refreshDashboard, refreshSettings])
  useEffect(() => { if (!query.trim()) { setResults([]); return } const t = setTimeout(() => api.search(query).then(setResults).catch(() => setResults([])), 250); return () => clearTimeout(t) }, [query])
  const toggleFull = () => { if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(() => {}); setFull(true) } else { document.exitFullscreen().catch(() => {}); setFull(false) } }
  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 flex-col bg-night-900 text-ivory-100 lg:flex">
        <div className="px-6 pt-6 pb-4">
          <div className="font-display text-2xl tracking-wide text-ivory-50">GENEALIS <span className="text-gold-500">AI</span></div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-ivory-200/60">Généalogiste numérique</div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${isActive ? 'bg-night-700 text-gold-400' : 'text-ivory-200/80 hover:bg-night-800 hover:text-ivory-50'}`}>
              <Icon size={17} strokeWidth={1.8} />
              <span className="flex-1">{label}</span>
              {to === '/questions' && dashboard && dashboard.questions_pending > 0 && <span className="rounded-full bg-gold-500 px-2 text-[11px] font-semibold text-night-950">{dashboard.questions_pending}</span>}
              {to === '/enquetes' && dashboard && (dashboard.tasks_running + dashboard.tasks_queued) > 0 && <span className="rounded-full bg-sage-500 px-2 text-[11px] font-semibold text-ivory-50">{dashboard.tasks_running + dashboard.tasks_queued}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-4 text-[11px] text-ivory-200/50 flex items-center gap-2">
          {connected ? <Wifi size={12} className="text-sage-400" /> : <WifiOff size={12} className="text-conf-orange" />}
          {connected ? 'Moteur local connecté' : 'Connexion au moteur…'}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-ivory-300/70 bg-ivory-50/80 px-3 py-2.5 backdrop-blur sm:gap-4 sm:px-6 sm:py-3">
          <div className="font-display text-lg text-night-900 lg:hidden">G<span className="text-gold-500">AI</span></div>
          <div className="relative flex-1 max-w-xl">
            <input className="input pl-9" placeholder="Recherche rapide : nom, lieu, source…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }} />
            <Search size={15} className="absolute left-3 top-2.5 text-mist-400" />
            {results.length > 0 && (
              <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-ivory-300 bg-white shadow-xl">
                {results.slice(0, 10).map((r) => (
                  <li key={r.entity_type + r.entity_id}>
                    <button className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-ivory-100" onClick={() => { setQuery(''); nav(r.entity_type === 'person' ? `/personnes/${r.entity_id}` : r.entity_type === 'source' ? `/archives?source=${r.entity_id}` : `/archives?media=${r.entity_id}`) }}>
                      <span className="text-sm font-medium">{r.title}</span>
                      <span className="text-xs text-mist-500">{r.entity_type === 'person' ? 'Personne' : r.entity_type === 'source' ? 'Source' : 'Document'} · {r.snippet}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-mist-500">
            {dashboard && <span className="hidden md:inline">{dashboard.persons} personnes · {dashboard.generations} générations</span>}
            <button className="btn-ghost !px-2 !py-1.5 hidden sm:inline-flex" onClick={toggleFull} title="Plein écran">{full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto scrollbar-thin p-3 pb-20 sm:p-6 lg:pb-6">
          <Outlet />
        </main>
        {/* Barre de navigation mobile */}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-night-700 bg-night-900 text-ivory-200 lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {MOBILE_MAIN.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={() => setMore(false)} className={({ isActive }) => `relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${isActive ? 'text-gold-400' : 'text-ivory-200/70'}`}>
              <Icon size={19} strokeWidth={1.8} />
              <span>{({ '/': 'Accueil', '/arbre': 'Arbre', '/enquetes': 'Enquêtes', '/questions': 'Questions' } as Record<string, string>)[to] ?? label}</span>
              {to === '/questions' && dashboard && dashboard.questions_pending > 0 && <span className="absolute right-1/4 top-1 rounded-full bg-gold-500 px-1.5 text-[10px] font-semibold text-night-950">{dashboard.questions_pending}</span>}
            </NavLink>
          ))}
          <button onClick={() => setMore((v) => !v)} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${more ? 'text-gold-400' : 'text-ivory-200/70'}`}><MoreHorizontal size={19} /><span>Plus</span></button>
        </nav>
        {more && (
          <div className="fixed inset-0 z-50 bg-night-950/60 lg:hidden" onClick={() => setMore(false)}>
            <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-night-900 p-4 text-ivory-100" onClick={(e) => e.stopPropagation()}>
              <div className="mb-2 flex items-center justify-between"><span className="font-display text-lg">Navigation</span><button onClick={() => setMore(false)} className="p-1"><X size={18} /></button></div>
              <div className="grid grid-cols-2 gap-2">
                {MOBILE_MORE.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} onClick={() => setMore(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${isActive ? 'bg-night-700 text-gold-400' : 'bg-night-800 text-ivory-200'}`}><Icon size={17} /> {label}</NavLink>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {toast && <div className={`fixed bottom-5 right-5 z-[100] rounded-xl px-4 py-3 text-sm shadow-xl ${toast.kind === 'error' ? 'bg-conf-red text-white' : toast.kind === 'success' ? 'bg-sage-600 text-white' : 'bg-night-900 text-ivory-50'}`}>{toast.text}</div>}
    </div>
  )
}
