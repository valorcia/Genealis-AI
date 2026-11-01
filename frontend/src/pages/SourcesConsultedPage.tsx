import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ExternalLink, Globe, Loader2, ShieldCheck, Sparkles, XCircle, AlertTriangle } from 'lucide-react'
import { openExternal } from '../api'
import { useApp } from '../store'
import { Spinner } from '../components/ui'
import { AI, errMsg } from '../components/person/helpers'
import { OutcomeChip, SiteIcon, shortDate } from '../components/research/trace'
import { traceApi, type Diagnostic, type DiagnosticItem, type TraceSite, type TraceSites } from '../lib/traceApi'

const DOT: Record<string, string> = { green: 'bg-conf-green', orange: 'bg-conf-orange', red: 'bg-conf-red', grey: 'bg-mist-400' }
const MODE: Record<string, string> = { api: 'Automatique', html: 'Automatique (lecture des pages)', browser: 'Par navigateur', manual: 'Manuel' }
const DIAG: Record<DiagnosticItem['result'], { label: string; cls: string; icon: ReactNode }> = {
  ok: { label: 'Fonctionne', cls: 'conf-green', icon: <CheckCircle2 size={16} className="text-[#2f6b3b]" /> },
  degraded: { label: 'Partiel', cls: 'conf-orange', icon: <AlertTriangle size={16} className="text-[#8a5a10]" /> },
  failed: { label: 'Ne répond pas', cls: 'conf-red', icon: <XCircle size={16} className="text-conf-red" /> },
  restricted: { label: 'Accès refusé', cls: 'conf-orange', icon: <ShieldCheck size={16} className="text-[#8a5a10]" /> },
}

