# PROJECT_STATUS.md — GENEALIS AI

_Mis à jour le 01/11/2026 (v0.1.0)._ Ce fichier distingue strictement ce qui est **terminé**, **testé**, **en cours** et **limité**.

## Fonctionnalités terminées (code écrit)

### Mode hébergé (Vercel) et mobile — nouveau
- Même moteur Python exposé en fonction serverless (`api/index.py`, `vercel.json`, `requirements.txt`), base **PostgreSQL (Neon)** ou SQLite au choix via `DATABASE_URL`, documents sur **Vercel Blob** (`storage.py`), recherche plein texte portable (FTS5 sous SQLite, LIKE sans accents sous Postgres), clé de chiffrement par variable d'environnement, initialisation paresseuse.
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
- 28 tests automatisés verts, exécutés **sur SQLite et sur PostgreSQL 16** (export/import JSON, exécution bornée, protection par mot de passe, recherche plein texte portable ajoutés) (`backend/genealis/tests`) : dates et calendriers, variantes de noms, contradictions, confiance et sources indépendantes, homonymes jamais choisis arbitrairement, import/export GEDCOM aller-retour, flux API complet (création, relations, boucle interdite, arbre, frise, tableau de bord, sources, exports, import, FTS, assistant, connecteurs non opérationnels par défaut), premier démarrage et questions, moteur (plan, homonymes → question, mode autonome enregistre, mode assisté demande validation, questions non répétitives, reprise après interruption, équilibre des branches), sauvegarde/restauration chiffrée, intégrité des documents, extraction par règles, index INSEE local, parsing Gallica.
- Exécutable PyInstaller du moteur démarré et vérifié (santé, interface servie, création de personne).
- Interface vérifiée dans un navigateur (Playwright, `scripts/ui_smoke.cjs`) contre le moteur réel chargé des données fictives, en mode local **et** en simulation du mode hébergé (Postgres + mot de passe + serverless), en fenêtre d'ordinateur et en fenêtre mobile 390×844 : les 12 routes se rendent sans erreur JavaScript ni erreur serveur (seules les tuiles OpenStreetMap échouent, réseau bloqué).
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
