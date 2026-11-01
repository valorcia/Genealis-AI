/** Centre d'investigation : tableau de bord des enquêtes autonomes, liste des enquêtes, lancement, état du navigateur local. */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ChevronRight, Clock, Coins, FileSearch, FileText, GitBranch, Lightbulb, Radar, Rocket, ScrollText, Search, Settings2, Sparkles, Users,
} from 'lucide-react'
import { AI, errMsg } from '../components/person/helpers'
import { LaunchInvestigationModal } from '../components/investigation/LaunchInvestigation'
import { Loading, Notice, NotYetAvailable, StatusBadge, WorkerCard, formatDuration, relTime } from '../components/investigation/common'
import {
  ACTIVE_STATUSES, COST_MODE_LABEL, ZERO_STATS, investigationApi, isUnavailable,
  type InvestigationDashboard, type InvestigationOut, type WorkerInfo, type WorkerStatus,
} from '../lib/investigationApi'
import { costsApi, formatUsd } from '../lib/costsApi'

type Load<T> = { data: T | null; missing: boolean; error: string | null }
const empty = <T,>(): Load<T> => ({ data: null, missing: false, error: null })

export default function InvestigationCenterPage() {
  const [params, setParams] = useSearchParams()
  const presetPerson = params.get('person')
  const [launch, setLaunch] = useState<boolean>(Boolean(presetPerson))
  const [dash, setDash] = useState<Load<InvestigationDashboard>>(empty)
  const [list, setList] = useState<Load<InvestigationOut[]>>(empty)
  const [worker, setWorker] = useState<{ data: WorkerStatus | null; missing: boolean }>({ data: null, missing: false })
  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const [pricesKnown, setPricesKnown] = useState<boolean | null>(null)

  const load = useCallback(() => {
    investigationApi.dashboard().then((d) => setDash({ data: d, missing: false, error: null }))
      .catch((e: unknown) => setDash({ data: null, missing: isUnavailable(e), error: isUnavailable(e) ? null : errMsg(e) }))
    investigationApi.list().then((d) => setList({ data: d, missing: false, error: null }))
      .catch((e: unknown) => setList({ data: null, missing: isUnavailable(e), error: isUnavailable(e) ? null : errMsg(e) }))
    costsApi.summary().then((c) => setPricesKnown(c.prices_configured)).catch(() => setPricesKnown(null))
    investigationApi.workerStatus().then((w) => setWorker({ data: w, missing: false })).catch((e: unknown) => setWorker({ data: null, missing: isUnavailable(e) }))
  }, [])
  useEffect(() => { load() }, [load])
  const anyRunning = (list.data ?? []).some((i) => i.status === 'running')
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, anyRunning ? 6000 : 20000)
    return () => clearInterval(t)
  }, [load, anyRunning])

  const closeLaunch = () => { setLaunch(false); if (presetPerson) { params.delete('person'); setParams(params, { replace: true }) } }
  const workerInfo: WorkerInfo | WorkerStatus | null = worker.data ?? dash.data?.worker ?? null
  const invs = list.data ?? []
  const shown = filter === 'active' ? invs.filter((i) => ACTIVE_STATUSES.has(String(i.status))) : invs
  const blocked = invs.filter((i) => i.status === 'blocked')

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      {/* En-tête */}
      <section className="fade-up overflow-hidden rounded-[28px] p-5 text-white shadow-[0_18px_40px_-20px_rgba(91,63,214,0.8)] sm:p-6" style={{ background: 'linear-gradient(140deg, #6a4ee6 0%, #5b3fd6 45%, #4329b8 100%)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/75"><Radar size={14} />Centre d’investigation</div>
            <h1 className="mt-1.5 font-display text-[26px] leading-tight sm:text-[30px]">Des enquêtes qui avancent seules, et que vous gardez sous contrôle</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-white/85">
              Choisissez une personne : l’IA cherche ses actes, les lit, puis remonte ses ancêtres. Chaque découverte est montrée avec sa source.
              Ce qui n’est pas prouvé reste une hypothèse, que vous validez ou rejetez.
            </p>
          </div>
          <button className="btn w-full justify-center bg-white !py-3 text-[15px] font-semibold text-[#4329b8] shadow-lg hover:bg-white/90 sm:w-auto" onClick={() => setLaunch(true)}>
            <Rocket size={18} />Lancer une enquête autonome
          </button>
        </div>
      </section>

      {blocked.length > 0 && (
        <Notice tone="warn" title={`${blocked.length} enquête${blocked.length > 1 ? 's attendent' : ' attend'} votre intervention`}
          action={blocked.slice(0, 3).map((b) => <Link key={b.id} to={`/investigation/${b.id}`} className="btn-ghost !px-3 !py-1.5 !text-[13px]">{b.person_name ?? b.title}<ChevronRight size={14} /></Link>)}>
          {blocked[0].blocked_reason ?? 'Un site demande une action de votre part, ou un plafond a été atteint.'}
        </Notice>
      )}

      {/* Tableau de bord */}
      <section className="fade-up">
        <h2 className="mb-2.5 font-display text-xl text-night-900">Tableau de bord</h2>
        {dash.missing ? <NotYetAvailable what="Le tableau de bord des enquêtes" /> : dash.error ? <Notice tone="error" title="Tableau de bord indisponible">{dash.error}</Notice> : !dash.data ? <Loading /> : <DashboardGrid d={dash.data} pricesKnown={pricesKnown} />}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Liste des enquêtes */}
        <section className="panel fade-up min-w-0 p-4 sm:p-5">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl text-night-900">Enquêtes</h2>
            <div className="flex gap-1 rounded-xl bg-ivory-100 p-1 text-sm">
              {(['active', 'all'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-3 py-1 ${filter === f ? 'bg-white text-night-900 shadow-sm' : 'text-mist-500'}`}>{f === 'active' ? 'En cours' : 'Toutes'}</button>
              ))}
            </div>
          </header>
          {list.missing ? <NotYetAvailable what="La liste des enquêtes" /> : list.error ? <Notice tone="error">{list.error}</Notice> : !list.data ? <Loading /> : shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--hairline-strong)] bg-ivory-50/60 p-6 text-center">
              <Sparkles size={22} className="mx-auto mb-2" style={{ color: AI.color }} />
              <p className="text-sm text-night-900">{invs.length === 0 ? 'Aucune enquête pour l’instant.' : 'Aucune enquête en cours.'}</p>
              <p className="mt-1 text-xs text-mist-500">{invs.length === 0 ? 'Lancez votre première enquête : vous pourrez la suivre ici en direct.' : 'Affichez « Toutes » pour revoir les enquêtes terminées.'}</p>
              {invs.length === 0 && <button className="btn-gold mt-3" onClick={() => setLaunch(true)}><Rocket size={16} />Lancer une enquête</button>}
            </div>
          ) : (
            <ul className="-mx-2 divide-y divide-[var(--hairline)]">{shown.map((i) => <InvestigationRow key={i.id} inv={i} />)}</ul>
          )}
        </section>

        {/* Colonne latérale */}
        <aside className="min-w-0 space-y-4">
          <section className="panel fade-up p-4">
            <h2 className="mb-2.5 font-display text-lg text-night-900">Navigateur autonome</h2>
            <WorkerCard worker={workerInfo} unavailable={worker.missing && !dash.data?.worker} />
          </section>
          <section className="panel fade-up space-y-1 p-4">
            <h2 className="mb-1.5 font-display text-lg text-night-900">Raccourcis</h2>
            <Shortcut to="/couts" icon={<Coins size={16} />} label="Coûts et quotas IA" hint="Appels du jour, cache, plafonds" />
            <Shortcut to="/parametres?tab=enquetes" icon={<Settings2 size={16} />} label="Réglages des enquêtes" hint="Mode GRATUIT / HYBRIDE, navigateur, vie privée" />
            <Shortcut to="/questions" icon={<Lightbulb size={16} />} label="Questions de l’IA" hint="Quand elle a un doute, elle vous demande" />
            <Shortcut to="/enquetes" icon={<ScrollText size={16} />} label="Recherches classiques" hint="Historique des recherches site par site" />
          </section>
        </aside>
      </div>

      {launch && <LaunchInvestigationModal initialPersonId={presetPerson} onClose={closeLaunch} />}
    </div>
  )
}

function Shortcut({ to, icon, label, hint }: { to: string; icon: ReactNode; label: string; hint: string }) {
  return (
    <Link to={to} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-ivory-100">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ivory-100 text-night-800">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-night-900">{label}</span><span className="block truncate text-xs text-mist-500">{hint}</span></span>
      <ChevronRight size={15} className="shrink-0 text-mist-400" />
    </Link>
  )
}

function Stat({ icon, value, label, hint, tone }: { icon: ReactNode; value: ReactNode; label: string; hint?: string; tone?: 'ai' | 'warn' }) {
  return (
    <div className="paper flex min-w-0 flex-col gap-1 p-3.5" title={hint}>
      <span className={`flex items-center gap-1.5 text-[12px] font-medium ${tone === 'warn' ? 'text-[#87510f]' : tone === 'ai' ? 'text-[#3f2aa8]' : 'text-mist-500'}`}>{icon}<span className="truncate">{label}</span></span>
      <span className="font-display text-[26px] leading-none tabular-nums text-night-900">{value}</span>
      {hint && <span className="text-[11px] leading-snug text-mist-500">{hint}</span>}
    </div>
  )
}

function DashboardGrid({ d, pricesKnown }: { d: InvestigationDashboard; pricesKnown: boolean | null }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      <Stat icon={<Radar size={14} />} value={d.active} label="Enquêtes actives" tone="ai" />
      <Stat icon={<Users size={14} />} value={d.persons_searched} label="Personnes recherchées" />
      <Stat icon={<FileSearch size={14} />} value={d.documents_found} label="Documents trouvés" />
      <Stat icon={<FileText size={14} />} value={d.acts_analyzed} label="Actes analysés" />
      <Stat icon={<GitBranch size={14} />} value={d.ancestors_identified} label="Ancêtres identifiés" hint="À confirmer par vous" />
      <Stat icon={<GitBranch size={14} />} value={d.filiations_verified} label="Filiations vérifiées" hint="Prouvées par un acte" />
      <Stat icon={<Lightbulb size={14} />} value={d.hypotheses_open} label="Hypothèses" hint="À valider ou rejeter" tone={d.hypotheses_open ? 'warn' : undefined} />
      <Stat icon={<AlertTriangle size={14} />} value={d.errors} label="Erreurs" tone={d.errors ? 'warn' : undefined} />
      <Stat icon={<Clock size={14} />} value={formatDuration(d.research_seconds)} label="Temps de recherche" />
      <Link to="/couts" className="block min-w-0"><Stat icon={<Coins size={14} />} value={pricesKnown === false && !d.estimated_cost_usd ? '—' : formatUsd(d.estimated_cost_usd)} label="Coût estimé" hint={`${d.ai_calls} appel${d.ai_calls > 1 ? 's' : ''} IA${pricesKnown === false ? ' · tarif non renseigné' : ''}`} /></Link>
    </div>
  )
}

function InvestigationRow({ inv }: { inv: InvestigationOut }) {
  const s = { ...ZERO_STATS, ...inv.stats }
  const pct = inv.ai_call_ceiling ? Math.min(100, Math.round((inv.ai_calls_used / inv.ai_call_ceiling) * 100)) : 0
  return (
    <li>
      <Link to={`/investigation/${inv.id}`} className="flex items-start gap-3 rounded-xl px-2 py-3 hover:bg-ivory-100/70">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: AI.soft, color: AI.dark }}><Search size={17} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-[15px] font-semibold text-night-900">{inv.person_name ?? inv.title}</span>
            <StatusBadge status={String(inv.status)} label={inv.status_label} />
            <span className="chip conf-grey">{COST_MODE_LABEL[String(inv.cost_mode)] ?? inv.cost_mode}</span>
          </span>
          {inv.objective && <span className="mt-0.5 block truncate text-[13px] text-night-900/75">{inv.objective}</span>}
          {inv.status === 'blocked' && inv.blocked_reason && <span className="mt-0.5 block text-[13px] text-[#87510f]">{inv.blocked_reason}</span>}
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-mist-500">
            <span>Génération {inv.current_generation}/{inv.max_generations}</span>
            <span>{s.documents_found} document{s.documents_found > 1 ? 's' : ''}</span>
            <span>{s.hypotheses} hypothèse{s.hypotheses > 1 ? 's' : ''}</span>
            <span>{s.filiations_verified} filiation{s.filiations_verified > 1 ? 's' : ''} vérifiée{s.filiations_verified > 1 ? 's' : ''}</span>
            <span>Activité {relTime(inv.last_activity_at ?? inv.started_at)}</span>
          </span>
          <span className="mt-1.5 flex items-center gap-2 text-[11px] text-mist-500">
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-mist-200"><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 90 ? 'var(--color-conf-orange)' : AI.color }} /></span>
            {inv.ai_calls_used}/{inv.ai_call_ceiling} appels IA
          </span>
        </span>
        <ChevronRight size={16} className="mt-2 shrink-0 text-mist-400" />
      </Link>
    </li>
  )
}
