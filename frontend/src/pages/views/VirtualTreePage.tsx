import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react'
import { Link } from 'react-router-dom'
import { Box, Maximize, Minus, Pause, Play, Plus, X } from 'lucide-react'
import { api, type TreeEdge, type TreeGraph, type TreeNode } from '../../api'
import ChartFrame from '../../components/shell/ChartFrame'
import { useFocusPerson } from '../../components/shell/useFocusPerson'
import { COLORS, EmptyState, ErrorState, LoadingState, SEX_GRADIENT, Segmented, Toggle, sexKey, useLoader } from '../../components/views/common'
import { PersonFactsCard, generationName } from '../../components/views/people'
import { computeSosa } from '../../components/views/sosa'

const C = COLORS.vues
const LEVEL_GAP = 210
const CARD_W = 104
const MAX_NODES = 300
const PERSPECTIVE = 1500

interface Placed { n: TreeNode; level: number; x: number; y: number; z: number }
interface Level { level: number; radius: number; count: number; y: number }
interface Scene { placed: Placed[]; levels: Level[]; links: { id: string; a: Placed; b: Placed }[]; truncated: number; maxR: number; minLevel: number; maxLevel: number }

/** Écarte les angles trop proches sur un anneau (sans perdre l'ordre généalogique). */
function relax(items: { angle: number }[], minGap: number) {
  if (items.length < 2) return
  items.sort((a, b) => a.angle - b.angle)
  if (minGap * items.length >= Math.PI * 2) { items.forEach((it, i) => { it.angle = -Math.PI + (i + 0.5) * (Math.PI * 2 / items.length) }); return }
  for (let pass = 0; pass < 40; pass++) {
    let moved = false
    for (let i = 1; i < items.length; i++) {
      const gap = items[i].angle - items[i - 1].angle
      if (gap < minGap) { const push = (minGap - gap) / 2; items[i - 1].angle -= push; items[i].angle += push; moved = true }
    }
    const wrap = items[0].angle + Math.PI * 2 - items[items.length - 1].angle
    if (wrap < minGap) { const push = (minGap - wrap) / 2; items[0].angle += push; items[items.length - 1].angle -= push; moved = true }
    if (!moved) break
  }
}

