#!/bin/bash
# ============================================
# Hammer WorkSpace - Multi-Branch Update Script
# Erstellt vor dem Update automatisch ein Backup.
#
# Usage:
#   sudo bash update.sh [--branch main|experimental]
#
# Falls kein Branch angegeben: liest den konfigurierten Branch
# aus der Datenbank (settings-Tabelle).
# ============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

APP_DIR="/opt/mike-workspace"
APP_USER="mike"
SCAN_USER="workspace-scan"
SERVICE="mike-workspace"
BACKUP_BASE_DIR="$APP_DIR/backups/pre-update"
DEFAULT_GIT_REPO="https://github.com/marchmr/workspace.git"
EXPECTED_REPO_SLUG="marchmr/workspace"
UPLOADS_DATA_DIR="/srv/mike-workspace-uploads"
REQUIRED_APT_PACKAGES=(
  zip
  unzip
  curl
  git
  rsync
  ca-certificates
  ffmpeg
  acl
  build-essential
  python3
  pkg-config
  nginx
  certbot
  python3-certbot-nginx
  clamav
  clamav-daemon
)

upsert_env_file() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  if grep -q "^${key}=" "$env_file"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$env_file"
  else
    printf "\n%s=%s\n" "$key" "$value" >> "$env_file"
  fi
}

ensure_env_key_if_missing() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  if ! grep -q "^${key}=" "$env_file"; then
    printf "\n%s=%s\n" "$key" "$value" >> "$env_file"
  fi
}

resolve_nologin_shell() {
  if [ -x /usr/sbin/nologin ]; then
    echo "/usr/sbin/nologin"
  elif [ -x /sbin/nologin ]; then
    echo "/sbin/nologin"
  else
    echo "/bin/false"
  fi
}

configure_subdomain_provisioning_prereqs() {
  local dropin_dir="/etc/systemd/system/${SERVICE}.service.d"
  local dropin_file="${dropin_dir}/subdomain-provisioning.conf"
  mkdir -p "$dropin_dir"

  cat > "$dropin_file" <<EOF
[Service]
NoNewPrivileges=false
ReadWritePaths=$APP_DIR
ReadWritePaths=/etc/nginx
ReadWritePaths=/etc/nginx/sites-available
ReadWritePaths=/etc/nginx/sites-enabled
ReadWritePaths=/etc/letsencrypt
ReadWritePaths=/var/lib/letsencrypt
ReadWritePaths=/var/log/letsencrypt
ReadWritePaths=/var/log/nginx
ReadWritePaths=/run
ReadWritePaths=/run/sudo
ReadWritePaths=/run/sudo/ts
EOF

  local sudoers_file="/etc/sudoers.d/mike-subdomain-provisioning"
  cat > "$sudoers_file" <<EOF
$APP_USER ALL=(root) NOPASSWD: /usr/bin/install, /usr/bin/ln, /usr/sbin/nginx, /bin/systemctl, /usr/bin/certbot
EOF
  chmod 440 "$sudoers_file"
  if ! visudo -cf "$sudoers_file" >/dev/null 2>&1; then
    echo -e "  ${RED}[FAIL]${NC} Ungueltige sudoers-Datei: $sudoers_file"
    exit 1
  fi
}

ensure_subdomain_automation_defaults() {
  local env_file="$APP_DIR/backend/.env"
  if [ ! -f "$env_file" ]; then
    return 0
  fi

  local server_ip
  server_ip="$(hostname -I | awk '{print $1}')"
  local ssl_email=""
  ssl_email="$(grep '^SUBDOMAIN_SSL_EMAIL=' "$env_file" | tail -n1 | cut -d'=' -f2- || true)"
  if [ -z "$ssl_email" ]; then
    ssl_email="$(grep '^SSL_EMAIL=' "$env_file" | tail -n1 | cut -d'=' -f2- || true)"
  fi

  ensure_env_key_if_missing "$env_file" "SUBDOMAIN_PROVISIONING_ENABLED" "true"
  ensure_env_key_if_missing "$env_file" "SUBDOMAIN_PROVISIONING_USE_SUDO" "true"
  ensure_env_key_if_missing "$env_file" "SUBDOMAIN_FRONTEND_DIST_DIR" "$APP_DIR/frontend/dist"
  ensure_env_key_if_missing "$env_file" "SUBDOMAIN_BACKEND_PROXY_URL" "http://127.0.0.1:3000"
  ensure_env_key_if_missing "$env_file" "SUBDOMAIN_NGINX_SITES_AVAILABLE_DIR" "/etc/nginx/sites-available"
  ensure_env_key_if_missing "$env_file" "SUBDOMAIN_NGINX_SITES_ENABLED_DIR" "/etc/nginx/sites-enabled"
  ensure_env_key_if_missing "$env_file" "SUBDOMAIN_EXPECTED_SERVER_IPS" "$server_ip"

  if [ -n "$ssl_email" ]; then
    upsert_env_file "$env_file" "SUBDOMAIN_SSL_EMAIL" "$ssl_email"
  fi
}

