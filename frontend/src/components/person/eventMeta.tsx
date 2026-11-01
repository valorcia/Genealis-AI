import type { LucideIcon } from 'lucide-react'
import {
  Archive, Award, Baby, BadgeCheck, Ban, BookOpen, BookOpenCheck, Briefcase, CalendarPlus, Church, Cross, Crown, Droplet, Droplets,
  FileBadge, FileCheck, FilePen, Files, Flag, Flame, Flower2, Gavel, Gem, Globe, GraduationCap, Hammer, Hand, HandHeart, HandHelping,
  Handshake, Heart, HeartCrack, HeartHandshake, HeartOff, House, IdCard, Landmark, LandPlot, Medal, Megaphone, PenLine, PlaneLanding,
  PlaneTakeoff, Ribbon, Scale, School, ScrollText, Shield, ShieldOff, Shovel, Sparkles, Star, Stethoscope, Sunset, Tag, Users, Wrench,
} from 'lucide-react'
import { EVENT_LABEL } from '../../api'

/** Événements qui concernent un couple (enregistrés sur la famille, il faut choisir le conjoint). */
export const FAMILY_EVENT_TYPES = ['engagement', 'marriage_banns', 'marriage_contract', 'prenuptial_contract', 'marriage_license', 'marriage', 'civil_marriage', 'religious_marriage', 'pacs', 'conciliation', 'separation', 'annulment', 'divorce']
export const MARRIAGE_TYPES = ['marriage', 'civil_marriage', 'religious_marriage']

export const EVENT_ICON: Record<string, LucideIcon> = {
  // Personnels
  birth: Star, baptism: Droplets, adult_baptism: Droplet, child_baptism: Baby, circumcision: Ribbon, bar_mitzvah: BookOpenCheck,
  bat_mitzvah: BookOpenCheck, blessing: Hand, confirmation: Church, first_communion: Church, confession: HandHelping, consecration: Sparkles,
  excommunication: Ban, mission: Globe, education: BookOpen, training: School, apprenticeship: Wrench, graduation: GraduationCap,
  occupation: Hammer, retirement: Sunset, military: Medal, military_enlistment: Shield, military_discharge: ShieldOff, military_award: Award,
  residence: House, census: Users, immigration: PlaneLanding, emigration: PlaneTakeoff, naturalization: Flag, nationality: IdCard,
  nickname: Tag, nobility_title: Crown, land_transaction: LandPlot, signature: PenLine, documents: Files, heredity_certificate: FileBadge,
  adoption: HandHeart, illness: Stethoscope, miscarriage: HeartOff, will: ScrollText, probate: Scale, death: Cross, funeral: Flower2,
  burial: Shovel, cremation: Flame,
  // Familiaux
  engagement: Gem, marriage_banns: Megaphone, marriage_contract: FilePen, prenuptial_contract: FileCheck, marriage_license: BadgeCheck,
  marriage: Heart, civil_marriage: Landmark, religious_marriage: Church, pacs: HeartHandshake, conciliation: Handshake,
  separation: HeartCrack, annulment: Gavel, divorce: HeartCrack,
  other: CalendarPlus,
}
export const eventIcon = (t: string): LucideIcon => EVENT_ICON[t] ?? (t.includes('birth') ? Baby : t.includes('work') ? Briefcase : Archive)
export const eventLabel = (t: string) => EVENT_LABEL[t] ?? t

/** Couleur d'accent par grande famille d'événements (pastilles, icônes). */
export function eventTint(t: string): string {
  if (['birth', 'baptism', 'adult_baptism', 'child_baptism', 'adoption', 'circumcision'].includes(t)) return '#2e9a52'
  if (FAMILY_EVENT_TYPES.includes(t)) return '#d6456b'
  if (['death', 'burial', 'cremation', 'funeral', 'probate', 'will', 'miscarriage'].includes(t)) return '#52607d'
  if (t.startsWith('military')) return '#8f520b'
  return '#2f6fd1'
}

const byLabel = (a: string, b: string) => eventLabel(a).localeCompare(eventLabel(b), 'fr')

/**
 * Types proposés à l'ajout, comme la feuille « Ajouter un événement » de MacFamilyTree :
 * événements personnels puis familiaux (avec un conjoint), chacun par ordre alphabétique, « Autre » en dernier.
 */
export function eventTypeGroups(): { title: string; family: boolean; types: string[] }[] {
  const family = new Set(FAMILY_EVENT_TYPES)
  const personal = Object.keys(EVENT_LABEL).filter((k) => !family.has(k) && k !== 'other').sort(byLabel)
  return [
    { title: 'Événements personnels', family: false, types: [...personal, 'other'] },
    { title: 'Événements familiaux (avec un conjoint)', family: true, types: FAMILY_EVENT_TYPES.filter((k) => k in EVENT_LABEL).sort(byLabel) },
  ]
}
