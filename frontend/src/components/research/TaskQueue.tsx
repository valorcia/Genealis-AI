import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, ExternalLink, Plus, RotateCcw, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react'
import { api, TASK_STATUS_LABEL, openExternal, type PersonSummary, type PlanStep, type TaskOut } from '../../api'
import { useApp } from '../../store'
import { Empty, Field, Spinner, formatDate } from '../ui'
import { JsonView, errMsg } from '../person/helpers'
import { CREATABLE_TASK_TYPES, STEP_STATUS_CLASS, STEP_STATUS_LABEL, TASK_TYPE_LABEL } from './labels'

const GROUPS: { status: string[]; label: string }[] = [
  { status: ['waiting_user'], label: 'En attente de votre accord' }, { status: ['running'], label: 'En cours' }, { status: ['queued', 'paused'], label: 'En file d’attente' },
  { status: ['done'], label: 'Terminées' }, { status: ['failed', 'cancelled'], label: 'Échecs et annulations' },
]
const STATUS_CLASS: Record<string, string> = { queued: 'conf-grey', running: 'conf-orange', waiting_user: 'bg-gold-500/20 text-gold-600', done: 'conf-green', failed: 'conf-red', paused: 'conf-grey', cancelled: 'conf-grey' }

const hostOf = (u: string) => { try { return new URL(u).hostname } catch { return u } }

interface ResultItem { title?: unknown; url?: unknown; year?: unknown; snippet?: unknown }

function StepRow({ s }: { s: PlanStep }) {
  const res = s.result ?? {}
  const browse = typeof res.browse_url === 'string' ? res.browse_url : null
  const count = typeof res.count === 'number' ? res.count : null
  const results = Array.isArray(res.results) ? (res.results as ResultItem[]).slice(0, 5) : []
  const err = typeof res.error === 'string' ? res.error : null
  return (
    <li className="rounded-lg bg-ivory-100 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`chip ${STEP_STATUS_CLASS[s.status] ?? 'conf-grey'}`}>{STEP_STATUS_LABEL[s.status] ?? s.status}</span>
        <span className="font-medium text-night-900">{s.label}</span>
        {s.connector_id && <span className="text-mist-500">· {s.connector_id}</span>}
        {count !== null && <span className="text-mist-500">· {count} résultat(s)</span>}
        {s.status === 'manual' && browse && <button className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => openExternal(browse)}><ExternalLink size={12} />Ouvrir dans le navigateur</button>}
      </div>
      {err && <p className="mt-1 text-conf-red">{err}{browse && <> — <button className="underline cursor-pointer" onClick={() => openExternal(browse)}>ouvrir le site</button></>}</p>}
      {results.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-3">
          {results.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1 text-mist-500">
              {typeof r.url === 'string' ? <button className="text-night-900 underline cursor-pointer" onClick={() => openExternal(String(r.url))}>{String(r.title ?? r.url)}</button> : <span className="text-night-900">{String(r.title ?? '')}</span>}
              {r.year !== undefined && r.year !== null && <span>({String(r.year)})</span>}
              {typeof r.snippet === 'string' && <span className="italic">— {r.snippet.slice(0, 120)}</span>}
            </li>
          ))}
        </ul>
      )}
      <JsonView value={s.query} label="Requête" />
    </li>
  )
}

