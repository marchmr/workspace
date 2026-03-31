# Videoplattform Implementierung (01.04.2026)

## Ziel
Die Videoplattform wurde als eigenständiges Plugin implementiert, ohne bestehende Core-Logik zu brechen. Das Kunden-Frontend läuft als öffentliche Plugin-Route und ist serverseitig auf eine globale Subdomain einschränkbar.

## Neue Dateien

### Plugin-Metadaten
- `plugins/videoplattform/plugin.json`

### Backend
- `plugins/videoplattform/backend/index.ts`
- `plugins/videoplattform/backend/migrations/20260401_001_create_videoplattform_tables.ts`

### Frontend
- `plugins/videoplattform/frontend/index.tsx`
- `plugins/videoplattform/frontend/pages/VideoPlatformAdminPage.tsx`
- `plugins/videoplattform/frontend/pages/VideoPlatformPortalPage.tsx`
- `plugins/videoplattform/frontend/admin/VideoPlatformSettingsPage.tsx`
- `plugins/videoplattform/frontend/videoplattform.css`

### Generiert durch Registry-Script
- `frontend/src/pluginRegistry.ts`

## Datenmodell (neu)

### `vp_customers`
- Kunden je Mandant (`tenant_id`)
- Eindeutig pro Mandant über `(tenant_id, name)`

### `vp_videos`
- Videos je Mandant
- `source_type`: `upload` oder `url`
- Upload-Metadaten (`file_name`, `file_path`, `mime_type`, `size_bytes`)
- optionale Kundenzuordnung (`customer_id`)

### `vp_share_codes`
- Freigabecodes je Mandant
- `scope`: `video` oder `customer`
- Aktiv/Inaktiv + Ablaufdatum
- Eindeutig je Mandant über `(tenant_id, code)`

### `vp_activity_logs`
- Zugriffs-/Streaming-Logs
- protokolliert IP, User-Agent, Eventtyp, Erfolg/Fehler, Codebezug

## Backend-Funktionalität

### Admin-Endpunkte (auth + permissions)
Basis: `/api/plugins/videoplattform`

- Kunden:
  - `GET /customers`
  - `POST /customers`
  - `PUT /customers/:id`
  - `DELETE /customers/:id`
- Videos:
  - `GET /videos`
  - `POST /videos` (multipart Upload oder URL-JSON)
  - `PUT /videos/:id`
  - `POST /videos/:id/replace` (Datei ersetzen)
  - `DELETE /videos/:id`
- Codes:
  - `GET /videos/:id/codes`
  - `POST /videos/:id/codes`
  - `GET /customers/:id/codes`
  - `POST /customers/:id/codes`
  - `PATCH /codes/:id`
  - `DELETE /codes/:id`
- Aktivität:
  - `GET /activity?limit=50`

### Public-Endpunkte (ohne Login)
- `GET /public/config`
- `POST /public/access/by-code`
- `GET /public/stream/:videoId?code=...`
- `GET /public/health`

### Sicherheits-/Betriebslogik
- Öffentliche Endpunkte prüfen serverseitig den Host gegen Plugin-Setting:
  - Setting-Key: `videoplattform.public_subdomain`
  - Default: `kunden.webdesign-hammer.de`
- Freigabecode-Prüfung inkl. Ablauf/Status
- Streaming nur mit gültigem, passendem Code
- Range-Streaming für Upload-Videos
- Audit-Logs für Admin-Aktionen

## Frontend-Funktionalität

### Plugin-Routen
- Admin: `/videoplattform`
- Public-Portal: `/kundenportal-videos`

### Admin-UI
- Tab „Videos“: Upload/URL anlegen, Videos anzeigen, löschen, Codes erstellen/anzeigen
- Tab „Kunden“: Kunden anlegen/löschen, Kundencodes erstellen/anzeigen
- Tab „Aktivität“: letzte Zugriffe/Events

### Public-UI
- Code-Eingabe
- Anzeige freigegebener Videos
- Bei Kundenfreigabe einfache Suche
- Stream über signierten Code-Request (`?code=...`)

### Settings-Panel (Core Admin > Einstellungen)
- Komponente: `VideoPlatformSettingsPage`
- Speichert globale Subdomain in Core-Settings:
  - `PUT /api/admin/settings/plugin/videoplattform`
  - Key `videoplattform.public_subdomain`

## Core-Integration
- Keine invasive Core-Änderung notwendig.
- Bestehende Core-Mechaniken wurden genutzt:
  - Plugin-Loader + Migrationen
  - Permission-System
  - Plugin-Settings-API
  - Public-Plugin-Route-Support
- Automatische Registry-Aktualisierung ausgeführt:
  - `node frontend/scripts/generate-plugin-registry.mjs`

## Verifikation
- TypeScript-Checks erfolgreich:
  - `frontend`: `node node_modules/typescript/bin/tsc --noEmit`
  - `backend`: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`

Hinweis: `npm run build` war lokal nicht direkt ausführbar, weil `node_modules/.bin/tsc` keine Execute-Berechtigung hatte. Kompiliert wurde stattdessen direkt über das TypeScript-Binary.

## Betriebs-Hinweise
- Für echte Erreichbarkeit der Kundenoberfläche muss die konfigurierte Subdomain (DNS + Proxy) auf diese Instanz zeigen.
- Optional kann `VITE_PUBLIC_HOSTS` weiterhin für Host-basiertes Frontend-Routing gesetzt werden.
- Auch ohne diese Variable schützt der Plugin-Backend-Hostcheck die Public-API gegen falsche Hosts.
