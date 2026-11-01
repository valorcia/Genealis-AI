#!/usr/bin/env bash
# =====================================================================================================================
# GENEALIS AI — installation du NAVIGATEUR AUTONOME sur un serveur Linux (Ubuntu 22.04/24.04 ou Debian 12),
# par exemple Oracle Cloud « Always Free » (Ampere ARM ou AMD), Hetzner, OVHcloud…
#
# Une seule commande, en SSH sur le serveur :
#   curl -fsSL https://raw.githubusercontent.com/valorcia/Genealis-AI/main/scripts/install-server-linux.sh | sudo bash
#
# Ce que fait le script :
#   1. installe Python, Git et les bibliothèques système de Chromium ;
#   2. télécharge GENEALIS dans /opt/genealis et installe Playwright + Browser Use (open source, gratuits) ;
#   3. vous demande l'adresse de votre application, votre mot de passe d'accès et (facultatif) votre clé Gemini,
#      rangés dans /etc/genealis-worker.env, lisible uniquement par l'administrateur (jamais dans le code) ;
#   4. installe un service qui démarre tout seul (et redémarre le serveur ou après une panne) ;
#   5. vérifie que tout fonctionne.
# Relancer le script = mise à jour (vos réglages sont conservés).
# Aucun port n'est ouvert : le serveur va chercher ses missions auprès de l'application, rien n'entre.
# =====================================================================================================================
set -euo pipefail

REPO_URL="${GENEALIS_REPO_URL:-https://github.com/valorcia/Genealis-AI.git}"
BRANCH="${GENEALIS_BRANCH:-main}"
APP_DIR="${GENEALIS_APP_DIR:-/opt/genealis}"
HOME_DIR="${GENEALIS_HOME_DIR:-/var/lib/genealis}"
ENV_FILE="${GENEALIS_ENV_FILE:-/etc/genealis-worker.env}"
SERVICE="genealis-worker"
RUN_USER="genealis"
DEFAULT_SERVER="https://genealis-ai.vercel.app"

say() { printf '\n\033[1;35m▶ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ask() { # ask "Question" "défaut" → réponse (lue sur le terminal, même si le script arrive par « curl | bash »)
  local q="$1" d="${2:-}" r=""
  if [ -r /dev/tty ]; then
    if [ -n "$d" ]; then printf '%s [%s] : ' "$q" "$d" >/dev/tty; else printf '%s : ' "$q" >/dev/tty; fi
    IFS= read -r r </dev/tty || true
  fi
  printf '%s' "${r:-$d}"
}
ask_secret() {
  local q="$1" r=""
  if [ -r /dev/tty ]; then printf '%s : ' "$q" >/dev/tty; IFS= read -rs r </dev/tty || true; printf '\n' >/dev/tty; fi
  printf '%s' "$r"
}

[ "$(id -u)" -eq 0 ] || die "Lancez le script en administrateur : … | sudo bash"
command -v apt-get >/dev/null || die "Ce script est prévu pour Ubuntu ou Debian (apt-get introuvable)."

# --------------------------------------------------------------------------------------------- 1. paquets système
say "1/5 — Paquets système (Python, Git)"
if [ "${GENEALIS_SKIP_APT:-0}" != "1" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git ca-certificates curl python3 python3-venv python3-pip >/dev/null
fi
PY=""
for c in python3.13 python3.12 python3.11 python3; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'; then PY="$(command -v "$c")"; break; fi
done
if [ -z "$PY" ] && [ "${GENEALIS_SKIP_APT:-0}" != "1" ]; then  # Ubuntu 22.04 : Python 3.10 par défaut
  apt-get install -y -qq python3.11 python3.11-venv >/dev/null 2>&1 && PY="$(command -v python3.11)"
fi
[ -n "$PY" ] || die "Python 3.11 ou plus récent est nécessaire (choisissez l'image Ubuntu 24.04)."
ok "$("$PY" --version) — $(uname -m)"

# Petits serveurs (1 Go) : un fichier d'échange évite que Chromium soit arrêté faute de mémoire
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 3000 ] && ! swapon --show | grep -q . && [ "${GENEALIS_SKIP_SWAP:-0}" != "1" ]; then
  say "Mémoire faible (${MEM_MB} Mo) : ajout de 2 Go d'espace d'échange"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "espace d'échange actif"
