import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, Feather, Printer, Search, X } from 'lucide-react'
import { Spinner } from '../components/ui'
import { Monogram } from '../components/brand/Brand'
import { AnnexLinks, BookDesk, BookLoading, BookPage as Page, BookToolbar } from '../components/book/BookKit'
import { ChapterView } from '../components/book/ChapterView'
import { bookApi, generationLabel, type BookChapter, type BookOutline } from '../lib/bookApi'

const PRINT_MAX = 250
const PRINT_MAPS_MAX = 40

/** Le livre de la famille : couverture, sommaire, chapitres, annexes ; impression du livre entier (?imprimer=1). */
export default function BookPage() {
  const [params, setParams] = useSearchParams()
  const [outline, setOutline] = useState<BookOutline | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const printMode = params.get('imprimer') === '1'

  useEffect(() => { bookApi.outline(true).then(setOutline).catch((e) => setError(e instanceof Error ? e.message : 'Livre indisponible')) }, [])

  const groups = useMemo(() => {
    const n = search.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const list = (outline?.chapters ?? []).filter((c) => !n || `${c.name} ${c.place ?? ''} ${c.sosa.join(' ')}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(n))
    const map = new Map<string, typeof list>()
    for (const c of list) {
      const k = c.is_ancestor && c.generation ? `g${c.generation}` : 'autres'
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(c)
    }
    return [...map.entries()]
  }, [outline, search])

  if (error) return <BookDesk><Page><p className="py-8 text-center">{error}</p></Page></BookDesk>
  if (!outline) return <div className="mx-auto max-w-[1000px]"><BookLoading label="Reliure du livre…" /></div>
  if (printMode) return <PrintWholeBook outline={outline} onExit={() => { params.delete('imprimer'); setParams(params) }} />

  const first = outline.chapters[0]
  const span = outline.span.start && outline.span.end ? `${outline.span.start} – ${outline.span.end}` : null
  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="mx-auto max-w-[1000px] pb-6">
      <BookToolbar onPrint={() => setParams({ imprimer: '1' })}>
        {first && <Link to={`/livre/personne/${first.person_id}`} className="btn-primary !h-9 !px-3 !text-[13px]"><BookOpen size={15} />Commencer la lecture</Link>}
      </BookToolbar>
      <BookDesk>
        <Cover outline={outline} span={span} today={today} />

        <Page left="Sommaire" right={outline.title} folio={2}>
          <div className="flex items-end justify-between gap-3">
            <h2 className="book-h1 !text-[28px]">Sommaire</h2>
            <label className="book-noprint relative w-full max-w-[230px] font-sans">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher un chapitre…" className="input !py-1.5 !pl-8 !text-[13.5px]" />
              {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-mist-400" aria-label="Effacer"><X size={14} /></button>}
            </label>
          </div>
          <div className="book-title-rule" />
          {outline.chapters.length === 0 && <p className="italic text-[#85785f]">L’arbre est encore vide : chaque personne ajoutée aura ici son chapitre.</p>}
          {groups.map(([k, list]) => (
            <div key={k} className="mb-4">
              <div className="book-h3">{k === 'autres' ? 'Autres membres de la famille' : `${generationLabel(Number(k.slice(1)))}`}</div>
              {list.map((c) => (
                <Link key={c.person_id} to={`/livre/personne/${c.person_id}`} className="book-toc-row">
                  {c.sosa[0] != null ? <span className="book-sosa">{c.sosa[0]}</span> : <span className="book-sosa opacity-40">·</span>}
                  <span className="nm min-w-0 truncate">{c.name}{c.place && <span className="hidden text-[13.5px] italic text-[#85785f] sm:inline"> — {c.place}</span>}</span>
                  <span className="dots" />
                  <span className="shrink-0 text-[13.5px] tabular-nums text-[#85785f]">{c.years || '—'}</span>
                  <span className="w-8 shrink-0 text-right text-[12px] text-[#a3957b]">{c.number}</span>
                </Link>
              ))}
            </div>
          ))}
          <div className="mt-6">
            <div className="book-h3">Annexes</div>
            <AnnexLinks outline={outline} />
          </div>
        </Page>

        <Page left="Note de l’éditeur" right={outline.title} folio={3}>
          <h2 className="book-h2">Comment ce livre est écrit</h2>
          <div className="book-text">
            <p>Chaque chapitre raconte une vie à la première personne, <b>uniquement à partir des faits enregistrés</b> dans l’arbre : naissances, mariages, décès, recensements, professions, liens de parenté et personnes citées dans les actes. Une petite note renvoie à la source qui justifie chaque paragraphe.</p>
            <p>Les encadrés « Le village », « Le métier », « Mon époque » et « La vie de tous les jours » donnent un contexte général : ils proviennent de Wikipédia, du dictionnaire des métiers anciens de GENEALIS ou d’une chronologie historique, et sont toujours étiquetés comme tels. Ils ne disent rien de précis sur vos ancêtres.</p>
            <p>Une version reformulée par l’IA peut être demandée chapitre par chapitre ; elle reste séparée, porte la mention « Texte reformulé par l’IA à partir des faits » et ne remplace jamais le texte factuel.</p>
          </div>
          <div className="book-noprint mt-5 flex flex-wrap gap-2 font-sans">
            <Link to="/livre/personne" className="btn-ghost !text-[13px]"><Feather size={14} />Ma vie, racontée</Link>
            <button onClick={() => setParams({ imprimer: '1' })} className="btn-ghost !text-[13px]"><Printer size={14} />Imprimer tout le livre</button>
          </div>
        </Page>
      </BookDesk>
    </div>
  )
}

function Cover({ outline, span, today }: { outline: BookOutline; span: string | null; today: string }) {
  const c = outline.counts
  const stats: [number, string][] = [[c.persons, 'personnes'], [c.ancestors, 'ancêtres directs'], [c.generations, 'générations'], [c.places, 'lieux'], [c.sources, 'sources']]
  return (
    <Page className="is-cover" folio={1}>
      <div className="mx-auto flex max-w-[560px] flex-col items-center">
        <Monogram size={58} />
        <div className="book-eyebrow mt-5">Livre de la famille</div>
        <h1 className="book-h1 mt-2 !text-[40px] sm:!text-[56px]">{outline.surnames.length ? outline.surnames.join(' · ') : 'Notre famille'}</h1>
        {span && <div className="book-dates mt-2 !text-[17px]">Ascendance, {span}</div>}
        <div className="my-7 flex w-full items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#a98843]" /><span className="h-2 w-2 rotate-45 border border-[#a98843]" /><span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#a98843]" />
        </div>
        <div className="grid w-full grid-cols-3 gap-y-4 sm:grid-cols-5">
          {stats.map(([n, l]) => (
            <div key={l} className="flex flex-col items-center">
              <span className="book-sc text-[28px] font-bold leading-none text-[#7a4f2a]">{n}</span>
              <span className="mt-1 text-[12.5px] italic text-[#85785f]">{l}</span>
            </div>
          ))}
        </div>
        <p className="mt-8 text-[14px] italic text-[#85785f]">Récits établis d’après les actes et les sources réunis dans GENEALIS — édition du {today}.</p>
      </div>
    </Page>
  )
}

/** Impression du livre entier : charge chaque chapitre, puis ouvre la boîte d'impression. */
function PrintWholeBook({ outline, onExit }: { outline: BookOutline; onExit: () => void }) {
  const list = outline.chapters.slice(0, PRINT_MAX)
  const [chapters, setChapters] = useState<BookChapter[]>([])
  const [done, setDone] = useState(false)
  const printed = useRef(false)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const out: BookChapter[] = []
      for (const c of list) {
        if (!alive) return
        try { out.push(await bookApi.chapter(c.person_id)) } catch { /* chapitre ignoré */ }
        if (out.length % 5 === 0) setChapters([...out])
      }
      if (alive) { setChapters(out); setDone(true) }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (done && !printed.current) { printed.current = true; setTimeout(() => window.print(), 900) }
  }, [done])
  const span = outline.span.start && outline.span.end ? `${outline.span.start} – ${outline.span.end}` : null
  return (
    <div className="mx-auto max-w-[1000px] pb-6">
      <div className="book-noprint sticky top-0 z-20 mb-3 flex items-center gap-3 rounded-2xl border border-[var(--hairline)] bg-[rgb(250_246_237/0.95)] px-3 py-2 font-sans text-[13.5px] backdrop-blur-xl">
        {!done ? <><Spinner /> Préparation du livre : {chapters.length} / {list.length} chapitres…</> : <>Livre prêt ({chapters.length} chapitres). <button className="btn-primary !h-8 !px-3 !text-[13px]" onClick={() => window.print()}><Printer size={14} />Imprimer / PDF</button></>}
        <button className="btn-ghost ml-auto !h-8 !px-3 !text-[13px]" onClick={onExit}>Retour</button>
      </div>
      <BookDesk>
        <Cover outline={outline} span={span} today={new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} />
        {chapters.map((ch, i) => <ChapterView key={ch.person_id} ch={ch} number={list.find((c) => c.person_id === ch.person_id)?.number ?? i + 1} showAi={false} mapEnabled={list.length <= PRINT_MAPS_MAX} anchorPrefix={`c${i}-`} />)}
      </BookDesk>
    </div>
  )
}
