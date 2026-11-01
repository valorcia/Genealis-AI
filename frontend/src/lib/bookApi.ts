/** Client de l'API « Livre de famille » (chapitres par personne, annexes, faits à trouver). */
import { req, q, type Confidence } from '../api'

export interface BookChapterRef {
  number: number; person_id: string; name: string; given_names: string | null; surname: string | null; sex: 'M' | 'F' | null
  sosa: number[]; is_ancestor: boolean; is_root: boolean; generation: number | null
  birth_year: number | null; death_year: number | null; years: string; birth_place: string | null; death_place: string | null
  place: string | null; occupation: string | null; portrait_media_id: string | null; confidence: Confidence
}
export interface BookOutline {
  title: string; surnames: string[]; span: { start: number | null; end: number | null }; root_id: string | null
  counts: { persons: number; ancestors: number; generations: number; places: number; sources: number; media: number }
  chapters: BookChapterRef[]
  annexes: { trades: number; places: number; dates_to_find: number; acts_to_find: number }
}
export interface BookSourceRef { citation_id: string; source_id: string; title: string | null; excerpt: string | null; confidence: Confidence }
export interface BookParagraph { type: 'paragraph'; kind: string; text: string; sources: BookSourceRef[]; event_ids: string[]; confidence: Confidence | null }
export interface EpochItem { start: number; end: number; label: string; text: string | null; age_line: string; origin: string }
export interface BookBox {
  type: 'box'; kind: 'village' | 'metier' | 'epoque' | 'quotidien' | string
  title: string; text?: string | null; url?: string | null; image?: string | null; coat_of_arms?: string | null; origin?: string | null
  description?: string | null; definition?: string | null; occupation?: string; items?: EpochItem[]; period?: string; place_id?: string
}
export type BookBlock = BookParagraph | BookBox
export interface LifePlace { n: number; place_id: string | null; name: string | null; full_name: string | null; lat: number | null; lon: number | null; years: number[]; labels: string[]; year_start: number | null; year_end: number | null }
export interface BookPersonRef { id: string; name: string; sex: 'M' | 'F' | null; years: string; sosa: number[]; occupation: string | null; extra?: string }
export interface FamilyRow { role: string; persons: BookPersonRef[] }
export interface Landmark { event_id: string | null; event_type: string; label: string; date: string | null; place: string | null; value: string | null; confidence: Confidence }
export interface Participant { name: string; role: string; role_label: string; age: string | null; occupation: string | null; residence: string | null; relation: string | null }
export interface AroundEvent { event_id: string; event_type: string; label: string; date: string | null; place: string | null; officer: string | null; participants: Participant[] }
export interface BookDocument {
  kind: 'media' | 'source'; id: string; title: string; url?: string | null; mime_type?: string; media_kind?: string; is_image?: boolean
  transcription?: string | null; source_id?: string | null; repository?: string | null; reference?: string | null; year?: number | null
  reliability?: string; register_type?: string | null
}
export interface BookAct {
  event_id: string | null; event_type: string | null; title: string; date: string | null; place: string | null; act_number: string | null
  officer: string | null; image_url: string | null; media_id: string | null; file_url: string | null; transcription: string | null
  source: { id: string; title: string } | null
}
export interface ResearchItem { kind: 'task' | 'question' | 'hypothesis' | 'contradiction' | 'missing'; id: string; title: string; status?: string; link: string }
export interface AiStory { text: string; provider: string; model: string; created_at: string; stale: boolean; label: string; facts?: string[] }
export interface BookChapter {
  person_id: string; name: string; given_names: string | null; surname: string | null; married_name: string | null; sex: 'M' | 'F' | null
  is_living: boolean | null; is_root: boolean; portrait_media_id: string | null; confidence: Confidence
  birth_year: number | null; death_year: number | null; years: string; place: string | null
  sosa: number[]; generation: number | null; ancestor_generation: number | null; lineage_child: { id: string; name: string; sex: string | null } | null
  root_id: string | null; blocks: BookBlock[]; facts_hash: string; places: LifePlace[]; family: FamilyRow[]; landmarks: Landmark[]
  people_around: AroundEvent[]; documents: BookDocument[]; acts: BookAct[]; research: ResearchItem[]; ai_story: AiStory | null
  wiki_offline: boolean; sources_note: string
}
export interface WikiContext { title: string; description: string | null; extract: string | null; url: string; image: string | null; coat_of_arms: string | null; source: string }
export interface TradeAnnex {
  key: string; label: string; in_dictionary: boolean; definition: string | null; description: string | null; category: string | null
  origin: string | null; forms: string[]; persons: (BookPersonRef & { years_mentioned: number[] })[]; family_line: string; wiki: WikiContext | null
}
export interface PlaceAnnex {
  place_id: string; name: string; department: string | null; region: string | null; country: string | null; lat: number | null; lon: number | null
  historical_names: string[]; year_start: number | null; year_end: number | null
  ancestors: { id: string; name: string; sex: string | null; sosa: number[]; detail: string; first_year: number | null }[]
  ancestors_line: string; timeline: { start: number; end: number; label: string; text: string | null; origin: string }[]; wiki: WikiContext | null
}
export interface TodoItem { key: string; label: string; event_id: string | null }
export interface TodoRow { person_id: string; name: string; sex: string | null; sosa: number[]; years: string; items: TodoItem[] }
export interface BookTodo { dates: TodoRow[]; acts: TodoRow[]; counts: { dates: number; acts: number; persons_dates: number; persons_acts: number } }

let outlineCache: { at: number; data: Promise<BookOutline> } | null = null

export const bookApi = {
  /** Sommaire (mis en cache 30 s pour la navigation entre chapitres). */
  outline: (fresh = false) => {
    if (!fresh && outlineCache && Date.now() - outlineCache.at < 30_000) return outlineCache.data
    const data = req<BookOutline>('/api/book/outline')
    outlineCache = { at: Date.now(), data }
    data.catch(() => { outlineCache = null })
    return data
  },
  chapter: (id: string, wiki = true) => req<BookChapter>(`/api/book/person/${id}${q({ wiki: wiki ? undefined : 'false' })}`),
  rewrite: (id: string) => req<AiStory>(`/api/book/person/${id}/rewrite`, { method: 'POST' }),
  deleteRewrite: (id: string) => req<{ removed: boolean }>(`/api/book/person/${id}/rewrite`, { method: 'DELETE' }),
  trades: () => req<TradeAnnex[]>('/api/book/annexes/trades'),
  places: () => req<PlaceAnnex[]>('/api/book/annexes/places'),
  todo: () => req<BookTodo>('/api/book/todo'),
}

/** Libellé de génération : « Moi », « Mes parents », « Mes grands-parents », « 4e génération »… */
export function generationLabel(gen: number): string {
  if (gen === 1) return 'La personne de départ'
  if (gen === 2) return 'Les parents'
  if (gen === 3) return 'Les grands-parents'
  if (gen === 4) return 'Les arrière-grands-parents'
  return `${gen}e génération`
}
