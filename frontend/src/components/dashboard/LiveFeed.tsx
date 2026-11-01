import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Radio } from 'lucide-react'
import { api, ApiError, type LogOut } from '../../api'
import { useApp } from '../../store'
import { Empty, Spinner, formatTs } from '../ui'

/** Catégories réelles émises par le journal du moteur. */
const CATEGORY: Record<string, { label: string; cls: string; bar: string }> = {
  search: { label: 'recherche', cls: 'bg-night-900/10 text-night-900', bar: 'bg-night-900' },
  result: { label: 'résultat', cls: 'bg-sage-500/15 text-sage-600', bar: 'bg-sage-500' },
  analysis: { label: 'analyse', cls: 'bg-gold-500/15 text-gold-600', bar: 'bg-gold-500' },
  compare: { label: 'comparaison', cls: 'bg-night-600/10 text-night-700', bar: 'bg-night-600' },
  question: { label: 'question', cls: 'bg-conf-orange/15 text-[#8a5a10]', bar: 'bg-conf-orange' },
  decision: { label: 'décision', cls: 'bg-ivory-200 text-night-900', bar: 'bg-mist-400' },
  error: { label: 'erreur', cls: 'bg-conf-red/12 text-[#7d2b22]', bar: 'bg-conf-red' },
  connector: { label: 'connecteur', cls: 'bg-sage-300/40 text-sage-600', bar: 'bg-sage-400' },
}
const FALLBACK = { label: 'journal', cls: 'bg-mist-200 text-mist-500', bar: 'bg-mist-300' }

export default function LiveFeed({ limit = 50 }: { limit?: number }) {
  const liveLogs = useApp((s) => s.liveLogs)
  const connected = useApp((s) => s.connected)
  const [initial, setInitial] = useState<LogOut[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.logs({ limit }).then((rows) => { if (alive) setInitial(rows) })
      .catch((e: unknown) => { if (alive) { setInitial([]); setError(e instanceof ApiError ? e.message : 'Journal indisponible : le moteur local ne répond pas.') } })
    return () => { alive = false }
  }, [limit])

  const rows = useMemo(() => {
    const byId = new Map<number, LogOut>()
    for (const l of [...liveLogs, ...(initial ?? [])]) if (!byId.has(l.id)) byId.set(l.id, l)
    return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, limit)
  }, [liveLogs, initial, limit])

  if (initial === null) return <div className="flex items-center gap-2 text-sm text-mist-500"><Spinner /> Chargement du journal…</div>
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-mist-500">
        <Radio size={13} className={connected ? 'text-sage-500' : 'text-conf-orange'} />
        {connected ? 'Flux en direct connecté' : 'Flux en direct interrompu — affichage des dernières entrées enregistrées'}
      </div>
      {error && <p className="mb-2 text-xs text-conf-red">{error}</p>}
      {rows.length === 0 ? (
        <Empty>Aucune recherche n'a encore été journalisée. Lancez une enquête depuis les priorités ci-dessous ou depuis <Link className="text-gold-600 underline" to="/enquetes">Enquêtes IA</Link>.</Empty>
      ) : (
        <ul className="max-h-[420px] divide-y divide-ivory-200 overflow-auto scrollbar-thin font-mono text-[12.5px]">
          {rows.map((l) => {
            const c = CATEGORY[l.category] ?? FALLBACK
            return (
              <li key={l.id} className="flex items-start gap-3 py-1.5">
                <span className={`mt-1 h-3.5 w-0.5 shrink-0 rounded ${c.bar}`} />
                <span className="shrink-0 tabular-nums text-mist-500">{formatTs(l.ts)}</span>
                <span className="text-mist-400">—</span>
                <span className={`chip shrink-0 !font-sans ${c.cls}`}>{c.label}</span>
                <span className={`min-w-0 flex-1 break-words font-sans ${l.level === 'error' ? 'text-conf-red' : 'text-night-900'}`}>
                  {l.person_id ? <Link to={`/personnes/${l.person_id}`} className="hover:text-gold-600">{l.message}</Link> : l.message}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
