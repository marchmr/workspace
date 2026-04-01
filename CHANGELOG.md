# Changelog

## [Unreleased]

### Fix

#### Core
- `install.sh` setzt jetzt automatisch alle Voraussetzungen für die Subdomain-Automation (systemd Drop-In + sudoers + `SUBDOMAIN_*` Defaults)
- `update.sh` zieht dieselben Subdomain-/SSL-Voraussetzungen nach jedem Update automatisch nach
- Verbesserte Fehlerklassifizierung im Subdomain-Provisioning für `certbot`-Lock-/Rechtefehler und `nginx -t` Log-/PID-Probleme

#### UI
- In den Plugin-Settings wird bei fehlgeschlagener Provisionierung nun ein separater Block `Genauer Fehler` mit Roh-Fehlermeldung angezeigt
- Fix-Befehle bleiben darunter direkt kopierbar sichtbar

## [1.20.0] - 2026-03-30

### Neu

#### Core
- Local-First Plugin-Architektur — Plugins werden als TSX direkt im Monorepo kompiliert (kein separater Build)
- Automatischer Plugin-Registry-Generator (`generate-plugin-registry.mjs`) erkennt Plugins und erzeugt Imports
- `@mike/` Alias-System für Plugin-Imports (tsconfig paths + Vite resolve)
- `plugins/` Verzeichnis mit eigener `package.json` und `.cjs` Migrations-Support

#### Plugin
- Todo-Plugin mit Backend-Storage, REST-API und Frontend-Management-Dashboard
- Zeiterfassungs-Timer im Todo-Plugin für Aufgaben-Tracking
- Klickbarer Todo-Header in Dashboard-Kachel mit direkter Navigation

#### UI
- Horizontale TopBar ersetzt Sidebar-Navigation — modernes Dark-Theme
- Regie-Mega-Menu für zentralisierte Plugin- und Modulverwaltung
- Plugin-SVG-Icons werden via `dangerouslySetInnerHTML` korrekt gerendert

#### Docs
- PLUGIN_DEV_GUIDE um `@mike/` Alias-Pattern und Build-Learnings erweitert
- Pflicht-Leerexports für Plugin-Registry-Kompatibilität dokumentiert

### Fix

#### API
- Auth preHandler auf alle Todo-Plugin-Routen angewendet
- `request.user.userId` statt `request.userId` für JWT-Auth in Plugins

#### UI
- RegiePage Icon-Rendering korrigiert (HTML-String statt JSX)
- Plugin-Router-Imports in Dashboard-Kacheln korrigiert

---

## [1.19.1] - 2026-03-29

### Neu

#### Plugin
- Separates Plugin-Repository (`michaelnid/WorkSpace-Plugins`) als Architekturstandard
- Neue Umgebungsvariable `PLUGIN_URL` für separaten Plugin-Katalog (GitHub Pages)
- `resolvePluginUrl()` und `fetchPluginVersionInfo()` trennen Plugin- von Core-URL-Auflösung

#### Docs
- PLUGIN_DEV_GUIDE Kapitel 13 komplett überarbeitet — Zwei-Repo-Architektur, .gitignore, Build-Scripts, Publishing-Workflow
- Vollständige `.gitignore`-Vorlage für das Plugin-Repo (nur TypeScript-Quellcode wird committed)
- Build-Scripts (`build-plugin.sh`, `build-all.sh`, `publish.sh`) als Copy-Paste-Referenz dokumentiert

---

## [1.19.0] - 2026-03-29

### Neu

#### Core
- Multi-Account E-Mail-Konnektor — mehrere SMTP-Konten verwaltbar, Plugins wählen per accountId
- DB-Migration 016 erstellt `email_accounts` Tabelle und migriert bestehende Einzel-Konfiguration automatisch
- Standard-Konto (`is_default`) für System-Mails, Fallback auf erstes Konto

#### API
- CRUD-Endpunkte für E-Mail-Konten (GET/POST/PUT/DELETE `/api/admin/email/accounts`)
- GET `/api/admin/email/accounts/list` — Kurzliste für Plugin-Dropdowns (ID, Name, Absender)
- POST `/api/admin/email/accounts/:id/test` — Test-Mail pro Konto senden

#### UI
- Eigene Admin-Seite "E-Mail-Konten" mit Tabelle, Inline-Formular und Test-Versand
- Sidebar-Menüpunkt "E-Mail-Konten" im Admin-Bereich

#### Docs
- PLUGIN_DEV_GUIDE Abschnitt 6.13 aktualisiert für Multi-Account E-Mail mit accountId

### Fix

#### Core
- Update-Check-Intervall auf 2 Stunden Standard erhöht (GitHub API Rate-Limit)
- `update.sh` installiert `zip` automatisch falls fehlend
- Backup-Verzeichnis `chown` auf `mike:mike` für Backend-Lesezugriff
- Audit-Log-Eintrag bei Versions-/Commit-Änderung nach SSH-Update

#### UI
- phpMyAdmin nginx-Location mit verschachteltem PHP-Handler (kein Download mehr)
- Interne System-Settings (`update.*`, `system.*`) aus Einstellungen-Tabelle ausgeblendet
- Update-Intervall-Optionen auf 2h, 6h, 12h, 24h reduziert

### Entfernt

#### UI
- EmailSettingsCard aus Einstellungen entfernt (jetzt eigene Seite)
- Changelog-Verlauf-Kachel im Update-Manager entfernt

## [1.18.0] - 2026-03-29

### Neu

