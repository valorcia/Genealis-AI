import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RotateCcw, Star } from 'lucide-react'
import { useApp } from '../store'
import { SECTIONS, SECTION_BY_ID } from '../navigation/sections'
import { NamedIcon } from '../navigation/icons'
import { favoriteKey, favoriteTiles, resetFavorites, toggleFavorite, useFavorites } from '../navigation/favorites'
import { HubTile, HubTitle, TileGradients, TileRow, tileCount } from '../components/shell/HubGrid'

/** Nombre de favoris affichés en grandes tuiles (le reste en petites, comme MacFamilyTree). */
const BIG_COUNT = 5

export default function FavoritesPage() {
  const nav = useNavigate()
  const { dashboard } = useApp()
  const favorites = useFavorites()
  const [picking, setPicking] = useState(false)
  const section = SECTION_BY_ID.favoris
  const tiles = favoriteTiles(favorites)
  const big = tiles.slice(0, BIG_COUNT)
  const small = tiles.slice(BIG_COUNT)
  const render = (isBig: boolean, offset: number) => (t: (typeof tiles)[number], i: number) => (
    <HubTile
      key={`${t.section}:${t.id}`}
      tile={t}
      color={SECTION_BY_ID[t.section].color}
      big={isBig}
      delay={(offset + i) * 25}
      count={tileCount(t, dashboard)}
      favorite
      onOpen={() => nav(t.route)}
      onToggleFavorite={() => toggleFavorite(favoriteKey(t.section, t.id))}
    />
  )

  return (
    <div className="mx-auto max-w-[1000px]">
      <TileGradients colors={SECTIONS.map((s) => s.color)} />
      <HubTitle title={section.title} color={section.color} />
      {tiles.length === 0 ? (
        <div className="fade-up mx-auto max-w-sm rounded-[26px] bg-white/70 p-6 text-center shadow-[0_10px_26px_-14px_rgba(28,40,70,0.3)]">
          <Star size={40} className="mx-auto mb-2 fill-current" style={{ color: section.color }} />
          <p className="text-[15px] font-medium text-night-900">Aucun favori pour l’instant</p>
          <p className="mt-1 text-sm text-mist-500">Épinglez ici les graphiques, rapports et listes que vous utilisez le plus.</p>
        </div>
      ) : (
        <div className="space-y-[10px] sm:space-y-4">
          {big.length > 0 && <TileRow kind="big">{big.map(render(true, 0))}</TileRow>}
          {small.length > 0 && <TileRow kind="small">{small.map(render(false, big.length))}</TileRow>}
        </div>
      )}
      <div className="mt-6 text-center sm:mt-10">
        <button onClick={() => setPicking(true)} className="rounded-full px-5 py-2.5 text-[20px] font-medium tracking-[-0.01em] transition-transform duration-150 hover:bg-white/50 active:scale-95 sm:text-[24px]" style={{ color: section.color }}>
          Sélectionner des favoris…
        </button>
      </div>
      {picking && <FavoritePicker favorites={favorites} onClose={() => setPicking(false)} />}
    </div>
  )
}

function FavoritePicker({ favorites, onClose }: { favorites: string[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const grey = SECTION_BY_ID.favoris.color
  return (
    <div className="fade-in fixed inset-0 z-[90] flex items-end justify-center bg-night-950/30 backdrop-blur-[2px] sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sélectionner des favoris"
        className="sheet-up flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-[#f2f3f7] shadow-[0_-10px_40px_-12px_rgba(28,35,51,0.35)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex items-center justify-between border-b border-black/5 bg-white/80 px-4 py-3 backdrop-blur-xl">
          <button onClick={resetFavorites} className="inline-flex items-center gap-1 text-[15px] font-medium" style={{ color: grey }} aria-label="Rétablir les favoris par défaut"><RotateCcw size={15} /> Défaut</button>
          <span className="absolute left-1/2 -translate-x-1/2 text-[16px] font-semibold text-night-900">Favoris</span>
          <button onClick={onClose} className="text-[16px] font-semibold text-ios-blue">OK</button>
        </div>
        <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+20px)] pt-4">
          {SECTIONS.filter((s) => s.tiles.length > 0).map((s) => (
            <section key={s.id}>
              <h3 className="mb-1.5 flex items-center gap-1.5 px-3 text-[12px] font-semibold uppercase tracking-wider" style={{ color: s.color }}>
                <NamedIcon name={s.icon} size={14} strokeWidth={2.3} /> {s.label}
              </h3>
              <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-2xl bg-white">
                {s.tiles.map((t) => {
                  const key = favoriteKey(s.id, t.id)
                  const on = favorites.includes(key)
                  return (
                    <li key={key}>
                      <button role="switch" aria-checked={on} onClick={() => toggleFavorite(key)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-black/[0.03]">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-white" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${s.color} 75%, white), ${s.color})` }}>
                          <NamedIcon name={t.icon} size={17} strokeWidth={2.1} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[15px] text-night-900">{t.label}</span>
                        <Switch on={on} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Interrupteur iOS (décoratif : l'état est porté par le bouton parent role="switch"). */
function Switch({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`relative inline-block h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${on ? 'bg-[#34c759]' : 'bg-[#e3e4e8]'}`}>
      <span className={`absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-transform duration-200 ${on ? 'translate-x-[20px]' : ''}`} />
    </span>
  )
}
