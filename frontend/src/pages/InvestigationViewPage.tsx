/** Vue d'une enquête autonome, suivie en direct : missions et personnes | navigateur, documents et activité | découvertes. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Activity, ArrowLeft, Check, Coins, ExternalLink, FileSearch, GitBranch, Globe, Hand, Lightbulb, ListChecks, Pause, Play, Radar, RotateCcw, Square, Users,
} from 'lucide-react'
import { api, openExternal } from '../api'
import { useApp } from '../store'
import { Spinner } from '../components/ui'
import { AI, Modal, errMsg } from '../components/person/helpers'
import { ConfirmDialog, Loading, Notice, NotYetAvailable, StatusBadge, formatDuration, parseTs, relTime } from '../components/investigation/common'
import {
  ActivityFeed, BrowserView, Column, DiscoveryCard, DocumentsGrid, NextSearches, PersonsList, TasksList, collectDocuments, needsHuman, taskUrl,
} from '../components/investigation/Panels'
import {
  COST_MODE_LABEL, ZERO_STATS, investigationApi, isUnavailable,
  type DiscoveryOut, type InvestigationDetail, type InvestigationEvent, type TaskOut,
} from '../lib/investigationApi'

type MobileTab = 'missions' | 'navigateur' | 'decouvertes'

export default function InvestigationViewPage() {
  const { id = '' } = useParams()
  const { notify } = useApp()
  const [inv, setInv] = useState<InvestigationDetail | null>(null)
  const [state, setState] = useState<{ missing: boolean; notFound: boolean; error: string | null }>({ missing: false, notFound: false, error: null })
  const [events, setEvents] = useState<InvestigationEvent[]>([])
  const [eventsMissing, setEventsMissing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [humanTask, setHumanTask] = useState<TaskOut | null>(null)
  const [tab, setTab] = useState<MobileTab>('navigateur')
  const lastEvent = useRef<number | undefined>(undefined)
  const stepUnsupported = useRef(false)
  const serverless = useRef(false)

  const loadDetail = useCallback(async () => {
    try { setInv(await investigationApi.get(id)); setState({ missing: false, notFound: false, error: null }) } catch (e) {
      // 404 sur une enquête précise : soit l'enquête n'existe pas, soit le module n'est pas installé (on vérifie la liste).
      if (isUnavailable(e)) {
        const listOk = await investigationApi.list().then(() => true).catch(() => false)
        setState({ missing: !listOk, notFound: listOk, error: null })
      } else setState((s) => ({ ...s, error: errMsg(e) }))
    }
  }, [id])
  const loadEvents = useCallback(async () => {
    try {
      const rows = await investigationApi.events(id, lastEvent.current, 100)
      if (rows.length) {
        lastEvent.current = Math.max(lastEvent.current ?? 0, ...rows.map((r) => r.id))
        setEvents((cur) => { const seen = new Set(cur.map((c) => c.id)); return [...cur, ...rows.filter((r) => !seen.has(r.id))].slice(-400) })
      }
      setEventsMissing(false)
    } catch (e) { if (isUnavailable(e)) setEventsMissing(true) }
  }, [id])

  useEffect(() => {
    setInv(null); setEvents([]); lastEvent.current = undefined
    loadDetail(); loadEvents()
    api.health().then((h) => { serverless.current = h.serverless }).catch(() => {})
  }, [loadDetail, loadEvents])

  const running = inv?.status === 'running'
  // Suivi en temps réel : fil d'activité toutes les 2,5 s quand l'enquête tourne, plus lentement sinon.
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible'
    const te = setInterval(() => { if (visible()) loadEvents() }, running ? 2500 : 10000)
    const td = setInterval(() => { if (visible()) loadDetail() }, running ? 5000 : 20000)
    return () => { clearInterval(te); clearInterval(td) }
  }, [running, loadDetail, loadEvents])
  // Mode hébergé (pas de processus permanent) : la vue ouverte fait avancer l'enquête toutes les ~15 s.
  // En local, seulement si l'enquête semble immobile depuis 45 s (aucun moteur en arrière-plan).
  useEffect(() => {
    if (!running) return
    const t = setInterval(async () => {
      if (stepUnsupported.current || document.visibilityState !== 'visible') return
      const idle = inv?.last_activity_at ? Date.now() - parseTs(inv.last_activity_at) > 45000 : true
      if (!serverless.current && !idle) return
      try { await investigationApi.step(id, 20); loadEvents(); loadDetail() } catch (e) { if (isUnavailable(e)) stepUnsupported.current = true }
    }, 15000)
    return () => clearInterval(t)
  }, [running, id, inv?.last_activity_at, loadDetail, loadEvents])

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try { await fn(); if (ok) notify('success', ok); await loadDetail(); loadEvents() } catch (e) {
      notify('error', isUnavailable(e) ? 'Cette action n’est pas encore disponible sur ce moteur.' : errMsg(e))
    } finally { setBusy(null) }
  }
  const retry = (t: TaskOut) => act(t.id, () => investigationApi.retryTask(t.id), t.kind === 'analyze_document' ? 'Nouvelle lecture du document demandée.' : 'Mission relancée.')
  const decide = (d: DiscoveryOut, how: 'validate' | 'reject') => act(`d-${d.id}`, () => investigationApi[how](d.kind as 'hypothesis' | 'mention', d.id),
    how === 'validate' ? 'Validé. Votre décision est enregistrée avec sa source.' : 'Rejeté. L’hypothèse reste consultable dans l’historique.')

  const docs = useMemo(() => (inv ? collectDocuments(inv) : []), [inv])
  const failed = useMemo(() => (inv?.tasks ?? []).filter((t) => t.status === 'failed'), [inv])
  const human = useMemo(() => (inv?.tasks ?? []).find(needsHuman) ?? null, [inv])

  if (state.missing) return <Shell><NotYetAvailable what="Le suivi des enquêtes autonomes" /></Shell>
  if (state.notFound) return <Shell><Notice tone="warn" title="Enquête introuvable" action={<Link className="btn-ghost" to="/investigation">Retour au Centre d’investigation</Link>}>Cette enquête n’existe pas ou a été supprimée.</Notice></Shell>
  if (!inv) return <Shell>{state.error ? <Notice tone="error" title="Impossible de charger l’enquête">{state.error}</Notice> : <Loading>Chargement de l’enquête…</Loading>}</Shell>

  const s = { ...ZERO_STATS, ...inv.stats }
  const discoveries = (inv.discoveries ?? []).filter((d) => d.kind !== 'filiation')
  const filiations = (inv.discoveries ?? []).filter((d) => d.kind === 'filiation')
  const canResume = ['paused', 'blocked', 'pending'].includes(String(inv.status))
  const finished = ['done', 'stopped', 'failed', 'to_verify'].includes(String(inv.status))
  const callsPct = inv.ai_call_ceiling ? Math.min(100, Math.round((inv.ai_calls_used / inv.ai_call_ceiling) * 100)) : 0
  const col = (t: MobileTab) => `${tab === t ? 'flex' : 'hidden'} lg:flex min-w-0 flex-col gap-4`

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 pb-8">
      {/* En-tête et commandes */}
      <header className="panel fade-up p-4 sm:p-5">
        <Link to="/investigation" className="mb-2 inline-flex items-center gap-1 text-[13px] text-mist-500 hover:text-night-900"><ArrowLeft size={14} />Centre d’investigation</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 font-display text-[24px] leading-tight text-night-900 sm:text-[28px] [overflow-wrap:anywhere]">{inv.person_name ? `Enquête sur ${inv.person_name}` : inv.title}</h1>
              <StatusBadge status={String(inv.status)} label={inv.status_label} />
            </div>
            {inv.objective && <p className="mt-1 text-[14px] text-night-900/75">{inv.objective}</p>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-mist-500">
              <span>Génération {inv.current_generation} sur {inv.max_generations}</span>
              <span>Mode {COST_MODE_LABEL[String(inv.cost_mode)] ?? inv.cost_mode}</span>
              <span>Temps de recherche {formatDuration(inv.active_seconds)}</span>
              <span>Dernière activité {relTime(inv.last_activity_at ?? inv.started_at)}</span>
              {inv.person_id && <Link to={`/personnes/${inv.person_id}`} className="text-ios-blue">Fiche de la personne</Link>}
            </div>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {running && <button className="btn-ghost" disabled={busy !== null} onClick={() => act('pause', () => investigationApi.pause(inv.id), 'Enquête en pause. Rien n’est perdu.')}>{busy === 'pause' ? <Spinner /> : <Pause size={15} />}Pause</button>}
            {canResume && <button className="btn-gold" disabled={busy !== null} onClick={() => act('resume', () => investigationApi.resume(inv.id), inv.status === 'pending' ? 'Enquête lancée.' : 'L’enquête reprend.')}>{busy === 'resume' ? <Spinner /> : <Play size={15} />}{inv.status === 'pending' ? 'Lancer' : 'Reprendre'}</button>}
            <button className="btn-ghost" disabled={busy !== null || failed.length === 0} title={failed.length ? `Relancer les ${failed.length} mission(s) en échec` : 'Aucune mission en échec'}
              onClick={() => act('retry-all', async () => { for (const t of failed) await investigationApi.retryTask(t.id) }, `${failed.length} mission(s) relancée(s).`)}>
              {busy === 'retry-all' ? <Spinner /> : <RotateCcw size={15} />}Analyser à nouveau{failed.length ? ` (${failed.length})` : ''}
            </button>
            {!finished && <button className="btn-ghost !text-conf-red" disabled={busy !== null} onClick={() => setConfirmStop(true)}><Square size={14} />Arrêter</button>}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {[{ n: s.persons_searched, l: 'personnes', i: <Users size={13} /> }, { n: s.pages_visited, l: 'pages', i: <Globe size={13} /> }, { n: s.documents_found, l: 'documents', i: <FileSearch size={13} /> },
            { n: s.hypotheses, l: 'hypothèses', i: <Lightbulb size={13} /> }, { n: s.filiations_verified, l: 'filiations vérifiées', i: <GitBranch size={13} /> }, { n: s.errors, l: 'erreurs', i: <Activity size={13} /> }].map((x) => (
            <div key={x.l} className="rounded-xl bg-ivory-100 px-2.5 py-2"><div className="flex items-start gap-1 text-[11px] leading-tight text-mist-500"><span className="mt-px shrink-0">{x.i}</span><span>{x.l}</span></div><div className="text-lg font-semibold tabular-nums text-night-900">{x.n}</div></div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mist-500">
          <Coins size={13} />
          <span className="h-1.5 w-32 overflow-hidden rounded-full bg-mist-200"><span className="block h-full rounded-full" style={{ width: `${callsPct}%`, background: callsPct >= 90 ? 'var(--color-conf-orange)' : AI.color }} /></span>
          <span>{inv.ai_calls_used} / {inv.ai_call_ceiling} appels IA utilisés</span>
          <Link to="/couts" className="text-ios-blue">Détail des coûts</Link>
        </div>
      </header>

      {/* Bandeau BLOQUÉE */}
      {inv.status === 'blocked' && (
        <div className="fade-up rounded-2xl border border-conf-orange/40 bg-[#fff6e8] p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-conf-orange/15 text-[#87510f]"><Hand size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-night-900">L’enquête est en attente : {inv.blocked_reason ?? 'une action est nécessaire'}</div>
              {human ? (
                <>
                  <p className="mt-1 text-[13px] leading-relaxed text-night-900/80">Le site demande une vérification humaine : ouvrez-le, faites l’action, puis cliquez sur « J’ai terminé ». L’IA ne résout jamais de CAPTCHA et ne se connecte jamais à votre place.</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {taskUrl(human) && <button className="btn-ghost" onClick={() => openExternal(taskUrl(human)!)}><ExternalLink size={15} />Ouvrir le site</button>}
                    <button className="btn-primary" onClick={() => setHumanTask(human)}><Check size={15} />J’ai terminé</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-1 text-[13px] leading-relaxed text-night-900/80">Aucune dépense n’a été faite au-delà de vos limites. Vous pouvez vérifier les quotas et plafonds, puis reprendre quand vous le souhaitez.</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Link to="/couts" className="btn-ghost"><Coins size={15} />Voir les quotas</Link>
                    <button className="btn-gold" disabled={busy !== null} onClick={() => act('resume', () => investigationApi.resume(inv.id), 'L’enquête reprend.')}><Play size={15} />Reprendre</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {inv.last_error && inv.status === 'failed' && <Notice tone="error" title="L’enquête s’est arrêtée sur une erreur">{inv.last_error}</Notice>}

      {/* Onglets (téléphone et tablette) */}
      <nav className="sticky top-[var(--top-h)] z-20 -mx-1 flex gap-1 rounded-2xl border border-[var(--hairline)] bg-ivory-50/95 p-1 backdrop-blur lg:hidden">
        {([['missions', 'Missions', (inv.tasks ?? []).filter((t) => t.status !== 'done' && t.status !== 'cancelled').length], ['navigateur', 'En direct', 0], ['decouvertes', 'Découvertes', (inv.discoveries ?? []).length]] as const).map(([k, l, n]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[13px] font-medium ${tab === k ? 'bg-night-900 text-ivory-50' : 'text-night-900'}`}>
            {l}{n > 0 && <span className={`rounded-full px-1.5 text-[11px] ${tab === k ? 'bg-white/20' : 'bg-mist-200 text-mist-500'}`}>{n}</span>}
          </button>
        ))}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.85fr)_minmax(0,1.5fr)_minmax(280px,1fr)]">
        {/* Gauche : missions et personnes */}
        <div className={col('missions')}>
          <Column title="Personnes" icon={<Users size={16} />} count={inv.persons?.length}><PersonsList inv={inv} /></Column>
          <Column title="Missions" icon={<ListChecks size={16} />} count={(inv.tasks ?? []).length}>
            <TasksList tasks={inv.tasks ?? []} busy={busy} onRetry={retry} onHumanDone={(t) => setHumanTask(t)} />
          </Column>
        </div>
        {/* Centre : navigateur, documents, activité */}
        <div className={col('navigateur')}>
          <Column title="Navigateur" icon={<Globe size={16} />} actions={running ? <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: AI.dark }}><span className="h-2 w-2 animate-pulse rounded-full" style={{ background: AI.color }} />en direct</span> : null}>
            <BrowserView pages={inv.recent_pages ?? []} running={running} />
          </Column>
          <Column title="Documents trouvés" icon={<FileSearch size={16} />} count={docs.length}><DocumentsGrid docs={docs} busy={busy} onReanalyze={retry} /></Column>
          <Column title="Fil d’activité" icon={<Radar size={16} />} count={events.length}><ActivityFeed events={events} live={running} missing={eventsMissing} /></Column>
        </div>
        {/* Droite : découvertes, filiations, prochaines recherches */}
        <div className={col('decouvertes')}>
          <Column title="Découvertes" icon={<Lightbulb size={16} />} count={discoveries.length}>
            <p className="-mt-1 mb-2.5 text-[12px] leading-snug text-mist-500">Chaque découverte reste une piste tant que vous ne l’avez pas validée. Ouvrez toujours la source pour juger par vous-même.</p>
            {discoveries.length === 0 ? <p className="rounded-xl bg-ivory-100/70 p-3 text-center text-[13px] text-mist-500">Pas encore de découverte.</p> : (
              <div className="space-y-2.5">{discoveries.map((d) => <DiscoveryCard key={`${d.kind}-${d.id}`} d={d} busy={busy === `d-${d.id}`} onValidate={(x) => decide(x, 'validate')} onReject={(x) => decide(x, 'reject')} />)}</div>
            )}
          </Column>
          <Column title="Filiations" icon={<GitBranch size={16} />} count={filiations.length}>
            <p className="-mt-1 mb-2.5 text-[12px] leading-snug text-mist-500">Une filiation n’est marquée vérifiée qu’avec un acte qui nomme explicitement les parents.</p>
            {filiations.length === 0 ? <p className="rounded-xl bg-ivory-100/70 p-3 text-center text-[13px] text-mist-500">Aucune filiation établie pour l’instant.</p> : (
              <div className="space-y-2.5">{filiations.map((d) => <DiscoveryCard key={d.id} d={d} busy={busy === `d-${d.id}`} onValidate={(x) => decide(x, 'validate')} onReject={(x) => decide(x, 'reject')} />)}</div>
            )}
          </Column>
          <Column title="Prochaines recherches" icon={<ListChecks size={16} />} count={(inv.next_searches ?? []).length}><NextSearches tasks={inv.next_searches ?? []} /></Column>
        </div>
      </div>

      {confirmStop && (
        <ConfirmDialog title="Arrêter l’enquête ?" confirmLabel="Arrêter l’enquête" danger busy={busy === 'stop'} onClose={() => setConfirmStop(false)}
          onConfirm={() => act('stop', () => investigationApi.stop(inv.id), 'Enquête arrêtée.').then(() => setConfirmStop(false))}>
          <p>L’enquête ne lancera plus aucune recherche. Tout ce qui a été trouvé (documents, hypothèses, sources) est conservé.</p>
          <p className="text-mist-500">Si vous voulez simplement faire une pause, préférez « Pause » : vous pourrez reprendre plus tard au même endroit.</p>
        </ConfirmDialog>
      )}
      {humanTask && <HumanDoneDialog task={humanTask} onClose={() => setHumanTask(null)} onDone={async (note) => { await act(humanTask.id, () => investigationApi.humanDone(humanTask.id, note), 'Merci ! L’enquête reprend.'); setHumanTask(null) }} />}
    </div>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-3xl space-y-3 pt-2"><Link to="/investigation" className="inline-flex items-center gap-1 text-[13px] text-mist-500 hover:text-night-900"><ArrowLeft size={14} />Centre d’investigation</Link>{children}</div>
}

function HumanDoneDialog({ task, onClose, onDone }: { task: TaskOut; onClose: () => void; onDone: (note?: string) => Promise<void> }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const url = taskUrl(task)
  return (
    <Modal title="Vous avez terminé sur le site ?" onClose={onClose} footer={<>
      <button className="btn-ghost" onClick={onClose}>Annuler</button>
      <button className="btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await onDone(note.trim() || undefined) } finally { setBusy(false) } }}>{busy ? <Spinner /> : <Check size={15} />}J’ai terminé</button>
    </>}>
      <p className="text-sm">Mission : <strong>{task.title}</strong></p>
      {url && <button className="mt-2 inline-flex items-center gap-1 text-sm text-ios-blue" onClick={() => openExternal(url)}><ExternalLink size={14} />Rouvrir le site</button>}
      <label className="mt-3 block"><span className="label">Ce que vous avez fait ou trouvé (facultatif)</span>
        <textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. : j’ai validé la vérification ; l’acte est à la page 12 du registre" />
      </label>
    </Modal>
  )
}
