# Enquêtes autonomes — GENEALIS RESEARCH DIRECTOR (v0.4)

Ce document explique ce que fait la commande **« LANCER UNE ENQUÊTE AUTONOME »**, comment elle choisit ses
stratégies, comment elle décide d'enregistrer (ou non) une filiation, comment elle exploite les témoins, comment elle
reprend après une coupure, comment elle limite les coûts, et quelles sont ses limites. Il se termine par le
**protocole des 10 tests réels** à exécuter sur le PC de l'utilisateur, avec un tableau de résultats **vide** : aucun
résultat n'est inventé ici.

Code : `backend/genealis/investigation/` (`director.py`, `handlers.py`, `strategy.py`, `memory.py`, `network.py`,
`verification.py`, `runner.py`, `queue.py`) et `backend/genealis/api/investigations.py`.
Tests automatisés (Gemini simulé, aucun réseau) : `backend/genealis/tests/test_investigation.py`.

---

## 1. Fonctionnement général

```
LANCER UNE ENQUÊTE (personne, objectif, générations max, plafond d'appels IA, mode de coût)
   │
   ▼
 plan ──► examiner l'arbre : lacunes (naissance/baptême, parents, mariage, décès, recensements)
   │       + documents déjà rattachés à la personne (lus en premier : 0 recherche)
   ▼
 web_search ──► connecteurs gratuits (API publiques) → recherche web Gemini (sources vérifiables)
   │              │ piste d'acte (page d'archives)            │ rien trouvé
   │              ▼                                           ▼
   │           browse (worker navigateur LOCAL : Playwright, puis agent Browser Use, puis humain)
   │              │ documents téléchargés (media_id)
   ▼              ▼
 analyze_document ──► lecture (module paléographique, sinon analyse v0.3) → mentions (parents, témoins…)
   │                   + source complète (document original, URL, cote, transcription)
   ├──► verify ─────────► niveau de preuve → filiation ENREGISTRÉE / PROPOSÉE (à valider) / HYPOTHÈSE À VÉRIFIER
   │                        │ parents établis ou proposés avec preuve
   │                        ▼
   │                     expand_generation ──► plan pour chaque parent (génération + 1, jusqu'au maximum)
   └──► witness_followup ─► relation indirecte vérifiée contre l'arbre → hypothèse + piste (nouvelle recherche)
```

