# PROJECT_STATUS.md — GENEALIS AI

_Mis à jour le 01/11/2026 (v0.4.0)._ Ce fichier distingue strictement ce qui est **terminé**, **testé**, **en cours** et **limité**.

## Fonctionnalités terminées (code écrit)

### v0.4 — enquêtes autonomes, navigateur local, écritures anciennes, coûts — nouveau
- **GENEALIS RESEARCH DIRECTOR** (`backend/genealis/investigation/`, `/investigation`) : « Lancer une enquête autonome » → lacunes, plan, sources gratuites, recherche web Gemini avec sources, missions de navigation, lecture des actes, comparaison des personnes, vérification des filiations par niveau de preuve, génération précédente jusqu'à la limite choisie. File de tâches persistante (EN ATTENTE, EN COURS, TERMINÉE, BLOQUÉE, À VÉRIFIER, ÉCHEC), mémoire d'enquête (sites, pages, requêtes, documents, échecs, hypothèses, prochaines recherches), jamais deux fois la même recherche, reprise après redémarrage. Détails : `docs/ENQUETES_AUTONOMES.md`.
- **Témoins et relations indirectes** : chaque personne citée dans un acte devient une mention (rôle, relation déclarée « oncle maternel de l'épouse », âge, métier, domicile, signature, zone de l'image) ; cohérence vérifiée avec l'arbre ; pistes et hypothèses ; un témoin homonyme n'est jamais présumé parent ; aucune fusion automatique.
- **Lecture des écritures anciennes** (`backend/genealis/paleo/`, `/documents/:id/lecture`) : 13 écritures (cursive française, registres paroissiaux, gothique, Kurrent, Sütterlin, latin ecclésiastique, italien, polonais, cyrillique, abréviations), ORIGINAL intact — transcription diplomatique ligne par ligne avec zones — version normalisée — traduction, passages incertains avec lectures alternatives, seconde passe sur découpe agrandie (plafonnée), mémoire des corrections humaines par main d'écriture, photos décrites sans reconnaissance faciale, moteur HTR spécialisé possible (désactivé sans autorisation), mesure CER/WER. Lecteur : zoom HD, rotation, contraste, négatif, découpe, panneaux parallèles, correction en ligne. Détails : `docs/PALEOGRAPHIE.md`.
- **Navigateur autonome local** (`backend/genealis/browser/`, worker sur le PC) : Playwright déterministe (formulaires, listes de résultats, visionneuses IIIF, téléchargements contrôlés) puis agent Browser Use open source avec Gemini en dernier recours, assistance humaine (CAPTCHA, connexion : jamais contournés). Sécurité : proxy local qui vérifie chaque connexion (adresses internes, redirections, DNS rebinding), types de fichiers vérifiés par signature, détection des injections, contenu des pages traité comme non fiable, sites interdisant l'automatisation (Geneanet, FamilySearch, Ancestry, MyHeritage, Filae) réservés à l'humain, robots.txt respecté, télémétrie Browser Use désactivée, Browser Use Cloud (payant) refusé sans autorisation. Clé Gemini du worker conservée sur le PC. Détails : `docs/NAVIGATION_AUTONOME.md`, installation : `docs/INSTALLATION_WINDOWS.md`.
- **Gestionnaire de coûts** (`/couts`) : chaque appel IA compté (jetons, durée, usage, enquête), cache des réponses, plafonds jour / minute / enquête / budget vérifiés AVANT l'envoi, suspension automatique après un quota Google (HTTP 429), simultanéité limitée, modes GRATUIT / HYBRIDE / COMMERCIAL (abonnements personnels interdits en mode commercial). Tarifs non codés en dur (à saisir par l'utilisateur).
- **Protection des personnes vivantes** : noms pseudonymisés avant tout envoi externe, documents et recherches web nominatives les concernant refusés sans autorisation explicite.
- **Audit du connecteur Gemini** : liste officielle des modèles interrogée avec la clé de l'utilisateur, modèle recommandé (« flash » multimodal), test réel facultatif (image + recherche Google, sans donnée personnelle).
- Base : 9 tables additionnelles (migration `7b2c4e9a0f11`, non destructive, testée sur une base v0.3).

