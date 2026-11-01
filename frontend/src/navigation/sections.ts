/**
 * Plan de navigation de GENEALIS AI, inspiré de MacFamilyTree : des catégories colorées,
 * chacune affichée comme une grille de tuiles. La recherche IA est la catégorie centrale (accueil).
 * Ce fichier est la source unique des routes affichées dans les hubs, les favoris et la barre de catégories.
 */
export type SectionId = 'recherche' | 'livre' | 'editer' | 'graphiques' | 'vues' | 'rapports' | 'listes' | 'publication' | 'favoris'

export interface Tile {
  id: string
  label: string
  route: string
  /** Nom d'icône lucide-react (ex. 'Users'), rendu par le composant de tuile. */
  icon: string
  description?: string
  /** Clé du tableau de bord pour afficher un compteur sous le libellé (ex. 'persons'). */
  countKey?: string
  countLabel?: string
  /** Tuile mise en avant (grande taille). */
  featured?: boolean
}

export interface Section {
  id: SectionId
  label: string
  title: string
  icon: string
  /** Couleur principale (texte, icônes) et dégradé de fond de la page. */
  color: string
  gradient: [string, string]
  tiles: Tile[]
}

export const SECTIONS: Section[] = [
  {
    id: 'recherche', label: 'Recherche IA', title: 'Recherche IA', icon: 'Sparkles', color: '#5b3fd6', gradient: ['#ece6ff', '#dcd2ff'],
    tiles: [
      { id: 'centre', label: 'Centre de recherche', route: '/', icon: 'Sparkles', featured: true, description: 'Ce que le généalogiste IA fait et ce qu’il attend de vous' },
      { id: 'demarrer', label: 'Démarrer par mes grands-parents', route: '/demarrer', icon: 'Rocket', featured: true, description: 'Le moyen le plus simple de commencer' },
      { id: 'questions', label: 'Questions', route: '/questions', icon: 'MessageCircleQuestion', featured: true, countKey: 'questions_pending', countLabel: 'en attente' },
      { id: 'importer-document', label: 'Importer un acte ou une photo', route: '/documents/importer', icon: 'FileUp', featured: true, description: 'L’IA lit l’image et propose les ajouts' },
      { id: 'recherches-faites', label: 'Recherches effectuées', route: '/enquetes', icon: 'History', featured: true, countKey: 'tasks_queued', countLabel: 'en file' },
      { id: 'sites', label: 'Sites consultés', route: '/sources-consultees', icon: 'Globe' },
      { id: 'assistant', label: 'Assistant IA', route: '/assistant', icon: 'Bot' },
      { id: 'archives-web', label: 'Documents archivés', route: '/archives?tab=documents', icon: 'Archive', countKey: 'documents_total', countLabel: 'documents' },
      { id: 'connecteurs', label: 'Sources d’archives', route: '/enquetes?tab=connecteurs', icon: 'Landmark' },
      { id: 'insee', label: 'Fichier des décès', route: '/archives?tab=insee', icon: 'BookMarked' },
      { id: 'tableau', label: 'Tableau de bord', route: '/tableau-de-bord', icon: 'LayoutDashboard' },
    ],
  },
  {
    id: 'livre', label: 'Livre', title: 'Livre de famille', icon: 'BookOpen', color: '#8a5a2b', gradient: ['#f7efe2', '#ecdcc2'],
    tiles: [
      { id: 'livre', label: 'Le livre de la famille', route: '/livre', icon: 'BookOpen', featured: true, description: 'L’histoire de chaque ancêtre, page par page' },
      { id: 'chapitre', label: 'Ma vie, racontée', route: '/livre/personne', icon: 'Feather', featured: true, description: 'La biographie d’une personne' },
      { id: 'metiers', label: 'Métiers', route: '/livre/metiers', icon: 'Hammer', featured: true },
      { id: 'villages', label: 'Villages', route: '/livre/villages', icon: 'Church', featured: true },
      { id: 'histoire', label: 'Histoire familiale', route: '/histoire', icon: 'NotebookPen' },
      { id: 'pdf', label: 'Imprimer le livre', route: '/livre?imprimer=1', icon: 'Printer' },
    ],
  },
  {
    id: 'editer', label: 'Éditer', title: 'Éditer', icon: 'Pencil', color: '#2f6fd1', gradient: ['#e3eeff', '#c9dcf7'],
    tiles: [
      { id: 'arbre-interactif', label: 'Arbre interactif', route: '/arbre-interactif', icon: 'Network', featured: true },
      { id: 'personnes', label: 'Personnes', route: '/listes/personnes', icon: 'User', featured: true, countKey: 'persons', countLabel: 'personnes' },
      { id: 'lieux', label: 'Lieux', route: '/listes/lieux', icon: 'MapPin', featured: true, countKey: 'places', countLabel: 'lieux' },
      { id: 'sources', label: 'Sources', route: '/archives?tab=sources', icon: 'Files', featured: true, countKey: 'sources', countLabel: 'sources' },
      { id: 'medias', label: 'Médias', route: '/archives?tab=documents', icon: 'Image', featured: true, countKey: 'documents_total', countLabel: 'médias' },
      { id: 'familles', label: 'Familles', route: '/listes/familles', icon: 'HeartHandshake' },
      { id: 'histoires', label: 'Histoires', route: '/histoire', icon: 'NotebookPen' },
      { id: 'taches', label: 'Tâches', route: '/enquetes', icon: 'CircleCheck', countKey: 'tasks_waiting', countLabel: 'à approuver' },
      { id: 'rechercher', label: 'Rechercher', route: '/listes/personnes?focus=1', icon: 'Search' },
      { id: 'importer', label: 'Importer', route: '/archives?tab=import', icon: 'Upload' },
      { id: 'parametres', label: 'Paramètres', route: '/parametres', icon: 'Settings' },
    ],
  },
  {
    id: 'graphiques', label: 'Graphiques', title: 'Graphiques', icon: 'Workflow', color: '#13918c', gradient: ['#d9f4f2', '#bfe8e6'],
    tiles: [
      { id: 'integral', label: 'Arbre généalogique intégral', route: '/arbre', icon: 'GitFork', featured: true },
      { id: 'sablier', label: 'Sablier généalogique', route: '/graphiques/sablier', icon: 'Hourglass', featured: true },
      { id: 'ascendance', label: 'Ascendance', route: '/graphiques/ascendance', icon: 'GitBranch', featured: true },
      { id: 'descendance', label: 'Descendance', route: '/graphiques/descendance', icon: 'ListTree', featured: true },
      { id: 'eventail', label: 'Éventail généalogique', route: '/graphiques/eventail', icon: 'CircleDot', featured: true },
      { id: 'double', label: 'Double ascendance', route: '/graphiques/double-ascendance', icon: 'Split' },
      { id: 'distribution', label: 'Distribution', route: '/graphiques/distribution', icon: 'BarChartHorizontal' },
      { id: 'statistiques', label: 'Statistiques', route: '/graphiques/statistiques', icon: 'BarChart3' },
      { id: 'chronogramme', label: 'Chronogramme', route: '/chronologie', icon: 'GanttChart' },
      { id: 'liens', label: 'Liens de parenté', route: '/graphiques/liens', icon: 'Users' },
      { id: 'sociogramme', label: 'Sociogramme', route: '/graphiques/sociogramme', icon: 'UsersRound' },
      { id: 'circulaire', label: 'Arbre circulaire', route: '/graphiques/circulaire', icon: 'Orbit' },
      { id: 'genogramme', label: 'Génogramme', route: '/graphiques/genogramme', icon: 'Shapes' },
    ],
  },
  {
    id: 'vues', label: 'Vues', title: 'Vues', icon: 'Eye', color: '#2e9a52', gradient: ['#ddf5e4', '#c3ead0'],
    tiles: [
      { id: 'arbre-virtuel', label: 'Arbre virtuel', route: '/vues/arbre-virtuel', icon: 'Box', featured: true },
      { id: 'globe', label: 'Globe virtuel', route: '/vues/globe', icon: 'Globe2', featured: true },
      { id: 'carte', label: 'Carte familiale', route: '/carte', icon: 'Map', featured: true },
      { id: 'cartes-stats', label: 'Cartes statistiques', route: '/vues/cartes-statistiques', icon: 'MapPinned' },
      { id: 'quiz', label: 'Quiz familial', route: '/vues/quiz', icon: 'HelpCircle' },
    ],
  },
  {
    id: 'rapports', label: 'Rapports', title: 'Rapports', icon: 'FileText', color: '#c4651a', gradient: ['#fbe9db', '#f3d6bf'],
    tiles: [
      { id: 'synthese-personnelle', label: 'Synthèse personnelle', route: '/rapports/synthese-personnelle', icon: 'FileUser', featured: true },
      { id: 'evenements', label: 'Événements personnels', route: '/rapports/evenements-personnels', icon: 'CalendarDays', featured: true },
      { id: 'liens', label: 'Liens de parenté', route: '/rapports/liens-de-parente', icon: 'Users', featured: true },
      { id: 'ascendance', label: 'Ascendance', route: '/rapports/ascendance', icon: 'ListOrdered', featured: true },
      { id: 'chronologie', label: 'Chronologie', route: '/rapports/chronologie', icon: 'GanttChart', featured: true },
      { id: 'synthese-familiale', label: 'Synthèse familiale', route: '/rapports/synthese-familiale', icon: 'HeartHandshake' },
      { id: 'histoire', label: 'Histoire', route: '/histoire', icon: 'Feather' },
      { id: 'descendance', label: 'Descendance', route: '/rapports/descendance', icon: 'ListTree' },
      { id: 'generationnelle', label: 'Synthèse générationnelle', route: '/rapports/synthese-generationnelle', icon: 'Layers' },
      { id: 'cartes', label: 'Cartes', route: '/rapports/cartes', icon: 'Earth' },
      { id: 'biographie', label: 'Biographie', route: '/rapports/biographie', icon: 'MessageSquareQuote' },
      { id: 'chronique', label: 'Chronique', route: '/rapports/chronique', icon: 'CalendarCheck' },
      { id: 'etat', label: 'État de la base', route: '/rapports/etat-de-la-base', icon: 'Info' },
    ],
  },
  {
    id: 'listes', label: 'Listes', title: 'Listes', icon: 'List', color: '#b23a7a', gradient: ['#fbe4f0', '#f1cde0'],
    tiles: [
      { id: 'personnes', label: 'Liste des personnes', route: '/listes/personnes', icon: 'Contact', featured: true, countKey: 'persons', countLabel: 'personnes' },
      { id: 'familles', label: 'Familles', route: '/listes/familles', icon: 'HeartHandshake', featured: true },
      { id: 'lieux', label: 'Lieux', route: '/listes/lieux', icon: 'MapPin', featured: true },
      { id: 'evenements', label: 'Événements', route: '/listes/evenements', icon: 'CalendarRange' },
      { id: 'anniversaires', label: 'Anniversaires', route: '/listes/anniversaires', icon: 'Cake' },
      { id: 'sources', label: 'Sources', route: '/listes/sources', icon: 'Files' },
      { id: 'medias', label: 'Médias', route: '/listes/medias', icon: 'Images' },
      { id: 'manquants', label: 'Faits manquants', route: '/listes/faits-manquants', icon: 'CircleDashed' },
      { id: 'contradictions', label: 'Contradictions', route: '/listes/contradictions', icon: 'TriangleAlert', countKey: 'contradictions_open', countLabel: 'ouvertes' },
      { id: 'hypotheses', label: 'Hypothèses', route: '/listes/hypotheses', icon: 'Lightbulb', countKey: 'hypotheses_open', countLabel: 'ouvertes' },
    ],
  },
  {
    id: 'publication', label: 'Publication', title: 'Publication', icon: 'Upload', color: '#8a35b8', gradient: ['#f1e2fb', '#e2cbf3'],
    tiles: [
      { id: 'site', label: 'Site internet', route: '/publication/site', icon: 'Globe', featured: true },
      { id: 'gedcom', label: 'Exportation GEDCOM', route: '/publication/gedcom', icon: 'FileDown', featured: true },
      { id: 'export-sous-arbre', label: 'Exporter un sous-arbre', route: '/publication/exporter-sous-arbre', icon: 'GitBranchPlus' },
      { id: 'supprimer-sous-arbre', label: 'Supprimer un sous-arbre', route: '/publication/supprimer-sous-arbre', icon: 'GitBranchMinus' },
      { id: 'pdf', label: 'Livre PDF', route: '/publication/pdf', icon: 'BookOpen' },
      { id: 'sauvegarde', label: 'Sauvegarde', route: '/parametres?tab=sauvegardes', icon: 'DatabaseBackup' },
    ],
  },
  {
    id: 'favoris', label: 'Favoris', title: 'Favoris', icon: 'Star', color: '#5f6478', gradient: ['#ecedf2', '#d9dbe4'],
    tiles: [],
  },
]

