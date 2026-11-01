import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BookOpen, Camera, ChevronDown, ChevronUp, Crown, FileDown, FileUp, FileSearch, GitFork, Lightbulb, Radar, Search, ShieldCheck, Sparkles, Trash2, UserPlus, Users } from 'lucide-react'
import { api, openExternal, type Advice, type PersonDetail } from '../api'
import { useApp, pulseEngine } from '../store'
import { ConfidenceChip, Spinner } from '../components/ui'
import { AdviceBody } from '../components/person/AdviceBody'
import { AI, Avatar, Portal, ageText, errMsg } from '../components/person/helpers'
import { AddRelativeMenu, AddRelativeSheet, Sheet } from '../components/relatives/AddRelative'
import {
  ContradictionsSection, EventsSection, FamilySection, HistorySection, HypothesesSection, IdentitySection, MediaSection, NarrativeSection,
  PlacesSection, QuestionsSection, SourcesSection, type AddRequest, type RelChoice,
} from '../components/person/sections'

export default function PersonPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { notify, refreshDashboard } = useApp()
  const [p, setP] = useState<PersonDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [why, setWhy] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [relChoice, setRelChoice] = useState<RelChoice | null>(null)
  const [advice, setAdvice] = useState<{ loading: boolean; data: Advice | null; error: string | null } | null>(null)

  const reload = useCallback(async () => {
    try { setP(await api.person(id)); setError(null) } catch (e) { setError(errMsg(e, 'Personne introuvable')) }
  }, [id])
  useEffect(() => { setP(null); setError(null); setLastAction(null); reload() }, [reload])
  useEffect(() => { const h = () => { reload() }; window.addEventListener('genealis:event', h); return () => window.removeEventListener('genealis:event', h) }, [reload])

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    try { const msg = await fn(); notify('success', msg); setLastAction(msg); pulseEngine(); refreshDashboard(); await reload() } catch (e) { notify('error', errMsg(e)) } finally { setBusy(null) }
  }
  const explore = () => run('explore', async () => { const t = await api.explore(id, 1); return t.length ? `${t.length} recherche(s) lancée(s) sur ${p?.display_name ?? 'cette personne'}.` : 'Les recherches possibles sont déjà en cours ou terminées pour cette personne.' })
  const findParents = () => run('parents', async () => { const t = await api.createTask({ task_type: 'find_parents', person_id: id }); return `Recherche « ${t.title} » lancée.` })
  const analyzeDocs = () => run('docs', async () => {
    const todo = (p?.media ?? []).filter((m) => m.analysis_status !== 'done' && m.kind !== 'portrait')
    if (todo.length === 0) { if ((p?.media ?? []).length === 0) throw new Error('Aucun document à analyser : ajoutez d’abord un acte ou une photo dans « Médias ».'); return 'Tous les documents sont déjà analysés.' }
    for (const m of todo) await api.analyzeMedia(m.id)
    return `${todo.length} analyse(s) lancée(s).`
  })
  const openAdvice = async () => {
    setAdvice({ loading: true, data: null, error: null })
    try { setAdvice({ loading: false, data: await api.advice(id), error: null }) } catch (e) { setAdvice({ loading: false, data: null, error: errMsg(e) }) }
  }
  const setPortrait = async (files: FileList | null) => {
    if (!files?.[0]) return
    try { await api.uploadMedia(files[0], { person_id: id, kind: 'portrait', analyze: false }); notify('success', 'Portrait défini.'); await reload() } catch (e) { notify('error', errMsg(e)) }
  }
  const deletePerson = async () => {
    if (!p) return
    if (!window.confirm(`Supprimer définitivement ${p.display_name} ainsi que ses événements et liens ? Cette action est irréversible.`)) return
    try { await api.deletePerson(id); notify('success', 'Personne supprimée.'); refreshDashboard(); nav('/') } catch (e) { notify('error', errMsg(e)) }
  }
  const onAdd = (r: AddRequest) => { if (r === 'menu') setMenu(true); else setRelChoice(r) }
  const scrollTo = (anchor: string) => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  if (error) return <div className="mx-auto max-w-2xl rounded-3xl bg-ivory-50 p-6 text-center shadow-sm ring-1 ring-black/5"><p className="text-night-900">{error}</p><Link className="mt-3 inline-block font-medium text-ios-blue" to="/">Retour au centre de recherche</Link></div>
  if (!p) return <div className="flex items-center justify-center gap-2 p-10 text-mist-500"><Spinner /> Chargement de la fiche…</div>

  const criteria = p.confidence_details.criteria ?? []
  const f = p.sex === 'F' ? 'e' : p.sex === 'M' ? '' : '(e)'
  const age = ageText(p)
  const anchor = { id: p.id, display_name: p.display_name, sex: p.sex, surname: p.surname }
  const hasFather = p.parents.some((x) => x.sex === 'M')
  const hasMother = p.parents.some((x) => x.sex === 'F')
  const onlyPartner = p.spouses.length === 1 ? p.spouses[0] : undefined
  const quick: { label: string; req: AddRequest; show: boolean }[] = [
    { label: 'Père', req: { kind: 'father', label: 'Ajouter le père', group: 'parents' }, show: !hasFather },
    { label: 'Mère', req: { kind: 'mother', label: 'Ajouter la mère', group: 'parents' }, show: !hasMother },
    { label: 'Frère', req: { kind: 'brother', label: 'Ajouter un frère', group: 'fratrie' }, show: true },
    { label: 'Sœur', req: { kind: 'sister', label: 'Ajouter une sœur', group: 'fratrie' }, show: true },
    { label: 'Enfant', req: p.spouses.length > 1 ? 'menu' : { kind: 'child', label: 'Ajouter un enfant', group: 'enfants', otherParent: onlyPartner }, show: true },
    { label: 'Conjoint', req: { kind: p.sex === 'F' ? 'husband' : p.sex === 'M' ? 'wife' : 'spouse', label: 'Ajouter un conjoint', group: 'couple' }, show: true },
    { label: 'Grands-parents', req: 'menu', show: true },
  ]
  const aiActions = [
    { key: 'explore', label: 'Rechercher davantage', icon: <Search size={18} />, fn: explore },
    { key: 'parents', label: 'Retrouver ses parents', icon: <Users size={18} />, fn: findParents },
    { key: 'docs', label: 'Analyser ses documents', icon: <FileSearch size={18} />, fn: analyzeDocs },
    { key: 'advice', label: 'Pistes de l’IA', icon: <Lightbulb size={18} />, fn: openAdvice },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-24">
      {/* En-tête */}
      <header className="fade-up overflow-hidden rounded-3xl bg-ivory-50 shadow-[0_1px_2px_rgba(20,40,80,0.06),0_10px_30px_-18px_rgba(20,40,80,0.35)] ring-1 ring-black/5">
        <div className="flex items-start gap-4 p-4 sm:p-5">
          <label className="group relative shrink-0 cursor-pointer" title="Changer le portrait">
            {p.portrait_media_id ? <Avatar p={p} size={88} /> : (
              <span className={`flex h-[88px] w-[88px] items-center justify-center rounded-full ${p.sex === 'F' ? 'bg-[#fde3ee] text-[#b0336b]' : p.sex === 'M' ? 'bg-[#dfeafc] text-ios-blue' : 'bg-mist-200 text-mist-500'}`}>
                <svg viewBox="0 0 24 24" width="52" height="52" fill="currentColor" aria-hidden><circle cx="12" cy="8" r="4.2" /><path d="M3.5 21c0-4.4 3.8-7.4 8.5-7.4s8.5 3 8.5 7.4z" /></svg>
              </span>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-ivory-50 text-mist-500 shadow ring-1 ring-black/10"><Camera size={14} /></span>
            <input type="file" hidden accept="image/*" onChange={(e) => { setPortrait(e.target.files); e.target.value = '' }} />
          </label>
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-bold leading-tight text-night-900 sm:text-2xl">{p.display_name}</h1>
            {p.married_name && <div className="text-sm text-mist-500">{p.sex === 'F' ? 'épouse' : 'nom d’usage'} {p.married_name}</div>}
            <div className="mt-1 space-y-0.5 text-[14px] text-night-900">
              <div><span className="mr-1 text-mist-400">☆</span>{p.birth_display ?? <span className="text-mist-400">naissance inconnue</span>}{p.birth_place && <span className="text-mist-500"> · {p.birth_place}</span>}</div>
              {(p.death_display || p.death_place || p.is_living === false) && <div><span className="mr-1 text-mist-400">†</span>{p.death_display ?? <span className="text-mist-400">décès : date inconnue</span>}{p.death_place && <span className="text-mist-500"> · {p.death_place}</span>}</div>}
            </div>
            {age && <div className="mt-1.5 inline-flex items-center rounded-full bg-[#dfeafc] px-2.5 py-0.5 text-[13px] font-medium text-[#1f4f9c]">Âge : {age}</div>}
            {p.occupation && <div className="mt-1 text-sm text-mist-500">{p.occupation}</div>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-black/5 px-4 py-2.5 sm:px-5">
          <ConfidenceChip level={p.confidence} />
          {(p.sosa?.length ?? 0) > 0 && <span className="chip border border-brass-300/70 bg-brass-200/50 font-semibold tabular-nums text-brass-600" title={`Numéro Sosa dans l’ascendance de la personne de départ — génération ${Math.floor(Math.log2(p.sosa![0])) + 1}`}>Sosa n° {p.sosa!.join(' · ')}</span>}
          {p.is_root && <span className="chip bg-[#fff4d6] text-[#8a6a10]"><Crown size={12} />Personne de départ</span>}
          {p.is_living && <span className="chip bg-[#e3f4e6] text-[#2f6b3b]"><ShieldCheck size={12} />Vivant{f} · protégé{f}</span>}
          <button className="inline-flex items-center gap-1 text-xs text-mist-500 underline" onClick={() => setWhy((v) => !v)}>Pourquoi ce niveau ? {why ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
        </div>
        <div className="flex flex-wrap gap-2 px-4 pb-3 sm:px-5">
          <Link to={`/livre/personne/${p.id}`} className="btn-ghost !px-3 !py-1.5 !text-[13px]"><BookOpen size={14} />Lire son chapitre</Link>
          <Link to={`/documents/importer?personne=${p.id}`} className="btn-ghost !px-3 !py-1.5 !text-[13px]"><FileUp size={14} />Importer un acte</Link>
          <Link to={`/investigation?person=${p.id}`} className="btn-gold !px-3 !py-1.5 !text-[13px]"><Radar size={14} />Lancer une enquête autonome</Link>
        </div>
        {why && <div className="mx-4 mb-3 rounded-2xl bg-mist-100 p-3 text-xs text-night-900 sm:mx-5">{criteria.length === 0 ? 'Aucun critère détaillé disponible.' : <ul className="list-disc pl-4">{criteria.map((c, i) => <li key={i}>{c}</li>)}</ul>}</div>}

        {/* Ajouter des proches */}
        <div className="border-t border-black/5 px-4 py-3 sm:px-5">
          <button onClick={() => setMenu(true)} className="btn-primary w-full justify-center !py-2.5 text-[15px]"><UserPlus size={17} />Ajouter des proches</button>
          <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
            {quick.filter((q) => q.show).map((q) => (
              <button key={q.label} onClick={() => onAdd(q.req)} className="shrink-0 rounded-full bg-ios-blue/10 px-3 py-1.5 text-[13px] font-medium text-ios-blue hover:bg-ios-blue/20">+ {q.label}</button>
            ))}
          </div>
        </div>
      </header>

      {/* Recherche IA */}
      <section className="fade-up rounded-3xl p-4 shadow-sm ring-1 ring-[#5b3fd6]/15" style={{ background: `linear-gradient(135deg, ${AI.soft}, #f6f3ff)` }}>
        <div className="mb-2.5 flex items-center gap-2 text-[15px] font-semibold" style={{ color: AI.dark }}><Sparkles size={17} />Recherche IA</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {aiActions.map((a) => (
            <button key={a.key} disabled={busy !== null} onClick={a.fn} className="flex min-h-[64px] flex-col items-start justify-between gap-1 rounded-2xl bg-ivory-50 p-3 text-left text-[14px] font-medium shadow-sm ring-1 ring-[#5b3fd6]/10 hover:ring-[#5b3fd6]/40 disabled:opacity-60" style={{ color: AI.dark }}>
              <span style={{ color: AI.color }}>{busy === a.key ? <Spinner /> : a.icon}</span>{a.label}
            </button>
          ))}
        </div>
        {lastAction && <p className="mt-2.5 text-xs" style={{ color: AI.dark }}>{lastAction} <Link className="underline" to="/">Suivre dans le centre de recherche</Link></p>}
      </section>

      <EventsSection p={p} reload={reload} />
      <IdentitySection p={p} reload={reload} />
      <MediaSection p={p} reload={reload} />
      <FamilySection p={p} reload={reload} onAdd={onAdd} />
      <HypothesesSection p={p} reload={reload} />
      <QuestionsSection p={p} />
      <ContradictionsSection p={p} reload={reload} />
      <SourcesSection p={p} reload={reload} />
      <NarrativeSection p={p} />
      <PlacesSection p={p} />
      <HistorySection p={p} />

      <div className="grid grid-cols-2 gap-2">
        <button className="btn-ghost justify-center bg-ivory-50" onClick={() => openExternal(api.personPdfUrl(id))}><FileDown size={15} />Fiche PDF</button>
        <Link className="btn-ghost justify-center bg-ivory-50" to={`/arbre-interactif?personne=${id}`}><GitFork size={15} />Voir dans l’arbre</Link>
      </div>

      <section className="rounded-3xl bg-ivory-50 p-4 ring-1 ring-conf-red/20">
        <h2 className="text-[15px] font-semibold text-conf-red">Zone de danger</h2>
        <p className="mt-1 text-xs text-mist-500">Efface la personne, ses événements et ses liens de parenté. Les sources et documents partagés sont conservés.</p>
        <button className="btn-danger mt-3" onClick={deletePerson}><Trash2 size={15} />Supprimer cette personne</button>
      </section>

      {/* Pastilles flottantes (comme MobileFamilyTree) */}
      <div className="pointer-events-none fixed right-0 z-30 flex justify-center px-3" style={{ left: 'var(--rail-w)', bottom: 'calc(var(--dock-h) + 16px)' }}>
        <div className="pointer-events-auto flex gap-1 rounded-full bg-ivory-50/85 p-1 shadow-[0_8px_30px_-8px_rgba(20,40,80,0.45)] ring-1 ring-black/5 backdrop-blur-xl">
          {[{ n: p.parents.length, l: 'Parents' }, { n: p.spouses.length, l: p.spouses.length > 1 ? 'Partenaires' : 'Partenaire' }, { n: p.children.length, l: 'Enfants' }].map((x) => (
            <button key={x.l} onClick={() => scrollTo('famille')} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-medium text-ios-blue hover:bg-ios-blue/10">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ios-blue px-1 text-[12px] font-semibold text-white">{x.n}</span>{x.l}
            </button>
          ))}
        </div>
      </div>

      {menu && <Portal><AddRelativeMenu anchor={anchor} onClose={() => setMenu(false)} onAdded={() => { reload() }} /></Portal>}
      {relChoice && <Portal><AddRelativeSheet anchor={anchor} choice={relChoice} onClose={() => setRelChoice(null)} onAdded={() => { reload() }} /></Portal>}
      {advice && (<Portal>
        <Sheet title="Pistes de l’IA" subtitle={p.display_name} onClose={() => setAdvice(null)}>
          {advice.loading && <div className="flex items-center gap-2 py-6 text-sm text-mist-500"><Spinner /> L’IA prépare un plan de recherche…</div>}
          {advice.error && <p className="text-sm text-conf-red">{advice.error}</p>}
          {advice.data && <AdviceBody a={advice.data} />}
        </Sheet></Portal>
      )}
    </div>
  )
}
