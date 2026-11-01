import { useMemo, useState } from 'react'
import { api, type Kinship, type PersonDetail, type PersonSummary, type TreeGraph, type TreeNode } from '../../api'
import { ErrorState, LoadingState, eventLabel, pool, shortPlace, useLoader } from '../views/common'
import { generationName } from '../views/people'
import { Facts, Muted, PersonRef, RC, RSection, RTable, ReportDoc, StatTile, lifeLine } from './ReportKit'
import type { ReportProps } from './PersonReports'
import { computeSosa } from '../views/sosa'

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV']
const roman = (n: number) => ROMAN[n] ?? String(n)
const minOf = (l: number[] | undefined) => Math.min(...(l?.length ? l : [Infinity]))

/** Libellé d'un ascendant direct : génération, sexe, côté (paternel/maternel) et nature du lien. */
function ancestorLabel(n: TreeNode, paternal: boolean | null, rel: string | null) {
  const f = n.sex === 'F'
  const side = paternal === null || n.generation < 2 ? '' : paternal ? (f ? ' paternelle' : ' paternel') : (f ? ' maternelle' : ' maternel')
  if (n.generation === 1) {
    if (rel === 'step') return f ? 'Belle-mère (conjointe du parent)' : 'Beau-père (conjoint du parent)'
    if (rel === 'adoptive') return f ? 'Mère adoptive' : 'Père adoptif'
    if (rel === 'foster') return f ? 'Mère nourricière' : 'Père nourricier'
    return f ? 'Mère' : n.sex === 'M' ? 'Père' : 'Parent'
  }
  if (n.generation === 2) return (f ? 'Grand-mère' : 'Grand-père') + side
  if (n.generation === 3) return (f ? 'Arrière-grand-mère' : 'Arrière-grand-père') + side
  if (n.generation === 4) return (f ? 'Trisaïeule' : 'Trisaïeul') + side
  return `Ancêtre à la ${n.generation}e génération${paternal === null ? '' : paternal ? ' (côté paternel)' : ' (côté maternel)'}`
}
/** Pour chaque ascendant : le parent (génération 1) par lequel il est relié, et le type de lien de ce parent. */
function lineageOf(g: TreeGraph) {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]))
  const childOf = new Map<string, string[]>()
  g.edges.forEach((e) => { if (!childOf.has(e.source)) childOf.set(e.source, []); childOf.get(e.source)!.push(e.target) })
  const relToRoot = new Map(g.edges.filter((e) => nodes.get(e.target)?.generation === 0).map((e) => [e.source, e.relation_type]))
  const out = new Map<string, { parent: TreeNode | null; rel: string | null }>()
  for (const n of g.nodes) {
    let cur: TreeNode | undefined = n
    let guard = 0
    while (cur && cur.generation > 1 && guard++ < 40) cur = (childOf.get(cur.id) ?? []).map((id) => nodes.get(id)).find((c) => c && c.generation === cur!.generation - 1)
    out.set(n.id, { parent: cur && cur.generation === 1 ? cur : null, rel: cur ? relToRoot.get(cur.id) ?? null : null })
  }
  return out
}
function descendantLabel(n: TreeNode) {
  const f = n.sex === 'F'
  if (n.generation === 1) return f ? 'Fille' : n.sex === 'M' ? 'Fils' : 'Enfant'
  if (n.generation === 2) return f ? 'Petite-fille' : 'Petit-fils'
  if (n.generation === 3) return f ? 'Arrière-petite-fille' : 'Arrière-petit-fils'
  return `Descendant${f ? 'e' : ''} à la ${n.generation}e génération`
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/* ------------------------------------------------------------------ */
interface Relative { p: PersonSummary; label: string; degree: number | null; group: 'asc' | 'desc' | 'conj' | 'coll'; order: number }

export function LiensDeParente({ focusId }: ReportProps) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const { data, loading, error, reload } = useLoader(async () => {
    setProgress(null)
    const [anc, desc, d] = await Promise.all([api.ancestors(focusId, 6), api.descendants(focusId, 4), api.person(focusId)])
    const out = new Map<string, Relative>()
    const sosa = computeSosa(anc), lin = lineageOf(anc)
    for (const n of anc.nodes) {
      if (n.id === focusId) continue
      const l = lin.get(n.id)
      const paternal = l?.parent ? l.parent.sex === 'M' : null
      out.set(n.id, { p: n, label: ancestorLabel(n, paternal, l?.rel ?? null), degree: n.generation, group: 'asc', order: n.generation * 1e7 + Math.min(minOf(sosa.get(n.id)), 1e7 - 1) })
    }
    for (const n of desc.nodes) if (n.id !== focusId && !out.has(n.id)) out.set(n.id, { p: n, label: descendantLabel(n), degree: n.generation, group: 'desc', order: n.generation * 1000 + (n.birth_year ?? 0) / 10000 })
    for (const s of d.spouses) if (!out.has(s.id)) out.set(s.id, { p: s, label: s.sex === 'F' ? 'Épouse / compagne' : s.sex === 'M' ? 'Époux / compagnon' : 'Conjoint', degree: null, group: 'conj', order: 0 })
    // Collatéraux : descendants des parents et grands-parents (frères, oncles, cousins, neveux).
    const roots = anc.nodes.filter((n) => n.generation === 1 || n.generation === 2)
    const graphs = await pool(roots, 4, (r) => api.descendants(r.id, r.generation === 1 ? 2 : 3))
    const coll = new Map<string, PersonSummary>()
    for (const s of d.siblings) coll.set(s.id, s)
    for (const g of graphs) for (const n of g?.nodes ?? []) if (n.id !== focusId && !out.has(n.id)) coll.set(n.id, n)
    const list = [...coll.values()].slice(0, 60)
    setProgress({ done: 0, total: list.length })
    const kin = await pool(list, 6, (p) => api.kinship(focusId, p.id), (done) => setProgress({ done, total: list.length }))
    list.forEach((p, i) => {
      const k: Kinship | null = kin[i]
      if (k && k.found) out.set(p.id, { p, label: cap(k.relation), degree: k.civil_degree ?? null, group: 'coll', order: (k.civil_degree ?? 99) * 1000 + (p.birth_year ?? 0) / 10000 })
    })
    return { rels: [...out.values()], name: d.display_name, truncated: coll.size > 60 }
  }, [focusId])

  if (loading) return <LoadingState color={RC} label={progress ? `Calcul des liens de parenté… ${progress.done}/${progress.total}` : 'Recherche des proches…'} />
  if (error || !data) return <ErrorState message={error ?? 'Erreur.'} onRetry={reload} />
  const groups: { id: Relative['group']; title: string }[] = [
    { id: 'asc', title: 'Ascendants directs' }, { id: 'conj', title: 'Conjoints' }, { id: 'desc', title: 'Descendants' }, { id: 'coll', title: 'Collatéraux (frères, oncles, cousins, neveux…)' },
  ]
  return (
    <ReportDoc title="Liens de parenté" subject={data.name} intro="Toutes les personnes de l’arbre apparentées à la personne centrale, avec leur lien et le degré de parenté en droit civil.">
      {groups.map((g) => {
        const rows = data.rels.filter((r) => r.group === g.id).sort((a, b) => a.order - b.order)
        if (!rows.length) return null
        return (
          <RSection key={g.id} title={g.title} count={rows.length}>
            <RTable head={['Personne', 'Lien', 'Degré']} rows={rows.map((r) => [
              <PersonRef key="p" p={r.p} dot />, <span key="l" className="font-medium">{r.label}</span>, r.degree !== null ? `${r.degree}${r.degree === 1 ? 'er' : 'e'}` : <Muted key="m">—</Muted>,
            ])} />
          </RSection>
        )
      })}
      {data.rels.length === 0 && <p className="italic text-mist-500">Aucun proche enregistré pour cette personne.</p>}
      {data.truncated && <p className="mt-3 text-xs text-mist-500">Seuls les 60 collatéraux les plus proches sont calculés.</p>}
    </ReportDoc>
  )
}

