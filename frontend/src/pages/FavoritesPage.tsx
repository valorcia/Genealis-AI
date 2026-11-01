import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RotateCcw, Star, SlidersHorizontal, X } from 'lucide-react'
import { useApp } from '../store'
import { SECTIONS, SECTION_BY_ID } from '../navigation/sections'
import { SECTION_STYLE } from '../navigation/sectionStyle'
import { favoriteKey, favoriteTiles, resetFavorites, toggleFavorite, useFavorites } from '../navigation/favorites'
import { FeatureCard, tileCount } from '../components/shell/HubGrid'
import { Medallion, PageHeader } from '../components/brand/Brand'

export default function FavoritesPage() {
  const nav = useNavigate()
  const { dashboard } = useApp()
  const favorites = useFavorites()
  const [picking, setPicking] = useState(false)
  const section = SECTION_BY_ID.favoris
  const style = SECTION_STYLE.favoris
  const tiles = favoriteTiles(favorites)

  return (
    <div className="mx-auto max-w-[1080px] pb-4">
      <PageHeader
        eyebrow={style.eyebrow}
        title={section.title}
        description={style.description}
        color={style.tone}
        aside={
          <button onClick={() => setPicking(true)} className="btn-ghost !rounded-full !px-4">
            <SlidersHorizontal size={15} /> Choisir mes favoris
          </button>
        }
      />
      {tiles.length === 0 ? (
        <div className="paper fade-up mx-auto max-w-md p-7 text-center">
          <span className="mx-auto mb-3 inline-flex"><Medallion icon="Star" color={style.tone} size={56} /></span>
          <p className="font-display text-[20px] text-night-900">Aucun favori pour l’instant</p>
          <p className="mt-1 text-sm text-mist-500">Épinglez ici les graphiques, rapports et listes que vous utilisez le plus.</p>
          <button onClick={() => setPicking(true)} className="btn-primary mt-4">Choisir mes favoris</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {tiles.map((t, i) => {
            const st = SECTION_STYLE[t.section]
            return (
              <FeatureCard
                key={`${t.section}:${t.id}`}
                tile={{ ...t, description: undefined }}
                color={st.tone}
                tint={st.tint}
                eyebrow={SECTION_BY_ID[t.section].label}
                delay={i * 30}
                count={tileCount(t, dashboard)}
                favorite
                onOpen={() => nav(t.route)}
                onToggleFavorite={() => toggleFavorite(favoriteKey(t.section, t.id))}
              />
            )
          })}
        </div>
      )}
      <div className="mt-6 flex justify-center sm:hidden">
        <button onClick={() => setPicking(true)} className="btn-ghost !rounded-full !px-5 !py-2.5 !text-[15px]">
          <SlidersHorizontal size={16} /> Choisir mes favoris
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
  return (
    <div className="fade-in fixed inset-0 z-[90] flex items-end justify-center bg-night-950/35 backdrop-blur-[2px] sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choisir mes favoris"
        className="paper-grain sheet-up flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[22px] border border-[var(--hairline)] shadow-[0_-12px_40px_-14px_rgba(14,24,40,0.45)] sm:rounded-[22px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline)] px-5 pb-3 pt-4">
          <div>
            <p className="eyebrow text-brass-600">Favoris</p>
            <h2 className="font-display text-[22px] leading-tight text-night-900">Choisir mes outils</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={resetFavorites} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] font-medium text-mist-500 hover:bg-black/[0.04]" aria-label="Rétablir les favoris par défaut"><RotateCcw size={14} /> Par défaut</button>
            <button onClick={onClose} className="btn-primary !rounded-full !px-4 !py-1.5">OK</button>
          </div>
        </div>
        <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+20px)] pt-4">
          {SECTIONS.filter((s) => s.tiles.length > 0).map((s) => {
            const st = SECTION_STYLE[s.id]
            return (
              <section key={s.id}>
                <h3 className="eyebrow mb-2 flex items-center gap-2 px-1" style={{ color: st.tone }}>
                  <span className="font-display text-[12px] normal-case tracking-normal">{st.numeral}</span> {s.label}
                  <span aria-hidden className="h-px flex-1 bg-[var(--hairline)]" />
                </h3>
                <ul className="divide-y divide-[var(--hairline)] overflow-hidden rounded-2xl border border-[var(--hairline)] bg-ivory-50">
                  {s.tiles.map((t) => {
                    const key = favoriteKey(s.id, t.id)
                    const on = favorites.includes(key)
                    return (
                      <li key={key}>
                        <button role="switch" aria-checked={on} onClick={() => toggleFavorite(key)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-black/[0.02] active:bg-black/[0.035]">
                          <Medallion icon={t.icon} color={st.tone} size={32} />
                          <span className="min-w-0 flex-1 truncate text-[15px] text-night-900">{t.label}</span>
                          <Pin on={on} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
      <button className="sr-only" onClick={onClose} aria-label="Fermer"><X /></button>
    </div>
  )
}

/** Indicateur « épinglé » (décoratif : l'état est porté par le bouton parent role="switch"). */
function Pin({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold transition-colors duration-200 ${on ? 'bg-night-900 text-[#ecd9a6]' : 'border border-[var(--hairline-strong)] text-mist-400'}`}>
      <Star size={13} strokeWidth={2.2} className={on ? 'fill-current' : ''} />
      {on ? 'Épinglé' : 'Épingler'}
    </span>
  )
}
