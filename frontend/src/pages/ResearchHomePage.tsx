import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity, Archive, ArrowRight, CheckCircle2, ExternalLink, FileText, GitFork, HelpCircle, Lightbulb, Play, Rocket, Search, Sparkles,
  Upload, UserPlus, Users, Zap,
} from 'lucide-react'
import { api, openExternal, type Advice, type Discovery, type PersonSummary, type Priority, type QuestionOut } from '../api'
import { useApp, pulseEngine } from '../store'
import { Spinner, formatTs } from '../components/ui'
import { AI, Avatar, ageText, errMsg } from '../components/person/helpers'
import { AdviceBody } from '../components/person/AdviceBody'
import { AddRelativeMenu } from '../components/relatives/AddRelative'

type Worker = Awaited<ReturnType<typeof api.worker>>

function relTime(ts: string) {
  const d = new Date(ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z').getTime()
  const s = Math.max(0, (Date.now() - d) / 1000)
  if (s < 60) return 'à l’instant'
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`
  if (s < 86400 * 30) return `il y a ${Math.floor(s / 86400)} j`
  return new Date(d).toLocaleDateString('fr-FR')
}

/** Carte de section, style iOS avec titre en gras. */
function Card({ title, icon, actions, children, className = '' }: { title: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`fade-up rounded-3xl bg-white p-4 shadow-[0_1px_2px_rgba(20,40,80,0.06),0_10px_30px_-18px_rgba(20,40,80,0.35)] ring-1 ring-black/5 sm:p-5 ${className}`}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-[18px] font-bold text-night-900">{icon && <span style={{ color: AI.color }}>{icon}</span>}<span className="truncate">{title}</span></h2>
        {actions}
      </header>
      {children}
    </section>
  )
}

export default function ResearchHomePage() {
  const { dashboard, settings, refreshDashboard } = useApp()
  if (!dashboard) return <div className="flex items-center justify-center gap-2 p-10 text-mist-500"><Spinner /> Connexion au moteur de recherche…</div>
  if (dashboard.persons === 0) return <EmptyTreeWelcome />
  return <ResearchCentre key="centre" paused={Boolean(settings?.research_pause)} refreshDashboard={refreshDashboard} />
}

/* ---------- Arbre vide : démarrer simplement ---------- */
function EmptyTreeWelcome() {
  return (
    <div className="mx-auto max-w-xl space-y-4 pt-2">
      <section className="fade-up overflow-hidden rounded-[28px] p-6 text-center shadow-sm ring-1 ring-[#5b3fd6]/15" style={{ background: `linear-gradient(160deg, ${AI.soft}, #ffffff)` }}>
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl text-white shadow-lg" style={{ background: AI.color }}><Sparkles size={30} /></span>
        <h1 className="mt-4 text-[26px] font-bold leading-tight text-night-900">Commençons par vos grands-parents</h1>
        <p className="mx-auto mt-2 max-w-md text-[15px] text-night-900/75">Donnez simplement leurs noms. L’IA cherche ensuite dans les archives en ligne et remonte votre arbre toute seule. Elle ne vous pose une question que lorsqu’elle a un doute.</p>
        <Link to="/demarrer" className="btn-gold mt-5 w-full justify-center !py-3.5 text-[17px]"><Rocket size={19} />Démarrer par mes grands-parents</Link>
        <Link to="/archives?tab=import" className="btn-ghost mt-2.5 w-full justify-center bg-white !py-3 text-[15px]"><Upload size={17} />Importer un arbre (GEDCOM)</Link>
        <Link to="/bienvenue" className="mt-4 inline-block text-[14px] font-medium text-[#2f6fd1]">Commencer par moi</Link>
      </section>
      <div className="grid grid-cols-3 gap-2 text-center text-xs text-mist-500">
        {[{ i: <Users size={18} />, t: 'Vous donnez quelques noms' }, { i: <Search size={18} />, t: 'L’IA fouille les archives' }, { i: <CheckCircle2 size={18} />, t: 'Chaque fait est sourcé' }].map((x) => (
          <div key={x.t} className="rounded-2xl bg-white p-3 ring-1 ring-black/5"><span className="mx-auto mb-1 flex justify-center" style={{ color: AI.color }}>{x.i}</span>{x.t}</div>
        ))}
      </div>
    </div>
  )
}

/* ---------- Centre de recherche ---------- */
function ResearchCentre({ paused: pausedSetting, refreshDashboard }: { paused: boolean; refreshDashboard: () => Promise<void> }) {
  const { dashboard, notify, liveLogs, refreshSettings } = useApp()
  const nav = useNavigate()
  const [worker, setWorker] = useState<Worker | null>(null)
  const [priorities, setPriorities] = useState<Priority[] | null>(null)
  const [discoveries, setDiscoveries] = useState<Discovery[] | null>(null)
  const [discErr, setDiscErr] = useState<string | null>(null)
  const [questions, setQuestions] = useState<QuestionOut[] | null>(null)
  const [persons, setPersons] = useState<PersonSummary[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showAllDisc, setShowAllDisc] = useState(false)

  const load = useCallback(() => {
    api.worker().then(setWorker).catch(() => setWorker(null))
    api.priorities().then(setPriorities).catch(() => setPriorities([]))
    api.discoveries(40).then((d) => { setDiscoveries(d); setDiscErr(null) }).catch((e: unknown) => setDiscErr(errMsg(e)))
    api.questions('pending').then((q) => setQuestions([...q].sort((a, b) => b.priority - a.priority))).catch(() => setQuestions([]))
    api.persons(undefined, 1000).then(setPersons).catch(() => setPersons([]))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const h = () => { load(); refreshDashboard() }
    window.addEventListener('genealis:event', h)
    const t = setInterval(() => api.worker().then(setWorker).catch(() => {}), 15000)
    return () => { window.removeEventListener('genealis:event', h); clearInterval(t) }
  }, [load, refreshDashboard])

  if (!dashboard) return null
  const paused = pausedSetting || Boolean(worker?.paused)
  const active = dashboard.tasks_running + dashboard.tasks_queued
  const running = Boolean(worker?.current_task_id) || dashboard.tasks_running > 0

  const launchWave = async () => {
    setBusy('wave')
    try {
      const top = (priorities ?? (await api.priorities())).slice(0, 3)
      let n = 0
      for (const p of top) n += (await api.explore(p.person_id, 2)).length
      pulseEngine(); await refreshDashboard(); load()
      notify(n ? 'success' : 'info', n ? `${n} recherche(s) lancée(s). L’IA travaille ; elle vous consultera seulement si nécessaire.` : 'Rien de nouveau à chercher pour l’instant : ajoutez une personne ou un document.')
    } catch (e) { notify('error', errMsg(e, 'Impossible de lancer les recherches.')) } finally { setBusy(null) }
  }
  const resume = async () => {
    setBusy('resume')
    try { await api.pauseWorker(false); await refreshSettings(); pulseEngine(); load(); notify('success', 'Les recherches reprennent.') } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) }
  }

  let status: string; let detail: string | null = null; let action: ReactNode
  if (paused) {
    status = 'Les recherches sont en pause.'; detail = active ? `${active} recherche(s) attendent de reprendre.` : null
    action = <button className="btn-gold w-full justify-center !py-3 text-base" disabled={busy !== null} onClick={resume}>{busy === 'resume' ? <Spinner /> : <Play size={18} />}Reprendre les recherches</button>
  } else if (dashboard.questions_pending > 0) {
    status = `L’IA a besoin de vous : ${dashboard.questions_pending} question${dashboard.questions_pending > 1 ? 's' : ''} en attente.`
    detail = active ? `En parallèle, ${active} recherche(s) continuent.` : 'Vos réponses débloquent la suite des recherches.'
    action = <Link to="/questions" className="btn-gold w-full justify-center !py-3 text-base"><HelpCircle size={18} />Répondre aux questions</Link>
  } else if (dashboard.tasks_waiting > 0) {
    status = `${dashboard.tasks_waiting} recherche(s) attendent votre accord.`; detail = 'Vous avez choisi de valider les recherches avant qu’elles démarrent.'
    action = <Link to="/enquetes" className="btn-gold w-full justify-center !py-3 text-base"><Play size={18} />Voir et approuver</Link>
  } else if (active > 0) {
    status = running ? `L’IA enquête en ce moment : ${active} recherche(s) en cours ou en file.` : `${active} recherche(s) en file d’attente.`
    detail = 'Vous pouvez fermer l’application : les résultats vous attendront ici.'
    action = <Link to="/arbre-interactif" className="btn-gold w-full justify-center !py-3 text-base"><GitFork size={18} />Voir l’arbre</Link>
  } else {
    status = 'Tout est à jour.'; detail = 'Lancez une nouvelle vague de recherches sur les ancêtres les plus prometteurs.'
    action = <button className="btn-gold w-full justify-center !py-3 text-base" disabled={busy !== null} onClick={launchWave}>{busy === 'wave' ? <Spinner /> : <Sparkles size={18} />}Lancer les recherches</button>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-6">
      {/* Que se passe-t-il ? */}
      <section className="fade-up overflow-hidden rounded-[28px] p-5 text-white shadow-[0_18px_40px_-20px_rgba(91,63,214,0.8)]" style={{ background: 'linear-gradient(140deg, #6a4ee6 0%, #5b3fd6 45%, #4329b8 100%)' }}>
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/75">
          <span className={`h-2 w-2 rounded-full ${paused ? 'bg-amber-300' : running ? 'animate-pulse bg-emerald-300' : 'bg-white/60'}`} />Centre de recherche IA
        </div>
        <h1 className="mt-1.5 text-[22px] font-bold leading-snug sm:text-[26px]">{status}</h1>
        {detail && <p className="mt-1 text-[14px] text-white/80">{detail}</p>}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[{ n: dashboard.persons, l: 'personnes' }, { n: dashboard.generations, l: 'générations' }, { n: dashboard.sources, l: 'sources' }].map((x) => (
            <div key={x.l} className="rounded-2xl px-2 py-2" style={{ background: 'rgba(255,255,255,0.12)' }}><div className="text-xl font-bold">{x.n}</div><div className="text-[11px] text-white/75">{x.l}</div></div>
          ))}
        </div>
        <div className="mt-4 [&_.btn-gold]:bg-white [&_.btn-gold]:text-[#4329b8] [&_.btn-gold:hover]:bg-white/90">{action}</div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <WhoToFind persons={persons} priorities={priorities} onChanged={() => { load(); refreshDashboard() }} />
          <PrioritiesCard priorities={priorities} onLaunched={() => { load(); refreshDashboard() }} />
          <Card title="Découvertes" icon={<Lightbulb size={19} />} actions={<Link to="/enquetes" className="text-[14px] font-medium text-[#2f6fd1]">Enquêtes</Link>}>
            {discErr ? <p className="text-sm text-conf-red">{discErr}</p> : discoveries === null ? <Spinner /> : discoveries.length === 0 ? (
              <p className="rounded-2xl bg-[#f4f6fb] p-4 text-center text-sm text-mist-500">Pas encore de découverte. Lancez une recherche : les pistes, sources et documents trouvés s’afficheront ici.</p>
            ) : (
              <ol className="relative space-y-2.5 border-l-2 border-[#ece6ff] pl-4">
                {(showAllDisc ? discoveries : discoveries.slice(0, 8)).map((d) => <DiscoveryItem key={`${d.kind}-${d.id}`} d={d} onOpen={(to) => nav(to)} />)}
              </ol>
            )}
            {discoveries && discoveries.length > 8 && !showAllDisc && <button className="mt-3 w-full text-center text-[14px] font-medium text-[#2f6fd1]" onClick={() => setShowAllDisc(true)}>Voir les {discoveries.length} découvertes</button>}
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <QuestionsCard questions={questions} onAnswered={() => { load(); refreshDashboard() }} />
          <Card title="Recherches en direct" icon={<Activity size={19} />}>
            {liveLogs.length === 0 ? <p className="text-sm text-mist-500">Aucune activité récente du moteur.</p> : (
              <ul className="space-y-1.5">
                {liveLogs.slice(0, 8).map((l) => (
                  <li key={l.id} className="flex gap-2.5 text-[13px] leading-snug">
                    <span className="shrink-0 tabular-nums text-mist-400">{formatTs(l.ts).slice(0, 5)}</span>
                    <span className={`min-w-0 ${l.level === 'error' ? 'text-conf-red' : l.level === 'warning' ? 'text-[#8a5a10]' : 'text-night-900'}`}>{l.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <ArchiveUrlCard persons={persons} />
        </div>
      </div>
    </div>
  )
}

/* ---------- Qui voulez-vous retrouver ? ---------- */
function WhoToFind({ persons, priorities, onChanged }: { persons: PersonSummary[] | null; priorities: Priority[] | null; onChanged: () => void }) {
  const { notify } = useApp()
  const [query, setQuery] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [advice, setAdvice] = useState<{ id: string; loading: boolean; data: Advice | null; error: string | null } | null>(null)
  const ordered = useMemo(() => {
    if (!persons) return []
    const rank = new Map((priorities ?? []).map((p, i) => [p.person_id, i]))
    const q = query.trim().toLowerCase()
    return persons
      .filter((p) => !q || p.display_name.toLowerCase().includes(q) || (p.birth_place ?? '').toLowerCase().includes(q))
      .sort((a, b) => (rank.get(a.id) ?? (a.is_root ? -1 : 999)) - (rank.get(b.id) ?? (b.is_root ? -1 : 999)))
      .slice(0, 40)
  }, [persons, priorities, query])
  const selected = (persons ?? []).find((p) => p.id === selId) ?? ordered[0] ?? null

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    try { notify('success', await fn()); pulseEngine(); onChanged() } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) }
  }
  const loadAdvice = async (id: string) => {
    setAdvice({ id, loading: true, data: null, error: null })
    try { setAdvice({ id, loading: false, data: await api.advice(id), error: null }) } catch (e) { setAdvice({ id, loading: false, data: null, error: errMsg(e) }) }
  }

  return (
    <Card title="Qui voulez-vous retrouver ?" icon={<Search size={19} />}>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-2.5 text-mist-400" />
        <input className="input pl-9" placeholder="Chercher une personne de l’arbre…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-5 sm:px-5">
        {persons === null && <Spinner />}
        {persons !== null && ordered.length === 0 && <p className="text-sm text-mist-500">Personne ne correspond.</p>}
        {ordered.map((p) => (
          <button key={p.id} onClick={() => { setSelId(p.id); setAdvice(null) }} className={`flex w-[76px] shrink-0 flex-col items-center gap-1 rounded-2xl p-1.5 text-center ${selected?.id === p.id ? 'bg-[#ece6ff]' : 'hover:bg-black/[0.03]'}`}>
            <Avatar p={p} size={48} />
            <span className={`line-clamp-2 text-[11px] leading-tight ${selected?.id === p.id ? 'font-semibold text-[#3f2aa8]' : 'text-night-900'}`}>{p.display_name}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="mt-3 rounded-2xl bg-[#f7f5ff] p-3.5 ring-1 ring-[#5b3fd6]/10">
          <Link to={`/personnes/${selected.id}`} className="flex items-center gap-3">
            <Avatar p={selected} size={44} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-semibold text-night-900">{selected.display_name}</div>
              <div className="truncate text-xs text-mist-500">{[selected.birth_display ? `☆ ${selected.birth_display}` : null, selected.death_display ? `† ${selected.death_display}` : null, ageText(selected)].filter(Boolean).join(' · ') || 'Dates inconnues'}</div>
            </div>
            <ArrowRight size={17} className="shrink-0 text-mist-400" />
          </Link>
          {(() => { const pr = priorities?.find((x) => x.person_id === selected.id); return pr && pr.missing.length > 0 ? <p className="mt-2 text-xs text-[#3f2aa8]">À trouver : {pr.missing.map((m) => MISSING[m] ?? m).join(', ')}</p> : null })()}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <BigAction icon={<Users size={20} />} label="Retrouver ses parents" busy={busy === 'parents'} disabled={busy !== null}
              onClick={() => act('parents', async () => { const t = await api.createTask({ task_type: 'find_parents', person_id: selected.id }); return `Recherche « ${t.title} » lancée.` })} />
            <BigAction icon={<GitFork size={20} />} label="Explorer toute sa branche" busy={busy === 'branch'} disabled={busy !== null}
              onClick={() => act('branch', async () => { const t = await api.explore(selected.id, 3); return t.length ? `${t.length} recherche(s) lancée(s) sur la branche de ${selected.display_name}.` : 'Ces recherches sont déjà en cours ou terminées.' })} />
            <BigAction icon={<UserPlus size={20} />} label="Ajouter un proche" onClick={() => setMenu(true)} disabled={busy !== null} />
          </div>
          {advice?.id !== selected.id ? (
            <button onClick={() => loadAdvice(selected.id)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-2.5 text-[14px] font-medium ring-1 ring-[#5b3fd6]/20 hover:ring-[#5b3fd6]/50" style={{ color: AI.dark }}><Lightbulb size={16} />Pistes de l’IA</button>
          ) : (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center gap-2 text-[14px] font-semibold" style={{ color: AI.dark }}><Lightbulb size={16} />Pistes de l’IA</div>
              {advice.loading && <div className="flex items-center gap-2 text-sm text-mist-500"><Spinner /> L’IA prépare un plan de recherche…</div>}
              {advice.error && <p className="text-sm text-conf-red">{advice.error}</p>}
              {advice.data && <AdviceBody a={advice.data} />}
            </div>
          )}
        </div>
      )}
      {menu && selected && <AddRelativeMenu anchor={{ id: selected.id, display_name: selected.display_name, sex: selected.sex, surname: selected.surname }} onClose={() => setMenu(false)} onAdded={() => onChanged()} />}
    </Card>
  )
}
function BigAction({ icon, label, onClick, busy, disabled }: { icon: ReactNode; label: string; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left text-[15px] font-semibold text-white shadow-sm disabled:opacity-60 sm:flex-col sm:items-start sm:gap-1.5" style={{ background: AI.color }}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/20">{busy ? <Spinner /> : icon}</span>{label}
    </button>
  )
}

/* ---------- Priorités ---------- */
const MISSING: Record<string, string> = { birth: 'naissance', marriage: 'mariage', death: 'décès', parents: 'parents' }
function PrioritiesCard({ priorities, onLaunched }: { priorities: Priority[] | null; onLaunched: () => void }) {
  const { notify } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const launch = async (p: Priority) => {
    setBusy(p.person_id)
    try {
      const t = await api.explore(p.person_id, 2); pulseEngine(); onLaunched()
      notify(t.length ? 'success' : 'info', t.length ? `${t.length} recherche(s) lancée(s) pour ${p.name}.` : `Les recherches pour ${p.name} sont déjà en cours ou faites.`)
    } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) }
  }
  return (
    <Card title="Priorités" icon={<Zap size={19} />}>
      <p className="-mt-1 mb-2 text-xs text-mist-500">Les ancêtres pour lesquels l’IA a le plus de chances de trouver quelque chose.</p>
      {priorities === null ? <Spinner /> : priorities.length === 0 ? <p className="text-sm text-mist-500">Aucune priorité : l’arbre est bien documenté, ou il manque des noms et des lieux.</p> : (
        <ul className="divide-y divide-black/5">
          {priorities.slice(0, 5).map((p, i) => (
            <li key={p.person_id} className="flex items-center gap-3 py-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: AI.soft, color: AI.dark }}>{i + 1}</span>
              <Link to={`/personnes/${p.person_id}`} className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium text-night-900">{p.name}{p.birth_year ? <span className="font-normal text-mist-500"> · {p.birth_year}</span> : null}</div>
                <div className="truncate text-xs text-mist-500">{p.missing.length ? `À trouver : ${p.missing.map((m) => MISSING[m] ?? m).join(', ')}` : 'À compléter'}{p.estimated_minutes ? ` · ~${p.estimated_minutes} min` : ''}</div>
              </Link>
              <button className="btn-gold shrink-0 !px-3 !py-1.5" disabled={busy !== null} onClick={() => launch(p)}>{busy === p.person_id ? <Spinner /> : <Play size={14} />}Lancer</button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ---------- Découvertes ---------- */
const DISC: Record<Discovery['kind'], { label: string; icon: ReactNode; bg: string; fg: string }> = {
  hypothesis: { label: 'Piste trouvée', icon: <Lightbulb size={15} />, bg: '#ece6ff', fg: '#5b3fd6' },
  source: { label: 'Source enregistrée', icon: <FileText size={15} />, bg: '#dfeafc', fg: '#2f6fd1' },
  archive: { label: 'Document archivé', icon: <Archive size={15} />, bg: '#e3f4e6', fg: '#2f6b3b' },
  question: { label: 'Question posée', icon: <HelpCircle size={15} />, bg: '#fff1dc', fg: '#a2660c' },
}
function DiscoveryItem({ d, onOpen }: { d: Discovery; onOpen: (to: string) => void }) {
  const m = DISC[d.kind]
  const to = d.kind === 'archive' ? `/archives?media=${d.id}` : d.kind === 'question' ? '/questions' : d.kind === 'source' ? `/archives?source=${d.id}` : d.person_id ? `/personnes/${d.person_id}` : null
  return (
    <li className="relative">
      <span className="absolute -left-[27px] top-2 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-white" style={{ background: m.bg, color: m.fg }}>{m.icon}</span>
      <div className="rounded-2xl bg-[#f7f8fc] p-3">
        <div className="flex items-center justify-between gap-2 text-[11px]"><span className="font-semibold uppercase tracking-wide" style={{ color: m.fg }}>{m.label}</span><span className="shrink-0 text-mist-400">{relTime(d.created_at)}</span></div>
        <button disabled={!to} onClick={() => to && onOpen(to)} className="mt-0.5 block w-full text-left text-[14px] font-medium leading-snug text-night-900 disabled:cursor-default">{d.title}</button>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {d.person_id && d.person_name && <Link to={`/personnes/${d.person_id}`} className="font-medium text-[#2f6fd1]">{d.person_name}</Link>}
          {d.kind === 'hypothesis' && typeof d.score === 'number' && <span className="text-mist-500">score {Math.round(d.score)}/100</span>}
          {d.kind === 'question' && d.status === 'pending' && <span className="text-[#a2660c]">en attente de réponse</span>}
          {d.url && <button onClick={() => openExternal(d.url as string)} className="inline-flex items-center gap-1 text-mist-500 hover:text-night-900"><ExternalLink size={12} />Voir en ligne</button>}
        </div>
      </div>
    </li>
  )
}

/* ---------- Questions en attente ---------- */
function QuestionsCard({ questions, onAnswered }: { questions: QuestionOut[] | null; onAnswered: () => void }) {
  const { notify } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const answer = async (q: QuestionOut, t: 'yes' | 'no' | 'unknown') => {
    setBusy(q.id + t)
    try {
      await api.answerQuestion(q.id, { answer_type: t, answer: t === 'yes' ? 'Oui' : t === 'no' ? 'Non' : 'Je ne sais pas' })
      notify('success', 'Merci, réponse enregistrée. L’IA continue.'); pulseEngine(); onAnswered()
    } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) }
  }
  return (
    <Card title="Questions en attente" icon={<HelpCircle size={19} />} actions={<Link to="/questions" className="text-[14px] font-medium text-[#2f6fd1]">Toutes{questions && questions.length ? ` (${questions.length})` : ''}</Link>}>
      {questions === null ? <Spinner /> : questions.length === 0 ? <p className="flex items-center gap-2 text-sm text-mist-500"><CheckCircle2 size={16} className="text-sage-600" />Aucune question : l’IA avance seule.</p> : (
        <ul className="space-y-2.5">
          {questions.slice(0, 3).map((q) => (
            <li key={q.id} className="rounded-2xl bg-[#fffaf0] p-3 ring-1 ring-[#f0d9a8]">
              <div className="text-[14px] font-medium leading-snug text-night-900">{q.title}</div>
              {q.problem && <p className="mt-0.5 line-clamp-2 text-xs text-mist-500">{q.problem}</p>}
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {([['yes', 'Oui'], ['no', 'Non'], ['unknown', 'Je ne sais pas']] as const).map(([t, l]) => (
                  <button key={t} disabled={busy !== null} onClick={() => answer(q, t)} className={`rounded-xl py-2 text-[13px] font-medium ring-1 disabled:opacity-50 ${t === 'yes' ? 'bg-[#e3f4e6] text-[#2f6b3b] ring-[#bfe3c6]' : t === 'no' ? 'bg-[#fde8e6] text-[#7d2b22] ring-[#f3c6c1]' : 'bg-white text-mist-500 ring-black/10'}`}>{busy === q.id + t ? <Spinner /> : l}</button>
                ))}
              </div>
              <Link to="/questions" className="mt-1.5 inline-block text-xs text-[#2f6fd1]">Voir les détails et documents</Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ---------- Archiver un document trouvé sur Internet ---------- */
function ArchiveUrlCard({ persons }: { persons: PersonSummary[] | null }) {
  const { notify } = useApp()
  const [url, setUrl] = useState('')
  const [personId, setPersonId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string; mediaId?: string } | null>(null)
  const submit = async () => {
    if (!url.trim()) return
    setBusy(true); setResult(null)
    try {
      const res = await api.archiveUrl(url.trim(), { person_id: personId || undefined })
      setResult({ ok: true, text: `${res.length} document(s) archivé(s) dans l’application.`, mediaId: res[0]?.id }); setUrl('')
      notify('success', 'Document archivé.')
    } catch (e) { setResult({ ok: false, text: errMsg(e) }) } finally { setBusy(false) }
  }
  return (
    <Card title="Archiver un document trouvé sur Internet" icon={<Archive size={19} />}>
      <p className="-mt-1 mb-3 text-xs text-mist-500">Un acte, une photo, un PDF ou une page web : l’application en garde une copie (quand le site l’autorise) et l’analyse.</p>
      <div className="space-y-2">
        <input className="input" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">Personne concernée (facultatif)</option>
          {(persons ?? []).map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.birth_year ? ` (${p.birth_year})` : ''}</option>)}
        </select>
        <button className="btn-primary w-full justify-center !py-2.5" disabled={busy || !url.trim()} onClick={submit}>{busy ? <Spinner /> : <Archive size={16} />}Archiver</button>
      </div>
      {result && (
        <p className={`mt-2 text-sm ${result.ok ? 'text-sage-600' : 'text-conf-red'}`}>{result.text} {result.ok && result.mediaId && <Link className="font-medium text-[#2f6fd1]" to={`/archives?media=${result.mediaId}`}>Ouvrir</Link>}</p>
      )}
    </Card>
  )
}