/* ------------------------------------------------------------------ */
export function Ascendance({ focusId, gens }: ReportProps) {
  const { data, loading, error, reload } = useLoader<TreeGraph>(() => api.ancestors(focusId, gens), [focusId, gens])
  if (loading) return <LoadingState color={RC} />
  if (error || !data) return <ErrorState message={error ?? 'Erreur.'} onRetry={reload} />
  const root = data.nodes.find((n) => n.generation === 0)
  const sosa = computeSosa(data)
  const byGen = new Map<number, TreeNode[]>()
  data.nodes.forEach((n) => { if (!byGen.has(n.generation)) byGen.set(n.generation, []); byGen.get(n.generation)!.push(n) })
  return (
    <ReportDoc title="Ascendance" subject={root?.display_name} intro="Numérotation Sosa-Stradonitz : le père d’une personne n porte le numéro 2n, sa mère 2n + 1. Les numéros multiples signalent un implexe (ancêtre présent plusieurs fois).">
      {[...byGen.entries()].sort((a, b) => a[0] - b[0]).map(([g, list]) => {
        const theo = 2 ** g
        const sorted = list.slice().sort((a, b) => minOf(sosa.get(a.id)) - minOf(sosa.get(b.id)))
        return (
          <RSection key={g} title={<>Génération {roman(g + 1)} · {generationName(g)}</>} count={undefined}>
            <p className="-mt-1 mb-2 text-xs text-mist-500">{list.filter((n) => sosa.has(n.id)).length} sur {theo} ancêtre{theo > 1 ? 's' : ''} possible{theo > 1 ? 's' : ''} ({Math.round((list.filter((n) => sosa.has(n.id)).length / theo) * 100)} %){list.some((n) => !sosa.has(n.id)) && ' · « — » : lien non biologique (beau-parent…)'}</p>
            <ul className="space-y-2.5">
              {sorted.map((n) => (
                <li key={n.id} className="avoid-break flex gap-3">
                  <span className="mt-0.5 min-w-[40px] shrink-0 self-start rounded-lg px-1.5 py-0.5 text-center text-xs font-bold tabular-nums text-white" style={{ background: RC }}>{(sosa.get(n.id) ?? []).join(', ') || '—'}</span>
                  <div className="min-w-0">
                    <PersonRef p={n} years={false} dot />
                    <div className="text-[13px] text-night-900/80">{lifeLine(n) || <Muted>Dates inconnues</Muted>}</div>
                    {(n.occupation || n.age_display) && <div className="text-xs text-mist-500">{[n.occupation, n.age_display && `${n.age_display} ${n.age_context ?? ''}`.trim()].filter(Boolean).join(' · ')}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </RSection>
        )
      })}
    </ReportDoc>
  )
}

/* ------------------------------------------------------------------ */
export function Descendance({ focusId, gens }: ReportProps) {
  const [progress, setProgress] = useState(0)
  const { data, loading, error, reload } = useLoader(async () => {
    const g = await api.descendants(focusId, gens)
    const details = await pool(g.nodes.slice(0, 80), 6, (n) => api.person(n.id), setProgress)
    const map = new Map<string, PersonDetail>()
    details.forEach((d) => { if (d) map.set(d.id, d) })
    return { g, details: map }
  }, [focusId, gens])

  const rows = useMemo(() => {
    if (!data) return []
    const { g } = data
    const nodes = new Map(g.nodes.map((n) => [n.id, n]))
    const kids = new Map<string, string[]>()
    g.edges.forEach((e) => { if (!kids.has(e.source)) kids.set(e.source, []); if (!kids.get(e.source)!.includes(e.target)) kids.get(e.source)!.push(e.target) })
    const out: { n: TreeNode; num: string; depth: number }[] = []
    const seen = new Set<string>()
    const walk = (id: string, num: string, depth: number) => {
      const n = nodes.get(id)
      if (!n || seen.has(id)) return
      seen.add(id); out.push({ n, num, depth })
      const ch = (kids.get(id) ?? []).filter((k) => nodes.has(k)).sort((a, b) => (nodes.get(a)!.birth_year ?? 9999) - (nodes.get(b)!.birth_year ?? 9999))
      ch.forEach((c, i) => walk(c, `${num}.${i + 1}`, depth + 1))
    }
    const root = g.nodes.find((n) => n.generation === 0) ?? g.nodes[0]
    if (root) walk(root.id, '1', 0)
    return out
  }, [data])

  if (loading) return <LoadingState color={RC} label={progress ? `Chargement des fiches… ${progress}` : 'Chargement…'} />
  if (error || !data) return <ErrorState message={error ?? 'Erreur.'} onRetry={reload} />
  const unionOf = (d: PersonDetail | undefined) => (d?.spouses ?? []).map((s) => {
    const f = d!.families.find((x) => x.partner1_id === s.id || x.partner2_id === s.id)
    const m = f?.events.find((e) => /marriage|pacs/.test(e.event_type))
    return { s, m }
  })
  return (
    <ReportDoc title="Descendance" subject={rows[0]?.n.display_name} intro="Numérotation d’Aboville : chaque enfant reçoit le numéro de son parent suivi de son rang de naissance (1, 1.1, 1.2, 1.1.1…).">
      {rows.length <= 1 && <p className="italic text-mist-500">Aucun descendant enregistré.</p>}
      <ul className="space-y-2">
        {rows.map(({ n, num, depth }) => (
          <li key={n.id} className="avoid-break" style={{ paddingLeft: Math.min(depth, 6) * 14 }}>
            <div className="flex gap-2">
              <span className="shrink-0 font-mono text-[12px] font-bold" style={{ color: RC }}>{num}</span>
              <div className="min-w-0 border-l pl-2" style={{ borderColor: `${RC}33` }}>
                <PersonRef p={n} years={false} dot />
                <div className="text-[13px] text-night-900/80">{lifeLine(n) || <Muted>Dates inconnues</Muted>}</div>
                {n.occupation && <div className="text-xs text-mist-500">{n.occupation}</div>}
                {unionOf(data.details.get(n.id)).map(({ s, m }) => (
                  <div key={s.id} className="text-xs text-mist-500">∞ <PersonRef p={s} />{m && ` — ${eventLabel(m.event_type).toLowerCase()} ${m.date_display}${m.place_name ? ` à ${shortPlace(m.place_name)}` : ''}`}</div>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </ReportDoc>
  )
}

/* ------------------------------------------------------------------ */
export function SyntheseFamiliale({ focusId }: ReportProps) {
  const { data, loading, error, reload } = useLoader(async () => {
    const d = await api.person(focusId)
    const partnerIds = d.families.map((f) => (f.partner1_id === d.id ? f.partner2_id : f.partner1_id)).filter((x): x is string => !!x)
    const partners = await pool(partnerIds, 4, (id) => api.person(id))
    return { d, partners: new Map(partners.filter((p): p is PersonDetail => !!p).map((p) => [p.id, p])) }
  }, [focusId])
  if (loading) return <LoadingState color={RC} />
  if (error || !data) return <ErrorState message={error ?? 'Erreur.'} onRetry={reload} />
  const { d, partners } = data
  const inFamily = new Set(d.families.flatMap((f) => f.children_ids))
  const others = d.children.filter((c) => !inFamily.has(c.id))
  const card = (p: PersonDetail | null, fallback?: string) => (
    <div className="avoid-break rounded-2xl bg-[#fbf6f1] p-3">
      {p ? <>
        <PersonRef p={p} years={false} dot />
        <div className="mt-1 text-[13px]">
          <Facts rows={[
            ['Naissance', (p.birth_display || p.birth_place) && `${p.birth_display ?? ''}${p.birth_place ? ` à ${p.birth_place}` : ''}`],
            ['Décès', (p.death_display || p.death_place) && `${p.death_display ?? ''}${p.death_place ? ` à ${p.death_place}` : ''}`],
            ['Profession', p.occupation],
            ['Parents', p.parents.length > 0 && <span key="p">{p.parents.map((x, i) => <span key={x.id}>{i > 0 && ' et '}<PersonRef p={x} years={false} /></span>)}</span>],
          ]} />
        </div>
      </> : <Muted>{fallback ?? 'Conjoint inconnu'}</Muted>}
    </div>
  )
  const childRows = (list: PersonSummary[]) => list.slice().sort((a, b) => (a.birth_year ?? 9999) - (b.birth_year ?? 9999)).map((c, i) => [
    <span key="n"><span className="mr-1.5 tabular-nums text-mist-500">{i + 1}.</span><PersonRef p={c} years={false} dot /></span>,
    c.birth_display ? `${c.birth_display}${c.birth_place ? ` · ${shortPlace(c.birth_place)}` : ''}` : <Muted key="b">—</Muted>,
    c.death_display ? `${c.death_display}${c.death_place ? ` · ${shortPlace(c.death_place)}` : ''}` : <Muted key="d">—</Muted>,
  ])
  return (
    <ReportDoc title="Synthèse familiale" subject={d.display_name}>
      {d.families.length === 0 && others.length === 0 && <p className="italic text-mist-500">Aucune union ni enfant enregistré pour cette personne. Choisissez une autre personne avec le bouton 👤.</p>}
      {d.families.map((f, i) => {
        const pid = f.partner1_id === d.id ? f.partner2_id : f.partner1_id
        const kids = d.children.filter((c) => f.children_ids.includes(c.id))
        return (
          <RSection key={f.id} title={d.families.length > 1 ? `Union ${i + 1}` : 'Le couple'}>
            <div className="grid gap-3 sm:grid-cols-2">{card(d)}{card(pid ? partners.get(pid) ?? null : null)}</div>
            <div className="mt-3 text-sm">
              {f.events.length ? f.events.map((e) => (
                <p key={e.id}><b style={{ color: RC }}>{eventLabel(e.event_type)}</b> : {e.date_display || 'date inconnue'}{e.place_name ? ` à ${e.place_name}` : ''}{e.description ? ` — ${e.description}` : ''}</p>
              )) : <p className="text-mist-500">Aucun événement d’union enregistré{f.union_type && f.union_type !== 'marriage' ? ` (${f.union_type})` : ''}.</p>}
            </div>
            <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-mist-500">Enfants ({kids.length})</h3>
            <RTable head={['Enfant', 'Naissance', 'Décès']} rows={childRows(kids)} empty="Aucun enfant enregistré pour cette union." />
          </RSection>
        )
      })}
      {others.length > 0 && <RSection title="Autres enfants" count={others.length}><RTable head={['Enfant', 'Naissance', 'Décès']} rows={childRows(others)} /></RSection>}
    </ReportDoc>
  )
}

/* ------------------------------------------------------------------ */
export function SyntheseGenerationnelle({ focusId, gens }: ReportProps) {
  const { data, loading, error, reload } = useLoader<TreeGraph>(() => api.ancestors(focusId, gens), [focusId, gens])
  if (loading) return <LoadingState color={RC} />
  if (error || !data) return <ErrorState message={error ?? 'Erreur.'} onRetry={reload} />
  const byGen = new Map<number, TreeNode[]>()
  data.nodes.forEach((n) => { if (!byGen.has(n.generation)) byGen.set(n.generation, []); byGen.get(n.generation)!.push(n) })
  const gensSorted = [...byGen.keys()].sort((a, b) => a - b)
  const rows = gensSorted.map((g) => {
    const list = byGen.get(g)!
    const births = list.map((n) => n.birth_year).filter((y): y is number => !!y)
    const spans = list.filter((n) => n.birth_year && n.death_year).map((n) => (n.death_year as number) - (n.birth_year as number))
    const places = new Map<string, number>()
    list.forEach((n) => { const p = shortPlace(n.birth_place); if (p) places.set(p, (places.get(p) ?? 0) + 1) })
    const surnames = new Set(list.map((n) => n.surname?.toUpperCase()).filter(Boolean))
    return { g, list, theo: 2 ** g, births, avg: spans.length ? Math.round(spans.reduce((s, x) => s + x, 0) / spans.length) : null, nAvg: spans.length,
      places: [...places.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3), surnames: surnames.size, m: list.filter((n) => n.sex === 'M').length, f: list.filter((n) => n.sex === 'F').length }
  })
  const totalFound = data.nodes.length - 1
  const totalTheo = gensSorted.filter((g) => g > 0).reduce((s, g) => s + 2 ** g, 0)
  const oldest = data.nodes.filter((n) => n.birth_year).sort((a, b) => (a.birth_year as number) - (b.birth_year as number))[0]
  return (
    <ReportDoc title="Synthèse générationnelle" subject={data.nodes.find((n) => n.generation === 0)?.display_name}>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Ancêtres trouvés" value={totalFound} sub={`sur ${totalTheo} possibles`} />
        <StatTile label="Complétude" value={`${totalTheo ? Math.round((totalFound / totalTheo) * 100) : 0} %`} />
        <StatTile label="Générations" value={gensSorted.length} />
        <StatTile label="Plus ancien" value={oldest?.birth_year ?? '—'} sub={oldest?.display_name} />
      </div>
      <RSection title="Par génération">
        <RTable head={['Génération', 'Trouvés', 'Naissances', 'Vie moyenne', 'Lieux principaux']} rows={rows.map((r) => [
          <div key="g"><b>{roman(r.g + 1)}</b> <span className="text-xs text-mist-500">{generationName(r.g)}</span></div>,
          <div key="c" className="min-w-[90px]">
            <span className="font-semibold tabular-nums">{r.list.length}</span><Muted> / {r.theo}</Muted>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06]"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (r.list.length / r.theo) * 100)}%`, background: RC }} /></div>
            <div className="text-[11px] text-mist-500">{r.m} h · {r.f} f · {r.surnames} nom{r.surnames > 1 ? 's' : ''}</div>
          </div>,
          r.births.length ? <span key="b" className="whitespace-nowrap tabular-nums">{Math.min(...r.births)}{Math.max(...r.births) !== Math.min(...r.births) ? ` – ${Math.max(...r.births)}` : ''}</span> : <Muted key="b">—</Muted>,
          r.avg !== null ? <span key="a">{r.avg} ans <Muted>({r.nAvg})</Muted></span> : <Muted key="a">—</Muted>,
          r.places.length ? r.places.map(([p, n]) => `${p} (${n})`).join(', ') : <Muted key="p">—</Muted>,
        ])} />
        <p className="mt-2 text-xs text-mist-500">La vie moyenne n’est calculée que sur les personnes dont les années de naissance et de décès sont connues (effectif entre parenthèses).</p>
      </RSection>
    </ReportDoc>
  )
}
