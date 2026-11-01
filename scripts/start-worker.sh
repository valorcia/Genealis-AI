#!/usr/bin/env bash
# Démarre le worker navigateur LOCAL de GENEALIS AI (Playwright + Browser Use open source).
#   scripts/start-worker.sh --local
#   scripts/start-worker.sh --server https://votre-app.vercel.app
#   scripts/start-worker.sh --set-gemini-key | --check | --visible | --once
# Les valeurs de .env sont lues au démarrage (sans écraser les variables déjà définies). Ctrl+C : arrêt propre.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || { echo "Environnement Python absent : python3 -m venv .venv && .venv/bin/pip install -e \"backend[browser]\""; exit 1; }
if [ -f "$ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    name="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
    [ -n "$value" ] && [ -z "${!name:-}" ] && export "$name=$value"
  done < "$ROOT/.env"
fi
cd "$ROOT/backend"
exec "$PY" -m genealis.browser.worker "$@"
