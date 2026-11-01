import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Globe, Pause, Play, RefreshCw, Rocket } from 'lucide-react'
import { api, type ConnectorInfo, type Priority, type TaskOut } from '../api'
import { useApp } from '../store'
import { Empty, Spinner, formatTs } from '../components/ui'
import { JsonView, Tabs, errMsg } from '../components/person/helpers'
import { TaskQueue } from '../components/research/TaskQueue'
import { Journal } from '../components/research/Journal'
import { Connectors } from '../components/research/Connectors'
import { AUTONOMY_LABEL } from '../components/research/labels'
import { SearchesByPerson } from '../components/research/trace'
import { traceApi, type TraceTaskBrief } from '../lib/traceApi'

type Worker = { running: boolean; current_task_id: string | null; paused: boolean; autonomy_mode: number }
type Decision = { id: number; ts: string; agent: string; task_id: string | null; decision: string; rationale: Record<string, unknown> }
const TABS = [{ id: 'recherches', label: 'Recherches effectuées' }, { id: 'file', label: 'File d’attente' }, { id: 'journal', label: 'Journal en direct' }, { id: 'decisions', label: 'Décisions des agents' }, { id: 'priorites', label: 'Priorités' }, { id: 'connecteurs', label: 'Connecteurs d’archives' }]

