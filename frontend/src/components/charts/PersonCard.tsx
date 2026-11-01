import { memo, type CSSProperties } from 'react'
import { Plus } from 'lucide-react'
import type { PersonSummary } from '../../api'
import { Avatar } from './Avatar'
import { birthText, deathAge, deathText, fullName, SEX_TINT, SEX_TINT_BLUE, sexKey } from './format'

export type CardColorMode = 'sex' | 'blue' | 'white'
export interface CardOptions { showPlaces: boolean; showPhotos: boolean; colorMode: CardColorMode; showSosa?: boolean }
export const DEFAULT_CARD_OPTIONS: CardOptions = { showPlaces: true, showPhotos: true, colorMode: 'sex', showSosa: false }

/** Dimensions fixes des cartes (les mises en page en dépendent). */
export function cardSize(variant: 'card' | 'compact', opts: CardOptions) {
  if (variant === 'compact') return { w: 196, h: 64 }
  return { w: 236, h: opts.showPlaces ? 118 : 78 }
}

export function cardBackground(p: PersonSummary | null, mode: CardColorMode) {
  const k = sexKey(p)
  if (mode === 'white') return '#ffffff'
  return mode === 'blue' ? SEX_TINT_BLUE[k] : SEX_TINT[k]
}

/**
 * Carte de personne au style « Arbre généalogique intégral » de MacFamilyTree :
 * nom en gras, lignes Naissance / Décès avec date, âge et lieu ; teinte verte (homme) ou lilas (femme).
 */
export const PersonCard = memo(function PersonCard({
  person, variant = 'card', opts = DEFAULT_CARD_OPTIONS, root = false, selected = false, sosa, onClick, className = '', style,
}: {
  person: PersonSummary; variant?: 'card' | 'compact'; opts?: CardOptions; root?: boolean; selected?: boolean; sosa?: number | null
  onClick?: (p: PersonSummary) => void; className?: string; style?: CSSProperties
}) {
  const { w, h } = cardSize(variant, opts)
  // Numéro Sosa : celui fourni par le graphique, sinon celui de la personne (affiché dès qu'elle est dans l'ascendance).
  const sosaNum = sosa ?? (person.sosa && person.sosa.length ? Math.min(...person.sosa) : null)
  const showSosa = sosaNum != null && (opts.showSosa || (person.sosa?.length ?? 0) > 0)
  const birth = birthText(person), death = deathText(person), age = deathAge(person)
  const border = root ? 'border-[3px] border-[#7d828f]' : selected ? 'border-2 border-[#2f6fd1]' : 'border border-black/10'
  const base = `group relative flex flex-col overflow-hidden text-left text-night-900 shadow-[0_6px_16px_-8px_rgba(25,35,70,0.35)] transition-transform ${onClick ? 'cursor-pointer hover:-translate-y-0.5' : ''} ${border} ${className}`
  if (variant === 'compact') {
    return (
      <div role={onClick ? 'button' : undefined} onClick={onClick ? () => onClick(person) : undefined} className={`${base} flex-row items-center gap-2 rounded-2xl px-2.5`} style={{ width: w, height: h, background: cardBackground(person, opts.colorMode), ...style }} title={fullName(person)}>
        {opts.showPhotos && <Avatar person={person} size={40} />}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold">{fullName(person)}</div>
          <div className="truncate text-[11px] text-mist-500">{compactDates(person, birth, death)}</div>
        </div>
        {showSosa && <span className="absolute right-1.5 top-1 rounded-full bg-brass-200/70 px-1 text-[9px] font-semibold tabular-nums text-brass-600" title={`Sosa ${sosaNum}`}>{sosaNum}</span>}
      </div>
    )
  }
  return (
    <div role={onClick ? 'button' : undefined} onClick={onClick ? () => onClick(person) : undefined} className={`${base} rounded-xl px-2.5 pb-1.5 pt-1.5`} style={{ width: w, height: h, background: cardBackground(person, opts.colorMode), ...style }} title={fullName(person)}>
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1 truncate pt-0.5 text-center text-[13.5px] font-bold leading-tight">{fullName(person)}</div>
        {opts.showPhotos && person.portrait_media_id && <Avatar person={person} size={30} shape="square" />}
      </div>
      <div className="mt-1 space-y-0.5 text-[10.5px] leading-[1.25]">
        <Row label="Naissance" date={birth} place={opts.showPlaces ? person.birth_place : null} />
        {(death || person.death_place || person.is_living === false) && <Row label="Décès" date={death ? `${death}${age ? ` (${age})` : ''}` : null} place={opts.showPlaces ? person.death_place : null} />}
      </div>
      {showSosa && <span className="absolute bottom-1 left-2 rounded-full bg-brass-200/70 px-1.5 text-[9px] font-semibold tabular-nums text-brass-600">Sosa {sosaNum}</span>}
    </div>
  )
})

function compactDates(p: PersonSummary, birth: string | null, death: string | null) {
  if (!birth && !death) return 'Dates inconnues'
  const long = (birth?.length ?? 0) + (death?.length ?? 0) > 20
  const b = long ? (p.birth_year ? String(p.birth_year) : birth) : birth
  const d = long ? (p.death_year ? String(p.death_year) : death) : death
  return `${b ? `☆ ${b}` : ''}${d ? `${b ? '  ' : ''}† ${d}` : ''}`
}

function Row({ label, date, place }: { label: string; date: string | null; place: string | null }) {
  return (
    <div>
      <div className="flex justify-between gap-2"><span className="font-semibold text-night-900/80">{label}</span><span className="truncate tabular-nums">{date ?? '—'}</span></div>
      {place && <div className="line-clamp-2 text-right text-night-900/70">{place}</div>}
    </div>
  )
}

/** Case vide « ? » pour une personne inconnue (jamais de donnée inventée). */
export function EmptyCard({ label, w, h, onAdd, compact = false }: { label: string; w: number; h: number; onAdd?: () => void; compact?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-mist-300 bg-white/50 text-mist-400 ${onAdd ? 'cursor-pointer hover:border-[#2f6fd1] hover:text-[#2f6fd1]' : ''}`} style={{ width: w, height: h }}
      onClick={onAdd} role={onAdd ? 'button' : undefined} title={onAdd ? `${label} : ajouter` : label}>
      <span className={`flex items-center justify-center rounded-full bg-mist-100 font-semibold ${compact ? 'h-6 w-6 text-xs' : 'h-8 w-8 text-sm'}`}>?</span>
      <span className="text-xs">{label}</span>
      {onAdd && <Plus size={14} />}
    </div>
  )
}
