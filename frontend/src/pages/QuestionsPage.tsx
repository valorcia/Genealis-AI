import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, CheckCircle2, ExternalLink, FileText, HelpCircle, History, Inbox, Lightbulb, Paperclip, PlusCircle, Search, X } from 'lucide-react'
import { api, ApiError, openExternal, type PersonSummary, type QuestionOut } from '../api'
import { useApp, type LiveEvent } from '../store'
import { Empty, Field, PersonLink, Spinner, formatDate } from '../components/ui'

type BandKey = 'blocking' | 'important' | 'useful'
const BANDS: { key: BandKey; label: string; hint: string; min: number; chip: string }[] = [
  { key: 'blocking', label: 'Bloquant', hint: 'Une décision généalogique attend votre réponse.', min: 80, chip: 'conf-red' },
  { key: 'important', label: 'Important', hint: 'Votre réponse accélère nettement les recherches.', min: 60, chip: 'conf-orange' },
  { key: 'useful', label: 'Utile', hint: 'Précisions bienvenues, sans urgence.', min: 0, chip: 'conf-grey' },
]
const bandOf = (priority: number) => (priority >= 80 ? 'blocking' : priority >= 60 ? 'important' : 'useful')

const ANSWER_LABEL: Record<string, string> = { yes: 'Oui', no: 'Non', unknown: 'Je ne sais pas', info: 'Information ajoutée', document: 'Document fourni', search_other: 'Rechercher autrement', dismiss: 'Ignorée' }

function errMsg(e: unknown, fallback: string) { return e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : fallback }

/** Rendu robuste d'un élément libre (chaîne ou objet) sans inventer de contenu. */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['label', 'title', 'text', 'description', 'fact', 'value']) if (typeof o[k] === 'string') return o[k] as string
    return Object.entries(o).filter(([, x]) => x !== null && x !== undefined && typeof x !== 'object').map(([k, x]) => `${k} : ${String(x)}`).join(' · ')
  }
  return ''
}
function hypothesisOf(v: unknown): { label: string; score: number | null; detail: string | null } {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const score = typeof o.score === 'number' ? o.score : null
    const detail = typeof o.description === 'string' && typeof o.label === 'string' ? o.description : null
    return { label: textOf(v), score, detail }
  }
  return { label: textOf(v), score: null, detail: null }
}

