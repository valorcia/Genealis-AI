# ARCHIVE_CONNECTORS.md — Sources réellement intégrées et capacités vérifiées

_Généré le 31/10/2026 par `scripts/gen_connectors_doc.py` à partir du registre des connecteurs._

## Principe d'honnêteté

- **Aucun connecteur n'est affiché comme opérationnel tant que son test réel (`POST /api/research/connectors/{id}/test`) n'a pas réussi** depuis la machine de l'utilisateur. Le statut par défaut est « non testé ».
- L'environnement de développement cloud où ce projet a été construit **bloquait l'accès réseau à tous les sites d'archives** (seuls les dépôts de paquets étaient joignables). Les capacités ci-dessous sont donc déclarées d'après la documentation publique de chaque service et **doivent être validées depuis votre poste** via le tableau de bord « Enquêtes IA → Connecteurs ».
- Aucun contournement de CAPTCHA, d'authentification ou de protection anti-robot n'est implémenté ; `robots.txt` est consulté avant toute lecture HTML.
- Tous les connecteurs sont **gratuits et sans clé API**. Les modes « navigateur » ouvrent la bonne page de recherche ; l'acte est ensuite importé manuellement pour analyse.

## Synthèse

| Mode d'accès | Nombre |
|---|---|
| API documentée | 9 |
| Lecture de pages HTML (expérimental) | 3 |
| Navigateur (assisté) | 35 |

Total : 47 connecteurs.

## France

### Fichier des décès INSEE (matchID) (`insee_deces`)

