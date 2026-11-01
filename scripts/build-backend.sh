#!/usr/bin/env bash
# Construit le moteur en exécutable autonome puis le place comme sidecar Tauri (nom suffixé par la triple cible).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
PY="${PYTHON:-$ROOT/.venv/bin/python}"
[ -x "$PY" ] || PY=python3
"$PY" -m PyInstaller --noconfirm --clean genealis-backend.spec
TRIPLE="${TARGET_TRIPLE:-$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')}"
mkdir -p "$ROOT/src-tauri/binaries"
EXT=""; [[ "$TRIPLE" == *windows* ]] && EXT=".exe"
cp "dist/genealis-backend$EXT" "$ROOT/src-tauri/binaries/genealis-backend-$TRIPLE$EXT"
echo "Sidecar : $ROOT/src-tauri/binaries/genealis-backend-$TRIPLE$EXT"