export default function QuestionsPage() {
  const { notify, refreshDashboard } = useApp()
  const [tab, setTab] = useState<'pending' | 'history'>('pending')
  const [pending, setPending] = useState<QuestionOut[] | null>(null)
  const [history, setHistory] = useState<QuestionOut[] | null>(null)
  const [persons, setPersons] = useState<Record<string, PersonSummary>>({})
  const [error, setError] = useState<string | null>(null)

  const loadPending = useCallback(async () => {
    try { setPending(await api.questions('pending')); setError(null) } catch (e) { setError(errMsg(e, 'Impossible de charger les questions.')) }
  }, [])
  const loadHistory = useCallback(async () => {
    try { setHistory((await api.questions('all')).filter((q) => q.status !== 'pending').sort((a, b) => (b.answered_at ?? b.created_at).localeCompare(a.answered_at ?? a.created_at))) } catch (e) { setError(errMsg(e, "Impossible de charger l'historique.")) }
  }, [])

  useEffect(() => { loadPending(); api.persons(undefined, 2000).then((ps) => setPersons(Object.fromEntries(ps.map((p) => [p.id, p])))).catch(() => { /* fiches absentes : lien brut */ }) }, [loadPending])
  useEffect(() => { if (tab === 'history') loadHistory() }, [tab, loadHistory])
  useEffect(() => {
    const h = (ev: Event) => { const d = (ev as CustomEvent<LiveEvent>).detail; if (d && d.type === 'question') { loadPending(); if (tab === 'history') loadHistory() } }
    window.addEventListener('genealis:event', h)
    return () => window.removeEventListener('genealis:event', h)
  }, [loadPending, loadHistory, tab])

  const onAnswered = (q: QuestionOut) => {
    setPending((list) => (list ? list.filter((x) => x.id !== q.id) : list))
    setHistory(null)
    refreshDashboard()
  }

  const groups = useMemo(() => BANDS.map((b) => ({ band: b, items: (pending ?? []).filter((q) => bandOf(q.priority) === b.key) })).filter((g) => g.items.length > 0), [pending])

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="fade-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold-600">Décisions généalogiques</div>
          <h1 className="font-display text-3xl text-night-900">Mes questions en attente</h1>
          <p className="mt-1 text-sm text-mist-500">Le moteur ne vous interrompt que lorsqu'une décision lui échappe. Chaque réponse est journalisée et appliquée immédiatement.</p>
        </div>
        <nav className="flex gap-1 rounded-xl border border-ivory-300 bg-ivory-50 p-1">
          <button className={`btn !py-1.5 ${tab === 'pending' ? 'bg-night-900 text-ivory-50' : 'text-night-900 hover:bg-ivory-200'}`} onClick={() => setTab('pending')}><Inbox size={15} /> En attente {pending && pending.length > 0 && <span className="rounded-full bg-gold-500 px-1.5 text-[11px] font-semibold text-night-950">{pending.length}</span>}</button>
          <button className={`btn !py-1.5 ${tab === 'history' ? 'bg-night-900 text-ivory-50' : 'text-night-900 hover:bg-ivory-200'}`} onClick={() => setTab('history')}><History size={15} /> Historique</button>
        </nav>
      </header>

      {error && <div className="rounded-xl border border-conf-red/30 bg-conf-red/10 px-4 py-3 text-sm text-conf-red">{error}</div>}

      {tab === 'pending' && (
        pending === null ? <div className="flex items-center gap-2 text-sm text-mist-500"><Spinner /> Chargement des questions…</div>
        : pending.length === 0 ? <Empty>Aucune question en attente — le moteur ne vous interrompra que si une décision généalogique l'exige.</Empty>
        : groups.map(({ band, items }) => (
          <section key={band.key} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <span className={`chip ${band.chip}`}>{band.label}</span>
              <span className="text-xs text-mist-500">{band.hint}</span>
              <span className="ml-auto text-xs text-mist-400">{items.length} question{items.length > 1 ? 's' : ''}</span>
            </div>
            {items.map((q) => <QuestionCard key={q.id} q={q} person={q.person_id ? persons[q.person_id] : undefined} onAnswered={onAnswered} notify={notify} />)}
          </section>
        ))
      )}

      {tab === 'history' && (
        history === null ? <div className="flex items-center gap-2 text-sm text-mist-500"><Spinner /> Chargement de l'historique…</div>
        : history.length === 0 ? <Empty>Aucune question n'a encore été traitée.</Empty>
        : <div className="space-y-2">{history.map((q) => <HistoryRow key={q.id} q={q} person={q.person_id ? persons[q.person_id] : undefined} />)}</div>
      )}
    </div>
  )
}

function PersonRef({ id, person }: { id: string | null; person?: PersonSummary }) {
  if (!id) return null
  if (person) return <PersonLink p={person} className="text-sm" />
  return <Link to={`/personnes/${id}`} className="text-sm font-medium text-night-900 hover:text-gold-600">Voir la fiche de la personne concernée</Link>
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-mist-500">{icon}{title}</div>
      <div className="text-sm leading-relaxed text-night-900">{children}</div>
    </div>
  )
}

type Mode = null | 'info' | 'document'
type Notify = (kind: 'info' | 'error' | 'success', text: string) => void

