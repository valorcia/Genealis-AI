import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Contrast, Crop, ExternalLink, Eye, EyeOff, Maximize2, Minus, Plus, RotateCw, ScanSearch, SunMoon, X } from 'lucide-react'
import { paleoApi, type BBox, type ReadingLine } from '../../lib/paleoApi'

const MIN = 1
const MAX = 12
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export interface ViewerHighlight { bbox: BBox; tone: 'line' | 'uncertain' | 'person' }

interface Props {
  mediaId: string
  title: string
  lines: ReadingLine[]
  selectedLine: number | null
  highlight: ViewerHighlight | null
  onSelectLine: (n: number) => void
  /** Zone dessinée par l'utilisateur (0-1000 de l'original) → « Relire cette zone ». */
  onRecheckZone?: (bbox: BBox) => void
  recheckBusy?: boolean
  className?: string
}

/**
 * Visionneuse haute définition : molette / pincement (jusqu'à ×12, bascule sur le fichier original quand on zoome),
 * déplacement, rotation, contraste, négatif, niveaux de gris (affichage seulement : l'original n'est jamais modifié),
 * superposition des zones lues, outil de découpe → « Relire cette zone ».
 */
export function ImageViewer({ mediaId, title, lines, selectedLine, highlight, onSelectLine, onRecheckZone, recheckBusy, className = '' }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [cont, setCont] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ s: 1, x: 0, y: 0 })
  const [rot, setRot] = useState(0)
  const [contrast, setContrast] = useState(1)
  const [negative, setNegative] = useState(false)
  const [gray, setGray] = useState(false)
  const [showBoxes, setShowBoxes] = useState(true)
  const [cropMode, setCropMode] = useState(false)
  const [crop, setCrop] = useState<BBox | null>(null)
  const [hd, setHd] = useState(false)
  const [failed, setFailed] = useState(false)
  const [contrastOpen, setContrastOpen] = useState(false)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; s: number } | null>(null)
  const drag = useRef<{ u: number; v: number } | null>(null)
  const lastTap = useRef(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

  const preview = paleoApi.viewUrl(mediaId, { max: 1600 })
  const src = hd ? paleoApi.fileUrl(mediaId) : preview

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCont({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setCont({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Taille d'affichage de l'image (ajustée au cadre, en tenant compte de la rotation)
  const rotated = rot % 180 !== 0
  const fit = natural && cont.w && cont.h
    ? Math.min((cont.w - 16) / (rotated ? natural.h : natural.w), (cont.h - 16) / (rotated ? natural.w : natural.h))
    : 0
  const stageW = natural ? natural.w * fit : 0
  const stageH = natural ? natural.h * fit : 0

  // Haute définition : on charge le fichier original dès que l'aperçu ne suffit plus
  useEffect(() => {
    if (!hd && natural && stageW * view.s > Math.max(natural.w, 1) * 1.05) setHd(true)
  }, [hd, natural, stageW, view.s])

  const zoomAt = useCallback((factor: number, px = 0, py = 0) => {
    setView((v) => {
      const s = clamp(v.s * factor, MIN, MAX)
      if (s === 1) return { s, x: 0, y: 0 }
      const k = s / v.s
      return { s, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
  }, [])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // Ligne choisie dans la transcription → l'image se centre sur sa zone (et zoome si besoin)
  useEffect(() => {
    const target = highlight?.bbox
    if (!target || !stageW) return
    const [x, y, w, h] = target
    const lx = ((x + w / 2) / 1000 - 0.5) * stageW
    const ly = ((y + h / 2) / 1000 - 0.5) * stageH
    setView((v) => {
      const s = v.s < 1.6 ? clamp(Math.min(2.4, (stageW * 0.85) / Math.max(1, (w / 1000) * stageW)), 1.6, 4) : v.s
      const r = (rot * Math.PI) / 180
      return { s, x: -(Math.cos(r) * lx - Math.sin(r) * ly) * s, y: -(Math.sin(r) * lx + Math.cos(r) * ly) * s }
    })
  }, [highlight, stageW, stageH, rot])

  /** Point écran → coordonnées 0-1000 de l'image originale (inverse du zoom, du déplacement et de la rotation). */
  const toImage = (clientX: number, clientY: number): { u: number; v: number } | null => {
    const st = stageRef.current
    if (!st || !stageW) return null
    const rect = st.getBoundingClientRect()
    const dx = clientX - (rect.left + rect.width / 2)
    const dy = clientY - (rect.top + rect.height / 2)
    const r = (rot * Math.PI) / 180
    const lx = (dx * Math.cos(r) + dy * Math.sin(r)) / view.s
    const ly = (-dx * Math.sin(r) + dy * Math.cos(r)) / view.s
    return { u: clamp((lx / stageW + 0.5) * 1000, 0, 1000), v: clamp((ly / stageH + 0.5) * 1000, 0, 1000) }
  }

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    start.current = { x: e.clientX, y: e.clientY }
    if (cropMode && pointers.current.size === 1) {
      const p = toImage(e.clientX, e.clientY)
      if (p) { drag.current = p; setCrop([p.u, p.v, 0, 0]) }
      return
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), s: view.s }
      drag.current = null
    } else {
      const now = Date.now()
      if (now - lastTap.current < 280) setView((v) => (v.s > 1 ? { s: 1, x: 0, y: 0 } : { ...v, s: 2.5 }))
      lastTap.current = now
    }
  }
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    pointers.current.set(e.pointerId, cur)
    if (cropMode && drag.current) {
      const p = toImage(e.clientX, e.clientY)
      if (p) {
        const a = drag.current
        setCrop([Math.min(a.u, p.u), Math.min(a.v, p.v), Math.abs(p.u - a.u), Math.abs(p.v - a.v)])
      }
      return
    }
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const s = clamp(pinch.current.s * (Math.hypot(a.x - b.x, a.y - b.y) / (pinch.current.dist || 1)), MIN, MAX)
      setView((v) => (s === 1 ? { s, x: 0, y: 0 } : { ...v, s }))
    } else if (pointers.current.size === 1 && view.s > 1) {
      setView((v) => ({ ...v, x: v.x + cur.x - prev.x, y: v.y + cur.y - prev.y }))
    }
  }
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const tap = start.current && pointers.current.size === 1 && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) < 6
    if (tap && !cropMode) {
      // toucher une ligne sur l'image → la sélectionner dans la transcription
      const p = toImage(e.clientX, e.clientY)
      const hit = p && lines.find((l) => l.bbox && p.u >= l.bbox[0] && p.u <= l.bbox[0] + l.bbox[2] && p.v >= l.bbox[1] && p.v <= l.bbox[1] + l.bbox[3])
      if (hit) onSelectLine(hit.n)
    }
    start.current = null
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (cropMode && drag.current) {
      drag.current = null
      setCrop((c) => (c && c[2] > 8 && c[3] > 5 ? c : null))
    }
  }

  const filter = `${contrast !== 1 ? `contrast(${contrast}) ` : ''}${gray ? 'grayscale(1) ' : ''}${negative ? 'invert(1)' : ''}`.trim() || 'none'
  const reset = () => { setView({ s: 1, x: 0, y: 0 }); setRot(0); setContrast(1); setNegative(false); setGray(false); setCrop(null); setCropMode(false) }
  const pct = (b: BBox) => ({ left: `${b[0] / 10}%`, top: `${b[1] / 10}%`, width: `${b[2] / 10}%`, height: `${b[3] / 10}%` })

  const tools: { icon: typeof Plus; label: string; on?: boolean; fn: () => void }[] = [
    { icon: Minus, label: 'Dézoomer', fn: () => zoomAt(1 / 1.4) },
    { icon: Plus, label: 'Zoomer', fn: () => zoomAt(1.4) },
    { icon: RotateCw, label: 'Tourner d’un quart de tour', fn: () => setRot((r) => (r + 90) % 360) },
    { icon: Contrast, label: 'Contraste', on: contrast !== 1 || contrastOpen, fn: () => setContrastOpen((o) => !o) },
    { icon: SunMoon, label: 'Négatif (encre pâle)', on: negative, fn: () => setNegative((n) => !n) },
    { icon: ScanSearch, label: 'Niveaux de gris', on: gray, fn: () => setGray((g) => !g) },
    { icon: showBoxes ? Eye : EyeOff, label: showBoxes ? 'Masquer les zones lues' : 'Afficher les zones lues', on: showBoxes, fn: () => setShowBoxes((b) => !b) },
    ...(onRecheckZone ? [{ icon: Crop, label: 'Découper une zone à relire', on: cropMode, fn: () => { setCropMode((c) => !c); setCrop(null) } }] : []),
    { icon: Maximize2, label: 'Tout réinitialiser', fn: reset },
  ]

  return (
    <div className={`relative flex flex-col overflow-hidden rounded-2xl border border-[var(--hairline-strong)] bg-night-950 ${className}`}>
      <div ref={boxRef} className={`relative min-h-0 flex-1 select-none overflow-hidden ${cropMode ? 'cursor-crosshair' : view.s > 1 ? 'cursor-grab' : ''}`}
        style={{ touchAction: 'none' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="absolute inset-0 flex items-center justify-center">
          <div ref={stageRef} className="relative shrink-0 will-change-transform"
            style={{ width: stageW || undefined, height: stageH || undefined, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s}) rotate(${rot}deg)`, transformOrigin: 'center' }}>
            {!failed && (
              <img src={src} alt={title} draggable={false} onLoad={(e) => { const im = e.currentTarget; if (!natural || !hd) setNatural({ w: im.naturalWidth, h: im.naturalHeight }) }}
                onError={() => (hd ? setHd(false) : setFailed(true))}
                className="block h-full w-full shadow-2xl" style={{ filter, imageRendering: view.s > 4 ? 'pixelated' : 'auto' }} />
            )}
            {showBoxes && natural && (
              <div className="absolute inset-0">
                {lines.filter((l) => l.bbox).map((l) => (
                  <span key={l.n} data-line={l.n}
                    className={`pointer-events-none absolute rounded-[3px] border transition-colors ${selectedLine === l.n ? 'border-ios-violet bg-ios-violet/15' : 'border-brass-300/70'}`}
                    style={{ ...pct(l.bbox as BBox), borderWidth: Math.max(0.5, 1.5 / view.s) }} />
                ))}
                {lines.flatMap((l) => l.uncertain.filter((u) => u.bbox && !u.bbox_is_line && u.status !== 'human_verified').map((u, i) => (
                  <span key={`${l.n}-${i}`} className="pointer-events-none absolute rounded-[2px] border border-dashed border-conf-orange bg-conf-orange/20"
                    style={{ ...pct(u.bbox as BBox), borderWidth: Math.max(0.5, 1.5 / view.s) }} />
                )))}
                {highlight && (
                  <span className={`pointer-events-none absolute rounded-[3px] ring-2 ${highlight.tone === 'uncertain' ? 'ring-conf-orange bg-conf-orange/25' : highlight.tone === 'person' ? 'ring-sage-400 bg-sage-400/25' : 'ring-ios-violet bg-ios-violet/15'}`}
                    style={pct(highlight.bbox)} />
                )}
                {crop && <span className="pointer-events-none absolute border-2 border-ios-blue bg-ios-blue/15" style={{ ...pct(crop), borderWidth: Math.max(1, 2 / view.s) }} />}
              </div>
            )}
          </div>
        </div>
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-ivory-200">
            Impossible d’afficher ce document ici.
            <a className="btn-ghost" href={paleoApi.fileUrl(mediaId)} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Ouvrir le fichier original</a>
          </div>
        )}
        <a href={paleoApi.fileUrl(mediaId)} target="_blank" rel="noreferrer" title="Ouvrir le fichier original (jamais modifié)"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-night-900/75 px-2.5 py-1 text-[11px] text-white hover:bg-night-900"><ExternalLink size={12} />Original</a>
        <div className="pointer-events-none absolute left-2 top-2 flex max-w-[calc(100%-6rem)] flex-wrap gap-1.5">
          <span className="rounded-full bg-night-900/75 px-2.5 py-1 text-[11px] text-white">{view.s === 1 ? (coarse ? 'Pincez pour zoomer' : 'Molette pour zoomer, glisser pour déplacer') : `×${view.s.toFixed(1)}${hd ? ' · haute définition' : ''}`}</span>
          {(rot || contrast !== 1 || negative || gray) ? <span className="rounded-full bg-night-900/75 px-2.5 py-1 text-[11px] text-white">Affichage retouché · original intact</span> : null}
        </div>
        {cropMode && !crop && <div className="pointer-events-none absolute inset-x-0 top-10 mx-auto w-fit rounded-full bg-ios-blue px-3 py-1.5 text-[12.5px] font-medium text-white shadow-lg">Dessinez un rectangle autour du passage difficile</div>}
        {crop && onRecheckZone && (
          <div className="absolute inset-x-0 bottom-16 mx-auto flex w-fit items-center gap-1.5 rounded-2xl bg-white/95 p-1.5 shadow-xl"
            onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
            <button type="button" className="btn-gold !py-1.5 text-[13.5px]" disabled={recheckBusy}
              onClick={() => { onRecheckZone(crop.map(Math.round) as BBox); setCrop(null); setCropMode(false) }}>
              <ScanSearch size={15} />{recheckBusy ? 'Relecture…' : 'Relire cette zone'}
            </button>
            <button type="button" className="btn-ghost !p-2" aria-label="Annuler la découpe" onClick={() => setCrop(null)}><X size={15} /></button>
          </div>
        )}
      </div>
      {contrastOpen && (
        <div className="flex items-center gap-3 border-t border-white/10 bg-night-900 px-3 py-2 text-[12.5px] text-ivory-100">
          <Contrast size={15} />
          <label className="flex flex-1 items-center gap-2">Contraste
            <input type="range" min={0.5} max={3} step={0.1} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="flex-1 accent-brass-400" aria-label="Contraste" />
          </label>
          <span className="w-9 text-right tabular-nums">{contrast.toFixed(1)}</span>
        </div>
      )}
      <div className="flex items-center justify-center gap-0.5 overflow-x-auto border-t border-white/10 bg-night-900 px-1.5 py-1.5 no-scrollbar">
        {tools.map(({ icon: Icon, label, on, fn }) => (
          <button key={label} type="button" aria-label={label} title={label} aria-pressed={on} onClick={fn}
            className={`flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors lg:h-9 lg:w-9 ${on ? 'bg-brass-400 text-night-950' : 'text-ivory-100 hover:bg-white/10'}`}>
            <Icon size={18} />
          </button>
        ))}
      </div>
    </div>
  )
}
