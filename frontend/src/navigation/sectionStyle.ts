import { SECTIONS, type SectionId } from './sections'

/**
 * Identité visuelle « archive » de chaque chapitre (catégorie) de GENEALIS.
 * sections.ts reste la source de vérité (routes, tuiles, couleurs historiques) ; ce fichier ajoute
 * uniquement des champs de présentation : teinte sourde (encre), fond pâle, numéro de chapitre, accroche.
 * Le violet est réservé à tout ce qui touche à la Recherche IA.
 */
export interface SectionStyle {
  /** Couleur d'encre sourde du chapitre (texte, icônes, filets). */
  tone: string
  /** Variante plus profonde (dégradés, survols). */
  deep: string
  /** Fond très pâle (médaillons, cartes vedettes). */
  tint: string
  /** Numéro de chapitre en chiffres romains (en-têtes éditoriaux). */
  numeral: string
  /** Petite accroche en capitales au-dessus du titre. */
  eyebrow: string
  /** Une phrase pour expliquer le chapitre à un débutant. */
  description: string
}

export const SECTION_STYLE: Record<SectionId, SectionStyle> = {
  recherche: { tone: '#5b3fd6', deep: '#3f2a9e', tint: '#efeafc', numeral: 'I', eyebrow: 'Le cœur de Genealis', description: 'Votre généalogiste IA cherche, vérifie ses sources et ne vous consulte que lorsque c’est utile.' },
  livre: { tone: '#7a4f2a', deep: '#5a3819', tint: '#f3e9d8', numeral: 'II', eyebrow: 'Le récit de la famille', description: 'L’histoire de vos ancêtres mise en page comme un livre, prête à lire et à imprimer.' },
  editer: { tone: '#2c4a7c', deep: '#1c3259', tint: '#e7ecf3', numeral: 'III', eyebrow: 'L’atelier', description: 'Ajoutez et corrigez les personnes, les lieux, les sources et les documents.' },
  graphiques: { tone: '#2f7a76', deep: '#1f5753', tint: '#e2efec', numeral: 'IV', eyebrow: 'Voir l’arbre autrement', description: 'Arbres, éventails, sabliers : votre famille dessinée sous toutes ses formes.' },
  vues: { tone: '#4f7349', deep: '#37542f', tint: '#e8eee2', numeral: 'V', eyebrow: 'Explorer', description: 'Cartes, globe et arbre en volume pour parcourir les lieux et les générations.' },
  rapports: { tone: '#a9532f', deep: '#7f3b1f', tint: '#f5e6dc', numeral: 'VI', eyebrow: 'Synthèses écrites', description: 'Des fiches et rapports clairs, à consulter ou à imprimer.' },
  listes: { tone: '#8a3d60', deep: '#652944', tint: '#f3e4ea', numeral: 'VII', eyebrow: 'Le registre', description: 'Toutes vos données sous forme de listes à trier et à vérifier.' },
  publication: { tone: '#5e3a6e', deep: '#432650', tint: '#ece4ef', numeral: 'VIII', eyebrow: 'Partager', description: 'Exportez, publiez et sauvegardez votre travail.' },
  favoris: { tone: '#94702c', deep: '#6e521c', tint: '#f4ecd9', numeral: '★', eyebrow: 'Votre sélection', description: 'Les outils que vous utilisez le plus, à portée de main.' },
}

const BY_COLOR = new Map<string, string>(SECTIONS.map((s) => [s.color.toLowerCase(), SECTION_STYLE[s.id].tone]))

/** Convertit une couleur historique (vive) de sections.ts en sa teinte « archive » sourde ; sinon renvoie la couleur telle quelle. */
export function toneForColor(color: string | undefined, fallback = SECTION_STYLE.editer.tone): string {
  if (!color) return fallback
  return BY_COLOR.get(color.toLowerCase()) ?? color
}

export function sectionStyle(id: SectionId): SectionStyle { return SECTION_STYLE[id] }