function buildScene(anc: TreeGraph | null, desc: TreeGraph | null): Scene {
  const sosa = anc ? computeSosa(anc) : new Map<string, number[]>()
  const levelOf = new Map<string, number>()
  const nodes = new Map<string, TreeNode>()
  for (const n of anc?.nodes ?? []) { nodes.set(n.id, n); levelOf.set(n.id, n.generation) }
  for (const n of desc?.nodes ?? []) if (!nodes.has(n.id)) { nodes.set(n.id, n); levelOf.set(n.id, -n.generation) }
  // Limite de fluidité : on retire les générations les plus éloignées.
  let truncated = 0
  while (nodes.size > MAX_NODES) {
    const far = Math.max(...[...levelOf.values()].map(Math.abs))
    for (const [id, l] of levelOf) if (Math.abs(l) === far) { levelOf.delete(id); nodes.delete(id); truncated++ }
  }
  const edges: TreeEdge[] = [...(anc?.edges ?? []), ...(desc?.edges ?? [])]
  const seen = new Set<string>()
  const childrenOf = new Map<string, string[]>()
  for (const e of edges) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, [])
    childrenOf.get(e.source)!.push(e.target)
  }

  const byLevel = new Map<number, { n: TreeNode; angle: number }[]>()
  const push = (l: number, n: TreeNode, angle: number) => { if (!byLevel.has(l)) byLevel.set(l, []); byLevel.get(l)!.push({ n, angle }) }

  // Ascendants : angle donné par le numéro Sosa (moitié paternelle / moitié maternelle).
  for (const [id, n] of nodes) {
    const l = levelOf.get(id)!
    if (l <= 0) continue
    const own = sosa.get(id)
    const s = Math.min(...(own?.length ? own : [2 ** l]))
    const idx = s - 2 ** l
    push(l, n, ((idx + 0.5) / 2 ** l) * Math.PI * 2 - Math.PI)
  }
  // Descendants : disposition radiale pondérée par le nombre de feuilles de chaque branche.
  const root = [...nodes.values()].find((n) => levelOf.get(n.id) === 0)
  if (root) {
    push(0, root, 0)
    const leaves = new Map<string, number>()
    const countLeaves = (id: string, depth: number): number => {
      const kids = (childrenOf.get(id) ?? []).filter((k) => levelOf.get(k) === -(depth + 1))
      const v = kids.length ? kids.reduce((s, k) => s + countLeaves(k, depth + 1), 0) : 1
      leaves.set(id, v)
      return v
    }
    countLeaves(root.id, 0)
    const assign = (id: string, depth: number, a0: number, a1: number) => {
      const kids = (childrenOf.get(id) ?? []).filter((k) => levelOf.get(k) === -(depth + 1))
        .sort((x, y) => (nodes.get(x)?.birth_year ?? 9999) - (nodes.get(y)?.birth_year ?? 9999))
      const total = kids.reduce((s, k) => s + (leaves.get(k) ?? 1), 0)
      let cur = a0
      for (const k of kids) {
        const span = ((a1 - a0) * (leaves.get(k) ?? 1)) / total
        push(-(depth + 1), nodes.get(k)!, cur + span / 2)
        assign(k, depth + 1, cur, cur + span)
        cur += span
      }
    }
    assign(root.id, 0, -Math.PI, Math.PI)
  }

  const placedById = new Map<string, Placed>()
  const levels: Level[] = []
  let maxR = 0
  for (const [l, items] of byLevel) {
    const a = Math.abs(l)
    let radius = l === 0 && items.length === 1 ? 0 : Math.max(120 + (a - 1) * (l > 0 ? 78 : 64), (items.length * (CARD_W + 12)) / (Math.PI * 2))
    if (items.length > 1 && radius < 130) radius = 130
    relax(items, radius ? (CARD_W + 8) / radius : 0)
    const y = -l * LEVEL_GAP
    for (const it of items) {
      const p: Placed = { n: it.n, level: l, x: Math.sin(it.angle) * radius, y, z: -Math.cos(it.angle) * radius }
      placedById.set(it.n.id, p)
    }
    levels.push({ level: l, radius, count: items.length, y })
    maxR = Math.max(maxR, radius)
  }
  levels.sort((a, b) => b.level - a.level)
  const links: Scene['links'] = []
  const seenL = new Set<string>()
  for (const e of edges) {
    const a = placedById.get(e.source), b = placedById.get(e.target)
    if (!a || !b || a.level === b.level || seenL.has(e.id)) continue
    seenL.add(e.id)
    links.push({ id: e.id, a, b })
  }
  const lv = levels.map((l) => l.level)
  return { placed: [...placedById.values()], levels, links, truncated, maxR, minLevel: Math.min(0, ...lv), maxLevel: Math.max(0, ...lv) }
}

/** Segment lumineux entre deux points 3D (ruban en croix pour rester visible sous tous les angles). */
function Link3D({ a, b, glow }: { a: [number, number, number]; b: [number, number, number]; glow: string }) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
  const h = Math.hypot(dx, dz)
  const len = Math.hypot(dx, dy, dz)
  const th = Math.atan2(-dz, dx), ph = Math.atan2(dy, h)
  const ribbon: CSSProperties = { position: 'absolute', inset: 0, borderRadius: 3, background: `linear-gradient(90deg, ${glow}, ${glow}99)`, boxShadow: `0 0 8px ${glow}` }
  return (
    <div className="pointer-events-none absolute left-0 top-0" style={{ width: len, height: 3, marginTop: -1.5, transformOrigin: '0 50%', transformStyle: 'preserve-3d', transform: `translate3d(${a[0]}px,${a[1]}px,${a[2]}px) rotateY(${th}rad) rotateZ(${ph}rad)` }}>
      <div style={ribbon} />
      <div style={{ ...ribbon, transform: 'rotateX(90deg)' }} />
    </div>
  )
}