ensure_file_security_defaults() {
  local env_file="$APP_DIR/backend/.env"
  if [ ! -f "$env_file" ]; then
    return 0
  fi

  ensure_env_key_if_missing "$env_file" "FILE_SECURITY_MAX_UPLOAD_MB" "500"
  ensure_env_key_if_missing "$env_file" "FILE_SECURITY_STRICT_SIGNATURE" "true"
  ensure_env_key_if_missing "$env_file" "FILE_SECURITY_ALLOW_ZIP_UPLOADS" "false"
  ensure_env_key_if_missing "$env_file" "FILE_SECURITY_ZIP_MAX_ENTRIES" "500"
  ensure_env_key_if_missing "$env_file" "FILE_SECURITY_ZIP_MAX_UNCOMPRESSED_MB" "1000"
  ensure_env_key_if_missing "$env_file" "FILE_SECURITY_ZIP_MAX_RATIO" "60"
  ensure_env_key_if_missing "$env_file" "FILE_SECURITY_CLAMAV_ENABLED" "true"
  ensure_env_key_if_missing "$env_file" "FILE_SECURITY_CLAMAV_BINARY" "clamscan"
  ensure_env_key_if_missing "$env_file" "FILE_SECURITY_CLAMAV_TIMEOUT_MS" "120000"
  ensure_env_key_if_missing "$env_file" "FILE_SECURITY_CLAMAV_FAIL_CLOSED" "true"
}

ensure_runtime_users_hardening() {
  local nologin_shell
  nologin_shell="$(resolve_nologin_shell)"

  if id "$APP_USER" >/dev/null 2>&1; then
    usermod -s "$nologin_shell" "$APP_USER" >/dev/null 2>&1 || true
  fi

  if ! id "$SCAN_USER" >/dev/null 2>&1; then
    useradd --system --home-dir /nonexistent --shell "$nologin_shell" "$SCAN_USER" >/dev/null 2>&1 || true
  else
    usermod -s "$nologin_shell" "$SCAN_USER" >/dev/null 2>&1 || true
  fi
}

ensure_upload_mount_hardening() {
  mkdir -p "$UPLOADS_DATA_DIR" "$APP_DIR/uploads"

  if [ -d "$APP_DIR/uploads" ] && [ "$(ls -A "$APP_DIR/uploads" 2>/dev/null | wc -l)" -gt 0 ]; then
    rsync -a "$APP_DIR/uploads/" "$UPLOADS_DATA_DIR/" 2>/dev/null || true
  fi

  if ! mountpoint -q "$APP_DIR/uploads"; then
    mount --bind "$UPLOADS_DATA_DIR" "$APP_DIR/uploads"
  fi

  if ! mountpoint -q "$APP_DIR/uploads"; then
    mount --bind "$UPLOADS_DATA_DIR" "$APP_DIR/uploads"
  fi
  mount -o remount,bind,noexec,nodev,nosuid "$APP_DIR/uploads" 2>/dev/null || true
}

configure_clamav_isolation() {
  local dropin_dir="/etc/systemd/system/clamav-daemon.service.d"
  local dropin_file="${dropin_dir}/workspace-isolation.conf"
  mkdir -p "$dropin_dir"

  cat > "$dropin_file" <<EOF
[Service]
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_UNIX
IPAddressDeny=any
ReadWritePaths=/var/lib/clamav
ReadWritePaths=/run/clamav
ReadWritePaths=/var/log/clamav
ReadOnlyPaths=$APP_DIR/uploads
EOF
}

configure_app_runtime_hardening() {
  local dropin_dir="/etc/systemd/system/${SERVICE}.service.d"
  local dropin_file="${dropin_dir}/security-hardening.conf"
  mkdir -p "$dropin_dir"

  cat > "$dropin_file" <<EOF
[Service]
MemoryDenyWriteExecute=false
PrivateTmp=true
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictSUIDSGID=true
RestrictRealtime=true
SystemCallArchitectures=native
ReadWritePaths=$APP_DIR/uploads
ReadWritePaths=$APP_DIR/backups
EOF
}

