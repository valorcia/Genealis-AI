# Installation guidée GENEALIS AI sous Windows 11 (depuis les sources) — à exécuter dans PowerShell.
# Prérequis : Python 3.11+ (python.org, cocher "Add to PATH"), Node.js 20+, et pour l'installateur Tauri : Rust (rustup) + Visual Studio Build Tools.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Write-Host "== GENEALIS AI : installation ==" -ForegroundColor Cyan
Set-Location $Root
if (-not (Test-Path ".venv")) { python -m venv .venv }
& ".venv\Scripts\python.exe" -m pip install --upgrade pip | Out-Null
& ".venv\Scripts\python.exe" -m pip install -e "backend[dev]"
Set-Location (Join-Path $Root "frontend")
npm install
npm run build
Set-Location $Root
Write-Host "Installation terminée." -ForegroundColor Green
Write-Host "Lancer l'application : scripts\start-portable.ps1  (ouvre http://127.0.0.1:8765 dans votre navigateur)"
Write-Host "Construire l'installateur Windows : scripts\build-backend.ps1 puis 'npm --prefix frontend run build' et 'cargo tauri build' dans src-tauri (ou laissez GitHub Actions le produire)."
