# CRM Plugin

Kundenverwaltung mit kachelbasierter Kundenakte und Ticketsystem für MIKE WorkSpace.

## Techstack

- **Backend**: Fastify + Knex.js (MySQL/MariaDB)
- **Frontend**: React 19 + TypeScript
- **Layout-Engine**: TileGrid (Drag & Drop, Resize)

## Features

- Kundenliste mit Suche, Filter, Sortierung und Paginierung
- Automatische Kundennummer-Vergabe (Format: `KD-{JJJJ}-{LAUFNR}`)
- Duplikat-Erkennung beim Anlegen
- Kachelbasierte Kundenakte mit verschiebbaren/vergroesserbaren Kacheln
- Inline-Editing aller Felder in der Sidebar
- Favoriten-System (pro Benutzer)
- Letzte-Kunden-Verlauf
- Aktivitaets-Timeline
- Bulk-Aktionen (Status, Kategorie, Löschen)
- Admin-konfigurierbare Custom-Felder pro Mandant
- GlobalSearch Integration
- Dashboard-Tiles (KPI-Übersicht + Letzte Kunden)

## Berechtigungen

| Permission | Beschreibung |
|---|---|
| `crm.view` | Kunden anzeigen |
| `crm.create` | Kunden anlegen |
| `crm.edit` | Kunden bearbeiten |
| `crm.delete` | Kunden löschen |
| `crm.tickets.view` | Tickets anzeigen |
| `crm.tickets.create` | Tickets anlegen |
| `crm.tickets.edit` | Tickets bearbeiten |
| `crm.tickets.delete` | Tickets löschen |
| `crm.contacts.view` | Kontakte anzeigen |
| `crm.contacts.edit` | Kontakte bearbeiten |
| `crm.notes.view` | Notizen anzeigen |
| `crm.notes.edit` | Notizen bearbeiten |
| `crm.manage` | Admin-Einstellungen (Custom-Felder) |

---

## API-Dokumentation

Basis-Pfad: `/api/plugins/crm`

Alle Endpoints erfordern Authentifizierung. Mandanten-Isolation ist automatisch.

---

### Kunden (`/customers`)

#### `GET /customers/`

Kundenliste mit Paginierung und Filter.

**Query-Parameter:**

| Parameter | Typ | Default | Beschreibung |
|---|---|---|---|
| `page` | number | 1 | Seitennummer |
| `pageSize` | number | 25 | Einträge pro Seite (max. 100) |
| `search` | string | — | Freitextsuche (Name, Nr., E-Mail, Telefon, Ort) |
| `status` | string | — | `active`, `inactive`, `prospect` |
| `type` | string | — | `company`, `person` |
| `category` | string | — | Kategorie-Filter |
| `sortBy` | string | `created_at` | Sortierfeld |
| `sortOrder` | string | `desc` | `asc` oder `desc` |

**Response:**

```json
{
    "items": [
        {
            "id": 1,
            "customer_number": "KD-2026-0001",
            "type": "company",
            "company_name": "Beispiel GmbH",
            "first_name": null,
            "last_name": null,
            "display_name": "Beispiel GmbH",
            "email": "info@beispiel.de",
            "phone": "+49 89 123456",
            "city": "Muenchen",
            "status": "active",
            "category": "A-Kunde",
            "created_at": "2026-03-31T10:00:00.000Z"
        }
    ],
    "pagination": {
        "page": 1,
        "pageSize": 25,
        "total": 42,
        "totalPages": 2
    }
}
```

#### `GET /customers/:id`

Einzelner Kunde mit allen Feldern.

#### `GET /customers/:id/summary`

Aggregierte Daten für Sidebar (Ticket-Count, Kontakte, letzte Aktivitaet).

```json
{
    "tickets_open": 3,
    "tickets_total": 12,
    "contacts_count": 5,
    "notes_count": 8,
    "last_activity": "2026-03-30T14:00:00.000Z",
    "days_since_contact": 1
}
```

#### `POST /customers/`

Neuen Kunden anlegen. Kundennummer wird automatisch vergeben.

**Body:**

```json
{
    "type": "company",
    "company_name": "Neue Firma GmbH",
    "email": "kontakt@neuefirma.de",
    "phone": "+49 89 999999",
    "street": "Teststrasse 1",
    "zip": "80331",
    "city": "Muenchen",
    "country": "Deutschland",
    "status": "active",
    "category": "Neukunde",
    "custom_fields": {
        "branche_detail": "IT-Dienstleistungen"
    }
}
```

**Required (Firma):** `company_name`
**Required (Person):** `last_name`

#### `PUT /customers/:id`

Vollständiges Update aller Felder.

#### `PATCH /customers/:id`

Einzelfeld-Update (Inline-Edit). Body enthält nur das zu ändernde Feld.

```json
{ "phone": "+49 89 111111" }
```

#### `DELETE /customers/:id`

Kunde unwiderruflich löschen (Hard-Delete). Erfordert `crm.delete`.

#### `GET /customers/categories`

Alle verwendeten Kategorien.

```json
{ "categories": ["A-Kunde", "B-Kunde", "Interessent"] }
```

#### `GET /customers/number/next`

Vorschau der nächsten Kundennummer.

```json
{ "nextNumber": "KD-2026-0014" }
```

#### `POST /customers/check-duplicates`

Prüfung auf moegliche Duplikate vor dem Anlegen.

**Body:** Gleiche Felder wie POST.

**Response:**

