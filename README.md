# MIKE WorkSpace

Modulares Enterprise-Framework mit Plugin-System, Multi-Tenancy und rollenbasierter Zugriffskontrolle.

---

## Techstack

| Komponente | Technologie |
|---|---|
| Backend | Node.js 20, Fastify 5, TypeScript |
| Frontend | React 19, Vite 6, TypeScript |
| Datenbank | MariaDB 10.11+ |
| Auth | JWT (Access + Refresh), MFA (TOTP), Session-Management |
| Echtzeit | WebSocket (Lock-Events), SSE (Notifications) |
| Webserver | Nginx (Reverse Proxy) |
| Prozess | systemd |

## Features

- **Multi-Tenancy**: Mandantenfähiges System mit tenant-isolierten Daten
- **Plugin-System**: Dynamisches Laden von Backend- und Frontend-Plugins
- **RBAC**: Rollenbasierte Zugriffskontrolle mit feingranularen Permissions
- **Entity Locking**: Pessimistic Locks verhindern gleichzeitige Bearbeitung (In-Memory, Heartbeat, Auto-Release)
- **Toast Notifications**: Echtzeit-Popup-Benachrichtigungen für dringliche Nachrichten
- **Audit-Log**: Lückenlose Protokollierung aller System- und Datenaktionen
- **Dokumentenverwaltung**: Zentraler Dateispeicher mit ACL
- **Backup/Restore**: Export und Import von Systemsicherungen
- **MFA/2FA**: TOTP-basierte Zwei-Faktor-Authentifizierung mit Notfallcodes (PDF)
- **PolicyEngine**: Enforce-Modus blockiert ungeschützte API-Routen automatisch
- **Hostrouting**: Workspace-Host und Public-Subdomains (z.B. Kundenportal) koennen getrennt betrieben werden

## Mindest-Serveranforderungen

| Ressource | Minimum |
|---|---|
| RAM | 2 GB |
| vCPU | 2 |
| Disk | 20 GB |
| OS | Debian 12 |
| Ports | 80 (HTTP), 443 (HTTPS), 22 (SSH) |

## Plugins

Plugins werden direkt im Repository unter `plugins/` entwickelt und mit jedem Update automatisch ausgeliefert. Kein separates Repository noetig.

- **Aktivierung/Deaktivierung** ueber das Admin-Dashboard (Updates & Deployment)
- **Migrationen** laufen automatisch beim Server-Neustart
- **Kein Build-Step** — TypeScript wird direkt ueber `tsx` ausgefuehrt

Die Plugin-Entwicklungsdokumentation liegt unter `docs/PLUGIN_DEV_GUIDE.md`.

### Public-Subdomains (Kundenportal)

Frontend-Hostrouting wird ueber `frontend/.env.production` gesteuert:

```env
VITE_WORKSPACE_HOSTS=workspace.webdesign-hammer.de
VITE_PUBLIC_HOSTS=kundenportal.webdesign-hammer.de,videos.webdesign-hammer.de
```

- Hosts in `VITE_PUBLIC_HOSTS` laufen im Public-Modus.
- Public-Hosts zeigen nur Plugin-Routen mit `public: true`.
- Optionales Feintuning pro Route ueber `allowedHosts` in `PluginRoute`.

## Installation

```bash
INSTALL_URL="https://raw.githubusercontent.com/marchmr/workspace/main/install.sh"
curl -fSLo install.sh "$INSTALL_URL"
sudo bash install.sh
```

Der Installer führt interaktiv durch alle Schritte: Pakete, Node.js, MariaDB, Nginx, SSL (Let's Encrypt ohne E-Mail), systemd-Service.
Fehlende System-Abhängigkeiten wie `ffmpeg` und `acl` werden automatisch mit installiert.

## Update

MIKE WorkSpace unterstuetzt drei Update-Branches. Der Branch kann im Admin-Dashboard unter "Updates & Deployment" konfiguriert werden.

| Branch | Beschreibung | Update-Quelle |
|---|---|---|
| **main** | Stabil - Empfohlen fuer Produktivumgebungen | GitHub Releases (stable) |
| **dev** | Entwicklung - Neue Features, moeglicherweise instabil | GitHub Pre-Releases |
| **experimental** | Experimentell - Neuste Commits, keine Garantie | GitHub Commits |

### Update ausfuehren (SSH)

```bash
# Stabiler Branch (Standard)
sudo bash /opt/mike-workspace/update.sh --branch main

# Entwicklungs-Branch
sudo bash /opt/mike-workspace/update.sh --branch dev

# Experimenteller Branch
sudo bash /opt/mike-workspace/update.sh --branch experimental
```

Vor jedem Update wird automatisch ein Backup erstellt.
Zusätzlich prüft `update.sh` fehlende System-Abhängigkeiten (`ffmpeg`, `acl`, `certbot`, `nginx` usw.) und installiert sie automatisch nach.

### Pre-Update-Backups

Backups werden pro Branch gespeichert:

| Branch | Max. Backups | Speicherort |
|---|---|---|
| main | 5 | `/opt/mike-workspace/backups/pre-update/main/` |
| dev | 5 | `/opt/mike-workspace/backups/pre-update/dev/` |
| experimental | 10 | `/opt/mike-workspace/backups/pre-update/experimental/` |

Aeltere Backups werden automatisch geloescht.

Jedes Backup enthaelt:
- Backend- und Frontend-Quellcode
- Plugins und Uploads
- Datenbank-Dump (mysqldump)
- .env Konfiguration

### Restore

Falls nach einem Update Probleme auftreten:

```bash
sudo bash /opt/mike-workspace/restore.sh /opt/mike-workspace/backups/pre-update/main/pre-update_YYYY-MM-DD_HH-MM-SS.zip
```

Ohne Argumente zeigt das Script alle vorhandenen Backups an:

```bash
sudo bash /opt/mike-workspace/restore.sh
```

## Deinstallation

Vollständige Entfernung aller Komponenten, Datenbanken und Konfigurationen:

```bash
sudo bash /opt/mike-workspace/uninstall.sh
```