export const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<SectionId, Section>

/** Toutes les tuiles (hors favoris), avec leur section : sert aux favoris et à la détection de la section courante. */
export const ALL_TILES: (Tile & { section: SectionId })[] = SECTIONS.flatMap((s) => s.tiles.map((t) => ({ ...t, section: s.id })))

/** Section d'une route (première tuile correspondante), pour colorer la page courante. */
export function sectionForPath(pathname: string): SectionId {
  if (pathname.startsWith('/livre')) return 'livre'
  if (pathname === '/' || pathname.startsWith('/demarrer') || pathname.startsWith('/documents') || pathname.startsWith('/sources-consultees') || pathname.startsWith('/enquetes') || pathname.startsWith('/questions') || pathname.startsWith('/assistant') || pathname.startsWith('/tableau-de-bord')) return 'recherche'
  if (pathname.startsWith('/section/')) return (pathname.split('/')[2] as SectionId) || 'recherche'
  if (pathname.startsWith('/graphiques') || pathname === '/arbre' || pathname.startsWith('/chronologie')) return 'graphiques'
  if (pathname.startsWith('/vues') || pathname.startsWith('/carte')) return 'vues'
  if (pathname.startsWith('/rapports') || pathname.startsWith('/histoire')) return 'rapports'
  if (pathname.startsWith('/listes')) return 'listes'
  if (pathname.startsWith('/publication')) return 'publication'
  if (pathname.startsWith('/favoris')) return 'favoris'
  return 'editer'
}

export const DEFAULT_FAVORITES = ['editer:arbre-interactif', 'editer:personnes', 'editer:lieux', 'graphiques:ascendance', 'graphiques:eventail',
  'graphiques:sablier', 'vues:arbre-virtuel', 'rapports:synthese-personnelle', 'rapports:liens', 'listes:personnes']
