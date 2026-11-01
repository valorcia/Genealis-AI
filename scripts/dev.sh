#!/usr/bin/env bash
# Lancement en développement : moteur Python + interface Vite (http://localhost:5173).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend" && "$ROOT/.venv/bin/python" -m uvicorn genealis.main:app --host 127.0.0.1 --port 8765 --reload &
BACK=$!
trap 'kill $BACK 2>/dev/null || true' EXIT
cd "$ROOT/frontend" && npm run dev
