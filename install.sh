#!/bin/bash
# ============================================
# Hammer WorkSpace - Interaktiver Installer
# Fuer Debian 12
#
# Usage:
#   curl -fSLo install.sh https://raw.githubusercontent.com/marchmr/workspace/04ac4cc6f06808a6d496d9198f4dc2700bde4847/install.sh && echo "153ace65d13da3c3ad046d712b4159ac35d6da08639f5a87fdc6555616280938  install.sh" | sha256sum -c - && sudo bash install.sh
#   oder lokal: sudo bash install.sh
# ============================================

set -e

# ============================================
# Farben und Hilfsfunktionen
# ============================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

print_header() {
  echo ""
  echo -e "${BLUE}------------------------------------------------${NC}"
  echo -e "${BOLD}  $1${NC}"
  echo -e "${BLUE}------------------------------------------------${NC}"
}

print_step() {
  echo -e "\n${CYAN}> $1${NC}"
}

print_ok() {
  echo -e "  ${GREEN}[OK]${NC} $1"
}

print_warn() {
  echo -e "  ${YELLOW}[!!]${NC} $1"
}

print_error() {
  echo -e "  ${RED}[FAIL]${NC} $1"
}

ask_input() {
  local prompt="$1"
  local default="$2"
  local result

  if [ -n "$default" ]; then
    echo -en "  ${BOLD}$prompt${NC} [${default}]: " > /dev/tty
  else
    echo -en "  ${BOLD}$prompt${NC}: " > /dev/tty
  fi

  read -r result < /dev/tty
  echo "${result:-$default}"
}

ask_yes_no() {
  local prompt="$1"
  local default="${2:-j}"
  local result

  if [ "$default" = "j" ]; then
    echo -en "  ${BOLD}$prompt${NC} [J/n]: " > /dev/tty
  else
    echo -en "  ${BOLD}$prompt${NC} [j/N]: " > /dev/tty
  fi

  read -r result < /dev/tty
  result="${result:-$default}"
  [[ "$result" =~ ^[jJyY]$ ]]
}