fi

# --------------------------------------------------------------------------------------------- 2. application
say "2/5 — Téléchargement de GENEALIS et installation du navigateur (quelques minutes)"
id "$RUN_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$HOME_DIR" --shell /usr/sbin/nologin "$RUN_USER"
mkdir -p "$HOME_DIR/data" && chown -R "$RUN_USER:$RUN_USER" "$HOME_DIR"
if [ -n "${GENEALIS_SOURCE_DIR:-}" ]; then           # (tests) copie d'un dossier local au lieu de GitHub
  mkdir -p "$APP_DIR" && cp -a "$GENEALIS_SOURCE_DIR/." "$APP_DIR/"
elif [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH" && git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"
as_user() { runuser -u "$RUN_USER" -- env HOME="$HOME_DIR" "$@"; }
[ -x "$APP_DIR/.venv/bin/python" ] || as_user "$PY" -m venv "$APP_DIR/.venv"
as_user "$APP_DIR/.venv/bin/pip" install -q --upgrade pip
as_user "$APP_DIR/.venv/bin/pip" install -q -e "$APP_DIR/backend[browser]"
ok "GENEALIS, Playwright et Browser Use installés"
if [ "${GENEALIS_SKIP_APT:-0}" != "1" ]; then
  "$APP_DIR/.venv/bin/python" -m playwright install-deps chromium >/dev/null
fi
if [ -z "${GENEALIS_CHROMIUM_PATH:-}" ]; then
  as_user "$APP_DIR/.venv/bin/python" -m playwright install chromium >/dev/null
fi
ok "Chromium installé"

# --------------------------------------------------------------------------------------------- 3. réglages
say "3/5 — Réglages (conservés si vous relancez le script)"
SERVER_URL="" ; ACCESS="" ; GKEY=""
if [ -f "$ENV_FILE" ]; then
  SERVER_URL=$(grep -E '^GENEALIS_SERVER_URL=' "$ENV_FILE" | cut -d= -f2- || true)
  ACCESS=$(grep -E '^GENEALIS_ACCESS_TOKEN=' "$ENV_FILE" | cut -d= -f2- | sed "s/^'//; s/'\$//" || true)
  GKEY=$(grep -E '^GEMINI_API_KEY=' "$ENV_FILE" | cut -d= -f2- | sed "s/^'//; s/'\$//" || true)
fi
SERVER_URL="${GENEALIS_SERVER_URL:-$SERVER_URL}"; ACCESS="${GENEALIS_ACCESS_TOKEN:-$ACCESS}"; GKEY="${GEMINI_API_KEY:-$GKEY}"
[ -n "$SERVER_URL" ] || SERVER_URL=$(ask "Adresse de votre application GENEALIS" "$DEFAULT_SERVER")
SERVER_URL="${SERVER_URL%/}"
case "$SERVER_URL" in https://*) ;; *) die "L'adresse doit commencer par https://";; esac
[ -n "$ACCESS" ] || ACCESS=$(ask_secret "Mot de passe d'accès de l'application (rien ne s'affiche pendant la saisie)")
[ -n "$ACCESS" ] || die "Le mot de passe d'accès est nécessaire pour relier le serveur à votre application."
if [ -z "$GKEY" ]; then
  GKEY=$(ask_secret "Clé Gemini (facultatif, Entrée pour passer ; sert à l'agent IA du navigateur)")
fi
q() { # valeur pour EnvironmentFile de systemd : entre apostrophes si elle contient des caractères spéciaux
  case "$1" in *"'"*) die "Les apostrophes ne sont pas acceptées dans le mot de passe ou la clé.";; esac
  case "$1" in *[!A-Za-z0-9._:/@+=-]*) printf "'%s'" "$1";; *) printf '%s' "$1";; esac
}
umask 077
{
  echo "# GENEALIS — réglages du navigateur autonome (lisible uniquement par l'administrateur)"
  echo "GENEALIS_SERVER_URL=$SERVER_URL"
  echo "GENEALIS_ACCESS_TOKEN=$(q "$ACCESS")"
  [ -n "$GKEY" ] && echo "GEMINI_API_KEY=$(q "$GKEY")"
  echo "GENEALIS_DATA_DIR=$HOME_DIR/data"
  [ -n "${GENEALIS_CHROMIUM_PATH:-}" ] && echo "GENEALIS_CHROMIUM_PATH=$GENEALIS_CHROMIUM_PATH"
  echo "ANONYMIZED_TELEMETRY=false"
  echo "BROWSER_USE_CLOUD_SYNC=false"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"; chown root:root "$ENV_FILE"
ok "réglages enregistrés dans $ENV_FILE"

# --------------------------------------------------------------------------------------------- 4. vérification
say "4/5 — Vérification"
set +e
( cd "$APP_DIR/backend" && runuser -u "$RUN_USER" -- env -i HOME="$HOME_DIR" PATH=/usr/bin:/bin \
    GENEALIS_SERVER_URL="$SERVER_URL" GENEALIS_ACCESS_TOKEN="$ACCESS" GEMINI_API_KEY="$GKEY" GENEALIS_DATA_DIR="$HOME_DIR/data" \
    GENEALIS_CHROMIUM_PATH="${GENEALIS_CHROMIUM_PATH:-}" ANONYMIZED_TELEMETRY=false \
    "$APP_DIR/.venv/bin/python" -m genealis.browser.worker --check --server "$SERVER_URL" )
CHECK=$?
set -e

# --------------------------------------------------------------------------------------------- 5. service
say "5/5 — Démarrage automatique"
if [ "${GENEALIS_NO_SYSTEMD:-0}" = "1" ] || ! command -v systemctl >/dev/null || [ ! -d /run/systemd/system ]; then
  echo "  (systemd indisponible : démarrage manuel → sudo -u $RUN_USER $APP_DIR/scripts/start-worker.sh --server $SERVER_URL --headless --no-assist)"
else
  cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=GENEALIS AI - navigateur autonome (Playwright + Browser Use)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
EnvironmentFile=$ENV_FILE
Environment=HOME=$HOME_DIR
WorkingDirectory=$APP_DIR/backend
ExecStart=$APP_DIR/.venv/bin/python -m genealis.browser.worker --server \${GENEALIS_SERVER_URL} --headless --no-assist --worker-id serveur-%H
Restart=always
RestartSec=20
KillSignal=SIGINT
TimeoutStopSec=60
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$HOME_DIR

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable -q "$SERVICE"
  systemctl restart "$SERVICE"
  sleep 3
  if systemctl is-active -q "$SERVICE"; then ok "service « $SERVICE » démarré (et relancé automatiquement au redémarrage)"; else
    echo "  Le service ne démarre pas : journalctl -u $SERVICE -n 50"; fi
fi

echo
if [ "$CHECK" -eq 0 ]; then
  printf '\033[1;32mTerminé.\033[0m Ouvrez votre application → Recherche IA → Centre d’investigation : « Navigateur autonome connecté ».\n'
else
  printf '\033[1;33mInstallation terminée, mais la vérification signale un point à corriger (voir ci-dessus).\033[0m\n'
fi
cat <<EOF

Commandes utiles :
  journalctl -u $SERVICE -f          suivre ce que fait le navigateur
  sudo systemctl restart $SERVICE    redémarrer
  sudo systemctl stop $SERVICE       arrêter
  relancer la commande d'installation  mettre à jour GENEALIS (réglages conservés)
  sudo nano $ENV_FILE                modifier l'adresse, le mot de passe ou la clé Gemini
EOF