#### Core
- Multi-Branch Update-System — Auswahl zwischen Main (stabil), Dev (Pre-Releases) und Experimental (Commits)
- Automatisches Pre-Update-Backup als ZIP vor jedem Update (Quellcode + DB-Dump + Uploads + .env)
- Per-Branch Backup-Ordner mit konfigurierbarer Rotation (Main/Dev: 5, Experimental: 10)
- Automatischer Update-Check im Hintergrund mit konfigurierbarem Intervall (Sekunden-genau, Default: 10s)
- In-App-Benachrichtigung an Admins bei verfügbarem Update (nur einmal pro Version/Commit)
- Neues `restore.sh` Script — stellt Pre-Update-Backups wieder her (Service, Dateien, Datenbank)

#### API
- `GET /api/admin/updates/branch` — aktuellen Branch und Prüf-Intervall lesen
- `PUT /api/admin/updates/branch` — Branch wechseln (mit Audit-Log)
- `PUT /api/admin/updates/check-interval` — Prüf-Intervall für automatischen Update-Check ändern
- `GET /api/admin/updates/backups` — Liste aller Pre-Update-Backups (Datum, Größe, Restore-Befehl)
- `GET /api/admin/updates/changelog-history` — Release-Notes oder Commit-Verlauf je nach Branch
- Update-Check liefert jetzt SSH-Befehl, Commit-Hash und Branch-spezifische Changelog-Daten

#### UI
- Branch-Auswahl mit drei Kacheln (Main/Dev/Experimental) und Beschreibung
- Branch-Wechsel-Warnungen bei Upgrade auf Experimental und bei Downgrade
- SSH-Befehl-Box mit Copy-to-Clipboard Button (SVG-Icon) wenn Update verfügbar
- Rollback-Info — zeigt Restore-Befehl wenn Backup jünger als 5 Minuten
- Changelog-Verlauf aufklappbar (Release-Notes oder Commit-Messages je nach Branch)
- Backup-Übersicht als Tabelle mit Datum, Branch, Größe und Restore-Befehl
- Konfigurierbares Prüf-Intervall für automatischen Update-Check (Dropdown + Speichern)

#### Admin
- `update.sh` komplett neugeschrieben — `--branch` Parameter, Auto-Backup, DB-Dump, Service-Restart
- Experimental-Branch zeigt letzte 10 Commit-Messages als Changelog an

#### Docs
- README mit Update-Dokumentation (3 Branches, Befehle, Backup-Strategie, Restore-Anleitung)

### Entfernt

#### API
- `POST /api/admin/updates/install-core` — Core-Updates nur noch per SSH

#### UI
- Core-Update-Button und Core-Task-Status im Webinterface entfernt

---

## [1.17.0] - 2026-03-29

### Neu

#### Core
- Toast-Popup-Benachrichtigungen mit Slide-in-Animation, Progress-Bar und Hover-Pause (max 4 gleichzeitig)
- Entity Locking — Pessimistic In-Memory Locks verhindern gleichzeitige Bearbeitung (1-Min Heartbeat-Timeout)
- Auto-Release von Locks bei WebSocket-Disconnect oder Tab-Close (sendBeacon-Fallback)
- WebSocket Context mit Auto-Connect, exponentiellem Backoff-Reconnect und Lock-Event-Push
- Neue Audit-Kategorie `lock` für Lock-Aktionen (acquired, released, expired, forced)

#### API
- Notification-API um `urgent`-Flag, `duration`, `category` und `broadcast()`-Methode erweitert
- Lock REST API mit acquire, release, heartbeat, query (Bulk), request-access und force-release (Admin)
- `GET /api/admin/audit-log/actions` liefert alle Aktionen gruppiert nach Kategorie

#### UI
- `useEntityLock` (Detail) und `useEntityLocks` (Liste) Hooks mit Heartbeat und Live-Updates
- `LockIndicator` (Avatar + Schloss-Badge) und `LockBanner` (Detail-Banner mit Zugriff anfragen)
- DataTable Lock-Integration — `lockEntityType`-Prop für gelbliche Hervorhebung gesperrter Zeilen

#### Admin
- Aktive Sperren — Live-Übersicht aller Locks mit Force-Release unter `/admin/locks`
- Audit-Log Aktionsfilter mit Autocomplete-Eingabe und Browse-Modal

#### Security
- Neue Permission `locks.manage` für Admin-Zugriff auf Lock-Verwaltung

#### Docs
- Plugin Dev Guide Sektion 14 (Notification System) und Sektion 15 (Entity Locking)

---

## [1.16.0] - 2026-03-29

### Neu

#### Security
- PolicyEngine Enforce-Modus — alle `/api/`-Routen ohne expliziten Schutz werden automatisch mit 401 blockiert
- `requirePermission()` ruft intern `authenticate()` auf — kein separater `fastify.authenticate` mehr nötig
- Gestaffeltes Rate Limiting — 500 req/min authentifiziert (per User-ID), 60 req/min anonym (per IP)

#### UI
- Dashboard-Begrüßung modernisiert — multilingual mit kyrillischer, chinesischer Schrift etc.
- Design-Token `--radius-full: 9999px` für abgerundete Kacheln als Standard

#### Docs
- Plugin Dev Guide vollständig aktualisiert — PolicyEngine, Rate Limiting, requirePermission
- Neuer Abschnitt §10.10 PolicyEngine mit Flussdiagramm und Schutz-Optionen
- Sicherheits-Checkliste um PolicyEngine, addHook-Verbot und Umlaut-Regel erweitert

### Fix

#### UI
- Umlaut-Standard durchgesetzt (ü, ö, ä) in allen Frontend-Texten

### Entfernt

#### Security
- Redundante Scope-Level addHook Auth-Hooks aus `admin.ts` und `documents.ts` entfernt
