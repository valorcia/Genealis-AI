import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type PersonDetail, type PersonSummary, type TreeGraph, type TreeNode } from '../../api'

/**
 * Index familial local construit à partir des graphes d'ascendance / descendance et des fiches détaillées :
 * parents, enfants et conjoints de chaque personne chargée. Rien n'est déduit au-delà des liens enregistrés.
 */
export interface FamilyIndex {
  persons: Map<string, PersonSummary>
  parents: Map<string, string[]>
  children: Map<string, string[]>
  partners: Map<string, string[]>
}

export function emptyIndex(): FamilyIndex { return { persons: new Map(), parents: new Map(), children: new Map(), partners: new Map() } }

const push = (m: Map<string, string[]>, k: string, v: string) => { const a = m.get(k); if (!a) m.set(k, [v]); else if (!a.includes(v)) a.push(v) }

export function linkParent(ix: FamilyIndex, parent: string, child: string) { push(ix.parents, child, parent); push(ix.children, parent, child) }
export function linkCouple(ix: FamilyIndex, a: string, b: string) { if (a === b) return; push(ix.partners, a, b); push(ix.partners, b, a) }

export function addGraph(ix: FamilyIndex, g: TreeGraph | null) {
  if (!g) return
  for (const n of g.nodes) if (!ix.persons.has(n.id)) ix.persons.set(n.id, n)
  for (const e of g.edges) linkParent(ix, e.source, e.target)
}

export function addDetail(ix: FamilyIndex, d: PersonDetail) {
  if (!ix.persons.has(d.id)) ix.persons.set(d.id, d)
  for (const p of d.parents) { if (!ix.persons.has(p.id)) ix.persons.set(p.id, p); linkParent(ix, p.id, d.id) }
  for (const c of d.children) { if (!ix.persons.has(c.id)) ix.persons.set(c.id, c); linkParent(ix, d.id, c.id) }
  for (const s of d.spouses) { if (!ix.persons.has(s.id)) ix.persons.set(s.id, s); linkCouple(ix, d.id, s.id) }
  for (const f of d.families) {
    const other = f.partner1_id === d.id ? f.partner2_id : f.partner2_id === d.id ? f.partner1_id : null
    if (other) { linkCouple(ix, d.id, other); for (const c of f.children_ids) if (ix.persons.has(other)) linkParent(ix, other, c) }
  }
}

/** Les co-parents d'enfants communs sont des partenaires (sans inventer d'union). */
export function inferCouples(ix: FamilyIndex) {
  for (const [, ps] of ix.parents) if (ps.length >= 2) linkCouple(ix, ps[0], ps[1])
}

const byBirth = (ix: FamilyIndex) => (a: string, b: string) => (ix.persons.get(a)?.birth_year ?? 9999) - (ix.persons.get(b)?.birth_year ?? 9999)

export function childrenOf(ix: FamilyIndex, id: string) { return [...(ix.children.get(id) ?? [])].filter((c) => ix.persons.has(c)).sort(byBirth(ix)) }
export function parentsOf(ix: FamilyIndex, id: string) {
  const ps = (ix.parents.get(id) ?? []).map((p) => ix.persons.get(p)).filter((p): p is PersonSummary => !!p)
  return { father: ps.find((p) => p.sex === 'M') ?? ps.find((p) => p.sex !== 'F') ?? null, mother: ps.find((p) => p.sex === 'F') ?? null, all: ps }
}
export function partnersOf(ix: FamilyIndex, id: string) { return (ix.partners.get(id) ?? []).filter((p) => ix.persons.has(p)) }

/** Enfants de `id` regroupés par autre parent (dans l'ordre des partenaires), puis ceux dont l'autre parent est inconnu. */
export function childGroups(ix: FamilyIndex, id: string, partners: string[]) {
  const kids = childrenOf(ix, id)
  const groups: { partner: string | null; kids: string[] }[] = partners.map((p) => ({ partner: p, kids: kids.filter((k) => (ix.parents.get(k) ?? []).includes(p)) }))
  const used = new Set(groups.flatMap((g) => g.kids))
  const rest = kids.filter((k) => !used.has(k))
  if (rest.length) groups.push({ partner: null, kids: rest })
  return groups.filter((g) => g.kids.length || g.partner)
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let i = 0
  const worker = async () => { while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]) } catch { /* fiche indisponible : ignorée */ } } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export interface FamilyData { index: FamilyIndex; focus: PersonDetail | null; ancestors: TreeGraph | null; descendants: TreeGraph | null; partial: boolean }

