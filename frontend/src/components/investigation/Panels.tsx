/** Colonnes de la vue d'enquête : missions et personnes, navigateur et documents, fil d'activité, découvertes. */
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, BookOpen, Check, ChevronDown, ChevronUp, CircleDollarSign, Compass, ExternalLink, Eye, FileSearch, FileText, GitBranch, Globe, Hand, HelpCircle,
  Info, Lightbulb, ListChecks, MonitorSmartphone, RotateCcw, Search, ShieldAlert, Sparkles, UserRound, X,
} from 'lucide-react'
import { api, CONF_LABEL, openExternal } from '../../api'
import { ConfidenceDot, Spinner } from '../ui'
import { AI } from '../person/helpers'
import { StatusBadge, clockTime, relTime, toConf, type Conf } from './common'
import {
  STRATEGY_LABEL, TASK_KIND_LABEL,
  type DiscoveryOut, type Evidence, type InvestigationDetail, type InvestigationEvent, type PageVisitOut, type TaskOut,
} from '../../lib/investigationApi'

export function Column({ title, icon, count, actions, children, className = '' }: { title: string; icon: ReactNode; count?: number; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel min-w-0 p-4 ${className}`}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 font-display text-[18px] leading-tight text-night-900">
          <span className="text-mist-500">{icon}</span><span className="truncate">{title}</span>
          {count !== undefined && count > 0 && <span className="rounded-full bg-mist-200 px-1.5 font-sans text-[11px] font-semibold text-mist-500">{count}</span>}
        </h2>
        {actions}
      </header>
      {children}
    </section>
  )
}
function Quiet({ children }: { children: ReactNode }) { return <p className="rounded-xl bg-ivory-100/70 p-3 text-center text-[13px] text-mist-500">{children}</p> }

/* =================================================================== Missions et personnes */
const TASK_ORDER: Record<string, number> = { running: 0, blocked: 1, to_verify: 2, pending: 3, failed: 4, done: 5, cancelled: 6 }

export function taskUrl(t: TaskOut): string | null {
  const u = (t.params?.url ?? t.params?.start_url ?? (t.result as Record<string, unknown>)?.url) as unknown
  return typeof u === 'string' && /^https?:\/\//.test(u) ? u : null
}
export function needsHuman(t: TaskOut): boolean {
  return t.status === 'blocked' && (t.kind === 'human_assist' || Boolean((t.result as Record<string, unknown>)?.needs_human))
}

export function PersonsList({ inv }: { inv: InvestigationDetail }) {
  if (!inv.persons?.length) return <Quiet>Les personnes recherchées apparaîtront ici au fil de l’enquête.</Quiet>
  return (
    <ul className="space-y-1">
      {[...inv.persons].sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0) || (a.sosa?.[0] ?? 0) - (b.sosa?.[0] ?? 0)).map((p) => (
        <li key={p.id}>
          <Link to={`/personnes/${p.id}`} className="-mx-1.5 flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-ivory-100">
            <UserRound size={15} className="shrink-0 text-mist-400" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-snug text-night-900 [overflow-wrap:anywhere]">{p.name}</span>
              <span className="block text-[11px] text-mist-500">{p.generation !== null && p.generation !== undefined ? `Génération ${p.generation}` : 'Génération ?'}{p.sosa?.length ? ` · Sosa ${p.sosa.join(', ')}` : ''}</span>
            </span>
            <StatusBadge status={p.status} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function TasksList({ tasks, busy, onRetry, onHumanDone }: { tasks: TaskOut[]; busy: string | null; onRetry: (t: TaskOut) => void; onHumanDone: (t: TaskOut) => void }) {
  const [showDone, setShowDone] = useState(false)
  const sorted = useMemo(() => [...tasks].sort((a, b) => (TASK_ORDER[a.status] ?? 9) - (TASK_ORDER[b.status] ?? 9) || b.priority - a.priority), [tasks])
  const open = sorted.filter((t) => t.status !== 'done' && t.status !== 'cancelled')
  const done = sorted.filter((t) => t.status === 'done' || t.status === 'cancelled')
  if (!tasks.length) return <Quiet>L’IA prépare son plan de recherche…</Quiet>
  return (
    <div className="space-y-2">
      {open.map((t) => <TaskItem key={t.id} t={t} busy={busy === t.id} onRetry={onRetry} onHumanDone={onHumanDone} />)}
      {done.length > 0 && (
        <>
          <button className="flex w-full items-center justify-center gap-1 py-1 text-[13px] font-medium text-ios-blue" onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'Masquer' : 'Voir'} les {done.length} mission{done.length > 1 ? 's' : ''} terminée{done.length > 1 ? 's' : ''} {showDone ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showDone && done.map((t) => <TaskItem key={t.id} t={t} busy={busy === t.id} onRetry={onRetry} onHumanDone={onHumanDone} />)}
        </>
      )}
    </div>
  )
}

function TaskItem({ t, busy, onRetry, onHumanDone }: { t: TaskOut; busy: boolean; onRetry: (t: TaskOut) => void; onHumanDone: (t: TaskOut) => void }) {
  const url = taskUrl(t)
  const retryable = ['failed', 'blocked', 'to_verify'].includes(t.status) && !needsHuman(t)
  return (
    <div className={`rounded-xl border p-2.5 ${t.status === 'running' ? 'border-[#5b3fd6]/30 bg-[#ece6ff]/40' : 'border-[var(--hairline)] bg-white/70'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-[11px] font-medium uppercase tracking-[0.06em] text-mist-500">{TASK_KIND_LABEL[t.kind] ?? t.kind}{t.generation !== null && t.generation !== undefined ? ` · gén. ${t.generation}` : ''}</div>
        <StatusBadge status={t.status} label={t.status_label} />
      </div>
      <div className="mt-1 text-[13px] font-medium leading-snug text-night-900 [overflow-wrap:anywhere]">{t.title}</div>
      {(t.strategy || t.attempts > 1) && (
        <div className="mt-1 text-[11px] text-mist-500">{t.strategy ? `Méthode : ${STRATEGY_LABEL[t.strategy] ?? t.strategy}` : ''}{t.attempts > 1 ? `${t.strategy ? ' · ' : ''}${t.attempts} tentatives` : ''}</div>
      )}
      {t.last_error && t.status !== 'done' && <div className="mt-1 text-[12px] leading-snug text-conf-red [overflow-wrap:anywhere]">{t.last_error}</div>}
      {(retryable || needsHuman(t) || url) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {url && <button className="btn-ghost !px-2.5 !py-1 !text-[12px]" onClick={() => openExternal(url)}><ExternalLink size={12} />Ouvrir le site</button>}
          {needsHuman(t) && <button className="btn-primary !px-2.5 !py-1 !text-[12px]" disabled={busy} onClick={() => onHumanDone(t)}>{busy ? <Spinner /> : <Check size={12} />}J’ai terminé</button>}
          {retryable && <button className="btn-ghost !px-2.5 !py-1 !text-[12px]" disabled={busy} onClick={() => onRetry(t)}>{busy ? <Spinner /> : <RotateCcw size={12} />}{t.kind === 'analyze_document' ? 'Analyser à nouveau' : 'Réessayer'}</button>}
        </div>
      )}
    </div>
  )
}