ask_password() {
  local prompt="$1"
  local pass1 pass2

  while true; do
    echo -en "  ${BOLD}$prompt${NC}: " > /dev/tty
    read -rs pass1 < /dev/tty
    echo "" > /dev/tty
    echo -en "  ${BOLD}Passwort bestaetigen${NC}: " > /dev/tty
    read -rs pass2 < /dev/tty
    echo "" > /dev/tty

    if [ "$pass1" = "$pass2" ]; then
      if [ ${#pass1} -lt 8 ]; then
        print_warn "Passwort muss mindestens 8 Zeichen haben." > /dev/tty
      else
        echo "$pass1"
        return
      fi
    else
      print_warn "Passwoerter stimmen nicht ueberein. Nochmal." > /dev/tty
    fi
  done
}

# ============================================
# Konfigurationsvariablen
# ============================================
APP_DIR="/opt/mike-workspace"
APP_USER="mike"
SCAN_USER="workspace-scan"
GIT_REPO="https://github.com/marchmr/workspace.git"
NODE_VERSION="20"
SERVICE_NAME="mike-workspace"
UPLOADS_DATA_DIR="/srv/mike-workspace-uploads"

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

resolve_nologin_shell() {
  if [ -x /usr/sbin/nologin ]; then
    echo "/usr/sbin/nologin"
  elif [ -x /sbin/nologin ]; then
    echo "/sbin/nologin"
  else
    echo "/bin/false"
  fi
}

resolve_clamav_binary() {
  if command -v clamdscan >/dev/null 2>&1; then
    echo "clamdscan"
  elif command -v clamscan >/dev/null 2>&1; then
    echo "clamscan"
  else
    echo "clamdscan"
  fi
}

ensure_upload_mount_hardening() {
  print_step "Upload-Mount hardening (noexec,nodev,nosuid)..."
  mkdir -p "$UPLOADS_DATA_DIR" "$APP_DIR/uploads"

  if [ -d "$APP_DIR/uploads" ] && [ "$(ls -A "$APP_DIR/uploads" 2>/dev/null | wc -l)" -gt 0 ]; then
    rsync -a "$APP_DIR/uploads/" "$UPLOADS_DATA_DIR/" 2>/dev/null || true
  fi

  # WICHTIG: /etc/fstab wird bewusst NICHT angefasst.
  # Der Mount gilt nur fuer die laufende Session (Runtime-Hardening).

  if ! mountpoint -q "$APP_DIR/uploads"; then
    mount "$APP_DIR/uploads" >/dev/null 2>&1 || mount --bind "$UPLOADS_DATA_DIR" "$APP_DIR/uploads"
  fi

  mount -o remount,bind,noexec,nodev,nosuid "$APP_DIR/uploads" >/dev/null 2>&1 || true

  print_ok "Upload-Pfad isoliert: $APP_DIR/uploads"
}

configure_clamav_isolation() {
  print_step "ClamAV-Service isolieren..."
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

  systemctl daemon-reload
  systemctl enable clamav-freshclam clamav-daemon >/dev/null 2>&1 || true
  systemctl restart clamav-freshclam clamav-daemon >/dev/null 2>&1 || true
  print_ok "ClamAV Isolation aktiv"
}

configure_app_runtime_hardening() {
  print_step "App-Service hardening anwenden..."
  local dropin_dir="/etc/systemd/system/${SERVICE_NAME}.service.d"
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

  print_ok "App-Hardening Drop-In gesetzt: $dropin_file"
}

ensure_node_jit_compatibility() {
  local service_file="/etc/systemd/system/${SERVICE_NAME}.service"
  local dropin_dir="/etc/systemd/system/${SERVICE_NAME}.service.d"
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

configure_subdomain_provisioning_prereqs() {
  print_step "Subdomain-Automation (Nginx/SSL) vorkonfigurieren..."

  local dropin_dir="/etc/systemd/system/${SERVICE_NAME}.service.d"
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
  print_ok "Systemd Drop-In gesetzt: $dropin_file"

  local sudoers_file="/etc/sudoers.d/mike-subdomain-provisioning"
  cat > "$sudoers_file" <<EOF
$APP_USER ALL=(root) NOPASSWD: /usr/bin/install, /usr/bin/ln, /usr/sbin/nginx, /bin/systemctl, /usr/bin/certbot
EOF
  chmod 440 "$sudoers_file"
  if visudo -cf "$sudoers_file" >/dev/null 2>&1; then
    print_ok "sudoers-Regel aktiv: $sudoers_file"
  else
    print_error "sudoers-Datei ungültig: $sudoers_file"
    exit 1
  fi
}

# ============================================
# START
# ============================================
clear
echo ""
echo -e "${BLUE}"
echo "  __  __ ___ _  __ _____"
echo " |  \/  |_ _| |/ /| ____|" 
echo " | |\/| || || ' / |  _|  "
echo " | |  | || || . \ | |___ "
echo " |_|  |_|___|_|\_\|_____|"
echo -e "${NC}"
echo -e "${BOLD}  WorkSpace - Installer${NC}"
echo ""

# Root-Check
if [ "$(id -u)" -ne 0 ]; then
  print_error "Dieses Script muss als root ausgefuehrt werden."
  echo ""
  echo -e "  Verwende: ${CYAN}curl -fSLo install.sh https://raw.githubusercontent.com/marchmr/workspace/04ac4cc6f06808a6d496d9198f4dc2700bde4847/install.sh && echo \"153ace65d13da3c3ad046d712b4159ac35d6da08639f5a87fdc6555616280938  install.sh\" | sha256sum -c - && sudo bash install.sh${NC}"
  echo -e "  oder:     ${CYAN}sudo bash install.sh${NC}"
  echo ""
  exit 1
fi

# OS-Check
if [ ! -f /etc/debian_version ]; then
  print_warn "Dieses Script ist fuer Debian/Ubuntu optimiert."
  if ! ask_yes_no "Trotzdem fortfahren?"; then
    exit 1
  fi
fi

# ============================================
# Schritt 1: Konfiguration abfragen
# ============================================
print_header "Schritt 1/8: Konfiguration"

echo ""
echo -e "  Bitte geben Sie die Daten fuer Ihre Installation ein."
echo ""

# Domain
DOMAIN=$(ask_input "Domain (z.B. app.firma.de)" "")
PUBLIC_HOSTS_CSV=""
PUBLIC_HOSTS=()
if [ -z "$DOMAIN" ]; then
  SERVER_IP=$(hostname -I | awk '{print $1}')
  print_warn "Keine Domain angegeben. Die App ist ueber die IP erreichbar: $SERVER_IP"
  USE_DOMAIN=false
else
  USE_DOMAIN=true
  DOMAIN=$(echo "$DOMAIN" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')
  if [[ "$DOMAIN" == *","* ]]; then
    print_warn "Es wurde nur die erste Domain ohne Komma uebernommen."
    DOMAIN="${DOMAIN%%,*}"
  fi
  print_ok "Domain: $DOMAIN"

  PUBLIC_HOSTS_INPUT=$(ask_input "Optionale Public-Subdomains fuer Kundenportal (kommagetrennt, z.B. kundenportal.$DOMAIN)" "")
  if [ -n "$PUBLIC_HOSTS_INPUT" ]; then
    IFS=',' read -r -a _raw_public_hosts <<< "$PUBLIC_HOSTS_INPUT"
    for _host in "${_raw_public_hosts[@]}"; do
      host=$(echo "$_host" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')
      if [ -z "$host" ] || [ "$host" = "$DOMAIN" ]; then
        continue
      fi
      duplicate=false
      for existing in "${PUBLIC_HOSTS[@]}"; do
        if [ "$existing" = "$host" ]; then
          duplicate=true
          break
        fi
      done
      if [ "$duplicate" = false ]; then
        PUBLIC_HOSTS+=("$host")
      fi
    done
    if [ ${#PUBLIC_HOSTS[@]} -gt 0 ]; then
      PUBLIC_HOSTS_CSV=$(IFS=,; echo "${PUBLIC_HOSTS[*]}")
      print_ok "Public-Subdomains: $PUBLIC_HOSTS_CSV"
    fi
  fi
fi

# SSL
SETUP_SSL=false
if [ "$USE_DOMAIN" = true ]; then
  echo ""
  if ask_yes_no "SSL-Zertifikat mit Let's Encrypt einrichten?"; then
    SETUP_SSL=true
    SSL_EMAIL=$(ask_input "E-Mail fuer Let's Encrypt Benachrichtigungen" "")
    if [ -z "$SSL_EMAIL" ]; then
      print_warn "E-Mail ist fuer Let's Encrypt erforderlich."
      SSL_EMAIL=$(ask_input "E-Mail" "")
    fi
    print_ok "SSL wird mit Certbot eingerichtet"
  fi
fi

# Admin-Passwort
echo ""
ADMIN_PASS=$(ask_password "Admin-Passwort fuer die Weboberflaeche")
print_ok "Admin-Passwort gesetzt"

# DB-Passwort
echo ""
if ask_yes_no "MariaDB-Passwort automatisch generieren?" "j"; then
  DB_PASS=$(openssl rand -hex 16)
  print_ok "DB-Passwort: automatisch generiert"
else
  DB_PASS=$(ask_password "MariaDB-Passwort")
  print_ok "DB-Passwort gesetzt"
fi

# PHPMyAdmin wird immer mitinstalliert
INSTALL_PMA=true

# Zusammenfassung
print_header "Zusammenfassung"
echo ""
echo -e "  ${BOLD}Installations-Verzeichnis:${NC} $APP_DIR"
if [ "$USE_DOMAIN" = true ]; then
  echo -e "  ${BOLD}Domain:${NC}                   $DOMAIN"
  if [ -n "$PUBLIC_HOSTS_CSV" ]; then
    echo -e "  ${BOLD}Public-Subdomains:${NC}        $PUBLIC_HOSTS_CSV"
  fi
fi
if [ "$SETUP_SSL" = true ]; then
  echo -e "  ${BOLD}SSL:${NC}                      Let's Encrypt ($SSL_EMAIL)"
fi
echo -e "  ${BOLD}Admin-User:${NC}               admin"
echo -e "  ${BOLD}PHPMyAdmin:${NC}               Ja (automatisch)"
echo -e "  ${BOLD}Node.js:${NC}                  v$NODE_VERSION LTS"
echo ""

if ! ask_yes_no "Installation starten?"; then
  echo ""
  echo "  Abgebrochen."
  exit 0
fi

# ============================================
# Schritt 2: System-Pakete
# ============================================
print_header "Schritt 2/8: System-Pakete"

print_step "Paketquellen aktualisieren..."
apt-get update -qq > /dev/null 2>&1
print_ok "Paketquellen aktuell"

print_step "Basis-Pakete installieren..."
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  nginx mariadb-server curl zip unzip ufw gnupg2 git rsync \
  ca-certificates lsb-release software-properties-common ffmpeg acl \
  build-essential python3 pkg-config clamav clamav-daemon clamav-freshclam > /dev/null 2>&1
print_ok "Basis-Pakete inkl. Build-Toolchain und ClamAV installiert"

print_step "ClamAV-Dienste initialisieren..."
systemctl enable clamav-freshclam clamav-daemon >/dev/null 2>&1 || true
systemctl restart clamav-freshclam clamav-daemon >/dev/null 2>&1 || true
print_ok "ClamAV bereit (soweit auf dem System verfuegbar)"

# Certbot fuer SSL
if [ "$SETUP_SSL" = true ]; then
  print_step "Certbot installieren..."
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx > /dev/null 2>&1
  print_ok "Certbot installiert"
fi

# PHPMyAdmin
if [ "$INSTALL_PMA" = true ]; then
  print_step "PHPMyAdmin installieren..."
  echo "phpmyadmin phpmyadmin/dbconfig-install boolean true" | debconf-set-selections
  echo "phpmyadmin phpmyadmin/reconfigure-webserver multiselect none" | debconf-set-selections
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq phpmyadmin php-fpm php-mysql php-mbstring php-zip php-gd php-curl > /dev/null 2>&1
  # PHP-FPM starten
  PHP_FPM_SERVICE=$(systemctl list-units --type=service --all 2>/dev/null | grep php.*fpm | awk '{print $1}' | head -1)
  if [ -n "$PHP_FPM_SERVICE" ]; then
    systemctl enable "$PHP_FPM_SERVICE" > /dev/null 2>&1 || true
    systemctl start "$PHP_FPM_SERVICE" > /dev/null 2>&1 || true
  fi
  print_ok "PHPMyAdmin + PHP-FPM installiert"
fi

# ============================================
# Schritt 3: Node.js
# ============================================
print_header "Schritt 3/8: Node.js $NODE_VERSION"

if command -v node &> /dev/null && [[ "$(node -v)" == *"v${NODE_VERSION}"* ]]; then
  print_ok "Node.js $(node -v) bereits installiert"
else
  print_step "NodeSource Repository hinzufuegen..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
  print_ok "Node.js $(node -v) installiert"
fi

print_ok "npm $(npm -v)"

# ============================================
# Schritt 4: MariaDB einrichten
# ============================================
print_header "Schritt 4/8: MariaDB"

DB_NAME="mike_workspace"
DB_USER="mike_app"

print_step "Datenbank und Benutzer anlegen..."
mysql -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null
mysql -e "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';" 2>/dev/null
mysql -e "ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';" 2>/dev/null
mysql -e "GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';" 2>/dev/null
mysql -e "FLUSH PRIVILEGES;" 2>/dev/null
print_ok "Datenbank '$DB_NAME' erstellt"
print_ok "DB-User '$DB_USER' eingerichtet"

# ============================================
# Schritt 5: Applikation installieren
# ============================================
print_header "Schritt 5/8: Hammer WorkSpace"

# App-User
print_step "System-User erstellen..."
NOLOGIN_SHELL="$(resolve_nologin_shell)"
if ! id "$APP_USER" &>/dev/null; then
  useradd --system --home-dir "$APP_DIR" --shell "$NOLOGIN_SHELL" "$APP_USER"
  print_ok "User '$APP_USER' erstellt"
else
  usermod -s "$NOLOGIN_SHELL" "$APP_USER" >/dev/null 2>&1 || true
  print_ok "User '$APP_USER' existiert bereits"
fi

if ! id "$SCAN_USER" &>/dev/null; then
  useradd --system --home-dir /nonexistent --shell "$NOLOGIN_SHELL" "$SCAN_USER"
  print_ok "Scan-User '$SCAN_USER' erstellt"
else
  usermod -s "$NOLOGIN_SHELL" "$SCAN_USER" >/dev/null 2>&1 || true
  print_ok "Scan-User '$SCAN_USER' existiert bereits"
fi

# Repository klonen
print_step "Repository von GitHub klonen..."
mkdir -p "$APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
  print_warn "Vorhandenes Repository gefunden, verwerfe lokalen Stand fuer saubere Installation..."
  rm -rf "$APP_DIR"
fi
git clone "$GIT_REPO" "$APP_DIR" 2>/dev/null
print_ok "Repository geklont nach $APP_DIR"

# Plugins-Ordner (Plugins werden mit dem Core-Repo ausgeliefert)
mkdir -p "$APP_DIR/plugins"
mkdir -p "$APP_DIR/uploads"
mkdir -p "$APP_DIR/uploads/documents"
mkdir -p "$APP_DIR/uploads/avatars"
mkdir -p "$APP_DIR/uploads/tenant-logos"
print_ok "Upload-Verzeichnisse vorbereitet"

# Backup-Verzeichnisse fuer Pre-Update-Backups (pro Branch)
mkdir -p "$APP_DIR/backups/pre-update/main"
mkdir -p "$APP_DIR/backups/pre-update/experimental"
print_ok "Backup-Verzeichnisse vorbereitet"

# Backend Dependencies
print_step "Backend Dependencies installieren..."
cd "$APP_DIR/backend"
npm ci --include=dev --silent --no-audit 2>/dev/null || npm install --include=dev --silent --no-audit 2>/dev/null
print_ok "Backend Dependencies installiert"

# Sicherstellen, dass lokale Bin-Skripte ausfuehrbar sind
if [ -d "$APP_DIR/backend/node_modules/.bin" ]; then
  find "$APP_DIR/backend/node_modules/.bin" -type f -exec chmod u+x {} \; 2>/dev/null || true
fi

# Frontend-Hostrouting (Workspace/Public Hosts) vorbereiten
print_step "Frontend-Hostrouting konfigurieren..."
FRONTEND_WORKSPACE_HOSTS=""
FRONTEND_PUBLIC_HOSTS="$PUBLIC_HOSTS_CSV"
if [ "$USE_DOMAIN" = true ]; then
  FRONTEND_WORKSPACE_HOSTS="$DOMAIN"
fi
cat > "$APP_DIR/frontend/.env.production" <<EOF
VITE_WORKSPACE_HOSTS=$FRONTEND_WORKSPACE_HOSTS
VITE_PUBLIC_HOSTS=$FRONTEND_PUBLIC_HOSTS
EOF
print_ok "frontend/.env.production geschrieben"

# Frontend bauen
print_step "Frontend bauen..."
cd "$APP_DIR/frontend"
npm ci --silent --no-audit 2>/dev/null || npm install --silent --no-audit 2>/dev/null
if [ -d "$APP_DIR/frontend/node_modules/.bin" ]; then
  find "$APP_DIR/frontend/node_modules/.bin" -type f -exec chmod u+x {} \; 2>/dev/null || true
fi
npm run build --silent 2>/dev/null
print_ok "Frontend gebaut"

# ============================================
# Schritt 6: Konfiguration
# ============================================
print_header "Schritt 6/8: Konfiguration"

JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
CLAMAV_BINARY_DEFAULT="$(resolve_clamav_binary)"

print_step ".env-Datei erstellen..."
cat > "$APP_DIR/backend/.env" <<EOF
# ============================================
# Hammer WorkSpace - Konfiguration
# Generiert am $(date +%Y-%m-%d)
# ============================================

NODE_ENV=production
PORT=3000
HOST=127.0.0.1

# Datenbank
DB_HOST=localhost
DB_PORT=3306
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASS

# Sicherheit (automatisch generiert - NICHT aendern!)
JWT_SECRET=$JWT_SECRET
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
ENCRYPTION_KEY=$ENCRYPTION_KEY
COOKIE_SECURE=auto

# Update (GitHub Releases)
UPDATE_URL=https://api.github.com/repos/marchmr/workspace
UPDATE_REQUIRE_HASH=true

# Subdomain-Automation (Kundenportal)
SUBDOMAIN_PROVISIONING_ENABLED=true
SUBDOMAIN_PROVISIONING_USE_SUDO=true
SUBDOMAIN_FRONTEND_DIST_DIR=$APP_DIR/frontend/dist
SUBDOMAIN_BACKEND_PROXY_URL=http://127.0.0.1:3000
SUBDOMAIN_NGINX_SITES_AVAILABLE_DIR=/etc/nginx/sites-available
SUBDOMAIN_NGINX_SITES_ENABLED_DIR=/etc/nginx/sites-enabled
SUBDOMAIN_EXPECTED_SERVER_IPS=$(hostname -I | awk '{print $1}')
SUBDOMAIN_SSL_EMAIL=${SSL_EMAIL:-}

# File Security / Dateiaustausch
FILE_SECURITY_MAX_UPLOAD_MB=500
FILE_SECURITY_STRICT_SIGNATURE=true
FILE_SECURITY_ALLOW_ZIP_UPLOADS=false
FILE_SECURITY_ZIP_MAX_ENTRIES=500
FILE_SECURITY_ZIP_MAX_UNCOMPRESSED_MB=1000
FILE_SECURITY_ZIP_MAX_RATIO=60
FILE_SECURITY_CLAMAV_ENABLED=true
FILE_SECURITY_CLAMAV_BINARY=$CLAMAV_BINARY_DEFAULT
FILE_SECURITY_CLAMAV_TIMEOUT_MS=120000
FILE_SECURITY_CLAMAV_FAIL_CLOSED=true
EOF
print_ok ".env erstellt"
print_ok "ClamAV Scanner gesetzt: $CLAMAV_BINARY_DEFAULT"

# Datenbank-Migrationen (tsx fuer TypeScript-Migrationen)
print_step "Datenbank-Schema aufsetzen..."
cd "$APP_DIR/backend"
if npx tsx node_modules/.bin/knex migrate:latest --knexfile knexfile.ts 2>/dev/null; then
  print_ok "Tabellen erstellt"
else
  print_error "Migration fehlgeschlagen! Details:"
  npx tsx node_modules/.bin/knex migrate:latest --knexfile knexfile.ts 2>&1 || true
fi

# Seeds ausfuehren
if npx tsx node_modules/.bin/knex seed:run --knexfile knexfile.ts 2>/dev/null; then
  print_ok "Seed-Daten eingefuegt"
fi

# Admin-User mit benutzerdefiniertem Passwort
print_step "Admin-Benutzer erstellen..."
# Passwort hashen
ADMIN_HASH=$(node -e "
const bcrypt = require('bcrypt');
bcrypt.hash('$ADMIN_PASS', 12).then(h => process.stdout.write(h));
" 2>/dev/null)

# Rolle erstellen
mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "
INSERT INTO roles (name, description, is_system, created_at)
VALUES ('Super-Admin', 'Vollzugriff auf alle Funktionen', 1, NOW())
ON DUPLICATE KEY UPDATE name=name;
" 2>/dev/null

ROLE_ID=$(mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -N -e "
SELECT id FROM roles WHERE name='Super-Admin' LIMIT 1;
" 2>/dev/null)

# Admin-User Passwort aktualisieren (User wird via Seed angelegt)
mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "
UPDATE users
SET password_hash='$ADMIN_HASH'
WHERE username='admin';
" 2>/dev/null

USER_ID=$(mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -N -e "
SELECT id FROM users WHERE username='admin' LIMIT 1;
" 2>/dev/null)

if [ -z "$USER_ID" ]; then
  npx knex seed:run --specific 001_admin_user.ts --knexfile knexfile.cjs >/dev/null 2>&1 || true
  USER_ID=$(mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -N -e "
  SELECT id FROM users WHERE username='admin' LIMIT 1;
  " 2>/dev/null)
  if [ -n "$USER_ID" ]; then
    mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "
    UPDATE users
    SET password_hash='$ADMIN_HASH'
    WHERE id=$USER_ID;
    " 2>/dev/null
  fi
fi

if [ -n "$ROLE_ID" ] && [ -n "$USER_ID" ]; then
  mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "
  INSERT IGNORE INTO user_roles (user_id, role_id) VALUES ($USER_ID, $ROLE_ID);
  " 2>/dev/null
fi

# Core-Permissions einfuegen
print_step "Berechtigungen einrichten..."
mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" <<'PERMSQL'
INSERT IGNORE INTO permissions (`key`, label, description) VALUES
('admin.access', 'Admin-Bereich', 'Zugriff auf Administration'),
('users.view', 'Benutzer ansehen', NULL),
('users.create', 'Benutzer erstellen', NULL),
('users.edit', 'Benutzer bearbeiten', NULL),
('users.delete', 'Benutzer loeschen', NULL),
('roles.view', 'Rollen ansehen', NULL),
('roles.create', 'Rollen erstellen', NULL),
('roles.edit', 'Rollen bearbeiten', NULL),
('roles.delete', 'Rollen loeschen', NULL),
('settings.view', 'Einstellungen ansehen', NULL),
('settings.edit', 'Einstellungen bearbeiten', NULL),
('audit.view', 'Audit-Log ansehen', NULL),
('backup.create', 'Backup erstellen', NULL),
('backup.import', 'Backup importieren', NULL),
('plugins.manage', 'Plugins verwalten', NULL);
PERMSQL

# Alle Permissions der Admin-Rolle zuweisen
if [ -n "$ROLE_ID" ]; then
  mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "
  INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT $ROLE_ID, id FROM permissions;
  " 2>/dev/null
fi
print_ok "Admin-Benutzer mit gewaehltem Passwort erstellt"
print_ok "15 Berechtigungen zugewiesen"

# Berechtigungen
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/backend/.env"
chmod 750 "$APP_DIR/uploads" "$APP_DIR/uploads/documents" "$APP_DIR/uploads/avatars" "$APP_DIR/uploads/tenant-logos"
print_ok "Dateiberechtigungen gesetzt (.env nur fuer Owner lesbar)"

# ============================================
# Schritt 7: Nginx & SSL
# ============================================
print_header "Schritt 7/8: Webserver & SSL"

# Server-Name bestimmen
if [ "$USE_DOMAIN" = true ]; then
  SERVER_NAME="$DOMAIN"
  if [ ${#PUBLIC_HOSTS[@]} -gt 0 ]; then
    SERVER_NAME="$SERVER_NAME ${PUBLIC_HOSTS[*]}"
  fi
else
  SERVER_NAME="_"
fi

print_step "Nginx konfigurieren..."

# PHPMyAdmin Location Block
PMA_LOCATION=""
if [ "$INSTALL_PMA" = true ]; then
  PHP_FPM_SOCKET=$(ls /run/php/php*-fpm.sock 2>/dev/null | head -n 1 || true)
  if [ -z "$PHP_FPM_SOCKET" ]; then
    PHP_FPM_SOCKET="/run/php/php-fpm.sock"
  fi
  PMA_LOCATION="
    # PHPMyAdmin
    location ^~ /phpmyadmin/ {
        root /usr/share/;
        index index.php;
        try_files \$uri \$uri/ /phpmyadmin/index.php?\$args;

        location ~ \\.php\$ {
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
            fastcgi_pass unix:$PHP_FPM_SOCKET;
        }
    }"
fi

cat > /etc/nginx/sites-available/mike-workspace <<NGINX
server {
    listen 80;
    server_name $SERVER_NAME;

    # Sicherheits-Header
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Max Upload-Groesse (fuer Backup-Import)
    client_max_body_size 100M;

    # MIME-Types
    include /etc/nginx/mime.types;

    # API Proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }
$PMA_LOCATION

    # Frontend (statisch)
    root $APP_DIR/frontend/dist;
    index index.html;

    # SPA Fallback
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Statische Assets cachen
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
NGINX

# Aktivieren
ln -sf /etc/nginx/sites-available/mike-workspace /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Nginx testen und neuladen
if nginx -t 2>/dev/null; then
  systemctl reload nginx
  print_ok "Nginx konfiguriert"
else
  print_error "Nginx-Konfiguration fehlerhaft! Bitte manuell pruefen."
fi

# SSL mit Certbot
if [ "$SETUP_SSL" = true ]; then
  print_step "SSL-Zertifikat mit Let's Encrypt einrichten..."
  echo ""
  ALL_CERT_DOMAINS=("$DOMAIN")
  if [ ${#PUBLIC_HOSTS[@]} -gt 0 ]; then
    for host in "${PUBLIC_HOSTS[@]}"; do
      ALL_CERT_DOMAINS+=("$host")
    done
  fi
  CERTBOT_DOMAIN_ARGS=""
  for host in "${ALL_CERT_DOMAINS[@]}"; do
    CERTBOT_DOMAIN_ARGS="$CERTBOT_DOMAIN_ARGS -d $host"
  done

  echo -e "  ${YELLOW}Hinweis: Alle Domains muessen bereits auf diesen${NC}"
  echo -e "  ${YELLOW}Server zeigen (DNS A-Record auf $(hostname -I | awk '{print $1}'))${NC}"
  echo -e "  ${YELLOW}Domains:${NC} ${ALL_CERT_DOMAINS[*]}"
  echo ""

  if ask_yes_no "DNS ist korrekt konfiguriert, SSL jetzt einrichten?"; then
    if certbot --nginx $CERTBOT_DOMAIN_ARGS --email "$SSL_EMAIL" --agree-tos --non-interactive --redirect 2>/dev/null; then
      print_ok "SSL-Zertifikat installiert (${ALL_CERT_DOMAINS[*]})"
      print_ok "HTTP -> HTTPS Redirect aktiv"

      # Certbot Auto-Renewal Timer pruefen
      if systemctl is-active --quiet certbot.timer; then
        print_ok "Automatische Erneuerung aktiv (certbot.timer)"
      else
        systemctl enable certbot.timer 2>/dev/null
        systemctl start certbot.timer 2>/dev/null
        print_ok "Automatische Erneuerung eingerichtet"
      fi
    else
      print_error "SSL-Einrichtung fehlgeschlagen!"
      echo -e "  ${YELLOW}Manuell nachholen mit:${NC}"
      echo -e "  ${CYAN}sudo certbot --nginx $CERTBOT_DOMAIN_ARGS --email $SSL_EMAIL${NC}"
    fi
  else
    print_warn "SSL uebersprungen. Spaeter nachholen mit:"
    echo -e "  ${CYAN}sudo certbot --nginx $CERTBOT_DOMAIN_ARGS --email $SSL_EMAIL${NC}"
  fi
fi

# ============================================
# Schritt 8: Service & Firewall
# ============================================
print_header "Schritt 8/8: Systemd-Service & Firewall"

print_step "Systemd-Service einrichten..."
cat > /etc/systemd/system/mike-workspace.service <<EOF
[Unit]
Description=Hammer WorkSpace
After=network.target mariadb.service
Requires=mariadb.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
ExecStart=$(which npx) tsx src/server.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# Stop-Verhalten: max 10s warten, dann SIGKILL
TimeoutStopSec=10
KillMode=mixed
KillSignal=SIGTERM

# Sicherheit
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mike-workspace

[Install]
WantedBy=multi-user.target
EOF

configure_subdomain_provisioning_prereqs
configure_app_runtime_hardening
ensure_upload_mount_hardening
configure_clamav_isolation
ensure_node_jit_compatibility

systemctl daemon-reload
systemctl enable mike-workspace 2>/dev/null
systemctl start mike-workspace
print_ok "Service gestartet und aktiviert"

# Service-Status pruefen
sleep 2
if systemctl is-active --quiet mike-workspace; then
  print_ok "Service laeuft"
else
  print_warn "Service konnte nicht gestartet werden. Pruefe mit:"
  echo -e "  ${CYAN}sudo journalctl -u mike-workspace -f${NC}"
fi

# Firewall
print_step "Firewall konfigurieren..."
ufw allow OpenSSH > /dev/null 2>&1
ufw allow 'Nginx Full' > /dev/null 2>&1
ufw --force enable > /dev/null 2>&1
print_ok "UFW aktiv: SSH, HTTP, HTTPS erlaubt"

# ============================================
# FERTIG!
# ============================================

# URL bestimmen
if [ "$SETUP_SSL" = true ]; then
  APP_URL="https://$DOMAIN"
elif [ "$USE_DOMAIN" = true ]; then
  APP_URL="http://$DOMAIN"
else
  APP_URL="http://$(hostname -I | awk '{print $1}')"
fi

echo ""
echo -e "${GREEN}"
echo "  +-----------------------------------------------+"
echo "  |                                               |"
echo "  |   [OK]  Installation erfolgreich!             |"
echo "  |                                               |"
echo "  +-----------------------------------------------+"
echo -e "${NC}"
echo ""
echo -e "  ${BOLD}App URL (IP):${NC}     http://$(hostname -I | awk '{print $1}')"
if [ "$USE_DOMAIN" = true ]; then
  echo -e "  ${BOLD}App URL (Domain):${NC} ${APP_URL}"
  if [ -n "$PUBLIC_HOSTS_CSV" ]; then
    echo -e "  ${BOLD}Public Hosts:${NC}     $PUBLIC_HOSTS_CSV"
  fi
fi
echo -e "  ${BOLD}PHPMyAdmin:${NC}       ${APP_URL}/phpmyadmin/"
echo ""
echo -e "  ${YELLOW}Zugangsdaten werden NICHT im Installer-Output ausgegeben.${NC}"
echo -e "  ${YELLOW}Sie liegen in: ${CYAN}$APP_DIR/backend/.env${YELLOW} (chmod 600)${NC}"
echo ""
echo -e "  ${BOLD}Hilfsbefehle:${NC}"
echo -e "    Admin-Passwort:      Wurde bei der Installation gewaehlt"
echo -e "    DB-Zugang anzeigen:  ${CYAN}sudo grep '^DB_' $APP_DIR/backend/.env${NC}"
echo -e "    JWT-Secret anzeigen: ${CYAN}sudo grep '^JWT_SECRET' $APP_DIR/backend/.env${NC}"
echo -e "    Alle Secrets:        ${CYAN}sudo cat $APP_DIR/backend/.env${NC}"
echo -e "    Service-Status:      ${CYAN}sudo systemctl status mike-workspace${NC}"
echo -e "    Service-Neustart:    ${CYAN}sudo systemctl restart mike-workspace${NC}"
echo -e "    Logs:                ${CYAN}sudo journalctl -u mike-workspace -f${NC}"
if [ "$SETUP_SSL" != true ] && [ "$USE_DOMAIN" = true ]; then
  CERTBOT_HINT_ARGS="-d $DOMAIN"
  if [ ${#PUBLIC_HOSTS[@]} -gt 0 ]; then
    for host in "${PUBLIC_HOSTS[@]}"; do
      CERTBOT_HINT_ARGS="$CERTBOT_HINT_ARGS -d $host"
    done
  fi
  echo -e "    SSL nachholen:       ${CYAN}sudo certbot --nginx $CERTBOT_HINT_ARGS${NC}"
fi
echo ""
echo -e "  ${BOLD}Sicherheitshinweise:${NC}"
echo -e "    ${YELLOW}1.${NC} MFA fuer den Admin-Account im Web-Interface aktivieren"
echo -e "    ${YELLOW}2.${NC} .env-Datei niemals in Git oder oeffentlich teilen"
if [ "$SETUP_SSL" != true ]; then
  echo -e "    ${YELLOW}3.${NC} SSL-Zertifikat einrichten fuer verschluesselte Verbindung"
fi
echo ""
