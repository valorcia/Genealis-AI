#!/usr/bin/env bash
# Mode portable (sans Tauri) : sert l'interface compilée depuis le moteur et ouvre le navigateur.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/frontend/dist/index.html" ] || (cd "$ROOT/frontend" && npm run build)
cd "$ROOT/backend" && exec "$ROOT/.venv/bin/python" run_backend.py --open "$@"