- Les tâches sont dans une **file persistante** (`investigation_tasks`) : EN ATTENTE, EN COURS, TERMINÉE, BLOQUÉE,
  À VÉRIFIER, ÉCHEC (et ANNULÉE à l'arrêt). Chaque tâche a une empreinte : **la même recherche n'est jamais créée deux fois**.
- Le serveur exécute `plan`, `web_search`, `analyze_document`, `verify`, `witness_followup`, `expand_generation`.
  Les tâches `browse` attendent le **worker navigateur local** (Vercel ne peut pas ouvrir de navigateur) et les tâches
  `human_assist` attendent l'utilisateur.
- Quand le worker termine une tâche `browse` avec des documents, le Director crée automatiquement une tâche
  `analyze_document` par document (avec l'URL de la page et la cote d'archives transmises par le worker).
- L'enquête avance **sans intervention systématique**. Elle pose une **question** seulement quand une décision importante
  ne peut pas être tranchée : désaccord avec l'arbre, hypothèses concurrentes, preuve suffisante en mode assisté,
  lien déclaré incohérent, CAPTCHA/connexion, personne peut-être vivante sans parents connus.
- Fin : quand il n'y a plus de tâche en attente, l'enquête passe à **TERMINÉE**, ou **À VÉRIFIER** s'il reste des hypothèses
  ouvertes. Tant que des tâches `browse` attendent le worker, elle reste EN COURS.

### Commandes (API)

| Action | Route |
|---|---|
| Lancer | `POST /api/investigations` `{person_id, objective?, max_generations?, ai_call_ceiling?, cost_mode?, start?}` |
| Liste / tableau de bord | `GET /api/investigations`, `GET /api/investigations/dashboard` |
| Détail en direct | `GET /api/investigations/{id}` (tâches, découvertes, 10 prochaines recherches, personnes, mémoire, 20 dernières pages) |
| Fil d'activité | `GET /api/investigations/{id}/events?after=<id>&limit=100` |
| Pause / reprise / arrêt | `POST /api/investigations/{id}/pause` · `/resume` · `/stop` |
| Avancer maintenant | `POST /api/investigations/{id}/step?budget_s=20` |
| Analyser à nouveau | `POST /api/investigation-tasks/{id}/retry` |
| J'ai terminé (aide humaine) | `POST /api/investigation-tasks/{id}/human-done` `{note?}` |
| Valider / rejeter | `POST /api/discoveries/{hypothesis|mention}/{id}/validate` · `/reject` `{person_id?, note?}` |
| Personnes citées | `GET /api/mentions?media_id=&person_id=&investigation_id=` |
| Réseau d'une personne | `GET /api/network/{person_id}` |

Exécution automatique : en local, un planificateur (APScheduler) fait avancer les enquêtes toutes les 30 s pendant 20 s ;
en mode hébergé, le cron Vercel (`/api/research/cron`) les fait avancer avec le temps restant de la fonction. Un verrou
évite deux exécutions simultanées. Au démarrage, les tâches interrompues sont remises en attente.

---

## 2. Stratégies (de la moins chère à la plus chère)

| Ordre | Stratégie | Coût | Quand |
|---|---|---|---|
| 0 | Réutilisation (mémoire de l'enquête, mentions déjà extraites, cache IA) | 0 | toujours en premier |
| 1 | Connecteurs gratuits existants (Gallica, Open Archives, Internet Archive, INSEE…) | 0 appel IA | recherche nominative |
| 2 | Recherche web Gemini + Google Search | 1 appel IA | si Gemini est configuré et autorisé et s'il reste des appels (2 sont gardés pour lire les documents trouvés) |
| 3 | `browse` Playwright (recette déterministe, worker local) | 0 appel IA | ouverture d'une page d'archives |
| 4 | `browse` agent Browser Use + Gemini | plusieurs appels (étapes plafonnées) | seulement après l'échec de la recette déterministe et s'il reste assez d'appels |
| 5 | Humain | 0 | CAPTCHA, connexion, abonnement, site interdisant l'automatisation (Geneanet, FamilySearch, Ancestry, MyHeritage, Filae), navigateur désactivé, quotas épuisés |

Une même page n'est jamais confiée deux fois au navigateur dans une enquête. Les personnes peut-être vivantes ne sont
jamais recherchées en ligne ni transmises au worker.

---

## 3. Niveaux de preuve

Une filiation n'est **enregistrée** que si **toutes** les conditions sont réunies :

1. le document est un **acte primaire** (naissance, baptême, mariage, décès, sépulture, recensement, registre matricule),
   pas un arbre en ligne (source dérivée) ni une table ;
2. il **nomme explicitement les parents**, avec une lecture suffisamment sûre (un nom mal lu reste une hypothèse de lecture) ;
3. la personne est identifiée **au-delà du seul nom** : au moins un critère concordant parmi date, lieu, âge, conjoint…
   (score d'identité « vert » ≥ 80 %, aucune incompatibilité) ;
4. **aucun homonyme compatible** dans l'arbre ;
5. **aucun désaccord** avec un parent déjà présent dans l'arbre ;
6. le **mode d'autonomie** le permet : mode 3 « autonome contrôlé ». En mode 1 ou 2, la filiation est seulement
   **proposée** (hypothèse « vert », question de confirmation).

Sinon, une **hypothèse `filiation` À VÉRIFIER** est créée, avec la liste de ce qui manque (« Seuls les noms concordent »,
« Source dérivée », « Lecture incertaine »…). Les hypothèses concurrentes (même `group_key`) sont **toutes conservées** ;
aucune n'est supprimée automatiquement. Un désaccord avec l'arbre devient une **contradiction** visible (`document_vs_tree`) :
rien n'est écrasé.

Chaque filiation enregistrée conserve :
- la **source** : document original (média intact, `local_copy_path`), URL de la page, **cote d'archives**, transcription,
  traduction, fiabilité, avertissement « transcription IA à vérifier » ;
- une **citation** par relation, avec l'**extrait** et la **zone de l'image** (`image_region`) quand la lecture la fournit ;
- la **justification** (raisons et manques) dans la note de la citation et dans l'hypothèse `filiation` (statut confirmé) ;
- la **confiance** calculée par `services/confidence.py` : une seule source primaire donne **ORANGE** (à corroborer) ;
  le VERT exige une corroboration indépendante. L'enquête ne force jamais un niveau.

---

## 4. Témoins et relations indirectes (priorité)

Pour chaque personne citée (témoin, parrain, marraine, déclarant…) une **mention** (`person_mentions`) est créée. Elle n'est
**jamais fusionnée automatiquement** avec une personne de l'arbre ; les rapprochements possibles restent des candidats.

Exemple : « **Pierre Martin, oncle maternel de l'épouse** »
1. analyse du lien : `kind=uncle`, `side=maternal`, `to_role=bride` ;
2. personne de référence : l'épouse de l'acte, rapprochée de l'arbre (candidat ≥ 80 % ou mention validée) ;
3. vérification : un oncle maternel de l'épouse doit être **un frère de sa mère** ou **le mari d'une sœur de sa mère** ;
   - `consistent` : une personne de l'arbre occupe cette position et porte ce nom ;
   - `plausible` : position vide mais le nom correspond au nom de naissance de la mère (oncle par le sang) — ou nom différent
     (oncle par alliance possible) ;
   - `unknown` : la mère (ou la fratrie) n'est pas dans l'arbre ;
   - `inconsistent` : incompatibilité (sexe, âge très improbable…) → question à l'utilisateur ;
4. une hypothèse `indirect_relation` est créée (avec avertissements, par exemple un homonyme ailleurs dans l'arbre) ;
5. une **piste** est créée : recherche d'actes complémentaires sur cette personne (si le document a plus de 100 ans).

Un **témoin homonyme** (même nom que la famille, sans lien déclaré) donne une hypothèse `witness_homonym` avec
l'avertissement explicite : « Un témoin portant le même nom que la famille n'est JAMAIS présumé parent ».

Le réseau d'une personne (documents ↔ personnes citées ↔ personnes de l'arbre) est consultable par `GET /api/network/{id}`.

---

## 5. Mémoire d'enquête

`Investigation.memory` garde : personne et objectif, **sites** (avec nombre de visites), **pages** ouvertes, **requêtes**
(avec stratégie et issue), **documents** (URL, cote, état), **résultats** (pistes trouvées par requête), **échecs**,
**hypothèses**, **filiations** enregistrées, **prochaines recherches**, et l'éventuel **blocage** (quota). Les ajouts sont
dédupliqués (clé normalisée sans accents) : une requête déjà faite est **réutilisée** sans nouvel appel.

## 6. Reprise après interruption

- Chaque tâche est réservée avec un **bail** ; la base est enregistrée après chaque tâche.
- PC éteint, processus tué, fonction Vercel interrompue : au redémarrage (ou au pas suivant), `requeue_expired` remet les
  tâches au bail expiré EN ATTENTE, et la mémoire évite de refaire ce qui était déjà fait (test 8 automatisé).
- Pause / reprise / arrêt sont manuels ; l'arrêt annule les tâches en attente sans rien supprimer.

## 7. Coûts

- Chaque appel IA est compté (`ai_call_logs`) et attribué à l'enquête et à la tâche (`cost.ai_context`).
- Plafonds vérifiés **avant** l'envoi : jour, minute, enquête (`ai_call_ceiling`), budget mensuel, mode de coût.
- Un plafond atteint (`QuotaExceeded`) **bloque proprement l'enquête** : état BLOQUÉE, raison affichée, tâche non faite
  remise en attente (sans compter de tentative), plus aucun appel envoyé. Les quotas temporaires (minute, fournisseur, jour)
  sont repris automatiquement une fois le délai passé ; le plafond de l'enquête exige votre accord (« Reprendre » après
  l'avoir augmenté). Un quota global bloque aussi les autres enquêtes actives.
- Cache des réponses IA, réutilisation des données déjà extraites, un document n'est jamais relu deux fois sans demande
  (« Analyser à nouveau »), simultanéité limitée (`ai_max_concurrency`).

## 8. Limites connues (à lire avant les tests réels)

- **Rien n'a été testé contre un vrai site d'archives ni contre Gemini réel** dans l'environnement de développement (réseau
  bloqué) : tous les tests automatisés utilisent un Gemini simulé et des données fictives.
- La qualité dépend de la lecture des écritures anciennes : une lecture IA reste une hypothèse ; l'intégration avec le module
  paléographique (`genealis.paleo`, écrit en parallèle) est testée contre le contrat avec un module simulé ; sans ce module,
  le Director utilise l'analyse v0.3 (`analyze_media`).
- Les connecteurs gratuits et la recherche web trouvent surtout des **pistes** ; les registres des archives départementales
  sont des images sans texte : l'accès réel passe par le worker navigateur (ou par vous).
- Les parents seulement « proposés » (mode assisté) sont recherchés par leur nom, sans fiche dans l'arbre tant que vous
  n'avez pas validé.
- La vérification des liens indirects couvre : oncle/tante (par le sang ou par alliance), frère/sœur, cousin, grand-parent,
  parent, beau-frère/belle-sœur, neveu/nièce. Les autres liens sont gardés comme réseau sans vérification.
- Les âges des témoins ne sont utilisés que comme indice (avertissement), jamais comme preuve.

---

## 9. Protocole des 10 tests réels (PC de l'utilisateur)

Pré-requis : application v0.4 lancée sur le PC (`genealis` en local), **worker navigateur** démarré et visible « en ligne »
dans le Centre d'investigation, clé Gemini gratuite configurée et « Autoriser l'IA externe » activé, mode de coût
**GRATUIT**, plafond d'enquête 30 appels. Choisir un ancêtre **décédé depuis plus de 100 ans**, né en France après 1792,
dont la commune de naissance est connue et dont les registres sont **en ligne gratuitement** (archives départementales).
Noter pour chaque test : date, ce qui a été fait, ce qui a été observé, captures, et le résultat (Réussi / Échec / Partiel).

| N° | Test | Procédure | Résultat attendu |
|---|---|---|---|
| 1 | Lancer une enquête et ouvrir un site d'archives gratuit | Fiche de l'ancêtre → « Lancer une enquête autonome ». Observer le fil d'activité. | Plan affiché (lacunes, tâches), au moins une tâche `browse` prise par le worker, page des archives départementales réellement ouverte (« Pages consultées » avec capture). |
| 2 | Trouver le registre et télécharger un vrai acte | Laisser le worker chercher le registre (commune, années). En cas de CAPTCHA / connexion : vérifier que la tâche est BLOQUÉE et qu'une question vous est posée. | Image de l'acte téléchargée (Media) avec URL et cote ; ou blocage propre sans contournement. |
| 3 | Lire l'image de l'acte (Gemini) | Attendre la tâche `analyze_document`. Ouvrir le lecteur de document. | Transcription avec passages incertains marqués ; un seul appel IA pour ce document (tableau des coûts). |
| 4 | Extraire les personnes de l'acte | Onglet « Découvertes » de l'enquête et `GET /api/mentions?media_id=…`. | Sujet, père, mère, témoins (avec âge, profession, lien déclaré si présent) ; aucune fusion automatique. |
| 5 | Relation indirecte | Utiliser un acte de mariage dont un témoin a un lien déclaré (« oncle maternel de l'épouse »…) avec la mère de l'épouse dans l'arbre. | Hypothèse « relation indirecte » avec le résultat de la vérification (cohérent / plausible / non vérifiable) et une piste de recherche ; aucun lien créé sans validation. |
| 6 | Enregistrement en base | Mode 3 : après une filiation enregistrée, ouvrir la fiche de l'enfant → filiation → source. | Source avec document original, URL, cote, transcription ; citation avec extrait, justification ; confiance ORANGE (une source primaire). |
| 7 | Génération précédente | Après le test 6, laisser tourner. | Tâches « Planifier les recherches » pour le père et la mère (génération 1), jusqu'au maximum choisi. |
| 8 | Interruption et reprise | Pendant une tâche EN COURS, fermer l'application (ou éteindre le worker). Relancer. | La tâche reprend après expiration du bail ; la même recherche n'est pas renvoyée (mémoire : « Recherche déjà faite… ») ; aucun doublon de page. |
| 9 | Quota | Fixer le plafond de l'enquête à 2 appels et lancer une enquête avec 3 documents. | Enquête BLOQUÉE avec la raison ; plus aucun appel envoyé (tableau des coûts) ; reprise possible après augmentation du plafond. |
| 10 | Filiation incertaine | Lancer une enquête sur une personne dont seuls les noms sont connus (aucune date/lieu), ou fournir une capture d'arbre en ligne. | Hypothèse « À VÉRIFIER » avec la liste des manques ; aucune filiation enregistrée ; témoin homonyme non présumé parent. |

### Résultats à consigner (à remplir lors des tests réels — rien n'est pré-rempli)

| N° | Date | Archives / site utilisé | Acte (commune, année, cote) | Observé | Résultat | Remarques |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |
| 6 | | | | | | |
| 7 | | | | | | |
| 8 | | | | | | |
| 9 | | | | | | |
| 10 | | | | | | |

### Ce qui a été testé automatiquement (sans réseau)

`backend/genealis/tests/test_investigation.py` couvre, avec Gemini simulé et des données fictives : lecture d'une image →
mentions parents + témoins (3/4), vérification de « oncle maternel de l'épouse » contre l'arbre (5), enregistrement avec
source, URL, cote, transcription, confiance et justification (6), génération précédente et limite de générations (7),
interruption puis reprise sans nouvelle requête (8), quota quotidien et plafond d'enquête → BLOQUÉE sans appel (9),
filiation incertaine (seul le nom, source dérivée, lecture incertaine, mode assisté) jamais enregistrée (10), témoin
homonyme, hypothèses concurrentes et contradiction, personne vivante, stratégie la moins chère, connecteurs gratuits avant
l'IA, intégration du module paléographique (contrat), aide humaine, et l'API complète.
