import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Minus, Plus, Scan } from 'lucide-react'
import { api, ApiError, EVENT_LABEL, type HistoricalEvent, type TimelineData, type TimelineItem } from '../api'
import { Spinner } from '../components/ui'
import ChartFrame from '../components/shell/ChartFrame'
import { useFocusPerson } from '../components/shell/useFocusPerson'
import { ChartActions, ChartMessage, HelpText, OptionGroup, PrintStyle, SegmentedRow, ToggleRow, usePref } from '../components/charts/ChartTools'
import { deathAge, fitText, fullName, GRAPH_COLOR } from '../components/charts/format'

const AXIS_H = 34
const ROW_H = 46
const BAR_H = 12
const HEAD = 26
const GAP = 16
const LANE_H = 34
const PAD_YEARS = 6

const GROUP_COLORS = [
  { fill: '#fbeee3', stroke: '#f1d9c4', ink: '#b77a4a' },
  { fill: '#f7f4e1', stroke: '#ebe5bd', ink: '#9b8a33' },
  { fill: '#e7f3ec', stroke: '#cce6d6', ink: '#3f8a5f' },
  { fill: '#e8eefb', stroke: '#cfdaf3', ink: '#4a68b3' },
  { fill: '#f3eafa', stroke: '#e1cff2', ink: '#8655b5' },
]
const HIST = { fill: '#fbe6e8', stroke: '#f2cdd2', ink: '#b65a68' }
const SEX_BAR = { M: ['#cddcfb', '#9fb7ef'], F: ['#fcd6c8', '#f0ae96'], U: ['#e3e5ea', '#c3c7d0'] } as const
const WAR = '#2fbf71'
const REGION_LABEL: Record<string, string> = { FR: 'France', EU: 'Europe', IT: 'Italie', PL: 'Pologne', BE: 'Belgique', DE: 'Allemagne', LU: 'Luxembourg' }

type GroupBy = 'pays' | 'generation' | 'aucun'
interface Row { item: TimelineItem; y: number }
interface Group { key: string; label: string; y: number; height: number; rows: Row[]; y0: number; y1: number; color: typeof GROUP_COLORS[number] }

const countryOf = (it: TimelineItem) => {
  const place = it.birth_place ?? it.death_place ?? it.events.find((e) => e.place)?.place ?? null
  if (!place) return 'Lieu inconnu'
  const parts = place.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : parts[0]
}

