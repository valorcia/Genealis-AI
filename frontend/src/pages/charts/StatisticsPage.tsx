import { useEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api, ApiError, type Stats } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { ChartActions, ChartMessage, HelpText, PrintStyle } from '../../components/charts/ChartTools'
import { fitText, GRAPH_COLOR } from '../../components/charts/format'
import { Spinner } from '../../components/ui'

const BAR = '#8fb3f7', BAR_EDGE = '#5b8ef0', INK = '#111827', MUTED = '#6b7280', GRID = '#eceef2'
const M_COLOR = '#5b8ef0', F_COLOR = '#e0789a'
const fmt = (n: number | null | undefined, d = 1) => (n == null ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: d }))

/** Largeur réelle du conteneur (les textes gardent leur taille sur téléphone). */
function useWidth(ref: RefObject<HTMLDivElement | null>, fallback: number) {
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(300, Math.round(el.clientWidth))))
    ro.observe(el); setW(Math.max(300, Math.round(el.clientWidth)))
    return () => ro.disconnect()
  }, [ref])
  return w
}

function niceMax(v: number) { if (v <= 5) return Math.max(1, Math.ceil(v)); const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p }

/** Histogramme vertical (barres fines, sommet arrondi, valeurs au-dessus, info-bulle). */
function VBars({ data, xLabel, yLabel, unit = '', svgRef }: { data: { label: string; value: number; title?: string }[]; xLabel: string; yLabel: string; unit?: string; svgRef: Ref<SVGSVGElement> }) {
  const box = useRef<HTMLDivElement>(null)
  const W = useWidth(box, 760)
  const H = W < 500 ? 330 : 380, L = 50, R = 10, T = 24
  const pw0 = W - L - R
  const rotate = pw0 / Math.max(1, data.length) < 46
  const B = rotate ? 74 : 56
  const integer = data.every((d) => Number.isInteger(d.value))
  const rawMax = Math.max(1, ...data.map((d) => d.value))
  const max = integer && rawMax <= 6 ? Math.ceil(rawMax) : niceMax(rawMax)
  const pw = pw0, ph = H - T - B
  const bw = pw / Math.max(1, data.length)
  const ticks = integer && max <= 6 ? Array.from({ length: max + 1 }, (_, i) => i) : Array.from({ length: 5 }, (_, i) => (max * i) / 4)
  return (
    <div ref={box} className="w-full min-w-0 overflow-hidden">
    <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" fontFamily="Inter, 'Segoe UI', system-ui, sans-serif" role="img" aria-label={`${yLabel} par ${xLabel}`}>
      {ticks.map((t) => { const y = T + ph - (t / max) * ph; return <g key={t}><line x1={L} x2={W - R} y1={y} y2={y} stroke={GRID} /><text x={L - 8} y={y + 4} textAnchor="end" fontSize={11} fill={MUTED}>{fmt(t, 1)}</text></g> })}
      <line x1={L} x2={L} y1={T} y2={T + ph} stroke={INK} strokeWidth={1.2} />
      <line x1={L} x2={W - R} y1={T + ph} y2={T + ph} stroke={INK} strokeWidth={1.2} />
      {data.map((d, i) => {
        const h = (d.value / max) * ph
        const x = L + i * bw + Math.max(1, bw * 0.14), w = Math.max(2, bw * 0.72)
        const y = T + ph - h, r = Math.min(4, w / 2, h)
        return (
          <g key={i}>
            <rect x={L + i * bw} y={T} width={bw} height={ph} fill="transparent"><title>{d.title ?? `${d.label} : ${fmt(d.value)}${unit}`}</title></rect>
            {h > 0 && <path d={`M${x},${T + ph} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${T + ph} Z`} fill={BAR} stroke={BAR_EDGE} strokeWidth={1} style={{ pointerEvents: 'none' }} />}
            {d.value > 0 && <text x={x + w / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK} style={{ pointerEvents: 'none' }}>{fmt(d.value)}</text>}
            {(bw >= 22 || i % 2 === 0) && <text transform={`translate(${L + i * bw + bw / 2},${T + ph + 15}) ${rotate ? 'rotate(-40)' : ''}`} textAnchor={rotate ? 'end' : 'middle'} fontSize={10.5} fill={INK}>{d.label}</text>}
          </g>
        )
      })}
      <text x={L + pw / 2} y={H - 6} textAnchor="middle" fontSize={12} fontWeight={600} fill={INK}>{xLabel}</text>
      <text transform={`translate(14,${T + ph / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fontWeight={600} fill={INK}>{yLabel}</text>
    </svg>
    </div>
  )
}

/** Barres horizontales classées (palmarès). */
function HBars({ data, color = BAR, svgRef, title }: { data: [string, number][]; color?: string; svgRef?: Ref<SVGSVGElement>; title?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const W = useWidth(box, 520), ROW = 30, L = Math.min(170, Math.round(W * 0.38)), T = title ? 30 : 6
  const H = T + Math.max(1, data.length) * ROW + 6
  const max = Math.max(1, ...data.map((d) => d[1]))
  return (
    <div ref={box} className="w-full min-w-0 overflow-hidden">
    <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" fontFamily="Inter, 'Segoe UI', system-ui, sans-serif">
      {title && <text x={0} y={18} fontSize={14} fontWeight={700} fill={INK}>{title}</text>}
      {data.length === 0 && <text x={0} y={T + 18} fontSize={12} fill={MUTED}>Aucune donnée pour l’instant.</text>}
      {data.map(([label, v], i) => {
        const y = T + i * ROW, w = ((W - L - 44) * v) / max
        return (
          <g key={label + i}>
            <title>{`${label} : ${v}`}</title>
            <text x={L - 10} y={y + ROW / 2 + 4} textAnchor="end" fontSize={12} fill={INK}>{fitText(label, L - 14, 12)}</text>
            <rect x={L} y={y + 6} width={Math.max(3, w)} height={ROW - 12} rx={4} fill={color} />
            <text x={L + Math.max(3, w) + 6} y={y + ROW / 2 + 4} fontSize={12} fontWeight={600} fill={INK}>{v}</text>
          </g>
        )
      })}
    </svg>
    </div>
  )
}

function Hero({ value, unit, caption, sub, svgRef }: { value: string; unit: string; caption: string; sub: string; svgRef: Ref<SVGSVGElement> }) {
  return (
    <svg ref={svgRef} viewBox="0 0 600 260" className="mx-auto block h-auto w-full max-w-xl" fontFamily="Inter, 'Segoe UI', system-ui, sans-serif">
      <text x={300} y={130} textAnchor="middle" fontSize={96} fontWeight={700} fill={INK}>{value}<tspan fontSize={30} fontWeight={500} fill={MUTED} dx={8}>{unit}</tspan></text>
      <text x={300} y={180} textAnchor="middle" fontSize={18} fill={INK}>{caption}</text>
      <text x={300} y={210} textAnchor="middle" fontSize={13} fill={MUTED}>{sub}</text>
    </svg>
  )
}

const Chip = ({ children }: { children: ReactNode }) => <span className="rounded-full bg-black/[0.045] px-3 py-1 text-[13px] text-night-900">{children}</span>

interface ChartDef { id: string; label: string; render: (s: Stats, ref: Ref<SVGSVGElement>) => ReactNode; empty: (s: Stats) => boolean }

const CHARTS: ChartDef[] = [
  { id: 'deces', label: 'Âge lors du décès', empty: (s) => s.age_at_death.count === 0,
    render: (s, ref) => (<>
      <VBars svgRef={ref} xLabel="Âge" yLabel="Personnes" data={s.age_at_death.histogram.map((b) => ({ label: `${b.from} - ${b.to}`, value: b.count, title: `${b.count} personne${b.count > 1 ? 's' : ''} décédée${b.count > 1 ? 's' : ''} entre ${b.from} et ${b.to} ans` }))} />
      <div className="mt-3 flex flex-wrap justify-center gap-2"><Chip>Moyenne <b>{fmt(s.age_at_death.average)} ans</b></Chip><Chip><span style={{ color: M_COLOR }}>●</span> Hommes {fmt(s.age_at_death.average_m)} ans</Chip><Chip><span style={{ color: F_COLOR }}>●</span> Femmes {fmt(s.age_at_death.average_f)} ans</Chip><Chip>Maximum {fmt(s.age_at_death.max, 0)} ans</Chip><Chip>{s.age_at_death.count} décès datés</Chip></div>
    </>) },
  { id: 'naissances', label: 'Naissances par décennie', empty: (s) => s.births_by_decade.length === 0,
    render: (s, ref) => {
      const m = new Map(s.births_by_decade.map((d) => [d.decade, d.count]))
      const ds = s.births_by_decade.map((d) => d.decade)
      const all: { label: string; value: number }[] = []
      for (let d = Math.min(...ds); d <= Math.max(...ds); d += 10) all.push({ label: `${d}`, value: m.get(d) ?? 0 })
      return <VBars svgRef={ref} xLabel="Décennie de naissance" yLabel="Naissances" data={all} />
    } },
  { id: 'esperance', label: 'Espérance de vie par siècle', empty: (s) => !s.lifespan_by_century.some((c) => c.average != null),
    render: (s, ref) => (<>
      <VBars svgRef={ref} xLabel="Siècle de naissance" yLabel="Âge moyen au décès (ans)" unit=" ans" data={s.lifespan_by_century.map((c) => ({ label: `${c.century / 100 + 1}ᵉ s.`, value: c.average ?? 0, title: `Nés au ${c.century / 100 + 1}ᵉ siècle : ${fmt(c.average)} ans en moyenne (${c.count} personne${c.count > 1 ? 's' : ''})` }))} />
      <p className="mt-2 text-center text-xs text-mist-500">Moyenne de l’âge au décès des personnes dont les deux dates sont connues, selon leur siècle de naissance.</p>
    </>) },
  { id: 'prenoms', label: 'Prénoms les plus fréquents', empty: (s) => !s.top_given_names_m.length && !s.top_given_names_f.length,
    render: (s, ref) => (
      <div className="grid gap-6 sm:grid-cols-2 [&>*]:min-w-0">
        <HBars svgRef={ref} title="Hommes" data={s.top_given_names_m.slice(0, 10)} color={M_COLOR} />
        <HBars title="Femmes" data={s.top_given_names_f.slice(0, 10)} color={F_COLOR} />
      </div>) },
  { id: 'lieux', label: 'Lieux de naissance', empty: (s) => !s.top_birth_places.length, render: (s, ref) => <HBars svgRef={ref} data={s.top_birth_places.slice(0, 12)} color="#5fb3ae" /> },
  { id: 'professions', label: 'Professions', empty: (s) => !s.top_occupations.length, render: (s, ref) => <HBars svgRef={ref} data={s.top_occupations.slice(0, 12)} color="#c49a6c" /> },
  { id: 'mariage', label: 'Âge moyen au mariage', empty: (s) => !s.marriage_age.count,
    render: (s, ref) => <Hero svgRef={ref} value={fmt(s.marriage_age.average)} unit="ans" caption="Âge moyen au premier mariage" sub={`calculé sur ${s.marriage_age.count} mariage${s.marriage_age.count > 1 ? 's' : ''} daté${s.marriage_age.count > 1 ? 's' : ''} avec date de naissance connue`} /> },
  { id: 'enfants', label: 'Enfants par famille', empty: (s) => !s.children_per_family.count,
    render: (s, ref) => <Hero svgRef={ref} value={fmt(s.children_per_family.average)} unit="enfants" caption="en moyenne par famille" sub={`${s.children_per_family.count} famille${s.children_per_family.count > 1 ? 's' : ''} · au plus ${fmt(s.children_per_family.max, 0)} enfant${(s.children_per_family.max ?? 0) > 1 ? 's' : ''} dans une même famille`} /> },
]

export default function StatisticsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [idx, setIdx] = useState(() => { try { return Math.max(0, CHARTS.findIndex((c) => c.id === localStorage.getItem('genealis.chart.stat'))) } catch { return 0 } })
  const svgRef = useRef<SVGSVGElement>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => { api.stats().then(setStats).catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Statistiques indisponibles.')) }, [])
  const go = (i: number) => { const n = (i + CHARTS.length) % CHARTS.length; setIdx(n); try { localStorage.setItem('genealis.chart.stat', CHARTS[n].id) } catch { /* ignore */ } }
  const chart = CHARTS[idx]

  return (
    <ChartFrame title="Statistiques" color={GRAPH_COLOR}
      help={<HelpText title="Statistiques"><p>Huit graphiques calculés sur toutes les personnes de l’arbre : âges au décès, naissances par décennie, espérance de vie, prénoms, lieux, professions, âge au mariage et taille des familles.</p><p>Glissez vers la gauche ou la droite (ou utilisez les flèches) pour passer d’un graphique à l’autre. Seules les dates réellement connues sont prises en compte.</p></HelpText>}
      actions={<ChartActions exportTarget={() => svgRef.current} filename={`Statistiques - ${chart.label}`} />}>
      <PrintStyle />
      <div className="sticky top-0 z-10 -mx-2 mb-3 overflow-x-auto px-2 pb-1 sm:mx-0 sm:px-0">
        <div className="mx-auto flex w-max gap-1.5 rounded-2xl bg-white/70 p-1 shadow-sm ring-1 ring-black/5 backdrop-blur">
          {CHARTS.map((c, i) => <button key={c.id} onClick={() => go(i)} className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-[13px] transition-colors ${i === idx ? 'bg-[#13918c] font-semibold text-white shadow-sm' : 'text-night-900/70 hover:bg-black/5'}`}>{c.label}</button>)}
        </div>
      </div>
      {error && <ChartMessage>{error}</ChartMessage>}
      {!stats && !error && <ChartMessage><span className="inline-flex items-center gap-2"><Spinner /> Calcul des statistiques…</span></ChartMessage>}
      {stats && (
        <div className="mx-auto max-w-4xl touch-pan-y select-none"
          onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY } }}
          onPointerUp={(e) => { const s = swipe.current; swipe.current = null; if (!s) return; const dx = e.clientX - s.x, dy = e.clientY - s.y; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(idx + (dx < 0 ? 1 : -1)) }}>
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => go(idx - 1)} className="rounded-full bg-white/80 p-2 text-[#13918c] shadow-sm ring-1 ring-black/5" aria-label="Graphique précédent"><ChevronLeft size={20} /></button>
            <h2 className="text-center text-2xl font-bold text-[#5f6168] sm:text-4xl">{chart.label}</h2>
            <button onClick={() => go(idx + 1)} className="rounded-full bg-white/80 p-2 text-[#13918c] shadow-sm ring-1 ring-black/5" aria-label="Graphique suivant"><ChevronRight size={20} /></button>
          </div>
          <div className="chart-print-area mt-4 rounded-3xl bg-white p-3 shadow-sm ring-1 ring-black/5 sm:p-6">
            {chart.empty(stats) ? <p className="py-16 text-center text-mist-500">Pas encore assez de données connues pour ce graphique.</p> : chart.render(stats, svgRef)}
          </div>
          <div className="mt-3 flex justify-center gap-1.5">{CHARTS.map((c, i) => <span key={c.id} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-[#13918c]' : 'w-1.5 bg-black/15'}`} />)}</div>
          <p className="mt-2 text-center text-xs text-mist-500">{stats.persons} personnes · {stats.sexes.M ?? 0} hommes · {stats.sexes.F ?? 0} femmes · {stats.with_sources} avec sources</p>
        </div>
      )}
    </ChartFrame>
  )
}