export default function VirtualTreePage() {
  const { persons, focusId, setFocusId, loading: loadingPersons } = useFocusPerson()
  const [ancGens, setAncGens] = useState(5)
  const [descGens, setDescGens] = useState(2)
  const [auto, setAuto] = useState(true)
  const [showLinks, setShowLinks] = useState(true)
  const [night, setNight] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const { data, loading, error, reload } = useLoader(
    () => Promise.all([api.ancestors(focusId ?? undefined, ancGens), descGens > 0 ? api.descendants(focusId ?? undefined, descGens) : Promise.resolve(null)]),
    [focusId, ancGens, descGens], !!focusId,
  )
  const scene = useMemo(() => (data ? buildScene(data[0], data[1]) : null), [data])

  // --- Caméra (manipulée hors React pour rester fluide) ---
  const viewport = useRef<HTMLDivElement>(null)
  const camera = useRef<HTMLDivElement>(null)
  const cam = useRef({ rx: 14, ry: -20, scale: 0.6, vel: 0, dragging: false, moved: false, lastX: 0, lastY: 0, startX: 0, startY: 0, pinch: 0 })
  const autoRef = useRef(auto)
  useEffect(() => { autoRef.current = auto }, [auto])
  const pointers = useRef(new Map<number, { x: number; y: number }>())

  const centerY = scene ? (-scene.maxLevel * LEVEL_GAP - 110 - scene.minLevel * LEVEL_GAP) / 2 : 0
  const apply = useCallback(() => {
    const el = camera.current
    if (!el) return
    const c = cam.current
    el.style.transform = `scale3d(${c.scale},${c.scale},${c.scale}) rotateX(${c.rx}deg) rotateY(${c.ry}deg) translateY(${-centerY}px)`
    el.style.setProperty('--ry', `${c.ry}deg`)
  }, [centerY])

  const fit = useCallback(() => {
    const v = viewport.current
    if (!v || !scene) return
    const w = v.clientWidth, h = v.clientHeight
    const treeW = scene.maxR * 2 + CARD_W * 1.6
    const treeH = (scene.maxLevel - scene.minLevel) * LEVEL_GAP + 420
    cam.current.scale = Math.max(0.18, Math.min(1.25, Math.min(w / (treeW * (w < 640 ? 0.7 : 1)), h / treeH) * 0.92))
    apply()
  }, [scene, apply])
  useEffect(() => { fit() }, [fit])
  useEffect(() => { const on = () => fit(); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [fit])

  useEffect(() => {
    let raf = 0
    const loop = () => {
      const c = cam.current
      if (!c.dragging) {
        if (Math.abs(c.vel) > 0.01) { c.ry += c.vel; c.vel *= 0.94; apply() }
        else if (autoRef.current) { c.ry += 0.09; apply() }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [apply])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const c = cam.current
      if (pointers.current.size === 2) {
        const [p1, p2] = [...pointers.current.values()]
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y)
        if (c.pinch) { c.scale = Math.max(0.12, Math.min(2.5, c.scale * (d / c.pinch))); apply() }
        c.pinch = d; c.moved = true
        return
      }
      const dx = e.clientX - c.lastX, dy = e.clientY - c.lastY
      c.lastX = e.clientX; c.lastY = e.clientY
      if (Math.hypot(e.clientX - c.startX, e.clientY - c.startY) > 6) c.moved = true
      c.ry += dx * 0.35
      c.vel = dx * 0.35
      c.rx = Math.max(-12, Math.min(55, c.rx - dy * 0.25))
      apply()
    }
    const up = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size < 2) cam.current.pinch = 0
      if (pointers.current.size === 0) cam.current.dragging = false
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [apply])

  const onDown = (e: RPointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const c = cam.current
    c.dragging = true; c.moved = false; c.vel = 0
    c.lastX = c.startX = e.clientX; c.lastY = c.startY = e.clientY
  }
  const onWheel = (e: RWheelEvent) => { const c = cam.current; c.scale = Math.max(0.12, Math.min(2.5, c.scale * Math.exp(-e.deltaY * 0.0012))); apply() }
  const zoom = (f: number) => { const c = cam.current; c.scale = Math.max(0.12, Math.min(2.5, c.scale * f)); apply() }

  const sel = scene?.placed.find((p) => p.n.id === selected)?.n ?? null
  const theme = night
    ? { bg: 'radial-gradient(120% 80% at 50% 10%, #1d3b4a 0%, #0c1a26 55%, #050b12 100%)', disc: 'radial-gradient(circle, rgba(140,255,190,0.22) 0%, rgba(60,200,120,0.10) 60%, rgba(60,200,120,0.02) 100%)', ring: 'rgba(120,255,180,0.45)', glow: '#7dffb0', label: 'rgba(255,255,255,0.92)', sub: 'rgba(220,255,235,0.7)' }
    : { bg: 'radial-gradient(120% 90% at 50% 0%, #ffffff 0%, #e6f6ea 45%, #c9ead4 100%)', disc: 'radial-gradient(circle, rgba(255,255,255,0.75) 0%, rgba(46,154,82,0.16) 62%, rgba(46,154,82,0.04) 100%)', ring: 'rgba(46,154,82,0.38)', glow: '#38b864', label: '#14301e', sub: '#4d6b57' }

  const help = (
    <div className="space-y-2">
      <p className="font-semibold" style={{ color: C }}>Arbre virtuel</p>
      <p>Chaque génération flotte sur son propre plateau : les ancêtres au-dessus, les descendants en dessous de la personne centrale.</p>
      <p>Faites glisser pour tourner autour de l’arbre (un doigt), pincez ou utilisez la molette pour zoomer. Touchez une personne pour afficher sa carte.</p>
    </div>
  )
  const options = (
    <div className="space-y-3 text-sm">
      <div><span className="label">Générations d’ancêtres</span><Segmented value={String(ancGens)} onChange={(v) => setAncGens(Number(v))} color={C} options={[2, 3, 4, 5, 6, 7].map((n) => ({ id: String(n), label: n }))} /></div>
      <div><span className="label">Générations de descendants</span><Segmented value={String(descGens)} onChange={(v) => setDescGens(Number(v))} color={C} options={[0, 1, 2, 3, 4].map((n) => ({ id: String(n), label: n }))} /></div>
      <Toggle checked={auto} onChange={setAuto} label="Rotation automatique" color={C} />
      <Toggle checked={showLinks} onChange={setShowLinks} label="Liens lumineux" color={C} />
    </div>
  )
  const styleOptions = <Toggle checked={night} onChange={setNight} label="Ambiance nocturne" color={C} />

  return (
    <ChartFrame title="Arbre virtuel" subtitle={persons.find((p) => p.id === focusId)?.display_name} color={C} help={help} persons={persons} focusId={focusId} onFocus={(id) => { setFocusId(id); setSelected(null) }} options={options} styleOptions={styleOptions}>
      {(loadingPersons || (loading && !scene)) && <LoadingState label="Construction de l’arbre en 3D…" color={C} />}
      {!loadingPersons && persons.length === 0 && <EmptyState icon={<Box size={30} />} color={C} title="Aucune personne dans l’arbre">Ajoutez quelques personnes pour voir votre arbre flotter en trois dimensions.</EmptyState>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {scene && (
        <div ref={viewport} onPointerDown={onDown} onWheel={onWheel}
          className="relative h-[calc(100dvh-190px)] min-h-[420px] touch-none select-none overflow-hidden rounded-[26px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]"
          style={{ background: theme.bg, perspective: PERSPECTIVE, cursor: 'grab' }}>
          <div ref={camera} className="absolute left-1/2 top-1/2 h-0 w-0" style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}>
            {scene.levels.map((l) => {
              const d = Math.max(240, (l.radius + CARD_W * 0.85) * 2)
              return (
                <div key={l.level} className="pointer-events-none absolute rounded-full" style={{ left: -d / 2, top: -d / 2, width: d, height: d, background: theme.disc, border: `1.5px solid ${theme.ring}`, boxShadow: `0 0 50px ${theme.ring}, inset 0 0 40px ${theme.ring}`, transform: `translateY(${l.y}px) rotateX(90deg)` }}>
                  <div className="absolute inset-[14%] rounded-full" style={{ border: `1px dashed ${theme.ring}` }} />
                </div>
              )
            })}
            {showLinks && scene.links.map(({ id, a, b }) => {
              const [lo, hi] = a.level < b.level ? [a, b] : [b, a]
              return <Link3D key={id} a={[lo.x, lo.y - 96, lo.z]} b={[hi.x, hi.y - 2, hi.z]} glow={theme.glow} />
            })}
            {scene.placed.map(({ n, x, y, z, level }) => {
              const [g1, g2] = SEX_GRADIENT[sexKey(n.sex)]
              const isRoot = level === 0
              const isSel = n.id === selected
              const size = isRoot ? 58 : 46
              return (
                <button key={n.id}
                  onClick={() => { if (!cam.current.moved) setSelected(n.id === selected ? null : n.id) }}
                  className="absolute left-0 top-0 flex flex-col items-center text-center"
                  style={{ width: CARD_W, transform: `translate3d(${x}px,${y}px,${z}px) rotateY(calc(var(--ry) * -1)) translate(-50%, -100%)`, transformOrigin: '50% 100%' }}>
                  <span className="relative block rounded-full transition-transform" style={{ width: size, height: size, transform: isSel ? 'scale(1.15)' : undefined, boxShadow: `0 0 0 ${isRoot || isSel ? 3 : 2}px ${isRoot ? '#f5c242' : isSel ? C : 'white'}, 0 6px 16px rgba(0,0,0,0.25), 0 0 22px ${g2}88` }}>
                    {n.portrait_media_id
                      ? <img src={api.mediaFileUrl(n.portrait_media_id)} alt="" draggable={false} className="h-full w-full rounded-full object-cover" />
                      : <span className="flex h-full w-full items-end justify-center overflow-hidden rounded-full" style={{ background: `linear-gradient(160deg, ${g1}, ${g2})` }}>
                          <svg viewBox="0 0 40 40" width={size * 0.78} height={size * 0.78} fill="white" opacity="0.95"><circle cx="20" cy="15" r="8" /><path d="M4 40c1-9 8-14 16-14s15 5 16 14z" /></svg>
                        </span>}
                  </span>
                  <span className="mt-1.5 w-full rounded-xl px-1.5 py-1 leading-tight backdrop-blur-sm" style={{ background: night ? 'rgba(10,25,35,0.55)' : 'rgba(255,255,255,0.78)', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
                    <span className="line-clamp-2 block text-[11px] font-semibold" style={{ color: theme.label }}>{n.display_name}</span>
                    <span className="block text-[10px]" style={{ color: theme.sub }}>{n.birth_year ?? '?'} – {n.death_year ?? (n.is_living ? '' : '?')}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* Légende des plateaux */}
          <div className="pointer-events-none absolute left-3 top-3 max-w-[60%] space-y-1 text-[11px]">
            <div className="w-fit rounded-full px-2.5 py-1 font-semibold shadow-sm backdrop-blur sm:hidden" style={{ background: night ? 'rgba(10,25,35,0.6)' : 'rgba(255,255,255,0.8)', color: night ? '#d8ffe6' : C }}>
              {scene.levels.length} générations · {scene.placed.length} personnes
            </div>
            {scene.levels.map((l) => (
              <div key={l.level} className="hidden w-fit rounded-full px-2.5 py-1 font-medium shadow-sm backdrop-blur sm:block" style={{ background: night ? 'rgba(10,25,35,0.6)' : 'rgba(255,255,255,0.75)', color: night ? '#d8ffe6' : C }}>
                {generationName(l.level)} · {l.count}
              </div>
            ))}
            {scene.truncated > 0 && <div className="w-fit rounded-full bg-white/80 px-2.5 py-1 text-mist-500">{scene.truncated} personnes éloignées masquées (fluidité)</div>}
          </div>

          {/* Commandes */}
          <div className="absolute right-3 top-3 flex flex-col gap-2" onPointerDown={(e) => e.stopPropagation()}>
            {[
              { icon: <Plus size={18} />, label: 'Zoomer', on: () => zoom(1.25) },
              { icon: <Minus size={18} />, label: 'Dézoomer', on: () => zoom(0.8) },
              { icon: <Maximize size={16} />, label: 'Recadrer', on: () => { cam.current.rx = 14; fit() } },
              { icon: auto ? <Pause size={16} /> : <Play size={16} />, label: auto ? 'Arrêter la rotation' : 'Rotation automatique', on: () => setAuto((v) => !v) },
            ].map((b) => (
              <button key={b.label} onClick={b.on} aria-label={b.label} title={b.label} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 shadow-md backdrop-blur" style={{ color: C }}>{b.icon}</button>
            ))}
          </div>

          {loading && <div className="absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-white/85 px-3 py-1 text-xs text-mist-500 shadow">Mise à jour…</div>}

          {sel && (
            <div className="absolute inset-x-3 bottom-3 mx-auto max-w-md" onPointerDown={(e) => e.stopPropagation()}>
              <div className="relative">
                <button onClick={() => setSelected(null)} className="absolute right-3 top-3 z-10 rounded-full bg-black/5 p-1 text-mist-500" aria-label="Fermer"><X size={14} /></button>
                <PersonFactsCard p={sel} color={C} extra={
                  <div className="mt-3 flex gap-2">
                    <Link to={`/personnes/${sel.id}`} className="flex-1 rounded-xl py-2 text-center text-sm font-semibold text-white" style={{ background: C }}>Voir la fiche</Link>
                    {sel.id !== focusId && <button onClick={() => { setFocusId(sel.id); setSelected(null) }} className="flex-1 rounded-xl bg-black/[0.05] py-2 text-sm font-semibold" style={{ color: C }}>Centrer ici</button>}
                  </div>
                } />
              </div>
            </div>
          )}
        </div>
      )}
    </ChartFrame>
  )
}
