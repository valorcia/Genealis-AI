# Installer GENEALIS AI sur Windows 11 — pas à pas

Ce guide s'adresse à une personne qui n'a jamais installé de logiciel « depuis les sources ». Comptez 20 à 30 minutes.
Vous n'avez besoin d'aucun compte payant : tout ce qui est installé ici est gratuit et fonctionne sur votre PC.

Ce que vous allez obtenir :

- **l'application GENEALIS AI** sur votre PC (`http://127.0.0.1:8765` dans votre navigateur) ;
- **le worker navigateur** : un petit programme qui ouvre les sites d'archives à votre place, sur votre PC, avec un
  navigateur isolé (Playwright + Browser Use open source). C'est lui qui permet aussi à l'application en ligne
  (Vercel, utilisable sur votre téléphone) de consulter des archives, car un serveur en ligne ne peut pas faire
  tourner de navigateur.

---

## 1. Installer Python (une seule fois)

1. Allez sur <https://www.python.org/downloads/> et cliquez sur **Download Python 3.12** (ou plus récent, au moins 3.11).
2. Lancez le fichier téléchargé. **Important : cochez la case « Add python.exe to PATH »** en bas de la première
   fenêtre, puis cliquez sur **Install Now**.
3. Vérifiez : ouvrez le menu Démarrer, tapez **PowerShell**, ouvrez-le, puis tapez :
   ```powershell
   python --version
   ```
   Vous devez voir `Python 3.12.x` (ou 3.11, 3.13…).

## 2. Installer Node.js (une seule fois)

1. Allez sur <https://nodejs.org/> et téléchargez la version **LTS**.
2. Installez-la avec les options proposées par défaut.
3. Vérifiez dans un **nouveau** PowerShell : `node --version` doit afficher `v20…` ou plus.

## 3. Récupérer GENEALIS AI

Si vous avez Git : `git clone https://github.com/valorcia/Genealis-AI.git`.
Sinon, sur la page GitHub du projet : bouton vert **Code → Download ZIP**, puis clic droit sur le fichier → **Extraire tout**
(par exemple dans `Documents\Genealis-AI`).

## 4. Lancer l'installation guidée

Dans PowerShell, placez-vous dans le dossier du projet puis lancez le script :

```powershell
cd $HOME\Documents\Genealis-AI
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

Le script fait tout, étape par étape, et s'arrête avec un message clair en cas de problème :

| Étape | Ce qui se passe |
|---|---|
| 1-2 | vérifie Python (3.11 ou plus) et Node.js (20 ou plus) |
| 3 | crée un environnement Python isolé (`.venv`) et installe le moteur |
| 4 | installe **Playwright** et **Browser Use open source** (`pip install -e "backend[browser]"`) — aucun service payant |
| 5 | télécharge **Chromium** pour Playwright (`python -m playwright install chromium`, environ 150 Mo) |
| 6 | crée le fichier de configuration `.env` à partir de `.env.example` (il ne contient aucun secret) |
| 7 | construit l'interface |
| 8 | test rapide : le moteur démarre, Chromium s'ouvre, Browser Use est présent |

Options : `-SansNavigateur` (pas de navigation autonome), `-SansInterface` (si l'interface est déjà construite).

## 5. Démarrer l'application et configurer Gemini

1. Lancez l'application : `scripts\start-portable.ps1`. Votre navigateur s'ouvre sur `http://127.0.0.1:8765`.
2. Créez une clé Gemini gratuite sur <https://aistudio.google.com/apikey> (compte Google nécessaire).
3. Dans l'application : **Paramètres → Intelligence artificielle** → fournisseur **Gemini**, collez la clé, cochez
   **Autoriser l'IA externe**. La clé est **chiffrée** sur votre PC ; elle n'apparaît jamais dans un fichier ni dans
   l'interface.

Sans clé Gemini, la navigation fonctionne quand même avec les recettes déterministes (stratégie la moins chère) ;
seul l'agent IA (Browser Use) est indisponible.

## 6. Lancer le worker navigateur

### Cas A — vous utilisez l'application sur ce PC

