# Lecture des écritures anciennes (paléographie) — GENEALIS AI v0.4

Ce module lit les photos et scans de documents anciens (actes, registres paroissiaux, actes notariés, photos) et les
présente en trois couches liées : **ORIGINAL — TRANSCRIPTION — TRADUCTION**. Il ne remplace pas la lecture humaine :
une transcription automatique n'est jamais une preuve, et une hypothèse de lecture n'est jamais présentée comme une
certitude.

## 1. Ce que fait une lecture

`genealis.paleo.read_document(db, media, options=...)` (API : `POST /api/media/{id}/readings`) :

1. **Original préservé** : le fichier importé est lu (`services/storage.read_bytes`), son empreinte SHA-256 est vérifiée et
   enregistrée dans la lecture ; il n'est **jamais** modifié.
2. **Copie de travail** (`paleo/preprocess.py`, Pillow) : orientation EXIF, rotation choisie, découpe éventuelle,
   contraste automatique, réduction à 3000 px. Les opérations sont listées dans `reading.preprocessing`.
3. **Un appel principal** au moteur de lecture (Gemini par défaut) qui combine : identification de l'écriture et de la
   langue, zones de texte, transcription **diplomatique** ligne par ligne avec coordonnées, passages incertains avec
   lectures alternatives classées, version **normalisée** séparée, traduction (par ligne et complète), extraction
   généalogique (personnes, rôles, liens déclarés, âges, métiers, domiciles, signatures).
   La consigne contient les pièges propres à l'écriture identifiée (`paleo/scripts.py`) et les corrections humaines
   déjà faites sur la même main (`paleo/scribe.py`).
4. **Seconde passe agrandie** (`paleo/second_pass.py`) sur les passages incertains qui ont une zone : découpe de la
   zone avec du contexte, agrandie (≥ 1600 px si possible, ×4 au plus), contraste et netteté, nouvel appel avec des
   mots du même document lus avec certitude pour comparer les formes de lettres. **Plafond : 6 par document.**
   Jamais de remplacement silencieux : la lecture affichée reste celle de la première passe ; la seconde passe ajoute
   un avis (`concordant` / `discordant` / `undecided`) et des alternatives classées. Même concordante, la lecture reste
   à vérifier.
5. **Nouvelle version** enregistrée (`document_readings`, `version` = n+1) ; les versions précédentes restent consultables.
6. `Media.analysis` et `Media.ocr_text` sont mis à jour pour que les écrans v0.3 (Archives, Interpréter) affichent la
   dernière lecture.

Toutes les coordonnées `bbox` sont `[x, y, largeur, hauteur]` en **millièmes (0-1000) de l'image originale** telle
qu'elle s'affiche (orientation EXIF appliquée). Le modèle répond au format Gemini `box_2d = [ymin, xmin, ymax, xmax]`
relatif à la copie envoyée ; la conversion inverse (rotation, découpe) est faite par `preprocess.Transform`.

### Économie d'appels
- Cache automatique d'`AIClient` : une lecture identique (même image, même consigne) ne repart pas chez Google.
- Une seule lecture principale (identification + transcription + zones + traduction + extraction).
- Seconde passe seulement pour les passages incertains, plafonnée ; la relecture d'une zone (bouton « Relire cette
  zone ») est une action explicite de l'utilisateur.
- Les plafonds (jour, minute, enquête, budget) d'`AIClient` s'appliquent : un `QuotaExceeded` est renvoyé en **HTTP 429**
  avec un message clair ; pendant la seconde passe, il interrompt la seconde passe (la lecture principale est gardée et
  `quality.second_pass_interrupted` le signale).

### Protection des personnes vivantes
Chaque appel transmet `subject_person_ids=[media.person_id]` : un document rattaché à une personne peut-être vivante
n'est jamais envoyé sans autorisation (`ExternalTransferRefused` → **HTTP 403**). Les appels v0.3 de
`ai/documents.py` passent désormais aussi ce paramètre.

