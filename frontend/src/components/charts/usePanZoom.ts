import { useCallback, useEffect, useRef } from 'react'

export interface PanZoomTransform { x: number; y: number; k: number }

/**
 * Déplacement et zoom fluides d'un contenu (HTML ou SVG) : glisser au doigt ou à la souris,
 * pincer pour zoomer sur téléphone, molette (ou pincement du pavé tactile) sur ordinateur.
 * La transformation est appliquée directement au DOM (aucun rendu React pendant le geste),
 * ce qui reste fluide même avec plusieurs centaines de personnes affichées.
 */
export function usePanZoom({ minScale = 0.08, maxScale = 3, contentSize }: { minScale?: number; maxScale?: number; contentSize?: { w: number; h: number } } = {}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const t = useRef<PanZoomTransform>({ x: 0, y: 0, k: 1 })
  const size = useRef(contentSize)
  useEffect(() => { size.current = contentSize }, [contentSize])
  const listeners = useRef(new Set<(t: PanZoomTransform) => void>())

  const apply = useCallback(() => {
    const el = contentRef.current
    if (el) el.style.transform = `translate3d(${t.current.x}px, ${t.current.y}px, 0) scale(${t.current.k})`
    listeners.current.forEach((fn) => fn(t.current))
  }, [])
  const setTransform = useCallback((next: PanZoomTransform) => { t.current = { ...next, k: Math.min(maxScale, Math.max(minScale, next.k)) }; apply() }, [apply, minScale, maxScale])

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    const cur = t.current
    const k = Math.min(maxScale, Math.max(minScale, cur.k * factor))
    const f = k / cur.k
    t.current = { k, x: cx - (cx - cur.x) * f, y: cy - (cy - cur.y) * f }
    apply()
  }, [apply, minScale, maxScale])

  const zoomBy = useCallback((factor: number) => {
    const vp = viewportRef.current; if (!vp) return
    zoomAt(factor, vp.clientWidth / 2, vp.clientHeight / 2)
  }, [zoomAt])

  /** Ajuste tout le contenu dans la zone visible (sans dépasser l'échelle maxFit). */
  const fit = useCallback((padding = 24, maxFit = 1, topInset = 0, bottomInset = 0) => {
    const vp = viewportRef.current, s = size.current; if (!vp || !s || !s.w || !s.h) return
    const vw = vp.clientWidth, vh = vp.clientHeight - topInset - bottomInset
    const k = Math.max(minScale, Math.min(maxFit, (vw - padding * 2) / s.w, (vh - padding * 2) / s.h))
    t.current = { k, x: (vw - s.w * k) / 2, y: topInset + (vh - s.h * k) / 2 }
    apply()
  }, [apply, minScale])

  /** Place le point (x, y) du contenu au centre de la zone visible. */
  const centerOn = useCallback((x: number, y: number, k?: number, offsetY = 0) => {
    const vp = viewportRef.current; if (!vp) return
    const kk = Math.min(maxScale, Math.max(minScale, k ?? t.current.k))
    t.current = { k: kk, x: vp.clientWidth / 2 - x * kk, y: vp.clientHeight / 2 + offsetY - y * kk }
    apply()
  }, [apply, minScale, maxScale])

  useEffect(() => {
    const vp = viewportRef.current; if (!vp) return
    const pointers = new Map<number, { x: number; y: number }>()
    let start: { x: number; y: number; t: PanZoomTransform; dist: number; mid: { x: number; y: number } } | null = null
    let moved = false
    let captured = false
    const rel = (e: PointerEvent) => { const r = vp.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    const snapshot = () => {
      const pts = [...pointers.values()]
      const mid = pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0]
      const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0
      start = { x: mid.x, y: mid.y, t: { ...t.current }, dist, mid }
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if ((e.target as HTMLElement | null)?.closest?.('[data-nopan]')) return
      pointers.set(e.pointerId, rel(e))
      if (pointers.size === 1) { moved = false; captured = false }
      snapshot()
    }
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId) || !start) return
      pointers.set(e.pointerId, rel(e))
      const pts = [...pointers.values()]
      if (pts.length >= 2 && start.dist > 0) {
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        const k = Math.min(maxScale, Math.max(minScale, start.t.k * (dist / start.dist)))
        const f = k / start.t.k
        t.current = { k, x: mid.x - (start.mid.x - start.t.x) * f, y: mid.y - (start.mid.y - start.t.y) * f }
        moved = true
        apply()
        return
      }
      const dx = pts[0].x - start.x, dy = pts[0].y - start.y
      if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return
      moved = true
      if (!captured) { try { vp.setPointerCapture(e.pointerId) } catch { /* ignore */ } captured = true; vp.style.cursor = 'grabbing' }
      t.current = { ...start.t, x: start.t.x + dx, y: start.t.y + dy }
      apply()
    }
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size > 0) snapshot(); else { start = null; vp.style.cursor = '' }
    }
    // Après un glissement, on annule le clic qui suit (sinon on sélectionnerait une personne par erreur).
    const click = (e: MouseEvent) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false } }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = vp.getBoundingClientRect()
      if (e.shiftKey) { t.current = { ...t.current, x: t.current.x - e.deltaY, y: t.current.y }; apply(); return }
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      zoomAt(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top)
    }
    vp.addEventListener('pointerdown', down)
    vp.addEventListener('pointermove', move)
    vp.addEventListener('pointerup', up)
    vp.addEventListener('pointercancel', up)
    vp.addEventListener('click', click, true)
    vp.addEventListener('wheel', wheel, { passive: false })
    return () => {
      vp.removeEventListener('pointerdown', down); vp.removeEventListener('pointermove', move); vp.removeEventListener('pointerup', up)
      vp.removeEventListener('pointercancel', up); vp.removeEventListener('click', click, true); vp.removeEventListener('wheel', wheel)
    }
  }, [apply, zoomAt, minScale, maxScale])

  // Impression : le graphique entier est mis à l'échelle de la page, puis la vue est restaurée.
  useEffect(() => {
    let saved: PanZoomTransform | null = null
    const before = () => {
      const el = contentRef.current, s = size.current; if (!el || !s) return
      saved = { ...t.current }
      const k = Math.min(1, 1050 / s.w, 1400 / s.h)
      el.style.transform = `scale(${k})`
    }
    const after = () => { if (saved) { t.current = saved; saved = null; apply() } }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after) }
  }, [apply])

  const subscribe = useCallback((fn: (t: PanZoomTransform) => void) => { listeners.current.add(fn); return () => { listeners.current.delete(fn) } }, [])
  return { viewportRef, contentRef, fit, centerOn, zoomBy, setTransform, transform: t, subscribe }
}
export type PanZoom = ReturnType<typeof usePanZoom>
