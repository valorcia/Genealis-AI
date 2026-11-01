import { useRef, type ReactNode } from 'react'
import { ArrowUpRight, ChevronRight, Star } from 'lucide-react'
import type { Tile } from '../../navigation/sections'
import type { Dashboard } from '../../api'
import { Medallion } from '../brand/Brand'
import { ICONS } from '../../navigation/icons'

/**
 * Éléments des pages de chapitre GENEALIS (style « archive ») :
 *  - FeatureCard : carte vedette (la première, « héros », est large avec un décor de cernes d'arbre) ;
 *  - IndexList / IndexRow : les autres outils présentés comme une table des matières ;
 *  - tileCount : libellé du compteur affiché sur une tuile.
 * Appui long (ou clic droit, ou ☆) sur une carte : ajout/retrait des favoris.
 */

/** Libellé de compteur (« 4 personnes », « 1 personne »), ou null si la donnée n'existe pas. */
export function tileCount(tile: Tile, dashboard: Dashboard | null): string | null {
  if (!tile.countKey || !dashboard) return null
  const v = (dashboard as unknown as Record<string, unknown>)[tile.countKey]
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  let label = tile.countLabel ?? ''
  if (v <= 1 && /^[^\s]+s$/.test(label)) label = label.slice(0, -1)
  return `${v.toLocaleString('fr-FR')}${label ? ` ${label}` : ''}`
}

/** Gestion clic / appui long (favori) commune aux cartes. */
function usePress(onOpen: () => void, onToggleFavorite: () => void) {
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const longPressed = useRef(false)
  const clear = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null } }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      longPressed.current = false
      start.current = { x: e.clientX, y: e.clientY }
      clear()
      timer.current = window.setTimeout(() => { longPressed.current = true; navigator.vibrate?.(12); onToggleFavorite() }, 520)
    },
    onPointerMove: (e: React.PointerEvent) => { if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) clear() },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (!longPressed.current) { clear(); onToggleFavorite() } },
    onClick: (e: React.MouseEvent) => { if (longPressed.current) { e.preventDefault(); longPressed.current = false; return } onOpen() },
  }
}

function FavoriteToggle({ label, favorite, onToggle, className = '', light = false }: { label: string; favorite: boolean; onToggle: () => void; className?: string; light?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={favorite}
      aria-label={favorite ? `Retirer « ${label} » des favoris` : `Ajouter « ${label} » aux favoris`}
      title={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      className={`z-10 inline-flex h-8 w-8 items-center justify-center rounded-full transition-[opacity,transform,background-color] duration-200 active:scale-90 ${light ? 'hover:bg-white/15' : 'hover:bg-black/[0.05]'} ${favorite ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-80'} ${className}`}
      style={{ color: favorite ? (light ? '#ecd9a6' : 'var(--color-brass-500)') : light ? 'rgba(255,253,248,0.75)' : 'var(--color-mist-400)' }}
    >
      <Star size={15} strokeWidth={2} className={favorite ? 'fill-current' : ''} />
    </button>
  )
}

/** Décor « cernes d'arbre » (anneaux excentrés) pour les cartes héros. */
export function TreeRings({ color, className = '' }: { color: string; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 200 200" className={`pointer-events-none ${className}`} fill="none" stroke={color}>
      {[92, 78, 64, 51, 39, 28, 18, 9].map((r, i) => (
        <circle key={r} cx={100 - i * 2.2} cy={100 + i * 1.6} r={r} strokeWidth={i % 3 === 0 ? 1.4 : 0.8} opacity={0.18 + i * 0.05} />
      ))}
    </svg>
  )
}

export function FeatureCard({ tile, color, tint, hero = false, ai = false, eyebrow, count, favorite, onOpen, onToggleFavorite, delay = 0, className = '' }: {
  tile: Tile; color: string; tint: string; hero?: boolean; ai?: boolean; eyebrow?: string; count?: string | null; favorite: boolean
  onOpen: () => void; onToggleFavorite: () => void; delay?: number; className?: string
}) {
  const press = usePress(onOpen, onToggleFavorite)
  const dark = hero && ai
  const HeroIcon = ICONS[tile.icon] ?? Star
  const background = dark
    ? `radial-gradient(120% 140% at 100% 0%, #7d63f0 0%, #5b3fd6 42%, #3a2596 100%)`
    : hero
      ? `linear-gradient(125deg, var(--color-ivory-50) 0%, var(--color-ivory-50) 35%, ${tint} 100%)`
      : `linear-gradient(180deg, var(--color-ivory-50) 55%, color-mix(in srgb, ${tint} 60%, var(--color-ivory-50)) 100%)`
  return (
    <div className={`tile tile-in group @container overflow-hidden ${hero ? 'min-h-[156px] sm:min-h-[184px]' : ''} ${className}`} style={{ background, animationDelay: `${delay}ms`, ...(dark ? { borderColor: 'rgba(255,255,255,0.12)' } : {}) }}>
      {hero && <TreeRings color={dark ? '#ffffff' : color} className={`absolute -bottom-20 -right-16 h-[230px] w-[230px] sm:-bottom-24 sm:right-[-30px] sm:h-[300px] sm:w-[300px] ${dark ? 'opacity-40' : 'opacity-55'}`} />}
      {!hero && <span aria-hidden className="absolute bottom-3 right-3 h-[7px] w-[7px] rotate-45 opacity-50" style={{ border: `1px solid ${color}` }} />}
      <button
        type="button"
        aria-label={count ? `${tile.label}, ${count}` : tile.label}
        title={tile.description ?? tile.label}
        className={`relative flex w-full flex-1 rounded-[inherit] text-left focus-visible:outline-none ${hero ? 'flex-col justify-between gap-4 p-4 pr-12 sm:p-6 sm:pr-14 @[30rem]:flex-row @[30rem]:items-center @[30rem]:justify-start @[30rem]:gap-5' : 'min-h-[132px] flex-col gap-3 p-3.5 pr-10 sm:min-h-[150px] sm:p-4 sm:pr-11 @[22rem]:min-h-[92px] @[22rem]:flex-row @[22rem]:items-center'}`}
        {...press}
      >
        {dark
          ? <span aria-hidden className="inline-flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-full bg-white/12 text-white ring-1 ring-white/35 shadow-[0_0_0_6px_rgba(255,255,255,0.06)]"><HeroIcon size={28} strokeWidth={1.6} fill="currentColor" fillOpacity={0.18} /></span>
          : <Medallion icon={tile.icon} color={color} size={hero ? 58 : 44} solid={hero} />}
        <span className="flex min-w-0 flex-1 flex-col">
          {eyebrow && <span className="eyebrow mb-1 !text-[10px]" style={{ color }}>{eyebrow}</span>}
          <span className={`font-display block leading-[1.12] ${hero ? 'text-[22px] sm:text-[27px]' : 'text-[16px] sm:text-[18px]'} ${dark ? 'text-white' : 'text-night-900'}`} style={{ fontWeight: hero ? 540 : 560 }}>{tile.label}</span>
          {tile.description && <span className={`mt-1 block leading-snug ${hero ? 'max-w-md text-[13.5px] sm:text-[15px]' : 'line-clamp-2 text-[12.5px] sm:text-[13px]'} ${dark ? 'text-white/80' : 'text-mist-500'}`}>{tile.description}</span>}
          {count && (
            <span className={`mt-2 inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-[3px] text-[12px] font-semibold leading-none ${dark ? 'bg-white/15 text-white' : ''}`} style={dark ? undefined : { color, background: `color-mix(in srgb, ${color} 9%, transparent)` }}>
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: dark ? '#fff' : color }} />{count}
            </span>
          )}
          {hero && (
            <span className={`mt-3 inline-flex items-center gap-1 text-[13px] font-semibold ${dark ? 'text-white' : ''}`} style={dark ? undefined : { color }}>
              Ouvrir <ArrowUpRight size={15} strokeWidth={2.2} className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          )}
        </span>
      </button>
      <FavoriteToggle label={tile.label} favorite={favorite} onToggle={onToggleFavorite} light={dark} className="absolute right-1.5 top-1.5 sm:right-2.5 sm:top-2.5" />
    </div>
  )
}

