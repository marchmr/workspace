# Hammer WorkSpace — Plugin-Entwicklungshandbuch

> Vollstaendige Referenz fuer die Entwicklung von Plugins im Hammer WorkSpace Monorepo.
> Stand: v3.2 (Monorepo-Architektur)

---

## 1. Architektur-Uebersicht

### Monorepo-Modell

Plugins leben **direkt im Haupt-Repository** unter `plugins/<plugin-id>/`.
Sie werden mit jedem `git pull` / `update.sh` automatisch mitgeliefert.

```
Hauptseite/
├── backend/          # Core-Backend (Fastify + TypeScript)
├── frontend/         # Core-Frontend (React + Vite)
├── plugins/          # <-- Alle Plugins hier
│   ├── mein-plugin/
│   │   ├── plugin.json
│   │   ├── backend/
│   │   │   ├── index.ts
│   │   │   ├── routes.ts
│   │   │   └── migrations/
│   │   ├── frontend/
│   │   │   ├── index.tsx
│   │   │   ├── pages/
│   │   │   └── components/
│   │   └── README.md       # Plugin-API-Dokumentation
│   └── anderes-plugin/
├── install.sh
└── update.sh
```

### Lifecycle

```
Server-Start
  └─> pluginLoader.ts: discoverPlugins()
        └─> Liest plugins/ Verzeichnis
        └─> Liest plugin.json Manifest
        └─> Auto-Registrierung in DB (wenn neu)
        └─> loadPlugins()
              └─> Dependency-Aufloesung (topologische Sortierung)
              └─> Permissions registrieren
              └─> Backend-Entry dynamisch importieren (tsx)
              └─> Knex-Migrationen ausfuehren
              └─> Lifecycle-Hooks aufrufen (onInstall/onUpgrade)
              └─> Fastify-Plugin unter /api/plugins/{id}/ registrieren
```

### Kein Build-Step noetig

Da der Server ueber `npx tsx` laeuft, werden `.ts`-Dateien **direkt** ausgefuehrt.
Plugins muessen **nicht** kompiliert werden. Das eliminiert:
- Build-Konfiguration (tsconfig.json fuer Plugins)
- CommonJS/ESM-Kompatibilitaetsprobleme
- Kompilierungsfehler bei Deployments

---

## 2. Plugin-Manifest: `plugin.json`

Jedes Plugin **muss** eine `plugin.json` im Root-Verzeichnis haben.

```json
{
    "id": "mein-plugin",
    "name": "Mein Plugin",
    "version": "1.0.0",
    "description": "Beschreibung des Plugins",
    "author": "Entwickler-Name",
    "dependencies": [],
    "backend_entry": "backend/index.ts",
    "frontend_entry": "frontend/index.tsx",
    "nav_icon": "plugin-icon",
    "nav_label": "Mein Plugin",
    "nav_order": 100,
    "permissions": [
        "mein-plugin.view",
        "mein-plugin.edit",
        "mein-plugin.admin"
    ],
    "settings_page": false
}
```

### Feld-Referenz

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `id` | `string` | Ja | Eindeutige Plugin-ID. Erlaubt: `a-zA-Z0-9._-` |
| `name` | `string` | Ja | Anzeigename im Admin-Dashboard |
| `version` | `string` | Ja | Semver-Version (z.B. `1.2.3`) |
| `description` | `string` | Nein | Kurzbeschreibung |
| `author` | `string` | Nein | Entwickler/Team |
| `dependencies` | `string[]` | Nein | IDs anderer Plugins die zuerst geladen werden muessen |
| `backend_entry` | `string` | Ja | Pfad zum Backend-Einstiegspunkt (relativ zum Plugin-Root) |
| `frontend_entry` | `string` | Nein | Pfad zum Frontend-Einstiegspunkt |
| `nav_icon` | `string` | Nein | SVG-Icon-ID fuer Navigation (**keine Emojis!**) |
| `nav_label` | `string` | Nein | Label in der Navigation |
| `nav_order` | `number` | Nein | Sortierung in der Navigation (kleiner = weiter oben) |
| `permissions` | `string[]` | Nein | Custom Permissions die registriert werden |
| `settings_page` | `boolean` | Nein | Ob das Plugin eine Einstellungsseite hat |