ensure_node_jit_compatibility() {
  local service_file="/etc/systemd/system/${SERVICE}.service"
  local dropin_dir="/etc/systemd/system/${SERVICE}.service.d"
  local jit_file="${dropin_dir}/zz-node-jit-compat.conf"

  if [ -f "$service_file" ]; then
    sed -i '/^[[:space:]]*MemoryDenyWriteExecute[[:space:]]*=.*/d' "$service_file" 2>/dev/null || true
  fi

  if [ -d "$dropin_dir" ]; then
    find "$dropin_dir" -maxdepth 1 -type f -name '*.conf' -print0 2>/dev/null | while IFS= read -r -d '' f; do
      sed -i '/^[[:space:]]*MemoryDenyWriteExecute[[:space:]]*=.*/d' "$f" 2>/dev/null || true
    done
  fi

  mkdir -p "$dropin_dir"
  cat > "$jit_file" <<EOF
[Service]
MemoryDenyWriteExecute=false
EOF
}

resolve_workspace_host_from_nginx() {
  local nginx_site="/etc/nginx/sites-available/mike-workspace"
  if [ ! -f "$nginx_site" ]; then
    echo ""
    return 0
  fi

  local server_name_line
  server_name_line="$(grep -E '^[[:space:]]*server_name[[:space:]]+' "$nginx_site" | head -n1 || true)"
  server_name_line="${server_name_line#*server_name }"
  server_name_line="${server_name_line%;*}"
  for host in $server_name_line; do
    if [ -n "$host" ] && [ "$host" != "_" ]; then
      echo "$host"
      return 0
    fi
  done
  echo ""
}

normalize_candidate_host() {
  local raw="$1"
  local host
  host="$(echo "${raw:-}" | tr '[:upper:]' '[:lower:]' | sed 's#^https\?://##; s#/.*$##; s/^[[:space:]]*//; s/[[:space:]]*$//')"
  if [ -z "$host" ]; then
    echo ""
    return 0
  fi
  # Nur echte Hostnamen erlauben (verschlüsselte/technische Strings verwerfen)
  if echo "$host" | grep -Eq '^[a-z0-9.-]+$' && echo "$host" | grep -q '\.'; then
    echo "$host"
    return 0
  fi
  echo ""
}

resolve_public_host_from_nginx() {
  local conf
  conf="$(ls -1 /etc/nginx/sites-available/mike-plugin-videoplattform-*.conf 2>/dev/null | head -n1 || true)"
  if [ -z "$conf" ] || [ ! -f "$conf" ]; then
    echo ""
    return 0
  fi

  local server_name_line
  server_name_line="$(grep -E '^[[:space:]]*server_name[[:space:]]+' "$conf" | head -n1 || true)"
  server_name_line="${server_name_line#*server_name }"
  server_name_line="${server_name_line%;*}"
  for host in $server_name_line; do
    local normalized
    normalized="$(normalize_candidate_host "$host")"
    if [ -n "$normalized" ]; then
      echo "$normalized"
      return 0
    fi
  done
  echo ""
}