export default function TimelinePage() {
  const nav = useNavigate()
  const { persons, focusId, setFocusId, loading: pl } = useFocusPerson()
  const [opts, setOpts] = usePref('chronogramme', { group: 'pays' as GroupBy, all: false, hist: true })
  const [data, setData] = useState<TimelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState({ w: 1000, h: 600 })
  const [ppy, setPpy] = useState(6)
  const [pan, setPan] = useState({ x: 20, y: 0 })
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ x: number; y: number; px: number; py: number; dist: number; ppy: number; moved: boolean } | null>(null)
  const moved = useRef(false)

  useEffect(() => {
    if (!focusId && !opts.all) { if (!pl) setLoading(false); return }
    let alive = true
    setLoading(true); setError(null)
    api.timeline(opts.all ? undefined : focusId ?? undefined, opts.all).then((d) => { if (alive) setData(d) })
      .catch((e: unknown) => { if (alive) setError(e instanceof ApiError ? e.message : 'Impossible de charger la chronologie.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [focusId, opts.all, pl])

  const empty = !loading && !pl && (persons.length === 0 || (!!data && data.items.length === 0))
  useEffect(() => {
    const el = boxRef.current; if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [empty])

  const minYear = data ? Math.floor((data.min_year - 15) / 25) * 25 : 1800
  const maxYear = data ? Math.ceil((data.max_year + 15) / 25) * 25 : 2030
  const span = Math.max(10, maxYear - minYear)

  const layout = useMemo(() => {
    const items = [...(data?.items ?? [])].sort((a, b) => a.start - b.start)
    // Bande « Histoire » : événements répartis en couloirs pour éviter les chevauchements.
    const evs = (opts.hist ? data?.historical_events ?? [] : []).filter((e) => e.end >= minYear && e.start <= maxYear).sort((a, b) => a.start - b.start)
    const MAX_LANES = 4
    const laneEnd: number[] = []
    const lanes = evs.map((ev) => {
      const endYear = ev.end + 6 / Math.max(0.3, ppy)
      let lane = laneEnd.findIndex((e) => e <= ev.start)
      if (lane === -1 && laneEnd.length < MAX_LANES) { lane = laneEnd.length; laneEnd.push(endYear) }
      else if (lane === -1) { lane = laneEnd.indexOf(Math.min(...laneEnd)); laneEnd[lane] = Math.max(laneEnd[lane], endYear) }
      else laneEnd[lane] = endYear
      return { ev, lane, room: Infinity }
    })
    // Place disponible pour l'étiquette : jusqu'au prochain événement du même couloir.
    for (let i = 0; i < lanes.length; i++) {
      const nxt = lanes.slice(i + 1).find((l) => l.lane === lanes[i].lane)
      lanes[i].room = nxt ? (nxt.ev.start - lanes[i].ev.start) * ppy - 8 : Infinity
    }
    let y = 10
    const hist = lanes.length ? { y, height: HEAD + laneEnd.length * LANE_H + 8 } : null
    if (hist) y += hist.height + GAP
    const buckets = new Map<string, TimelineItem[]>()
    for (const it of items) {
      const key = opts.group === 'pays' ? countryOf(it) : opts.group === 'generation' ? (it.generation === null ? 'Autres personnes' : it.generation === 0 ? 'Personne de départ' : it.generation === 1 ? 'Parents' : it.generation === 2 ? 'Grands-parents' : `Génération +${it.generation}`) : 'Famille'
      const arr = buckets.get(key); if (arr) arr.push(it); else buckets.set(key, [it])
    }
    const keys = [...buckets.keys()].sort((a, b) => (a === 'Lieu inconnu' ? 1 : b === 'Lieu inconnu' ? -1 : (buckets.get(b)?.length ?? 0) - (buckets.get(a)?.length ?? 0)))
    if (opts.group === 'generation') keys.sort((a, b) => Math.min(...(buckets.get(a) ?? []).map((i) => i.generation ?? 99)) - Math.min(...(buckets.get(b) ?? []).map((i) => i.generation ?? 99)))
    const groups: Group[] = keys.map((key, gi) => {
      const its = buckets.get(key) ?? []
      const rows = its.map((item, i) => ({ item, y: y + HEAD + i * ROW_H }))
      const g: Group = { key, label: key, y, height: HEAD + its.length * ROW_H + 8, rows, y0: Math.min(...its.map((i) => i.start)) - PAD_YEARS, y1: Math.max(...its.map((i) => i.end)) + PAD_YEARS, color: GROUP_COLORS[gi % GROUP_COLORS.length] }
      y += g.height + GAP
      return g
    })
    return { hist, lanes, groups, contentH: y + 10 }
  }, [data, opts.hist, opts.group, minYear, maxYear, ppy])

  const viewH = Math.max(100, size.h - AXIS_H)
  const xOf = useCallback((year: number) => pan.x + (year - minYear) * ppy, [pan.x, minYear, ppy])
  const clampPan = useCallback((p: { x: number; y: number }, k = ppy) => {
    const totalW = span * k
    const minX = Math.min(20, size.w - totalW - 20)
    const minY = Math.min(0, viewH - layout.contentH)
    return { x: Math.max(minX, Math.min(20, p.x)), y: Math.max(minY, Math.min(0, p.y)) }
  }, [span, ppy, size.w, viewH, layout.contentH])
  const fit = useCallback(() => { const k = Math.max(0.4, Math.min(60, (size.w - 40) / span)); setPpy(k); setPan({ x: 20, y: 0 }) }, [size.w, span])
  const fitRef = useRef(fit)
  useEffect(() => { fitRef.current = fit }, [fit])
  useEffect(() => { if (data) fitRef.current() }, [data, size.w])

  const zoomAt = useCallback((factor: number, cx: number, base?: { ppy: number; px: number }) => {
    const k0 = base?.ppy ?? ppy, px = base?.px ?? pan.x
    const next = Math.max(0.3, Math.min(80, k0 * factor))
    const year = minYear + (cx - px) / k0
    setPpy(next)
    setPan((p) => clampPan({ x: cx - (year - minYear) * next, y: p.y }, next))
  }, [ppy, minYear, pan.x, clampPan])

  useEffect(() => {
    const el = boxRef.current; if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2 && !e.shiftKey && e.deltaMode !== 0) zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left)
      else if (e.shiftKey) setPan((p) => clampPan({ x: p.x - e.deltaY, y: p.y }))
      else setPan((p) => clampPan({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, clampPan])

  const rel = (e: ReactPointerEvent) => { const r = (boxRef.current as HTMLDivElement).getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const start = () => {
    const pts = [...pointers.current.values()]
    const mid = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0]
    gesture.current = { x: mid.x, y: mid.y, px: pan.x, py: pan.y, dist: pts.length > 1 ? Math.abs(pts[0].x - pts[1].x) + 1 : 0, ppy, moved: gesture.current?.moved ?? false }
  }
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => { if ((e.target as HTMLElement).closest('[data-nopan]')) return; pointers.current.set(e.pointerId, rel(e)); if (pointers.current.size === 1) moved.current = false; start() }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return
    pointers.current.set(e.pointerId, rel(e))
    const g = gesture.current, pts = [...pointers.current.values()]
    if (pts.length >= 2 && g.dist) {
      const d = Math.abs(pts[0].x - pts[1].x) + 1
      moved.current = true
      zoomAt(d / g.dist, g.x, { ppy: g.ppy, px: g.px })
      return
    }
    const dx = pts[0].x - g.x, dy = pts[0].y - g.y
    if (!moved.current && Math.abs(dx) + Math.abs(dy) < 6) return
    if (!moved.current) { try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ } }
    moved.current = true
    setPan(clampPan({ x: g.px + dx, y: g.py + dy }))
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => { pointers.current.delete(e.pointerId); if (pointers.current.size) start(); else gesture.current = null }
  const openPerson = (id: string) => { if (!moved.current) nav(`/personnes/${id}`) }

  const ticks = useMemo(() => {
    const step = ppy * 25 >= 48 ? 25 : ppy * 50 >= 48 ? 50 : 100
    const out: number[] = []
    for (let y = Math.ceil(minYear / step) * step; y <= maxYear; y += step) out.push(y)
    return out
  }, [minYear, maxYear, ppy])
  const wars = (opts.hist ? data?.historical_events ?? [] : []).filter((e) => e.kind === 'war' && (e.region === 'FR' || e.region === 'EU'))

  const histBar = (ev: HistoricalEvent, lane: number, room: number, top: number, i: number) => {
    const x0 = xOf(ev.start), x1 = Math.max(xOf(ev.end), x0 + 6)
    const y = top + HEAD + lane * LANE_H
    const avail = Math.min(room, size.w - x0 - 8)
    const label = avail < 34 ? '' : fitText(ev.label, avail, 10)
    return (
      <g key={i}>
        <title>{`${ev.label} (${ev.start === ev.end ? ev.start : `${ev.start}–${ev.end}`}) · ${REGION_LABEL[ev.region] ?? ev.region}`}</title>
        {label && <text x={x0 + 2} y={y + 10} fontSize={10} fontWeight={600} fill="#4b5563">{label}</text>}
        <rect x={x0} y={y + 15} width={x1 - x0} height={9} rx={4.5} fill={ev.kind === 'war' ? '#f3b9bf' : '#d7dae2'} />
      </g>
    )
  }

  return (
    <ChartFrame title="Chronogramme" color={GRAPH_COLOR} persons={persons} focusId={focusId} onFocus={setFocusId}
      help={<HelpText title="Chronogramme"><p>Chaque vie est une barre, de la naissance au décès (bleu : homme, saumon : femme ; bout estompé = fin estimée). Les personnes sont regroupées par pays de naissance, ou par génération. La bande rose « Histoire » replace la famille dans les grands événements ; les guerres apparaissent aussi en colonnes vertes.</p><p>Glissez pour vous déplacer, pincez ou utilisez Ctrl + molette pour zoomer, touchez une barre pour ouvrir la fiche.</p></HelpText>}
      actions={<ChartActions exportTarget={() => svgRef.current} filename="Chronogramme" />}
      options={<>
        <OptionGroup title="Personnes">
          <SegmentedRow value={opts.all ? 'all' : 'asc'} onChange={(v) => setOpts({ all: v === 'all' })} options={[{ value: 'asc', label: 'Ascendance' }, { value: 'all', label: 'Tout l’arbre' }]} />
          <SegmentedRow label="Regrouper par" value={opts.group} onChange={(v) => setOpts({ group: v })} options={[{ value: 'pays', label: 'Pays' }, { value: 'generation', label: 'Génération' }, { value: 'aucun', label: 'Aucun' }]} />
        </OptionGroup>
        <OptionGroup title="Contexte"><ToggleRow label="Histoire : événements marquants" checked={opts.hist} onChange={(v) => setOpts({ hist: v })} /></OptionGroup>
      </>}>
      <PrintStyle />
      {error && <ChartMessage>{error}</ChartMessage>}
      {empty ? <ChartMessage>{persons.length === 0 ? 'Aucune personne dans l’arbre : le chronogramme se remplira dès que des dates seront connues.' : 'Aucune date connue pour ces personnes. Ajoutez des naissances, mariages ou décès datés pour les voir apparaître.'}</ChartMessage> : (
        <div ref={boxRef} className="chart-viewport relative w-full select-none overflow-hidden rounded-3xl bg-white ring-1 ring-black/5" style={{ height: 'calc(100dvh - 150px)', minHeight: 420, touchAction: 'none', cursor: 'grab' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {(loading || pl) && <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs text-mist-500 shadow"><Spinner /> Construction du chronogramme…</div>}
          <svg ref={svgRef} width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} className="chart-print-area block" fontFamily="Inter, 'Segoe UI', system-ui, sans-serif">
            <defs>
              <clipPath id="tl-clip"><rect x={0} y={AXIS_H} width={size.w} height={viewH} /></clipPath>
              {(['M', 'F', 'U'] as const).map((k) => (
                <linearGradient key={k} id={`tl-est-${k}`} x1="0" x2="1"><stop offset="0.6" stopColor={SEX_BAR[k][0]} /><stop offset="1" stopColor={SEX_BAR[k][0]} stopOpacity="0.1" /></linearGradient>
              ))}
            </defs>
            <rect width={size.w} height={size.h} fill="#ffffff" />
            {ticks.map((t) => <line key={t} x1={xOf(t)} x2={xOf(t)} y1={AXIS_H} y2={size.h} stroke="#f0f1f4" />)}
            <g clipPath="url(#tl-clip)">
              <g transform={`translate(0, ${AXIS_H + pan.y})`}>
                {wars.map((w, i) => <rect key={`w${i}`} x={xOf(w.start)} y={0} width={Math.max(3, (w.end - w.start) * ppy)} height={layout.contentH} fill={WAR} opacity={0.09}><title>{`${w.label} (${w.start}–${w.end})`}</title></rect>)}
                {layout.hist && (() => {
                  const x0 = Math.max(xOf(minYear + 4), 6), x1 = Math.min(xOf(maxYear - 4), size.w * 4)
                  return (
                    <g>
                      <rect x={x0} y={layout.hist.y} width={Math.max(40, x1 - x0)} height={layout.hist.height} rx={14} fill={HIST.fill} stroke={HIST.stroke} />
                      <text x={Math.max(x0 + 12, Math.min((x0 + x1) / 2, size.w / 2))} y={layout.hist.y + 17} textAnchor="middle" fontSize={11} fontWeight={600} fill={HIST.ink}>Histoire : événements marquants</text>
                      {layout.lanes.map(({ ev, lane, room }, i) => histBar(ev, lane, room, layout.hist!.y, i))}
                    </g>
                  )
                })()}
                {layout.groups.map((g) => {
                  if (g.y + g.height + pan.y < 0 || g.y + pan.y > viewH) return null
                  const gx0 = xOf(g.y0), gx1 = xOf(g.y1)
                  return (
                    <g key={g.key}>
                      <rect x={gx0} y={g.y} width={Math.max(60, gx1 - gx0)} height={g.height} rx={14} fill={g.color.fill} stroke={g.color.stroke} />
                      <text x={Math.max(gx0 + 30, Math.min((gx0 + gx1) / 2, size.w - 40))} y={g.y + 17} textAnchor="middle" fontSize={11} fontWeight={600} fill={g.color.ink}>{g.label} · {g.rows.length}</text>
                      {g.rows.map(({ item, y }) => {
                        if (y + pan.y < -ROW_H || y + pan.y > viewH + ROW_H) return null
                        const x0 = xOf(item.start), x1 = Math.max(xOf(item.end), x0 + 4)
                        const k = item.sex === 'M' ? 'M' : item.sex === 'F' ? 'F' : 'U'
                        const by = y + 15
                        const age = deathAge(item)
                        return (
                          <g key={item.id} className="cursor-pointer" onClick={() => openPerson(item.id)}>
                            <title>{`${fullName(item)} · ${item.birth_display ?? item.start} – ${item.death_display ?? (item.estimated ? `≈ ${item.end} (estimé)` : item.end)}${item.events.length ? '\n' + item.events.slice(0, 8).map((ev) => `${EVENT_LABEL[ev.type] ?? ev.type} ${ev.year ?? '?'}${ev.place ? ` · ${ev.place}` : ''}`).join('\n') : ''}`}</title>
                            {item.portrait_media_id && <image href={api.mediaFileUrl(item.portrait_media_id)} x={x0 - 26} y={by - 7} width={22} height={22} preserveAspectRatio="xMidYMid slice" />}
                            <text x={x0 + (x1 - x0) / 2} y={by - 4} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="#111827">{fitText(fullName(item), Math.max(140, x1 - x0 + 60), 10.5)}</text>
                            <rect x={x0} y={by} width={x1 - x0} height={BAR_H} rx={BAR_H / 2} fill={item.estimated ? `url(#tl-est-${k})` : SEX_BAR[k][0]} stroke={SEX_BAR[k][1]} strokeWidth={1} strokeDasharray={item.estimated ? '3 3' : undefined} />
                            {item.events.map((ev, i) => (ev.year === null || ev.type === 'birth' || ev.type === 'death' ? null : <rect key={i} x={xOf(ev.year) - 3} y={by + BAR_H / 2 - 3} width={6} height={6} transform={`rotate(45 ${xOf(ev.year)} ${by + BAR_H / 2})`} fill="#ffffff" stroke={SEX_BAR[k][1]} strokeWidth={1.2} />))}
                            {(() => {
                              const bLabel = `Naissance ${item.birth_display ?? `≈ ${item.start}`}`
                              const dLabel = item.estimated ? '' : `Décès ${item.death_display ?? item.end}${age ? ` (${age})` : ''}`
                              if (!dLabel) return <text x={x0} y={by + BAR_H + 10} fontSize={9} fill="#6b7280">{bLabel}</text>
                              if (x1 - x0 > (bLabel.length + dLabel.length) * 4.9 + 12) return (<>
                                <text x={x0} y={by + BAR_H + 10} fontSize={9} fill="#6b7280">{bLabel}</text>
                                <text x={x1} y={by + BAR_H + 10} textAnchor="end" fontSize={9} fill="#6b7280">{dLabel}</text>
                              </>)
                              return <text x={x0} y={by + BAR_H + 10} fontSize={9} fill="#6b7280">☆ {item.birth_display ?? `≈ ${item.start}`}  † {item.death_display ?? item.end}{age ? ` (${age})` : ''}</text>
                            })()}
                          </g>
                        )
                      })}
                    </g>
                  )
                })}
              </g>
            </g>
            <rect x={0} y={0} width={size.w} height={AXIS_H} fill="#ffffff" />
            <line x1={0} x2={size.w} y1={AXIS_H - 0.5} y2={AXIS_H - 0.5} stroke="#111827" />
            {ticks.map((t) => <g key={t}><line x1={xOf(t)} x2={xOf(t)} y1={AXIS_H - 6} y2={AXIS_H} stroke="#111827" /><text x={xOf(t)} y={AXIS_H - 12} textAnchor="middle" fontSize={11} fill="#111827">{t}</text></g>)}
          </svg>
          <div className="absolute right-3 top-11 z-10 flex flex-col overflow-hidden rounded-2xl bg-white/85 shadow-md ring-1 ring-black/5 backdrop-blur print:hidden" data-nopan>
            <button className="p-2 hover:bg-black/5" onClick={() => zoomAt(1.3, size.w / 2)} aria-label="Zoom avant"><Plus size={18} /></button>
            <button className="border-y border-black/5 p-2 hover:bg-black/5" onClick={fit} aria-label="Ajuster"><Scan size={18} /></button>
            <button className="p-2 hover:bg-black/5" onClick={() => zoomAt(1 / 1.3, size.w / 2)} aria-label="Zoom arrière"><Minus size={18} /></button>
          </div>
        </div>
      )}
    </ChartFrame>
  )
}
