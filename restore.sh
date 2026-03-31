#!/bin/bash
# ============================================
# MIKE WorkSpace - Restore Script
# Stellt ein Pre-Update-Backup wieder her.
#
# Usage:
#   sudo bash restore.sh <pfad-zur-backup-zip>
#
# Beispiel:
#   sudo bash restore.sh /opt/mike-workspace/backups/pre-update/main/pre-update_2026-03-29_18-00-00.zip
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

echo ""
echo -e "${BOLD}MIKE WorkSpace - Restore${NC}"
echo -e "================================================"

# Root-Check
if [ "$(id -u)" -ne 0 ]; then
  echo -e "${RED}[FAIL]${NC} Dieses Script muss als root ausgefuehrt werden."
  echo -e "  Verwende: ${CYAN}sudo bash restore.sh <backup-pfad>${NC}"
  exit 1
fi

# Argument pruefen
BACKUP_FILE="$1"
if [ -z "$BACKUP_FILE" ]; then
  echo -e "${RED}[FAIL]${NC} Kein Backup-Pfad angegeben."
  echo ""
  echo -e "  Usage: ${CYAN}sudo bash restore.sh <pfad-zur-backup-zip>${NC}"
  echo ""
  
  # Vorhandene Backups auflisten
  BACKUP_BASE="$APP_DIR/backups/pre-update"
  if [ -d "$BACKUP_BASE" ]; then
    echo -e "  ${BOLD}Vorhandene Backups:${NC}"
    for BRANCH_DIR in "$BACKUP_BASE"/*/; do
      if [ -d "$BRANCH_DIR" ]; then
        BRANCH_NAME=$(basename "$BRANCH_DIR")
        FILES=$(ls -1 "$BRANCH_DIR"pre-update_*.zip 2>/dev/null)
        if [ -n "$FILES" ]; then
          echo -e "  ${CYAN}[$BRANCH_NAME]${NC}"
          echo "$FILES" | while read -r F; do
            SIZE=$(du -h "$F" 2>/dev/null | cut -f1)
            echo -e "    $F ($SIZE)"
          done
        fi
      fi
    done
  fi
  echo ""
  exit 1
fi

# Backup-Datei pruefen
if [ ! -f "$BACKUP_FILE" ]; then
  echo -e "${RED}[FAIL]${NC} Backup-Datei nicht gefunden: $BACKUP_FILE"
  exit 1
fi

# ZIP pruefen
if ! file "$BACKUP_FILE" | grep -q "Zip archive"; then
  echo -e "${RED}[FAIL]${NC} Die Datei ist kein gueltiges ZIP-Archiv."
  exit 1
fi

# Metadaten aus ZIP lesen (falls vorhanden)
META_JSON=$(unzip -p "$BACKUP_FILE" "mike-workspace-backup-meta-*.json" 2>/dev/null || unzip -p "$BACKUP_FILE" "meta.json" 2>/dev/null || echo "")
if [ -n "$META_JSON" ]; then
  BACKUP_VERSION=$(echo "$META_JSON" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).version||'?')}catch{console.log('?')}})" 2>/dev/null || echo "?")
  BACKUP_BRANCH=$(echo "$META_JSON" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).branch||'?')}catch{console.log('?')}})" 2>/dev/null || echo "?")
  BACKUP_COMMIT=$(echo "$META_JSON" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).commit||'?')}catch{console.log('?')}})" 2>/dev/null || echo "?")
  
  echo -e "\n  ${BOLD}Backup-Info:${NC}"
  echo -e "  Version:  v$BACKUP_VERSION"
  echo -e "  Branch:   $BACKUP_BRANCH"
  echo -e "  Commit:   $BACKUP_COMMIT"
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" 2>/dev/null | cut -f1)
echo -e "  Datei:    $BACKUP_FILE ($BACKUP_SIZE)"

# Bestaetigung
echo ""
echo -e "  ${YELLOW}ACHTUNG: Dies ueberschreibt den aktuellen Stand!${NC}"
echo -en "  ${BOLD}Restore durchfuehren? [j/N]:${NC} " > /dev/tty
read -r CONFIRM < /dev/tty

if [[ ! "$CONFIRM" =~ ^[jJyY]$ ]]; then
  echo ""
  echo "  Abgebrochen."
  exit 0
fi

# ============================================
# 1. Service stoppen
# ============================================
echo -e "\n${CYAN}> Service stoppen...${NC}"
systemctl stop "$SERVICE" 2>/dev/null || true
sleep 1
echo -e "  ${GREEN}[OK]${NC} Service gestoppt"

# ============================================
# 2. Dateien wiederherstellen
# ============================================
echo -e "\n${CYAN}> Dateien aus Backup wiederherstellen...${NC}"

# Backend, Frontend, Plugins, Uploads wiederherstellen
# (Ueberschreibt bestehende Dateien, neue Dateien bleiben erhalten)
unzip -o -q "$BACKUP_FILE" "backend/*" "frontend/*" "plugins/*" "uploads/*" \
  "install.sh" "update.sh" "restore.sh" "CHANGELOG.md" "README.md" \
  -d "$APP_DIR" 2>/dev/null || true

echo -e "  ${GREEN}[OK]${NC} Dateien wiederhergestellt"

# ============================================
# 3. Datenbank wiederherstellen
# ============================================
echo -e "\n${CYAN}> Datenbank wiederherstellen...${NC}"

# DB-Dump aus ZIP extrahieren
DB_DUMP_NAME=$(unzip -l "$BACKUP_FILE" 2>/dev/null | grep -o 'mike-workspace-db-dump-[^ ]*\.sql' | head -1)
if [ -n "$DB_DUMP_NAME" ]; then
  TEMP_DUMP="/tmp/restore-$DB_DUMP_NAME"
  unzip -o -j -q "$BACKUP_FILE" "$DB_DUMP_NAME" -d "/tmp/" 2>/dev/null
  
  if [ -f "/tmp/$DB_DUMP_NAME" ]; then
    mv "/tmp/$DB_DUMP_NAME" "$TEMP_DUMP" 2>/dev/null || TEMP_DUMP="/tmp/$DB_DUMP_NAME"
  fi
  
  if [ -f "$TEMP_DUMP" ] && [ -f "$APP_DIR/backend/.env" ]; then
    DB_NAME=$(grep '^DB_NAME=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_USER_ENV=$(grep '^DB_USER=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_PASS=$(grep '^DB_PASSWORD=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_HOST=$(grep '^DB_HOST=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
    DB_PORT=$(grep '^DB_PORT=' "$APP_DIR/backend/.env" | cut -d'=' -f2)
    
    if [ -n "$DB_NAME" ] && [ -n "$DB_USER_ENV" ]; then
      mysql -u "$DB_USER_ENV" -p"$DB_PASS" \
        -h "${DB_HOST:-localhost}" -P "${DB_PORT:-3306}" \
        "$DB_NAME" < "$TEMP_DUMP" 2>/dev/null
      echo -e "  ${GREEN}[OK]${NC} Datenbank wiederhergestellt"
    else
      echo -e "  ${YELLOW}[!!]${NC} DB-Verbindungsdaten nicht vollstaendig"
    fi
    
    rm -f "$TEMP_DUMP"
  else
    echo -e "  ${YELLOW}[!!]${NC} DB-Dump konnte nicht extrahiert werden"
  fi
else
  echo -e "  ${YELLOW}[!!]${NC} Kein Datenbank-Dump im Backup gefunden"
fi

# ============================================
# 4. Dependencies installieren
# ============================================
echo -e "\n${CYAN}> Backend Dependencies installieren...${NC}"
cd "$APP_DIR/backend"
sudo -u "$APP_USER" npm ci --omit=dev --silent --no-audit 2>/dev/null || sudo -u "$APP_USER" npm install --omit=dev --silent --no-audit 2>/dev/null
sudo -u "$APP_USER" npm install --save-dev typescript tsx 2>/dev/null
echo -e "  ${GREEN}[OK]${NC} Dependencies installiert"

# ============================================
# 5. Berechtigungen setzen
# ============================================
echo -e "\n${CYAN}> Berechtigungen setzen...${NC}"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/backend/.env" 2>/dev/null || true
chmod 750 "$APP_DIR/uploads" "$APP_DIR/uploads/documents" "$APP_DIR/uploads/avatars" "$APP_DIR/uploads/tenant-logos" 2>/dev/null || true
echo -e "  ${GREEN}[OK]${NC} Berechtigungen gesetzt"

# ============================================
# 6. Service starten
# ============================================
echo -e "\n${CYAN}> Service starten...${NC}"
systemctl start "$SERVICE"
sleep 2

if systemctl is-active --quiet "$SERVICE"; then
  echo -e "  ${GREEN}[OK]${NC} Service laeuft"
else
  echo -e "  ${RED}[FAIL]${NC} Service konnte nicht gestartet werden"
  echo -e "  Logs: ${CYAN}sudo journalctl -u $SERVICE -f${NC}"
  exit 1
fi

# ============================================
# Fertig
# ============================================
RESTORED_VERSION="unbekannt"
if [ -f "$APP_DIR/backend/package.json" ]; then
  RESTORED_VERSION=$(node -e "try{console.log(require('$APP_DIR/backend/package.json').version)}catch{console.log('unbekannt')}" 2>/dev/null || echo "unbekannt")
fi

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  Restore erfolgreich!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "  ${BOLD}Version:${NC}   v$RESTORED_VERSION"
echo -e "  ${BOLD}Quelle:${NC}    $(basename "$BACKUP_FILE")"
echo ""
