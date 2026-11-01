import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, Crown, FileDown, FileSearch, Search, ShieldCheck, Trash2, Users } from 'lucide-react'
import { api, openExternal, type PersonDetail } from '../api'
import { useApp } from '../store'
import { ConfidenceChip, Empty, Panel, Spinner } from '../components/ui'
import { Tabs, errMsg, initials } from '../components/person/helpers'
import { ContradictionsSection, EventsSection, FamilySection, HypothesesSection, IdentitySection, MediaSection, NarrativeSection, PlacesSection, QuestionsSection, SourcesSection } from '../components/person/sections'

export default function PersonPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const { notify } = useApp()
  const [p, setP] = useState<PersonDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [why, setWhy] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<string | null>(null)
  const tab = params.get('onglet') ?? 'identite'
  const setTab = (t: string) => setParams((prev) => { const n = new URLSearchParams(prev); n.set('onglet', t); return n }, { replace: true })

  const reload = useCallback(async () => {
    try { setP(await api.person(id)); setError(null) } catch (e) { setError(errMsg(e, 'Personne introuvable')) }
  }, [id])
  useEffect(() => { setP(null); setError(null); setLastAction(null); reload() }, [reload])

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    try { const msg = await fn(); notify('success', msg); setLastAction(msg); await reload() } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) }
  }
  const explore = () => run('explore', async () => { const t = await api.explore(id, 1); return `${t.length} enquête(s) planifiée(s) pour ${p?.display_name ?? 'cette personne'}.` })
  const findParents = () => run('parents', async () => { const t = await api.createTask({ task_type: 'find_parents', person_id: id }); return `Enquête « ${t.title} » créée.` })
  const analyzeDocs = () => run('docs', async () => {
    const todo = (p?.media ?? []).filter((m) => m.analysis_status !== 'done' && m.kind !== 'portrait')
    if (todo.length === 0) { if ((p?.media ?? []).length === 0) throw new Error('Aucun document à analyser : importez un acte ou une photo dans l’onglet « Documents ».'); return 'Tous les documents sont déjà analysés.' }
    for (const m of todo) await api.analyzeMedia(m.id)
    return `${todo.length} analyse(s) lancée(s).`
  })
  const deletePerson = async () => {
    if (!p) return
    if (!window.confirm(`Supprimer définitivement ${p.display_name} ainsi que ses événements et liens ? Cette action est irréversible.`)) return
    try { await api.deletePerson(id); notify('success', 'Personne supprimée.'); nav('/arbre') } catch (e) { notify('error', errMsg(e)) }
  }

  if (error) return <Panel title="Fiche personnelle"><Empty>{error} <Link className="underline" to="/arbre">Retour à l’arbre</Link></Empty></Panel>
  if (!p) return <div className="flex items-center gap-2 p-6 text-mist-500"><Spinner /> Chargement de la fiche…</div>

  const criteria = p.confidence_details.criteria ?? []
  const tabs = [
    { id: 'identite', label: 'Identité' }, { id: 'biographie', label: 'Biographie' }, { id: 'chronologie', label: 'Chronologie', count: p.events.length },
    { id: 'famille', label: 'Famille', count: p.parents.length + p.children.length + p.spouses.length }, { id: 'lieux', label: 'Lieux de vie' },
    { id: 'documents', label: 'Documents', count: p.media.length }, { id: 'sources', label: 'Sources', count: p.citations.length },
    { id: 'hypotheses', label: 'Hypothèses', count: p.hypotheses.filter((h) => h.status === 'open').length },
    { id: 'contradictions', label: 'Contradictions', count: p.contradictions.filter((c) => c.status === 'open').length },
    { id: 'questions', label: 'Questions', count: p.questions.length },
  ]
  const fem = p.sex === 'F' ? 'e' : p.sex === 'M' ? '' : '(e)'
  const dates = [p.birth_display ? `né${fem} ${p.birth_display}` : null, p.death_display ? `décédé${fem} ${p.death_display}` : null].filter(Boolean).join(' · ')

  return (
    <div className="space-y-5">
      <header className="panel fade-up flex flex-col gap-5 p-6 md:flex-row md:items-start">
        <div className="shrink-0">
          {p.portrait_media_id ? (
            <img src={api.mediaFileUrl(p.portrait_media_id)} alt={p.display_name} className="h-32 w-32 rounded-full border-4 border-gold-500/40 object-cover shadow-md" />
          ) : (
            <div className="flex h-32 w-32 items-center justify-center rounded-full border-4 border-gold-500/40 bg-night-900 font-display text-4xl text-ivory-50 shadow-md">{initials(p.given_names, p.surname, p.display_name)}</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl text-night-900">{p.display_name}</h1>
            {p.is_root && <span className="chip bg-gold-500/20 text-gold-600"><Crown size={12} />Racine de l’arbre</span>}
            {p.is_living && <span className="chip bg-sage-500/20 text-sage-600"><ShieldCheck size={12} />Personne vivante · données protégées</span>}
          </div>
          {p.married_name && <div className="text-sm text-mist-500">épouse {p.married_name}</div>}
          <div className="mt-1 text-sm text-night-900">{dates || <span className="text-mist-500">Dates inconnues</span>}</div>
          <div className="text-xs text-mist-500">{[p.birth_place && `né${fem} à ${p.birth_place}`, p.death_place && `décédé${fem} à ${p.death_place}`, p.occupation].filter(Boolean).join(' · ')}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ConfidenceChip level={p.confidence} />
            <button className="inline-flex items-center gap-1 text-xs text-mist-500 underline hover:text-night-900 cursor-pointer" onClick={() => setWhy((v) => !v)}>Pourquoi ce niveau ? {why ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
          </div>
          {why && (
            <div className="mt-2 rounded-xl bg-ivory-100 p-3 text-xs text-night-900">
              {criteria.length === 0 ? 'Aucun critère détaillé disponible.' : <ul className="list-disc pl-4">{criteria.map((c, i) => <li key={i}>{c}</li>)}</ul>}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-gold" disabled={busy !== null} onClick={explore}>{busy === 'explore' ? <Spinner /> : <Search size={16} />}Rechercher davantage sur cette personne</button>
            <button className="btn-primary" disabled={busy !== null} onClick={findParents}>{busy === 'parents' ? <Spinner /> : <Users size={16} />}Retrouver ses parents</button>
            <button className="btn-sage" disabled={busy !== null} onClick={analyzeDocs}>{busy === 'docs' ? <Spinner /> : <FileSearch size={16} />}Analyser ses documents</button>
          </div>
          {lastAction && <p className="mt-2 text-xs text-sage-600">{lastAction} <Link className="underline" to="/enquetes">Suivre dans Enquêtes IA</Link></p>}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <button className="btn-ghost" onClick={() => openExternal(api.personPdfUrl(id))}><FileDown size={15} />Fiche PDF</button>
          <Link className="btn-ghost" to={`/arbre?root=${id}`}>Voir dans l’arbre</Link>
        </div>
      </header>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'identite' && <IdentitySection p={p} reload={reload} />}
      {tab === 'biographie' && <NarrativeSection p={p} />}
      {tab === 'chronologie' && <EventsSection p={p} reload={reload} />}
      {tab === 'famille' && <FamilySection p={p} reload={reload} />}
      {tab === 'lieux' && <PlacesSection p={p} />}
      {tab === 'documents' && <MediaSection p={p} reload={reload} />}
      {tab === 'sources' && <SourcesSection p={p} reload={reload} />}
      {tab === 'hypotheses' && <HypothesesSection p={p} reload={reload} />}
      {tab === 'contradictions' && <ContradictionsSection p={p} reload={reload} />}
      {tab === 'questions' && <QuestionsSection p={p} />}

      <section className="panel fade-up border-conf-red/30 p-5">
        <h2 className="font-display text-lg text-conf-red">Zone de danger</h2>
        <p className="mt-1 text-xs text-mist-500">La suppression efface la personne, ses événements et ses liens de parenté. Les sources et documents partagés sont conservés.</p>
        <button className="btn-danger mt-3" onClick={deletePerson}><Trash2 size={15} />Supprimer cette personne</button>
      </section>
    </div>
  )
}
