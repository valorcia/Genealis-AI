import { useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, type Stats } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, SegmentedRow, SliderRow, usePref } from '../../components/charts/ChartTools'
import { fitText, GRAPH_COLOR } from '../../components/charts/format'
import { Spinner } from '../../components/ui'

type Dist = Stats['surname_distribution'][number]
const COLW = 86, PLOT_H = 440, LEFT = 52, TOP = 22, BOTTOM = 46
const HUES = [['#a5f3fc', '#22d3ee', '#0891b2'], ['#bfdbfe', '#3b82f6', '#1d4ed8'], ['#ddd6fe', '#8b5cf6', '#6d28d9'], ['#99f6e4', '#14b8a6', '#0f766e'], ['#fde68a', '#f59e0b', '#b45309'], ['#fbcfe8', '#ec4899', '#be185d']]
const MONO = ['#b5ece8', '#13918c', '#0b6461']

interface Seg { y0: number; y1: number; hw: number; decade: number; count: number }

function shape(d: Dist, cx: number, y: (yr: number) => number, maxCount: number) {
  const maxHw = COLW * 0.34, minHw = 3.5
  const segs: Seg[] = []
  const counts = new Map(d.decades.map((x) => [x.decade, x.count]))
  for (let dec = Math.floor(d.first_year / 10) * 10; dec <= d.last_year; dec += 10) {
    const a = Math.max(dec, d.first_year), b = Math.min(dec + 10, d.last_year)
    if (b <= a && !(a === b && d.first_year === d.last_year)) continue
    const c = counts.get(dec) ?? 0
    segs.push({ y0: y(a), y1: y(b === a ? a + 1 : b), hw: c ? minHw + 1.5 + (c / maxCount) * (maxHw - minHw) : minHw, decade: dec, count: c })
  }
  if (!segs.length) return { path: '', segs }
  const right: string[] = [], left: string[] = []
  const ch = (sg: Seg) => Math.min(3, (sg.y0 - sg.y1) / 3)
  for (const sg of segs) right.push(`${cx + sg.hw},${sg.y0 - ch(sg)}`, `${cx + sg.hw},${sg.y1 + ch(sg)}`)
  for (const sg of [...segs].reverse()) left.push(`${cx - sg.hw},${sg.y1 + ch(sg)}`, `${cx - sg.hw},${sg.y0 - ch(sg)}`)
  const b = segs[0], t = segs[segs.length - 1]
  const path = `M${cx},${b.y0 + 2} L${right.join(' L')} L${cx},${t.y1 - 2} L${left.join(' L')} Z`
  return { path, segs }
}

