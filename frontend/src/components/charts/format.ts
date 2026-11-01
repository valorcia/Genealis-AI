import type { PersonSummary } from '../../api'

/** Couleurs partagées par tous les graphiques (style MacFamilyTree, tons pastel clairs). */
export const SEX_TINT = { M: '#eef9e6', F: '#f3eafc', U: '#f4f5f8' } as const
export const SEX_TINT_BLUE = { M: '#e8f0ff', F: '#fdeaf0', U: '#f4f5f8' } as const
export const SEX_STROKE = { M: '#9cc98a', F: '#c4a6e8', U: '#c9ccd6' } as const
export const SEX_INK = { M: '#2f6fd1', F: '#d0577a', U: '#6b7280' } as const
export const PURPLE = '#4b2bb8'
export const GRAPH_COLOR = '#13918c'
export const EDIT_COLOR = '#2f6fd1'

export type SexKey = 'M' | 'F' | 'U'
export const sexKey = (p: { sex: 'M' | 'F' | null } | null | undefined): SexKey => (p?.sex === 'M' ? 'M' : p?.sex === 'F' ? 'F' : 'U')

/** Prénom usuel et nom séparés (le nom en majuscules, comme dans MacFamilyTree). */
export function nameParts(p: Pick<PersonSummary, 'given_names' | 'surname' | 'display_name'>) {
  const given = (p.given_names ?? '').trim()
  const surname = (p.surname ?? '').trim().toUpperCase()
  if (!given && !surname) return { given: p.display_name, surname: '' }
  return { given, surname }
}
export const fullName = (p: Pick<PersonSummary, 'given_names' | 'surname' | 'display_name'>) => {
  const { given, surname } = nameParts(p)
  return [given, surname].filter(Boolean).join(' ') || p.display_name
}
export const firstName = (p: Pick<PersonSummary, 'given_names' | 'display_name'>) => (p.given_names ?? '').trim().split(/\s+/)[0] || p.display_name

/** Date de naissance affichable (jamais inventée : null si inconnue). */
export const birthText = (p: PersonSummary) => p.birth_display ?? (p.birth_year ? String(p.birth_year) : null)
export const deathText = (p: PersonSummary) => p.death_display ?? (p.death_year ? String(p.death_year) : null)

/** Âge compact « (82a 5m 12j) » à partir du détail fourni par le serveur, sinon « ≈ 80 ans ». */
export function ageShort(p: PersonSummary): string | null {
  if (p.age_detail) {
    const m = p.age_detail.match(/(\d+)\s*a\s*(\d+)\s*m\s*(\d+)\s*j/)
    if (m) return `${m[1]}a ${m[2]}m ${m[3]}j`
    return p.age_detail
  }
  return p.age_display ?? null
}
/** Âge au décès seulement (pour la ligne « Décès »). */
export const deathAge = (p: PersonSummary) => (p.age_context === 'au décès' ? ageShort(p) : null)

export function lifeYears(p: PersonSummary) {
  if (!p.birth_year && !p.death_year) return ''
  return `${p.birth_year ?? '?'}–${p.death_year ?? (p.is_living === false ? '?' : '')}`
}

/** Libellé de génération façon MacFamilyTree : départ, +1 (ancêtres), -1 (descendants). */
export function generationLabel(rel: number) {
  if (rel === 0) return 'Génération de départ'
  return `Génération ${rel > 0 ? '+' : ''}${rel}`
}

export function yearRange(persons: PersonSummary[]) {
  const ys = persons.map((p) => p.birth_year).filter((y): y is number => typeof y === 'number')
  if (!ys.length) return ''
  const a = Math.min(...ys), b = Math.max(...ys)
  return a === b ? String(a) : `${a} - ${b}`
}

/** Article défini devant un lien de parenté (« le grand-père », « la tante », « l'arrière-… »). */
export function withArticle(relation: string, sex: 'M' | 'F' | null) {
  if (/^[aeéèêiîoôuy]/i.test(relation)) return `l’${relation}`
  return `${sex === 'F' ? 'la' : 'le'} ${relation}`
}

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Tronque un texte pour tenir dans une largeur approximative (px) selon la taille de police. */
export function fitText(text: string, widthPx: number, fontSize: number) {
  const max = Math.max(1, Math.floor(widthPx / (fontSize * 0.56)))
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}
