import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Archive, ArrowLeft, Check, ChevronDown, ChevronUp, ExternalLink, FileText, Globe, HelpCircle, Lightbulb, ListChecks, Play, Quote,
  RefreshCw, RotateCcw, Search, Sparkles, X,
} from 'lucide-react'
import { api, openExternal, type HypothesisOut } from '../api'
import { useApp, pulseEngine } from '../store'
import { Spinner, formatTs } from '../components/ui'
import { AI, errMsg } from '../components/person/helpers'
import { OutcomeChip, ReliabilityBadge, SiteIcon, TaskStatusChip, shortDate } from '../components/research/trace'
import { googleSearchUrl, hostOf, traceApi, type Grounding, type GroundingFinding, type GroundingSource, type TraceStep, type TraceTaskDetail } from '../lib/traceApi'

const REGISTER: Record<string, string> = { birth: 'naissance', marriage: 'mariage', death: 'décès', census: 'recensement', military: 'registre matricule', any: 'tous actes' }
const FINDING_TYPE: Record<string, string> = { birth: 'Naissance', baptism: 'Baptême', marriage: 'Mariage', death: 'Décès', burial: 'Inhumation', census: 'Recensement', military: 'Militaire', tree: 'Arbre en ligne', other: 'Mention' }
const CONFIDENCE: Record<string, { label: string; cls: string }> = { high: { label: 'Confiance élevée', cls: 'conf-green' }, medium: { label: 'Confiance moyenne', cls: 'conf-orange' }, low: { label: 'Confiance faible', cls: 'conf-grey' } }

function pageLabel(u: string) {
  try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname.slice(0, 48) : '') } catch { return u }
}