export default function SourcesConsultedPage() {
  const { notify } = useApp()
  const [data, setData] = useState<TraceSites | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diag, setDiag] = useState<Diagnostic | null>(null)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(() => traceApi.sites().then((d) => { setData(d); setError(null) }).catch((e: unknown) => setError(errMsg(e))), [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!running) return
    const t0 = Date.now()
    const i = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(i)
  }, [running])

  const runDiagnostic = async () => {
    setRunning(true); setElapsed(0); setDiag(null)
    try { const d = await traceApi.diagnostic(); setDiag(d); notify(d.summary.ok ? 'success' : 'info', d.verdict); load() } catch (e) { notify('error', errMsg(e, 'Le diagnostic n’a pas pu être lancé.')) } finally { setRunning(false) }
  }

  const sites = data?.sites ?? []
  const auto = sites.filter((s) => s.access_mode === 'api' || s.access_mode === 'html')
  const browser = sites.filter((s) => !(s.access_mode === 'api' || s.access_mode === 'html'))
  const used = (s: TraceSite) => s.searches > 0 || s.proposed_manual > 0
  const browserShown = showAll ? browser : browser.filter(used)
  const totals = useMemo(() => ({ searches: sites.reduce((a, s) => a + s.searches, 0), results: sites.reduce((a, s) => a + s.results, 0), used: sites.filter((s) => s.searches > 0).length }), [sites])

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-8">
      <Link to="/enquetes" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#2f6fd1]"><ArrowLeft size={16} />Recherches effectuées</Link>
      <section className="panel fade-up p-5">
        <h1 className="text-[24px] font-bold leading-tight text-night-900">Sites et archives consultés</h1>
        <p className="mt-1 text-[14px] text-mist-500">Tous les sites où l’IA cherche vos ancêtres, combien de fois elle les a interrogés et ce qu’ils ont donné. Rien n’est inventé : un site qui n’a pas répondu est affiché comme tel.</p>
        {data && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[{ n: totals.used, l: 'sites interrogés' }, { n: totals.searches, l: 'recherches' }, { n: totals.results, l: 'résultats' }].map((x) => (
              <div key={x.l} className="rounded-2xl bg-[#f4f6fb] px-2 py-2"><div className="text-xl font-bold text-night-900">{x.n}</div><div className="text-[11px] text-mist-500">{x.l}</div></div>
            ))}
          </div>
        )}
        <button className="btn-primary mt-4 w-full justify-center !py-3.5 text-[16px]" disabled={running} onClick={runDiagnostic}>
          {running ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}{running ? `Vérification en cours… ${elapsed} s` : 'Vérifier le moteur de recherche'}
        </button>
        <p className="mt-1.5 text-center text-[12px] text-mist-500">Teste réellement chaque site interrogeable automatiquement (jusqu’à 1 minute).</p>
      </section>

      {(running || diag) && <DiagnosticPanel diag={diag} running={running} pending={auto} />}

      {error && <div className="panel p-4 text-sm text-conf-red">{error}</div>}
      {!data && !error && <div className="flex items-center gap-2 p-6 text-mist-500"><Spinner /> Chargement…</div>}

      {data && data.web_domains.length > 0 && (
        <section className="panel fade-up p-4 sm:p-5">
          <h2 className="mb-1 flex items-center gap-2 text-[18px] font-bold text-night-900"><Sparkles size={18} style={{ color: AI.color }} />Pages lues par Gemini</h2>
          <p className="mb-3 text-[13px] text-mist-500">Sites dont Gemini a réellement consulté des pages via Google Search (nombre de recherches).</p>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {data.web_domains.slice(0, 30).map((w) => (
              <li key={w.domain}><button onClick={() => openExternal(`https://${w.domain}`)} className="flex w-full items-center gap-2 rounded-xl bg-[#f7f5ff] p-2 text-left hover:bg-[#ece6ff]"><SiteIcon domain={w.domain} size={26} /><span className="min-w-0 flex-1 truncate text-[14px] text-night-900">{w.domain}</span><span className="text-[12px] text-mist-500">{w.count}×</span></button></li>
            ))}
          </ul>
        </section>
      )}

      {data && (
        <section className="panel fade-up p-4 sm:p-5">
          <h2 className="mb-1 flex items-center gap-2 text-[18px] font-bold text-night-900"><Globe size={18} style={{ color: AI.color }} />Interrogés automatiquement ({auto.length})</h2>
          <p className="mb-2 text-[13px] text-mist-500">L’IA lance elle-même la recherche sur ces sites.</p>
          <ul className="divide-y divide-black/5">{auto.map((s) => <SiteRow key={s.connector_id} s={s} />)}</ul>
        </section>
      )}
      {data && (
        <section className="panel fade-up p-4 sm:p-5">
          <h2 className="mb-1 flex items-center gap-2 text-[18px] font-bold text-night-900"><ExternalLink size={18} style={{ color: AI.color }} />À consulter vous-même ({browser.length})</h2>
          <p className="mb-2 text-[13px] text-mist-500">Ces sites interdisent ou ne permettent pas la recherche automatique (règles du site, compte requis, registres en images). L’IA prépare le lien ; vous cherchez dans votre navigateur.</p>
          {browserShown.length === 0 && <p className="text-[13px] text-mist-500">Aucun de ces sites n’a encore été proposé par une recherche.</p>}
          <ul className="divide-y divide-black/5">{browserShown.map((s) => <SiteRow key={s.connector_id} s={s} />)}</ul>
          {browser.length > browserShown.length && <button className="mt-2 w-full text-center text-[14px] font-medium text-[#2f6fd1]" onClick={() => setShowAll(true)}>Voir les {browser.length} sites</button>}
        </section>
      )}
    </div>
  )
}

