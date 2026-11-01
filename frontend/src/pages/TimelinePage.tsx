import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Minus, Plus, Scan } from 'lucide-react'
import { api, ApiError, EVENT_LABEL, type Confidence, type HistoricalEvent, type PersonSummary, type TimelineData, type TimelineItem } from '../api'
import { Empty, Spinner } from '../components/ui'

const GUTTER = 160
const AXIS_H = 34
const ROW_H = 26
const BAR_H = 16
const GROUP_HEAD = 30
const LANE_H = 17
const CONF_FILL: Record<Confidence, string> = { green: '#5f9a6a', orange: '#d9932c', red: '#b4473c', grey: '#9aa1ad' }
const HIST_COLOR: Record<string, string> = { war: '#b4473c', politics: '#4a6fa5', law: '#4a6fa5', economy: '#c9a227', migration: '#7a9a7e' }
const HIST_LABEL: Record<string, string> = { war: 'Guerres', politics: 'Politique', law: 'Lois et registres', economy: 'Économie', migration: 'Migrations' }
const REGION_LABEL: Record<string, string> = { FR: 'France', EU: 'Europe', IT: 'Italie', PL: 'Pologne', BE: 'Belgique', DE: 'Allemagne', LU: 'Luxembourg' }

function hex(c: string) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) }
function lerp(a: string, b: string, t: number) { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})` }
function genColor(gen: number | null, maxGen: number) {
  if (gen === null) return '#9aa1ad'
  const t = maxGen <= 0 ? 0 : Math.min(1, gen / maxGen)
  return t < 0.5 ? lerp('#0f1e3a', '#c9a227', t * 2) : lerp('#c9a227', '#7a9a7e', (t - 0.5) * 2)
}

interface Row { item: TimelineItem; y: number }
interface Group { gen: number | null; y: number; height: number; rows: Row[] }
interface Lane { ev: HistoricalEvent; lane: number }

export default function TimelinePage() {
  const nav = useNavigate()
  const [persons, setPersons] = useState<PersonSummary[]>([])
  const [rootId, setRootId] = useState('')
  const [allPersons, setAllPersons] = useState(false)
  const [showHist, setShowHist] = useState(true)
  const [data, setData] = useState<TimelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState({ w: 1200, h: 600 })
  const [ppy, setPpy] = useState(6) // pixels par année
  const [pan, setPan] = useState({ x: 20, y: 0 })
  const [tip, setTip] = useState<{ x: number; y: number; item: TimelineItem } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null)
  const lastMoved = useRef(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    api.persons(undefined, 2000).then((list) => { setPersons(list); setRootId((cur) => cur || (list.find((p) => p.is_root) ?? list[0])?.id || '') })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Impossible de charger les personnes.'))
  }, [])

  useEffect(() => {
    if (!rootId && !allPersons) { if (persons.length === 0) setLoading(false); return }
    let alive = true
    setLoading(true); setError(null)
    api.timeline(allPersons ? undefined : rootId, allPersons).then((d) => { if (alive) setData(d) })
      .catch((e: unknown) => { if (alive) setError(e instanceof ApiError ? e.message : 'Impossible de charger la chronologie.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [rootId, allPersons, persons.length])

  useEffect(() => {
    const el = boxRef.current; if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const minYear = data ? Math.floor((data.min_year - 10) / 10) * 10 : 1800
  const maxYear = data ? Math.ceil((data.max_year + 10) / 10) * 10 : 2030
  const span = Math.max(10, maxYear - minYear)

  const { groups, contentH, maxGen, lanes, laneCount } = useMemo(() => {
    const byGen = new Map<number | null, TimelineItem[]>()
    for (const it of data?.items ?? []) { const k = it.generation; const arr = byGen.get(k); if (arr) arr.push(it); else byGen.set(k, [it]) }
    const keys = [...byGen.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b))
    let y = 8
    const gs: Group[] = keys.map((gen) => {
      const items = byGen.get(gen) ?? []
      const rows: Row[] = items.map((item, i) => ({ item, y: y + GROUP_HEAD + i * ROW_H }))
      const height = GROUP_HEAD + items.length * ROW_H + 10
      const g = { gen, y, height, rows }
      y += height
      return g
    })
    const mg = Math.max(0, ...keys.filter((k): k is number => k !== null))
    // Lanes des événements historiques (évite le chevauchement des étiquettes)
    const evs = (showHist ? data?.historical_events ?? [] : []).slice().sort((a, b) => a.start - b.start)
    const laneEnd: number[] = []
    const ls: Lane[] = evs.map((ev) => {
      const w = ev.label.length * 6.2 + 12
      const x0 = (ev.start - minYear) * ppy, x1 = Math.max(x0 + w, (ev.end - minYear) * ppy)
      let lane = laneEnd.findIndex((e) => e <= x0)
      if (lane === -1) { lane = laneEnd.length; laneEnd.push(x1) } else laneEnd[lane] = x1
      return { ev, lane }
    })
    return { groups: gs, contentH: y + 8, maxGen: mg, lanes: ls, laneCount: Math.min(laneEnd.length, 5) }
  }, [data, showHist, minYear, ppy])

  const histH = showHist && lanes.length ? laneCount * LANE_H + 6 : 0
  const topY = AXIS_H + histH
  const viewH = Math.max(100, size.h - topY - AXIS_H)
  const xOf = useCallback((year: number) => GUTTER + pan.x + (year - minYear) * ppy, [pan.x, minYear, ppy])

  const clampPan = useCallback((p: { x: number; y: number }) => {
    const totalW = span * ppy
    const minX = Math.min(20, size.w - GUTTER - totalW - 20)
    const minY = Math.min(0, viewH - contentH)
    return { x: Math.max(minX, Math.min(20, p.x)), y: Math.max(minY, Math.min(0, p.y)) }
  }, [span, ppy, size.w, viewH, contentH])

  const fit = useCallback(() => {
    const avail = Math.max(200, size.w - GUTTER - 40)
    setPpy(Math.max(0.2, Math.min(60, avail / span))); setPan({ x: 20, y: 0 })
  }, [size.w, span])
  const fitRef = useRef(fit)
  useEffect(() => { fitRef.current = fit }, [fit])
  useEffect(() => { if (data) fitRef.current() }, [data])

  const zoomAt = useCallback((factor: number, cx: number) => {
    const next = Math.max(0.2, Math.min(80, ppy * factor))
    const year = minYear + (cx - GUTTER - pan.x) / ppy
    setPpy(next)
    setPan((p) => clampPan({ x: cx - GUTTER - (year - minYear) * next, y: p.y }))
  }, [ppy, minYear, pan.x, clampPan])

  useEffect(() => {
    const el = boxRef.current; if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left)
      else if (e.shiftKey) setPan((p) => clampPan({ x: p.x - e.deltaY, y: p.y }))
      else setPan((p) => clampPan({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, clampPan])

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false }; setDragging(true); e.currentTarget.setPointerCapture(e.pointerId) }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.moved) { setTip(null); setPan(clampPan({ x: d.px + dx, y: d.py + dy })) }
  }
  const onUp = () => { lastMoved.current = drag.current?.moved ?? false; drag.current = null; setDragging(false) }
  const openPerson = (id: string) => { if (!lastMoved.current) nav(`/personnes/${id}`) }

  // Graduations
  const ticks = useMemo(() => {
    const labelStep = ppy * 50 >= 44 ? 50 : ppy * 100 >= 44 ? 100 : 200
    const out: { year: number; major: boolean; label: boolean }[] = []
    const start = Math.floor(minYear / 10) * 10
    for (let yr = start; yr <= maxYear; yr += 10) out.push({ year: yr, major: yr % 50 === 0, label: yr % labelStep === 0 })
    return out
  }, [minYear, maxYear, ppy])
  const visibleTicks = ticks.filter((t) => { const x = xOf(t.year); return x >= GUTTER - 1 && x <= size.w + 1 })

  const axis = (y: number, flip: boolean) => (
    <g>
      <rect x={0} y={y} width={size.w} height={AXIS_H} fill="#fdfcf8" />
      <line x1={GUTTER} x2={size.w} y1={flip ? y : y + AXIS_H - 0.5} y2={flip ? y : y + AXIS_H - 0.5} stroke="#ddd5bd" />
      {visibleTicks.map((t) => { const x = xOf(t.year); const len = t.major ? 10 : 5; return (
        <g key={t.year}>
          <line x1={x} x2={x} y1={flip ? y : y + AXIS_H - len} y2={flip ? y + len : y + AXIS_H} stroke={t.major ? '#0f1e3a' : '#9aa1ad'} strokeWidth={t.major ? 1.2 : 1} />
          {t.label && <text x={x} y={flip ? y + 24 : y + AXIS_H - 14} textAnchor="middle" fontSize={11} fill="#0f1e3a" fontFamily="var(--font-sans)" className="tabular-nums">{t.year}</text>}
        </g>) })}
    </g>
  )

  const hasPersons = persons.length > 0
  return (
    <div className="flex h-[calc(100vh-110px)] min-h-[520px] flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-night-900">Chronologie</h1>
          <p className="text-sm text-mist-500">Chaque vie sur une frise commune, replacée dans son contexte historique. Molette : défilement · Ctrl + molette : zoom · glisser pour déplacer.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input !w-auto max-w-[260px] !py-1.5" value={rootId} disabled={allPersons} onChange={(e) => setRootId(e.target.value)} title="Personne de départ">
            {persons.map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.birth_year ? ` (${p.birth_year})` : ''}{p.is_root ? ' ★' : ''}</option>)}
          </select>
          <div className="flex overflow-hidden rounded-xl border border-ivory-300">
            <button className={`px-3 py-1.5 text-xs ${!allPersons ? 'bg-night-900 text-ivory-50' : 'bg-white text-night-900 hover:bg-ivory-100'}`} onClick={() => setAllPersons(false)}>Ascendance</button>
            <button className={`px-3 py-1.5 text-xs ${allPersons ? 'bg-night-900 text-ivory-50' : 'bg-white text-night-900 hover:bg-ivory-100'}`} onClick={() => setAllPersons(true)}>Toutes les personnes</button>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-night-900"><input type="checkbox" className="accent-gold-500" checked={showHist} onChange={(e) => setShowHist(e.target.checked)} /> Événements historiques</label>
          <div className="flex overflow-hidden rounded-xl border border-ivory-300">
            <button className="bg-white px-2.5 py-1.5 hover:bg-ivory-100" title="Zoom arrière" onClick={() => zoomAt(1 / 1.3, (size.w + GUTTER) / 2)}><Minus size={14} /></button>
            <button className="border-x border-ivory-300 bg-white px-2.5 py-1.5 hover:bg-ivory-100" title="Ajuster" onClick={fit}><Scan size={14} /></button>
            <button className="bg-white px-2.5 py-1.5 hover:bg-ivory-100" title="Zoom avant" onClick={() => zoomAt(1.3, (size.w + GUTTER) / 2)}><Plus size={14} /></button>
          </div>
        </div>
      </header>

      {error && <div className="rounded-xl border border-conf-red/30 bg-conf-red/8 px-4 py-2 text-sm text-conf-red">{error}</div>}

      <div ref={boxRef} className="panel relative min-h-0 flex-1 touch-none overflow-hidden select-none" style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { drag.current = null; setDragging(false); setTip(null) }}>
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-ivory-50/60"><span className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm shadow"><Spinner /> Construction de la frise…</span></div>}
        {!loading && !hasPersons && <div className="absolute inset-0 flex items-center justify-center p-8"><Empty>Aucune personne dans l'arbre : la chronologie se remplira dès que des dates seront connues.</Empty></div>}
        {!loading && hasPersons && data && data.items.length === 0 && <div className="absolute inset-0 flex items-center justify-center p-8"><Empty>Aucune date connue pour ces personnes. Ajoutez des événements datés (naissance, mariage, décès…) pour les voir apparaître.</Empty></div>}
        <svg width={size.w} height={size.h} className="block">
          <defs>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(15,30,58,0.35)" strokeWidth="2" /></pattern>
            <clipPath id="clip-content"><rect x={GUTTER} y={topY} width={Math.max(0, size.w - GUTTER)} height={viewH} /></clipPath>
            <clipPath id="clip-right"><rect x={GUTTER} y={0} width={Math.max(0, size.w - GUTTER)} height={size.h} /></clipPath>
            <clipPath id="clip-gutter"><rect x={0} y={topY} width={GUTTER} height={viewH} /></clipPath>
          </defs>
          <rect width={size.w} height={size.h} fill="#fdfcf8" />
          {/* Bandes historiques (fond translucide) */}
          <g clipPath="url(#clip-right)">
            {lanes.map(({ ev, lane }, i) => {
              const x0 = xOf(ev.start), x1 = Math.max(xOf(ev.end), x0 + 2); if (x1 < GUTTER || x0 > size.w) return null
              const c = HIST_COLOR[ev.kind] ?? '#9aa1ad'
              const lx = Math.max(x0 + 4, GUTTER + 6)
              return (
                <g key={i}>
                  <rect x={x0} y={AXIS_H} width={x1 - x0} height={size.h - 2 * AXIS_H} fill={c} opacity={0.12} />
                  {lane < laneCount && <text x={lx} y={AXIS_H + 6 + lane * LANE_H + 11} fontSize={10.5} fill={c} fontFamily="var(--font-sans)" fontWeight={600}><title>{ev.label} ({ev.start === ev.end ? ev.start : `${ev.start}–${ev.end}`}) · {REGION_LABEL[ev.region] ?? ev.region} · {HIST_LABEL[ev.kind] ?? ev.kind}</title>{ev.label}</text>}
                </g>)
            })}
            {visibleTicks.filter((t) => t.major).map((t) => <line key={t.year} x1={xOf(t.year)} x2={xOf(t.year)} y1={topY} y2={topY + viewH} stroke="#ece7d6" strokeWidth={1} />)}
          </g>
          {/* Contenu : personnes */}
          <g clipPath="url(#clip-content)">
            <g transform={`translate(0, ${topY + pan.y})`}>
              {groups.map((g, gi) => {
                if (g.y + g.height + pan.y < 0 || g.y + pan.y > viewH) return null
                return (
                  <g key={String(g.gen)}>
                    {gi % 2 === 1 && <rect x={GUTTER} y={g.y} width={size.w} height={g.height} fill="rgba(15,30,58,0.025)" />}
                    <line x1={GUTTER} x2={size.w} y1={g.y} y2={g.y} stroke="#ece7d6" />
                    {g.rows.map(({ item, y }) => {
                      if (y + pan.y < -ROW_H || y + pan.y > viewH + ROW_H) return null
                      const x0 = xOf(item.start), x1 = Math.max(xOf(item.end), x0 + 3)
                      if (x1 < GUTTER || x0 > size.w) return null
                      const color = genColor(item.generation, maxGen)
                      const label = `${item.display_name}  ${item.start}–${item.estimated ? '~' : ''}${item.end}`
                      const inside = x1 - x0 > label.length * 6.4 + 24
                      const by = y + (ROW_H - BAR_H) / 2
                      return (
                        <g key={item.id} className="cursor-pointer" onClick={() => openPerson(item.id)}
                          onMouseEnter={(e) => { if (!drag.current) setTip({ x: e.clientX, y: e.clientY, item }) }} onMouseMove={(e) => { if (!drag.current) setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : null)) }} onMouseLeave={() => setTip(null)}>
                          <rect x={x0} y={by} width={x1 - x0} height={BAR_H} rx={4} fill={color} opacity={item.estimated ? 0.55 : 0.9} stroke={color} strokeWidth={item.estimated ? 1 : 0} strokeDasharray={item.estimated ? '4 3' : undefined} />
                          {item.estimated && <rect x={Math.max(x0, x1 - Math.min(30, (x1 - x0) * 0.4))} y={by} width={Math.min(30, (x1 - x0) * 0.4)} height={BAR_H} rx={4} fill="url(#hatch)" />}
                          <circle cx={x0 - 7} cy={by + BAR_H / 2} r={3.5} fill={CONF_FILL[item.confidence]} stroke="#fdfcf8" strokeWidth={1} />
                          {item.events.map((ev, k) => (ev.year === null ? null : (
                            <g key={k} transform={`translate(${xOf(ev.year)}, ${by + BAR_H / 2}) rotate(45)`}>
                              <rect x={-3.5} y={-3.5} width={7} height={7} fill="#fdfcf8" stroke={color} strokeWidth={1.4} />
                              <title>{EVENT_LABEL[ev.type] ?? ev.type} · {ev.year}{ev.place ? ` · ${ev.place}` : ''}</title>
                            </g>)))}
                          <text x={inside ? x0 + 8 : x1 + 8} y={by + BAR_H / 2 + 3.5} fontSize={11} fontFamily="var(--font-sans)" fill={inside ? '#fdfcf8' : '#0f1e3a'} style={{ pointerEvents: 'none' }}>{label}</text>
                        </g>)
                    })}
                  </g>)
              })}
            </g>
          </g>
          {/* Gouttière gauche : générations */}
          <g clipPath="url(#clip-gutter)">
            <rect x={0} y={topY} width={GUTTER} height={viewH} fill="#f7f4ea" />
            <g transform={`translate(0, ${topY + pan.y})`}>
              {groups.map((g) => (
                <g key={String(g.gen)}>
                  <line x1={0} x2={GUTTER} y1={g.y} y2={g.y} stroke="#ddd5bd" />
                  <rect x={0} y={g.y + 8} width={4} height={GROUP_HEAD - 10} rx={2} fill={genColor(g.gen, maxGen)} />
                  <text x={14} y={g.y + 21} fontSize={13} fontFamily="var(--font-display)" fontWeight={600} fill="#0f1e3a">{g.gen === null ? 'Hors ascendance' : `Génération ${g.gen}`}</text>
                  <text x={14} y={g.y + 21 + 14} fontSize={10} fontFamily="var(--font-sans)" fill="#6b7280">{g.gen === 0 ? 'personne de départ' : g.gen === 1 ? 'parents' : g.gen === 2 ? 'grands-parents' : `${g.rows.length} personne${g.rows.length > 1 ? 's' : ''}`}</text>
                </g>))}
            </g>
            <line x1={GUTTER - 0.5} x2={GUTTER - 0.5} y1={topY} y2={topY + viewH} stroke="#ddd5bd" />
          </g>
          {axis(0, true)}
          {histH > 0 && <rect x={0} y={AXIS_H} width={GUTTER} height={histH} fill="#fdfcf8" />}
          {histH > 0 && <text x={12} y={AXIS_H + 16} fontSize={10} fontFamily="var(--font-sans)" fill="#6b7280" fontWeight={600}>CONTEXTE HISTORIQUE</text>}
          {axis(size.h - AXIS_H, false)}
        </svg>
        {tip && (
          <div className="pointer-events-none fixed z-50 max-w-xs rounded-xl border border-ivory-300 bg-white/95 px-3 py-2 text-xs shadow-xl" style={{ left: tip.x + 14, top: tip.y + 14 }}>
            <div className="font-display text-base text-night-900">{tip.item.display_name}</div>
            <div className="text-mist-500">{tip.item.birth_display ?? tip.item.start} – {tip.item.death_display ?? (tip.item.estimated ? `≈ ${tip.item.end} (estimé)` : tip.item.end)}{tip.item.generation !== null ? ` · génération ${tip.item.generation}` : ''}</div>
            {tip.item.events.length > 0 && <ul className="mt-1 space-y-0.5">{tip.item.events.slice(0, 8).map((ev, i) => <li key={i}><span className="font-medium">{EVENT_LABEL[ev.type] ?? ev.type}</span> {ev.year ?? '?'}{ev.place ? ` · ${ev.place}` : ''}</li>)}{tip.item.events.length > 8 && <li className="text-mist-500">… et {tip.item.events.length - 8} autre(s)</li>}</ul>}
            <div className="mt-1 text-[10px] text-mist-400">Cliquer pour ouvrir la fiche</div>
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-mist-500">
        <span className="font-semibold uppercase tracking-wide text-night-900">Faits familiaux</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-6 rounded" style={{ background: 'linear-gradient(90deg,#0f1e3a,#c9a227,#7a9a7e)' }} /> couleur = génération (proche → lointaine)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-6 rounded border border-dashed border-night-900 bg-night-900/40" /> fin estimée</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 border border-night-900 bg-white" /> événement daté</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full dot-green" /> fiabilité de la personne</span>
        <span className="ml-2 font-semibold uppercase tracking-wide text-night-900">Contexte historique (bandes)</span>
        {Object.entries(HIST_LABEL).filter(([k]) => k !== 'law').map(([k, l]) => <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm" style={{ background: HIST_COLOR[k], opacity: 0.35 }} /> {k === 'politics' ? 'Politique et lois' : l}</span>)}
      </footer>
    </div>
  )
}
