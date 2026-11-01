# GENEALIS AI

Application locale de généalogie intelligente et de recherche historique autonome.
Elle construit votre arbre à partir des archives **sans jamais inventer une personne, une filiation, une date ou un événement**, conserve la chaîne complète des sources, signale les contradictions et vous pose des questions quand une décision ne peut pas être tranchée par les preuves.

## Architecture

| Couche | Technologie | Rôle |
|---|---|---|
| Desktop | Tauri 2 (Rust) | Fenêtre native Windows 11 (macOS/Linux compatibles), lance le moteur local |
| Interface | React 19 + TypeScript + Tailwind CSS 4 + React Flow + Leaflet | Tableau de bord, arbre, frise, carte, enquêtes, archives, questions, assistant, paramètres |
| Moteur | Python 3.11+ / FastAPI / SQLAlchemy 2 | Modèle généalogique, moteur d'enquête, agents, connecteurs, IA documentaire, exports |
| Données | SQLite (WAL) + FTS5 | Base locale unique dans le dossier de données utilisateur, sauvegardes chiffrables |
| IA | Ollama (local, gratuit) ou Claude via API (optionnel, sur autorisation explicite) | Transcription, extraction, reformulation de l'assistant. Sans IA, tout fonctionne par règles. |

Tout est **local** : aucune donnée n'est transmise à un service externe sans autorisation explicite ; chaque transmission est journalisée.

## Déploiement sur Vercel (recommandé : accessible depuis votre téléphone)

GENEALIS AI fonctionne aussi comme un site privé hébergé gratuitement sur Vercel, utilisable sur mobile. Tout est gratuit : hébergement, base de données, sources d'archives (aucune clé API payante requise ; l'IA locale est optionnelle).

