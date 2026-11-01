# Démarre le worker navigateur LOCAL de GENEALIS AI (Playwright + Browser Use open source) sur ce PC.
#   scripts\start-worker.ps1 -Local                                   (application locale de ce PC)
#   scripts\start-worker.ps1 -Server https://votre-app.vercel.app     (application en ligne ; mot de passe demandé)
#   scripts\start-worker.ps1 -SetGeminiKey                            (ranger la clé Gemini chiffrée sur ce PC)
#   scripts\start-worker.ps1 -Check                                   (diagnostic)
# Les valeurs de .env (GENEALIS_SERVER_URL, GENEALIS_ACCESS_TOKEN, GENEALIS_CHROMIUM_PATH…) sont lues au démarrage.
# Ctrl+C : arrêt propre (la mission en cours est remise en attente).
param([string]$Server, [string]$Token, [switch]$Local, [switch]$Visible, [switch]$Headless, [switch]$Once,
      [switch]$SetGeminiKey, [switch]$Check, [switch]$NoAssist)
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Py)) { Write-Host "Environnement Python absent : lancez d'abord scripts\install-windows.ps1" -ForegroundColor Red; exit 1 }

# Lecture de .env (sans écraser les variables déjà définies) ; les lignes vides ou commentées sont ignorées
$EnvFile = Join-Path $Root ".env"
if (Test-Path $EnvFile) {
  foreach ($line in Get-Content $EnvFile -Encoding UTF8) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$' -and $Matches[2] -ne "") {
      $name = $Matches[1]; $value = $Matches[2].Trim('"').Trim("'")
      if (-not [Environment]::GetEnvironmentVariable($name)) { [Environment]::SetEnvironmentVariable($name, $value, "Process") }
    }
  }
}

$a = @("-m", "genealis.browser.worker")
if ($Server) { $a += @("--server", $Server) }
if ($Token) { $a += @("--token", $Token) }
if ($Local) { $a += "--local" }
if ($Visible) { $a += "--visible" }
if ($Headless) { $a += "--headless" }
if ($Once) { $a += "--once" }
if ($NoAssist) { $a += "--no-assist" }
if ($SetGeminiKey) { $a += "--set-gemini-key" }
if ($Check) { $a += "--check" }
Set-Location (Join-Path $Root "backend")
& $Py @a
exit $LASTEXITCODE