function duration(ms: number | undefined) {
  if (ms === undefined || ms === null) return null
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`
}

function Section({ title, icon, children, count }: { title: string; icon: ReactNode; children: ReactNode; count?: number }) {
  return (
    <section className="panel fade-up p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[18px] font-bold text-night-900"><span style={{ color: AI.color }}>{icon}</span>{title}{count !== undefined && <span className="text-sm font-normal text-mist-500">({count})</span>}</h2>
      {children}
    </section>
  )
}

export default function ResearchTracePage() {
  const { taskId = '' } = useParams()
  const { notify } = useApp()
  const [data, setData] = useState<TraceTaskDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => traceApi.task(taskId).then((d) => { setData(d); setError(null) }).catch((e: unknown) => setError(errMsg(e))), [taskId])
  useEffect(() => { setData(null); load() }, [load])
  const live = data ? ['queued', 'running'].includes(data.status) : false
  useEffect(() => {
    if (!live) return
    const i = setInterval(load, 4000)
    return () => clearInterval(i)
  }, [live, load])

  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key)
    try { await fn(); notify('success', msg); pulseEngine(); await load() } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) }
  }

  if (error) return (
    <div className="mx-auto max-w-3xl space-y-3">
      <BackLink />
      <div className="panel p-5 text-sm text-conf-red">{error === 'Recherche introuvable' ? 'Cette recherche n’existe plus.' : error}</div>
    </div>
  )
  if (!data) return <div className="flex items-center justify-center gap-2 p-10 text-mist-500"><Spinner /> Chargement du rapport de recherche…</div>

  const s = data.summary
  const searchSteps = data.steps.filter((x) => x.action === 'search' || x.action === 'browse')
  const otherSteps = data.steps.filter((x) => x.action !== 'search' && x.action !== 'browse')
  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-8">
      <BackLink />
      {/* En-tête */}
      <section className="fade-up overflow-hidden rounded-[24px] p-5 text-white shadow-[0_18px_40px_-20px_rgba(91,63,214,0.8)]" style={{ background: 'linear-gradient(140deg, #6a4ee6 0%, #5b3fd6 45%, #4329b8 100%)' }}>
        <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/75"><Search size={14} />Rapport de recherche</div>
        <h1 className="mt-1 text-[22px] font-bold leading-snug sm:text-[26px]">{data.type_label}</h1>
        {data.person && (
          <Link to={`/personnes/${data.person.id}`} className="mt-0.5 inline-block text-[16px] font-medium text-white underline decoration-white/40 underline-offset-2">
            {data.person.name}{data.person.birth_year || data.person.death_year ? ` (${data.person.birth_year ?? '?'} – ${data.person.death_year ?? ''})` : ''}
          </Link>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-white/80">
          <span className="rounded-full bg-white/90 px-0.5 py-0.5 [&_.chip]:!m-0"><TaskStatusChip status={data.status} /></span>
          <span>Lancée le {shortDate(data.started_at ?? data.created_at)}</span>
          {data.finished_at && <span>· terminée le {shortDate(data.finished_at)}</span>}
        </div>
        <p className="mt-3 rounded-2xl p-3 text-[15px] leading-snug" style={{ background: 'rgba(255,255,255,0.12)' }}>{data.conclusion}</p>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          {[{ n: s.sites_queried, l: 'sites' }, { n: s.results, l: 'résultats' }, { n: s.hypotheses, l: 'pistes' }, { n: s.questions, l: 'questions' }].map((x) => (
            <div key={x.l} className="rounded-2xl px-1 py-2" style={{ background: 'rgba(255,255,255,0.12)' }}><div className="text-lg font-bold">{x.n}</div><div className="text-[11px] text-white/75">{x.l}</div></div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 [&_button]:bg-white [&_button]:text-[#4329b8]">
          {data.status === 'waiting_user' && <button className="btn" disabled={busy !== null} onClick={() => act('approve', () => api.approveTask(data.id, true), 'Recherche approuvée : elle va démarrer.')}>{busy === 'approve' ? <Spinner /> : <Play size={15} />}Lancer cette recherche</button>}
          {['done', 'failed', 'cancelled'].includes(data.status) && <button className="btn" disabled={busy !== null} onClick={() => act('retry', () => api.retryTask(data.id), 'Recherche relancée.')}>{busy === 'retry' ? <Spinner /> : <RotateCcw size={15} />}Relancer la recherche</button>}
          <button className="btn" onClick={() => load()}><RefreshCw size={15} className={live ? 'animate-spin' : ''} />Actualiser</button>
        </div>
        {data.last_error && <p className="mt-2 text-[13px] text-amber-200">Dernière erreur : {data.last_error}</p>}
      </section>

      {/* Étapes */}
      <Section title="Où l’IA a cherché" icon={<Globe size={19} />} count={searchSteps.length}>
        {searchSteps.length === 0 ? <p className="text-sm text-mist-500">Aucun site n’était prévu pour cette recherche{data.task_type === 'analyze_document' ? ' (analyse d’un document importé).' : '.'}</p> : (
          <ol className="relative space-y-3 border-l-2 border-[#ece6ff] pl-4 sm:pl-5">
            {searchSteps.map((st) => <StepCard key={st.index} st={st} />)}
          </ol>
        )}
        {otherSteps.length > 0 && (
          <ul className="mt-4 space-y-1.5 border-t border-black/5 pt-3 text-[13px]">
            {otherSteps.map((st) => (
              <li key={st.index} className="flex flex-wrap items-center gap-2"><ListChecks size={14} className="text-mist-400" /><span className="text-night-900">{st.label}</span><OutcomeChip outcome={st.status === 'done' ? 'done' : st.status} />{st.result?.note && <span className="text-mist-500">— {st.result.note}</span>}{typeof st.result?.evaluated === 'number' && <span className="text-mist-500">— {st.result.evaluated} résultat(s) comparé(s)</span>}</li>
            ))}
          </ul>
        )}
      </Section>

      <Produced data={data} busy={busy} act={act} />
      <LogSection data={data} />
    </div>
  )
}

function BackLink() {
  return <Link to="/enquetes" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#2f6fd1]"><ArrowLeft size={16} />Recherches effectuées</Link>
}

/* ---------- Une étape (un site) ---------- */
function StepCard({ st }: { st: TraceStep }) {
  const r = st.result ?? {}
  const [all, setAll] = useState(false)
  const domain = r.site ?? st.site ?? hostOf(st.homepage)
  const name = r.connector_name ?? st.connector_name ?? st.connector_id ?? 'Site'
  const searched = r.searched
  const q = st.query ?? {}
  const what = searched ? [searched.name, searched.years, searched.commune ? `${searched.commune}${searched.department ? ` (${searched.department})` : ''}` : null, searched.register_type ? REGISTER[searched.register_type] ?? searched.register_type : null].filter(Boolean).join(' · ')
    : [q.given_names, q.surname, q.year_from || q.year_to ? `${q.year_from ?? '?'}–${q.year_to ?? '?'}` : null, q.commune].filter(Boolean).map(String).join(' · ')
  const results = r.results ?? []
  const shown = all ? results : results.slice(0, 5)
  const verify = r.verify_url ?? r.browse_url ?? null
  const isWeb = st.connector_id === 'gemini_web'
  const outcome = st.outcome
  return (
    <li className="relative">
      <span className={`absolute -left-[25px] top-4 h-3 w-3 rounded-full ring-4 ring-white sm:-left-[29px] ${outcome === 'ok' ? 'bg-conf-green' : outcome === 'error' ? 'bg-conf-red' : outcome === 'restricted' ? 'bg-conf-orange' : outcome === 'manual' ? 'bg-[#5b3fd6]' : 'bg-mist-400'}`} aria-hidden />
      <div className={`rounded-2xl p-3 ring-1 sm:p-4 ${isWeb ? 'bg-[#f7f5ff] ring-[#5b3fd6]/20' : 'bg-[#f7f8fc] ring-black/5'}`}>
        <div className="flex items-start gap-3">
          {isWeb ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: AI.color }}><Sparkles size={18} /></span> : <SiteIcon domain={domain} name={name} size={36} />}
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-snug text-night-900">{name}</div>
            {domain && <button onClick={() => st.homepage && openExternal(st.homepage)} className="text-[12px] text-mist-500 hover:text-night-900">{domain}</button>}
          </div>
          <OutcomeChip outcome={outcome} />
        </div>
        {what && <p className="mt-2 text-[13px] text-night-900"><span className="text-mist-500">Recherché : </span>{what}</p>}
        <div className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-mist-500">
          {r.started_at && <span>{formatTs(r.started_at)}</span>}
          {duration(r.duration_ms) && <span>durée {duration(r.duration_ms)}</span>}
          {typeof r.count === 'number' && st.action === 'search' && <span>{r.count} résultat{r.count > 1 ? 's' : ''}</span>}
        </div>
        {r.message && <p className={`mt-2 text-[13px] leading-snug ${outcome === 'error' ? 'text-conf-red' : outcome === 'restricted' ? 'text-[#8a5a10]' : 'text-night-900/80'}`}>{r.message}</p>}
        {!r.message && st.status === 'pending' && <p className="mt-2 text-[13px] text-mist-500">Ce site n’a pas encore été interrogé.</p>}
        {r.error && r.message && !r.message.includes(r.error) && <p className="mt-1 text-[12px] text-mist-500">Détail technique : {r.error}</p>}

        {isWeb && r.grounding && <GeminiTrace g={r.grounding} />}

        {results.length > 0 && !isWeb && (
          <ul className="mt-3 space-y-2">
            {shown.map((x, i) => (
              <li key={i} className="rounded-xl bg-white p-2.5 ring-1 ring-black/5">
                <div className="text-[14px] font-medium leading-snug text-night-900">{x.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mist-500">
                  {x.year && <span>{x.year}</span>}{x.place && <span>{x.place}</span>}<ReliabilityBadge value={x.reliability} />
                  {x.url && <button onClick={() => openExternal(x.url as string)} className="inline-flex items-center gap-1 font-medium text-[#2f6fd1]"><ExternalLink size={12} />Voir la page</button>}
                </div>
                {x.snippet && <p className="mt-1 text-[12px] italic text-mist-500">{x.snippet.slice(0, 240)}</p>}
              </li>
            ))}
          </ul>
        )}
        {results.length > 5 && !isWeb && <button className="mt-2 text-[13px] font-medium text-[#2f6fd1]" onClick={() => setAll((v) => !v)}>{all ? 'Réduire' : `Voir les ${results.length} résultats`}</button>}
        {verify && (
          <button className="btn-ghost mt-3 w-full justify-center !py-2 text-[14px] sm:w-auto" onClick={() => openExternal(verify)}>
            <ExternalLink size={15} />{outcome === 'manual' ? 'Chercher moi-même sur ce site' : 'Refaire cette recherche moi-même'}
          </button>
        )}
      </div>
    </li>
  )
}

/* ---------- Où Gemini a cherché ---------- */
function GeminiTrace({ g }: { g: Grounding }) {
  const [openPages, setOpenPages] = useState(false)
  const byDomain = useMemo(() => {
    const m = new Map<string, GroundingSource[]>()
    for (const s of g.sources) { const d = s.domain || hostOf(s.url); if (!m.has(d)) m.set(d, []); m.get(d)?.push(s) }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [g.sources])
  const kept = (g.findings ?? []).filter((f) => f.kept)
  const notes = g.notes ?? (g.findings ?? []).filter((f) => !f.kept)
  return (
    <div className="mt-3 space-y-3 rounded-2xl bg-white p-3 ring-1 ring-[#5b3fd6]/15">
      <div className="text-[14px] font-semibold" style={{ color: AI.dark }}>Où Gemini a cherché</div>
      <div>
        <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-mist-500">Recherches Google lancées ({g.queries.length})</div>
        {g.queries.length === 0 ? <p className="text-[13px] text-mist-500">Gemini n’a lancé aucune recherche Google.</p> : (
          <div className="flex flex-wrap gap-1.5">
            {g.queries.map((qq, i) => <button key={i} onClick={() => openExternal(googleSearchUrl(qq))} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#f1f2f6] px-2.5 py-1 text-left text-[12px] text-night-900 hover:bg-[#e6e8ef]"><Search size={11} className="shrink-0" /><span className="truncate">{qq}</span></button>)}
          </div>
        )}
      </div>
      <div>
        <button onClick={() => setOpenPages((v) => !v)} className="mb-1 flex w-full items-center justify-between text-[12px] font-medium uppercase tracking-wide text-mist-500">
          <span>Pages consultées ({g.sources.length}) sur {byDomain.length} site{byDomain.length > 1 ? 's' : ''}</span>{openPages ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {g.sources.length === 0 ? <p className="text-[13px] text-mist-500">Aucune page web consultée : rien ne peut être vérifié.</p> : (
          <ul className="space-y-1.5">
            {byDomain.map(([d, pages]) => (
              <li key={d} className="rounded-xl bg-[#f7f8fc] p-2">
                <div className="flex items-center gap-2"><SiteIcon domain={d} size={22} /><span className="text-[13px] font-semibold text-night-900">{d}</span><span className="text-[12px] text-mist-500">{pages.length} page{pages.length > 1 ? 's' : ''}</span></div>
                {(openPages || byDomain.length <= 3) && (
                  <ul className="mt-1 space-y-0.5 pl-7">
                    {pages.map((p) => <li key={p.index}><button onClick={() => openExternal(p.url)} className="text-left text-[12px] text-[#2f6fd1] hover:underline">[{p.index + 1}] {p.title && p.title !== d ? p.title : pageLabel(p.url)}</button></li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-mist-500">Ce que Gemini a trouvé ({kept.length})</div>
        {kept.length === 0 ? <p className="text-[13px] text-mist-500">Aucune piste rattachée à une page réellement consultée.</p> : (
          <ul className="space-y-2">{kept.map((f, i) => <FindingCard key={i} f={f} sources={g.sources} />)}</ul>
        )}
      </div>
      {g.not_found.length > 0 && (
        <div>
          <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-mist-500">Cherché sans résultat</div>
          <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-night-900/80">{g.not_found.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {notes.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-mist-500">{notes.length} indication{notes.length > 1 ? 's' : ''} non retenue{notes.length > 1 ? 's' : ''} (aucune page vérifiable)</summary>
          <ul className="mt-1 space-y-1 pl-4 text-mist-500">{notes.map((f, i) => <li key={i}>{f.summary ?? f.site}{f.url ? ` — adresse annoncée : ${f.url}` : ''}</li>)}</ul>
        </details>
      )}
      {g.parse_error && <p className="text-[13px] text-[#8a5a10]">{g.parse_error}</p>}
      {g.sites_requested && g.sites_requested.length > 0 && (
        <details className="text-[12px] text-mist-500">
          <summary className="cursor-pointer">Sites que Gemini devait cibler ({g.sites_requested.length})</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{g.sites_requested.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

function FindingCard({ f, sources }: { f: GroundingFinding; sources: GroundingSource[] }) {
  const conf = CONFIDENCE[f.confidence ?? ''] ?? null
  const justif = f.source_indices.map((i) => sources.find((s) => s.index === i)).filter((s): s is GroundingSource => !!s)
  const domain = f.resolved_domain ?? f.site ?? ''
  const rel = f.type === 'tree' || /geneanet|roglo|myheritage|ancestry|wikitree|geni\.com/.test(domain) ? 'derivative' : 'secondary'
  return (
    <li className="rounded-xl bg-[#f7f5ff] p-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-semibold uppercase tracking-wide" style={{ color: AI.color }}>{FINDING_TYPE[f.type] ?? f.type}</span>
        {f.date && <span className="text-mist-500">{f.date}</span>}{f.place && <span className="text-mist-500">· {f.place}</span>}
        <ReliabilityBadge value={rel} />{conf && <span className={`chip ${conf.cls}`}>{conf.label}</span>}
      </div>
      {f.summary && <p className="mt-1 text-[14px] font-medium leading-snug text-night-900">{f.summary}</p>}
      {f.quote && <p className="mt-1 flex gap-1.5 text-[13px] italic text-night-900/80"><Quote size={13} className="mt-0.5 shrink-0 text-mist-400" />« {f.quote} »</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {justif.map((s) => <button key={s.index} onClick={() => openExternal(s.url)} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-[#2f6fd1] ring-1 ring-[#2f6fd1]/20" title={s.url}><SiteIcon domain={s.domain} size={14} />[{s.index + 1}] {s.domain}</button>)}
        {f.resolved_url && <button onClick={() => openExternal(f.resolved_url as string)} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#2f6fd1]"><ExternalLink size={12} />Voir la page</button>}
      </div>
      {f.match && f.match !== 'page exacte consultée par Gemini' && <p className="mt-1 text-[11px] text-mist-500">Lien : {f.match} (l’adresse donnée par Gemini n’était pas dans les pages consultées).</p>}
    </li>
  )
}

/* ---------- Ce que la recherche a produit ---------- */
function Produced({ data, busy, act }: { data: TraceTaskDetail; busy: string | null; act: (key: string, fn: () => Promise<unknown>, msg: string) => Promise<void> }) {
  const nothing = !data.hypotheses.length && !data.questions.length && !data.media.length && !data.sources.length
  return (
    <Section title="Ce que cette recherche a produit" icon={<Lightbulb size={19} />}>
      {nothing && <p className="text-sm text-mist-500">{['done', 'failed'].includes(data.status) ? 'Rien n’a été ajouté : aucune piste suffisamment proche de la personne. Les sites « à consulter vous-même » restent la meilleure suite.' : 'Les résultats apparaîtront ici dès que la recherche sera terminée.'}</p>}
      {data.hypotheses.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold text-night-900"><Lightbulb size={15} />Pistes trouvées ({data.hypotheses.length})</h3>
          <ul className="space-y-2">{data.hypotheses.map((h) => <HypothesisRow key={h.id} h={h} busy={busy} act={act} />)}</ul>
        </div>
      )}
      {data.questions.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold text-night-900"><HelpCircle size={15} />Questions posées ({data.questions.length})</h3>
          <ul className="space-y-1.5">
            {data.questions.map((q) => (
              <li key={q.id} className="rounded-xl bg-[#fffaf0] p-2.5 ring-1 ring-[#f0d9a8]">
                <div className="text-[14px] leading-snug text-night-900">{q.title}</div>
                <div className="mt-1 flex items-center gap-2 text-[12px]">
                  <span className={q.status === 'pending' ? 'text-[#a2660c]' : 'text-mist-500'}>{q.status === 'pending' ? 'En attente de votre réponse' : `Répondu${q.answer ? ` : ${q.answer}` : ''}`}</span>
                  <Link to="/questions" className="font-medium text-[#2f6fd1]">{q.status === 'pending' ? 'Répondre' : 'Voir'}</Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.media.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold text-night-900"><Archive size={15} />Documents archivés ({data.media.length})</h3>
          <ul className="space-y-1">{data.media.map((m) => <li key={m.id}><Link to={`/archives?media=${m.id}`} className="text-[14px] text-[#2f6fd1] hover:underline">{m.title ?? 'Document'}</Link>{m.archived_from && <span className="ml-1 text-[12px] text-mist-500">({hostOf(m.archived_from)})</span>}</li>)}</ul>
        </div>
      )}
      {data.sources.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold text-night-900"><FileText size={15} />Sources enregistrées ({data.sources.length})</h3>
          <ul className="space-y-1.5">{data.sources.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2"><Link to={`/archives?source=${s.id}`} className="text-[14px] text-[#2f6fd1] hover:underline">{s.title}</Link><ReliabilityBadge value={s.reliability} /></li>)}</ul>
        </div>
      )}
    </Section>
  )
}

function HypothesisRow({ h, busy, act }: { h: HypothesisOut; busy: string | null; act: (key: string, fn: () => Promise<unknown>, msg: string) => Promise<void> }) {
  const url = typeof h.candidate?.url === 'string' ? h.candidate.url : null
  const rel = typeof h.candidate?.reliability === 'string' ? h.candidate.reliability : null
  const status = h.status === 'confirmed' ? { l: 'Confirmée', c: 'conf-green' } : h.status === 'rejected' ? { l: 'Écartée', c: 'conf-red' } : { l: 'À vérifier', c: 'conf-orange' }
  return (
    <li className="rounded-xl bg-[#f7f5ff] p-2.5">
      <div className="text-[14px] font-medium leading-snug text-night-900">{h.title}</div>
      {h.description && <p className="mt-0.5 text-[12px] italic text-mist-500">{h.description.slice(0, 200)}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className={`chip ${status.c}`}>{status.l}</span>
        {typeof h.score === 'number' && <span className="text-mist-500">ressemblance {Math.round(h.score)} / 100</span>}
        {rel && <ReliabilityBadge value={rel} />}
        {url && <button onClick={() => openExternal(url)} className="inline-flex items-center gap-1 font-medium text-[#2f6fd1]"><ExternalLink size={12} />Voir la page</button>}
      </div>
      {h.status === 'open' && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button disabled={busy !== null} onClick={() => act(`c${h.id}`, () => api.setHypothesisStatus(h.id, 'confirmed'), 'Piste confirmée.')} className="inline-flex items-center justify-center gap-1 rounded-xl bg-[#e3f4e6] py-2 text-[13px] font-medium text-[#2f6b3b] ring-1 ring-[#bfe3c6] disabled:opacity-50">{busy === `c${h.id}` ? <Spinner /> : <Check size={14} />}C’est bien elle/lui</button>
          <button disabled={busy !== null} onClick={() => act(`r${h.id}`, () => api.setHypothesisStatus(h.id, 'rejected'), 'Piste écartée.')} className="inline-flex items-center justify-center gap-1 rounded-xl bg-[#fde8e6] py-2 text-[13px] font-medium text-[#7d2b22] ring-1 ring-[#f3c6c1] disabled:opacity-50">{busy === `r${h.id}` ? <Spinner /> : <X size={14} />}Ce n’est pas elle/lui</button>
        </div>
      )}
    </li>
  )
}

function LogSection({ data }: { data: TraceTaskDetail }) {
  const [open, setOpen] = useState(false)
  if (!data.logs.length) return null
  return (
    <section className="panel fade-up p-4 sm:p-5">
      <button className="flex w-full items-center justify-between text-left text-[16px] font-semibold text-night-900" onClick={() => setOpen((v) => !v)}>
        <span>Journal détaillé ({data.logs.length} opérations)</span>{open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>
      {open && (
        <ul className="mt-3 divide-y divide-black/5 text-[13px]">
          {data.logs.map((l) => (
            <li key={l.id} className="flex gap-2 py-1.5">
              <span className="shrink-0 tabular-nums text-mist-400">{formatTs(l.ts)}</span>
              <span className={l.level === 'error' ? 'text-conf-red' : l.level === 'warning' ? 'text-[#8a5a10]' : 'text-night-900'}>{l.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