/** Disposition des cartes vedettes : la première est large (héros), la dernière s'étire pour compléter la rangée. */
export function featureSpan(index: number, total: number): string {
  if (index === 0) return 'col-span-2'
  if (index !== total - 1) return ''
  const phone = (total - 1) % 2 === 1 ? 'col-span-2' : ''
  const rest = (total - 2) % 3
  const lg = rest === 1 ? 'lg:col-span-3' : rest === 2 ? 'lg:col-span-2' : phone ? 'lg:col-span-1' : ''
  return `${phone} ${lg}`.trim()
}

export function FeatureGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3">{children}</div>
}

/** Intitulé de groupe : capitales espacées et filet. */
export function GroupLabel({ children, color, className = '' }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <h2 className={`eyebrow flex items-center gap-3 text-mist-500 ${className}`} style={color ? { color } : undefined}>
      <span className="shrink-0">{children}</span>
      <span aria-hidden className="h-px flex-1 bg-[var(--hairline)]" />
    </h2>
  )
}

/** Table des matières : liste des autres outils d'un chapitre, dans une seule feuille de papier. */
export function IndexList({ children }: { children: ReactNode }) {
  return (
    <div className="paper overflow-hidden px-1.5 py-1 sm:px-3 sm:py-2">
      <ul className="grid sm:grid-cols-2 sm:gap-x-6 lg:grid-cols-3">{children}</ul>
    </div>
  )
}

export function IndexRow({ tile, color, count, favorite, onOpen, onToggleFavorite, delay = 0 }: {
  tile: Tile; color: string; count?: string | null; favorite: boolean; onOpen: () => void; onToggleFavorite: () => void; delay?: number
}) {
  const press = usePress(onOpen, onToggleFavorite)
  return (
    <li className="tile-in group relative border-b border-[var(--hairline)] last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+3)]:border-b-0" style={{ animationDelay: `${delay}ms` }}>
      <button
        type="button"
        aria-label={count ? `${tile.label}, ${count}` : tile.label}
        title={tile.description ?? tile.label}
        className="flex w-full select-none items-center gap-3 rounded-xl px-2 py-2.5 pr-[60px] text-left transition-colors duration-150 [-webkit-touch-callout:none] hover:bg-black/[0.025] active:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ios-blue/25"
        {...press}
      >
        <Medallion icon={tile.icon} color={color} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium text-night-900">{tile.label}</span>
          {count && <span className="block truncate text-[12px] text-mist-500">{count}</span>}
        </span>
        
      </button>
      <ChevronRight aria-hidden size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-mist-300 transition-transform group-hover:translate-x-0.5" />
      <FavoriteToggle label={tile.label} favorite={favorite} onToggle={onToggleFavorite} className="absolute right-[26px] top-1/2 -translate-y-1/2" />
    </li>
  )
}
