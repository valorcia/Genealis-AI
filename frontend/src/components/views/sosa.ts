import type { TreeGraph } from '../../api'

const REL_RANK: Record<string, number> = { biological: 0, adoptive: 1, legal: 1, uncertain: 2 }

/**
 * Numérotation Sosa-Stradonitz recalculée à partir des liens parent-enfant du graphe :
 * père = 2n, mère = 2n + 1. Les beaux-parents et parents nourriciers ne reçoivent pas de numéro
 * (au plus un père et une mère par personne, en privilégiant la filiation biologique).
 */
export function computeSosa(g: TreeGraph): Map<string, number[]> {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]))
  const parentsOf = new Map<string, { id: string; rel: string }[]>()
  for (const e of g.edges) {
    if (!parentsOf.has(e.target)) parentsOf.set(e.target, [])
    parentsOf.get(e.target)!.push({ id: e.source, rel: e.relation_type })
  }
  const rootId = g.root_id || g.nodes.find((n) => n.generation === 0)?.id
  const out = new Map<string, number[]>()
  if (!rootId) return out
  const queue: [string, number][] = [[rootId, 1]]
  while (queue.length) {
    const [id, s] = queue.shift()!
    if (out.has(id)) { out.get(id)!.push(s); continue }
    out.set(id, [s])
    if (s > 2 ** 24) continue
    const cands = (parentsOf.get(id) ?? []).filter((p) => p.rel in REL_RANK && nodes.has(p.id)).sort((a, b) => REL_RANK[a.rel] - REL_RANK[b.rel])
    let father: string | null = null, mother: string | null = null
    for (const c of cands) {
      const sex = nodes.get(c.id)?.sex
      if (sex === 'M' && !father) father = c.id
      else if (sex === 'F' && !mother) mother = c.id
    }
    for (const c of cands) {
      if (c.id === father || c.id === mother || nodes.get(c.id)?.sex) continue
      if (!father) father = c.id
      else if (!mother) mother = c.id
    }
    if (father) queue.push([father, s * 2])
    if (mother) queue.push([mother, s * 2 + 1])
  }
  return out
}