Dans un **second** PowerShell (laissez l'application ouverte) :

```powershell
scripts\start-worker.ps1 -Local
```

Le worker utilise la clé Gemini enregistrée dans Paramètres. Il affiche « En attente de missions… » : il prend en charge
les tâches de navigation des enquêtes. **Ctrl+C** l'arrête proprement (la mission en cours est remise en attente).

### Cas B — vous utilisez l'application en ligne (Vercel, téléphone)

Le worker tourne sur votre PC et se relie à l'application en ligne avec votre **mot de passe d'accès** (la variable
`ACCESS_TOKEN` que vous avez définie dans Vercel).

1. Rangez la clé Gemini **sur ce PC** (le serveur en ligne ne la transmet jamais au worker, c'est voulu) :
   ```powershell
   scripts\start-worker.ps1 -SetGeminiKey
   ```
   Collez la clé (rien ne s'affiche pendant la saisie, c'est normal). Elle est stockée chiffrée dans la base locale.
2. Lancez le worker :
   ```powershell
   scripts\start-worker.ps1 -Server https://votre-application.vercel.app
   ```
   Le mot de passe d'accès est demandé. Pour ne plus le saisir, ouvrez `.env` avec le Bloc-notes et renseignez
   `GENEALIS_SERVER_URL=` et `GENEALIS_ACCESS_TOKEN=` (ce fichier reste sur votre PC ; il est exclu de git).

Le worker ne travaille que lorsque votre PC est allumé et le worker lancé. Il interroge l'application toutes les
15 secondes.

## 7. Vérifier que tout fonctionne

- `scripts\start-worker.ps1 -Check` : diagnostic (Python, Playwright, Chromium, Browser Use, clé Gemini locale ; avec
  `-Server …` ou `-Local`, l'application est aussi contactée).
- L'état du worker (connecté, dernier contact, Playwright, Browser Use) est fourni par `GET /api/worker/status` ; le
  **Centre d'investigation** de l'application s'en sert pour indiquer si votre PC est relié.
- Lancez une enquête : le fil d'activité affiche « Navigation … prise en charge par le PC », puis chaque page ouverte,
  chaque document téléchargé et, si besoin, « Action requise ».

## 8. Quand le worker demande votre aide

Si un site affiche un CAPTCHA, demande une connexion ou un abonnement, le worker **ne contourne jamais** la protection.
Une fenêtre de navigateur s'ouvre sur la page : agissez vous-même (le worker ne saisit jamais d'identifiant à votre
place), puis appuyez sur **Entrée** dans la fenêtre du worker (ou utilisez **J'ai terminé** dans l'application). La
recherche reprend. Sans réponse sous 15 minutes, la tâche reste **BLOQUÉE** et vous pourrez la relancer.

Pour Geneanet, FamilySearch, Ancestry, MyHeritage et Filae, dont les conditions interdisent l'automatisation, la page
est simplement ouverte dans votre navigateur habituel : consultez-la vous-même puis importez le document trouvé.

## 9. Dépannage

| Problème | Solution |
|---|---|
| « python n'est pas reconnu » | Réinstallez Python en cochant **Add python.exe to PATH**, puis ouvrez un **nouveau** PowerShell. |
| « l'exécution de scripts est désactivée » | Lancez les scripts avec `powershell -ExecutionPolicy Bypass -File scripts\…ps1`. |
| Chromium ne démarre pas | `.venv\Scripts\python.exe -m playwright install chromium`, puis `scripts\start-worker.ps1 -Check`. Si votre antivirus bloque Chromium, autorisez le dossier `%LOCALAPPDATA%\ms-playwright`. |
| Chromium personnalisé | Indiquez son chemin dans `.env` : `GENEALIS_CHROMIUM_PATH=C:\chemin\chrome.exe`. |
| « Mot de passe d'accès refusé » (HTTP 401) | Le mot de passe doit être exactement la valeur de `ACCESS_TOKEN` dans Vercel. |
| « Serveur injoignable » | Vérifiez l'adresse (`https://…vercel.app`, sans `/` final), votre connexion Internet, ou que l'application locale est lancée (`-Local`). |
| L'agent IA n'est jamais utilisé | Clé Gemini absente sur ce PC (`-SetGeminiKey`), **Autoriser l'IA externe** décoché, ou plafond d'appels atteint (page **Coûts**). |
| Proxy d'entreprise | Le navigateur du worker se connecte directement à Internet (via sa garde de sécurité locale) : un proxy d'entreprise obligatoire n'est pas pris en charge dans cette version. |
| Les accents s'affichent mal dans PowerShell | Utilisez PowerShell 7 (`winget install Microsoft.PowerShell`) ou Windows Terminal. |

Les journaux de l'application sont dans `%APPDATA%\GenealisAI\logs`. Le worker écrit dans sa fenêtre ; ajoutez `-v`
(`.venv\Scripts\python.exe -m genealis.browser.worker -v …`) pour plus de détails.