export default function NameDistributionPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opts, setOpts] = usePref('distribution', { count: 12, sort: 'count' as 'count' | 'alpha' | 'first', colors: 'multi' as 'multi' | 'mono' })
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => { api.stats().then(setStats).catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Statistiques indisponibles.')) }, [])

  const chart = useMemo(() => {
    const all = (stats?.surname_distribution ?? []).filter((d) => d.first_year && d.last_year)
    const top = [...all].sort((a, b) => b.count - a.count).slice(0, opts.count)
    const list = opts.sort === 'alpha' ? top.sort((a, b) => a.surname.localeCompare(b.surname, 'fr')) : opts.sort === 'first' ? top.sort((a, b) => a.first_year - b.first_year) : top
    if (!list.length) return null
    const minY = Math.floor(Math.min(...list.map((d) => d.first_year)) / 50) * 50
    const maxY = Math.ceil((Math.max(...list.map((d) => d.last_year)) + 1) / 50) * 50
    const y = (yr: number) => TOP + ((maxY - yr) / (maxY - minY)) * PLOT_H
    const maxCount = Math.max(1, ...list.flatMap((d) => d.decades.map((x) => x.count)))
    const ticks: number[] = []
    const step = maxY - minY > 300 ? 100 : 50
    for (let t = minY; t <= maxY; t += step) ticks.push(t)
    const cols = list.map((d, i) => ({ d, cx: LEFT + COLW * i + COLW / 2, ...shape(d, LEFT + COLW * i + COLW / 2, y, maxCount) }))
    return { cols, ticks, y, width: LEFT + COLW * list.length + 16, height: TOP + PLOT_H + BOTTOM, total: all.length }
  }, [stats, opts.count, opts.sort])

  return (
    <ChartFrame title="Distribution" color={GRAPH_COLOR}
      help={<HelpText title="Distribution des noms"><p>Chaque colonne est un nom de famille : la barre s’étend de la première à la dernière année où ce nom apparaît dans l’arbre, et son épaisseur varie selon le nombre de personnes portant ce nom à chaque décennie.</p><p>Survolez (ou touchez) une portion de barre pour lire la décennie et l’effectif.</p></HelpText>}
      actions={<ChartActions exportTarget={() => svgRef.current} filename="Distribution des noms" />}
      styleOptions={<OptionGroup title="Couleurs"><SegmentedRow value={opts.colors} onChange={(v) => setOpts({ colors: v })} options={[{ value: 'multi', label: 'Dégradés variés' }, { value: 'mono', label: 'Une seule teinte' }]} /></OptionGroup>}
      options={<OptionGroup title="Noms affichés">
        <SliderRow label="Nombre de noms" value={opts.count} min={3} max={40} onChange={(v) => setOpts({ count: v })} />
        <SegmentedRow label="Ordre" value={opts.sort} onChange={(v) => setOpts({ sort: v })} options={[{ value: 'count', label: 'Effectif' }, { value: 'alpha', label: 'A → Z' }, { value: 'first', label: 'Ancienneté' }]} />
      </OptionGroup>}>
      <PrintStyle />
      {error && <ChartMessage>{error}</ChartMessage>}
      {!stats && !error && <ChartMessage><span className="inline-flex items-center gap-2"><Spinner /> Calcul de la distribution…</span></ChartMessage>}
      {stats && !chart && <ChartMessage>Aucun nom de famille daté pour l’instant : ajoutez des dates de naissance ou de décès pour voir la distribution.</ChartMessage>}
      {chart && (
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 mt-2 text-center text-3xl font-bold tracking-tight text-[#5f6168] sm:text-5xl">Distribution des noms</h2>
          <div className="overflow-x-auto rounded-3xl bg-white p-3 shadow-sm ring-1 ring-black/5 sm:p-5">
            <svg ref={svgRef} className="chart-print-area mx-auto block" width={chart.width} height={chart.height} viewBox={`0 0 ${chart.width} ${chart.height}`} fontFamily="Inter, 'Segoe UI', system-ui, sans-serif">
              <defs>
                {chart.cols.map((_c, i) => { const h = opts.colors === 'mono' ? MONO : HUES[i % HUES.length]; return (
                  <linearGradient key={i} id={`dist-g${i}`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor={h[0]} /><stop offset="0.55" stopColor={h[1]} /><stop offset="1" stopColor={h[2]} /></linearGradient>) })}
              </defs>
              {chart.ticks.map((t) => <g key={t}><line x1={LEFT} x2={chart.width - 16} y1={chart.y(t)} y2={chart.y(t)} stroke="#e5e7eb" /><text x={LEFT - 8} y={chart.y(t) + 4} textAnchor="end" fontSize={11} fill="#4b5563" className="tabular-nums">{t}</text></g>)}
              {chart.cols.map((_c, i) => <line key={i} x1={LEFT + COLW * (i + 1)} x2={LEFT + COLW * (i + 1)} y1={TOP} y2={TOP + PLOT_H} stroke="#f0f1f3" />)}
              <line x1={LEFT} x2={LEFT} y1={TOP} y2={TOP + PLOT_H} stroke="#111827" strokeWidth={1.2} />
              <line x1={LEFT} x2={chart.width - 16} y1={TOP + PLOT_H} y2={TOP + PLOT_H} stroke="#111827" strokeWidth={1.2} />
              {chart.cols.map((c, i) => (
                <g key={c.d.surname}>
                  <path d={c.path} fill={`url(#dist-g${i})`} stroke="rgba(0,0,0,0.08)" strokeWidth={0.8} />
                  {c.segs.map((s) => (
                    <rect key={s.decade} x={c.cx - COLW / 2 + 6} y={s.y1} width={COLW - 12} height={Math.max(2, s.y0 - s.y1)} fill="transparent">
                      <title>{`${c.d.surname} · ${s.decade}–${s.decade + 9} : ${s.count} personne${s.count > 1 ? 's' : ''}`}</title>
                    </rect>
                  ))}
                  <text x={c.cx} y={TOP + PLOT_H + 18} textAnchor="middle" fontSize={11.5} fill="#111827">{fitText(c.d.surname, COLW - 6, 11.5)}</text>
                  <text x={c.cx} y={TOP + PLOT_H + 33} textAnchor="middle" fontSize={10} fill="#6b7280">{c.d.count} pers.</text>
                </g>
              ))}
            </svg>
          </div>
          <p className="mt-2 text-center text-xs text-mist-500">{chart.cols.length} nom{chart.cols.length > 1 ? 's' : ''} affiché{chart.cols.length > 1 ? 's' : ''} sur {chart.total} · épaisseur = nombre de personnes par décennie</p>
        </div>
      )}
    </ChartFrame>
  )
}
