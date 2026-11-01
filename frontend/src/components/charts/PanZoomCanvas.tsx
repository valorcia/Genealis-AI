import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Minus, Plus, Scan } from 'lucide-react'
import type { PanZoom } from './usePanZoom'

/** Fond « papier quadrillé » clair des vues interactives. */
export const GRID_BG: CSSProperties = {
  backgroundColor: '#f7f8fb',
  backgroundImage: 'linear-gradient(rgba(60,80,120,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(60,80,120,0.07) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
}

/**
 * Zone de dessin déplaçable / zoomable. Le contenu est positionné en coordonnées absolues (w × h)
 * et ajusté automatiquement à l'écran quand `fitKey` change.
 */
export default function PanZoomCanvas({ pz, width, height, fitKey, children, background = 'grid', maxFit = 1, onFitted, className = '', overlay }: {
  pz: PanZoom; width: number; height: number; fitKey?: string | number; children: ReactNode; background?: 'grid' | 'plain'
  maxFit?: number; onFitted?: () => void; className?: string; overlay?: ReactNode
}) {
  const fitted = useRef<string | number | undefined>(undefined)
  const { fit } = pz
  useEffect(() => {
    if (fitKey === undefined || fitted.current === fitKey || !width || !height) return
    fitted.current = fitKey
    const r = requestAnimationFrame(() => { if (onFitted) onFitted(); else fit(28, maxFit, 0, 70) })
    return () => cancelAnimationFrame(r)
  }, [fitKey, width, height, fit, maxFit, onFitted])
  return (
    <div ref={pz.viewportRef} className={`chart-viewport relative w-full select-none overflow-hidden rounded-3xl ring-1 ring-black/5 ${className}`}
      style={{ ...(background === 'grid' ? GRID_BG : { background: '#ffffff' }), touchAction: 'none', height: 'calc(100dvh - 150px)', minHeight: 420, cursor: 'grab' }}>
      <div ref={pz.contentRef} className="chart-print-area absolute left-0 top-0 origin-top-left will-change-transform" style={{ width, height }}>
        {children}
      </div>
      {overlay}
      <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-2xl bg-white/85 shadow-md ring-1 ring-black/5 backdrop-blur print:hidden" data-nopan>
        <button className="p-2 text-night-900 hover:bg-black/5" onClick={() => pz.zoomBy(1.25)} aria-label="Zoom avant"><Plus size={18} /></button>
        <button className="border-y border-black/5 p-2 text-night-900 hover:bg-black/5" onClick={() => pz.fit(28, maxFit, 0, 70)} aria-label="Ajuster à l'écran"><Scan size={18} /></button>
        <button className="p-2 text-night-900 hover:bg-black/5" onClick={() => pz.zoomBy(0.8)} aria-label="Zoom arrière"><Minus size={18} /></button>
      </div>
    </div>
  )
}
