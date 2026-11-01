import { useCallback, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { ExternalLink, FileText, Minus, Plus, RotateCw, Scan } from 'lucide-react'
import { openExternal } from '../../api'

interface View { scale: number; x: number; y: number; rot: number }
const MIN = 1
const MAX = 6
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/**
 * Visionneuse d'image avec zoom au pincement (iPhone), glisser pour se déplacer, double-tap pour zoomer,
 * boutons +/− et rotation. Les PDF sont affichés dans le lecteur du navigateur.
 */
export function ZoomViewer({ src, alt, isPdf = false, className = '' }: { src: string; alt: string; isPdf?: boolean; className?: string }) {
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0, rot: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const lastTap = useRef(0)
  const box = useRef<HTMLDivElement>(null)

  const zoomBy = useCallback((f: number) => setView((v) => {
    const scale = clamp(v.scale * f, MIN, MAX)
    return scale === 1 ? { ...v, scale, x: 0, y: 0 } : { ...v, scale, x: v.x * (scale / v.scale), y: v.y * (scale / v.scale) }
  }), [])

  if (isPdf) {
    return (
      <div className={`flex flex-col gap-2 ${className}`}>
        <object data={src} type="application/pdf" className="h-[60vh] w-full rounded-2xl border border-ivory-300 bg-ivory-100" aria-label={alt}>
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-mist-500">
            <FileText size={40} strokeWidth={1.2} />Votre navigateur n’affiche pas le PDF ici.
          </div>
        </object>
        <button className="btn-ghost self-start" onClick={() => openExternal(src)}><ExternalLink size={15} /> Ouvrir le PDF en grand</button>
      </div>
    )
  }

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale }
    } else if (pointers.current.size === 1) {
      const now = Date.now()
      if (now - lastTap.current < 280) setView((v) => (v.scale > 1 ? { ...v, scale: 1, x: 0, y: 0 } : { ...v, scale: 2.5 }))
      lastTap.current = now
    }
  }
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, cur)
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const scale = clamp(pinch.current.scale * (Math.hypot(a.x - b.x, a.y - b.y) / (pinch.current.dist || 1)), MIN, MAX)
      setView((v) => (scale === 1 ? { ...v, scale, x: 0, y: 0 } : { ...v, scale }))
    } else if (pointers.current.size === 1) {
      setView((v) => {
        if (v.scale <= 1) return v
        const w = box.current?.clientWidth ?? 300
        const h = box.current?.clientHeight ?? 300
        const lim = (n: number, size: number) => clamp(n, -size * (v.scale - 1) / 2 - 40, size * (v.scale - 1) / 2 + 40)
        return { ...v, x: lim(v.x + cur.x - prev.x, w), y: lim(v.y + cur.y - prev.y, h) }
      })
    }
  }
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-ivory-300 bg-night-950/90 ${className}`}>
      <div ref={box} className="flex h-full min-h-[240px] w-full select-none items-center justify-center" style={{ touchAction: 'none' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15) } }}>
        <img src={src} alt={alt} draggable={false} className="max-h-full max-w-full object-contain transition-transform duration-75 ease-out"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${view.rot}deg)` }} />
      </div>
      <div className="absolute bottom-2 right-2 flex gap-1.5">
        {[
          { icon: Minus, label: 'Dézoomer', fn: () => zoomBy(1 / 1.4) },
          { icon: Plus, label: 'Zoomer', fn: () => zoomBy(1.4) },
          { icon: RotateCw, label: 'Tourner', fn: () => setView((v) => ({ ...v, rot: (v.rot + 90) % 360 })) },
          { icon: Scan, label: 'Taille normale', fn: () => setView({ scale: 1, x: 0, y: 0, rot: 0 }) },
        ].map(({ icon: Icon, label, fn }) => (
          <button key={label} type="button" aria-label={label} title={label} onClick={fn}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/90 text-night-900 shadow-md backdrop-blur hover:bg-white">
            <Icon size={18} />
          </button>
        ))}
      </div>
      {view.scale === 1 && <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-night-900/70 px-2.5 py-1 text-[11px] text-white">Pincez pour zoomer · double-tap</div>}
    </div>
  )
}