- **Organisme** : INSEE / ministère de l'Intérieur (matchID)
- **Mode d'accès** : API documentée — gratuit, sans clé
- **Collections** : Fichier des personnes décédées depuis 1970
- **Zones** : * · **Période** : 1970 – aujourd’hui · **Langues** : fr
- **Champs de recherche** : surname, given_names, birth_date, year_from, year_to, commune
- **Formats** : json
- **Limites** : Décès survenus en France uniquement / Depuis 1970 seulement / Limitation de débit côté serveur
- **Droits** : Licence Ouverte 2.0 (Etalab) ([conditions](https://deces.matchid.io/about))
- **Site** : https://deces.matchid.io
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Fichier des décès INSEE – index local (hors ligne) (`insee_deces_local`)

- **Organisme** : INSEE (open data, data.gouv.fr)
- **Mode d'accès** : API documentée — gratuit, sans clé
- **Collections** : Personnes décédées en France depuis 1970 (fichiers annuels importés localement)
- **Zones** : * · **Période** : 1970 – aujourd’hui · **Langues** : fr
- **Champs de recherche** : surname, given_names, birth_date, year_from, year_to
- **Formats** : txt (largeur fixe)
- **Limites** : Nécessite le téléchargement préalable des fichiers annuels (≈ 100 Mo par année) / Décès survenus en France depuis 1970 uniquement / Recherche strictement locale ensuite
- **Droits** : Licence Ouverte 2.0 (Etalab) ; gratuit, sans clé ([conditions](https://www.data.gouv.fr/fr/datasets/fichier-des-personnes-decedees/))
- **Site** : https://www.data.gouv.fr/fr/datasets/fichier-des-personnes-decedees/
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Aucun service tiers interrogé lors des recherches. Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### FranceArchives (portail national) (`francearchives`)

- **Organisme** : Service interministériel des Archives de France
- **Mode d'accès** : Lecture de pages HTML (expérimental) — gratuit, sans clé
- **Collections** : Inventaires des archives publiques; Grand Mémorial (militaires 14-18); Bases nominatives agrégées
- **Zones** : * · **Période** : 800 – 2026 · **Langues** : fr
- **Champs de recherche** : surname, given_names, commune, year_from, year_to
- **Formats** : html
- **Limites** : Résultats d'inventaires, rarement des actes nominatifs / Pages HTML : analyse fragile / Les images restent sur les sites des services d'archives
- **Droits** : Licence Ouverte pour les métadonnées (vérifier par fonds) ([conditions](https://francearchives.gouv.fr/fr/cgu))
- **Site** : https://francearchives.gouv.fr
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Gallica (BnF) – presse et imprimés (`gallica`)

- **Organisme** : Bibliothèque nationale de France
- **Mode d'accès** : API documentée — gratuit, sans clé
- **Collections** : Presse régionale et nationale (Est Républicain partiel, Journal de la Meurthe...); Annuaires et almanachs; Bottins; Monographies et nobiliaires; Bulletins des lois (naturalisations)
- **Zones** : * · **Période** : 1600 – 1950 · **Langues** : fr
- **Champs de recherche** : surname, given_names, commune, year_from, year_to
- **Formats** : xml, images
- **Limites** : Recherche plein texte dans l'OCR : bruit et faux positifs possibles / Mentions dans la presse = indices, pas des actes
- **Droits** : Usage non commercial libre ; gratuit, sans clé ([conditions](https://gallica.bnf.fr/edit/und/conditions-dutilisation-des-contenus-de-gallica))
- **Site** : https://gallica.bnf.fr
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : API SRU documentée (https://api.bnf.fr/fr/api-gallica-de-recherche). Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Référentiel des communes (geo.api.gouv.fr) (`geo_api_gouv`)

- **Organisme** : Etalab / IGN
- **Mode d'accès** : API documentée — gratuit, sans clé
- **Collections** : Communes, départements, coordonnées
- **Zones** : * · **Période** : … – aujourd’hui · **Langues** : fr
- **Champs de recherche** : commune
- **Formats** : json
- **Limites** : Communes actuelles uniquement (pas de communes disparues)
- **Droits** : Licence Ouverte ([conditions](https://geo.api.gouv.fr/))
- **Site** : https://geo.api.gouv.fr
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Utilisé pour géocoder les lieux. Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Archives départementales de Meurthe-et-Moselle (`ad54`)

- **Organisme** : Archives départementales de Meurthe-et-Moselle
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : État civil et registres paroissiaux; Tables décennales; Recensements; Registres matricules; Archives notariales (inventaires)
- **Zones** : 54 · **Période** : 1500 – 1950 · **Langues** : fr
- **Champs de recherche** : commune, register_type, year_from
- **Formats** : images en ligne (visionneuse)
- **Limites** : Pas d'API publique connue : consultation par navigateur / Les images sont consultables en ligne ; réutilisation selon le règlement du service
- **Droits** : Règlement de réutilisation du service ([conditions](https://archives.meurthe-et-moselle.fr))
- **Site** : https://archives.meurthe-et-moselle.fr
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Priorité 1 du projet (Nancy, Lunéville, Toul, Briey, Longwy). Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Archives départementales de la Haute-Marne (`ad52`)

- **Organisme** : Archives départementales de la Haute-Marne
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : État civil et registres paroissiaux; Tables décennales; Recensements; Registres matricules
- **Zones** : 52 · **Période** : 1500 – 1950 · **Langues** : fr
- **Champs de recherche** : commune, register_type, year_from
- **Formats** : images en ligne (visionneuse)
- **Limites** : Pas d'API publique connue : consultation par navigateur / Les images sont consultables en ligne ; réutilisation selon le règlement du service
- **Droits** : Règlement de réutilisation du service ([conditions](https://archives.haute-marne.fr))
- **Site** : https://archives.haute-marne.fr
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Archives départementales de la Haute-Saône (`ad70`)

- **Organisme** : Archives départementales de la Haute-Saône
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : État civil et registres paroissiaux; Tables décennales; Recensements; Registres matricules
- **Zones** : 70 · **Période** : 1500 – 1950 · **Langues** : fr
- **Champs de recherche** : commune, register_type, year_from
- **Formats** : images en ligne (visionneuse)
- **Limites** : Pas d'API publique connue : consultation par navigateur / Les images sont consultables en ligne ; réutilisation selon le règlement du service
- **Droits** : Règlement de réutilisation du service ([conditions](https://archives.haute-saone.fr))
- **Site** : https://archives.haute-saone.fr
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Archives départementales de la Meuse (`ad55`)

- **Organisme** : Archives départementales de la Meuse
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : État civil et registres paroissiaux; Tables décennales; Recensements; Registres matricules
- **Zones** : 55 · **Période** : 1500 – 1950 · **Langues** : fr
- **Champs de recherche** : commune, register_type, year_from
- **Formats** : images en ligne (visionneuse)
- **Limites** : Pas d'API publique connue : consultation par navigateur / Les images sont consultables en ligne ; réutilisation selon le règlement du service
- **Droits** : Règlement de réutilisation du service ([conditions](https://archives.meuse.fr))
- **Site** : https://archives.meuse.fr
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Archives départementales de la Moselle (`ad57`)

- **Organisme** : Archives départementales de la Moselle
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : État civil et registres paroissiaux; Tables décennales; Recensements; Registres matricules; Optants 1872
- **Zones** : 57 · **Période** : 1500 – 1950 · **Langues** : fr
- **Champs de recherche** : commune, register_type, year_from
- **Formats** : images en ligne (visionneuse)
- **Limites** : Pas d'API publique connue : consultation par navigateur / Les images sont consultables en ligne ; réutilisation selon le règlement du service
- **Droits** : Règlement de réutilisation du service ([conditions](https://www.archives57.com))
- **Site** : https://www.archives57.com
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Documents en français et en allemand (annexion 1871-1918). Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Archives départementales des Vosges (`ad88`)

- **Organisme** : Archives départementales des Vosges
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : État civil et registres paroissiaux; Tables décennales; Recensements; Registres matricules
- **Zones** : 88 · **Période** : 1500 – 1950 · **Langues** : fr
- **Champs de recherche** : commune, register_type, year_from
- **Formats** : images en ligne (visionneuse)
- **Limites** : Pas d'API publique connue : consultation par navigateur / Les images sont consultables en ligne ; réutilisation selon le règlement du service
- **Droits** : Règlement de réutilisation du service ([conditions](https://archives.vosges.fr))
- **Site** : https://archives.vosges.fr
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Archives municipales de Nancy (`am_nancy`)

- **Organisme** : Archives municipales de Nancy
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : État civil de Nancy; Recensements de Nancy; Listes électorales; Fonds iconographiques
- **Zones** : 54 · **Période** : 1600 – 1950 · **Langues** : fr
- **Champs de recherche** : commune, register_type, year_from
- **Formats** : images en ligne (visionneuse)
- **Limites** : Pas d'API publique connue : consultation par navigateur / Les images sont consultables en ligne ; réutilisation selon le règlement du service
- **Droits** : Règlement de réutilisation du service ([conditions](https://www.nancy.fr/culturelle/archives-municipales))
- **Site** : https://www.nancy.fr/culturelle/archives-municipales
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Archives nationales (salle des inventaires virtuelle) (`archives_nationales`)

- **Organisme** : Archives nationales (salle des inventaires virtuelle)
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Minutier central des notaires de Paris; Naturalisations (dossiers BB/11); Légion d'honneur (Léonore)
- **Zones** : * · **Période** : 800 – 1950 · **Langues** : fr
- **Champs de recherche** : commune, register_type, year_from
- **Formats** : images en ligne (visionneuse)
- **Limites** : Pas d'API publique connue : consultation par navigateur / Les images sont consultables en ligne ; réutilisation selon le règlement du service
- **Droits** : Règlement de réutilisation du service ([conditions](https://www.siv.archives-nationales.culture.gouv.fr))
- **Site** : https://www.siv.archives-nationales.culture.gouv.fr
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Base Léonore (Légion d'honneur) (`leonore`)

- **Organisme** : Base Léonore (Légion d'honneur)
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Dossiers de légionnaires 1802-1977
- **Zones** : * · **Période** : 1802 – 1950 · **Langues** : fr
- **Champs de recherche** : commune, register_type, year_from
- **Formats** : images en ligne (visionneuse)
- **Limites** : Pas d'API publique connue : consultation par navigateur / Les images sont consultables en ligne ; réutilisation selon le règlement du service
- **Droits** : Règlement de réutilisation du service ([conditions](https://www.leonore.archives-nationales.culture.gouv.fr))
- **Site** : https://www.leonore.archives-nationales.culture.gouv.fr
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Grand Mémorial (soldats 1914-1918, registres matricules) (`grand_memorial`)

- **Organisme** : FranceArchives / ministère de la Culture
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Registres matricules indexés (76 départements); Morts pour la France
- **Zones** : * · **Période** : 1860 – 2026 · **Langues** : fr
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Gratuit, sans compte, mais sans recherche automatisable : consultation par navigateur
- **Droits** : Gratuit ; conditions du site ([conditions](https://www.culture.fr/Genealogie/Grand-Memorial))
- **Site** : https://www.culture.fr/Genealogie/Grand-Memorial
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Généafrance (relevés d'associations) (`geneafrance`)

- **Organisme** : Généafrance
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Relevés d'actes par département (gratuits selon associations)
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : fr
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Gratuit, sans compte, mais sans recherche automatisable : consultation par navigateur
- **Droits** : Gratuit ; conditions du site ([conditions](https://www.geneafrance.com))
- **Site** : https://www.geneafrance.com
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Limédia Kiosque (presse de Lorraine) (`limedia`)

- **Organisme** : Sillon Lorrain (bibliothèques de Nancy, Metz, Épinal, Thionville)
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Est Républicain, Journal de la Meurthe et des Vosges, Le Lorrain… (avis de décès, mariages, faits divers)
- **Zones** : * · **Période** : 1800 – 2026 · **Langues** : fr
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Gratuit, sans compte, mais sans recherche automatisable : consultation par navigateur
- **Droits** : Gratuit ; conditions du site ([conditions](https://kiosque.limedia.fr))
- **Site** : https://kiosque.limedia.fr
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Mémoire des Hommes (ministère des Armées) (`memoire_des_hommes`)

- **Organisme** : Mémoire des Hommes (ministère des Armées)
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Morts pour la France 1914-1918; Registres matricules (partiels); Personnels de l'armée de terre
- **Zones** : * · **Période** : 1700 – 1950 · **Langues** : fr
- **Champs de recherche** : commune, register_type, year_from
- **Formats** : images en ligne (visionneuse)
- **Limites** : Pas d'API publique connue : consultation par navigateur / Les images sont consultables en ligne ; réutilisation selon le règlement du service
- **Droits** : Règlement de réutilisation du service ([conditions](https://www.memoiredeshommes.sga.defense.gouv.fr))
- **Site** : https://www.memoiredeshommes.sga.defense.gouv.fr
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### MémorialGenWeb (monuments aux morts) (`memorialgenweb`)

- **Organisme** : Association MémorialGenWeb
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Relevés des monuments aux morts et plaques commémoratives; Soldats de toutes les guerres
- **Zones** : * · **Période** : 1800 – 2026 · **Langues** : fr
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Gratuit, sans compte, mais sans recherche automatisable : consultation par navigateur
- **Droits** : Gratuit ; conditions du site ([conditions](https://www.memorialgenweb.org))
- **Site** : https://www.memorialgenweb.org
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Italie

### Portale Antenati (Italie) (`antenati`)

- **Organisme** : Direzione Generale Archivi – Ministero della Cultura
- **Mode d'accès** : Lecture de pages HTML (expérimental) — gratuit, sans clé
- **Collections** : Stato civile napoleonico (1806-1815); Stato civile della restaurazione; Stato civile italiano (1866-); Liste di leva; Registri parrocchiali (sélection)
- **Zones** : * · **Période** : 1800 – 1950 · **Langues** : it, la
- **Champs de recherche** : surname, given_names, commune, year_from, year_to
- **Formats** : html, IIIF
- **Limites** : Recherche nominative disponible seulement pour les fonds indexés / Majorité des registres non indexés : navigation par commune/année / Images IIIF consultables en ligne ; téléchargement selon les conditions du portail
- **Droits** : Vérifier les conditions du portail (usage personnel autorisé) ([conditions](https://antenati.cultura.gov.it/note-legali/))
- **Site** : https://antenati.cultura.gov.it
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Antenati – navigation par commune (Italie) (`antenati_browse`)

- **Organisme** : Archivi di Stato
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Registres non indexés : parcours par archive d'État, commune, année
- **Zones** : * · **Période** : 1800 – 2026 · **Langues** : it
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Gratuit, sans compte, mais sans recherche automatisable : consultation par navigateur
- **Droits** : Gratuit ; conditions du site ([conditions](https://antenati.cultura.gov.it/archivi/))
- **Site** : https://antenati.cultura.gov.it/archivi/
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Pologne

### Szukaj w Archiwach (Pologne) (`szukajwarchiwach`)

- **Organisme** : Naczelna Dyrekcja Archiwów Państwowych
- **Mode d'accès** : Lecture de pages HTML (expérimental) — gratuit, sans clé
- **Collections** : Registres d'état civil et paroissiaux (akta stanu cywilnego); Inventaires des archives d'État; Documents numérisés
- **Zones** : * · **Période** : 1500 – 1950 · **Langues** : pl, de, la, ru
- **Champs de recherche** : surname, given_names, commune, year_from, year_to
- **Formats** : html, images
- **Limites** : Indexation nominative partielle (projets Geneteka séparés) / Documents en polonais, allemand, latin, russe / Frontières historiques : certains fonds sont conservés en Ukraine, Biélorussie, Lituanie
- **Droits** : Vérifier le règlement du portail ([conditions](https://www.szukajwarchiwach.gov.pl/en/regulamin))
- **Site** : https://www.szukajwarchiwach.gov.pl
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Genbaza / Metryki (scans de registres polonais) (`genbaza`)

- **Organisme** : Genealodzy.pl
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Scans de registres paroissiaux et d'état civil polonais
- **Zones** : * · **Période** : 1600 – 2026 · **Langues** : pl
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Gratuit, sans compte, mais sans recherche automatisable : consultation par navigateur
- **Droits** : Gratuit ; conditions du site ([conditions](https://metryki.genealodzy.pl))
- **Site** : https://metryki.genealodzy.pl
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Geneteka (PTG, Pologne) (`geneteka`)

- **Organisme** : Polskie Towarzystwo Genealogiczne
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Index des actes de baptême, mariage, décès (bénévoles)
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : pl
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://geneteka.genealodzy.pl))
- **Site** : https://geneteka.genealodzy.pl
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Index bénévole très riche pour la Pologne ; chaque entrée renvoie souvent au scan de l'acte. Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Poznań Project (mariages Grande-Pologne 1800-1899) (`poznan_project`)

- **Organisme** : Łukasz Bielecki
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Index des mariages de la région de Poznań 1800-1899
- **Zones** : * · **Période** : 1800 – 2026 · **Langues** : pl, en, de
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Gratuit, sans compte, mais sans recherche automatisable : consultation par navigateur
- **Droits** : Gratuit ; conditions du site ([conditions](https://poznan-project.psnc.pl))
- **Site** : https://poznan-project.psnc.pl
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Belgique

### Open Archives (Pays-Bas / Belgique) (`openarch`)

- **Organisme** : Open Archieven (Coret Genealogie)
- **Mode d'accès** : API documentée — gratuit, sans clé
- **Collections** : État civil et registres paroissiaux néerlandais; Actes belges (partiel); Index de recensements, notaires, militaires
- **Zones** : * · **Période** : 1500 – 1970 · **Langues** : nl, fr, en
- **Champs de recherche** : surname, given_names, year_from, year_to
- **Formats** : json
- **Limites** : Couverture surtout Pays-Bas ; Belgique et France frontalière partielles
- **Droits** : API publique gratuite ; mention de la source demandée ([conditions](https://www.openarch.nl/api/docs/))
- **Site** : https://www.openarch.nl
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Archives de l'État en Belgique (`be_search_arch`)

- **Organisme** : Archives générales du Royaume
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Registres paroissiaux et état civil belges; Index nominatifs
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : fr, nl
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://search.arch.be))
- **Site** : https://search.arch.be
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Luxembourg

### Archives nationales de Luxembourg (`lu_anlux`)

- **Organisme** : ANLux
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : État civil (via FamilySearch/Matricula partiel); Inventaires
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : fr, de
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://anlux.public.lu))
- **Site** : https://anlux.public.lu
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Allemagne

### Archivportal-D (Allemagne) (`de_archivportal`)

- **Organisme** : Deutsche Digitale Bibliothek
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Inventaires des archives allemandes
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : de
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://www.archivportal-d.de))
- **Site** : https://www.archivportal-d.de
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Suisse

### Archives Online (Suisse) (`ch_archives_online`)

- **Organisme** : Archives cantonales
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Inventaires cantonaux
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : de, fr, it
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://www.archives-online.org))
- **Site** : https://www.archives-online.org
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Autriche

### Archivinformationssystem (Autriche) (`at_archivinformationssystem`)

- **Organisme** : Österreichisches Staatsarchiv
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Inventaires fédéraux
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : de
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://www.archivinformationssystem.at))
- **Site** : https://www.archivinformationssystem.at
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Tchéquie

### Archives régionales tchèques (registres paroissiaux) (`cz_regional`)

- **Organisme** : Archives d'État régionales
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Matriky (registres paroissiaux) numérisés
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : cs, de, la
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://www.mza.cz/actapublica/))
- **Site** : https://www.mza.cz/actapublica/
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Slovaquie

### Slovaquie (registres via FamilySearch) (`sk_familysearch`)

- **Organisme** : Slovenský národný archív
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Registres paroissiaux (numérisés chez FamilySearch)
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : sk, hu, la
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://www.minv.sk/?archivy))
- **Site** : https://www.minv.sk/?archivy
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Hongrie

### Hungaricana (Hongrie) (`hu_hungaricana`)

- **Organisme** : Bibliothèque du Parlement hongrois
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Recensements, inventaires, registres
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : hu
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://hungaricana.hu))
- **Site** : https://hungaricana.hu
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Espagne

### PARES (Espagne) (`es_pares`)

- **Organisme** : Ministerio de Cultura
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Portail des archives espagnoles
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : es
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://pares.mcu.es))
- **Site** : https://pares.mcu.es
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Portugal

### Digitarq / Arquivos nacionais (Portugal) (`pt_digitarq`)

- **Organisme** : Torre do Tombo
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Registres paroissiaux numérisés; Passeports
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : pt
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://digitarq.arquivos.pt))
- **Site** : https://digitarq.arquivos.pt
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Royaume-Uni

### The National Archives – Discovery (Royaume-Uni) (`uk_tna_discovery`)

- **Organisme** : The National Archives (Kew)
- **Mode d'accès** : API documentée — gratuit, sans clé
- **Collections** : Catalogue Discovery (TNA + 2 500 services d'archives britanniques); Index de naturalisations; Dossiers militaires (index)
- **Zones** : * · **Période** : 1000 – 2026 · **Langues** : en
- **Champs de recherche** : surname, given_names, year_from, year_to
- **Formats** : json
- **Limites** : Catalogue : descriptions, pas les images / Quota d'appels raisonnable attendu
- **Droits** : Open Government Licence (métadonnées) ([conditions](https://www.nationalarchives.gov.uk/legal/))
- **Site** : https://discovery.nationalarchives.gov.uk
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## États-Unis

### National Archives Catalog (États-Unis) (`us_nara`)

- **Organisme** : NARA
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Catalogue fédéral; Naturalisations (index); Listes de passagers (index partiels)
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : en
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://catalog.archives.gov))
- **Site** : https://catalog.archives.gov
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : API v2 disponible avec clé gratuite ; non intégrée tant que non testée. Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## Canada

### Bibliothèque et Archives Canada (`ca_lac`)

- **Organisme** : BAC
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Recensements du Canada; Listes de passagers; Dossiers militaires
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : fr, en
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://recherche-collection-search.bac-lac.gc.ca))
- **Site** : https://recherche-collection-search.bac-lac.gc.ca
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

## International / plateformes

### Géocodage OpenStreetMap (Nominatim) (`nominatim`)

- **Organisme** : OpenStreetMap Foundation
- **Mode d'accès** : API documentée — gratuit, sans clé
- **Collections** : Lieux du monde entier (communes, hameaux)
- **Zones** : * · **Période** : … – aujourd’hui · **Langues** : fr
- **Champs de recherche** : commune
- **Formats** : json
- **Limites** : 1 requête/seconde maximum (politique d'usage) / Lieux actuels
- **Droits** : ODbL ; gratuit, sans clé ([conditions](https://operations.osmfoundation.org/policies/nominatim/))
- **Site** : https://nominatim.openstreetmap.org
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Internet Archive (livres numérisés) (`internet_archive`)

- **Organisme** : Internet Archive
- **Mode d'accès** : API documentée — gratuit, sans clé
- **Collections** : Livres et annuaires numérisés; Histoires locales; Nobiliaires et armoriaux; Registres imprimés
- **Zones** : * · **Période** : 1500 – 1960 · **Langues** : en, fr
- **Champs de recherche** : surname, commune
- **Formats** : json, pdf, txt
- **Limites** : Recherche sur les métadonnées et le texte intégral : résultats indicatifs
- **Droits** : Gratuit, sans clé ([conditions](https://archive.org/about/terms.php))
- **Site** : https://archive.org
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Wikidata (lieux et noms historiques) (`wikidata`)

- **Organisme** : Wikimedia Foundation
- **Mode d'accès** : API documentée — gratuit, sans clé
- **Collections** : Communes, anciens noms (allemand, polonais, italien, latin), coordonnées
- **Zones** : * · **Période** : … – aujourd’hui · **Langues** : fr
- **Champs de recherche** : commune
- **Formats** : json
- **Limites** : Qualité variable selon les entités
- **Droits** : CC0 ; gratuit, sans clé ([conditions](https://www.wikidata.org/wiki/Wikidata:Data_access))
- **Site** : https://www.wikidata.org
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Archives Portal Europe (`archives_portal_europe`)

- **Organisme** : APEF
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Inventaires de 7 000 services d'archives européens
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : en, fr, de, pl, it
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Gratuit, sans compte, mais sans recherche automatisable : consultation par navigateur
- **Droits** : Gratuit ; conditions du site ([conditions](https://www.archivesportaleurope.net))
- **Site** : https://www.archivesportaleurope.net
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### FamilySearch (`familysearch`)

- **Organisme** : FamilySearch International
- **Mode d'accès** : Navigateur (assisté) — identifiants requis
- **Collections** : Index nominatifs mondiaux; Images de registres (selon accords); Arbre collaboratif (pistes)
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : en, fr
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : API partenaires uniquement / Compte gratuit requis pour consulter
- **Droits** : Conditions du site ([conditions](https://www.familysearch.org))
- **Site** : https://www.familysearch.org
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : API officielle réservée aux partenaires agréés (clé développeur). Sans accord, consultation dans le navigateur (compte gratuit). Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Geneanet (`geneanet`)

- **Organisme** : Geneanet SA
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Arbres d'utilisateurs (pistes, jamais preuves); Relevés collaboratifs; Bibliothèque numérisée
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : fr, en
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Accès automatisé interdit par les CGU / Arbres tiers = pistes à vérifier (règle du projet)
- **Droits** : Conditions du site ([conditions](https://www.geneanet.org))
- **Site** : https://www.geneanet.org
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Les CGU interdisent la collecte automatisée : recherche dans le navigateur, puis import GEDCOM de votre propre arbre. Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Matricula Online (registres paroissiaux) (`matricula`)

- **Organisme** : Diocèses d'Autriche, Allemagne, Pologne, Slovénie…
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Registres paroissiaux catholiques numérisés
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : de, la, pl
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Pas d'API publique utilisable sans accord : consultation par navigateur
- **Droits** : Conditions du site ([conditions](https://data.matricula-online.eu))
- **Site** : https://data.matricula-online.eu
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Navigation par diocèse/paroisse ; pas d'index nominatif. Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.

### Roglo (base généalogique libre) (`roglo`)

- **Organisme** : Roglo
- **Mode d'accès** : Navigateur (assisté) — gratuit, sans clé
- **Collections** : Arbre collaboratif libre (pistes à vérifier)
- **Zones** : * · **Période** : 1500 – 2026 · **Langues** : fr
- **Champs de recherche** : surname, given_names
- **Formats** : html
- **Limites** : Gratuit, sans compte, mais sans recherche automatisable : consultation par navigateur
- **Droits** : Gratuit ; conditions du site ([conditions](https://roglo.eu))
- **Site** : https://roglo.eu
- **Statut vérifié** : non testé dans l'environnement de développement (réseau bloqué) — à tester depuis l'application.
- **Notes** : Capacités déclarées d'après la documentation publique ; non vérifiées tant que le test n'a pas réussi.
