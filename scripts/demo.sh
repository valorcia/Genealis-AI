#!/usr/bin/env bash
# Démonstration avec des données FICTIVES dans un dossier séparé (jamais votre arbre réel).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export GENEALIS_DATA_DIR="${GENEALIS_DATA_DIR:-$HOME/GenealisAI-demo}"
export GENEALIS_PORT="${GENEALIS_PORT:-8766}"
cd "$ROOT/backend"
"$ROOT/.venv/bin/python" -m genealis.demo
exec "$ROOT/.venv/bin/python" run_backend.py --open --port "$GENEALIS_PORT"
