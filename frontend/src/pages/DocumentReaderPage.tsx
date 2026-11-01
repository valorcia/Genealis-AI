import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, BadgeCheck, BookOpenText, ChevronDown, Eye, History, Image as ImageIcon, Languages, RefreshCw, ScanText, ShieldCheck, UsersRound } from 'lucide-react'
import { api, type MediaOut } from '../api'
import { Spinner } from '../components/ui'
import { Callout } from '../components/import/shared'
import { ImageViewer, type ViewerHighlight } from '../components/reader/ImageViewer'
import { TranscriptPanel, type Layer } from '../components/reader/TranscriptPanel'
import { PhotoPanel, TranslationPanel } from '../components/reader/TranslationPanel'
import { PeoplePanel } from '../components/reader/PeoplePanel'
import { ManualRead, QualityPanel, ReadOptionsForm } from '../components/reader/ReadControls'
import { paleoApi, STATUS_LABEL, type BBox, type Mention, type PaleoCatalog, type ReadOptions, type Reading, type ReadingSummary, type ReferenceInfo } from '../lib/paleoApi'

type Tab = 'image' | 'text' | 'translation' | 'people'
const TABS: { id: Tab; label: string; icon: typeof ImageIcon }[] = [
  { id: 'image', label: 'Original', icon: ImageIcon }, { id: 'text', label: 'Transcription', icon: ScanText },
  { id: 'translation', label: 'Traduction', icon: Languages }, { id: 'people', label: 'Personnes', icon: UsersRound },
]
const STATUS_CHIP: Record<string, string> = { draft: 'conf-orange', reviewed: 'conf-grey', validated: 'conf-green' }
const fmt = (ts: string | null) => (ts ? new Date(ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '')

function overlap(a: BBox, b: BBox): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])
  return w > 0 && h > 0 ? w * h : 0
}