resolve_public_host_from_settings() {
  local env_file="$APP_DIR/backend/.env"
  if [ ! -f "$env_file" ]; then
    echo ""
    return 0
  fi

  local db_name db_user db_pass db_host db_port
  db_name="$(grep '^DB_NAME=' "$env_file" | tail -n1 | cut -d'=' -f2- || true)"
  db_user="$(grep '^DB_USER=' "$env_file" | tail -n1 | cut -d'=' -f2- || true)"
  db_pass="$(grep '^DB_PASSWORD=' "$env_file" | tail -n1 | cut -d'=' -f2- || true)"
  db_host="$(grep '^DB_HOST=' "$env_file" | tail -n1 | cut -d'=' -f2- || true)"
  db_port="$(grep '^DB_PORT=' "$env_file" | tail -n1 | cut -d'=' -f2- || true)"

  if [ -z "$db_name" ] || [ -z "$db_user" ]; then
    echo ""
    return 0
  fi

  local mysql_host="${db_host:-localhost}"
  local mysql_port="${db_port:-3306}"

  local public_host normalized
  public_host="$(mysql -u "$db_user" -p"$db_pass" -h "$mysql_host" -P "$mysql_port" "$db_name" -N -e \
    "SELECT value_encrypted FROM settings WHERE tenant_id IS NULL AND \`key\` IN ('kundenportal.public_subdomain','videoplattform.public_subdomain') AND value_encrypted IS NOT NULL AND value_encrypted <> '' ORDER BY FIELD(\`key\`,'kundenportal.public_subdomain','videoplattform.public_subdomain') LIMIT 1;" 2>/dev/null || true)"
  normalized="$(normalize_candidate_host "$public_host")"
  echo "$normalized"
}

write_frontend_host_routing_env() {
  local workspace_host public_host
  workspace_host="$(resolve_workspace_host_from_nginx)"
  public_host="$(resolve_public_host_from_settings)"
  if [ -z "$public_host" ]; then
    public_host="$(resolve_public_host_from_nginx)"
  fi

  local env_prod="$APP_DIR/frontend/.env.production"
  local env_tmp="${env_prod}.tmp.$$"
  {
    echo "VITE_WORKSPACE_HOSTS=${workspace_host}"
    echo "VITE_PUBLIC_HOSTS=${public_host}"
  } > "$env_tmp"
  mv "$env_tmp" "$env_prod"
  chown "$APP_USER":"$APP_USER" "$env_prod" 2>/dev/null || true
  chmod 640 "$env_prod" 2>/dev/null || true

  echo -e "  ${GREEN}[OK]${NC} frontend/.env.production aktualisiert"
  echo -e "      VITE_WORKSPACE_HOSTS=${workspace_host:-<leer>}"
  echo -e "      VITE_PUBLIC_HOSTS=${public_host:-<leer>}"
}

echo ""
echo -e "${BOLD}Hammer WorkSpace - Update${NC}"
echo -e "================================================"

# Root-Check
if [ "$(id -u)" -ne 0 ]; then
  echo -e "${RED}[FAIL]${NC} Dieses Script muss als root ausgefuehrt werden."
  echo -e "  Verwende: ${CYAN}sudo bash update.sh --branch main${NC}"
  exit 1
fi

ensure_required_apt_packages() {
  local missing_packages=()

  for pkg in "${REQUIRED_APT_PACKAGES[@]}"; do
    if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q "install ok installed"; then
      missing_packages+=("$pkg")
    fi
  done

  if [ "${#missing_packages[@]}" -eq 0 ]; then
    echo -e "  ${GREEN}[OK]${NC} System-Abhaengigkeiten bereits vorhanden"
    return 0
  fi

  echo -e "  ${YELLOW}[!!]${NC} Fehlende Pakete erkannt: ${missing_packages[*]}"
  echo -e "  ${CYAN}> Installiere fehlende System-Abhaengigkeiten...${NC}"

  apt-get update -qq > /dev/null 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing_packages[@]}" > /dev/null 2>&1
  echo -e "  ${GREEN}[OK]${NC} System-Abhaengigkeiten installiert"

}

ensure_clamav_services() {
  if dpkg-query -W -f='${Status}' clamav-daemon 2>/dev/null | grep -q "install ok installed"; then
    systemctl enable clamav-freshclam clamav-daemon >/dev/null 2>&1 || true
    systemctl restart clamav-freshclam clamav-daemon >/dev/null 2>&1 || true
    echo -e "  ${GREEN}[OK]${NC} ClamAV-Dienste aktiv"
  fi
}

echo -e "\n${CYAN}> System-Abhaengigkeiten pruefen...${NC}"
ensure_required_apt_packages
ensure_clamav_services

# ============================================
# Branch bestimmen
# ============================================
BRANCH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    *)
      echo -e "${RED}[FAIL]${NC} Unbekannter Parameter: $1"
      echo -e "  Usage: ${CYAN}sudo bash update.sh --branch main|experimental${NC}"
      exit 1
      ;;
  esac
done

# Falls kein Branch angegeben: aus DB lesen
if [ -z "$BRANCH" ]; then
  echo -e "\n${CYAN}> Branch aus Konfiguration lesen...${NC}"
  
  # .env lesen fuer DB-Verbindung
  if [ -f "$APP_DIR/backend/.env" ]; then
    DB_NAME=$(grep '^DB_NAME=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_USER_ENV=$(grep '^DB_USER=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_PASS=$(grep '^DB_PASSWORD=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
    
    if [ -n "$DB_NAME" ] && [ -n "$DB_USER_ENV" ]; then
      # Versuche Branch aus settings-Tabelle zu lesen
      DB_BRANCH=$(mysql -u "$DB_USER_ENV" -p"$DB_PASS" "$DB_NAME" -N -e \
        "SELECT value_encrypted FROM settings WHERE \`key\` = 'update.branch' AND tenant_id IS NULL LIMIT 1;" 2>/dev/null || echo "")
      
      # Der Wert ist verschluesselt, aber wir koennen den Branch auch aus dem Git-Zustand lesen
      if [ -z "$DB_BRANCH" ] || [ "$DB_BRANCH" = "NULL" ]; then
        # Fallback: Aktuellen Git-Branch verwenden
        cd "$APP_DIR"
        BRANCH=$(sudo -u "$APP_USER" git branch --show-current 2>/dev/null || echo "main")
      else
        # Verschluesselter Wert - Fallback auf Git-Branch
        cd "$APP_DIR"
        BRANCH=$(sudo -u "$APP_USER" git branch --show-current 2>/dev/null || echo "main")
      fi
    fi
  fi
  
  # Ultimativer Fallback
  if [ -z "$BRANCH" ]; then
    BRANCH="main"
  fi
fi

# Branch validieren
case "$BRANCH" in
  main|experimental) ;;
  *)
    echo -e "${RED}[FAIL]${NC} Ungueltiger Branch: '$BRANCH'"
    echo -e "  Erlaubt: ${CYAN}main${NC}, ${CYAN}experimental${NC}"
    exit 1
    ;;
esac

echo -e "  ${GREEN}[OK]${NC} Branch: ${BOLD}$BRANCH${NC}"

# ============================================
# Aktuellen Stand anzeigen
# ============================================
echo -e "\n${CYAN}> Aktueller Stand...${NC}"
cd "$APP_DIR"

CURRENT_BRANCH=$(sudo -u "$APP_USER" git branch --show-current 2>/dev/null || echo "unbekannt")
CURRENT_COMMIT=$(sudo -u "$APP_USER" git rev-parse --short HEAD 2>/dev/null || echo "unbekannt")
CURRENT_VERSION="unbekannt"
if [ -f "$APP_DIR/backend/package.json" ]; then
  CURRENT_VERSION=$(node -e "try{console.log(require('$APP_DIR/backend/package.json').version)}catch{console.log('unbekannt')}" 2>/dev/null || echo "unbekannt")
fi

echo -e "  Version:  ${BOLD}v$CURRENT_VERSION${NC}"
echo -e "  Branch:   ${BOLD}$CURRENT_BRANCH${NC}"
echo -e "  Commit:   ${BOLD}$CURRENT_COMMIT${NC}"

# Alte UPDATE_URL-Migration (Legacy Mike-Quelle -> neues GitHub-Repo)
if [ -f "$APP_DIR/backend/.env" ]; then
  CURRENT_UPDATE_URL=$(grep '^UPDATE_URL=' "$APP_DIR/backend/.env" | tail -n1 | cut -d'=' -f2- || true)
  if [ -z "$CURRENT_UPDATE_URL" ]; then
    echo "UPDATE_URL=https://api.github.com/repos/marchmr/workspace" >> "$APP_DIR/backend/.env"
    echo -e "  ${YELLOW}[!!]${NC} UPDATE_URL fehlte in .env und wurde auf marchmr/workspace gesetzt"
  elif [[ "$CURRENT_UPDATE_URL" == *"download.mike-server.eu"* ]] || { [[ "$CURRENT_UPDATE_URL" == *"/repos/mike"* ]] && [[ "$CURRENT_UPDATE_URL" != *"/repos/marchmr/workspace"* ]]; }; then
    sed -i.bak '/^UPDATE_URL=/d' "$APP_DIR/backend/.env"
    echo "UPDATE_URL=https://api.github.com/repos/marchmr/workspace" >> "$APP_DIR/backend/.env"
    rm -f "$APP_DIR/backend/.env.bak"
    echo -e "  ${YELLOW}[!!]${NC} Legacy UPDATE_URL erkannt und auf marchmr/workspace migriert"
  fi
fi

# ============================================
# Pre-Update Backup erstellen
# ============================================
echo -e "\n${CYAN}> Pre-Update Backup erstellen...${NC}"

BACKUP_DIR="$BACKUP_BASE_DIR/$BRANCH"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="$BACKUP_DIR/pre-update_${TIMESTAMP}.zip"

# Datenbank-Dump erstellen
echo -e "  Erstelle Datenbank-Dump..."
DB_DUMP_FILE="/tmp/mike-workspace-db-dump-${TIMESTAMP}.sql"

if [ -f "$APP_DIR/backend/.env" ]; then
  DB_NAME=$(grep '^DB_NAME=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
  DB_USER_ENV=$(grep '^DB_USER=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
  DB_PASS=$(grep '^DB_PASSWORD=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
  DB_HOST=$(grep '^DB_HOST=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
  DB_PORT=$(grep '^DB_PORT=' "$APP_DIR/backend/.env" | cut -d'=' -f2)

  if [ -n "$DB_NAME" ] && [ -n "$DB_USER_ENV" ]; then
    mysqldump -u "$DB_USER_ENV" -p"$DB_PASS" \
      -h "${DB_HOST:-localhost}" -P "${DB_PORT:-3306}" \
      --single-transaction --routines --triggers \
      "$DB_NAME" > "$DB_DUMP_FILE" 2>/dev/null
    echo -e "  ${GREEN}[OK]${NC} Datenbank-Dump erstellt"
  else
    echo -e "  ${YELLOW}[!!]${NC} DB-Verbindungsdaten nicht vollstaendig, Dump uebersprungen"
    DB_DUMP_FILE=""
  fi
else
  echo -e "  ${YELLOW}[!!]${NC} Keine .env-Datei gefunden, Dump uebersprungen"
  DB_DUMP_FILE=""
fi

# Backup-Metadaten erstellen
META_FILE="/tmp/mike-workspace-backup-meta-${TIMESTAMP}.json"
cat > "$META_FILE" <<METAEOF
{
  "version": "$CURRENT_VERSION",
  "branch": "$CURRENT_BRANCH",
  "commit": "$CURRENT_COMMIT",
  "timestamp": "$(date -Iseconds)",
  "type": "pre-update"
}
METAEOF

# ZIP erstellen (ohne node_modules, .git, tmp)
echo -e "  Erstelle ZIP-Archiv..."

cd "$APP_DIR"

# Dateien fuer ZIP sammeln (relativ zum APP_DIR)
ZIP_ARGS=()
ZIP_ARGS+=("-x" "*/node_modules/*" "*/.git/*" "*/tmp/*" "*/backups/*")

zip -r -q "$BACKUP_FILE" \
  backend/ \
  frontend/ \
  plugins/ \
  uploads/ \
  install.sh \
  update.sh \
  restore.sh \
  CHANGELOG.md \
  README.md \
  -x "*/node_modules/*" "*/.git/*" "*/tmp/*" "*/backups/*" 2>/dev/null || true

# DB-Dump und Meta zum ZIP hinzufuegen
if [ -n "$DB_DUMP_FILE" ] && [ -f "$DB_DUMP_FILE" ]; then
  zip -j -q "$BACKUP_FILE" "$DB_DUMP_FILE" 2>/dev/null || true
  rm -f "$DB_DUMP_FILE"
fi

if [ -f "$META_FILE" ]; then
  zip -j -q "$BACKUP_FILE" "$META_FILE" 2>/dev/null || true
  rm -f "$META_FILE"
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" 2>/dev/null | cut -f1)
echo -e "  ${GREEN}[OK]${NC} Backup erstellt: ${BOLD}$BACKUP_FILE${NC} ($BACKUP_SIZE)"

# Berechtigungen fuer Backend-Prozess (mike) setzen
chown -R mike:mike "$APP_DIR/backups" 2>/dev/null || true

# Alte Backups aufraeumen
case "$BRANCH" in
  main) MAX_BACKUPS=5 ;;
  experimental) MAX_BACKUPS=10 ;;
  *) MAX_BACKUPS=5 ;;
esac

BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/pre-update_*.zip 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
  DELETE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
  ls -1t "$BACKUP_DIR"/pre-update_*.zip 2>/dev/null | tail -n "$DELETE_COUNT" | while read -r OLD_BACKUP; do
    rm -f "$OLD_BACKUP"
    echo -e "  ${YELLOW}[!!]${NC} Altes Backup entfernt: $(basename "$OLD_BACKUP")"
  done
fi

# ============================================
# Git Pull (Branch-spezifisch)
# ============================================
echo -e "\n${CYAN}> Git Update (Branch: $BRANCH)...${NC}"
cd "$APP_DIR"

# Sicherstellen dass origin korrekt konfiguriert ist
REMOTE_URL=$(sudo -u "$APP_USER" git remote get-url origin 2>/dev/null || echo "")
if [ -z "$REMOTE_URL" ]; then
  echo -e "  ${RED}[FAIL]${NC} Kein Git-Remote 'origin' konfiguriert."
  exit 1
fi

# Alte/abweichende Remote-URL automatisch auf das aktuelle Repo korrigieren
TARGET_GIT_REPO="${GIT_REPO:-$DEFAULT_GIT_REPO}"
if [[ "$REMOTE_URL" != *"$EXPECTED_REPO_SLUG"* ]]; then
  echo -e "  ${YELLOW}[!!]${NC} Origin zeigt auf ein anderes Repository:"
  echo -e "      ${BOLD}$REMOTE_URL${NC}"
  echo -e "  Stelle auf aktuelles Repo um:"
  echo -e "      ${BOLD}$TARGET_GIT_REPO${NC}"
  sudo -u "$APP_USER" git remote set-url origin "$TARGET_GIT_REPO" 2>&1
  REMOTE_URL=$(sudo -u "$APP_USER" git remote get-url origin 2>/dev/null || echo "")
fi

echo -e "  Origin:   ${BOLD}$REMOTE_URL${NC}"

sudo -u "$APP_USER" git fetch origin 2>&1

# Lokale Aenderungen immer verwerfen, damit Branch-Wechsel nicht blockiert
sudo -u "$APP_USER" git reset --hard HEAD 2>&1
sudo -u "$APP_USER" git clean -fd 2>&1

# Branch robust auschecken:
# - existiert lokal: wechseln
# - sonst: lokal anlegen und auf origin/<branch> setzen
if sudo -u "$APP_USER" git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  sudo -u "$APP_USER" git checkout "$BRANCH" 2>&1
else
  sudo -u "$APP_USER" git checkout -B "$BRANCH" "origin/$BRANCH" 2>&1
fi

# Sicherheitsnetz: Branch immer exakt auf Remote-Stand setzen
sudo -u "$APP_USER" git reset --hard "origin/$BRANCH" 2>&1
echo -e "  ${GREEN}[OK]${NC} Quellcode aktualisiert (Branch: $BRANCH)"

NEW_COMMIT=$(sudo -u "$APP_USER" git rev-parse --short HEAD 2>/dev/null || echo "unbekannt")
echo -e "  Neuer Commit: ${BOLD}$NEW_COMMIT${NC}"

# Branch-Einstellung in der DB mitziehen, damit Admin-Update-Check
# denselben Branch verwendet wie das letzte CLI-Update.
if [ -f "$APP_DIR/backend/.env" ]; then
  DB_NAME=$(grep '^DB_NAME=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
  DB_USER_ENV=$(grep '^DB_USER=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
  DB_PASS=$(grep '^DB_PASSWORD=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
  if [ -n "$DB_NAME" ] && [ -n "$DB_USER_ENV" ]; then
    mysql -u "$DB_USER_ENV" -p"$DB_PASS" "$DB_NAME" -e \
      "UPDATE settings SET value_encrypted='${BRANCH}', category='system' WHERE \`key\`='update.branch' AND tenant_id IS NULL;" 2>/dev/null || true
    mysql -u "$DB_USER_ENV" -p"$DB_PASS" "$DB_NAME" -e \
      "INSERT INTO settings (\`key\`, value_encrypted, category, tenant_id) SELECT 'update.branch','${BRANCH}','system',NULL WHERE NOT EXISTS (SELECT 1 FROM settings WHERE \`key\`='update.branch' AND tenant_id IS NULL);" 2>/dev/null || true
  fi
fi

# ============================================
# Backend Dependencies
# ============================================
echo -e "\n${CYAN}> Backend Dependencies...${NC}"
cd "$APP_DIR/backend"
sudo -u "$APP_USER" npm ci --include=dev --silent --no-audit 2>/dev/null || sudo -u "$APP_USER" npm install --include=dev --silent --no-audit 2>/dev/null
if [ -d "$APP_DIR/backend/node_modules/.bin" ]; then
  find "$APP_DIR/backend/node_modules/.bin" -type f -exec chmod u+x {} \; 2>/dev/null || true
fi
echo -e "  ${GREEN}[OK]${NC} Dependencies installiert"

# ============================================
# Frontend Build (falls Vite vorhanden)
# ============================================
if [ -f "$APP_DIR/frontend/package.json" ] && grep -q '"build"' "$APP_DIR/frontend/package.json" 2>/dev/null; then
  if [ -d "$APP_DIR/frontend/node_modules" ] || [ -f "$APP_DIR/frontend/package-lock.json" ]; then
    echo -e "\n${CYAN}> Frontend Build...${NC}"
    write_frontend_host_routing_env
    mkdir -p "$APP_DIR/frontend/dist"
    chown -R "$APP_USER":"$APP_USER" "$APP_DIR/frontend/dist" "$APP_DIR/frontend/src" 2>/dev/null || true
    find "$APP_DIR/frontend/dist" -type f -exec chmod u+rw {} \; 2>/dev/null || true
    find "$APP_DIR/frontend/dist" -type d -exec chmod u+rwx {} \; 2>/dev/null || true
    cd "$APP_DIR/frontend"
    sudo -u "$APP_USER" npm ci --silent 2>/dev/null || sudo -u "$APP_USER" npm install --silent 2>/dev/null
    if [ -d "$APP_DIR/frontend/node_modules/.bin" ]; then
      find "$APP_DIR/frontend/node_modules/.bin" -type f -exec chmod u+x {} \; 2>/dev/null || true
    fi
    if ! sudo -u "$APP_USER" npm run build --silent; then
      echo -e "  ${RED}[FAIL]${NC} Frontend-Build fehlgeschlagen"
      echo -e "  ${YELLOW}Restore-Befehl:${NC}"
      echo -e "  ${CYAN}sudo bash $APP_DIR/restore.sh $BACKUP_FILE${NC}"
      exit 1
    fi
    echo -e "  ${GREEN}[OK]${NC} Frontend gebaut"
  fi
fi

# ============================================
# Datenbank-Migrationen
# ============================================
echo -e "\n${CYAN}> Datenbank-Migrationen...${NC}"
cd "$APP_DIR/backend"
sudo -u "$APP_USER" npx tsx node_modules/.bin/knex migrate:latest --knexfile knexfile.ts 2>/dev/null
echo -e "  ${GREEN}[OK]${NC} Migrationen ausgefuehrt"

# ============================================
# Systemd-Service aktualisieren
# ============================================
echo -e "\n${CYAN}> Service-Konfiguration pruefen...${NC}"
SERVICE_FILE="/etc/systemd/system/${SERVICE}.service"
if [ -f "$SERVICE_FILE" ]; then
  if ! grep -q "TimeoutStopSec" "$SERVICE_FILE"; then
    sed -i '/^Environment=NODE_ENV=production$/a\\n# Stop-Verhalten: max 10s warten, dann SIGKILL\nTimeoutStopSec=10\nKillMode=mixed\nKillSignal=SIGTERM' "$SERVICE_FILE"
    systemctl daemon-reload
    echo -e "  ${GREEN}[OK]${NC} Service-Timeouts aktualisiert"
  else
    echo -e "  ${GREEN}[OK]${NC} Service-Konfiguration bereits aktuell"
  fi
fi

echo -e "\n${CYAN}> Subdomain-Automation absichern...${NC}"
ensure_subdomain_automation_defaults
ensure_file_security_defaults
ensure_runtime_users_hardening
ensure_upload_mount_hardening
configure_subdomain_provisioning_prereqs
configure_app_runtime_hardening
configure_clamav_isolation
ensure_node_jit_compatibility
echo -e "  ${GREEN}[OK]${NC} Systemvoraussetzungen fuer automatische Subdomain-Einrichtung aktualisiert"
systemctl daemon-reload
ensure_clamav_services

# ============================================
# Service neu starten
# ============================================
echo -e "\n${CYAN}> Service neu starten...${NC}"
systemctl restart "$SERVICE"
sleep 2

if systemctl is-active --quiet "$SERVICE"; then
  echo -e "  ${GREEN}[OK]${NC} Service laeuft"
else
  echo -e "  ${RED}[FAIL]${NC} Service konnte nicht gestartet werden"
  echo -e "  Logs: ${CYAN}sudo journalctl -u $SERVICE -f${NC}"
  echo ""
  echo -e "  ${YELLOW}Restore-Befehl:${NC}"
  echo -e "  ${CYAN}sudo bash $APP_DIR/restore.sh $BACKUP_FILE${NC}"
  exit 1
fi

# ============================================
# Neue Version ermitteln
# ============================================
NEW_VERSION="unbekannt"
if [ -f "$APP_DIR/backend/package.json" ]; then
  NEW_VERSION=$(node -e "try{console.log(require('$APP_DIR/backend/package.json').version)}catch{console.log('unbekannt')}" 2>/dev/null || echo "unbekannt")
fi

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  Update erfolgreich!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "  ${BOLD}Branch:${NC}    $BRANCH"
echo -e "  ${BOLD}Version:${NC}   v$NEW_VERSION"
echo -e "  ${BOLD}Commit:${NC}    $NEW_COMMIT"
echo ""
echo -e "  ${BOLD}Backup:${NC}    $BACKUP_FILE"
echo -e "  ${BOLD}Restore:${NC}   ${CYAN}sudo bash $APP_DIR/restore.sh $BACKUP_FILE${NC}"
echo ""
