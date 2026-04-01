# Core-Automation für Plugin-Subdomains (01.04.2026)

## Was jetzt automatisch geht
Für die Videoplattform-Subdomain kann der Admin jetzt aus den Plugin-Einstellungen heraus automatisch ausführen:

1. DNS-Prüfung (A/AAAA) gegen Server-IP(s)
2. Nginx-Config für die Subdomain schreiben
3. Nginx-Site aktivieren (sites-enabled)
4. `nginx -t` prüfen
5. Nginx neu laden
6. Let's Encrypt Zertifikat mit Certbot beantragen

Zusätzlich abgesichert:
- Nginx-Config wird atomisch geschrieben (Temp-Datei + Rename)
- Vorhandene Config wird vor Änderung als Backup-Datei gesichert (`.bak.<timestamp>`)
- Bei Fehlern in `nginx -t` oder Reload wird automatisch Rollback versucht
- Schreibfehler auf read-only Pfaden liefern klare Hinweise für Dev-Konfiguration
- Backup wird in ein beschreibbares Temp-Backup-Verzeichnis ausgelagert (nicht mehr neben `/etc`-Dateien)
- Strukturierte Fehlercodes mit Schritt-für-Schritt-Anleitung werden an die UI geliefert
- Neuer Preflight-Check zeigt Probleme vor der eigentlichen Provisionierung

## Neu im Core

### Konfiguration (`backend/src/core/config.ts`)
Neue Section `subdomainProvisioning`:
- `SUBDOMAIN_PROVISIONING_ENABLED` (default: `true`)
- `SUBDOMAIN_PROVISIONING_USE_SUDO` (default: `true`)
- `SUBDOMAIN_FRONTEND_DIST_DIR` (default: `<root>/frontend/dist`)
- `SUBDOMAIN_BACKEND_PROXY_URL` (default: `http://127.0.0.1:<PORT>`)
- `SUBDOMAIN_NGINX_SITES_AVAILABLE_DIR` (default: `/etc/nginx/sites-available`)
- `SUBDOMAIN_NGINX_SITES_ENABLED_DIR` (default: `/etc/nginx/sites-enabled`)
- `SUBDOMAIN_SSL_EMAIL` oder `SSL_EMAIL`
- `SUBDOMAIN_EXPECTED_SERVER_IPS` (CSV, optional)

### Neuer Service
- `backend/src/services/subdomainProvisioning.ts`

Funktionen:
- DNS-Auflösung + Vergleich mit erwarteten Server-IPs
- Status lesen (`getSubdomainStatus`)
- Provisionierung ausführen (`provisionSubdomain`)

### Neue Admin-API
- `backend/src/routes/subdomainProvisioning.ts`
- registriert in `backend/src/server.ts`

Endpunkte:
- `GET /api/admin/subdomain-provisioning/videoplattform/preflight?host=...`
- `GET /api/admin/subdomain-provisioning/videoplattform/status?host=...`
- `POST /api/admin/subdomain-provisioning/videoplattform/provision`

Berechtigung:
- `settings.manage`

## Frontend-Änderungen

### Plugin-Settings UI
Datei:
- `plugins/videoplattform/frontend/admin/VideoPlatformSettingsPage.tsx`

Neue Aktionen:
- `System-Preflight`
- `DNS/Nginx/SSL prüfen`
- `Automatisch einrichten`

Neue Anzeige:
- DNS-Status (A/AAAA, zeigt auf Server)
- Nginx-Status (Config/Enabled)
- SSL-Status
- Schrittprotokoll der letzten Provisionierung
- Manuelle Fallback-Befehle bei Fehlern (kopierbar)
- Automatische Hilfestellung: Fehlercode, Ursache, konkrete nächste Schritte

### Public-Route Verhalten im Core
Datei:
- `frontend/src/App.tsx`

Änderung:
- Wenn die aktuelle URL exakt einer öffentlichen Plugin-Route entspricht (z. B. `/kundenportal-videos`), rendert die App die Public-Routen auch dann, wenn `VITE_PUBLIC_HOSTS` nicht gesetzt ist.
- Dadurch funktioniert die Subdomain-Weiterleitung auf `/kundenportal-videos` ohne zusätzlichen Frontend-Build-Host-Whitelist-Zwang.

## Wichtige Betriebs-Hinweise

1. Der Backend-Prozess muss Nginx/Certbot ausführen dürfen (direkt oder per `sudo -n`).
2. Für `certbot` ist eine gültige E-Mail (`SUBDOMAIN_SSL_EMAIL` oder `SSL_EMAIL`) nötig.
3. DNS muss vorher korrekt auf den Server zeigen; sonst bricht die Provisionierung bewusst ab.
4. Wenn keine `SUBDOMAIN_EXPECTED_SERVER_IPS` gesetzt sind, wird auf lokale Interface-IPs geprüft; das kann bei manchen Netz-Topologien angepasst werden müssen.

## Grenzen / bewusstes Verhalten

- Die Automation ist aktuell auf den Videoplattform-Use-Case und dessen Public-Pfad (`/kundenportal-videos`) ausgerichtet.
- Wenn OS-Rechte fehlen, liefert die API konkrete manuelle Befehle als Fallback zurück.