/**
 * Charge la famille autour d'une personne : ascendance (up générations), descendance (down générations)
 * et fiches détaillées (conjoints, couples) des descendants affichés — au plus `detailLimit` fiches.
 * Un rechargement garde les données précédentes affichées (pas de clignotement, la vue est conservée).
 */
export function useFamily(focusId: string | null, up: number, down: number, { detailLimit = 160, withDetails = true }: { detailLimit?: number; withDetails?: boolean } = {}) {
  const [data, setData] = useState<FamilyData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const load = useCallback(async () => {
    if (!focusId) { setData(null); return }
    const my = ++seq.current
    setLoading(true); setError(null)
    try {
      const [anc, desc, focus] = await Promise.all([
        up > 0 ? api.ancestors(focusId, up) : Promise.resolve(null),
        down > 0 ? api.descendants(focusId, down) : Promise.resolve(null),
        api.person(focusId).catch(() => null),
      ])
      const ix = emptyIndex()
      addGraph(ix, anc); addGraph(ix, desc)
      if (focus) addDetail(ix, focus)
      let partial = false
      if (withDetails && desc) {
        const ids = desc.nodes.filter((n) => n.id !== focusId).sort((a, b) => a.generation - b.generation).map((n) => n.id)
        partial = ids.length > detailLimit
        const details = await pool(ids.slice(0, detailLimit), 6, (id) => api.person(id))
        if (my !== seq.current) return
        for (const d of details) if (d) addDetail(ix, d)
      }
      inferCouples(ix)
      if (my !== seq.current) return
      setData({ index: ix, focus, ancestors: anc, descendants: desc, partial })
    } catch (e) {
      if (my === seq.current) setError(e instanceof ApiError ? e.message : 'Impossible de charger la famille.')
    } finally { if (my === seq.current) setLoading(false) }
  }, [focusId, up, down, detailLimit, withDetails])
  useEffect(() => { load() }, [load])
  return { data, loading, error, reload: load }
}

/** Ascendance simple (un seul appel), pour les graphiques en éventail, ascendance, etc. */
export function useAncestors(focusId: string | null, generations: number) {
  const [graph, setGraph] = useState<TreeGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const load = useCallback(async () => {
    if (!focusId) { setGraph(null); return }
    const my = ++seq.current
    setLoading(true); setError(null)
    try { const g = await api.ancestors(focusId, generations); if (my === seq.current) setGraph(g) }
    catch (e) { if (my === seq.current) setError(e instanceof ApiError ? e.message : 'Impossible de charger l’ascendance.') }
    finally { if (my === seq.current) setLoading(false) }
  }, [focusId, generations])
  useEffect(() => { load() }, [load])
  return { graph, loading, error, reload: load }
}

/* ——— Numérotation Sosa et mises en page en arbre ——— */

export const sosaGen = (s: number) => Math.floor(Math.log2(s))

/** sosa → personne (une personne en implexe apparaît sous chacun de ses numéros, sans réexpansion). */
export function sosaIndex(g: TreeGraph | null) {
  const m = new Map<number, TreeNode>()
  if (!g) return m
  for (const n of g.nodes) for (const s of n.sosa ?? []) if (!m.has(s)) m.set(s, n)
  return m
}

export interface SosaSlot { sosa: number; gen: number; person: TreeNode | null; center: number }

/**
 * Mise en page compacte d'un arbre d'ascendance : chaque couple de parents est centré sur son enfant.
 * `size` = encombrement d'une case le long de l'axe d'étalement, `gap` = espace entre cases.
 * Avec `slots`, les parents inconnus d'une personne connue apparaissent comme cases vides « ? ».
 * Le centre de la personne de départ (sosa 1) est à 0.
 */
