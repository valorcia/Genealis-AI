import { memo, useMemo, useRef } from 'react'
import type { PersonSummary } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import { FigureSvg } from '../../components/charts/Avatar'
import PanZoomCanvas from '../../components/charts/PanZoomCanvas'
import { usePanZoom } from '../../components/charts/usePanZoom'
import { ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, SegmentedRow, SliderRow, ToggleRow, usePref } from '../../components/charts/ChartTools'
import { childrenOf, layoutDesc, sosaGen, sosaIndex, useFamily } from '../../components/charts/family'
import { fitText, fullName, GRAPH_COLOR, nameParts, sexKey } from '../../components/charts/format'
import { polar } from '../../components/charts/svg'
import { Spinner } from '../../components/ui'

const RING = 132
const NODE_R = 19
interface N { key: string; p: PersonSummary; r: number; a: number; depth: number }
interface E { from: N; to: N }

const RING_COLORS = ['#13918c', '#2f6fd1', '#8a35b8', '#c4651a', '#2e9a52', '#b23a7a', '#5f6478']

const Node = memo(function Node({ n, labels, onPick }: { n: N; labels: boolean; onPick: (p: PersonSummary) => void }) {
  const { x, y } = polar(n.r, n.a)
  const a = ((n.a % 360) + 360) % 360
  const flip = a > 90 && a < 270
  const { given, surname } = nameParts(n.p)
  const k = sexKey(n.p)
  const ring = k === 'M' ? '#5b8ef0' : k === 'F' ? '#f08a64' : '#9aa1ad'
  return (
    <g className="cursor-pointer" onClick={() => onPick(n.p)}>
      <title>{`${fullName(n.p)}${n.p.birth_year || n.p.death_year ? ` (${n.p.birth_year ?? '?'}–${n.p.death_year ?? ''})` : ''}`}</title>
      <circle cx={x} cy={y} r={n.depth === 0 ? NODE_R + 10 : NODE_R} fill="#ffffff" stroke={ring} strokeWidth={n.depth === 0 ? 3.5 : 2.4} />
      <FigureSvg sex={k} size={(n.depth === 0 ? NODE_R + 10 : NODE_R) * 1.5} x={x - (n.depth === 0 ? NODE_R + 10 : NODE_R) * 0.75} y={y - (n.depth === 0 ? NODE_R + 10 : NODE_R) * 0.8} />
      {labels && n.depth > 0 && (
        <g transform={`translate(${x},${y}) rotate(${flip ? a + 180 : a})`}>
          <text x={flip ? -(NODE_R + 6) : NODE_R + 6} y={-2} textAnchor={flip ? 'end' : 'start'} fontSize={11.5} fontWeight={600} fill="#111827">{fitText(given || surname, RING - 40, 11.5)}</text>
          <text x={flip ? -(NODE_R + 6) : NODE_R + 6} y={11} textAnchor={flip ? 'end' : 'start'} fontSize={10} fill="#4b5563">{fitText(`${given ? surname : ''}${n.p.birth_year ? ` ${n.p.birth_year}` : ''}`.trim(), RING - 40, 10)}</text>
        </g>
      )}
      {n.depth === 0 && <text x={x} y={y + NODE_R + 28} textAnchor="middle" fontSize={14} fontWeight={700} fill="#111827">{fullName(n.p)}</text>}
    </g>
  )
})

