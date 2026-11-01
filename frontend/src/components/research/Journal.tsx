import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type LogOut, type TaskOut } from '../../api'
import { useApp } from '../../store'
import { Empty, Spinner, formatTs } from '../ui'
import { JsonView, errMsg } from '../person/helpers'
import { LOG_CATEGORY_LABEL } from './labels'

const LEVEL_CLASS: Record<string, string> = { error: 'text-conf-red', warning: 'text-conf-orange', info: 'text-night-900', debug: 'text-mist-500' }

export function Journal({ tasks }: { tasks: TaskOut[] | null }) {
  const { liveLogs, notify } = useApp()
  const [base, setBase] = useState<LogOut[] | null>(null)
  const [cat, setCat] = useState('')
  const [taskId, setTaskId] = useState('')
  useEffect(() => { api.logs({ limit: 300 }).then(setBase).catch((e: unknown) => { notify('error', errMsg(e)); setBase([]) }) }, [notify])
  const merged = useMemo(() => {
    const m = new Map<number, LogOut>()
    ;[...(base ?? []), ...liveLogs].forEach((l) => { const prev = m.get(l.id); if (!prev || (prev.query === null && l.query !== null)) m.set(l.id, l) })
    return [...m.values()].sort((a, b) => b.id - a.id)
  }, [base, liveLogs])
  const cats = useMemo(() => [...new Set(merged.map((l) => l.category))].sort(), [merged])
  const taskTitle = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t.title])), [tasks])
  const taskIds = useMemo(() => [...new Set(merged.map((l) => l.task_id).filter((x): x is string => !!x))], [merged])
  const rows = merged.filter((l) => (!cat || l.category === cat) && (!taskId || l.task_id === taskId))
  return (
    <section className="panel fade-up p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl text-night-900">Journal en direct</h2>
        <span className="text-xs text-mist-500">{rows.length} entrée(s)</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <select className="input !w-auto !py-1.5" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Toutes catégories</option>{cats.map((c) => <option key={c} value={c}>{LOG_CATEGORY_LABEL[c] ?? c}</option>)}</select>
          <select className="input !w-auto max-w-xs !py-1.5" value={taskId} onChange={(e) => setTaskId(e.target.value)}><option value="">Toutes enquêtes</option>{taskIds.map((id) => <option key={id} value={id}>{taskTitle.get(id) ?? id.slice(0, 8)}</option>)}</select>
        </div>
      </div>
      {base === null && <Spinner />}
      {base !== null && rows.length === 0 && <Empty>Aucune entrée de journal.</Empty>}
      <ul className="max-h-[70vh] divide-y divide-ivory-200 overflow-auto scrollbar-thin font-mono text-xs">
        {rows.map((l) => (
          <li key={l.id} className="py-1.5">
            <div className="flex flex-wrap items-start gap-2">
              <span className="text-mist-400">{formatTs(l.ts)}</span>
              <span className="chip conf-grey !py-0">{LOG_CATEGORY_LABEL[l.category] ?? l.category}</span>
              {l.connector_id && <span className="text-mist-500">[{l.connector_id}]</span>}
              <span className={`flex-1 font-sans ${LEVEL_CLASS[l.level] ?? 'text-night-900'}`}>{l.message}</span>
              {l.person_id && <Link className="text-mist-500 underline" to={`/personnes/${l.person_id}`}>fiche</Link>}
              {l.task_id && <button className="text-mist-500 underline cursor-pointer" onClick={() => setTaskId(l.task_id ?? '')} title={taskTitle.get(l.task_id) ?? l.task_id}>enquête</button>}
            </div>
            {(l.query || l.outcome) && <div className="ml-16 flex gap-4 font-sans"><JsonView value={l.query} label="Requête" /><JsonView value={l.outcome} label="Résultat" /></div>}
          </li>
        ))}
      </ul>
    </section>
  )
}