export function layoutSosa(bySosa: Map<number, TreeNode>, maxGen: number, size: number, gap: number, slots: boolean, gapGrowth = 0): SosaSlot[] {
  const included = (s: number): boolean => {
    if (s === 1) return true
    const g = sosaGen(s)
    if (g > maxGen - 1) return false
    if (bySosa.has(s)) return included(s >> 1)
    return slots && bySosa.has(s >> 1) && included(s >> 1)
  }
  const span = new Map<number, number>()
  const spanOf = (s: number): number => {
    const known = span.get(s); if (known !== undefined) return known
    if (!included(s)) { span.set(s, 0); return 0 }
    const real = bySosa.has(s)
    const f = real ? spanOf(2 * s) : 0, m = real ? spanOf(2 * s + 1) : 0
    const g = gap + gapGrowth * Math.max(0, maxGen - 2 - sosaGen(s))
    const kids = f && m ? f + g + m : f + m
    const v = Math.max(size, kids)
    span.set(s, v); return v
  }
  const out: SosaSlot[] = []
  const place = (s: number, start: number) => {
    const w = spanOf(s); if (!w) return
    const center = start + w / 2
    out.push({ sosa: s, gen: sosaGen(s), person: bySosa.get(s) ?? null, center })
    if (!bySosa.has(s)) return
    const f = spanOf(2 * s), m = spanOf(2 * s + 1)
    const g = gap + gapGrowth * Math.max(0, maxGen - 2 - sosaGen(s))
    const block = f && m ? f + g + m : f + m
    const cs = center - block / 2
    place(2 * s, cs)
    place(2 * s + 1, cs + f + (f && m ? g : 0))
  }
  place(1, 0)
  const root = out.find((o) => o.sosa === 1)?.center ?? 0
  for (const o of out) o.center -= root
  return out
}

export interface DescSlot { id: string; depth: number; center: number; parent: string | null }

/**
 * Mise en page d'un arbre de descendance : chaque bloc (personne + conjoints) est centré au-dessus de ses enfants.
 * Une personne atteinte deux fois (mariage entre cousins) n'est placée qu'une fois.
 */
export function layoutDesc(rootId: string, kidsOf: (id: string) => string[], blockOf: (id: string) => number, gap: number, maxDepth: number): DescSlot[] {
  const seen = new Set<string>()
  const tree = new Map<string, string[]>()
  const order: { id: string; depth: number; parent: string | null }[] = []
  const queue: { id: string; depth: number; parent: string | null }[] = [{ id: rootId, depth: 0, parent: null }]
  seen.add(rootId)
  while (queue.length) {
    const cur = queue.shift() as { id: string; depth: number; parent: string | null }
    order.push(cur)
    const kids: string[] = []
    if (cur.depth < maxDepth) for (const k of kidsOf(cur.id)) if (!seen.has(k)) { seen.add(k); kids.push(k); queue.push({ id: k, depth: cur.depth + 1, parent: cur.id }) }
    tree.set(cur.id, kids)
  }
  const span = new Map<string, number>()
  const spanOf = (id: string): number => {
    const known = span.get(id); if (known !== undefined) return known
    const kids = tree.get(id) ?? []
    const sum = kids.reduce((a, k) => a + spanOf(k), 0) + gap * Math.max(0, kids.length - 1)
    const v = Math.max(blockOf(id), sum)
    span.set(id, v); return v
  }
  const centers = new Map<string, number>()
  const place = (id: string, start: number) => {
    const w = spanOf(id)
    centers.set(id, start + w / 2)
    const kids = tree.get(id) ?? []
    const sum = kids.reduce((a, k) => a + spanOf(k), 0) + gap * Math.max(0, kids.length - 1)
    let x = start + (w - sum) / 2
    for (const k of kids) { place(k, x); x += spanOf(k) + gap }
  }
  place(rootId, 0)
  const root = centers.get(rootId) ?? 0
  return order.map((o) => ({ ...o, center: (centers.get(o.id) ?? 0) - root }))
}

/** Chemin orthogonal à coins arrondis (connecteurs « en coude »). */
export function elbowPath(x1: number, y1: number, x2: number, y2: number, r = 12, vertical = true) {
  if (vertical) {
    const my = (y1 + y2) / 2
    if (Math.abs(x2 - x1) < 1) return `M${x1},${y1} V${y2}`
    const rr = Math.min(r, Math.abs(x2 - x1) / 2, Math.abs(my - y1))
    const sx = Math.sign(x2 - x1), sy = Math.sign(y2 - y1)
    return `M${x1},${y1} V${my - sy * rr} Q${x1},${my} ${x1 + sx * rr},${my} H${x2 - sx * rr} Q${x2},${my} ${x2},${my + sy * rr} V${y2}`
  }
  const mx = (x1 + x2) / 2
  if (Math.abs(y2 - y1) < 1) return `M${x1},${y1} H${x2}`
  const rr = Math.min(r, Math.abs(y2 - y1) / 2, Math.abs(mx - x1))
  const sx = Math.sign(x2 - x1), sy = Math.sign(y2 - y1)
  return `M${x1},${y1} H${mx - sx * rr} Q${mx},${y1} ${mx},${y1 + sy * rr} V${y2 - sy * rr} Q${mx},${y2} ${mx + sx * rr},${y2} H${x2}`
}
