/** Catégories d'événements partagées par le globe, les cartes statistiques et les listes. */
export type EventCat = 'naissances' | 'mariages' | 'deces' | 'residences' | 'migrations' | 'autres'
export const EVENT_CATS: { id: EventCat; label: string; types: string[]; color: string }[] = [
  { id: 'naissances', label: 'Naissances', types: ['birth', 'baptism'], color: '#2e9a52' },
  { id: 'mariages', label: 'Mariages', types: ['marriage', 'civil_marriage', 'religious_marriage', 'marriage_banns', 'marriage_contract', 'marriage_license', 'engagement', 'pacs', 'divorce', 'separation'], color: '#e0a21a' },
  { id: 'deces', label: 'Décès', types: ['death', 'burial', 'cremation', 'will', 'probate'], color: '#47506a' },
  { id: 'residences', label: 'Résidences', types: ['residence', 'census', 'occupation', 'education', 'graduation', 'retirement'], color: '#2f6fd1' },
  { id: 'migrations', label: 'Migrations', types: ['immigration', 'emigration', 'naturalization', 'military'], color: '#8a35b8' },
  { id: 'autres', label: 'Autres', types: [], color: '#9aa1ad' },
]
const CAT_OF = new Map<string, EventCat>(EVENT_CATS.flatMap((c) => c.types.map((t) => [t, c.id] as [string, EventCat])))
export const catOf = (t: string): EventCat => CAT_OF.get(t) ?? 'autres'
export const CAT_COLOR = Object.fromEntries(EVENT_CATS.map((c) => [c.id, c.color])) as Record<EventCat, string>
export const MARRIAGE_TYPES = EVENT_CATS[1].types