```json
{
    "duplicates": [
        {
            "id": 5,
            "customer_number": "KD-2026-0003",
            "display_name": "Beispiel GmbH",
            "city": "Muenchen",
            "match_reason": "E-Mail-Adresse stimmt überein",
            "confidence": "high"
        }
    ]
}
```

#### `GET /customers/search`

GlobalSearch-Endpoint.

**Query:** `?q=suchtext` (min. 2 Zeichen)

```json
{
    "results": [
        {
            "id": 1,
            "customer_number": "KD-2026-0001",
            "display_name": "Beispiel GmbH",
            "email": "info@beispiel.de",
            "type": "company",
            "status": "active"
        }
    ]
}
```

---

### Bulk-Aktionen (`/customers/bulk`)

#### `PATCH /customers/bulk/status`

Status für mehrere Kunden ändern (max. 100).

```json
{ "ids": [1, 2, 3], "status": "inactive" }
```

#### `PATCH /customers/bulk/category`

Kategorie für mehrere Kunden ändern.

```json
{ "ids": [1, 2, 3], "category": "B-Kunde" }
```

#### `DELETE /customers/bulk`

Mehrere Kunden unwiderruflich löschen (max. 100).

```json
{ "ids": [1, 2, 3] }
```

---

### Layout & Benutzer (`/layout`)

#### `GET /layout/`

Gespeichertes Kachel-Layout des aktuellen Benutzers.

#### `PUT /layout/`

Kachel-Layout speichern.

```json
{
    "layout": {
        "crm.activity-timeline": { "x": 0, "y": 0, "w": 24, "h": 12, "visible": true },
        "crm.placeholder-tickets": { "x": 24, "y": 0, "w": 24, "h": 12, "visible": true }
    }
}
```

#### `GET /layout/recent`

Letzte 10 geöffnete Kunden.

#### `POST /layout/recent/:customerId`

Kunden als geöffnet markieren.

#### `GET /layout/favorites`

Favoriten des aktuellen Benutzers.

#### `POST /layout/favorites/:customerId`

Favorit hinzufuegen.

#### `DELETE /layout/favorites/:customerId`

Favorit entfernen.

#### `GET /layout/activities/:customerId`

Aktivitaets-Timeline eines Kunden.

**Query:** `?limit=20` (max. 50)

```json
{
    "activities": [
        {
            "id": 1,
            "type": "customer.created",
            "title": "Kunde KD-2026-0001 erstellt",
            "created_by_name": "Admin",
            "created_at": "2026-03-31T10:00:00.000Z",
            "metadata": null
        }
    ]
}
```

---

### Admin-Einstellungen (`/settings`)

#### `GET /settings/custom-fields`

Custom-Feld-Definitionen.

**Query:** `?entity_type=customer` (oder `ticket`, `contact`)

#### `POST /settings/custom-fields`

Neues Custom-Feld erstellen. Erfordert `crm.manage`.

```json
{
    "label": "Branche Detail",
    "field_type": "text",
    "required": false,
    "entity_type": "customer"
}
```

Unterstuetzte Feldtypen: `text`, `number`, `date`, `select`, `checkbox`, `textarea`

Fuer `select`-Felder:
```json
{
    "label": "Prioritaet",
    "field_type": "select",
    "options": ["Niedrig", "Mittel", "Hoch"],
    "entity_type": "ticket"
}
```

#### `PUT /settings/custom-fields/:id`

Custom-Feld aktualisieren.

#### `DELETE /settings/custom-fields/:id`

Custom-Feld löschen.

---

### Statistiken (`/stats`)

#### `GET /stats/`

KPI-Daten für Dashboard-Tile.

```json
{
    "customers_total": 142,
    "customers_active": 120,
    "customers_inactive": 10,
    "customers_prospect": 12,
    "customers_new_month": 8,
    "last_customer_created": "2026-03-30T15:30:00.000Z",
    "tickets_open": 0,
    "tickets_due_soon": 0
}
```

---

## Extension-API für andere Plugins

Andere Plugins können eigene Kacheln in die Kundenakte injizieren:

```typescript
// In plugin frontend/index.tsx
export const extensionTiles: PluginExtensionTile[] = [
    {
        id: 'dms-documents',
        targetSlot: 'crm.customer-record',
        title: 'Dokumente',
        description: 'DMS-Dokumente dieses Kunden',
        component: lazy(() => import('./tiles/CustomerDocumentsTile')),
        permission: 'dms.view',
        order: 50,
    },
];
```

Die injizierte Komponente erhaelt als Props:
- `customerId: number` — ID des aktuellen Kunden
- `customerNumber: string` — Kundennummer
- `tenantId: number` — Mandanten-ID

---

## Datenbank-Tabellen

| Tabelle | Beschreibung |
|---|---|
| `crm_customers` | Kunden-Stammdaten |
| `crm_custom_field_definitions` | Admin-konfigurierbare Zusatzfelder |
| `crm_customer_layouts` | Kachel-Layout pro Benutzer |
| `crm_recent_customers` | Zuletzt geöffnete Kunden |
| `crm_favorites` | Favorisierte Kunden pro Benutzer |
| `crm_activities` | Aktivitaets-Timeline |

---

## Roadmap

- **Phase 2:** Ticketsystem (CRUD, Kategorien, Zuweisungen)
- **Phase 3:** Kontakte, Notizen (TipTap WYSIWYG)
- **Phase 4:** CSV-Import, PDF-Export
