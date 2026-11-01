import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { BookOpen, FileUp, Search, UserRound } from 'lucide-react'
import { AnnexLinks, BookDesk, BookLoading, BookPage, BookToolbar, ExtLink, TocDrawer } from '../components/book/BookKit'
import { LifeMap } from '../components/book/LifeMap'
import { bookApi, type BookOutline, type BookTodo, type PlaceAnnex, type TodoRow } from '../lib/bookApi'

const ANNEXES = {
  metiers: { letter: 'A', title: 'Les métiers' },
  villages: { letter: 'B', title: 'Les villages' },
  'a-trouver': { letter: 'C', title: 'Dates à trouver & actes à retrouver' },
} as const
type AnnexKey = keyof typeof ANNEXES

/** Annexes du livre : /livre/metiers, /livre/villages, /livre/a-trouver. */
export default function BookAnnexPage() {
  const { annex = '' } = useParams()
  const [outline, setOutline] = useState<BookOutline | null>(null)
  const [toc, setToc] = useState(false)
  useEffect(() => { bookApi.outline().then(setOutline).catch(() => setOutline(null)) }, [])
  if (!(annex in ANNEXES)) return <Navigate to="/livre" replace />
  const key = annex as AnnexKey
  const head = `Annexe ${ANNEXES[key].letter} — ${ANNEXES[key].title}`
  return (
    <div className="mx-auto max-w-[1000px] pb-6">
      <BookToolbar onToc={() => setToc(true)} onPrint={() => window.print()}>
        {(Object.keys(ANNEXES) as AnnexKey[]).map((k) => (
          <Link key={k} to={`/livre/${k}`} className={`hidden h-9 items-center rounded-full px-3 text-[13px] font-medium sm:inline-flex ${k === key ? 'bg-night-900 text-ivory-50' : 'text-night-800 hover:bg-ivory-200'}`}>{ANNEXES[k].title.split(' & ')[0]}</Link>
        ))}
      </BookToolbar>
      {key === 'metiers' && <TradesAnnex head={head} />}
      {key === 'villages' && <PlacesAnnex head={head} />}
      {key === 'a-trouver' && <TodoAnnex head={head} />}
      {toc && <TocDrawer outline={outline} onClose={() => setToc(false)} />}
    </div>
  )
}

function useLoad<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { fn().then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Annexe indisponible')) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { data, error }
}

function AnnexTitle({ letter, title, intro }: { letter: string; title: string; intro: string }) {
  return (
    <>
      <div className="book-eyebrow">Annexe {letter}</div>
      <h1 className="book-h1">{title}</h1>
      <div className="book-title-rule" />
      <p className="m-0 mb-5 text-[15px] italic text-[#6d604b]">{intro}</p>
    </>
  )
}

function PersonLinks({ persons }: { persons: { id: string; name: string; years?: string; detail?: string; sosa: number[] }[] }) {
  return <>{persons.map((p, i) => (
    <Fragment key={p.id}>{i > 0 && ' ; '}<Link className="book-link" to={`/livre/personne/${p.id}`}>{p.name}</Link>{p.sosa[0] != null && <span className="book-sosa ml-1">{p.sosa[0]}</span>}{(p.detail || p.years) && <span className="text-[#85785f]"> ({p.detail || p.years})</span>}</Fragment>
  ))}</>
}