## 2. Écritures et langues prises en charge (consignes spécifiques)

| Identifiant | Écriture | Exemples de consignes |
|---|---|---|
| `french_cursive` | Cursive française XVIIe–XIXe | ſ/f, u/v, i/j, 7bre/8bre/9bre/Xbre, led./lad., Me, Sr, « a déclaré ne savoir signer » |
| `secretary` | Écriture secrétaire XVIe | ligatures, e inversé, abréviations par suspension / contraction |
| `humanistic` | Humanistique / italique | ſ, &, ⁊, ę |
| `gothic_textura` | Gothique allemande, Fraktur | ſ vs f, aͤ → ä, noms en caractères romains |
| `kurrent` | Kurrent | e ≈ n, arc sur le u, ſ/s, h à boucle, r ≈ w, « getauft », « Taufpaten », « ehelich » |
| `suetterlin` | Sütterlin (1915–1941) | mêmes pièges que le Kurrent, majuscules propres |
| `latin_ecclesiastical` | Latin paroissial | « baptizatus est », « filius legitimus », « patrini », « quondam », noms déclinés, prénoms latinisés |
| `italian_cursive` | Italien historique | « fu » (défunt), « di anni », « figlio di », formulaires imprimés |
| `polish_cursive` | Polonais ancien | « syn », « córka », « świadkowie », « Działo się… », -owa / -ówna, actes en russe après 1868 |
| `cyrillic_cursive` | Cyrillique pré-1918 | ѣ, і, ѳ, ѵ, ъ ; т ≈ m, и ≈ u ; calendrier julien (jamais converti en silence) |
| `print`, `typewritten` | Imprimé, dactylographié | distinguer formulaire imprimé et mentions manuscrites |

Abréviations transversales : **notariales françaises** et **ecclésiastiques latines** (`ABBREVIATION_SETS`).
Catalogue complet : `GET /api/paleo/scripts`.

## 3. Moteurs de lecture (aucun modèle ne lit tout)

`paleo/htr.py` définit le protocole `HTRProvider` :
- `GeminiHTR` — modèle multimodal configuré (Gemini recommandé, niveau gratuit) via `AIClient.complete`.
- `ManualHTR` — copier-coller avec claude.ai / chatgpt.com (abonnement) : `GET /api/media/{id}/readings/manual-prompt`,
  puis `POST /api/media/{id}/readings` avec `{"engine": "manual", "manual_text": "…"}`. Accepte le JSON paléographique
  ou l'ancien format v0.3 (transcription + `===JSON===`).
- `ExternalHTR` — moteur spécialisé (Transkribus, Kraken, TrOCR… derrière une adresse HTTP). **Désactivé par défaut.**
  Il refuse de fonctionner sans `htr_external_url` **et** `htr_external_authorized = true` ; en mode GRATUIT, seules les
  adresses locales (127.0.0.1 / localhost) sont acceptées. Aucun service payant n'est appelé par le code fourni.

## 4. Photos

`media.kind = photo|portrait` (ou `document_kind: "photo"`) → analyse de photographie (`paleo/photo.py`) : éléments
visibles, personnes décrites par position / vêtements / objets / posture, inscriptions (transcrites et localisées),
cachet du photographe, indices géographiques, période approximative avec ses indices.
**Aucune personne n'est identifiée à partir de son visage** : la consigne l'interdit explicitement et le résultat est
filtré (seuls des champs descriptifs sont conservés ; les phrases de « ressemblance » sont écartées). Aucune mention de
personne n'est créée à partir d'une photo.

## 5. Vérification humaine

- Lecteur `/documents/:mediaId/lecture` : zoom molette / pincement jusqu'à ×12 (bascule automatique sur le fichier
  original en haute définition), déplacement, rotation, contraste, négatif, niveaux de gris (affichage seulement),
  zones lues superposées, clic sur une ligne ↔ surbrillance sur l'image, passages incertains surlignés avec lectures
  alternatives, outil de découpe → « Relire cette zone », panneaux parallèles Original | Transcription (fidèle /
  modernisée) | Traduction, onglets sur téléphone, correction manuelle ligne par ligne, « J'ai tout vérifié ».
