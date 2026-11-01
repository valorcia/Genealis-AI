import { useRef, type ReactNode } from 'react'
import { Star } from 'lucide-react'
import { ICONS } from '../../navigation/icons'
import type { Tile } from '../../navigation/sections'
import type { Dashboard } from '../../api'

/**
 * Éléments visuels des pages de catégorie (style MacFamilyTree) : grand titre coloré,
 * grilles de tuiles blanches (grandes « vedettes » puis petites), icônes en dégradé de la couleur.
 */

function mixWithWhite(hex: string, amount: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (255 - c) * amount))
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}
function gradId(color: string) { return `hub-grad-${color.replace(/[^0-9a-z]/gi, '')}` }

/** Dégradés SVG partagés (un par couleur) utilisés pour le trait des icônes de tuiles. */
export function TileGradients({ colors }: { colors: string[] }) {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        {[...new Set(colors)].map((c) => (
          <linearGradient key={c} id={gradId(c)} gradientUnits="userSpaceOnUse" x1="0" y1="1" x2="0" y2="23">
            <stop offset="0" stopColor={mixWithWhite(c, 0.32)} />
            <stop offset="1" stopColor={c} />
          </linearGradient>
        ))}
      </defs>
    </svg>
  )
}

export function HubTitle({ title, color, children }: { title: string; color: string; children?: ReactNode }) {
  const factor = Math.max(3.2, title.length * 0.6).toFixed(2)
  return (
    <div className="fade-up px-2 pb-5 pt-5 text-center sm:pb-9 sm:pt-10">
      <h1
        className="font-display mx-auto font-bold leading-[1.02] tracking-[-0.035em] [--hub-title-max:74px] sm:[--hub-title-max:96px]"
        style={{ color, fontWeight: 700, fontSize: `clamp(34px, calc((100vw - 48px) / ${factor}), var(--hub-title-max))`, textShadow: '0 1px 0 rgba(255,255,255,0.6)' }}
      >
        {title}
      </h1>
      {children}
    </div>
  )
}

/** Libellé de compteur (« 4 personnes », « 1 personne »), ou null si la donnée n'existe pas. */
export function tileCount(tile: Tile, dashboard: Dashboard | null): string | null {
  if (!tile.countKey || !dashboard) return null
  const v = (dashboard as unknown as Record<string, unknown>)[tile.countKey]
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  let label = tile.countLabel ?? ''
  if (v <= 1 && /^[^\s]+s$/.test(label)) label = label.slice(0, -1)
  return `${v.toLocaleString('fr-FR')}${label ? ` ${label}` : ''}`
}

export function HubTile({ tile, color, big, count, favorite, onOpen, onToggleFavorite, delay = 0 }: {
  tile: Tile; color: string; big: boolean; count?: string | null; favorite: boolean
  onOpen: () => void; onToggleFavorite: () => void; delay?: number
}) {
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const longPressed = useRef(false)
  const Icon = ICONS[tile.icon] ?? Star
  const clear = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null } }
  const soft = `color-mix(in srgb, ${color} 52%, #a3a9b6)`
  return (
    <div className={`tile tile-in group ${TILE_WIDTH}`} style={{ background: `linear-gradient(180deg, #ffffff 52%, color-mix(in srgb, ${color} 6%, white) 100%)`, animationDelay: `${delay}ms` }}>
      <button
        type="button"
        aria-label={count ? `${tile.label}, ${count}` : tile.label}
        title={tile.description ?? tile.label}
        className={`flex w-full flex-1 flex-col items-center rounded-[inherit] text-center focus-visible:outline-none ${big ? 'aspect-square justify-center gap-1 px-1 pb-3 pt-3 sm:gap-2 sm:px-2 sm:pb-5 sm:pt-6' : 'aspect-square justify-center gap-1 px-1 pb-2.5 pt-2.5 sm:gap-1.5 sm:pb-4 sm:pt-5'}`}
        onPointerDown={(e) => {
          longPressed.current = false
          start.current = { x: e.clientX, y: e.clientY }
          clear()
          timer.current = window.setTimeout(() => { longPressed.current = true; navigator.vibrate?.(12); onToggleFavorite() }, 520)
        }}
        onPointerMove={(e) => { if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) clear() }}
        onPointerUp={clear}
        onPointerLeave={clear}
        onPointerCancel={clear}
        onContextMenu={(e) => { e.preventDefault(); if (!longPressed.current) { clear(); onToggleFavorite() } }}
        onClick={(e) => { if (longPressed.current) { e.preventDefault(); longPressed.current = false; return } onOpen() }}
      >
        <span className="flex min-h-0 flex-1 items-center justify-center" style={{ filter: `drop-shadow(0 3px 6px color-mix(in srgb, ${color} 22%, transparent))` }}>
          <Icon
            color={`url(#${gradId(color)})`}
            fill={`url(#${gradId(color)})`}
            fillOpacity={0.13}
            strokeWidth={big ? 1.6 : 1.75}
            className={big ? 'h-[48px] w-[48px] sm:h-[72px] sm:w-[72px]' : 'h-[32px] w-[32px] sm:h-[46px] sm:w-[46px]'}
          />
        </span>
        <span className={`block w-full shrink-0 break-words leading-[1.18] ${big ? 'text-[14.5px] font-medium sm:text-[18px]' : 'text-[11px] font-medium sm:text-[13.5px]'}`} style={{ color }}>
          {tile.label}
        </span>
        {count && <span className={`block w-full shrink-0 truncate leading-tight ${big ? 'text-[12.5px] sm:text-[14px]' : 'text-[10.5px] sm:text-[12px]'}`} style={{ color: soft }}>{count}</span>}
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-pressed={favorite}
        aria-label={favorite ? `Retirer « ${tile.label} » des favoris` : `Ajouter « ${tile.label} » aux favoris`}
        title={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        className={`absolute z-10 inline-flex items-center justify-center rounded-full transition-[opacity,transform] duration-200 hover:bg-black/[0.05] active:scale-90 ${big ? 'right-1.5 top-1.5 h-7 w-7 sm:right-2.5 sm:top-2.5' : 'right-0.5 top-0.5 h-6 w-6 sm:right-1.5 sm:top-1.5'} ${favorite ? 'opacity-75' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-70'}`}
        style={{ color: favorite ? '#f5a623' : '#a3a9b6' }}
      >
        <Star size={big ? 13 : 11} strokeWidth={2.2} className={favorite ? 'fill-current' : ''} />
      </button>
    </div>
  )
}

/** Grille centrée façon MacFamilyTree : les rangées incomplètes sont centrées. */
export function TileRow({ kind, children }: { kind: 'big' | 'small'; children: ReactNode }) {
  return (
    <div className={`flex flex-wrap justify-center gap-[var(--g)] [--g:10px] sm:[--g:16px] ${kind === 'big' ? '[--n:3] sm:[--n:5]' : '[--n:4] sm:[--n:6]'}`}>
      {children}
    </div>
  )
}
const TILE_WIDTH = 'w-[calc((100%_-_(var(--n)_-_1)_*_var(--g))_/_var(--n))]'