export default function CircularTreePage() {
  const { persons, focus, focusId, setFocusId, loading: pl } = useFocusPerson()
  const [opts, setOpts] = usePref('circulaire', { mode: 'desc' as 'desc' | 'asc', gens: 4, labels: true })
  const { data, loading, error } = useFamily(focusId, opts.mode === 'asc' ? opts.gens : 0, opts.mode === 'desc' ? opts.gens : 0, { withDetails: false })
  const svgRef = useRef<SVGSVGElement>(null)

  const { nodes, edges, R } = useMemo(() => {
    const nodes: N[] = [], edges: E[] = []
    if (!data || !focusId) return { nodes, edges, R: RING }
    const root = data.index.persons.get(focusId)
    if (!root) return { nodes, edges, R: RING }
    if (opts.mode === 'desc') {
      const list = layoutDesc(focusId, (id) => childrenOf(data.index, id), () => 1, 0, opts.gens)
      const leaves = list.filter((d) => d.depth > 0)
      const min = Math.min(0, ...leaves.map((d) => d.center - 0.5)), max = Math.max(0, ...leaves.map((d) => d.center + 0.5))
      const span = Math.max(1, max - min)
      const sweep = Math.min(360, span * 62)
      const byId = new Map<string, N>()
      for (const d of list) {
        const p = data.index.persons.get(d.id); if (!p) continue
        const n: N = { key: d.id, p, r: d.depth * RING, a: d.depth === 0 ? -90 : -90 + ((d.center - (min + max) / 2) / span) * sweep, depth: d.depth }
        byId.set(d.id, n); nodes.push(n)
        if (d.parent && byId.get(d.parent)) edges.push({ from: byId.get(d.parent) as N, to: n })
      }
    } else {
      const bySosa = sosaIndex(data.ancestors)
      const byS = new Map<number, N>()
      for (const [s, p] of bySosa) {
        const g = sosaGen(s)
        if (g > opts.gens) continue
        const n2 = 2 ** g
        const a = g === 0 ? -90 : 180 + ((s - n2 + 0.5) / n2) * 360
        const n: N = { key: `s${s}`, p, r: g * RING, a, depth: g }
        byS.set(s, n); nodes.push(n)
        const child = byS.get(s >> 1)
        if (g > 0 && child) edges.push({ from: child, to: n })
      }
    }
    const R = Math.max(RING, ...nodes.map((n) => n.r)) + (opts.labels ? 150 : 50)
    return { nodes, edges, R }
  }, [data, focusId, opts.mode, opts.gens, opts.labels])
  const pz = usePanZoom({ maxScale: 4 })
  const name = focus ? fullName(focus) : ''
  const size = 2 * R
  const maxDepth = Math.max(0, ...nodes.map((n) => n.depth))

  const linkPath = (e: E) => {
    const a = polar(e.from.r, e.from.a), b = polar(e.to.r, e.to.a)
    if (e.from.r === 0) return `M${a.x},${a.y} L${b.x},${b.y}`
    const mr = (e.from.r + e.to.r) / 2
    const c1 = polar(mr, e.from.a), c2 = polar(mr, e.to.a)
    return `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`
  }

  return (
    <ChartFrame title={`Arbre circulaire${name ? ` - ${name}` : ''}`} color={GRAPH_COLOR} persons={persons} focusId={focusId} onFocus={setFocusId}
      help={<HelpText title="Arbre circulaire"><p>La personne centrale est au milieu ; chaque cercle concentrique correspond à une génération de {opts.mode === 'desc' ? 'descendants' : 'ancêtres'}. Changez de mode dans les options.</p><p>Touchez une personne pour la placer au centre.</p></HelpText>}
      actions={<ChartActions exportTarget={() => svgRef.current} filename={`Arbre circulaire ${name}`} />}
      options={<>
        <OptionGroup title="Mode">
          <SegmentedRow value={opts.mode} onChange={(v) => setOpts({ mode: v })} options={[{ value: 'desc', label: 'Descendants' }, { value: 'asc', label: 'Ancêtres' }]} />
          <SliderRow label="Générations" value={opts.gens} min={1} max={7} onChange={(v) => setOpts({ gens: v })} />
        </OptionGroup>
        <OptionGroup title="Contenu"><ToggleRow label="Noms" checked={opts.labels} onChange={(v) => setOpts({ labels: v })} /></OptionGroup>
      </>}>
      <PrintStyle />
      {!pl && persons.length === 0 ? <ChartMessage>Aucune personne dans l’arbre pour l’instant.</ChartMessage> : (
        <PanZoomCanvas pz={pz} width={size} height={size} fitKey={data ? `${focusId}:${opts.mode}:${opts.gens}:${nodes.length}` : undefined} background="plain" maxFit={1.4}
          overlay={<>
            {(loading || pl) && <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs text-mist-500 shadow" data-nopan><Spinner /> Chargement…</div>}
            {error && <div className="absolute inset-x-3 top-3 z-10 rounded-2xl bg-white px-4 py-2 text-sm text-conf-red shadow" data-nopan>{error}</div>}
            {data && nodes.length === 1 && <div className="absolute inset-x-3 bottom-24 z-10 mx-auto max-w-md rounded-2xl bg-white/95 px-4 py-3 text-center text-sm text-mist-500 shadow ring-1 ring-black/5" data-nopan>Aucun {opts.mode === 'desc' ? 'descendant' : 'ancêtre'} connu pour cette personne.</div>}
          </>}>
          <svg ref={svgRef} width={size} height={size} viewBox={`${-R} ${-R} ${size} ${size}`} fontFamily="Inter, 'Segoe UI', system-ui, sans-serif">
            {Array.from({ length: maxDepth }, (_, i) => i + 1).map((d) => (
              <g key={d}>
                <circle r={d * RING} fill="none" stroke={RING_COLORS[(d - 1) % RING_COLORS.length]} strokeOpacity={0.22} strokeWidth={d * RING > 0 ? 18 : 0} />
                <circle r={d * RING} fill="none" stroke={RING_COLORS[(d - 1) % RING_COLORS.length]} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 5" />
                <text y={d * RING + 4} textAnchor="middle" fontSize={10} fontWeight={600} fill={RING_COLORS[(d - 1) % RING_COLORS.length]} opacity={0.8} paintOrder="stroke" stroke="#fff" strokeWidth={3}>{opts.mode === 'desc' ? `Génération -${d}` : `Génération +${d}`}</text>
              </g>
            ))}
            {edges.map((e, i) => <path key={i} d={linkPath(e)} fill="none" stroke="#4b2bb8" strokeOpacity={0.55} strokeWidth={1.8} />)}
            {nodes.map((n) => <Node key={n.key} n={n} labels={opts.labels} onPick={(p) => setFocusId(p.id)} />)}
          </svg>
        </PanZoomCanvas>
      )}
    </ChartFrame>
  )
}
