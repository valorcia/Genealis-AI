import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ChevronDown, FileDown, Landmark } from 'lucide-react'
import { api, ApiError, openExternal, type HistoricalEvent, type Narrative, type NarrativeParagraph, type PersonSummary } from '../api'
import { ConfidenceChip, Empty, Spinner } from '../components/ui'

const KIND_LABEL: Record<string, string> = { war: 'Guerre', politics: 'Politique', law: 'Loi / registres', economy: 'Économie', migration: 'Migration' }
const KIND_CLS: Record<string, string> = { war: 'bg-conf-red/12 text-[#7d2b22]', politics: 'bg-[#4a6fa5]/15 text-[#2f4a74]', law: 'bg-[#4a6fa5]/15 text-[#2f4a74]', economy: 'bg-gold-500/15 text-gold-600', migration: 'bg-sage-500/15 text-sage-600' }
const REGION_LABEL: Record<string, string> = { FR: 'France', EU: 'Europe', IT: 'Italie', PL: 'Pologne', BE: 'Belgique', DE: 'Allemagne', LU: 'Luxembourg' }

function Paragraph({ p }: { p: NarrativeParagraph }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="group rounded-xl px-3 py-2 transition-colors hover:bg-ivory-100/70">
      <p className="text-[15px] leading-relaxed text-night-900">{p.text}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        <ConfidenceChip level={p.confidence} />
        {p.sources.length > 0 ? (
          <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-gold-600 hover:underline">
            <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} /> {p.sources.length} source{p.sources.length > 1 ? 's' : ''}
          </button>
        ) : <span className="chip bg-mist-200 text-mist-500" title="Aucun document ne vient appuyer ce paragraphe">non sourcé</span>}
      </div>
      {open && p.sources.length > 0 && (
        <ul className="mt-2 space-y-1.5 border-l-2 border-gold-500/40 pl-3">
          {p.sources.map((s) => (
            <li key={s.id} className="text-xs">
              <Link to={`/archives?source=${s.source_id}`} className="font-medium text-night-900 hover:text-gold-600">{s.source_title ?? 'Source sans titre'}</Link>
              {s.source_reliability && <span className="ml-1 text-mist-400">· fiabilité {s.source_reliability}</span>}
              {s.excerpt && <blockquote className="mt-0.5 font-display text-[13px] italic text-mist-500">« {s.excerpt} »</blockquote>}
              {s.note && <div className="text-mist-500">{s.note}</div>}
            </li>))}
        </ul>)}
    </div>
  )
}

