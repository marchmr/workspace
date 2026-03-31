#!/bin/bash
# ============================================
# MIKE WorkSpace - Multi-Branch Update Script
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
SERVICE="mike-workspace"
BACKUP_BASE_DIR="$APP_DIR/backups/pre-update"
DEFAULT_GIT_REPO="https://github.com/marchmr/workspace.git"
EXPECTED_REPO_SLUG="marchmr/workspace"

# Abhaengigkeiten sicherstellen
if ! command -v zip &>/dev/null; then
  apt-get install -y -qq zip > /dev/null 2>&1
fi

echo ""
echo -e "${BOLD}MIKE WorkSpace - Update${NC}"
echo -e "================================================"

# Root-Check
if [ "$(id -u)" -ne 0 ]; then
  echo -e "${RED}[FAIL]${NC} Dieses Script muss als root ausgefuehrt werden."
  echo -e "  Verwende: ${CYAN}sudo bash update.sh --branch main${NC}"
  exit 1
fi

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
sudo -u "$APP_USER" npm ci --omit=dev --silent --no-audit 2>/dev/null || sudo -u "$APP_USER" npm install --omit=dev --silent --no-audit 2>/dev/null
sudo -u "$APP_USER" npm install --save-dev typescript tsx 2>/dev/null
echo -e "  ${GREEN}[OK]${NC} Dependencies installiert"

# ============================================
# Frontend Build (falls Vite vorhanden)
# ============================================
if [ -f "$APP_DIR/frontend/package.json" ] && grep -q '"build"' "$APP_DIR/frontend/package.json" 2>/dev/null; then
  if [ -d "$APP_DIR/frontend/node_modules" ] || [ -f "$APP_DIR/frontend/package-lock.json" ]; then
    echo -e "\n${CYAN}> Frontend Build...${NC}"
    cd "$APP_DIR/frontend"
    sudo -u "$APP_USER" npm ci --silent 2>/dev/null || sudo -u "$APP_USER" npm install --silent 2>/dev/null
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