function SiteRow({ s }: { s: TraceSite }) {
  const isBrowser = !(s.access_mode === 'api' || s.access_mode === 'html')
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        {s.connector_id === 'gemini_web' ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: AI.color }}><Sparkles size={18} /></span> : <SiteIcon domain={s.domain} name={s.name} size={36} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold leading-snug text-night-900">{s.name}</div>
              <button onClick={() => openExternal(s.homepage)} className="inline-flex items-center gap-1 text-[12px] text-[#2f6fd1]"><ExternalLink size={11} />{s.domain ?? s.homepage}</button>
            </div>
            <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${DOT[s.color] ?? DOT.grey}`} title={s.explanation} aria-label={s.explanation} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-mist-500">
            <span>{MODE[s.access_mode] ?? s.access_mode}</span>
            {isBrowser ? <span>{s.proposed_manual} fois proposé</span> : <><span>{s.searches} recherche{s.searches > 1 ? 's' : ''}</span><span>{s.results} résultat{s.results > 1 ? 's' : ''}</span></>}
            {s.last_search_at && <span>dernière le {shortDate(s.last_search_at)}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
            {s.last_status && <><span className="text-mist-500">Dernier résultat :</span><OutcomeChip outcome={s.last_status} /></>}
          </div>
          <p className="mt-1 text-[12px] leading-snug text-night-900/75">{s.explanation}{s.last_test_at ? ` (vérifié le ${shortDate(s.last_test_at)})` : ''}</p>
          {s.last_error && s.last_status && s.last_status !== 'ok' && !s.explanation.includes(s.last_error) && (
            <details className="mt-0.5 text-[12px] text-mist-500"><summary className="cursor-pointer text-conf-red">Dernière erreur</summary><p className="mt-0.5 break-words">{s.last_error.slice(0, 300)}</p></details>
          )}
        </div>
      </div>
    </li>
  )
}

function DiagnosticPanel({ diag, running, pending }: { diag: Diagnostic | null; running: boolean; pending: TraceSite[] }) {
  const [showBrowser, setShowBrowser] = useState(false)
  if (running || !diag) {
    return (
      <section className="panel fade-up p-4 sm:p-5">
        <h2 className="mb-2 text-[18px] font-bold text-night-900">Vérification en cours</h2>
        <ul className="space-y-1.5">
          {pending.map((s) => <li key={s.connector_id} className="flex items-center gap-2 text-[14px]"><Spinner /><span className="text-night-900">{s.name}</span><span className="text-[12px] text-mist-500">{s.domain}</span></li>)}
        </ul>
      </section>
    )
  }
  const tested = diag.results.filter((r) => r.access_mode === 'api' || r.access_mode === 'html')
  const browser = diag.results.filter((r) => !(r.access_mode === 'api' || r.access_mode === 'html'))
  const good = diag.summary.ok > 0 && !diag.summary.failed
  return (
    <section className="panel fade-up p-4 sm:p-5">
      <div className={`mb-3 rounded-2xl p-3 text-[15px] font-medium leading-snug ${good ? 'bg-[#e3f4e6] text-[#2f6b3b]' : diag.summary.ok ? 'bg-[#fff1dc] text-[#8a5a10]' : 'bg-[#fde8e6] text-[#7d2b22]'}`}>
        {diag.verdict}
        <div className="mt-1 text-[12px] font-normal opacity-80">{diag.summary.ok} fonctionnent · {diag.summary.degraded} partiels · {diag.summary.failed} ne répondent pas · {diag.summary.restricted} accès refusé — en {(diag.duration_ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s</div>
      </div>
      <ul className="divide-y divide-black/5">
        {tested.map((r) => <DiagRow key={r.connector_id} r={r} />)}
      </ul>
      {browser.length > 0 && (
        <div className="mt-3 border-t border-black/5 pt-3">
          <button className="text-[14px] font-medium text-[#2f6fd1]" onClick={() => setShowBrowser((v) => !v)}>{showBrowser ? 'Masquer' : 'Afficher'} les {browser.length} sites consultables uniquement par navigateur</button>
          {showBrowser && <ul className="mt-2 divide-y divide-black/5">{browser.map((r) => <DiagRow key={r.connector_id} r={r} />)}</ul>}
        </div>
      )}
    </section>
  )
}

function DiagRow({ r }: { r: DiagnosticItem }) {
  const d = DIAG[r.result] ?? DIAG.failed
  return (
    <li className="flex items-start gap-3 py-2.5">
      {r.connector_id === 'gemini_web' ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: AI.color }}><Sparkles size={16} /></span> : <SiteIcon domain={r.domain} name={r.name} size={32} />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold text-night-900">{r.name}</span><span className={`chip ${d.cls}`}>{d.label}</span>{r.latency_ms !== null && <span className="text-[11px] text-mist-400">{r.latency_ms < 1000 ? `${r.latency_ms} ms` : `${(r.latency_ms / 1000).toFixed(1)} s`}</span>}</div>
        <p className="mt-0.5 text-[13px] leading-snug text-night-900/80">{r.message}</p>
        <button onClick={() => openExternal(r.homepage)} className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-[#2f6fd1]"><ExternalLink size={11} />{r.domain ?? r.homepage}</button>
      </div>
      <span className="mt-1 shrink-0">{d.icon}</span>
    </li>
  )
}
