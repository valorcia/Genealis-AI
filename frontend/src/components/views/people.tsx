import type { ReactNode } from 'react'
import type { PersonSummary } from '../../api'
import { ConfidenceDot } from '../ui'
import { Card, PersonAvatar } from './common'

/** Nom d'une génération relative à la personne centrale (positif = ancêtres, négatif = descendants). */
export function generationName(level: number) {
  const names: Record<number, string> = {
    0: 'Personne centrale', 1: 'Parents', 2: 'Grands-parents', 3: 'Arrière-grands-parents', 4: 'Trisaïeux',
    [-1]: 'Enfants', [-2]: 'Petits-enfants', [-3]: 'Arrière-petits-enfants',
  }
  if (names[level]) return names[level]
  return level > 0 ? `Ancêtres · génération ${level}` : `Descendants · génération ${-level}`
}

/** Âge au format « (82a 5m 12j) » ou « (≈ 82 ans) ». */
export function ageText(p: Pick<PersonSummary, 'age_detail' | 'age_display'>) {
  const v = p.age_detail || p.age_display
  return v ? `(${v.replace(/ a /, 'a ').replace(/ m /, 'm ').replace(/ j$/, 'j')})` : ''
}

/** Carte d'identité façon MobileFamilyTree : nom en gras, Naissance date + lieu, Décès date + âge. */
export function PersonFactsCard({ p, color, extra, className = '' }: { p: PersonSummary; color?: string; extra?: ReactNode; className?: string }) {
  const deceased = !!(p.death_display || p.death_year)
  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <PersonAvatar p={p} size={54} ring />
        <div className="min-w-0 flex-1 pr-6">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[17px] font-bold text-night-900">{p.display_name}</h3>
            <ConfidenceDot level={p.confidence} />
          </div>
          {p.occupation && <p className="truncate text-xs text-mist-500">{p.occupation}</p>}
          <dl className="mt-1.5 space-y-0.5 text-[13px] leading-snug">
            <div className="flex gap-2"><dt className="w-[68px] shrink-0 font-medium" style={{ color }}>Naissance</dt><dd className="min-w-0 text-night-900">{p.birth_display ?? (p.birth_year ? String(p.birth_year) : '—')}{p.birth_place && <span className="text-mist-500"> · {p.birth_place}</span>}</dd></div>
            {(deceased || p.is_living === false) && (
              <div className="flex gap-2"><dt className="w-[68px] shrink-0 font-medium" style={{ color }}>Décès</dt><dd className="min-w-0 text-night-900">{p.death_display ?? (p.death_year ? String(p.death_year) : 'date inconnue')} {p.age_context === 'au décès' && <span className="text-mist-500">{ageText(p)}</span>}{p.death_place && <span className="text-mist-500"> · {p.death_place}</span>}</dd></div>
            )}
            {!deceased && p.age_display && p.age_context !== 'au décès' && (
              <div className="flex gap-2"><dt className="w-[68px] shrink-0 font-medium" style={{ color }}>Âge</dt><dd className="text-night-900">{p.age_display} <span className="text-mist-500">{p.age_context}</span></dd></div>
            )}
          </dl>
        </div>
      </div>
      {extra}
    </Card>
  )
}