/* =================================================================== Navigateur et documents */
const OUTCOME: Record<string, { label: string; cls: string }> = {
  ok: { label: 'Page lue', cls: 'conf-green' }, blocked: { label: 'Bloquée', cls: 'conf-orange' }, failed: { label: 'Échec', cls: 'conf-red' },
  no_result: { label: 'Aucun résultat', cls: 'conf-grey' }, restricted: { label: 'Accès restreint', cls: 'conf-orange' },
}
function Outcome({ o }: { o: string | null }) {
  if (!o) return null
  const x = OUTCOME[o] ?? { label: o, cls: 'conf-grey' }
  return <span className={`chip ${x.cls}`}>{x.label}</span>
}
function Shot({ mediaId, alt }: { mediaId: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <div className="flex aspect-[16/10] w-full items-center justify-center rounded-xl bg-mist-100 text-xs text-mist-500">Capture indisponible</div>
  return <img src={api.mediaFileUrl(mediaId)} alt={alt} loading="lazy" onError={() => setFailed(true)} className="aspect-[16/10] w-full rounded-xl border border-[var(--hairline)] bg-white object-cover object-top" />
}

export function BrowserView({ pages, running }: { pages: PageVisitOut[]; running: boolean }) {
  const [sel, setSel] = useState<string | null>(null)
  const sorted = useMemo(() => [...pages].sort((a, b) => (a.ts < b.ts ? 1 : -1)), [pages])
  const page = sorted.find((p) => p.id === sel) ?? sorted[0]
  if (!page) return (
    <Quiet>{running ? 'Aucune page ouverte pour l’instant. Les sites visités par le navigateur autonome s’afficheront ici, avec une capture.' : 'Aucune page n’a été ouverte pendant cette enquête.'}</Quiet>
  )
  const flags = (page.security_flags ?? []).map((f) => (typeof f === 'string' ? f : JSON.stringify(f)))
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-white">
        <div className="flex items-center gap-2 border-b border-[var(--hairline)] bg-ivory-100 px-3 py-2">
          <span className="flex gap-1"><span className="h-2.5 w-2.5 rounded-full bg-mist-300" /><span className="h-2.5 w-2.5 rounded-full bg-mist-300" /><span className="h-2.5 w-2.5 rounded-full bg-mist-300" /></span>
          <span className="min-w-0 flex-1 truncate rounded-md bg-white px-2 py-0.5 text-[12px] text-night-900/80" title={page.url}>{page.url}</span>
          <button className="shrink-0 text-ios-blue" title="Ouvrir la page dans votre navigateur" onClick={() => openExternal(page.url)}><ExternalLink size={14} /></button>
        </div>
        <div className="p-2.5">
          {page.screenshot_media_id ? <Shot mediaId={page.screenshot_media_id} alt={`Capture de ${page.domain ?? page.url}`} /> : <div className="flex aspect-[16/10] w-full items-center justify-center rounded-xl bg-mist-100 text-xs text-mist-500">Pas de capture pour cette page</div>}
        </div>
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Outcome o={page.outcome} />
          {page.strategy && <span className="chip conf-grey">{STRATEGY_LABEL[page.strategy] ?? page.strategy}</span>}
          <span className="text-xs text-mist-500">{relTime(page.ts)}</span>
        </div>
        <div className="mt-1 text-sm font-medium text-night-900 [overflow-wrap:anywhere]">{page.title || page.domain || page.url}</div>
        {page.text_excerpt && <p className="mt-1 line-clamp-4 text-[13px] leading-relaxed text-night-900/75">« {page.text_excerpt} »</p>}
        <p className="mt-1 text-[11px] text-mist-500">Le contenu des pages est traité comme une simple donnée : il n’est jamais exécuté comme une instruction.</p>
        {flags.length > 0 && <div className="mt-2 flex items-start gap-2 rounded-xl bg-conf-orange/10 px-3 py-2 text-[12px] text-[#87510f]"><ShieldAlert size={14} className="mt-0.5 shrink-0" /><span>Alerte de sécurité : {flags.join(' · ')}</span></div>}
      </div>
      {sorted.length > 1 && (
        <div>
          <div className="label">Pages précédentes</div>
          <ul className="max-h-40 space-y-0.5 overflow-auto scrollbar-thin">
            {sorted.slice(0, 20).map((p) => (
              <li key={p.id}>
                <button onClick={() => setSel(p.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px] hover:bg-ivory-100 ${p.id === page.id ? 'bg-ivory-100' : ''}`}>
                  <Globe size={12} className="shrink-0 text-mist-400" /><span className="min-w-0 flex-1 truncate text-night-900">{p.domain ?? p.url}</span><span className="shrink-0 text-mist-400">{clockTime(p.ts).slice(0, 5)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Documents trouvés pendant l'enquête (résultats de navigation, tâches de lecture, découvertes). */
export function collectDocuments(inv: InvestigationDetail): { mediaId: string; task: TaskOut | null }[] {
  const out = new Map<string, TaskOut | null>()
  const add = (v: unknown, task: TaskOut | null) => { if (typeof v === 'string' && v && !out.has(v)) out.set(v, task); else if (typeof v === 'string' && task && !out.get(v)) out.set(v, task) }
  for (const t of inv.tasks ?? []) {
    const docs = (t.result as Record<string, unknown>)?.documents
    if (Array.isArray(docs)) docs.forEach((d) => add(typeof d === 'object' && d ? (d as Record<string, unknown>).media_id : d, null))
    if (t.kind === 'analyze_document') add(t.params?.media_id, t)
  }
  for (const p of inv.recent_pages ?? []) (p.downloads ?? []).forEach((d) => add(typeof d === 'object' && d ? (d as Record<string, unknown>).media_id : null, null))
  for (const d of inv.discoveries ?? []) (d.evidence ?? []).forEach((e) => add(e.media_id, null))
  return [...out.entries()].map(([mediaId, task]) => ({ mediaId, task }))
}

function DocThumb({ mediaId }: { mediaId: string }) {
  const [failed, setFailed] = useState(false)
  return failed
    ? <span className="flex h-full w-full items-center justify-center bg-mist-100 text-mist-500"><FileText size={22} /></span>
    : <img src={api.mediaFileUrl(mediaId)} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
}

export function DocumentsGrid({ docs, busy, onReanalyze }: { docs: { mediaId: string; task: TaskOut | null }[]; busy: string | null; onReanalyze: (t: TaskOut) => void }) {
  if (!docs.length) return <Quiet>Aucun document trouvé pour l’instant. Chaque acte récupéré sera conservé intact dans vos archives, avec sa provenance.</Quiet>
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {docs.map(({ mediaId, task }) => (
        <li key={mediaId} className="overflow-hidden rounded-xl border border-[var(--hairline)] bg-white">
          <Link to={`/documents/${mediaId}/lecture`} className="block aspect-[4/3] overflow-hidden bg-mist-100" title="Ouvrir dans le lecteur"><DocThumb mediaId={mediaId} /></Link>
          <div className="space-y-1 p-2">
            {task && <StatusBadge status={task.status} label={task.status === 'done' ? 'LU' : task.status_label} />}
            <Link to={`/documents/${mediaId}/lecture`} className="flex items-center gap-1 text-[12px] font-medium text-ios-blue"><BookOpen size={12} />Lire le document</Link>
            {task && ['done', 'failed', 'to_verify', 'blocked'].includes(task.status) && (
              <button className="flex items-center gap-1 text-left text-[12px] text-night-900/70 hover:text-night-900 disabled:opacity-50" disabled={busy === task.id} onClick={() => onReanalyze(task)}>
                {busy === task.id ? <Spinner /> : <RotateCcw size={12} />}Analyser à nouveau
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/* =================================================================== Fil d'activité */
const EVENT_ICON: Record<string, { icon: ReactNode; color: string }> = {
  info: { icon: <Info size={13} />, color: '#6b665c' }, plan: { icon: <ListChecks size={13} />, color: AI.color },
  search: { icon: <Search size={13} />, color: '#2c4f86' }, page: { icon: <Globe size={13} />, color: '#2c4f86' },
  document: { icon: <FileSearch size={13} />, color: '#876a2e' }, analysis: { icon: <FileText size={13} />, color: '#876a2e' },
  discovery: { icon: <Sparkles size={13} />, color: AI.color }, filiation: { icon: <GitBranch size={13} />, color: '#3f8a50' },
  hypothesis: { icon: <Lightbulb size={13} />, color: '#c47a1e' }, question: { icon: <HelpCircle size={13} />, color: '#c47a1e' },
  cost: { icon: <CircleDollarSign size={13} />, color: '#6b665c' }, error: { icon: <AlertTriangle size={13} />, color: '#b9432f' },
  human: { icon: <Hand size={13} />, color: '#c47a1e' },
}
export function ActivityFeed({ events, live, missing }: { events: InvestigationEvent[]; live: boolean; missing: boolean }) {
  const [all, setAll] = useState(false)
  if (missing) return <Quiet>Le fil d’activité n’est pas encore disponible sur ce moteur.</Quiet>
  const list = [...events].reverse()
  if (!list.length) return <Quiet>{live ? 'En attente des premières actions de l’IA…' : 'Aucune activité enregistrée.'}</Quiet>
  return (
    <div>
      <ol className="space-y-1.5">
        {(all ? list : list.slice(0, 40)).map((e) => {
          const m = EVENT_ICON[e.kind] ?? EVENT_ICON.info
          const url = typeof e.data?.url === 'string' && /^https?:\/\//.test(e.data.url) ? e.data.url : null
          return (
            <li key={e.id} className="flex gap-2.5 text-[13px] leading-snug">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: `${m.color}1a`, color: m.color }}>{m.icon}</span>
              <span className="min-w-0 flex-1">
                <span className={`[overflow-wrap:anywhere] ${e.kind === 'error' ? 'text-conf-red' : 'text-night-900'}`}>{e.message}</span>
                {url && <button className="ml-1.5 inline-flex items-center gap-0.5 text-[12px] text-ios-blue" onClick={() => openExternal(url)}>source<ExternalLink size={11} /></button>}
              </span>
              <span className="shrink-0 tabular-nums text-[11px] text-mist-400">{clockTime(e.ts).slice(0, 5)}</span>
            </li>
          )
        })}
      </ol>
      {list.length > 40 && !all && <button className="mt-2 w-full text-center text-[13px] font-medium text-ios-blue" onClick={() => setAll(true)}>Voir les {list.length} événements</button>}
    </div>
  )
}

/* =================================================================== Découvertes */
const DISC_KIND: Record<string, { label: string; icon: ReactNode }> = {
  hypothesis: { label: 'Hypothèse', icon: <Lightbulb size={13} /> }, mention: { label: 'Personne citée dans un acte', icon: <UserRound size={13} /> },
  filiation: { label: 'Filiation', icon: <GitBranch size={13} /> }, question: { label: 'Question pour vous', icon: <HelpCircle size={13} /> },
}
const VALIDATED = new Set(['validated', 'accepted', 'confirmed', 'verified'])
const REJECTED = new Set(['rejected', 'refused', 'dismissed'])
function statusText(d: DiscoveryOut): { text: string; cls: string } {
  if (VALIDATED.has(d.status)) return { text: d.kind === 'filiation' ? 'Vérifiée' : 'Validée par vous', cls: 'conf-green' }
  if (REJECTED.has(d.status)) return { text: 'Rejetée', cls: 'conf-grey' }
  if (d.kind === 'question') return { text: 'En attente de votre réponse', cls: 'conf-orange' }
  return { text: 'Non vérifiée — à confirmer', cls: 'conf-orange' }
}
/** Une hypothèse ou une mention non validée n'est jamais affichée comme établie. */
function displayConf(d: DiscoveryOut): Conf {
  const c = toConf(d.confidence)
  if (c === 'green' && d.kind !== 'filiation' && !VALIDATED.has(d.status)) return 'orange'
  return c
}

export function SourceLinks({ evidence }: { evidence: Evidence[] }) {
  if (!evidence?.length) return <p className="text-[12px] text-[#87510f]">Aucune source rattachée : à considérer avec prudence.</p>
  return (
    <ul className="space-y-1.5">
      {evidence.map((e, i) => (
        <li key={i} className="rounded-lg bg-ivory-100/80 px-2.5 py-1.5 text-[12px]">
          {e.excerpt && <p className="mb-1 italic leading-snug text-night-900/80 [overflow-wrap:anywhere]">« {e.excerpt} »</p>}
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {e.media_id && <Link to={`/documents/${e.media_id}/lecture`} className="inline-flex items-center gap-1 font-medium text-ios-blue"><BookOpen size={12} />Ouvrir le document</Link>}
            {e.source_id && <Link to={`/archives?tab=sources&source=${e.source_id}`} className="inline-flex items-center gap-1 font-medium text-ios-blue"><FileText size={12} />Ouvrir la source</Link>}
            {e.url && <button onClick={() => openExternal(e.url!)} className="inline-flex min-w-0 items-center gap-1 font-medium text-ios-blue"><ExternalLink size={12} /><span className="truncate">Ouvrir la source en ligne</span></button>}
            {!e.media_id && !e.source_id && !e.url && <span className="text-mist-500">Référence sans lien</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function DiscoveryCard({ d, busy, onValidate, onReject }: { d: DiscoveryOut; busy: boolean; onValidate: (d: DiscoveryOut) => void; onReject: (d: DiscoveryOut) => void }) {
  const [open, setOpen] = useState(false)
  const k = DISC_KIND[d.kind] ?? { label: d.kind, icon: <Sparkles size={13} /> }
  const st = statusText(d)
  const conf = displayConf(d)
  const decidable = (d.kind === 'hypothesis' || d.kind === 'mention') && !VALIDATED.has(d.status) && !REJECTED.has(d.status)
  return (
    <article className={`rounded-xl border p-3 ${REJECTED.has(d.status) ? 'border-[var(--hairline)] bg-ivory-100/50 opacity-75' : 'border-[var(--hairline)] bg-white'}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-mist-500">
        <span className="inline-flex items-center gap-1" style={{ color: d.kind === 'filiation' ? '#2c6a3b' : AI.dark }}>{k.icon}{k.label}</span>
      </div>
      <h3 className="mt-0.5 text-[14px] font-semibold leading-snug text-night-900 [overflow-wrap:anywhere]">{d.title}</h3>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className={`chip conf-${conf}`} title="Niveau de confiance"><ConfidenceDot level={conf} />{CONF_LABEL[conf]}</span>
        <span className={`chip ${st.cls}`}>{st.text}</span>
        {d.score !== null && d.score !== undefined && <span className="text-[11px] text-mist-500">score {Math.round(d.score <= 1 ? d.score * 100 : d.score)}/100</span>}
      </div>
      {d.description && <p className={`mt-1.5 text-[13px] leading-relaxed text-night-900/80 [overflow-wrap:anywhere] ${open ? '' : 'line-clamp-3'}`}>{d.description}</p>}
      {!(d.kind === 'question' && !d.evidence?.length) && <button className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-ios-blue" onClick={() => setOpen((v) => !v)}>
        {open ? 'Masquer les sources' : (d.evidence?.length ?? 0) === 1 ? 'Voir la source' : d.evidence?.length ? `Voir les ${d.evidence.length} sources` : 'Sources'}{open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>}
      {open && <div className="mt-2"><SourceLinks evidence={d.evidence} /></div>}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {decidable && <button className="btn-sage !px-2.5 !py-1 !text-[12px]" disabled={busy} onClick={() => onValidate(d)}>{busy ? <Spinner /> : <Check size={12} />}Valider</button>}
        {decidable && <button className="btn-ghost !px-2.5 !py-1 !text-[12px]" disabled={busy} onClick={() => onReject(d)}><X size={12} />Rejeter</button>}
        {!open && d.evidence?.length === 1 && <OpenFirstSource e={d.evidence[0]} />}
        {d.kind === 'question' && <Link to="/questions" className="btn-ghost !px-2.5 !py-1 !text-[12px]"><HelpCircle size={12} />Répondre</Link>}
        {d.person_id && <Link to={`/arbre-interactif?personne=${d.person_id}`} className="btn-ghost !px-2.5 !py-1 !text-[12px]"><Eye size={12} />Voir dans l’arbre</Link>}
      </div>
    </article>
  )
}
function OpenFirstSource({ e }: { e: Evidence }) {
  const cls = 'btn-ghost !px-2.5 !py-1 !text-[12px]'
  if (e.media_id) return <Link to={`/documents/${e.media_id}/lecture`} className={cls}><BookOpen size={12} />Ouvrir la source</Link>
  if (e.source_id) return <Link to={`/archives?tab=sources&source=${e.source_id}`} className={cls}><FileText size={12} />Ouvrir la source</Link>
  if (e.url) return <button className={cls} onClick={() => openExternal(e.url!)}><ExternalLink size={12} />Ouvrir la source</button>
  return null
}

export function NextSearches({ tasks }: { tasks: TaskOut[] }) {
  if (!tasks.length) return <Quiet>Aucune recherche prévue pour l’instant.</Quiet>
  return (
    <ol className="space-y-1.5">
      {tasks.slice(0, 12).map((t, i) => (
        <li key={t.id} className="flex gap-2.5 text-[13px] leading-snug">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ivory-200 text-[11px] font-semibold tabular-nums text-night-800">{i + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-night-900 [overflow-wrap:anywhere]">{t.title}</span>
            <span className="block text-[11px] text-mist-500">{TASK_KIND_LABEL[t.kind] ?? t.kind}{t.strategy ? ` · ${STRATEGY_LABEL[t.strategy] ?? t.strategy}` : ''}</span>
          </span>
          {t.kind === 'browse' ? <MonitorSmartphone size={14} className="mt-0.5 shrink-0 text-mist-400" /> : <Compass size={14} className="mt-0.5 shrink-0 text-mist-400" />}
        </li>
      ))}
    </ol>
  )
}
