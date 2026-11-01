import { memo, useMemo, type ReactNode } from 'react'
import type { PersonSummary } from '../../api'
import PanZoomCanvas from './PanZoomCanvas'
import type { PanZoom } from './usePanZoom'
import { cardSize, EmptyCard, PersonCard, type CardOptions } from './PersonCard'

export interface PlacedCard {
  key: string; x: number; y: number; person: PersonSummary | null
  root?: boolean; selected?: boolean; sosa?: number | null; emptyLabel?: string; onAdd?: () => void; variant?: 'card' | 'compact'
}
export interface Connector { d: string; dashed?: boolean; color?: string; width?: number }
export interface Decoration { key: string; x: number; y: number; node: ReactNode }

const MARGIN = 40

/**
 * Rendu commun des graphiques à cartes (ascendance, sablier, double ascendance, parenté…) :
 * cartes HTML positionnées en absolu + calque SVG pour les connecteurs, dans une zone déplaçable/zoomable.
 * Les coordonnées peuvent être négatives : la boîte englobante est recalculée.
 */
export function useCardBounds(cards: PlacedCard[], opts: CardOptions, extraPoints: { x: number; y: number }[] = []) {
  return useMemo(() => {
    if (!cards.length) return { dx: 0, dy: 0, w: 0, h: 0 }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const c of cards) {
      const { w, h } = cardSize(c.variant ?? 'card', opts)
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + w); y1 = Math.max(y1, c.y + h)
    }
    for (const p of extraPoints) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
    return { dx: MARGIN - x0, dy: MARGIN - y0, w: x1 - x0 + 2 * MARGIN, h: y1 - y0 + 2 * MARGIN }
  }, [cards, opts, extraPoints])
}

const CardLayer = memo(function CardLayer({ cards, opts, dx, dy, onPick }: { cards: PlacedCard[]; opts: CardOptions; dx: number; dy: number; onPick?: (p: PersonSummary) => void }) {
  return (
    <>
      {cards.map((c) => {
        const v = c.variant ?? 'card'
        const { w, h } = cardSize(v, opts)
        return (
          <div key={c.key} className="absolute" style={{ left: c.x + dx, top: c.y + dy }}>
            {c.person
              ? <PersonCard person={c.person} variant={v} opts={opts} root={c.root} selected={c.selected} sosa={c.sosa} onClick={onPick} />
              : <EmptyCard label={c.emptyLabel ?? 'Inconnu'} w={w} h={h} onAdd={c.onAdd} compact={v === 'compact'} />}
          </div>
        )
      })}
    </>
  )
})

export default function CardTree({ pz, cards, connectors, opts, onPick, fitKey, decorations = [], overlay, background = 'plain' }: {
  pz: PanZoom; cards: PlacedCard[]; connectors: Connector[]; opts: CardOptions; onPick?: (p: PersonSummary) => void
  fitKey?: string; decorations?: Decoration[]; overlay?: ReactNode; background?: 'grid' | 'plain'
}) {
  const pts = useMemo(() => decorations.map((d) => ({ x: d.x, y: d.y })), [decorations])
  const { dx, dy, w, h } = useCardBounds(cards, opts, pts)
  return (
    <PanZoomCanvas pz={pz} width={w} height={h} fitKey={cards.length ? fitKey : undefined} background={background} overlay={overlay} maxFit={1}>
      <svg className="pointer-events-none absolute left-0 top-0" width={w} height={h}>
        <g transform={`translate(${dx},${dy})`}>
          {connectors.map((c, i) => <path key={i} d={c.d} fill="none" stroke={c.color ?? '#5b6170'} strokeWidth={c.width ?? 1.4} strokeDasharray={c.dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
        </g>
      </svg>
      {decorations.map((d) => <div key={d.key} className="absolute" style={{ left: d.x + dx, top: d.y + dy }}>{d.node}</div>)}
      <CardLayer cards={cards} opts={opts} dx={dx} dy={dy} onPick={onPick} />
    </PanZoomCanvas>
  )
}
