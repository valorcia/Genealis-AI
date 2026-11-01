import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { api, type PersonDetail, type PersonSummary } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import PanZoomCanvas from '../../components/charts/PanZoomCanvas'
import { usePanZoom } from '../../components/charts/usePanZoom'
import { usePersonDetail } from '../../components/charts/usePersonDetail'
import { ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, ToggleRow, usePref } from '../../components/charts/ChartTools'
import { fitText, fullName, GRAPH_COLOR, nameParts } from '../../components/charts/format'
import { rankedParents } from '../../components/charts/family'
import { Spinner } from '../../components/ui'

const S = 46 // taille d'un symbole
const ROW = 150
const STEP = 112
interface Sym { key: string; p: PersonSummary; x: number; y: number; index?: boolean }
interface Line { d: string; double?: boolean; dashed?: boolean }

const isMarriage = (union?: string) => !!union && /mar/i.test(union)

const Symbol = memo(function Symbol({ s, opts, onPick }: { s: Sym; opts: { ages: boolean; names: boolean }; onPick: (p: PersonSummary) => void }) {
  const p = s.p
  const dead = p.is_living === false || !!p.death_year || !!p.death_display
  const half = S / 2
  const fill = p.sex === 'M' ? '#e6efff' : p.sex === 'F' ? '#fde7ef' : '#eef0f4'
  const stroke = '#1f2937'
  const shape = p.sex === 'M'
    ? <rect x={-half} y={-half} width={S} height={S} rx={3} fill={fill} stroke={stroke} strokeWidth={2} />
    : p.sex === 'F'
      ? <circle r={half} fill={fill} stroke={stroke} strokeWidth={2} />
      : <path d={`M0,${-half - 4} L${half + 4},0 L0,${half + 4} L${-half - 4},0 Z`} fill={fill} stroke={stroke} strokeWidth={2} />
  const outer = s.index ? (p.sex === 'F' ? <circle r={half + 6} fill="none" stroke={stroke} strokeWidth={1.6} /> : p.sex === 'M' ? <rect x={-half - 6} y={-half - 6} width={S + 12} height={S + 12} rx={5} fill="none" stroke={stroke} strokeWidth={1.6} /> : <path d={`M0,${-half - 11} L${half + 11},0 L0,${half + 11} L${-half - 11},0 Z`} fill="none" stroke={stroke} strokeWidth={1.6} />) : null
  const { given, surname } = nameParts(p)
  return (
    <g transform={`translate(${s.x},${s.y})`} className="cursor-pointer" onClick={() => onPick(p)}>
      <title>{`${fullName(p)}${p.birth_year ? ` · né(e) en ${p.birth_year}` : ''}${p.death_year ? ` · † ${p.death_year}` : ''}`}</title>
      {outer}{shape}
      {dead && <path d={`M${-half + 6},${-half + 6} L${half - 6},${half - 6} M${half - 6},${-half + 6} L${-half + 6},${half - 6}`} stroke="#6b7280" strokeWidth={1.6} opacity={0.75} />}
      {opts.ages && <text y={5} textAnchor="middle" fontSize={15} fontWeight={700} fill="#111827" paintOrder="stroke" stroke={fill} strokeWidth={4}>{p.age_years != null ? (p.age_display?.startsWith('≈') ? `≈${p.age_years}` : p.age_years) : '?'}</text>}
      {opts.names && (
        <g fontSize={11} textAnchor="middle" fill="#111827">
          <text y={half + 17} fontWeight={600}>{fitText(given || surname, STEP - 6, 11)}</text>
          {given && <text y={half + 30}>{fitText(surname, STEP - 6, 11)}</text>}
          <text y={half + (given ? 43 : 30)} fill="#6b7280" fontSize={10}>{p.birth_year || p.death_year ? `${p.birth_year ?? '?'}–${p.death_year ?? ''}` : ''}</text>
        </g>
      )}
    </g>
  )
})