### v0.3 — identité propre, recherches vérifiables, Livre de famille, lecture des documents — nouveau
- **Identité visuelle « archives de famille »** : papier ivoire, titres Fraunces, encre bleu nuit, filets dorés ; rail « reliure » sur ordinateur, barre basse avec bouton Recherche IA central sur téléphone ; catégories numérotées comme des chapitres. Ne reprend plus le style MacFamilyTree.
- **Recherche web Gemini avec sources** (connecteur `gemini_web`, outil Google Search) : Geneanet, Filae, FamilySearch, archives départementales en ligne (54, 57, 55, 88…), FranceArchives, Mémoire des Hommes, Grand Mémorial, Gallica, Geneteka, Antenati, Matricula ; une piste n'est retenue que si sa page fait partie des pages réellement consultées ; arbres en ligne = pistes à vérifier.
- **Recherches cliquables** (`/enquetes/:id`) : pour chaque site, ce qui a été cherché, statut, durée, résultats, lien « Refaire cette recherche moi-même » ; pour Gemini, requêtes Google lancées, pages consultées, passages justifiés. **Sites consultés** et **Vérifier le moteur de recherche** (diagnostic de tous les connecteurs).
- **Livre de famille** : un chapitre par personne, à la première personne, généré uniquement à partir des faits (notes de sources), encadrés village (Wikipédia/Wikidata cités), métier (dictionnaire de 119 métiers anciens), époque, vie quotidienne ; lieux de vie sur carte, famille, repères, « les gens autour de moi », actes et transcriptions, recherches en cours ; annexes métiers, villages, dates et actes à trouver ; impression A4 ; réécriture IA optionnelle étiquetée.
- **Numéros Sosa** calculés pour toute la base, affichés sur la fiche, dans la liste des personnes (tri par Sosa) et sur les cartes des graphiques.
- **Import et interprétation de documents** (`/documents/importer`) : photo ou PDF lu par l'IA (actes, recensements, registres matricules, tables décennales, faire-part), transcription avec mots incertains, rapprochement explicable avec l'arbre, propositions cochables (personnes, événements, liens, source, contradictions jamais écrasées), application atomique et journalisée.
- **Types d'événements** complets (adoption, apprentissage, incorporation militaire, obsèques, transaction foncière, titre de noblesse, contrat prénuptial, annulation…).