---

## 3. Backend-Entwicklung

### Einstiegspunkt: `backend/index.ts`

Der Backend-Entry muss ein **Fastify-Plugin** als Default-Export liefern.

```typescript
// plugins/mein-plugin/backend/index.ts
import { FastifyInstance } from 'fastify';
import { routes } from './routes.js';

// Optionale Lifecycle-Hooks (als Named Exports)
export async function onInstall(fastify: FastifyInstance, db: any): Promise<void> {
    console.log('[MeinPlugin] Erstinstallation - Seed-Daten anlegen');
    // z.B. Default-Einstellungen in DB schreiben
}

export async function onUpgrade(fastify: FastifyInstance, db: any, fromVersion: string): Promise<void> {
    console.log(`[MeinPlugin] Upgrade von ${fromVersion}`);
    // z.B. Daten-Migration bei Major-Updates
}

export async function onUninstall(fastify: FastifyInstance, db: any): Promise<void> {
    console.log('[MeinPlugin] Deinstallation');
    // z.B. Plugin-spezifische Tabellen loeschen
}

// Fastify-Plugin (Default Export)
export default async function plugin(fastify: FastifyInstance): Promise<void> {
    // Alle Routes werden unter /api/plugins/mein-plugin/ registriert
    await fastify.register(routes);
}
```

### Routes: `backend/routes.ts`

```typescript
// plugins/mein-plugin/backend/routes.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../backend/src/core/database.js';

export async function routes(fastify: FastifyInstance): Promise<void> {

    // WICHTIG: Jede Route MUSS { preHandler: [fastify.authenticate] } haben!
    // Ohne Auth-PreHandler blockiert die PolicyEngine die Route mit 401
    // und request.user ist null.

    // GET /api/plugins/mein-plugin/items
    fastify.get('/items', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const items = await db('mein_plugin_items').select('*');
        return reply.send({ items });
    });

    // POST /api/plugins/mein-plugin/items
    fastify.post('/items', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const body = request.body as { name: string; description?: string };

        const [id] = await db('mein_plugin_items').insert({
            name: body.name,
            description: body.description || '',
            created_by: (request.user as any).userId,
            created_at: new Date(),
        });

        return reply.status(201).send({ id });
    });
}
```

### Core-APIs fuer Plugins

Plugins koennen folgende Core-Module importieren:

```typescript
// Datenbank (Knex)
import { getDatabase } from '../../../backend/src/core/database.js';

// Konfiguration
import { config } from '../../../backend/src/core/config.js';

// Verschluesselung
import { encrypt, decrypt } from '../../../backend/src/core/encryption.js';

// Audit-Logging (ueber Fastify-Decorator)
// Innerhalb eines Route-Handlers:
await fastify.audit.log({
    action: 'mein-plugin.item.created',
    category: 'plugin',
    entityType: 'mein_plugin_items',
    entityId: String(id),
    newState: body,
}, request);

// Email-Service
import { sendMail } from '../../../backend/src/services/emailService.js';
await sendMail({
    to: 'nutzer@example.com',
    subject: 'Benachrichtigung',
    html: '<p>Plugin-Nachricht</p>',
    accountId: 'standard',  // Email-Account-ID (aus Admin-Einstellungen)
});
```

### Authentication & Authorization

**WICHTIG:** Plugins werden NICHT automatisch mit Auth-Middleware versehen!
Jede Route MUSS explizit `{ preHandler: [fastify.authenticate] }` setzen.
Ohne Auth-PreHandler passiert folgendes:

1. Die **PolicyEngine** blockiert die Route automatisch mit 401
2. `request.user` ist `null` — Zugriffe auf `request.user.userId` crashen mit 500

```typescript
// Einfache Authentifizierung (jeder eingeloggte Nutzer):
fastify.get('/items', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = (request.user as any).userId;
    // ...
});

// Mit Permission-Pruefung (nur Nutzer mit bestimmter Rolle):
import { requirePermission } from '../../../backend/src/middleware/auth.js';

fastify.get('/admin-items', {
    preHandler: [requirePermission('mein-plugin.admin')],
}, async (request, reply) => {
    // Nur Nutzer mit 'mein-plugin.admin' Permission
    // requirePermission prueft Auth automatisch mit
});
```