export default function GenogramPage() {
  const { persons, focus, focusId, setFocusId, loading: pl } = useFocusPerson()
  const [opts, setOpts] = usePref('genogramme', { grandparents: true, ages: true, names: true, siblings: true })
  const { detail, loading, error } = usePersonDetail(focusId)
  const [parentDetails, setParentDetails] = useState<PersonDetail[]>([])
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    setParentDetails([])
    if (!detail || !opts.grandparents) return
    let alive = true
    Promise.all(rankedParents(detail).main.map((p) => api.person(p.id).catch(() => null))).then((ds) => { if (alive) setParentDetails(ds.filter((d): d is PersonDetail => !!d)) })
    return () => { alive = false }
  }, [detail, opts.grandparents])

  const { syms, lines, vb } = useMemo(() => {
    const syms: Sym[] = [], lines: Line[] = []
    if (!detail) return { syms, lines, vb: { x: 0, y: 0, w: 0, h: 0 } }
    const byBirth = (a: PersonSummary, b: PersonSummary) => (a.birth_year ?? 9999) - (b.birth_year ?? 9999)
    const gp = opts.grandparents && parentDetails.length ? 1 : 0
    const yOf = (row: number) => (row + gp) * ROW
    // Ligne de la personne : fratrie (à gauche), personne, conjoints (à droite).
    const sibs = opts.siblings ? [...detail.siblings].sort(byBirth) : []
    const line = [...sibs, detail as PersonSummary]
    const fy = yOf(1)
    line.forEach((p, i) => syms.push({ key: `s${p.id}`, p, x: (i - sibs.length) * STEP, y: fy, index: p.id === detail.id }))
    detail.spouses.forEach((p, i) => syms.push({ key: `c${p.id}`, p, x: (i + 1) * STEP * 1.2, y: fy }))
    const familyOf = (spouseId: string) => detail.families.find((f) => f.partner1_id === spouseId || f.partner2_id === spouseId)
    detail.spouses.forEach((p, i) => {
      const x2 = (i + 1) * STEP * 1.2, yy = fy + i * 7
      lines.push({ d: `M${S / 2},${yy} H${x2 - S / 2}`, double: isMarriage(familyOf(p.id)?.union_type) })
    })
    // Parents et lien de fratrie.
    const parents = rankedParents(detail).main
    const lx = Math.min(...line.map((_, i) => (i - sibs.length) * STEP)), rx = 0
    const mid = (lx + rx) / 2
    const py = yOf(0)
    const half = Math.max(STEP * 0.9, (rx - lx) / 2 + 10)
    const px = parents.length === 2 ? [mid - half, mid + half] : [mid]
    parents.forEach((p, i) => syms.push({ key: `p${p.id}`, p, x: px[i], y: py }))
    const sibY = fy - S / 2 - 34
    if (parents.length) {
      if (parents.length === 2) {
        const fam = parentDetails.find((d) => d.id === parents[0].id)?.families.find((f) => f.partner1_id === parents[1].id || f.partner2_id === parents[1].id)
        lines.push({ d: `M${px[0] + S / 2},${py} H${px[1] - S / 2}`, double: isMarriage(fam?.union_type) })
      }
      lines.push({ d: `M${mid},${parents.length === 2 ? py : py + S / 2} V${sibY}` })
    }
    if (line.length > 1 || parents.length) {
      lines.push({ d: `M${lx},${sibY} H${rx}` })
      line.forEach((_, i) => lines.push({ d: `M${(i - sibs.length) * STEP},${sibY} V${fy - S / 2 - (line[i].id === detail.id ? 7 : 0)}` }))
    }
    // Grands-parents au-dessus de chaque parent.
    if (gp) {
      parents.forEach((par, i) => {
        const d = parentDetails.find((x) => x.id === par.id)
        if (!d || !d.parents.length) return
        const gps = rankedParents(d).main
        const cx = px[i]
        const gx = gps.length === 2 ? [cx - STEP * 0.55, cx + STEP * 0.55] : [cx]
        gps.forEach((g, k) => syms.push({ key: `g${g.id}-${i}`, p: g, x: gx[k], y: 0 }))
        if (gps.length === 2) lines.push({ d: `M${gx[0] + S / 2},0 H${gx[1] - S / 2}`, double: true })
        lines.push({ d: `M${cx},${gps.length === 2 ? 0 : S / 2} V${py - S / 2}` })
      })
    }
    // Enfants sous le couple (ou sous la personne seule).
    const kids = [...detail.children].sort(byBirth)
    if (kids.length) {
      const ky = yOf(2)
      const groups = detail.spouses.map((sp, i) => ({ x: ((i + 1) * STEP * 1.2) / 2, y: fy + i * 7, ids: familyOf(sp.id)?.children_ids ?? [] }))
      const placed = new Set<string>()
      let cursor = 0
      const order: { p: PersonSummary; gx: number; gy: number }[] = []
      for (const g of groups) for (const k of kids) if (g.ids.includes(k.id) && !placed.has(k.id)) { placed.add(k.id); order.push({ p: k, gx: g.x, gy: g.y }) }
      for (const k of kids) if (!placed.has(k.id)) order.push({ p: k, gx: 0, gy: fy + S / 2 })
      const total = (order.length - 1) * STEP
      const start = (groups[0]?.x ?? 0) - total / 2
      order.forEach((o, i) => { cursor = start + i * STEP; syms.push({ key: `k${o.p.id}`, p: o.p, x: cursor, y: ky }) })
      const kidLine = ky - S / 2 - 30
      const byGroup = new Map<string, { gx: number; gy: number; xs: number[] }>()
      order.forEach((o, i) => { const k = `${o.gx},${o.gy}`; const e = byGroup.get(k) ?? { gx: o.gx, gy: o.gy, xs: [] }; e.xs.push(start + i * STEP); byGroup.set(k, e) })
      let j = 0
      for (const e of byGroup.values()) {
        const ly = kidLine - j * 8; j++
        const a = Math.min(e.gx, ...e.xs), b = Math.max(e.gx, ...e.xs)
        lines.push({ d: `M${e.gx},${e.gy} V${ly}` }, { d: `M${a},${ly} H${b}` })
        for (const x of e.xs) lines.push({ d: `M${x},${ly} V${ky - S / 2}` })
      }
    }
    const xs = syms.map((s) => s.x), ys = syms.map((s) => s.y)
    const x0 = Math.min(...xs) - STEP / 2 - 20, x1 = Math.max(...xs) + STEP / 2 + 20
    const y0 = Math.min(...ys) - S / 2 - 30, y1 = Math.max(...ys) + S / 2 + 60
    const wMin = 480
    const cx0 = x1 - x0 < wMin ? x0 - (wMin - (x1 - x0)) / 2 : x0
    return { syms, lines, vb: { x: cx0, y: y0, w: Math.max(x1 - x0, wMin), h: y1 - y0 + 130 } }
  }, [detail, parentDetails, opts.grandparents, opts.siblings])
  const pz = usePanZoom({ maxScale: 3 })
  const name = focus ? fullName(focus) : ''
  const ly = vb.y + vb.h - 92

  return (
    <ChartFrame title={`Génogramme${name ? ` - ${name}` : ''}`} color={GRAPH_COLOR} persons={persons} focusId={focusId} onFocus={setFocusId}
      help={<HelpText title="Génogramme"><p>Représentation normalisée de la famille sur trois ou quatre générations : carré = homme, cercle = femme, losange = sexe inconnu, croix = personne décédée, double contour = personne centrale. L’âge (au décès ou actuel) est inscrit dans le symbole.</p><p>Une double ligne relie un couple marié, une ligne simple une union ; la ligne horizontale au-dessus des enfants est la ligne de fratrie. Touchez un symbole pour recentrer.</p></HelpText>}
      actions={<ChartActions exportTarget={() => svgRef.current} filename={`Génogramme ${name}`} />}
      options={<OptionGroup title="Contenu">
        <ToggleRow label="Grands-parents" checked={opts.grandparents} onChange={(v) => setOpts({ grandparents: v })} />
        <ToggleRow label="Frères et sœurs" checked={opts.siblings} onChange={(v) => setOpts({ siblings: v })} />
        <ToggleRow label="Âges dans les symboles" checked={opts.ages} onChange={(v) => setOpts({ ages: v })} />
        <ToggleRow label="Noms" checked={opts.names} onChange={(v) => setOpts({ names: v })} />
      </OptionGroup>}>
      <PrintStyle />
      {!pl && persons.length === 0 ? <ChartMessage>Aucune personne dans l’arbre pour l’instant.</ChartMessage> : (
        <PanZoomCanvas pz={pz} width={vb.w} height={vb.h} fitKey={detail ? `${detail.id}:${syms.length}` : undefined} background="plain" maxFit={1.3}
          overlay={(loading || pl) ? <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs text-mist-500 shadow" data-nopan><Spinner /> Chargement…</div> : error ? <div className="absolute inset-x-3 top-3 z-10 rounded-2xl bg-white px-4 py-2 text-sm text-conf-red shadow" data-nopan>{error}</div> : null}>
          <svg ref={svgRef} width={vb.w} height={vb.h} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} fontFamily="Inter, 'Segoe UI', system-ui, sans-serif">
            {lines.map((l, i) => l.double
              ? <g key={i}><path d={l.d} transform="translate(0,-3)" stroke="#1f2937" strokeWidth={1.6} fill="none" /><path d={l.d} transform="translate(0,3)" stroke="#1f2937" strokeWidth={1.6} fill="none" /></g>
              : <path key={i} d={l.d} stroke="#1f2937" strokeWidth={1.6} fill="none" strokeDasharray={l.dashed ? '5 4' : undefined} />)}
            {syms.map((s) => <Symbol key={s.key} s={s} opts={opts} onPick={(p) => setFocusId(p.id)} />)}
            {detail && (
              <g transform={`translate(${vb.x + 16},${ly})`} fontSize={11} fill="#374151">
                <rect x={-8} y={-14} width={Math.min(vb.w - 16, 450)} height={104} rx={12} fill="#f7f8fb" stroke="#e5e7eb" />
                <text x={0} y={2} fontWeight={700} fill="#13918c">Légende</text>
                <rect x={0} y={14} width={14} height={14} fill="#e6efff" stroke="#1f2937" strokeWidth={1.4} /><text x={20} y={25}>Homme</text>
                <circle cx={87} cy={21} r={7} fill="#fde7ef" stroke="#1f2937" strokeWidth={1.4} /><text x={99} y={25}>Femme</text>
                <path d="M167,13 L175,21 L167,29 L159,21 Z" fill="#eef0f4" stroke="#1f2937" strokeWidth={1.4} /><text x={181} y={25}>Sexe inconnu</text>
                <path d="M290,14 L304,28 M304,14 L290,28" stroke="#6b7280" strokeWidth={1.6} /><text x={310} y={25}>Décédé(e)</text>
                <rect x={-2} y={36} width={18} height={18} fill="none" stroke="#1f2937" strokeWidth={1.2} /><rect x={1} y={39} width={12} height={12} fill="#fff" stroke="#1f2937" strokeWidth={1.2} /><text x={22} y={49}>Personne centrale</text>
                <path d="M140,42 H166 M140,48 H166" stroke="#1f2937" strokeWidth={1.4} /><text x={172} y={49}>Mariage</text>
                <path d="M240,45 H266" stroke="#1f2937" strokeWidth={1.4} /><text x={272} y={49}>Union, filiation</text>
                <path d="M0,80 V68 H30 V80" stroke="#1f2937" strokeWidth={1.4} fill="none" /><text x={38} y={77}>Ligne de fratrie</text>
                <text x={150} y={77}>Nombre = âge (au décès ou actuel), ≈ estimé</text>
              </g>
            )}
          </svg>
        </PanZoomCanvas>
      )}
    </ChartFrame>
  )
}