/* ------------------------------------------------------------------ */
function TradesAnnex({ head }: { head: string }) {
  const { data, error } = useLoad(bookApi.trades)
  if (error) return <BookDesk><BookPage><p className="py-6 text-center">{error}</p></BookPage></BookDesk>
  if (!data) return <BookLoading label="Recherche des métiers de la famille…" />
  return (
    <BookDesk>
      <BookPage left={head} right="Annexes" folio={1}>
        <AnnexTitle letter="A" title="Les métiers" intro="Les métiers relevés dans les actes de la famille. Les définitions décrivent le métier en général (dictionnaire des métiers anciens GENEALIS ou Wikipédia) ; seule la ligne « Dans la famille » parle de vos ancêtres." />
        {data.length === 0 && <p className="italic text-[#85785f]">Aucun métier n’est encore enregistré. Les professions apparaissent dès qu’elles sont saisies sur les fiches ou relevées dans un acte.</p>}
        {data.map((t) => (
          <article key={t.key} className="mb-7 break-inside-avoid overflow-hidden">
            {t.wiki?.image && <img src={t.wiki.image} alt={t.label} referrerPolicy="no-referrer" loading="lazy" className="float-right ml-4 mb-2 h-[110px] w-[140px] border border-black/10 object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
            <h2 className="book-h2 !mb-1 !mt-0 !border-0">{t.label}{t.forms.some((f) => f.toLowerCase() !== t.label.toLowerCase()) && <span className="ml-2 text-[13px] font-normal italic text-[#85785f]">({t.forms.join(', ')})</span>}</h2>
            {t.in_dictionary ? (
              <>
                <p className="m-0"><span className="book-box-kicker mr-1.5">Définition</span><i>{t.definition}</i></p>
                <p className="m-0 mt-1 text-justify">{t.description}</p>
                <p className="book-small m-0 mt-1 italic">{t.origin}</p>
              </>
            ) : t.wiki ? (
              <>
                <p className="m-0 mt-1 text-justify">{t.wiki.extract}</p>
                <p className="book-small m-0 mt-1 italic">Source : <ExtLink href={t.wiki.url}>{t.wiki.source}</ExtLink></p>
              </>
            ) : <p className="m-0 italic text-[#85785f]">Pas encore de définition pour ce métier (la notice Wikipédia s’affichera si elle est disponible en ligne).</p>}
            {t.wiki && t.in_dictionary && <p className="book-small m-0 italic">Pour aller plus loin : <ExtLink href={t.wiki.url}>Wikipédia — {t.wiki.title}</ExtLink></p>}
            <p className="m-0 mt-2 text-[14.5px]"><b className="book-sc text-[#7a4f2a]">Dans la famille : </b><PersonLinks persons={t.persons.map((p) => ({ ...p, years: p.years_mentioned.length ? `${p.years ? `${p.years}, ` : ''}mentionné en ${p.years_mentioned.join(', ')}` : p.years }))} />.</p>
          </article>
        ))}
      </BookPage>
    </BookDesk>
  )
}

/* ------------------------------------------------------------------ */
function PlacesAnnex({ head }: { head: string }) {
  const { data, error } = useLoad(bookApi.places)
  const points = useMemo(() => (data ?? []).map((p, i) => ({ n: i + 1, name: p.name, lat: p.lat, lon: p.lon })), [data])
  if (error) return <BookDesk><BookPage><p className="py-6 text-center">{error}</p></BookPage></BookDesk>
  if (!data) return <BookLoading label="Recherche des villages de la famille…" />
  const offline = data.length > 0 && data.every((p) => !p.wiki)
  return (
    <BookDesk>
      <BookPage left={head} right="Annexes" folio={1}>
        <AnnexTitle letter="B" title="Les villages" intro="Les communes où vos ancêtres sont nés, se sont mariés, ont vécu ou sont morts. L’histoire des villages vient de Wikipédia (avec lien) ; les repères chronologiques sont généraux ; la ligne « Ancêtres » liste les faits de l’arbre." />
        {data.length > 0 && <LifeMap points={points} path={false} />}
        {offline && <p className="book-small mt-2 italic">Notices Wikipédia indisponibles pour le moment (connexion Internet nécessaire) : elles apparaîtront automatiquement et seront gardées en mémoire.</p>}
        {data.length === 0 && <p className="italic text-[#85785f]">Aucun lieu n’est encore enregistré.</p>}
        <div className="mt-6">{data.map((p, i) => <PlaceEntry key={p.place_id} p={p} n={i + 1} />)}</div>
      </BookPage>
    </BookDesk>
  )
}

function PlaceEntry({ p, n }: { p: PlaceAnnex; n: number }) {
  const w = p.wiki
  const period = p.year_start != null ? (p.year_end != null && p.year_end !== p.year_start ? `${p.year_start}–${p.year_end}` : `${p.year_start}`) : null
  return (
    <article className="mb-8 overflow-hidden" style={{ breakInside: 'avoid' }}>
      {(w?.image || w?.coat_of_arms) && (
        <div className="float-right mb-2 ml-4 flex flex-col items-end gap-2">
          {w?.image && <img src={w.image} alt={p.name} referrerPolicy="no-referrer" loading="lazy" className="h-[120px] w-[160px] border border-black/10 object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
          {w?.coat_of_arms && <img src={w.coat_of_arms} alt={`Blason de ${p.name}`} referrerPolicy="no-referrer" loading="lazy" className="w-[64px]" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
        </div>
      )}
      <h2 className="m-0 text-[17px]"><span className="book-sosa mr-2 align-middle">{n}</span><span className="book-sc font-bold">{p.name}</span>
        <span className="book-sc ml-2 text-[12.5px] text-[#85785f]">{[p.department, period].filter(Boolean).join(' · ')}</span></h2>
      {p.historical_names.length > 0 && <p className="book-small m-0 italic">Noms anciens : {p.historical_names.join(', ')}</p>}
      {w?.extract ? (
        <>
          <p className="m-0 mt-1.5 text-justify text-[15px]">{w.extract}</p>
          <p className="book-small m-0 mt-0.5 italic">Source : <ExtLink href={w.url}>{w.source}</ExtLink></p>
        </>
      ) : <p className="book-small m-0 mt-1 italic">Notice Wikipédia non disponible pour l’instant.</p>}
      {p.timeline.length > 0 && (
        <div className="my-3 border-l-2 border-[#d8c08a] pl-4">
          {p.timeline.map((t) => (
            <div key={t.label} className="grid grid-cols-[92px_1fr] gap-3 py-1 text-[14px]">
              <span className="tabular-nums text-[#876a2e]">{t.start === t.end ? t.start : `${t.start}–${t.end}`}</span>
              <span><b className="font-semibold">{t.label}</b>{t.text ? ` : ${t.text}` : ''}</span>
            </div>
          ))}
          <p className="book-small m-0 italic">Repères historiques généraux.</p>
        </div>
      )}
      <p className="m-0 text-[13.5px]"><span className="book-sc text-[#85785f]">{p.ancestors.every((a) => a.sosa.length > 0) ? 'Ancêtres' : p.ancestors.some((a) => a.sosa.length > 0) ? 'Ancêtres et famille' : 'Famille'} : </span><PersonLinks persons={p.ancestors} />.</p>
    </article>
  )
}

/* ------------------------------------------------------------------ */
function TodoAnnex({ head }: { head: string }) {
  const { data, error } = useLoad(bookApi.todo)
  const [tab, setTab] = useState<'dates' | 'acts'>('dates')
  const [ancestorsOnly, setAncestorsOnly] = useState(false)
  const [search, setSearch] = useState('')
  const rows = useMemo(() => {
    const list: TodoRow[] = data ? data[tab] : []
    const n = search.trim().toLowerCase()
    return list.filter((r) => (!ancestorsOnly || r.sosa.length > 0) && (!n || `${r.name} ${r.sosa.join(' ')}`.toLowerCase().includes(n)))
  }, [data, tab, ancestorsOnly, search])
  if (error) return <BookDesk><BookPage><p className="py-6 text-center">{error}</p></BookPage></BookDesk>
  if (!data) return <BookLoading label="Inventaire des manques…" />
  return (
    <BookDesk>
      <BookPage left={head} right="Annexes" folio={1}>
        <AnnexTitle letter="C" title="Dates à trouver & actes à retrouver" intro="Ce qu’il manque encore à l’arbre, personne par personne (ancêtres directs d’abord, par numéro Sosa). Chaque ligne est un constat, jamais une supposition." />
        <TodoTabs data={data} tab={tab} setTab={setTab} />
        <div className="book-noprint mb-4 flex flex-wrap items-center gap-3 font-sans text-[13px]">
          <label className="relative min-w-[200px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom ou numéro Sosa…" className="input !py-1.5 !pl-8 !text-[13.5px]" />
          </label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={ancestorsOnly} onChange={(e) => setAncestorsOnly(e.target.checked)} />Ascendance directe seulement</label>
        </div>
        {rows.length === 0 && <p className="italic text-[#85785f]">{tab === 'dates' ? 'Aucune date à trouver' : 'Aucun acte à retrouver'} pour cette sélection.</p>}
        <table className="book-table"><tbody>
          {rows.map((r) => (
            <tr key={r.person_id}>
              <th className="!w-[38%]">
                <span className="inline-flex flex-wrap items-baseline gap-1">
                  {r.sosa[0] != null && <span className="book-sosa">{r.sosa[0]}</span>}
                  <Link to={`/livre/personne/${r.person_id}`} className="!text-[14.5px] text-[#2a2219]">{r.name}</Link>
                </span>
                {r.years && <span className="block text-[12px]">{r.years}</span>}
              </th>
              <td>
                <ul className="m-0 list-none p-0">{r.items.map((it) => <li key={it.key}>{it.label}</li>)}</ul>
                <div className="book-noprint mt-1 flex flex-wrap gap-x-3 gap-y-1 font-sans text-[12px]">
                  <Link to={`/personnes/${r.person_id}`} className="inline-flex items-center gap-1 text-night-700 hover:underline"><UserRound size={12} />Fiche</Link>
                  <Link to={`/livre/personne/${r.person_id}`} className="inline-flex items-center gap-1 text-night-700 hover:underline"><BookOpen size={12} />Chapitre</Link>
                  {tab === 'acts' && <Link to={`/documents/importer?personne=${r.person_id}`} className="inline-flex items-center gap-1 text-night-700 hover:underline"><FileUp size={12} />Importer l’acte</Link>}
                  <Link to="/" className="inline-flex items-center gap-1 text-[#5b3fd6] hover:underline"><Search size={12} />Centre de recherche</Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody></table>
        <div className="mt-8 border-t border-[rgb(122_79_42/0.15)] pt-3">
          <div className="book-h3">Autres annexes</div>
          <AnnexLinks outline={null} />
        </div>
      </BookPage>
    </BookDesk>
  )
}

function TodoTabs({ data, tab, setTab }: { data: BookTodo; tab: 'dates' | 'acts'; setTab: (t: 'dates' | 'acts') => void }) {
  const tabs: ['dates' | 'acts', string, number, number][] = [
    ['dates', 'Dates à trouver', data.counts.dates, data.counts.persons_dates],
    ['acts', 'Actes à retrouver', data.counts.acts, data.counts.persons_acts],
  ]
  return (
    <div className="book-noprint mb-4 grid grid-cols-2 gap-2 font-sans">
      {tabs.map(([k, l, n, np]) => (
        <button key={k} onClick={() => setTab(k)} className={`rounded-2xl border px-3 py-2.5 text-left transition-colors ${tab === k ? 'border-[#7a4f2a] bg-[#f3e9d8]' : 'border-[var(--hairline)] bg-ivory-50 hover:bg-ivory-100'}`}>
          <div className="text-[13px] font-semibold text-night-900">{l}</div>
          <div className="text-[12px] text-mist-500"><b className="font-display text-[20px] text-[#7a4f2a]">{n}</b> pour {np} personne{np > 1 ? 's' : ''}</div>
        </button>
      ))}
    </div>
  )
}