Die Permissions werden automatisch ueber das `permissions`-Array in `plugin.json` registriert.
Admins koennen sie dann Rollen zuweisen.

---

## 4. Datenbank-Migrationen

### Verzeichnis

```
plugins/mein-plugin/backend/migrations/
├── 20250101_001_create_items_table.ts
├── 20250201_002_add_category_column.ts
└── 20250315_003_add_index.ts
```

### Namenskonvention

```
YYYYMMDD_NNN_beschreibung.ts
```

- `YYYYMMDD`: Datum (fuer chronologische Sortierung)
- `NNN`: Laufende Nummer
- Dateiendung: `.ts` (direkt von tsx ausgefuehrt)

### Migrations-Tabelle

Jedes Plugin bekommt seine **eigene** Migrations-Tabelle:
`knex_migrations_<plugin-id>`

Das verhindert Konflikte zwischen Core- und Plugin-Migrationen.

### Migration schreiben

```typescript
// plugins/mein-plugin/backend/migrations/20250101_001_create_items_table.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('mein_plugin_items', (table) => {
        table.increments('id').primary();
        table.string('name', 255).notNullable();
        table.text('description').defaultTo('');
        table.integer('created_by').unsigned().references('id').inTable('users');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('mein_plugin_items');
}
```

### Spalten hinzufuegen (ohne Datenverlust)

```typescript
// plugins/mein-plugin/backend/migrations/20250201_002_add_category_column.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    const hasColumn = await knex.schema.hasColumn('mein_plugin_items', 'category');
    if (!hasColumn) {
        await knex.schema.alterTable('mein_plugin_items', (table) => {
            table.string('category', 100).defaultTo('allgemein');
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    const hasColumn = await knex.schema.hasColumn('mein_plugin_items', 'category');
    if (hasColumn) {
        await knex.schema.alterTable('mein_plugin_items', (table) => {
            table.dropColumn('category');
        });
    }
}
```

> **Wichtig:** Knex-Migrationen sind **idempotent** — sie laufen nur einmal.
> Neue Spalten werden bei Plugin-Updates automatisch angelegt.
> Bestehende Daten bleiben erhalten.

---

## 5. Frontend-Entwicklung

### Verbindlicher Core-Formularstandard (für alle neuen Plugins)

Große Formulare werden **core-seitig** vereinheitlicht.  
Neue Plugin-Formulare sollen den zentralen Dialog verwenden:

```tsx
import PluginFormDialog from '@mike/components/PluginFormDialog';
```

Regeln:
- Für größere Eingabemasken immer `PluginFormDialog` verwenden (kein eigenes Modal-Markup im Plugin).
- Felder als `.input` oder `.form-input` im Dialog rendern (Größe/Abstände kommen aus dem Core-Design-System).
- Bereichsstruktur mit `plugin-form-section`, `plugin-form-section-title` und `plugin-form-grid` nutzen.
- Sichtbare deutsche Texte immer mit korrekten Umlauten schreiben: `ä`, `ö`, `ü`, `ß` (nicht `ae`, `oe`, `ue`, `ss`).
- Keine nativen Browser-Dialoge verwenden (`window.alert`, `window.confirm`, `window.prompt`).
  Stattdessen immer Core-Dialoge über `useModal()` bzw. `PluginFormDialog` nutzen.

### Plugin-Registry-System

Das Frontend nutzt ein **automatisch generiertes Registry-System**.
Der Generator liest alle `plugin.json`-Dateien und erzeugt `frontend/src/pluginRegistry.ts`.

**Registry generieren (nach Aendern von plugin.json oder frontend_entry):**

```bash
node frontend/scripts/generate-plugin-registry.mjs
```

> Dieser Befehl muss nach dem Erstellen eines neuen Plugins oder dem Aendern
> des `frontend_entry`-Pfads ausgefuehrt werden. Auf dem Server passiert das
> automatisch beim Build.

### Einstiegspunkt: `frontend/index.tsx`

