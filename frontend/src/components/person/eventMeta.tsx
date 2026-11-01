import type { LucideIcon } from 'lucide-react'
import {
  Archive, Baby, BadgeCheck, BookOpen, Briefcase, CalendarPlus, Church, Cross, Droplets, FileSignature, Flag, Flame, Gem, GraduationCap,
  Hammer, Heart, HeartCrack, HeartHandshake, House, Landmark, Medal, Megaphone, PlaneLanding, PlaneTakeoff, Scale, ScrollText, Shovel,
  Star, Sunset, Users,
} from 'lucide-react'
import { EVENT_LABEL } from '../../api'

/** Événements qui concernent un couple (enregistrés sur la famille, il faut choisir le conjoint). */
export const FAMILY_EVENT_TYPES = ['engagement', 'marriage_banns', 'marriage_contract', 'marriage_license', 'marriage', 'civil_marriage', 'religious_marriage', 'pacs', 'separation', 'divorce']
export const MARRIAGE_TYPES = ['marriage', 'civil_marriage', 'religious_marriage']

export const EVENT_ICON: Record<string, LucideIcon> = {
  birth: Star, baptism: Droplets, confirmation: Church, first_communion: Church, education: BookOpen, graduation: GraduationCap,
  occupation: Hammer, military: Medal, residence: House, census: Users, immigration: PlaneLanding, emigration: PlaneTakeoff,
  naturalization: Flag, retirement: Sunset, will: ScrollText, probate: Scale, death: Cross, burial: Shovel, cremation: Flame,
  engagement: Gem, marriage_banns: Megaphone, marriage_contract: FileSignature, marriage_license: BadgeCheck, marriage: Heart,
  civil_marriage: Landmark, religious_marriage: Church, pacs: HeartHandshake, separation: HeartCrack, divorce: HeartCrack,
  other: CalendarPlus,
}
export const eventIcon = (t: string): LucideIcon => EVENT_ICON[t] ?? (t.includes('birth') ? Baby : t.includes('work') ? Briefcase : Archive)
export const eventLabel = (t: string) => EVENT_LABEL[t] ?? t

/** Ordre « MacFamilyTree » des événements personnels proposés à l'ajout. */
const PERSONAL_ORDER = ['birth', 'baptism', 'confirmation', 'first_communion', 'education', 'graduation', 'occupation', 'military', 'residence', 'census', 'immigration', 'emigration', 'naturalization', 'retirement', 'will', 'death', 'burial', 'cremation', 'probate', 'other']

export function eventTypeGroups(): { title: string; family: boolean; types: string[] }[] {
  const known = new Set([...PERSONAL_ORDER, ...FAMILY_EVENT_TYPES])
  const extra = Object.keys(EVENT_LABEL).filter((k) => !known.has(k))
  return [
    { title: 'Événements personnels', family: false, types: [...PERSONAL_ORDER.filter((k) => k in EVENT_LABEL || k === 'other'), ...extra] },
    { title: 'Événements familiaux (avec un conjoint)', family: true, types: FAMILY_EVENT_TYPES.filter((k) => k in EVENT_LABEL) },
  ]
}
