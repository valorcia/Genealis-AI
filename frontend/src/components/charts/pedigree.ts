import type { PersonSummary, TreeNode } from '../../api'
import type { Connector, PlacedCard } from './CardTree'
import { elbowPath, layoutDesc, layoutSosa } from './family'
import { cardSize, type CardOptions } from './PersonCard'

export type AddParent = (child: PersonSummary, kind: 'father' | 'mother') => void

/** Ascendance horizontale (personne à gauche, parents vers la droite ; dir = -1 pour l'inverse). */
export function horizontalPedigree(bySosa: Map<number, TreeNode>, gens: number, opts: CardOptions, { dir = 1, originX = 0, slots = true, onAdd, keyPrefix = '', skipRoot = false }: { dir?: 1 | -1; originX?: number; slots?: boolean; onAdd?: AddParent; keyPrefix?: string; skipRoot?: boolean } = {}) {
  const { w, h } = cardSize('card', opts)
  const COL = w + 64
  const slotsList = layoutSosa(bySosa, gens, h, 14, slots, 4)
  const pos = new Map<number, { x: number; y: number }>()
  const cards: PlacedCard[] = []
  for (const s of slotsList) {
    const x = dir === 1 ? originX + s.gen * COL : originX - s.gen * COL
    const y = s.center - h / 2
    pos.set(s.sosa, { x, y })
    if (skipRoot && s.sosa === 1) continue
    const child = bySosa.get(s.sosa >> 1)
    cards.push({
      key: `${keyPrefix}${s.sosa}`, x, y, person: s.person, root: s.sosa === 1, sosa: s.sosa,
      emptyLabel: s.sosa % 2 === 0 ? 'Père inconnu' : 'Mère inconnue',
      onAdd: !s.person && child && onAdd ? () => onAdd(child, s.sosa % 2 === 0 ? 'father' : 'mother') : undefined,
    })
  }
  const connectors: Connector[] = []
  for (const s of slotsList) {
    if (!s.person) continue
    const c = pos.get(s.sosa) as { x: number; y: number }
    for (const ps of [2 * s.sosa, 2 * s.sosa + 1]) {
      const p = pos.get(ps); if (!p) continue
      const x1 = dir === 1 ? c.x + w : c.x, x2 = dir === 1 ? p.x : p.x + w
      connectors.push({ d: elbowPath(x1, c.y + h / 2, x2, p.y + h / 2, 8, false, x1 + dir * 32), dashed: !bySosa.has(ps) })
    }
  }
  return { cards, connectors }
}

/** Ascendance verticale vers le haut (sablier) : la personne de départ en (0, 0). */
export function verticalAncestors(bySosa: Map<number, TreeNode>, gens: number, opts: CardOptions, { slots = true, onAdd, rowGap = 58 }: { slots?: boolean; onAdd?: AddParent; rowGap?: number } = {}) {
  const { w, h } = cardSize('card', opts)
  const list = layoutSosa(bySosa, gens, w, 18, slots, 6)
  const pos = new Map<number, { x: number; y: number }>()
  const cards: PlacedCard[] = []
  for (const s of list) {
    const x = s.center - w / 2, y = -s.gen * (h + rowGap)
    pos.set(s.sosa, { x, y })
    const child = bySosa.get(s.sosa >> 1)
    cards.push({ key: `a${s.sosa}`, x, y, person: s.person, root: s.sosa === 1, sosa: s.sosa, emptyLabel: s.sosa % 2 === 0 ? 'Père inconnu' : 'Mère inconnue', onAdd: !s.person && child && onAdd ? () => onAdd(child, s.sosa % 2 === 0 ? 'father' : 'mother') : undefined })
  }
  const connectors: Connector[] = []
  for (const s of list) {
    if (!s.person) continue
    const c = pos.get(s.sosa) as { x: number; y: number }
    for (const ps of [2 * s.sosa, 2 * s.sosa + 1]) {
      const p = pos.get(ps); if (!p) continue
      connectors.push({ d: elbowPath(p.x + w / 2, p.y + h, c.x + w / 2, c.y, 8, true, c.y - rowGap / 2), dashed: !bySosa.has(ps) })
    }
  }
  return { cards, connectors }
}

/** Descendance verticale vers le bas (sablier), sans répéter la personne de départ. */
export function verticalDescendants(rootId: string, kidsOf: (id: string) => string[], persons: Map<string, PersonSummary>, depth: number, opts: CardOptions, rowGap = 58) {
  const { w, h } = cardSize('card', opts)
  const list = layoutDesc(rootId, kidsOf, () => w, 18, depth)
  const pos = new Map(list.map((d) => [d.id, { x: d.center - w / 2, y: d.depth * (h + rowGap) }]))
  const cards: PlacedCard[] = list.filter((d) => d.depth > 0).map((d) => ({ key: `d${d.id}`, x: d.center - w / 2, y: d.depth * (h + rowGap), person: persons.get(d.id) ?? null }))
  const connectors: Connector[] = []
  for (const d of list) {
    if (!d.parent) continue
    const p = pos.get(d.parent), c = pos.get(d.id)
    if (p && c) connectors.push({ d: elbowPath(p.x + w / 2, p.y + h, c.x + w / 2, c.y, 8, true, c.y - rowGap / 2) })
  }
  return { cards, connectors }
}
