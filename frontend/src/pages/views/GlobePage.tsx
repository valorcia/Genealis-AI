import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react'
import { Link } from 'react-router-dom'
import { geoDistance, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { Globe2, LocateFixed, MapPin, Minus, Pause, Play, Plus, X } from 'lucide-react'
import { api, type MapData } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import { CAT_COLOR, EVENT_CATS, catOf, type EventCat as Cat } from '../../components/views/eventCats'
import { COLORS, Card, EmptyState, ErrorState, LoadingState, Toggle, eventLabel, shortPlace, useLoader } from '../../components/views/common'

const C = COLORS.vues

type Topo = Topology<{ countries: GeometryCollection; land: GeometryCollection }>
interface World { land: GeoPermissibleObjects; borders: GeoPermissibleObjects }

function centroid(points: { lat: number; lon: number }[]): [number, number] {
  if (!points.length) return [2.35, 46.6]
  let x = 0, y = 0, z = 0
  for (const p of points) {
    const la = (p.lat * Math.PI) / 180, lo = (p.lon * Math.PI) / 180
    x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la)
  }
  return [(Math.atan2(y, x) * 180) / Math.PI, (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI]
}

export default function GlobePage() {
  const { persons, focusId, setFocusId } = useFocusPerson()
  const { data, loading, error, reload } = useLoader<MapData>(() => api.map(), [])
  const [world, setWorld] = useState<World | null>(null)
  const [worldError, setWorldError] = useState(false)
  const [active, setActive] = useState<Set<Cat>>(new Set(EVENT_CATS.map((c) => c.id)))
  const [showMoves, setShowMoves] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [auto, setAuto] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    import('world-atlas/countries-110m.json').then((m) => {
      const topo = (m.default ?? m) as unknown as Topo
      if (!alive) return
      setWorld({ land: feature(topo, topo.objects.land), borders: mesh(topo, topo.objects.countries, (a, b) => a !== b) })
    }).catch(() => setWorldError(true))
    return () => { alive = false }
  }, [])

  const points = useMemo(() => (data?.points ?? []).map((p) => {
    const evs = p.events.filter((e) => active.has(catOf(e.type)))
    const counts = new Map<Cat, number>()
    evs.forEach((e) => counts.set(catOf(e.type), (counts.get(catOf(e.type)) ?? 0) + 1))
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'autres'
    return { ...p, evs, color: CAT_COLOR[dominant] }
  }).filter((p) => p.evs.length > 0), [data, active])
  const maxCount = Math.max(1, ...points.map((p) => p.evs.length))
  const moves = useMemo(() => (data?.moves ?? []).filter((m) => [m.from_lat, m.from_lon, m.to_lat, m.to_lon].every((v) => typeof v === 'number')), [data])

  // --- Rendu canvas ---
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const view = useRef({ lambda: -2.35, phi: -46.6, zoom: 1, vx: 0, vy: 0, dragging: false, moved: false, lastX: 0, lastY: 0, startX: 0, startY: 0, pinch: 0, w: 0, h: 0, t: 0 })
  const autoRef = useRef(auto)
  useEffect(() => { autoRef.current = auto }, [auto])
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const state = useRef({ points, moves, world, showMoves, showLabels, selected, maxCount })
  state.current = { points, moves, world, showMoves, showLabels, selected, maxCount }

  const recenter = useCallback(() => {
    const [lo, la] = centroid(data?.points ?? [])
    view.current.lambda = -lo; view.current.phi = -la; view.current.zoom = (data?.points.length ?? 0) > 0 ? 1.25 : 1
  }, [data])
  useEffect(() => { recenter() }, [recenter])

  const projection = useCallback(() => {
    const v = view.current
    const r = (Math.min(v.w, v.h) / 2 - 18) * v.zoom
    return geoOrthographic().rotate([v.lambda, v.phi]).translate([v.w / 2, v.h / 2]).scale(r).clipAngle(90).precision(0.4)
  }, [])

  const draw = useCallback(() => {
    const cv = canvas.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const v = view.current, s = state.current
    if (v.w < 40 || v.h < 40) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, v.w, v.h)
    const proj = projection()
    const path = geoPath(proj, ctx)
    const [cx, cy] = proj.translate(), r = proj.scale()

    // Halo d'atmosphère
    const halo = ctx.createRadialGradient(cx, cy, r * 0.95, cx, cy, r * 1.12)
    halo.addColorStop(0, 'rgba(110,180,255,0.45)'); halo.addColorStop(1, 'rgba(110,180,255,0)')
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2); ctx.fill()
    // Océan
    const ocean = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r)
    ocean.addColorStop(0, '#a9dcfb'); ocean.addColorStop(0.55, '#4f9fe0'); ocean.addColorStop(1, '#1d5aa3')
    ctx.fillStyle = ocean; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
    // Graticule
    ctx.beginPath(); path(geoGraticule10()); ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.6; ctx.stroke()
    // Terres
    if (s.world) {
      ctx.beginPath(); path(s.world.land)
      const land = ctx.createLinearGradient(cx, cy - r, cx, cy + r)
      land.addColorStop(0, '#f3f8e8'); land.addColorStop(1, '#d6e8c4')
      ctx.fillStyle = land; ctx.fill()
      ctx.strokeStyle = 'rgba(70,110,60,0.35)'; ctx.lineWidth = 0.7; ctx.stroke()
      ctx.beginPath(); path(s.world.borders); ctx.strokeStyle = 'rgba(90,120,80,0.45)'; ctx.lineWidth = 0.5; ctx.stroke()
    }
    // Ombrage sphérique
    const shade = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.05, cx, cy, r)
    shade.addColorStop(0, 'rgba(255,255,255,0.28)'); shade.addColorStop(0.5, 'rgba(255,255,255,0)'); shade.addColorStop(1, 'rgba(0,25,70,0.32)')
    ctx.fillStyle = shade; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()

    const center: [number, number] = [-v.lambda, -v.phi]
    // Migrations (grands cercles animés, coupés à l'horizon)
    if (s.showMoves) {
      ctx.save()
      ctx.setLineDash([7, 6]); ctx.lineDashOffset = -v.t * 0.04; ctx.lineCap = 'round'
      for (const m of s.moves) {
        ctx.beginPath(); path({ type: 'LineString', coordinates: [[m.from_lon, m.from_lat], [m.to_lon, m.to_lat]] })
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 4; ctx.stroke()
        ctx.strokeStyle = '#f0662d'; ctx.lineWidth = 2.2; ctx.stroke()
      }
      ctx.restore()
      for (const m of s.moves) {
        if (geoDistance([m.to_lon, m.to_lat], center) > Math.PI / 2 - 0.02) continue
        const p = proj([m.to_lon, m.to_lat]); if (!p) continue
        ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, Math.PI * 2); ctx.fillStyle = '#f0662d'; ctx.fill()
      }
    }
    // Lieux
    const visible: { x: number; y: number; rad: number; p: (typeof s.points)[number] }[] = []
    for (const p of s.points) {
      if (geoDistance([p.lon, p.lat], center) > Math.PI / 2 - 0.02) continue
      const xy = proj([p.lon, p.lat]); if (!xy) continue
      const rad = (4 + Math.sqrt(p.evs.length / s.maxCount) * 11) * Math.min(1.6, Math.max(0.8, Math.sqrt(v.zoom) * 0.8))
      visible.push({ x: xy[0], y: xy[1], rad, p })
    }
    visible.sort((a, b) => b.rad - a.rad)
    for (const { x, y, rad, p } of visible) {
      ctx.save()
      ctx.shadowColor = p.color; ctx.shadowBlur = 10
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = p.color + 'dd'; ctx.fill()
      ctx.restore()
      ctx.lineWidth = p.place_id === s.selected ? 3 : 1.6; ctx.strokeStyle = p.place_id === s.selected ? '#fff200' : '#ffffff'
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke()
      if (p.evs.length > 1 && rad >= 9) {
        ctx.fillStyle = '#fff'; ctx.font = `600 ${Math.round(rad * 0.9)}px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(String(p.evs.length), x, y + 0.5)
      }
    }
    if (s.showLabels) {
      const labelled = visible.slice(0, v.zoom > 3 ? 14 : 6)
      if (s.selected && !labelled.some((l) => l.p.place_id === s.selected)) { const sel = visible.find((l) => l.p.place_id === s.selected); if (sel) labelled.push(sel) }
      ctx.font = '600 12px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      const boxes: [number, number, number, number][] = []
      for (const { x, y, rad, p } of labelled) {
        const t = shortPlace(p.name)
        const w = ctx.measureText(t).width, bx = x + rad + 4, by = y - 8
        if (boxes.some(([x0, y0, x1, y1]) => bx < x1 && bx + w > x0 && by < y1 && by + 16 > y0)) continue
        boxes.push([bx, by, bx + w, by + 16])
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.strokeText(t, x + rad + 4, y)
        ctx.fillStyle = '#16304a'; ctx.fillText(t, x + rad + 4, y)
      }
    }
    hits.current = visible
  }, [projection])
  const hits = useRef<{ x: number; y: number; rad: number; p: { place_id: string } }[]>([])

  useEffect(() => {
    const el = wrap.current, cv = canvas.current
    if (!el || !cv) return
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      view.current.w = el.clientWidth; view.current.h = el.clientHeight
      cv.width = el.clientWidth * dpr; cv.height = el.clientHeight * dpr
      cv.style.width = `${el.clientWidth}px`; cv.style.height = `${el.clientHeight}px`
      draw()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [draw, data])

  useEffect(() => {
    let raf = 0
    const loop = (t: number) => {
      const v = view.current
      v.t = t
      if (!v.dragging) {
        if (Math.abs(v.vx) > 0.01 || Math.abs(v.vy) > 0.01) { v.lambda += v.vx; v.phi = Math.max(-89, Math.min(89, v.phi + v.vy)); v.vx *= 0.93; v.vy *= 0.93 }
        else if (autoRef.current) v.lambda += 0.08
      }
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  const degPerPx = () => 57.3 / ((Math.min(view.current.w, view.current.h) / 2 - 18) * view.current.zoom)
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const v = view.current
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (v.pinch) v.zoom = Math.max(0.7, Math.min(14, v.zoom * (d / v.pinch)))
        v.pinch = d; v.moved = true
        return
      }
      const dx = e.clientX - v.lastX, dy = e.clientY - v.lastY
      v.lastX = e.clientX; v.lastY = e.clientY
      if (Math.hypot(e.clientX - v.startX, e.clientY - v.startY) > 5) v.moved = true
      const k = degPerPx()
      v.lambda += dx * k; v.phi = Math.max(-89, Math.min(89, v.phi - dy * k))
      v.vx = dx * k; v.vy = -dy * k
    }
    const up = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.delete(e.pointerId)
      const v = view.current
      if (pointers.current.size < 2) v.pinch = 0
      if (pointers.current.size === 0) {
        v.dragging = false
        if (!v.moved) {
          const rect = canvas.current?.getBoundingClientRect()
          if (rect) {
            const x = e.clientX - rect.left, y = e.clientY - rect.top
            const hit = hits.current.slice().reverse().find((h) => Math.hypot(h.x - x, h.y - y) <= Math.max(h.rad + 4, 14))
            setSelected(hit ? hit.p.place_id : null)
            if (hit) setAuto(false)
          }
        }
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [])

  const onDown = (e: RPointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const v = view.current
    v.dragging = true; v.moved = false; v.vx = 0; v.vy = 0
    v.lastX = v.startX = e.clientX; v.lastY = v.startY = e.clientY
  }
  const onWheel = (e: RWheelEvent) => { const v = view.current; v.zoom = Math.max(0.7, Math.min(14, v.zoom * Math.exp(-e.deltaY * 0.0015))) }
  const zoom = (f: number) => { const v = view.current; v.zoom = Math.max(0.7, Math.min(14, v.zoom * f)) }

  const sel = points.find((p) => p.place_id === selected) ?? null
  const totalEvents = points.reduce((s, p) => s + p.evs.length, 0)
  const toggleCat = (c: Cat) => setActive((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n.size ? n : new Set(EVENT_CATS.map((x) => x.id)) })

  const help = (
    <div className="space-y-2">
      <p className="font-semibold" style={{ color: C }}>Globe virtuel</p>
      <p>Chaque bulle est un lieu où un événement familial est daté : sa taille dépend du nombre d’événements, sa couleur du type d’événement le plus fréquent.</p>
      <p>Les arcs orange animés relient les lieux successifs d’une même personne (trajets de vie). Faites glisser pour tourner le globe, pincez pour zoomer, touchez une bulle pour voir qui y a vécu.</p>
      <p className="text-mist-500">Le globe est dessiné hors ligne : aucune connexion n’est nécessaire.</p>
    </div>
  )
  const options = (
    <div className="space-y-1">
      <Toggle checked={auto} onChange={setAuto} label="Rotation automatique" color={C} />
      <Toggle checked={showMoves} onChange={setShowMoves} label="Trajets de vie (arcs)" color={C} />
      <Toggle checked={showLabels} onChange={setShowLabels} label="Noms des lieux" color={C} />
    </div>
  )

  return (
    <ChartFrame title="Globe virtuel" subtitle={data ? `${points.length} lieux · ${totalEvents} événements · ${moves.length} trajets` : undefined} color={C} help={help} persons={persons} focusId={focusId} onFocus={setFocusId} options={options}>
      {loading && <LoadingState label="Chargement des lieux…" color={C} />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className="space-y-3">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {EVENT_CATS.map((c) => {
              const on = active.has(c.id)
              return (
                <button key={c.id} onClick={() => toggleCat(c.id)} className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm ring-1 transition ${on ? 'bg-white ring-black/5' : 'bg-white/40 text-mist-400 ring-transparent'}`}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? c.color : '#cfd3da' }} />{c.label}
                </button>
              )
            })}
            {showMoves && moves.length > 0 && <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium shadow-sm ring-1 ring-black/5"><span className="h-0.5 w-4 rounded" style={{ background: 'repeating-linear-gradient(90deg,#f0662d 0 4px,transparent 4px 7px)' }} />Trajets de vie</span>}
          </div>
          <div ref={wrap} onPointerDown={onDown} onWheel={onWheel}
            className="relative h-[calc(100dvh-245px)] min-h-[380px] touch-none select-none overflow-hidden rounded-[26px]"
            style={{ background: 'radial-gradient(110% 90% at 50% 40%, #f7fbff 0%, #e2f1fb 50%, #cfe6f4 100%)', cursor: 'grab' }}>
            <canvas ref={canvas} className="absolute inset-0" />
            {data.points.length === 0 && (
              <div className="absolute inset-x-4 top-4"><EmptyState icon={<MapPin size={26} />} color={C} title="Aucun lieu localisé">Ajoutez des lieux aux événements (naissance, mariage, décès…). Les lieux connus sont placés automatiquement ; les autres peuvent être géocodés depuis la Carte familiale.</EmptyState></div>
            )}
            {worldError && <div className="absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-white/90 px-3 py-1 text-xs text-conf-red shadow">Fond du globe indisponible</div>}
            <div className="absolute right-3 top-3 flex flex-col gap-2" onPointerDown={(e) => e.stopPropagation()}>
              {[
                { icon: <Plus size={18} />, label: 'Zoomer', on: () => zoom(1.4) },
                { icon: <Minus size={18} />, label: 'Dézoomer', on: () => zoom(1 / 1.4) },
                { icon: <LocateFixed size={17} />, label: 'Recentrer sur la famille', on: recenter },
                { icon: auto ? <Pause size={16} /> : <Play size={16} />, label: auto ? 'Arrêter la rotation' : 'Rotation automatique', on: () => setAuto((a) => !a) },
              ].map((b) => <button key={b.label} onClick={b.on} title={b.label} aria-label={b.label} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-md backdrop-blur" style={{ color: C }}>{b.icon}</button>)}
            </div>
            {data.unlocated_places.length > 0 && (
              <Link to="/listes/lieux" onPointerDown={(e) => e.stopPropagation()} className="absolute bottom-3 left-3 rounded-full bg-white/85 px-3 py-1.5 text-[11px] font-medium text-mist-500 shadow backdrop-blur">
                {data.unlocated_places.length} lieu{data.unlocated_places.length > 1 ? 'x' : ''} sans coordonnées
              </Link>
            )}
            {sel && (
              <div className="absolute inset-x-3 bottom-3 mx-auto max-w-md" onPointerDown={(e) => e.stopPropagation()}>
                <Card className="max-h-[42vh] overflow-auto p-4">
                  <div className="mb-2 flex items-start gap-2">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: sel.color }} />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-bold text-night-900">{sel.name}</h3>
                      <p className="text-xs text-mist-500">{sel.evs.length} événement{sel.evs.length > 1 ? 's' : ''} · {sel.lat.toFixed(3)}°, {sel.lon.toFixed(3)}°</p>
                    </div>
                    <button onClick={() => setSelected(null)} className="rounded-full bg-black/5 p-1 text-mist-500" aria-label="Fermer"><X size={14} /></button>
                  </div>
                  <ul className="divide-y divide-black/5">
                    {sel.evs.slice().sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999)).map((e, i) => (
                      <li key={i} className="flex items-center gap-2 py-2 text-sm">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CAT_COLOR[catOf(e.type)] }} />
                        <span className="w-12 shrink-0 tabular-nums text-mist-500">{e.year ?? '—'}</span>
                        <span className="w-24 shrink-0 truncate text-mist-500">{eventLabel(e.type)}</span>
                        <Link to={`/personnes/${e.person_id}`} className="min-w-0 flex-1 truncate font-medium" style={{ color: C }}>{e.person}</Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            )}
          </div>
          {!world && !worldError && <p className="text-center text-xs text-mist-500"><Globe2 size={12} className="mr-1 inline" />Chargement des continents…</p>}
        </div>
      )}
    </ChartFrame>
  )
}
