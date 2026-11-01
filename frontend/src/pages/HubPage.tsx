import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../store'
import { SECTION_BY_ID, type SectionId } from '../navigation/sections'
import { SECTION_STYLE } from '../navigation/sectionStyle'
import { favoriteKey, toggleFavorite, useFavorites } from '../navigation/favorites'
import { FeatureCard, FeatureGrid, GroupLabel, IndexList, IndexRow, featureSpan, tileCount } from '../components/shell/HubGrid'
import { Medallion, PageHeader } from '../components/brand/Brand'

/** Page d'un chapitre (/section/:id) : en-tête éditorial, cartes vedettes puis table des autres outils. */
export default function HubPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { dashboard, notify } = useApp()
  const favorites = useFavorites()
  const section = id && id in SECTION_BY_ID ? SECTION_BY_ID[id as SectionId] : null
  if (!section) return <Navigate to="/" replace />
  if (section.id === 'favoris') return <Navigate to="/favoris" replace />

  const style = SECTION_STYLE[section.id]
  const ai = section.id === 'recherche'
  const featured = section.tiles.filter((t) => t.featured)
  const others = section.tiles.filter((t) => !t.featured)
  const toggle = (tileId: string, label: string) => {
    const on = toggleFavorite(favoriteKey(section.id, tileId))
    notify(on ? 'success' : 'info', on ? `« ${label} » ajouté aux favoris` : `« ${label} » retiré des favoris`)
  }

  return (
    <div className="mx-auto max-w-[1080px] pb-4">
      <PageHeader
        eyebrow={style.eyebrow}
        numeral={`Chapitre ${style.numeral}`}
        title={section.title}
        description={style.description}
        color={style.tone}
        aside={<Medallion icon={section.icon} color={style.tone} size={76} />}
      />

      {featured.length > 0 && (
        <FeatureGrid>
          {featured.map((t, i) => (
            <FeatureCard
              key={t.id}
              tile={t}
              color={style.tone}
              tint={style.tint}
              hero={i === 0}
              ai={ai}
              className={featureSpan(i, featured.length)}
              delay={i * 35}
              count={tileCount(t, dashboard)}
              favorite={favorites.includes(favoriteKey(section.id, t.id))}
              onOpen={() => nav(t.route)}
              onToggleFavorite={() => toggle(t.id, t.label)}
            />
          ))}
        </FeatureGrid>
      )}

      {others.length > 0 && (
        <section className="mt-7 sm:mt-10">
          <GroupLabel className="mb-3">Tous les outils du chapitre</GroupLabel>
          <IndexList>
            {others.map((t, i) => (
              <IndexRow
                key={t.id}
                tile={t}
                color={style.tone}
                delay={(featured.length + i) * 25}
                count={tileCount(t, dashboard)}
                favorite={favorites.includes(favoriteKey(section.id, t.id))}
                onOpen={() => nav(t.route)}
                onToggleFavorite={() => toggle(t.id, t.label)}
              />
            ))}
          </IndexList>
        </section>
      )}
      <p className="mt-6 text-center text-[12px] text-mist-400 sm:mt-8">Astuce : un appui long (ou ☆) sur un outil l’ajoute à vos favoris.</p>
    </div>
  )
}