function TaskCard({ t, persons, onChange }: { t: TaskOut; persons: Map<string, PersonSummary>; onChange: () => void }) {
  const { notify } = useApp()
  const [open, setOpen] = useState(t.status === 'waiting_user')
  const [busy, setBusy] = useState(false)
  const person = t.person_id ? persons.get(t.person_id) : undefined
  const act = async (fn: () => Promise<unknown>, msg: string) => { setBusy(true); try { await fn(); notify('success', msg); onChange() } catch (e) { notify('error', errMsg(e)) } finally { setBusy(false) } }
  const r = t.result ?? {}
  const manualSites = Array.isArray(r.manual_sites) ? (r.manual_sites as unknown[]).filter((u): u is string => typeof u === 'string') : []
  const hasSummary = ['strong', 'ambiguous', 'plausible'].some((k) => typeof r[k] === 'number')
  return (
    <div className="rounded-xl border border-ivory-200 bg-white/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`chip ${STATUS_CLASS[t.status] ?? 'conf-grey'}`}>{TASK_STATUS_LABEL[t.status] ?? t.status}</span>
            <span className="font-medium text-night-900">{t.title}</span>
            <span className="text-xs text-mist-500">{TASK_TYPE_LABEL[t.task_type] ?? t.task_type}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-mist-500">
            {person ? <Link className="text-night-900 hover:text-gold-600" to={`/personnes/${person.id}`}>{person.display_name}</Link> : t.person_id ? <Link className="text-night-900" to={`/personnes/${t.person_id}`}>Personne</Link> : null}
            <span>priorité {t.priority}</span><span>{t.attempts} tentative(s)</span>
            <span>créée {formatDate(t.created_at)}</span>{t.finished_at && <span>terminée {formatDate(t.finished_at)}</span>}
            {t.requires_approval && t.approved === false && <span className="text-conf-red">refusée</span>}
          </div>
          {t.last_error && <p className="mt-1 text-xs text-conf-red">{t.last_error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {t.status === 'waiting_user' && <>
            <button className="btn-sage !py-1" disabled={busy} onClick={() => act(() => api.approveTask(t.id, true), 'Enquête approuvée.')}><ThumbsUp size={14} />Approuver</button>
            <button className="btn-ghost !py-1" disabled={busy} onClick={() => act(() => api.approveTask(t.id, false), 'Enquête refusée.')}><ThumbsDown size={14} />Refuser</button>
          </>}
          {['failed', 'cancelled', 'done'].includes(t.status) && <button className="btn-ghost !py-1" disabled={busy} onClick={() => act(() => api.retryTask(t.id), 'Enquête relancée.')}><RotateCcw size={14} />Relancer</button>}
          {['queued', 'running', 'waiting_user', 'paused'].includes(t.status) && <button className="btn-ghost !py-1" disabled={busy} onClick={() => act(() => api.cancelTask(t.id), 'Enquête annulée.')}><XCircle size={14} />Annuler</button>}
          <button className="btn-ghost !px-2 !py-1" onClick={() => setOpen((v) => !v)} title="Détails">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          {hasSummary && (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="chip conf-green">{String(r.strong ?? 0)} correspondance(s) forte(s)</span>
              <span className="chip conf-orange">{String(r.ambiguous ?? 0)} ambiguë(s) (homonymes)</span>
              <span className="chip conf-grey">{String(r.plausible ?? 0)} plausible(s)</span>
            </div>
          )}
          {manualSites.length > 0 && (
            <div className="text-xs"><span className="text-mist-500">Sites à consulter manuellement : </span>{manualSites.map((u, i) => <button key={i} className="mr-2 underline text-night-900 cursor-pointer" onClick={() => openExternal(u)}>{hostOf(u)}</button>)}</div>
          )}
          {t.plan.length === 0 ? <p className="text-xs text-mist-500">Plan non encore établi.</p> : <ul className="space-y-1">{t.plan.map((s, i) => <StepRow key={i} s={s} />)}</ul>}
          <JsonView value={t.params} label="Paramètres" />
          <JsonView value={t.result} label="Résultat brut" />
        </div>
      )}
    </div>
  )
}

export function NewTaskForm({ persons, onCreated }: { persons: PersonSummary[]; onCreated: () => void }) {
  const { notify } = useApp()
  const [personId, setPersonId] = useState('')
  const [type, setType] = useState('find_birth')
  const [priority, setPriority] = useState(50)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!personId) { notify('error', 'Choisissez une personne.'); return }
    setBusy(true)
    try {
      if (type === 'explore_branch') await api.explore(personId, 3)
      else await api.createTask({ task_type: type, person_id: personId, priority })
      notify('success', 'Enquête créée.'); onCreated()
    } catch (e) { notify('error', errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <div className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
      <Field label="Personne">
        <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">— choisir —</option>
          {persons.map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.birth_year ? ` (${p.birth_year})` : ''}</option>)}
        </select>
      </Field>
      <Field label="Type d’enquête">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>{CREATABLE_TASK_TYPES.map((k) => <option key={k} value={k}>{TASK_TYPE_LABEL[k]}</option>)}</select>
      </Field>
      <Field label="Priorité (0–100)"><input className="input" type="number" min={0} max={100} value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></Field>
      <button className="btn-gold" disabled={busy} onClick={submit}>{busy ? <Spinner /> : <Plus size={15} />}Lancer</button>
    </div>
  )
}

export function TaskQueue({ tasks, loading, onChange }: { tasks: TaskOut[] | null; loading: boolean; onChange: () => void }) {
  const { notify } = useApp()
  const [persons, setPersons] = useState<PersonSummary[]>([])
  useEffect(() => { api.persons().then(setPersons).catch((e: unknown) => notify('error', errMsg(e))) }, [notify])
  const map = useMemo(() => new Map(persons.map((p) => [p.id, p])), [persons])
  const groups = useMemo(() => GROUPS.map((g) => ({ ...g, items: (tasks ?? []).filter((t) => g.status.includes(t.status)) })), [tasks])
  return (
    <div className="space-y-4">
      <section className="panel fade-up p-5">
        <h2 className="mb-3 font-display text-xl text-night-900">Nouvelle enquête</h2>
        <NewTaskForm persons={persons} onCreated={onChange} />
      </section>
      {tasks === null && loading && <div className="p-4"><Spinner /></div>}
      {tasks !== null && tasks.length === 0 && <Empty>Aucune enquête pour l’instant. Lancez-en une ci-dessus ou depuis une fiche personnelle.</Empty>}
      {groups.filter((g) => g.items.length > 0).map((g) => (
        <section key={g.label} className="panel fade-up p-5">
          <h2 className="mb-3 font-display text-xl text-night-900">{g.label} <span className="text-sm text-mist-500">({g.items.length})</span></h2>
          <div className="space-y-2">{g.items.map((t) => <TaskCard key={t.id} t={t} persons={map} onChange={onChange} />)}</div>
        </section>
      ))}
    </div>
  )
}
