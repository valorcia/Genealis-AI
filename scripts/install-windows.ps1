# Installation guidée GENEALIS AI sous Windows 11 (depuis les sources) — à exécuter dans PowerShell :
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
# Options : -SansNavigateur (pas de Playwright / Browser Use), -SansInterface (pas de construction du frontend)
# Prérequis : Python 3.11+ (python.org, cocher "Add python.exe to PATH"), Node.js 20+ (nodejs.org, version LTS).
# Pour l'installateur Tauri seulement : Rust (rustup) + Visual Studio Build Tools.
# Guide pas à pas : docs\INSTALLATION_WINDOWS.md
param([switch]$SansNavigateur, [switch]$SansInterface)
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Etape($m) { Write-Host "`n== $m ==" -ForegroundColor Cyan }
function Ok($m) { Write-Host "  OK   $m" -ForegroundColor Green }
function Info($m) { Write-Host "  ...  $m" }
function Stop-Erreur($m) { Write-Host "  ERREUR  $m" -ForegroundColor Red; Write-Host "  Voir docs\INSTALLATION_WINDOWS.md (Dépannage)."; exit 1 }

Write-Host "GENEALIS AI : installation guidée" -ForegroundColor Cyan

# ---------------------------------------------------------------------------------------------------------------
Etape "1/8 Python 3.11 ou plus récent"
$PyCmd = $null
foreach ($c in @("python", "py")) {
  if (Get-Command $c -ErrorAction SilentlyContinue) {
    # l'alias « python » du Microsoft Store n'est pas un vrai Python : il échoue ici et on passe au suivant
    try { $v = & $c -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null } catch { $v = $null }
    if ($LASTEXITCODE -eq 0 -and $v) { $PyCmd = $c; break }
  }
}
if (-not $PyCmd) { Stop-Erreur "Python est introuvable. Installez Python 3.12 depuis https://www.python.org/downloads/ en cochant « Add python.exe to PATH », puis rouvrez PowerShell." }
$major, $minor = $v.Split(".") | ForEach-Object { [int]$_ }
if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 11)) { Stop-Erreur "Python $v est trop ancien : installez Python 3.11 ou plus récent." }
Ok "Python $v ($PyCmd)"

# ---------------------------------------------------------------------------------------------------------------
Etape "2/8 Node.js 20 ou plus récent (interface)"
if (-not $SansInterface) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Stop-Erreur "Node.js est introuvable. Installez la version LTS depuis https://nodejs.org/ puis rouvrez PowerShell." }
  $nv = (node --version).TrimStart("v")
  if ([int]($nv.Split(".")[0]) -lt 20) { Stop-Erreur "Node.js $nv est trop ancien : installez la version LTS (20 ou plus)." }
  Ok "Node.js $nv"
} else { Info "ignoré (-SansInterface)" }

# ---------------------------------------------------------------------------------------------------------------
Etape "3/8 Environnement Python (.venv) et dépendances du moteur"
if (-not (Test-Path ".venv")) { & $PyCmd -m venv .venv; if ($LASTEXITCODE -ne 0) { Stop-Erreur "Création de .venv impossible." } }
$Py = Join-Path $Root ".venv\Scripts\python.exe"
& $Py -m pip install --upgrade pip | Out-Null
& $Py -m pip install -e "backend[dev]"
if ($LASTEXITCODE -ne 0) { Stop-Erreur "Installation des dépendances du moteur impossible (connexion Internet ?)." }
Ok "Moteur installé"

# ---------------------------------------------------------------------------------------------------------------
Etape "4/8 Navigation autonome : Playwright + Browser Use (open source, local)"
if (-not $SansNavigateur) {
  & $Py -m pip install -e "backend[browser]"
  if ($LASTEXITCODE -ne 0) { Stop-Erreur "Installation de Playwright / Browser Use impossible." }
  Ok "Playwright et Browser Use installés (aucun service cloud payant n'est activé)"
  Etape "5/8 Navigateur Chromium pour Playwright"
  & $Py -m playwright install chromium
  if ($LASTEXITCODE -ne 0) { Stop-Erreur "Téléchargement de Chromium impossible. Réessayez : .venv\Scripts\python.exe -m playwright install chromium" }
  Ok "Chromium installé (navigateur isolé, distinct de votre navigateur habituel)"
} else { Info "ignoré (-SansNavigateur)"; Etape "5/8 Chromium"; Info "ignoré" }

# ---------------------------------------------------------------------------------------------------------------
Etape "6/8 Fichier de configuration .env"
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Ok ".env créé depuis .env.example (aucun secret dedans : complétez-le si besoin)"
} else { Ok ".env déjà présent (inchangé)" }
Info "La clé Gemini ne s'écrit PAS dans un fichier : saisissez-la dans Paramètres de l'application, ou avec scripts\start-worker.ps1 -SetGeminiKey."

# ---------------------------------------------------------------------------------------------------------------
Etape "7/8 Interface"
if (-not $SansInterface) {
  Set-Location (Join-Path $Root "frontend")
  npm install
  if ($LASTEXITCODE -ne 0) { Set-Location $Root; Stop-Erreur "npm install a échoué." }
  npm run build
  if ($LASTEXITCODE -ne 0) { Set-Location $Root; Stop-Erreur "La construction de l'interface a échoué." }
  Set-Location $Root
  Ok "Interface construite (frontend\dist)"
} else { Info "ignoré (-SansInterface)" }

# ---------------------------------------------------------------------------------------------------------------
Etape "8/8 Test rapide"
Set-Location (Join-Path $Root "backend")
& $Py -c "import genealis.main; print('moteur : OK')"
if ($LASTEXITCODE -ne 0) { Set-Location $Root; Stop-Erreur "Le moteur ne démarre pas." }
if (-not $SansNavigateur) {
  & $Py -m genealis.browser.worker --check
  if ($LASTEXITCODE -ne 0) { Write-Host "  ATTENTION : le diagnostic du navigateur signale un problème (voir ci-dessus)." -ForegroundColor Yellow }
}
Set-Location $Root

Write-Host "`nInstallation terminée." -ForegroundColor Green
Write-Host "Étapes suivantes (détaillées dans docs\INSTALLATION_WINDOWS.md) :"
Write-Host "  1. Lancer l'application locale  : scripts\start-portable.ps1   (ouvre http://127.0.0.1:8765)"
Write-Host "  2. Clé Gemini                   : Paramètres → Intelligence artificielle (stockée chiffrée sur ce PC)"
Write-Host "  3. Worker navigateur (ce PC)    : scripts\start-worker.ps1 -Local"
Write-Host "     ou relié à l'application en ligne : scripts\start-worker.ps1 -Server https://votre-app.vercel.app"
Write-Host "  Installateur Windows (facultatif) : scripts\build-backend.ps1 puis 'cargo tauri build' dans src-tauri (ou GitHub Actions)."