Der Frontend-Entry exportiert **benannte Arrays** — keine Default-Exports!

```tsx
// plugins/mein-plugin/frontend/index.tsx
import { lazy } from 'react';
import type {
    PluginRoute,
    PluginNavItem,
    PluginDashboardTile,
    PluginExtensionTile,
    PluginSettingsPanel,
    PluginSearchProvider,
    PluginQuickAction,
} from '@mike/pluginRegistry';

const MainPage = lazy(() => import('./pages/MainPage'));
const DashboardTile = lazy(() => import('./tiles/DashboardTile'));

// SVG-Icon als String (fuer Navigation-Rendering)
const navIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M..."/></svg>`;

// Routes: Definiert Seiten die unter /<path> erreichbar sind
export const routes: PluginRoute[] = [
    {
        path: '/mein-plugin',
        component: MainPage,
        permission: 'mein-plugin.view',
        public: false,
    },
];

// NavItems: Erscheinen in der Regie-Seitenleiste und koennen in die TopBar gepinnt werden
export const navItems: PluginNavItem[] = [
    {
        label: 'Mein Plugin',
        icon: navIcon,
        path: '/mein-plugin',
        permission: 'mein-plugin.view',
        order: 50,         // Sortierung (kleiner = weiter oben)
        group: 'Tools',    // Optional: Gruppierung im Regie-Menu
        groupIcon: '...',  // Optional: SVG fuer die Gruppe
        groupOrder: 10,    // Optional: Reihenfolge der Gruppe
    },
];

// DashboardTiles: Widgets auf dem Dashboard (Drag & Drop, resizable)
export const dashboardTiles: PluginDashboardTile[] = [
    {
        id: 'mein-plugin-overview',
        title: 'Mein Plugin',
        description: 'Kurze Beschreibung fuer das Dashboard',
        component: DashboardTile,
        permission: 'mein-plugin.view',
        order: 10,
        defaultWidth: 12,       // Grid-Units (1 Unit = 20px)
        defaultHeight: 8,
        defaultVisible: true,   // Standardmaessig sichtbar
    },
];

// WICHTIG: Alle optionalen Exports muessen deklariert werden,
// auch wenn sie nicht genutzt werden. Der Registry-Generator
// importiert alle Felder via `import *` — fehlende Exports
// verursachen Rollup/Vite-Build-Warnungen.
export const extensionTiles: PluginExtensionTile[] = [];
export const settingsPanel: PluginSettingsPanel | undefined = undefined;
export const searchProvider: PluginSearchProvider | undefined = undefined;
export const quickActions: PluginQuickAction[] = [];
```

### Verfuegbare Registry-Exports

| Export | Typ | Beschreibung |
|---|---|---|
| `routes` | `PluginRoute[]` | Seiten-Routen (path + lazy component) |
| `navItems` | `PluginNavItem[]` | Navigationseintraege (TopBar Pins, Regie-Menu) |
| `dashboardTiles` | `PluginDashboardTile[]` | Dashboard-Widgets |
| `extensionTiles` | `PluginExtensionTile[]` | Erweiterbare Slots auf anderen Seiten |
| `settingsPanel` | `PluginSettingsPanel` | Einstellungs-Panel im Admin-Bereich |
| `searchProvider` | `PluginSearchProvider` | Globale Suche-Integration |
| `quickActions` | `PluginQuickAction[]` | Tastenkuerzel / Schnellaktionen |

#### `PluginRoute` Felder (inkl. Hostrouting)

| Feld | Typ | Beschreibung |
|---|---|---|
| `path` | `string` | Seitenpfad (z.B. `/mein-plugin`) |
| `component` | `LazyExoticComponent` | React-Seite (lazy) |
| `permission` | `string` | Optional: Permission fuer geschuetzte Workspace-Route |
| `public` | `boolean` | Optional: `true` = Route auf Public-Hosts ohne Workspace-Login |
| `allowedHosts` | `string[]` | Optional: Host-Allowlist (z.B. `['kundenportal.example.de', '*.kunden.example.de']`) |

Beispiel fuer eine oeffentliche Kundenportal-Seite:

```tsx
export const routes: PluginRoute[] = [
    {
        path: '/videos',
        component: CustomerVideoPage,
        public: true,
        allowedHosts: ['kundenportal.webdesign-hammer.de'],
    },
    {
        path: '/videos/admin',
        component: VideoAdminPage,
        permission: 'video.admin',
    },
];
```

### Integration: Globale Suche & Quick Actions

`GlobalSearch` (Cmd/Ctrl+K) aggregiert:
- Core-Suchergebnisse
- Plugin-`searchProvider`
- Core + Plugin-`quickActions`

Minimalbeispiel:

```tsx
import { apiFetch } from '@mike/context/AuthContext';
import type { PluginSearchProvider, PluginQuickAction } from '@mike/pluginRegistry';

