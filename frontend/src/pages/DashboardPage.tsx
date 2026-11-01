import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Archive, BookOpen, Clock3, Compass, FileText, Globe2, HelpCircle, Layers, Lightbulb, MessageSquare, Play, Sparkles, Upload, UserPlus, Users } from 'lucide-react'
import { api, ApiError, type Confidence, type Dashboard, type Priority } from '../api'
import { useApp } from '../store'
import GuidedHome from '../components/dashboard/GuidedHome'
import { Empty, Panel, Spinner } from '../components/ui'
import LiveFeed from '../components/dashboard/LiveFeed'

const MISSING_LABEL: Record<string, string> = { birth: 'acte de naissance', marriage: 'acte de mariage', death: 'acte de décès', parents: 'parents' }
const CONF_ORDER: Confidence[] = ['green', 'orange', 'red', 'grey']
const CONF_TITLE: Record<Confidence, string> = { green: 'établies', orange: 'à vérifier', red: 'contradictoires', grey: 'inconnues' }

function StatTile({ icon: Icon, label, value, sub, to, accent = 'night' }: { icon: typeof Users; label: string; value: string | number; sub?: ReactNode; to?: string; accent?: 'night' | 'gold' | 'sage' | 'red' }) {
  const ring = { night: 'text-night-900 bg-night-900/8', gold: 'text-gold-600 bg-gold-500/15', sage: 'text-sage-600 bg-sage-500/15', red: 'text-conf-red bg-conf-red/10' }[accent]
  const body = (
    <div className="panel fade-up flex h-full flex-col gap-2 p-4 transition-shadow hover:shadow-lg">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-mist-500">{label}</span>
        <span className={`rounded-lg p-1.5 ${ring}`}><Icon size={15} strokeWidth={1.8} /></span>
      </div>
      <div className="font-display text-3xl leading-none text-night-900">{value}</div>
      {sub && <div className="text-xs text-mist-500">{sub}</div>}
    </div>
  )
  return to ? <Link to={to} className="block h-full">{body}</Link> : body
}

function ConfidenceBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (!total) return <span>Aucune filiation enregistrée</span>
  return (
    <div className="space-y-1">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-mist-200">
        {CONF_ORDER.map((c) => (counts[c] ? <span key={c} className={`dot-${c}`} style={{ width: `${(100 * counts[c]) / total}%` }} title={`${counts[c]} ${CONF_TITLE[c]}`} /> : null))}
      </div>
      <div className="flex flex-wrap gap-x-2 text-[11px]">
        {CONF_ORDER.filter((c) => counts[c]).map((c) => <span key={c} className="inline-flex items-center gap-1"><span className={`inline-block h-1.5 w-1.5 rounded-full dot-${c}`} />{counts[c]} {CONF_TITLE[c]}</span>)}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const storeDashboard = useApp((s) => s.dashboard)
  const settings = useApp((s) => s.settings)
  const notify = useApp((s) => s.notify)
  const refreshDashboard = useApp((s) => s.refreshDashboard)
  const [data, setData] = useState<Dashboard | null>(storeDashboard)
  const [error, setError] = useState<string | null>(null)
  const [priorities, setPriorities] = useState<Priority[] | null>(null)
  const [prioError, setPrioError] = useState<string | null>(null)
  const [launching, setLaunching] = useState<string | null>(null)

  const loadPriorities = useCallback(() => {
    api.priorities().then(setPriorities).catch((e: unknown) => { setPriorities([]); setPrioError(e instanceof ApiError ? e.message : 'Priorités indisponibles.') })
  }, [])

  useEffect(() => {
    let alive = true
    api.dashboard().then((d) => { if (alive) { setData(d); setError(null) } })
      .catch((e: unknown) => { if (alive) setError(e instanceof ApiError ? `Tableau de bord indisponible : ${e.message}` : 'Le moteur local ne répond pas. Vérifiez que GENEALIS est bien démarré.') })
    loadPriorities()
    return () => { alive = false }
  }, [loadPriorities])
  useEffect(() => { if (storeDashboard) setData(storeDashboard) }, [storeDashboard])

  const launch = async (p: Priority) => {
    setLaunching(p.person_id)
    try {
      const tasks = await api.explore(p.person_id, 2)
      notify('success', `${tasks.length} enquête(s) planifiée(s) pour ${p.name}.`)
      await refreshDashboard(); loadPriorities()
    } catch (e) { notify('error', e instanceof ApiError ? e.message : "Impossible de lancer l'enquête.") }
    finally { setLaunching(null) }
  }

  const showHero = useMemo(() => (data ? data.persons === 0 : false) || settings?.onboarding_done === false, [data, settings])

  if (!data && !error) return <div className="flex items-center gap-3 p-8 text-mist-500"><Spinner /> Chargement du tableau de bord…</div>

  return (
    <div className="mx-auto max-w-[1800px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl text-night-900">Tableau de bord</h1>
          <p className="text-sm text-mist-500">{data?.root_person ? <>Arbre de <Link className="text-gold-600 hover:underline" to={`/personnes/${data.root_person.id}`}>{data.root_person.name}</Link></> : 'Vue d’ensemble de votre recherche généalogique'}</p>
        </div>
        <nav className="hidden flex-wrap gap-2 sm:flex">
          <Link to="/arbre?new=1" className="btn-primary"><UserPlus size={15} /> Ajouter une personne</Link>
          <Link to="/archives?tab=import" className="btn-ghost"><Upload size={15} /> Importer un GEDCOM</Link>
          <Link to="/assistant" className="btn-ghost"><MessageSquare size={15} /> Poser une question à l'assistant</Link>
          <Link to="/histoire" className="btn-ghost"><BookOpen size={15} /> Histoire familiale</Link>
        </nav>
      </header>

      {error && <div className="rounded-xl border border-conf-red/30 bg-conf-red/8 px-4 py-3 text-sm text-conf-red">{error}</div>}

      {data && !showHero && <GuidedHome data={data} />}

      {showHero && (
        <section className="panel fade-up relative overflow-hidden bg-night-900 p-8 text-ivory-50">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-gold-500/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-sage-500/20 blur-3xl" />
          <div className="relative max-w-3xl">
            <div className="mb-2 inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-gold-400"><Sparkles size={13} /> Bienvenue</div>
            <h2 className="font-display text-4xl leading-tight">Votre généalogiste numérique est prêt à commencer l'enquête.</h2>
            <p className="mt-3 text-ivory-200/80">Indiquez la personne de départ et ce que vous savez déjà : GENEALIS AI interrogera ensuite les archives accessibles, documentera chaque fait avec ses sources et vous posera des questions lorsqu'un doute subsiste. Rien n'est inventé : chaque information reste reliée à un document.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/bienvenue" className="btn-gold"><Compass size={15} /> Assistant de configuration</Link>
              <Link to="/archives?tab=import" className="btn bg-ivory-50/10 text-ivory-50 hover:bg-ivory-50/20"><Upload size={15} /> Importer un fichier GEDCOM</Link>
            </div>
          </div>
        </section>
      )}

      {data && (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
          <StatTile icon={Users} label="Personnes" value={data.persons} sub={`${data.generations} génération${data.generations > 1 ? 's' : ''} documentée${data.generations > 1 ? 's' : ''}`} to="/arbre" />
          <StatTile icon={Clock3} label="Ancêtre le plus ancien" accent="gold"
            value={data.oldest_ancestor ? data.oldest_ancestor.year : '—'}
            sub={data.oldest_ancestor ? <><span className="text-night-900">{data.oldest_ancestor.name}</span> · gén. {data.oldest_ancestor.generation}</> : 'Aucune date de naissance connue'}
            to={data.oldest_ancestor ? `/personnes/${data.oldest_ancestor.id}` : undefined} />
          <StatTile icon={Layers} label="Filiations vérifiées" accent="sage" value={`${data.relations_verified} / ${data.relations_total}`} sub={<ConfidenceBar counts={data.relations_by_confidence} total={data.relations_total} />} />
          <StatTile icon={Lightbulb} label="Hypothèses ouvertes" value={data.hypotheses_open} sub="à confirmer ou écarter" to="/enquetes" />
          <StatTile icon={FileText} label="Documents analysés" value={`${data.documents_analyzed} / ${data.documents_total}`} sub={`${data.sources} source${data.sources > 1 ? 's' : ''} référencée${data.sources > 1 ? 's' : ''}`} to="/archives" />
          <StatTile icon={Globe2} label="Pays explorés" value={data.countries.length} sub={data.countries.length ? data.countries.join(', ') : 'Aucun lieu renseigné'} to="/carte" />
          <StatTile icon={Archive} label="Archives consultées" value={data.archives_consulted.length} sub={data.archives_consulted.length ? data.archives_consulted.slice(0, 3).join(', ') + (data.archives_consulted.length > 3 ? '…' : '') : 'Aucune archive consultée'} to="/archives" />
          <StatTile icon={Play} label="Enquêtes" accent="sage" value={data.tasks_running} sub={`${data.tasks_queued} en file · ${data.tasks_waiting} en attente d'accord`} to="/enquetes" />
          <StatTile icon={HelpCircle} label="Questions en attente" accent={data.questions_pending ? 'gold' : 'night'} value={data.questions_pending} sub="votre avis est demandé" to="/questions" />
          <StatTile icon={AlertTriangle} label="Contradictions ouvertes" accent={data.contradictions_open ? 'red' : 'night'} value={data.contradictions_open} sub="incohérences entre sources" to="/enquetes?tab=contradictions" />
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-5">
        <Panel className="xl:col-span-3" title={<span className="inline-flex items-center gap-2 uppercase tracking-wider text-base">Recherches en direct</span>} actions={<Link to="/enquetes" className="text-xs text-gold-600 hover:underline">Tout le journal</Link>}>
          <LiveFeed limit={50} />
        </Panel>
        <Panel className="xl:col-span-2" title="Priorités de recherche" actions={<span className="text-xs text-mist-500">Branches les plus prometteuses</span>}>
          {priorities === null ? <div className="flex items-center gap-2 text-sm text-mist-500"><Spinner /> Calcul des priorités…</div>
            : prioError ? <p className="text-sm text-conf-red">{prioError}</p>
            : priorities.length === 0 ? <Empty>Aucune lacune détectée : toutes les personnes ont naissance, mariage, décès et parents documentés.</Empty>
            : (
              <ul className="max-h-[480px] space-y-2 overflow-auto scrollbar-thin pr-1">
                {priorities.map((p) => (
                  <li key={p.person_id} className="rounded-xl border border-ivory-300/70 bg-white/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link to={`/personnes/${p.person_id}`} className="font-medium text-night-900 hover:text-gold-600">{p.name}</Link>
                        <span className="ml-2 text-xs text-mist-500">{p.birth_year ? `né(e) ${p.birth_year}` : 'naissance inconnue'}{p.country ? ` · ${p.country}` : ''}</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.missing.map((m) => <span key={m} className="chip bg-ivory-200 text-night-900">{MISSING_LABEL[m] ?? m}</span>)}
                        </div>
                        <div className="mt-1 text-[11px] text-mist-500">
                          ≈ {p.estimated_minutes} min · disponibilité {Math.round(p.availability * 100)} %
                          {p.already_tried.length > 0 && <span> · déjà tenté : {p.already_tried.join(', ')}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="font-display text-xl text-gold-600" title="Score de priorité">{p.score}</span>
                        <button className="btn-sage !px-2.5 !py-1 text-xs" disabled={launching === p.person_id} onClick={() => launch(p)}>{launching === p.person_id ? <Spinner /> : <Play size={12} />} Lancer</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </Panel>
      </div>
    </div>
  )
}