### v0.2 — recherche IA au centre, design MacFamilyTree, archivage web — nouveau
- **Démarrage par les grands-parents** (`POST /api/quickstart`) : un couple (ou une personne) et ses enfants connus, sans se saisir soi-même ; recherche IA lancée aussitôt.
- **Ajout de proches en un geste** (`POST /api/persons/{id}/relatives`) : père, mère, frère, sœur (rattachés aux parents connus, sinon lien de fratrie sans parent inventé), fils/fille avec le conjoint, conjoint avec mariage, grands-parents paternels/maternels (fiche d'attente explicite si le parent intermédiaire manque), personne existante ; refus d'un second père/mère biologique.
- **Âge** dans l'identité : au décès ou actuel, détaillé « 82 a 5 m 12 j » si dates exactes, « ≈ » sinon, jamais calculé quand une date manque.
- **Liens de parenté** (`/kinship`) : ancêtre commun, libellés français (grand-oncle, cousin issu de germain, à la mode de Bretagne, par alliance), degré civil, chemin.
- **Statistiques** (`/api/stats`), **état de la base** (`/api/reports/state`), **liste des événements** (`/api/events`).
- **Archivage web** : images, PDF et pages web trouvés en ligne archivés dans l'application (robots.txt respecté, sites interdisant la collecte exclus, HTML nettoyé et affiché en bac à sable), automatiquement pour les meilleures pistes des enquêtes et les sources enregistrées ; stockage en base PostgreSQL quand Blob n'est pas configuré (persistant sur Vercel).
- **Publication** : site internet statique (zip, vivants masqués), GEDCOM d'un sous-arbre, suppression d'un sous-arbre avec aperçu et confirmation.
- **Centre de recherche IA** : fil des découvertes, pistes de recherche par personne (IA si configurée, présentées comme suggestions ; sinon règles), aide générale de l'assistant par l'IA.
- **Interface** refondue sur le modèle de MacFamilyTree : catégories colorées (Recherche IA, Éditer, Graphiques, Vues, Rapports, Listes, Publication, Favoris), tuiles, arbre interactif par bandes de générations, éventail, sablier, ascendance, descendance, double ascendance, distribution des noms, statistiques, liens de parenté, sociogramme, arbre circulaire, génogramme, arbre virtuel 3D, globe virtuel, cartes statistiques, quiz familial, 13 rapports imprimables, 10 listes.

### Mode hébergé (Vercel) et mobile
- Même moteur Python exposé en service Vercel (`vercel.json` au format « services » : `frontend/` Vite + `backend/` FastAPI `genealis.main:app`, `backend/requirements.txt`), base **PostgreSQL (Neon)** ou SQLite au choix via `DATABASE_URL`, documents sur **Vercel Blob** (`storage.py`), recherche plein texte portable (FTS5 sous SQLite, LIKE sans accents sous Postgres), clé de chiffrement par variable d'environnement, initialisation paresseuse.
- Exécution des enquêtes **à la demande** (`POST /api/research/run` par tranches de 50 s déclenchées par l'interface ouverte, `GET /api/research/cron` quotidien protégé par `CRON_SECRET`), verrou anti-exécution parallèle, délais réseau raccourcis.
- **Protection par mot de passe** (`ACCESS_TOKEN`, cookie httpOnly) : données privées même sur une adresse publique.
- Sauvegarde/restauration **JSON complète** (toutes les tables) pour le mode hébergé, compatible avec la version de bureau.
- Interface **mobile** : barre de navigation basse, menu « Plus », en-tête compact, suivi en direct par interrogation périodique (plus de dépendance au flux SSE), écran de connexion, bandeau d'accueil guidé « Que se passe-t-il ? » avec l'action la plus utile.
- Réglages novices : mode **autonome contrôlé** par défaut, recherches lancées automatiquement après le premier démarrage.

### Fondation
- Application locale : moteur FastAPI (`backend/`), interface React/TypeScript (`frontend/`), coque Tauri 2 (`src-tauri/`).
- Base SQLite créée automatiquement, migrations Alembic (révision initiale + stamp/upgrade au démarrage), recherche plein texte FTS5.
- Modèle généalogique complet : personnes (noms, variantes, sexe, profession, nationalité, vivant), événements datés (exact / vers / avant / après / entre / inconnu, calendrier républicain converti, forme originale conservée séparément), lieux (gazetteer hors ligne + géocodage gratuit), filiations typées (biologique, adoptive, légale, beau-parent, nourricière, incertaine), unions, sources (organisme, fonds, commune, registre, cote, année, vue, URL, consultation, copie locale, transcription, traduction, interprétation, fiabilité), citations avec extrait et zone d'image, documents, hypothèses, questions, contradictions, tâches, journal, décisions d'agents, transmissions externes.
- Paramètres persistants, clés API chiffrées localement (Fernet), journal technique rotatif, sauvegardes automatiques (APScheduler), chiffrées en option, restauration avec sauvegarde de sécurité préalable.
- Installateur : workflow GitHub Actions Windows (NSIS + MSI via Tauri, plus un exécutable portable), scripts d'installation/lancement Windows et Linux/macOS, exécutable PyInstaller du moteur.

### Moteur autonome de recherche
- GENEALIS RESEARCH AGENT : planificateur par type de tâche (naissance, parents, mariage, décès, recensement, fratrie, matricule, exploration de branche) choisissant les connecteurs selon pays/département/période, avec repli « navigateur » pour les services non automatisables.
- Agents : coordinateur (orchestre, applique le mode d'autonomie, journalise ses décisions), chercheur (requêtes réelles), vérificateur (rapprochement probabiliste + homonymes), transcripteur (OCR / vision), historien (contexte, périodes de registres).
- File d'attente prioritaire, reprise après interruption, nouvelles tentatives (3), empreinte des recherches déjà effectuées (pas de relance avant 30 jours sauf nouvelle information), limitation de débit par connecteur, mémoire par personne (`research_status`).
- Trois modes d'autonomie (assisté / semi-autonome / autonome contrôlé) ; en mode 3 seule une correspondance VERTE sans homonyme compatible est enregistrée, tout le reste devient hypothèse + question.
- Exploration équilibrée des branches paternelle et maternelle (mêmes priorités).
- Priorisation des branches (manques, disponibilité probable des archives selon période/pays, coût, gain multi-générations).

### Vérification
- Rapprochement explicable (patronyme, prénoms, sexe, dates, lieux, parents, conjoint, enfants, profession, témoins) avec contradictions bloquantes ; plafond de score quand seuls les noms concordent (règle 2).
- Score VERT/ORANGE/ROUGE/GRIS à critères documentés ; deux copies du même acte comptent pour une seule source ; les arbres tiers ne suffisent jamais.
- Détection : décès avant naissance, durée de vie implausible, événement après décès, parent trop jeune/âgé, enfant né après le décès de la mère ou > 300 jours après celui du père, pères/mères multiples, mariage trop précoce ou posthume, dates de naissance contradictoires, doublons probables. Signalées, jamais supprimées.

### Sources d'archives (47 connecteurs, tous gratuits et sans clé)
- API documentées : fichier des décès INSEE (matchID) + **index local hors ligne** du même fichier (open data), geo.api.gouv.fr, Gallica (SRU), Open Archives, Internet Archive, The National Archives Discovery, Nominatim, Wikidata.
- Lecture HTML expérimentale : FranceArchives, Antenati, Szukaj w Archiwach, Geneteka (robots.txt respecté).
- Navigateur assisté : AD 54/57/55/88/70/52, AM Nancy, Archives nationales, Mémoire des Hommes, Grand Mémorial, MémorialGenWeb, Limédia, Léonore, Geneanet, FamilySearch, Matricula, Roglo, Généafrance, Poznań Project, Genbaza, Belgique, Luxembourg, Allemagne, Suisse, Autriche, Tchéquie, Slovaquie, Hongrie, Espagne, Portugal, États-Unis, Canada, Archives Portal Europe.
- Tableau de bord des connecteurs avec test réel ; aucun n'est marqué opérationnel sans test réussi.

### IA : options gratuites ou par abonnement — nouveau
- Fournisseur **Gemini** (Google AI Studio, niveau gratuit) : texte et vision via l'API REST, transmission journalisée, utilisable depuis Vercel.
- Mode **copier-coller Claude / ChatGPT** (abonnement) : texte à coller généré par l'app (`GET /api/media/{id}/prompt`), réponse collée analysée (`POST /api/media/{id}/analysis`) → transcription, extraction, hypothèse de filiation + question de validation. Testé (analyse de réponse, repli par règles, flux API).
- Avertissement explicite : Ollama est inutilisable depuis l'application hébergée (il tourne sur le PC de l'utilisateur).

### IA documentaire
- Import intègre (copie + SHA-256, doublons détectés), images/PDF/photos, OCR Tesseract si installé, transcription par modèle de vision (Ollama local ou Claude sur autorisation), extraction JSON (langue, type d'acte, date, lieu, personnes et rôles, relations, passages incertains, traduction), repli par règles sans IA, normalisation des dates, mots incertains marqués `[?]`, zones de mots Tesseract pour justification visuelle.
- Proposition de filiation issue d'un document → hypothèse + question de validation (jamais automatique).

### Interface et autres modules
- Assistant conversationnel (intentions en français : recherche, branche par pays, contradictions, manques, explication de confiance, hypothèses, enquêtes, requêtes lieu/période), reformulation optionnelle par IA sans ajout de faits.
- Questions intelligentes dédupliquées, priorisées, avec problème / éléments connus / hypothèses / documents / impact et réponses oui / non / je ne sais pas / information / document / rechercher autrement.
- Import/export GEDCOM 5.5.1 (dates modifiées, PEDI, QUAY, sources, notes de confiance, personnes vivantes masquables), CSV, PDF fiche et rapport, CSV sources, narration sourcée avec contexte historique distinct.
- Premier démarrage : assistant de configuration (API) créant les fiches, questions initiales, premières investigations.
- Interface complète (React/TypeScript, palette bleu nuit / ivoire / or / gris / vert sauge) : navigation 9 sections, recherche rapide, plein écran, flux SSE en direct ; Tableau de bord (indicateurs, recherches en direct, priorités) ; Mon arbre (React Flow + dagre, ascendant/descendant, pliage par branche, Sosa, portraits, filtres, navigation par génération, ajout de personne/parent) ; Chronologie (frise SVG zoomable par génération avec événements historiques en arrière-plan distingués des faits familiaux) ; Carte familiale (Leaflet, lieux, migrations, frontières historiques indicatives, géocodage gratuit) ; Histoire familiale (narration sourcée + contexte historique) ; Fiche personnelle (3 boutons d'action, identité, biographie, chronologie, famille, lieux, documents, sources, hypothèses, contradictions, questions, PDF) ; Enquêtes IA (file, journal, décisions, priorités, connecteurs avec test réel) ; Archives et documents (sources, documents avec transcription/extraction/zones de mots, import/export, fichier INSEE local) ; Questions en attente (oui/non/je ne sais pas/information/document/rechercher autrement) ; Assistant IA ; Paramètres (autonomie, IA, sauvegardes, confidentialité, journal technique, à propos) ; assistant de premier démarrage en 6 étapes.

## Fonctionnalités testées
- **v0.4 : 141 tests automatisés verts sur SQLite et sur PostgreSQL 16.** Tout ce qui touche au réseau a été testé contre un **faux site d'archives local** et un **Gemini simulé** : aucun site réel ni appel Gemini réel n'a été possible depuis l'environnement de développement (réseau bloqué). Couverts : quotas (TEST 9, aucun envoi après dépassement ou après un 429), cache, modes, personnes vivantes, migration v0.3 → v0.4, file persistante et reprise (TEST 8), Chromium réel sur le faux site (formulaire → résultat → acte → image IIIF téléchargée, CAPTCHA → BLOQUÉE, injection détectée, redirections internes bloquées, .exe refusé), agent Browser Use réel avec un modèle simulé, worker de bout en bout et arrêt Ctrl+C, lecture paléographique (original intact, zones, seconde passe recadrée, corrections réinjectées, photo sans identification), mentions et relations indirectes (TEST 3/4/5), enregistrement source + URL + cote + transcription + justification (TEST 6), génération précédente (TEST 7), filiation incertaine jamais certaine (TEST 10), intégration lecture réelle + Director.
- **Restent à exécuter sur le PC de l'utilisateur** (procédures dans `docs/ENQUETES_AUTONOMES.md` et `docs/PALEOGRAPHIE.md`) : TEST 1 et 2 sur de vraies archives gratuites, vrais appels Gemini, mesures CER/WER sur six documents publics avec transcriptions de référence vérifiées, scripts PowerShell sous Windows 11.
- v0.3 : 65 tests automatisés verts, exécutés **sur SQLite et sur PostgreSQL 16** (dont recherche web Gemini simulée, traces, Livre, interprétation de documents), (dont ajout de proches, âge, liens de parenté, statistiques, démarrage par les grands-parents, sous-arbres, archivage web, Sosa avec beaux-parents) (export/import JSON, exécution bornée, protection par mot de passe, recherche plein texte portable ajoutés) (`backend/genealis/tests`) : dates et calendriers, variantes de noms, contradictions, confiance et sources indépendantes, homonymes jamais choisis arbitrairement, import/export GEDCOM aller-retour, flux API complet (création, relations, boucle interdite, arbre, frise, tableau de bord, sources, exports, import, FTS, assistant, connecteurs non opérationnels par défaut), premier démarrage et questions, moteur (plan, homonymes → question, mode autonome enregistre, mode assisté demande validation, questions non répétitives, reprise après interruption, équilibre des branches), sauvegarde/restauration chiffrée, intégrité des documents, extraction par règles, index INSEE local, parsing Gallica.
- Exécutable PyInstaller du moteur démarré et vérifié (santé, interface servie, création de personne).
- Interface vérifiée dans un navigateur (Playwright, `scripts/ui_smoke.cjs`) contre le moteur réel chargé des données fictives, en mode local **et** en simulation du mode hébergé (Postgres + mot de passe + serverless), en fenêtre d'ordinateur et en fenêtre mobile 390×844 : les 59 écrans de la v0.3 se rendent, sans débordement horizontal, sans erreur JavaScript ni erreur serveur (seules les tuiles OpenStreetMap échouent, réseau bloqué).
- Moteur d'enquête exécuté de bout en bout sur le serveur démo : plan multi-pays (France + Italie / Pologne), index INSEE local interrogé, services distants journalisés en échec réel (réseau bloqué), sites à consulter manuellement proposés sous forme de question, aucune donnée inventée.
- Jeu de données fictif isolé (famille DURANT-ROSSI-KOWALSKI : homonymes, contradiction, parents inconnus, famille recomposée, changement de nom, migration) ; mode démonstration `scripts/demo.sh` dans un dossier séparé.

## En cours
- Premier déploiement réel sur Vercel par l'utilisateur (fichiers prêts ; non déployé depuis cet environnement, qui n'a pas accès à Vercel).
- Validation des connecteurs depuis un poste connecté à Internet (impossible dans l'environnement de développement).
- Production du premier installateur Windows par GitHub Actions (workflow écrit, à exécuter sur le dépôt).

## Problèmes rencontrés
- L'environnement de développement bloquait tout accès réseau aux sites d'archives : **aucun connecteur n'a pu être testé en conditions réelles**. Leur statut reste « non testé » jusqu'au premier test depuis votre poste.
- Pas de WebKit sur la machine de développement : la coque Tauri ne peut pas être compilée ici ; elle est construite par GitHub Actions sous Windows.
- Tesseract absent de l'environnement : OCR testé uniquement au niveau de l'intégration (détection d'absence, repli).

## Limitations connues
- v0.4 : la qualité réelle de lecture des écritures anciennes n'est **pas encore mesurée** (aucun document réel testé) ; le navigateur autonome ne fonctionne que sur un ordinateur (pas sur Vercel) ; la détection CAPTCHA / connexion / abonnement est heuristique ; en mode déterministe seule la première vue d'un manifeste IIIF est téléchargée ; pas de proxy d'entreprise en amont.
- Les connecteurs HTML (FranceArchives, Antenati, Szukaj w Archiwach, Geneteka) sont fragiles par nature et marqués expérimentaux.
- Les services d'archives départementales n'ont pas d'API : accès par navigateur, puis import manuel de l'acte.
- Geneanet (CGU) et FamilySearch (API partenaires) : navigateur uniquement ; arbres tiers = pistes.
- Les frontières historiques de la carte sont des tracés indicatifs.
- La transcription manuscrite dépend d'un modèle de vision (Ollama local ou API) ; Tesseract seul ne lit pas l'écriture ancienne.
- Mode hébergé : pas de lecture des PDF (importer des images), durée limitée par appel (les enquêtes longues sont découpées), une seule exécution planifiée par jour sur le plan gratuit, recherche plein texte simplifiée sous Postgres.
- Pas de mise à jour automatique de l'application (installateur à relancer) ; l'updater Tauri pourra être activé avec une clé de signature.

## Prochaines étapes
1. Déployer sur Vercel (voir README) et vérifier depuis le téléphone ; ou lancer le workflow GitHub Actions pour Windows 11.
2. Tester chaque connecteur depuis un poste connecté ; corriger les analyseurs HTML ; marquer les statuts réels dans ARCHIVE_CONNECTORS.md.
3. Recherches réelles sur les personnes que vous fournirez.
4. Connecteurs supplémentaires : tous les départements français (modèle AD54), FranceArchives via export, Grand Mémorial direct.
5. Updater Tauri signé, paquets macOS/Linux.
