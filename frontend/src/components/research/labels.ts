export const TASK_TYPE_LABEL: Record<string, string> = {
  find_birth: 'Rechercher l’acte de naissance', find_parents: 'Retrouver les parents', find_marriage: 'Rechercher l’acte de mariage',
  find_death: 'Rechercher l’acte de décès', find_census: 'Comparer les recensements', find_siblings: 'Identifier les frères et sœurs',
  find_military: 'Rechercher le registre matricule', explore_branch: 'Explorer la branche (plusieurs générations)',
  analyze_document: 'Analyser un document', verify_person: 'Vérifier la cohérence',
}
export const CREATABLE_TASK_TYPES = ['find_birth', 'find_parents', 'find_marriage', 'find_death', 'find_census', 'find_siblings', 'find_military', 'explore_branch']
export const STEP_STATUS_LABEL: Record<string, string> = { pending: 'En attente', done: 'Terminée', skipped: 'Ignorée', failed: 'Échec', manual: 'Manuelle', running: 'En cours' }
export const STEP_STATUS_CLASS: Record<string, string> = { pending: 'conf-grey', done: 'conf-green', skipped: 'conf-grey', failed: 'conf-red', manual: 'conf-orange', running: 'conf-orange' }
export const AUTONOMY_LABEL: Record<number, string> = { 1: 'Assisté', 2: 'Semi-autonome', 3: 'Autonome contrôlé' }
export const ACCESS_MODE_LABEL: Record<string, string> = { api: 'API', html: 'Lecture HTML', browser: 'Navigateur', manual: 'Manuel' }
export const CONNECTOR_STATUS_LABEL: Record<string, string> = { untested: 'Non testé', ok: 'Opérationnel', degraded: 'Dégradé', failed: 'Échec', manual: 'Navigateur' }
export const CONNECTOR_STATUS_CLASS: Record<string, string> = { untested: 'conf-grey', ok: 'conf-green', degraded: 'conf-orange', failed: 'conf-red', manual: 'conf-orange' }
export const COUNTRY_LABEL: Record<string, string> = { FR: 'France', IT: 'Italie', PL: 'Pologne', DE: 'Allemagne', BE: 'Belgique', ES: 'Espagne', PT: 'Portugal', GB: 'Royaume-Uni', UK: 'Royaume-Uni', US: 'États-Unis', CH: 'Suisse', NL: 'Pays-Bas', LU: 'Luxembourg', AT: 'Autriche', CA: 'Canada', IE: 'Irlande', '*': 'International' }
export const LOG_CATEGORY_LABEL: Record<string, string> = { general: 'Général', search: 'Recherche', connector: 'Connecteur', analysis: 'Analyse', compare: 'Comparaison', decision: 'Décision', result: 'Résultat', error: 'Erreur', insee: 'INSEE', task: 'Tâche', question: 'Question' }