export default function ResearchPage() {
  const { notify } = useApp()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'recherches'
  const setTab = (t: string) => setParams((prev) => { const n = new URLSearchParams(prev); n.set('tab', t); return n }, { replace: true })
  const [worker, setWorker] = useState<Worker | null>(null)
  const [tasks, setTasks] = useState<TaskOut[] | null>(null)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [connectors, setConnectors] = useState<ConnectorInfo[] | null>(null)
  const [loadingConn, setLoadingConn] = useState(false)
  const [decisions, setDecisions] = useState<Decision[] | null>(null)
  const [priorities, setPriorities] = useState<Priority[] | null>(null)
  const [pausing, setPausing] = useState(false)
  const [traces, setTraces] = useState<TraceTaskBrief[] | null>(null)
  const [traceErr, setTraceErr] = useState<string | null>(null)
  const refreshTraces = useCallback(() => traceApi.tasks({ limit: 300 }).then((t) => { setTraces(t); setTraceErr(null) }).catch((e: unknown) => setTraceErr(errMsg(e))), [])

  const refreshWorker = useCallback(() => api.worker().then(setWorker).catch(() => setWorker(null)), [])
  const refreshTasks = useCallback(async () => { setLoadingTasks(true); try { setTasks(await api.tasks()) } catch (e) { notify('error', errMsg(e)); setTasks((t) => t ?? []) } finally { setLoadingTasks(false) } }, [notify])
  const refreshConnectors = useCallback(async () => { setLoadingConn(true); try { setConnectors(await api.connectors()) } catch (e) { notify('error', errMsg(e)); setConnectors((c) => c ?? []) } finally { setLoadingConn(false) } }, [notify])
  const refreshDecisions = useCallback(() => api.decisions().then(setDecisions).catch((e: unknown) => { notify('error', errMsg(e)); setDecisions([]) }), [notify])
  const refreshPriorities = useCallback(() => api.priorities().then(setPriorities).catch((e: unknown) => { notify('error', errMsg(e)); setPriorities([]) }), [notify])

  useEffect(() => { refreshWorker(); refreshTasks() }, [refreshWorker, refreshTasks])
  useEffect(() => { if (tab === 'recherches') refreshTraces() }, [tab, tasks, refreshTraces])
  useEffect(() => { if (tab === 'connecteurs' && connectors === null) refreshConnectors(); if (tab === 'decisions') refreshDecisions(); if (tab === 'priorites') refreshPriorities() }, [tab, connectors, refreshConnectors, refreshDecisions, refreshPriorities])

  const active = (tasks ?? []).some((t) => t.status === 'running' || t.status === 'queued')
  useEffect(() => {
    if (!active) return
    const i = setInterval(() => { refreshTasks(); refreshWorker() }, 5000)
    return () => clearInterval(i)
  }, [active, refreshTasks, refreshWorker])
  useEffect(() => {
    const h = (ev: Event) => { const d = (ev as CustomEvent<{ type?: string }>).detail; if (d?.type === 'task') { refreshTasks(); refreshWorker() } }
    window.addEventListener('genealis:event', h)
    return () => window.removeEventListener('genealis:event', h)
  }, [refreshTasks, refreshWorker])

  const togglePause = async () => {
    if (!worker) return
    setPausing(true)
    try { await api.pauseWorker(!worker.paused); notify('success', worker.paused ? 'Recherches reprises.' : 'Recherches mises en pause.'); await refreshWorker() } catch (e) { notify('error', errMsg(e)) } finally { setPausing(false) }
  }
  const launch = async (pr: Priority) => { try { const t = await api.explore(pr.person_id, 1); notify('success', `${t.length} enquête(s) lancée(s) pour ${pr.name}.`); setTab('file'); refreshTasks() } catch (e) { notify('error', errMsg(e)) } }
  const currentTask = worker?.current_task_id ? (tasks ?? []).find((t) => t.id === worker.current_task_id) : undefined

  return (
    <div className="space-y-4">
      <header className="panel fade-up flex flex-wrap items-center gap-4 p-5">
        <div>
          <h1 className="font-display text-3xl text-night-900">Enquêtes IA</h1>
          <p className="text-xs text-mist-500">Des agents locaux planifient, interrogent les archives et vous soumettent leurs pistes. Rien n’est ajouté à votre arbre sans votre accord.</p>
          <Link to="/sources-consultees" className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-[#2f6fd1]"><Globe size={14} />Sites consultés et vérification du moteur</Link>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
          {worker ? (
            <>
              <span className="inline-flex items-center gap-2"><span className={`inline-block h-2.5 w-2.5 rounded-full ${worker.paused ? 'bg-conf-orange' : worker.running ? 'bg-conf-green animate-pulse' : 'bg-mist-400'}`} />{worker.paused ? 'En pause' : worker.running ? 'En activité' : 'En veille'}</span>
              <span className="chip conf-grey">Mode {worker.autonomy_mode} · {AUTONOMY_LABEL[worker.autonomy_mode] ?? 'Inconnu'}</span>
              {currentTask && <span className="max-w-xs truncate text-xs text-mist-500" title={currentTask.title}>Tâche : {currentTask.title}</span>}
              <button className={worker.paused ? 'btn-sage' : 'btn-ghost'} disabled={pausing} onClick={togglePause}>{pausing ? <Spinner /> : worker.paused ? <Play size={15} /> : <Pause size={15} />}{worker.paused ? 'Reprendre' : 'Pause'}</button>
            </>
          ) : <span className="text-xs text-mist-500">Moteur de recherche injoignable</span>}
          <button className="btn-ghost !px-2" title="Actualiser" onClick={() => { refreshTasks(); refreshWorker() }}><RefreshCw size={15} className={loadingTasks ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      <Tabs tabs={TABS.map((t) => ({ ...t, count: t.id === 'file' ? (tasks ?? []).filter((x) => x.status === 'waiting_user').length : undefined }))} value={tab} onChange={setTab} />

      {tab === 'recherches' && (
        <div className="space-y-3">
          <p className="px-1 text-[13px] text-mist-500">Touchez une recherche pour voir exactement où l’IA a cherché, ce qu’elle a trouvé, et refaire la recherche vous-même.</p>
          {traceErr && <p className="panel p-4 text-sm text-conf-red">{traceErr}</p>}
          {traces === null && !traceErr && <div className="p-4"><Spinner /></div>}
          {traces !== null && traces.length === 0 && <Empty>Aucune recherche effectuée pour l’instant. Lancez-en une depuis l’onglet « File d’attente » ou depuis une fiche personnelle.</Empty>}
          {traces !== null && traces.length > 0 && <SearchesByPerson tasks={traces} />}
        </div>
      )}
      {tab === 'file' && <TaskQueue tasks={tasks} loading={loadingTasks} onChange={() => { refreshTasks(); refreshWorker() }} />}
      {tab === 'journal' && <Journal tasks={tasks} />}
      {tab === 'decisions' && (
        <section className="panel fade-up p-5">
          <h2 className="mb-3 font-display text-xl text-night-900">Décisions des agents</h2>
          {decisions === null && <Spinner />}
          {decisions !== null && decisions.length === 0 && <Empty>Aucune décision enregistrée.</Empty>}
          {decisions && decisions.length > 0 && (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-mist-500"><th className="py-2 pr-3">Heure</th><th className="py-2 pr-3">Agent</th><th className="py-2 pr-3">Décision</th><th className="py-2">Justification</th></tr></thead>
              <tbody>{decisions.map((d) => (
                <tr key={d.id} className="border-t border-ivory-200 align-top">
                  <td className="whitespace-nowrap py-2 pr-3 text-xs text-mist-500">{formatTs(d.ts)}</td>
                  <td className="py-2 pr-3"><span className="chip conf-grey">{d.agent}</span></td>
                  <td className="py-2 pr-3">{d.decision}{d.task_id && <span className="ml-1 text-xs text-mist-500">· enquête {d.task_id.slice(0, 8)}</span>}</td>
                  <td className="py-2"><JsonView value={d.rationale} label="Voir" /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      )}
      {tab === 'priorites' && (
        <section className="panel fade-up p-5">
          <h2 className="mb-1 font-display text-xl text-night-900">Priorités de recherche</h2>
          <p className="mb-3 text-xs text-mist-500">Classement des personnes selon les informations manquantes, la disponibilité des archives et le temps estimé.</p>
          {priorities === null && <Spinner />}
          {priorities !== null && priorities.length === 0 && <Empty>Rien à prioriser : toutes les fiches semblent complètes ou aucune personne n’est enregistrée.</Empty>}
          {priorities && priorities.length > 0 && (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-mist-500"><th className="py-2 pr-3">Score</th><th className="py-2 pr-3">Personne</th><th className="py-2 pr-3">Manque</th><th className="py-2 pr-3">Pays</th><th className="py-2 pr-3">Archives</th><th className="py-2 pr-3">Durée est.</th><th className="py-2 pr-3">Déjà tenté</th><th className="py-2"></th></tr></thead>
              <tbody>{priorities.map((pr) => (
                <tr key={pr.person_id} className="border-t border-ivory-200 align-top">
                  <td className="py-2 pr-3 font-display text-lg text-gold-600">{Math.round(pr.score)}</td>
                  <td className="py-2 pr-3"><Link className="font-medium text-night-900 hover:text-gold-600" to={`/personnes/${pr.person_id}`}>{pr.name}</Link>{pr.birth_year && <span className="ml-1 text-xs text-mist-500">({pr.birth_year})</span>}</td>
                  <td className="py-2 pr-3 text-xs">{pr.missing.join(', ') || '—'}</td>
                  <td className="py-2 pr-3">{pr.country}</td>
                  <td className="py-2 pr-3">{Math.round(pr.availability * 100)} %</td>
                  <td className="py-2 pr-3">{pr.estimated_minutes} min</td>
                  <td className="py-2 pr-3 text-xs text-mist-500">{pr.already_tried.join(', ') || '—'}</td>
                  <td className="py-2"><button className="btn-gold !py-1" onClick={() => launch(pr)}><Rocket size={14} />Lancer</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}
      {tab === 'connecteurs' && <Connectors connectors={connectors} loading={loadingConn} onChange={refreshConnectors} />}
    </div>
  )
}