1. **Dépôt** : importez ce dépôt (`valorcia/Genealis-AI`) dans Vercel (« Add New Project »). Vercel reconnaît un projet **multi-services** grâce au `vercel.json` à la racine : le service `frontend` (interface Vite) et le service `backend` (moteur FastAPI, point d'entrée `genealis.main:app`), reliés par les règles de réécriture (`/api/*` → moteur, le reste → interface) ; la tâche planifiée quotidienne y est aussi déclarée. Laissez *Root Directory* à la racine et ne modifiez pas le framework détecté (« Services »).
2. **Base de données** : onglet *Storage* du projet Vercel → créez une base **Neon Postgres** (gratuite) et connectez-la au projet : la variable `DATABASE_URL` (ou `POSTGRES_URL`) est ajoutée automatiquement.
3. **Documents** (facultatif, pour stocker vos images d'actes) : *Storage* → **Blob** → la variable `BLOB_READ_WRITE_TOKEN` est ajoutée automatiquement.
4. **Variables d'environnement** (*Settings → Environment Variables*) :
   - `ACCESS_TOKEN` : votre mot de passe d'accès (obligatoire : vos données sont privées).
   - `SECRET_KEY` : une phrase longue et aléatoire (chiffre les clés API enregistrées dans les paramètres).
   - `CRON_SECRET` : une autre phrase aléatoire (protège la tâche planifiée quotidienne).
   - `ANTHROPIC_API_KEY` (facultatif, payant) : pour la transcription d'actes manuscrits par Claude. Sans elle, l'application fonctionne par règles et par les sources d'archives gratuites.
5. **Déployez**. Ouvrez l'adresse fournie, saisissez votre mot de passe, puis suivez l'assistant de premier démarrage (6 étapes, tout est facultatif).

Comment les recherches avancent sans ordinateur allumé : le moteur travaille **à la demande** — chaque fois que l'application est ouverte (téléphone ou ordinateur), elle fait avancer la file d'enquêtes par tranches de 50 secondes ; en plus, une **tâche planifiée quotidienne** (Vercel Cron, 5 h 17 UTC) fait avancer la file sans vous. Toutes les découvertes, questions et décisions sont dans la base : rien n'est perdu entre deux visites.

Limites du gratuit : les fonctions Vercel sont limitées en durée (jusqu'à 300 s par appel) ; un acte volumineux en PDF doit être importé en image (JPEG/PNG) car la lecture PDF n'est pas incluse dans la version hébergée ; le plan gratuit n'autorise qu'une exécution planifiée par jour.

Sauvegarde : *Paramètres → Sauvegardes → Télécharger la sauvegarde (JSON)*. Ce fichier se restaure sur Vercel ou dans l'application de bureau.

## Installation (Windows 11)

### Option A — Installateur (recommandé)
L'installateur `GENEALIS AI_0.1.0_x64-setup.exe` (NSIS) et le `.msi` sont produits par GitHub Actions (`.github/workflows/build-installer.yml`) à chaque push ; téléchargez l'artefact `genealis-ai-windows`. L'installateur :
1. installe l'application dans votre profil utilisateur (pas de droits administrateur) ;
2. installe WebView2 s'il manque ;
3. crée la base de données automatiquement au premier lancement dans `%APPDATA%\fr.genealis.ai` ;
4. lance l'assistant de configuration (prénom, nom, parents, grands-parents, pays d'origine, documents).

Le même artefact contient `GenealisAI-portable-windows.zip` : un exécutable unique qui démarre le moteur et ouvre l'interface dans votre navigateur (`http://127.0.0.1:8765`), sans installation.

### Option B — Depuis les sources
Prérequis : Python 3.11+, Node.js 20+. Pour l'installateur Tauri : Rust (rustup) et Visual Studio Build Tools.
```powershell
git clone https://github.com/valorcia/Genealis-AI.git
cd Genealis-AI
scripts\install-windows.ps1     # crée .venv, installe les dépendances, construit l'interface
scripts\start-portable.ps1      # démarre le moteur et ouvre le navigateur
```
Linux / macOS :
```bash
python3 -m venv .venv && .venv/bin/pip install -e "backend[dev]"
(cd frontend && npm install && npm run build)
scripts/start-portable.sh
```
Développement (rechargement à chaud) : `scripts/dev.sh` (moteur sur 8765, interface Vite sur 5173).

### Construire l'installateur soi-même
```powershell
scripts\build-backend.ps1                       # moteur → src-tauri\binaries\genealis-backend-<triple>.exe
npm --prefix frontend run build
cd src-tauri ; cargo install tauri-cli --version "^2" ; cargo tauri build
```

## Premier démarrage
Le plus simple : **Recherche IA → « Démarrer par mes grands-parents »**. Saisissez le couple (même partiellement) et, si vous les connaissez, leurs enfants ; vous n'avez pas besoin de vous saisir vous-même. La recherche IA démarre aussitôt. Ensuite, depuis l'arbre interactif ou une fiche, « Ajouter des proches » ajoute en un geste père, mère, frères et sœurs, enfants, conjoint ou grands-parents.

Mode par défaut : **autonome contrôlé** (le plus simple pour un novice) — le moteur cherche, vérifie, enregistre ce qui est prouvé et vous pose une question uniquement quand les preuves ne suffisent pas. Sur le tableau de bord, le bandeau « Que se passe-t-il ? » vous dit toujours quoi faire ensuite (répondre, lancer, attendre).

L'assistant demande vos informations et celles de vos parents/grands-parents (les champs inconnus peuvent rester vides), propose l'import d'un GEDCOM existant, crée les premières fiches et, si vous l'autorisez, planifie les premières investigations selon le **mode d'autonomie** choisi :

1. **Assisté** — l'IA propose, vous validez chaque recherche.
2. **Semi-autonome** — l'IA cherche, mais demande validation avant toute filiation incertaine.
3. **Autonome contrôlé** — l'IA enregistre ce qui est suffisamment corroboré ; le reste reste en hypothèses.

## Sources d'archives
Voir `ARCHIVE_CONNECTORS.md` (généré depuis le code). Toutes les sources sont **gratuites et sans clé API**. Important : un connecteur n'est affiché comme opérationnel qu'après un test réel réussi depuis votre machine (« Enquêtes IA → Connecteurs → Tester »). Le fichier des décès INSEE peut être importé localement (open data) pour des recherches entièrement hors ligne.

## IA documentaire — quelles options, et à quel prix
| Option | Coût | Automatique ? | Fonctionne sur Vercel ? |
|---|---|---|---|
| **Claude / ChatGPT avec votre abonnement** (copier-coller) | inclus dans votre abonnement | non : l'app prépare le texte à coller avec l'image, vous collez la réponse | oui |
| **Gemini (Google AI Studio)** | gratuit (clé sans carte bancaire sur aistudio.google.com/apikey) | oui, lecture des actes manuscrits | oui |
| Ollama (modèle local, `ollama pull llava`) | gratuit | oui | non : seulement avec l'application de bureau sur le même PC |
| Claude via API (Anthropic) | payant à l'usage, clé API distincte de l'abonnement | oui | oui |
| Tesseract (OCR classique) | gratuit | oui, mais imprimés seulement | non (bureau uniquement) |

Les abonnements claude.ai Pro et ChatGPT Plus n'offrent aucun accès automatique aux applications tierces ; le mode copier-coller est la seule façon de les utiliser en respectant leurs conditions.

Sans moteur, les documents sont conservés intacts et la transcription peut être saisie à la main.
Une transcription automatique n'est jamais présentée comme certaine (mots incertains marqués `[?mot]`).

## Tests
```bash
cd backend && ../.venv/bin/python -m pytest -q
```
Les jeux de données de test sont fictifs et isolés dans une base temporaire ; ils ne touchent jamais votre arbre.

## Dossiers
- `backend/` moteur Python (API `http://127.0.0.1:8765/docs` pour la documentation interactive)
- `frontend/` interface React
- `src-tauri/` coque desktop
- `scripts/` installation, lancement, construction
- `PROJECT_STATUS.md` état d'avancement ; `ARCHIVE_CONNECTORS.md` sources intégrées

## Règles absolues appliquées dans le code
Jamais d'ancêtre inventé · jamais de filiation sur le seul patronyme (plafond de score) · sources toujours conservées · contradictions jamais masquées (signalées, jamais supprimées) · question posée quand les preuves ne suffisent pas · aucune archive « consultée » sans requête réelle (journal) · aucun résultat simulé · transcription IA jamais une preuve parfaite · hypothèses concurrentes jamais supprimées automatiquement · fonctionnalité déclarée terminée seulement après test · respect des CGU (robots.txt, pas de contournement) · documents originaux jamais modifiés (copie intègre, empreinte SHA-256).