export const searchProvider: PluginSearchProvider = {
    label: 'Mein Plugin',
    async search(query: string) {
        if (query.trim().length < 2) return [];
        const res = await apiFetch(`/api/plugins/mein-plugin/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) return [];
        const data = await res.json();
        return (Array.isArray(data.results) ? data.results : []).map((r: any) => ({
            title: r.title,
            description: r.subtitle,
            path: `/mein-plugin/${r.id}`,
        }));
    },
};

export const quickActions: PluginQuickAction[] = [
    {
        id: 'mein-plugin.open',
        label: 'Mein Plugin öffnen',
        keywords: ['mein plugin', 'module', 'tools'],
        execute: () => window.location.assign('/mein-plugin'),
    },
    {
        id: 'mein-plugin.admin',
        label: 'Plugin-Einstellungen öffnen',
        permission: 'mein-plugin.admin',
        execute: () => window.location.assign('/admin/settings'),
    },
];
```

Hinweise:
- `execute()` laeuft ausserhalb von React-Komponenten: keine Hooks verwenden.
- Quick-Action-Icons muessen vertrauenswuerdige, statische SVG-Strings sein (kein User-Input).
- `searchProvider.permission` und `quickAction.permission` steuern die Sichtbarkeit pro Rolle.

### Dashboard-Tile Komponente

```tsx
// plugins/mein-plugin/frontend/tiles/DashboardTile.tsx
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@mike/context/AuthContext';

export default function DashboardTile() {
    const [data, setData] = useState<any>(null);

    const load = useCallback(async () => {
        const res = await apiFetch('/api/plugins/mein-plugin/stats');
        if (res.ok) setData(await res.json());
    }, []);

    useEffect(() => { void load(); }, [load]);

    if (!data) return <div className="text-muted">Laden...</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Kompakte Darstellung fuer Dashboard-Widget */}
        </div>
    );
}
```

### API-Calls aus dem Frontend

Plugins verwenden den **`@mike/`-Alias** fuer alle Core-Imports.
Dieser Alias wird in `tsconfig.json` und `vite.config.ts` definiert
und zeigt auf `frontend/src/`.

```typescript
// @mike/ Alias — funktioniert aus jeder Plugin-Verzeichnistiefe
import { apiFetch } from '@mike/context/AuthContext';

// Automatisch authentifiziert (JWT wird mitgesendet)
const res = await apiFetch('/api/plugins/mein-plugin/items');
const data = await res.json();
```

> **Wichtig:** Niemals relative Pfade wie `../../../frontend/src/...` verwenden!
> Der `@mike/`-Alias ist stabil, unabhaengig von der Verzeichnistiefe,
> und funktioniert sowohl mit `tsc` als auch mit Vite.

### Router / Navigation

Plugins koennen `react-router-dom` **nicht direkt importieren** (liegt
ausserhalb der Plugin-`node_modules`-Aufloesung). Stattdessen den
Re-Export ueber `@mike/` verwenden:

```typescript
import { useNavigate } from '@mike/hooks/usePluginNavigate';

// Verfuegbar: useNavigate, useLocation, useParams, useSearchParams
```

### Toast-Benachrichtigungen

Zwei Systeme verfuegbar:

**1. Modal-basiert (ModalProvider):**
```tsx
import { useToast, useModal } from '@mike/components/ModalProvider';

const toast = useToast();
const modal = useModal();

toast.success('Gespeichert!');
toast.error('Fehler aufgetreten');

const confirmed = await modal.confirm({
    title: 'Loeschen?',
    message: 'Element wirklich loeschen?',
    confirmText: 'Loeschen',
    variant: 'danger',
});
```

**2. Inline-Toast (ToastContainer):**
```tsx
import { useInlineToast, InlineToastContainer } from '@mike/components/ToastContainer';

const inlineToast = useInlineToast();
inlineToast.success('Inline-Nachricht');
```

---

## 6. Design-System

### CSS-Variablen

Plugins **muessen** die Core-CSS-Variablen nutzen, damit sie im Dark/Light-Mode korrekt dargestellt werden.

```css
/* Farben */
var(--color-bg)           /* Seiten-Hintergrund */
var(--color-bg-card)      /* Karten-Hintergrund */
var(--color-text)         /* Standardtext */
var(--color-text-muted)   /* Abgeschwächter Text */
var(--color-primary)      /* Primaerfarbe */
var(--color-border)       /* Trennlinien */
var(--color-success)      /* Erfolg */
var(--color-warning)      /* Warnung */
var(--color-danger)       /* Gefahr/Fehler */

/* Abstande */
var(--space-xs)           /* 4px */
var(--space-sm)           /* 8px */
var(--space-md)           /* 16px */
var(--space-lg)           /* 24px */
var(--space-xl)           /* 32px */

/* Radien */
var(--radius-sm)          /* 6px */
var(--radius-md)          /* 8px */
var(--radius-lg)          /* 12px */

/* Schriftgroessen */
var(--font-size-xs)       /* 0.75rem */
var(--font-size-sm)       /* 0.875rem */
var(--font-size-base)     /* 1rem */
var(--font-size-lg)       /* 1.125rem */
```

### Verfuegbare CSS-Klassen

```html
<!-- Layout -->
<div class="card">...</div>
<div class="card-title">...</div>
<div class="flex-between">...</div>
<div class="page-header">...</div>
<h1 class="page-title">...</h1>
<p class="page-subtitle">...</p>

<!-- Buttons -->
<button class="btn btn-primary">Primaer</button>
<button class="btn btn-secondary">Sekundaer</button>
<button class="btn btn-danger">Gefahr</button>
<button class="btn btn-sm">Klein</button>

<!-- Badges -->
<span class="badge badge-success">Aktiv</span>
<span class="badge badge-warning">Warnung</span>
<span class="badge badge-info">Info</span>

<!-- Tabellen -->
<div class="table-container">
    <table>...</table>
</div>

<!-- Formulare -->
<input class="input" />
<select class="input">...</select>
<textarea class="textarea">...</textarea>

<!-- Text -->
<span class="text-muted">Abgeschwächter Text</span>
```

### Icons

**Keine Emojis verwenden!** Immer eigene SVG-Icons erstellen:

```tsx
const myIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
        <path d="M..." />
    </svg>
);
```

---

## 7. Lifecycle-Hooks

Plugins koennen optionale Named Exports fuer Lifecycle-Events bereitstellen:

| Hook | Wann | Parameter |
|---|---|---|
| `onInstall` | Beim ersten Laden eines neuen Plugins | `(fastify, db)` |
| `onUpgrade` | Wenn die Version in `plugin.json` hoeher ist als in der DB | `(fastify, db, fromVersion)` |
| `onUninstall` | Beim Entfernen eines Plugins (ueber Admin-UI) | `(fastify, db)` |

```typescript
export async function onInstall(fastify: FastifyInstance, db: any): Promise<void> {
    // Seed-Daten, Default-Einstellungen, etc.
    await db('settings').insert({
        key: 'mein-plugin.welcome_shown',
        value_encrypted: 'false',
        category: 'plugin',
        plugin_id: 'mein-plugin',
    });
}

export async function onUpgrade(fastify: FastifyInstance, db: any, fromVersion: string): Promise<void> {
    // Daten-Migrationen die ueber Schema-Aenderungen hinausgehen
    if (fromVersion === '1.0.0') {
        // Migration von v1 zu v2
        await db('mein_plugin_items').update({ category: 'legacy' }).whereNull('category');
    }
}
```

---

## 8. Plugin-Updates

### Wie Updates funktionieren

1. Entwickler aendert Plugin-Code im Repository
2. Version in `plugin.json` wird angehoben
3. `update.sh` (oder `git pull`) zieht neuen Code
4. Server-Neustart: PluginLoader erkennt Versionsaenderung
5. Migrationen werden automatisch ausgefuehrt
6. `onUpgrade` Hook wird aufgerufen

### Rueckwaertskompatibilitaet

- **DB-Spalten** hinzufuegen: Immer mit Defaults (`defaultTo('...')`)
- **DB-Spalten** nie direkt loeschen — als `deprecated` markieren
- **API-Endpunkte** nicht umbenennen — neue hinzufuegen, alte als Alias behalten
- **Neue Permissions** werden automatisch registriert

### Admin-UI

Im Admin-Dashboard:
- **Plugins-Sektion** zeigt alle lokal vorhandenen Plugins
- **Aktivieren/Deaktivieren** per Toggle (erfordert Server-Neustart)
- **Entfernen** loescht DB-Eintraege, Permissions, Migrations-Tracking
  (Plugin-Dateien bleiben im Repo — kommen mit dem naechsten Update zurueck)

---

## 9. Sicherheit & DSGVO

### Content Security Policy

Der Core setzt CSP-Header. Plugins muessen:
- Keine externen Ressourcen laden (keine Google Fonts, keine CDNs)
- Keine Inline-Scripts verwenden
- Alle Assets lokal buendeln

### DSGVO

- Personenbezogene Daten immer verschluesselt speichern (`encrypt()`)
- Audit-Logs fuer alle Datenverarbeitungen
- Loeschen von Nutzerdaten bei Account-Deaktivierung implementieren

### Path-Traversal-Schutz

Der PluginLoader prueft, dass `backend_entry` innerhalb des Plugin-Verzeichnisses liegt:
```
backend/index.ts          ✓
../../etc/passwd           ✗ (blockiert)
```

---

## 10. Testing & Debugging

### Lokale Entwicklung

```bash
# Server starten (im Backend-Verzeichnis)
cd backend
npx tsx src/server.ts

# Logs beobachten
# [PluginLoader] Neues Plugin entdeckt: Mein Plugin v1.0.0
# [PluginLoader] Migrationen fuer mein-plugin ausgefuehrt
# [PluginLoader] Plugin Mein Plugin erfolgreich geladen
```

### Auf dem Server

```bash
# Logs anzeigen
journalctl -u mike-workspace -f

# Neustart nach Plugin-Aenderung
sudo systemctl restart mike-workspace
```

---

## 11. Schnellstart: Beispiel-Plugin erstellen

### 1. Verzeichnis anlegen

```bash
mkdir -p plugins/notizen/backend/migrations
mkdir -p plugins/notizen/frontend/pages
```

### 2. plugin.json

```json
{
    "id": "notizen",
    "name": "Notizen",
    "version": "1.0.0",
    "description": "Einfache Notizen-Verwaltung",
    "author": "Hammer Team",
    "dependencies": [],
    "backend_entry": "backend/index.ts",
    "frontend_entry": "frontend/index.tsx",
    "nav_icon": "notizen",
    "nav_label": "Notizen",
    "nav_order": 50,
    "permissions": ["notizen.view", "notizen.edit"],
    "settings_page": false
}
```

### 3. Migration

```typescript
// plugins/notizen/backend/migrations/20250101_001_create_notes.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('plugin_notizen', (table) => {
        table.increments('id').primary();
        table.string('title', 255).notNullable();
        table.text('content').defaultTo('');
        table.integer('user_id').unsigned().notNullable().references('id').inTable('users');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('plugin_notizen');
}
```

### 4. Backend

```typescript
// plugins/notizen/backend/index.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../backend/src/core/database.js';

export default async function plugin(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    // GET /api/plugins/notizen/notes
    fastify.get('/notes', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const notes = await db('plugin_notizen')
            .where('user_id', userId)
            .orderBy('updated_at', 'desc');
        return reply.send({ notes });
    });

    // POST /api/plugins/notizen/notes
    fastify.post('/notes', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const { title, content } = request.body as { title: string; content?: string };

        const [id] = await db('plugin_notizen').insert({
            title,
            content: content || '',
            user_id: userId,
        });

        await fastify.audit.log({
            action: 'notizen.note.created',
            category: 'plugin',
            entityType: 'plugin_notizen',
            entityId: String(id),
            newState: { title },
        }, request);

        return reply.status(201).send({ id });
    });

    // DELETE /api/plugins/notizen/notes/:id
    fastify.delete('/notes/:id', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const userId = (request.user as any).userId;

        const deleted = await db('plugin_notizen')
            .where({ id, user_id: userId })
            .delete();

        if (!deleted) {
            return reply.status(404).send({ error: 'Notiz nicht gefunden' });
        }

        return reply.send({ success: true });
    });
}
```

### 5. Frontend (React)

```tsx
// plugins/notizen/frontend/index.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../frontend/src/context/AuthContext';
import { useToast } from '../../../frontend/src/components/ModalProvider';

interface Note {
    id: number;
    title: string;
    content: string;
    created_at: string;
}

export default function NotizenPage() {
    const toast = useToast();
    const [notes, setNotes] = useState<Note[]>([]);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');

    const loadNotes = useCallback(async () => {
        const res = await apiFetch('/api/plugins/notizen/notes');
        if (res.ok) {
            const data = await res.json();
            setNotes(data.notes);
        }
    }, []);

    useEffect(() => { void loadNotes(); }, [loadNotes]);

    const createNote = async () => {
        if (!title.trim()) return;
        const res = await apiFetch('/api/plugins/notizen/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content }),
        });
        if (res.ok) {
            toast.success('Notiz erstellt');
            setTitle('');
            setContent('');
            await loadNotes();
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Notizen</h1>
                <p className="page-subtitle">Persoenliche Notizen verwalten</p>
            </div>

            <div className="card mb-md">
                <div className="card-title">Neue Notiz</div>
                <input
                    className="input mb-sm"
                    placeholder="Titel"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                />
                <textarea
                    className="textarea mb-sm"
                    placeholder="Inhalt"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={3}
                />
                <button className="btn btn-primary" onClick={createNote}>
                    Speichern
                </button>
            </div>

            {notes.map((note) => (
                <div key={note.id} className="card mb-sm">
                    <strong>{note.title}</strong>
                    <p className="text-muted" style={{ marginTop: 4 }}>{note.content}</p>
                </div>
            ))}
        </div>
    );
}
```

### 6. Server neustarten

```bash
sudo systemctl restart mike-workspace
```

Das Plugin wird automatisch erkannt, in der DB registriert, und ist unter
`/api/plugins/notizen/` erreichbar.

---

## 12. Tabellen-Namenskonvention

Plugin-Tabellen sollten mit dem Plugin-Praefix beginnen:

```
plugin_<plugin-id>_<tabelle>
```

Beispiel:
- `plugin_notizen` (Haupttabelle)
- `plugin_notizen_tags` (Unter-Tabelle)

Das verhindert Namenskonflikte mit Core-Tabellen und anderen Plugins.

---

## 13. Plugin-spezifische Einstellungen

Plugins koennen Settings ueber die `settings`-Tabelle speichern:

```typescript
const db = getDatabase();

// Setting lesen
const setting = await db('settings')
    .where({ key: 'mein-plugin.max_items', plugin_id: 'mein-plugin' })
    .first();

// Setting schreiben
await db('settings').insert({
    key: 'mein-plugin.max_items',
    value_encrypted: '100',
    category: 'plugin',
    plugin_id: 'mein-plugin',
}).onConflict(['key', 'plugin_id']).merge();
```

---

## 14. Deployment-Workflow

### Plugin ins Repo aufnehmen

```bash
# Im Hauptprojekt-Verzeichnis
git add plugins/mein-plugin/
git commit -m "feat(plugins): Mein Plugin hinzugefuegt"
git push
```

### Server-Update

```bash
# Auf dem Server
sudo bash /opt/mike-workspace/update.sh --branch main
# → git pull zieht Plugin-Code mit
# → Server startet neu
# → PluginLoader erkennt neues Plugin
# → Migrationen laufen automatisch
```

---