- Corrections (`PATCH /api/readings/{id}/lines/{n}`) : enregistrées dans `reading_corrections` avec la clé de la main
  (`scribe_key` : source / dépôt / commune / registre / cote, ou choix de l'utilisateur) et le type d'écriture. Les
  paires « lu → corrigé » sont réinjectées dans la consigne des lectures suivantes de la même main (puis du même type
  d'écriture), et signalées sur les lignes concernées (« Je vérifie et j'applique »), jamais appliquées en silence.
- `GET /api/media/{id}/view?rotate=&contrast=auto|1.5&negative=&gray=&crop=x,y,w,h&max=` : image dérivée calculée à la
  volée, jamais enregistrée.

## 6. Personnes citées

`POST /api/readings/{id}/mentions` → `PersonMention` : rôle (époux, épouse, parrain, témoin…), nom tel qu'écrit, forme
normalisée, lien déclaré (« oncle maternel de l'épouse » → `relation_kind=uncle`, `relation_side=maternal`,
`relation_to_role=bride`, et `relation_to_mention_id` vers la mention de l'épouse), âge tel qu'écrit, métier, domicile,
signature, extrait et zone de l'image, lisibilité du nom. Analyse des liens en français, latin (avunculus, patruus…),
allemand, italien et polonais (wuj, stryj…). **Aucun lien automatique vers l'arbre** : `linked_person_id` reste vide ;
des candidats peuvent être proposés (`services/matching.py`), avec l'avertissement « à vérifier, jamais automatique ».

## 7. API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/paleo/scripts` | écritures, langues, abréviations, état des moteurs |
| POST | `/api/media/{id}/readings` | nouvelle lecture (options : `script_type`, `language`, `translate_to`, `second_pass`, `scribe_key`, `engine`, `manual_text`, `rotate`, `contrast`, `gray`, `negative`, `crop`, `document_kind`) |
| GET | `/api/media/{id}/readings` | versions de lecture |
| GET | `/api/media/{id}/readings/manual-prompt` | consigne copier-coller |
| GET | `/api/readings/{id}` | lecture complète (lignes, zones, incertitudes, corrections) |
| PATCH | `/api/readings/{id}/lines/{n}` | correction humaine `{text, layer?, note?}` |
| POST | `/api/readings/{id}/recheck` | seconde analyse `{line_n, bbox?, text?, index?}` |
| POST | `/api/readings/{id}/validate` | relue et validée par l'utilisateur |
| POST/GET | `/api/readings/{id}/mentions` | personnes citées |
| GET | `/api/media/{id}/view` | image dérivée à la volée |
| POST | `/api/paleo/benchmark` | CER/WER `{reading_id, reference_text}` ou `{reading_id, ref_id}` |
| GET | `/api/paleo/benchmarks` | résultats mesurés et références disponibles |
| GET | `/api/paleo/corrections` | corrections humaines (filtre `scribe_key`) |

Erreurs : 429 (plafond / quota), 403 (personne vivante, transmission non autorisée), 503 (aucun moteur disponible).

## 8. Mesurer la qualité (CER / WER)

« Une transcription a été produite » ne veut pas dire « le module fonctionne ». La qualité se mesure **uniquement** contre
une transcription de référence relue par un humain :

- **CER** = (substitutions + suppressions + insertions de caractères) / nombre de caractères de la référence ;
- **WER** = même calcul sur les mots ;
- variante **normalisée** : sans majuscules, accents ni ponctuation ; ſ/s, u/v, i/j unifiés (utile pour juger le sens
  plutôt que les conventions de transcription) ;
- rapport ligne par ligne (`paleo/benchmark.py`, rapidfuzz Levenshtein).

Références : `backend/genealis/data/paleo_refs/*.json` (format et règles dans le `README.md` du dossier). Les fichiers
`synthetique-*.json` sont des textes **inventés et marqués « synthétique »**, utilisés par les tests automatiques : ils
vérifient le calcul, pas la lecture d'une écriture réelle. Aucun texte de référence d'un document réel n'est fourni :
il doit venir d'une transcription vérifiée.

Aucun seuil « acceptable » n'est fixé à l'avance : comparez les moteurs et les types d'écriture entre eux sur vos
propres références, et gardez la relecture humaine dans tous les cas.

## 9. Protocole de test réel (à faire sur votre PC, avec Internet et une clé Gemini)

L'environnement de développement bloque Google et les sites d'archives : **aucune lecture réelle n'a été faite ici**.
Les tests automatiques utilisent des images dessinées par l'ordinateur et un Gemini simulé.

1. Paramètres → IA : Gemini, clé gratuite (aistudio.google.com), « Autoriser l'IA externe ». Lancez l'audit Gemini.
2. Téléchargez, depuis des sites publics et en respectant leurs conditions, **un document de chaque type** :
   - acte français du XVIIe s. (registre paroissial d'archives départementales en ligne) ;
   - registre paroissial en latin (ex. Matricula, archives diocésaines) ;
   - manuscrit en Kurrent (registre allemand ou alsacien-mosellan avant 1918) ;
   - acte italien du XIXe s. (Antenati) ;
   - acte polonais ancien (Szukaj w Archiwach / Geneteka → scans) ;
   - photo ancienne avec inscription ou cachet de photographe (photo de famille).
   N'utilisez pas de document concernant une personne vivante.
3. Pour chaque document : importez-le (Archives → Importer), ouvrez « Lire le document », lancez la lecture.
   Vérifiez : écriture et langue détectées, zones alignées sur l'image (cliquez sur des lignes), passages incertains
   pertinents, seconde passe sur les passages difficiles, traduction, personnes extraites et liens déclarés.
4. Transcrivez vous-même lentement 10 à 20 lignes de chaque document (ou reprenez une transcription publiée par une
   association, en citant la source), créez le fichier de référence dans `data/paleo_refs/`, puis « Mesurer la qualité ».
   Notez CER/WER bruts et normalisés par type d'écriture.
5. Corrigez quelques lignes, puis lisez une autre page du **même registre** : vérifiez que la correction est proposée
   (« Une relecture humaine de la même main a corrigé… ») et que la lecture s'améliore (nouveau CER).
6. Objectif final : ouvrir la photo d'un acte de 1650 et demander « Lis ce document, identifie toutes les personnes,
   explique les liens familiaux et recherche les actes permettant de vérifier les informations » — la lecture et les
   mentions viennent de ce module ; la recherche des actes de vérification relève du Centre d'investigation
   (tâches `analyze_document` → `verify` / `witness_followup`).

## 10. Limites connues

- Qualité réelle non mesurée ici (pas d'accès à Gemini ni aux archives) : à établir avec le protocole ci-dessus.
- Les coordonnées dépendent du modèle : Gemini renvoie des boîtes approximatives ; une ligne sans zone reste lisible
  mais n'est pas localisée (« position inconnue sur l'image »), et la seconde passe ne peut pas la relire.
- Le modèle peut signaler une page tournée (`rotation_needed`) : la lecture n'est pas relancée automatiquement (pour
  économiser un appel) ; relancez avec l'orientation proposée.
- PDF : rendu de la page via PyMuPDF quand il est installé (application de bureau) ; sinon le PDF est envoyé tel quel,
  sans seconde passe agrandie.
- Le mode copier-coller suppose que l'assistant externe renvoie le JSON demandé ; à défaut, la transcription est
  conservée sans coordonnées.
- `ExternalHTR` est un connecteur générique : chaque moteur réel (Transkribus, Kraken…) nécessite un petit service
  adaptateur respectant le contrat décrit dans `htr.py`.
