# Démarre GENEALIS AI en mode portable (moteur + interface dans le navigateur).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location (Join-Path $Root "backend")
& (Join-Path $Root ".venv\Scripts\python.exe") run_backend.py --open