export default function StoryPage() {
  const [persons, setPersons] = useState<PersonSummary[]>([])
  const [rootId, setRootId] = useState('')
  const [generations, setGenerations] = useState(6)
  const [chapters, setChapters] = useState<Narrative[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.persons(undefined, 2000).then((list) => { setPersons(list); setRootId((cur) => cur || (list.find((p) => p.is_root) ?? list[0])?.id || ''); if (list.length === 0) setLoading(false) })
      .catch((e: unknown) => { setError(e instanceof ApiError ? e.message : 'Impossible de charger les personnes.'); setLoading(false) })
  }, [])
  useEffect(() => {
    if (!rootId) return
    let alive = true
    setLoading(true); setError(null)
    api.familyNarrative(rootId, generations).then((c) => { if (alive) setChapters(c) })
      .catch((e: unknown) => { if (alive) setError(e instanceof ApiError ? e.message : "Impossible de générer l'histoire familiale.") })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [rootId, generations])

  const context = useMemo(() => {
    const seen = new Map<string, HistoricalEvent>()
    for (const c of chapters ?? []) for (const ev of c.historical_context) seen.set(`${ev.start}-${ev.end}-${ev.label}`, ev)
    return [...seen.values()].sort((a, b) => a.start - b.start || a.end - b.end)
  }, [chapters])
  const stats = useMemo(() => {
    const paras = (chapters ?? []).reduce((n, c) => n + c.paragraphs.length, 0)
    const unsourced = (chapters ?? []).reduce((n, c) => n + c.unsourced_count, 0)
    return { paras, unsourced }
  }, [chapters])
  const root = persons.find((p) => p.id === rootId)

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-night-900">Histoire familiale</h1>
          <p className="text-sm text-mist-500">Un récit composé uniquement à partir des faits documentés{root ? `, en partant de ${root.display_name}` : ''}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input !w-auto max-w-[260px] !py-1.5" value={rootId} onChange={(e) => setRootId(e.target.value)} title="Personne de départ">
            {persons.map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.birth_year ? ` (${p.birth_year})` : ''}{p.is_root ? ' ★' : ''}</option>)}
          </select>
          <select className="input !w-auto !py-1.5" value={generations} onChange={(e) => setGenerations(Number(e.target.value))} title="Nombre de générations">
            {[2, 3, 4, 5, 6, 8, 10, 12].map((g) => <option key={g} value={g}>{g} générations</option>)}
          </select>
          <button className="btn-gold" disabled={!rootId} onClick={() => openExternal(api.exportUrl('report.pdf', { root_id: rootId, generations }))}><FileDown size={15} /> Rapport PDF</button>
        </div>
      </header>

      {error && <div className="rounded-xl border border-conf-red/30 bg-conf-red/8 px-4 py-2 text-sm text-conf-red">{error}</div>}
      {loading && <div className="flex items-center gap-3 p-6 text-mist-500"><Spinner /> Rédaction du récit à partir des sources…</div>}
      {!loading && persons.length === 0 && <Empty>Aucune personne dans l'arbre. L'histoire familiale s'écrira au fil des découvertes documentées.</Empty>}

      {!loading && chapters && persons.length > 0 && (
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <article className="space-y-6">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-mist-500">
              <span>{chapters.length} chapitre{chapters.length > 1 ? 's' : ''}</span>
              <span>{stats.paras} paragraphe{stats.paras > 1 ? 's' : ''}</span>
              <span>{stats.unsourced} non sourcé{stats.unsourced > 1 ? 's' : ''}</span>
            </div>
            {chapters.length === 0 && <Empty>Aucun fait documenté pour cette ascendance.</Empty>}
            {chapters.map((c, i) => {
              const summary = persons.find((p) => p.id === c.person_id)
              return (
                <section key={c.person_id} className="panel fade-up p-6" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                  <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-ivory-300/70 pb-3">
                    <h2 className="font-display text-2xl text-night-900">
                      <span className="mr-2 text-sm uppercase tracking-[0.2em] text-gold-600">Chapitre {i + 1}</span>
                      <Link to={`/personnes/${c.person_id}`} className="hover:text-gold-600">{c.name}</Link>
                    </h2>
                    <span className="text-xs text-mist-500">{summary && (summary.birth_year || summary.death_year) ? `${summary.birth_year ?? '?'} – ${summary.death_year ?? (summary.is_living ? '' : '?')}` : ''}{c.unsourced_count > 0 ? ` · ${c.unsourced_count} fait(s) non sourcé(s)` : ' · entièrement sourcé'}</span>
                  </header>
                  {c.paragraphs.length === 0 ? <p className="text-sm italic text-mist-500">Aucun fait documenté pour cette personne.</p> : c.paragraphs.map((p, k) => <Paragraph key={k} p={p} />)}
                </section>)
            })}
            <footer className="rounded-xl border border-ivory-300/70 bg-ivory-100/70 px-4 py-3 text-xs text-mist-500">
              <BookOpen size={12} className="mr-1 inline" /> Ce récit est généré exclusivement à partir des événements et relations enregistrés dans votre base, chacun relié à ses sources. Aucune anecdote, aucun détail ni aucune interprétation n'est inventé : lorsqu'un fait manque, le texte le signale ou reste silencieux.
            </footer>
          </article>
          <aside className="xl:sticky xl:top-0 xl:self-start">
            <section className="panel fade-up p-5">
              <h2 className="font-display text-xl text-night-900"><Landmark size={16} className="mr-1.5 inline text-gold-600" />Contexte historique</h2>
              <p className="mb-3 text-[11px] text-mist-500">Événements généraux de la période, distincts des faits familiaux : ils situent le récit sans s'y substituer.</p>
              {context.length === 0 ? <p className="text-xs text-mist-500">Aucun événement général ne recoupe les dates connues.</p> : (
                <ol className="relative ml-2 space-y-3 border-l border-ivory-300 pl-4 text-sm">
                  {context.map((ev, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-ivory-50 bg-gold-500" />
                      <div className="text-[11px] tabular-nums text-mist-500">{ev.start === ev.end ? ev.start : `${ev.start} – ${ev.end}`} · {REGION_LABEL[ev.region] ?? ev.region}</div>
                      <div className="text-night-900">{ev.label}</div>
                      <span className={`chip mt-1 ${KIND_CLS[ev.kind] ?? 'bg-mist-200 text-mist-500'}`}>{KIND_LABEL[ev.kind] ?? ev.kind}</span>
                    </li>))}
                </ol>)}
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}