export default function DocumentReaderPage() {
  const { mediaId = '' } = useParams()
  const navigate = useNavigate()
  const [media, setMedia] = useState<MediaOut | null>(null)
  const [catalog, setCatalog] = useState<PaleoCatalog | null>(null)
  const [refs, setRefs] = useState<ReferenceInfo[]>([])
  const [versions, setVersions] = useState<ReadingSummary[]>([])
  const [reading, setReading] = useState<Reading | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [layer, setLayer] = useState<Layer>('diplomatic')
  const [tab, setTab] = useState<Tab>('image')
  const [selectedLine, setSelectedLine] = useState<number | null>(null)
  const [activePassage, setActivePassage] = useState<{ line: number; index: number } | null>(null)
  const [personHighlight, setPersonHighlight] = useState<BBox | null>(null)
  const [mentions, setMentions] = useState<Mention[]>([])
  const [mentionsLoaded, setMentionsLoaded] = useState(false)
  const [showOptions, setShowOptions] = useState(false)

  const openReading = useCallback(async (id: string) => {
    const r = await paleoApi.reading(id)
    setReading(r)
    setSelectedLine(null); setActivePassage(null); setPersonHighlight(null)
    setMentionsLoaded(false); setMentions([])
    if (r.mentions_count) paleoApi.mentions(r.id).then((m) => { setMentions(m); setMentionsLoaded(true) }).catch(() => setMentionsLoaded(true))
    else setMentionsLoaded(true)
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([api.mediaDetail(mediaId), paleoApi.readings(mediaId), paleoApi.catalog().catch(() => null), paleoApi.benchmarks().catch(() => null)])
      .then(async ([m, rs, cat, bm]) => {
        if (!alive) return
        setMedia(m); setVersions(rs); setCatalog(cat); setRefs(bm?.references ?? [])
        if (rs.length) await openReading(rs[0].id)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [mediaId, openReading])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null); setNotice(null)
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  const read = (opts: ReadOptions) => run('read', async () => {
    const r = await paleoApi.read(mediaId, opts)
    setVersions(await paleoApi.readings(mediaId))
    await openReading(r.id)
    setShowOptions(false)
    setTab('text')
    setNotice(`Lecture n° ${r.version} enregistrée${r.preprocessing?.cached ? ' (réponse déjà connue : aucun nouvel appel)' : ''}. Les versions précédentes sont conservées.`)
  })

  const correct = async (n: number, text: string, l: Layer, note?: string) => {
    if (!reading) return
    await run(`c${n}`, async () => { setReading(await paleoApi.correct(reading.id, n, { text, layer: l, note })); setNotice('Correction enregistrée. Elle servira aux prochaines lectures de la même main.') })
  }
  const recheck = async (n: number, index: number) => {
    if (!reading) return
    await run(`r${n}-${index}`, async () => {
      const res = await paleoApi.recheck(reading.id, { line_n: n, index })
      setReading(res.reading)
      setNotice('Deuxième lecture agrandie terminée : la lecture affichée n’a pas été remplacée, comparez les propositions.')
    })
  }
  const recheckZone = async (bbox: BBox) => {
    if (!reading) return
    const withBox = reading.lines.filter((l) => l.bbox)
    let line = withBox.map((l) => ({ l, o: overlap(l.bbox as BBox, bbox) })).sort((a, b) => b.o - a.o)[0]
    if (!line || line.o === 0) {
      const cy = bbox[1] + bbox[3] / 2
      line = withBox.map((l) => ({ l, o: -Math.abs((l.bbox as BBox)[1] + (l.bbox as BBox)[3] / 2 - cy) })).sort((a, b) => b.o - a.o)[0]
    }
    if (!line) { setError('Aucune ligne lue près de cette zone : lancez d’abord une lecture.'); return }
    await run('zone', async () => {
      const res = await paleoApi.recheck(reading.id, { line_n: line.l.n, bbox })
      setReading(res.reading)
      const ln = res.reading.lines.find((x) => x.n === line.l.n)
      setSelectedLine(line.l.n)
      setActivePassage({ line: line.l.n, index: Math.max(0, (ln?.uncertain.length ?? 1) - 1) })
      setTab('text')
      setNotice(`Zone relue en agrandi (ligne ${line.l.n}). Rien n’a été remplacé : choisissez vous-même la bonne lecture.`)
    })
  }
  const validate = () => {
    if (!reading || !window.confirm('Confirmez-vous avoir relu toute la transcription en la comparant à l’image ?')) return
    void run('validate', async () => { setReading(await paleoApi.validate(reading.id)); setVersions(await paleoApi.readings(mediaId)); setNotice('Lecture validée. Les passages encore incertains restent signalés.') })
  }
  const extract = () => {
    if (!reading) return
    void run('mentions', async () => { setMentions(await paleoApi.extractMentions(reading.id)); setMentionsLoaded(true); setTab('people') })
  }

  const highlight: ViewerHighlight | null = useMemo(() => {
    if (!reading) return null
    if (personHighlight) return { bbox: personHighlight, tone: 'person' }
    if (activePassage) {
      const u = reading.lines.find((l) => l.n === activePassage.line)?.uncertain[activePassage.index]
      if (u?.bbox) return { bbox: u.bbox, tone: 'uncertain' }
    }
    const l = reading.lines.find((x) => x.n === selectedLine)
    return l?.bbox ? { bbox: l.bbox, tone: 'line' } : null
  }, [reading, selectedLine, activePassage, personHighlight])

  const selectLine = (n: number, passage?: number | null) => {
    setSelectedLine(n); setPersonHighlight(null)
    setActivePassage(passage != null ? { line: n, index: passage } : null)
  }

  if (loading) return <div className="flex items-center gap-2 p-6 text-mist-500"><Spinner />Ouverture du document…</div>
  if (!media) return <div className="p-6"><Callout tone="warn" icon={AlertTriangle}>{error ?? 'Document introuvable.'}</Callout></div>

  const isPhoto = reading?.document_kind === 'photo'
  const extraWarnings = (reading?.warnings ?? []).filter((w) => !w.startsWith('Lecture automatique'))
  const show = (t: Tab) => (tab === t ? '' : 'max-lg:hidden')
  const viewer = (
    <ImageViewer mediaId={media.id} title={media.title ?? 'Document'} lines={reading?.lines ?? []} selectedLine={selectedLine}
      highlight={highlight} onSelectLine={(n) => selectLine(n)} onRecheckZone={reading && !isPhoto ? (b) => void recheckZone(b) : undefined}
      recheckBusy={busy === 'zone'} className="h-[64dvh] lg:h-[calc(100dvh-13.5rem)] lg:min-h-[520px]" />
  )

  const optionsPanel = (
    <section className="panel fade-up space-y-3 p-4">
      {!reading && (
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gold-500/12 text-gold-600"><BookOpenText size={22} /></span>
          <div>
            <h2 className="font-display text-[19px] text-night-900">Ce document n’a pas encore été lu</h2>
            <p className="text-[13.5px] text-mist-500">GENEALIS identifie l’écriture et la langue, transcrit ligne par ligne en gardant l’orthographe d’origine, signale les passages incertains, propose une version modernisée et une traduction.</p>
          </div>
        </div>
      )}
      {reading && <h2 className="font-display text-[18px] text-night-900">Relire le document (nouvelle version)</h2>}
      <ReadOptionsForm catalog={catalog} busy={busy === 'read'} onRead={(o) => void read(o)} compact={!reading}
        initial={reading ? { script_type: reading.script_type && reading.script_type !== 'unknown' ? reading.script_type : '', language: reading.language ?? '', scribe_key: reading.scribe_key ?? '' } : undefined} />
      <ManualRead mediaId={media.id} busy={busy === 'read'} onSubmit={(t) => void read({ engine: 'manual', manual_text: t })} />
    </section>
  )

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <button type="button" className="btn-ghost !h-10 !w-10 shrink-0 !p-0" aria-label="Retour" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/archives'))}><ArrowLeft size={18} /></button>
          <div className="min-w-0">
            <div className="eyebrow text-brass-600">Lecture du document</div>
            <h1 className="truncate font-display text-[22px] leading-tight text-night-900 sm:text-[26px]">{media.title ?? media.original_filename ?? 'Document'}</h1>
            {reading && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-mist-500">
                <span className={`chip ${STATUS_CHIP[reading.status]}`}>{STATUS_LABEL[reading.status]}</span>
                {reading.script_label && <span className="chip conf-grey">{reading.script_label}</span>}
                {reading.language_label && !(reading.script_type === 'latin_ecclesiastical' && reading.language === 'la') && <span className="chip conf-grey">{reading.language_label}</span>}
                {reading.period_estimate && <span>{reading.period_estimate}</span>}
                {reading.uncertain_count > 0 && <span className="chip conf-orange">{reading.uncertain_count} passage(s) incertain(s)</span>}
              </div>
            )}
          </div>
        </div>
        {reading && (
          <div className="flex flex-wrap items-center gap-1.5">
            {versions.length > 1 && (
              <label className="relative">
                <span className="sr-only">Version de la lecture</span>
                <History size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mist-500" />
                <select className="input !min-h-10 !w-auto !py-1.5 !pl-8 !text-[13px]" value={reading.id} onChange={(e) => void run('open', () => openReading(e.target.value))}>
                  {versions.map((v) => <option key={v.id} value={v.id}>Lecture n° {v.version} · {fmt(v.created_at)} · {STATUS_LABEL[v.status]}</option>)}
                </select>
              </label>
            )}
            <button type="button" className="btn-ghost !py-2 text-[13.5px]" onClick={() => setShowOptions((s) => !s)}><RefreshCw size={15} />Relire<ChevronDown size={14} className={showOptions ? 'rotate-180' : ''} /></button>
            {reading.status !== 'validated' && <button type="button" className="btn-sage !py-2 text-[13.5px]" disabled={busy !== null} onClick={validate}><BadgeCheck size={15} />J’ai tout vérifié</button>}
          </div>
        )}
      </header>

      {reading && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-gold-500/35 bg-gold-500/[0.07] px-3 py-2.5 text-[13.5px] text-night-900">
          <Eye size={17} className="mt-0.5 shrink-0 text-gold-600" />
          <div className="min-w-0">
            <strong>Lecture automatique : à vérifier.</strong> {reading.status === 'validated' ? 'Vous l’avez relue et validée ; les passages encore incertains restent des hypothèses.' : 'Comparez chaque ligne avec l’image, surtout les noms, les dates et les passages surlignés. Une hypothèse de lecture n’est jamais une certitude.'}
            {extraWarnings.length > 0 && (
              <details className="mt-1"><summary className="cursor-pointer text-[12.5px] text-mist-500">{extraWarnings.length} remarque(s) sur cette lecture</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px]">{extraWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </details>
            )}
          </div>
        </div>
      )}
      {error && <Callout tone="warn" icon={AlertTriangle}>{error}</Callout>}
      {notice && <Callout tone="info" icon={ShieldCheck}>{notice}</Callout>}

      {showOptions && reading && optionsPanel}

      {reading && (
        <div className="sticky top-0 z-20 -mx-1 flex gap-1 rounded-xl bg-ivory-200/90 p-1 backdrop-blur lg:hidden" role="tablist" aria-label="Affichage">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg text-[12.5px] ${tab === id ? 'bg-white font-medium text-night-900 shadow-sm' : 'text-mist-500'}`}>
              <Icon size={14} className="max-sm:hidden" />{label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.75fr)]">
        <div className={`min-w-0 lg:sticky lg:top-0 lg:self-start ${reading ? show('image') : ''}`}>{viewer}</div>
        {!reading && <div className="min-w-0 max-lg:order-first">{optionsPanel}</div>}
        {reading && (
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.78fr)]">
            <div className={`min-w-0 ${show('text')} lg:h-[58dvh] xl:h-[calc(100dvh-13.5rem)] xl:min-h-[520px] [&>section]:h-full`}>
              <TranscriptPanel reading={reading} layer={layer} onLayer={setLayer} selectedLine={selectedLine} onSelectLine={selectLine}
                activePassage={activePassage} onCorrect={correct} onRecheck={recheck} busy={busy}
                onShowOnImage={(n) => { selectLine(n); setTab('image') }} />
            </div>
            <div className={`min-w-0 ${show('translation')} lg:max-h-[48dvh] xl:max-h-none xl:h-[calc(100dvh-13.5rem)] xl:min-h-[520px] [&>section]:h-full [&>section]:overflow-auto`}>
              {isPhoto ? <PhotoPanel reading={reading} /> : <TranslationPanel reading={reading} selectedLine={selectedLine} onSelectLine={selectLine} />}
            </div>
          </div>
        )}
      </div>

      {reading && !isPhoto && (
        <div className={show('people')}>
          {reading.extraction?.summary_fr && <p className="mb-3 rounded-2xl bg-ivory-100 px-3 py-2 text-[14px] text-night-900">{reading.extraction.summary_fr} <span className="text-[12px] text-mist-500">(résumé automatique)</span></p>}
          <PeoplePanel mentions={mentions} loaded={mentionsLoaded} busy={busy === 'mentions'} onExtract={extract}
            onShow={(b, line) => { setSelectedLine(line); setActivePassage(null); setPersonHighlight(b); setTab('image') }} />
        </div>
      )}
      {reading && isPhoto && <div className={`${show('people')} lg:hidden`}><PhotoPanel reading={reading} /></div>}

      {reading && (
        <div className="grid gap-3 lg:grid-cols-2">
          <details className="panel p-4">
            <summary className="flex cursor-pointer items-center gap-2 font-display text-[17px] text-night-900"><History size={16} className="text-mist-500" />À propos de cette lecture</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
              <dt className="text-mist-500">Lecture</dt><dd>n° {reading.version} du {fmt(reading.created_at)}</dd>
              <dt className="text-mist-500">Moteur</dt><dd>{reading.engine}{reading.model ? ` (${reading.model})` : ''}{reading.preprocessing?.cached ? ' · réponse en cache' : ''}</dd>
              <dt className="text-mist-500">Copie de travail</dt><dd>{(reading.preprocessing?.operations ?? []).join(', ') || 'aucune retouche'}</dd>
              <dt className="text-mist-500">Original</dt><dd>intact{reading.preprocessing?.original_sha256 ? ` (empreinte ${reading.preprocessing.original_sha256.slice(0, 12)}…)` : ''}</dd>
              {reading.scribe_key && <><dt className="text-mist-500">Même main</dt><dd>{reading.scribe_key}</dd></>}
              <dt className="text-mist-500">Relectures agrandies</dt><dd>{reading.quality.second_pass_done ?? 0}</dd>
              {reading.quality.self_assessment && <><dt className="text-mist-500">Avis du modèle</dt><dd>{reading.quality.self_assessment} <span className="text-mist-500">(auto-évaluation, pas une mesure)</span></dd></>}
              <dt className="text-mist-500">Corrections</dt><dd>{reading.corrections.length}</dd>
            </dl>
            {reading.corrections.length > 0 && (
              <ul className="mt-2 space-y-1 text-[12.5px]">{reading.corrections.map((c) => <li key={c.id} className="rounded-lg bg-white px-2 py-1 ring-1 ring-ivory-200">Ligne {c.line_n} · <s className="text-mist-500">{c.before}</s> → {c.after}{c.note ? <span className="text-mist-500"> — {c.note}</span> : null}</li>)}</ul>
            )}
            <p className="mt-2 text-[12px] text-mist-500"><Link className="underline" to="/archives">Retour aux archives et documents</Link></p>
          </details>
          {!isPhoto && <QualityPanel readingId={reading.id} refs={refs} />}
        </div>
      )}
    </div>
  )
}