function QuestionCard({ q, person, onAnswered, notify }: { q: QuestionOut; person?: PersonSummary; onAnswered: (q: QuestionOut) => void; notify: Notify }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(null)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const band = BANDS.find((b) => b.key === bandOf(q.priority))!

  const send = async (answer_type: string, answer?: string, payload?: Record<string, unknown>, successText?: string) => {
    setBusy(answer_type); setErr(null)
    try {
      await api.answerQuestion(q.id, { answer_type, answer, payload })
      notify('success', successText ?? `Réponse enregistrée : ${ANSWER_LABEL[answer_type] ?? answer_type}.`)
      onAnswered(q)
    } catch (e) { const m = errMsg(e, "Impossible d'enregistrer la réponse."); setErr(m); notify('error', m) } finally { setBusy(null) }
  }

  const onFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    setBusy('document'); setErr(null)
    try {
      const media = await api.uploadMedia(file, { person_id: q.person_id ?? undefined, analyze: true })
      await api.answerQuestion(q.id, { answer_type: 'document', answer: file.name, payload: { media_id: media.id } })
      notify('success', `Document « ${file.name} » ajouté et transmis à l'analyse.`)
      onAnswered(q)
    } catch (e) { const m = errMsg(e, "Le document n'a pas pu être ajouté."); setErr(m); notify('error', m) } finally { setBusy(null) }
  }

  const docs = q.documents ?? []
  const facts = q.known_facts ?? []
  const hyps = q.hypotheses ?? []

  return (
    <article className="panel fade-up overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 border-b border-ivory-200 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl leading-snug text-night-900">{q.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mist-500">
            <PersonRef id={q.person_id} person={person} />
            <span>Posée le {formatDate(q.created_at)}</span>
            {q.task_id && <Link to="/enquetes" className="hover:text-gold-600">Enquête liée</Link>}
          </div>
        </div>
        <span className={`chip ${band.chip}`} title={`Priorité ${q.priority}/100`}>{band.label} · {q.priority}</span>
      </div>

      <div className="grid gap-5 px-5 py-4 md:grid-cols-2">
        {q.problem && <Section title="Le problème" icon={<AlertTriangle size={12} />}>{q.problem}</Section>}
        {facts.length > 0 && (
          <Section title="Éléments connus" icon={<Check size={12} />}>
            <ul className="list-disc space-y-0.5 pl-5">{facts.map((f, i) => <li key={i}>{textOf(f)}</li>)}</ul>
          </Section>
        )}
        {hyps.length > 0 && (
          <Section title="Hypothèses" icon={<Lightbulb size={12} />}>
            <ul className="space-y-1">
              {hyps.map((h, i) => { const x = hypothesisOf(h); return (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" />
                  <span>{x.label}{x.detail && <span className="text-mist-500"> — {x.detail}</span>}</span>
                  {x.score !== null && <span className="chip conf-orange ml-auto shrink-0">score {Math.round(x.score)}</span>}
                </li>
              ) })}
            </ul>
          </Section>
        )}
        {docs.length > 0 && (
          <Section title="Documents" icon={<FileText size={12} />}>
            <ul className="space-y-1">
              {docs.map((d, i) => (
                <li key={i} className="flex items-center gap-2">
                  {d.url && <button className="inline-flex items-center gap-1 text-night-900 underline decoration-ivory-300 underline-offset-2 hover:text-gold-600" onClick={() => openExternal(d.url!)}><ExternalLink size={12} />{d.title || d.url}</button>}
                  {!d.url && d.media_id && <Link to={`/archives?media=${d.media_id}`} className="inline-flex items-center gap-1 text-night-900 underline decoration-ivory-300 underline-offset-2 hover:text-gold-600"><Paperclip size={12} />{d.title || 'Document local'}</Link>}
                  {!d.url && !d.media_id && <span>{d.title ?? 'Document'}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {q.impact && <Section title="Impact de la réponse" icon={<HelpCircle size={12} />}>{q.impact}</Section>}
      </div>

      <div className="border-t border-ivory-200 bg-ivory-100/60 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-sage" disabled={busy !== null} onClick={() => send('yes', 'Oui')}>{busy === 'yes' ? <Spinner /> : <Check size={15} />} Oui</button>
          <button className="btn-ghost" disabled={busy !== null} onClick={() => send('no', 'Non')}>{busy === 'no' ? <Spinner /> : <X size={15} />} Non</button>
          <button className="btn-ghost" disabled={busy !== null} onClick={() => send('unknown', 'Je ne sais pas')}>{busy === 'unknown' ? <Spinner /> : <HelpCircle size={15} />} Je ne sais pas</button>
          <button className={`btn-ghost ${mode === 'info' ? '!border-gold-500 !bg-gold-500/10' : ''}`} disabled={busy !== null} onClick={() => setMode(mode === 'info' ? null : 'info')}><PlusCircle size={15} /> Ajouter une information</button>
          <button className="btn-ghost" disabled={busy !== null} onClick={() => fileRef.current?.click()}>{busy === 'document' ? <Spinner /> : <Paperclip size={15} />} Ajouter un document</button>
          <input ref={fileRef} type="file" className="hidden" accept="image/*,.pdf,.txt" onChange={onFile} />
          <button className="btn-ghost" disabled={busy !== null} onClick={() => send('search_other', 'Rechercher autrement', undefined, 'Nouvelle recherche demandée.')}>{busy === 'search_other' ? <Spinner /> : <Search size={15} />} Rechercher autrement</button>
          <button className="ml-auto text-xs text-mist-400 hover:text-conf-red disabled:opacity-50" disabled={busy !== null} onClick={() => send('dismiss', undefined, undefined, 'Question ignorée.')}>Ignorer</button>
        </div>
        {err && <div className="mt-2 text-xs text-conf-red">{err}</div>}
        {mode === 'info' && <InfoForm busy={busy === 'info'} onCancel={() => setMode(null)} onSubmit={(answer, payload) => send('info', answer, payload, 'Information enregistrée (à sourcer).')} />}
      </div>
    </article>
  )
}

function InfoForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (answer: string, payload: Record<string, unknown>) => void }) {
  const [text, setText] = useState('')
  const [given, setGiven] = useState('')
  const [surname, setSurname] = useState('')
  const [sex, setSex] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [birthPlace, setBirthPlace] = useState('')
  const [isParent, setIsParent] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)

  const submit = () => {
    const payload: Record<string, unknown> = {}
    if (isParent) {
      if (given.trim() || surname.trim()) payload.parent = { given_names: given.trim() || null, surname: surname.trim() || null, sex: sex || null }
    } else {
      if (given.trim()) payload.given_names = given.trim()
      if (surname.trim()) payload.surname = surname.trim()
      if (sex) payload.sex = sex
      if (birthDate.trim()) payload.birth_date = birthDate.trim()
      if (birthPlace.trim()) payload.birth_place = birthPlace.trim()
    }
    if (!text.trim() && Object.keys(payload).length === 0) { setLocalErr('Indiquez au moins une information (texte libre ou champ structuré).'); return }
    if (isParent && !payload.parent) { setLocalErr('Pour déclarer un parent, indiquez au moins un prénom ou un nom.'); return }
    setLocalErr(null)
    onSubmit(text.trim() || 'Information fournie', payload)
  }

  return (
    <div className="fade-up mt-3 rounded-xl border border-ivory-300 bg-white p-4">
      <div className="mb-3 text-xs text-mist-500">Ce que vous savez, même partiellement. Les champs laissés vides sont ignorés ; rien n'est déduit à votre place. L'information sera marquée « déclarée par l'utilisateur, à sourcer ».</div>
      <Field label="Information (texte libre)"><textarea className="input min-h-20" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex. : d'après le livret de famille, elle est née à Lunéville…" /></Field>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={isParent} onChange={(e) => setIsParent(e.target.checked)} /> Il s'agit d'un parent de la personne concernée (création d'une fiche reliée)</label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Prénoms"><input className="input" value={given} onChange={(e) => setGiven(e.target.value)} /></Field>
        <Field label="Nom"><input className="input" value={surname} onChange={(e) => setSurname(e.target.value)} /></Field>
        <Field label="Sexe"><select className="input" value={sex} onChange={(e) => setSex(e.target.value)}><option value="">Inconnu</option><option value="M">Masculin</option><option value="F">Féminin</option></select></Field>
        {!isParent && <Field label="Date de naissance"><input className="input" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} placeholder="12/03/1884, vers 1880, 1884…" /></Field>}
        {!isParent && <Field label="Lieu de naissance"><input className="input" value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} placeholder="Commune, département, pays" /></Field>}
      </div>
      {localErr && <div className="mt-2 text-xs text-conf-red">{localErr}</div>}
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>Annuler</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? <Spinner /> : <CheckCircle2 size={15} />} Enregistrer l'information</button>
      </div>
    </div>
  )
}

function HistoryRow({ q, person }: { q: QuestionOut; person?: PersonSummary }) {
  const dismissed = q.status === 'dismissed'
  return (
    <div className="panel fade-up flex flex-wrap items-start gap-3 px-4 py-3">
      <span className={`chip ${dismissed ? 'conf-grey' : 'conf-green'} mt-0.5 shrink-0`}>{dismissed ? 'Ignorée' : 'Répondue'}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-night-900">{q.title}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-mist-500">
          <PersonRef id={q.person_id} person={person} />
          {q.answered_at && <span>{formatDate(q.answered_at)}</span>}
        </div>
        {(q.answer_type || q.answer) && (
          <div className="mt-1 text-sm text-night-900">
            <span className="font-medium">{ANSWER_LABEL[q.answer_type ?? ''] ?? q.answer_type}</span>
            {q.answer && q.answer !== ANSWER_LABEL[q.answer_type ?? ''] && <span className="text-mist-500"> — {q.answer}</span>}
          </div>
        )}
      </div>
      <span className="text-xs text-mist-400">priorité {q.priority}</span>
    </div>
  )
}
