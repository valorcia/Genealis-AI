# Construit le moteur GENEALIS AI (Windows) et le place comme sidecar Tauri.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location (Join-Path $Root "backend")
$Py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Py)) { $Py = "python" }
& $Py -m PyInstaller --noconfirm --clean genealis-backend.spec
$Triple = if ($env:TARGET_TRIPLE) { $env:TARGET_TRIPLE } else { (rustc -vV | Select-String '^host: ').ToString().Replace('host: ', '') }
New-Item -ItemType Directory -Force (Join-Path $Root "src-tauri\binaries") | Out-Null
Copy-Item "dist\genealis-backend.exe" (Join-Path $Root "src-tauri\binaries\genealis-backend-$Triple.exe") -Force
Write-Host "Sidecar : src-tauri\binaries\genealis-backend-$Triple.exe"
