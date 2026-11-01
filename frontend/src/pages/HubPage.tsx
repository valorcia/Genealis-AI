import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useApp } from '../store'
import { SECTION_BY_ID, type SectionId } from '../navigation/sections'
import { favoriteKey, toggleFavorite, useFavorites } from '../navigation/favorites'
import { HubTile, HubTitle, TileGradients, TileRow, tileCount } from '../components/shell/HubGrid'

/** Page d'une catégorie (/section/:id) : grand titre coloré et grille de tuiles, comme MacFamilyTree. */
export default function HubPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { dashboard, notify } = useApp()
  const favorites = useFavorites()
  const section = id && id in SECTION_BY_ID ? SECTION_BY_ID[id as SectionId] : null
  if (!section) return <Navigate to="/" replace />
  if (section.id === 'favoris') return <Navigate to="/favoris" replace />

  const featured = section.tiles.filter((t) => t.featured)
  const others = section.tiles.filter((t) => !t.featured)
  const toggle = (tileId: string, label: string) => {
    const on = toggleFavorite(favoriteKey(section.id, tileId))
    notify(on ? 'success' : 'info', on ? `« ${label} » ajouté aux favoris` : `« ${label} » retiré des favoris`)
  }
  const render = (big: boolean) => (t: (typeof section.tiles)[number], i: number) => (
    <HubTile
      key={t.id}
      tile={t}
      color={section.color}
      big={big}
      delay={(big ? 0 : featured.length * 25) + i * 25}
      count={tileCount(t, dashboard)}
      favorite={favorites.includes(favoriteKey(section.id, t.id))}
      onOpen={() => nav(t.route)}
      onToggleFavorite={() => toggle(t.id, t.label)}
    />
  )

  return (
    <div className="mx-auto max-w-[1000px]">
      <TileGradients colors={[section.color]} />
      <HubTitle title={section.title} color={section.color}>
        {section.id === 'recherche' && (
          <p className="mx-auto mt-3 inline-flex max-w-xl items-center gap-2 rounded-2xl bg-white/60 text-left px-4 py-2 text-[13.5px] font-medium shadow-[0_1px_2px_rgba(28,35,51,0.05)] ring-1 ring-white/80 sm:text-[15px]" style={{ color: section.color }}>
            <Sparkles size={16} className="shrink-0" />
            <span>Le généalogiste IA cherche, vérifie et vous consulte seulement si nécessaire.</span>
          </p>
        )}
      </HubTitle>
      <div className="space-y-[10px] sm:space-y-4">
        {featured.length > 0 && <TileRow kind="big">{featured.map(render(true))}</TileRow>}
        {others.length > 0 && <TileRow kind="small">{others.map(render(false))}</TileRow>}
      </div>
      <p className="mt-6 text-center text-xs text-mist-500/80 sm:mt-8">Appui long ou ☆ sur une tuile pour l’ajouter aux favoris.</p>
    </div>
  )
}
