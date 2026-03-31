# Changelog & Versionsnummer — Bump-Anleitung

## Checkliste

| # | Datei | Was ändern |
|---|-------|------------|
| 1 | `backend/package.json` | `"version": "X.Y.Z"` (Zeile 3) |
| 2 | `backend/src/core/config.ts` | `resolveAppVersion('X.Y.Z')` |
| 3 | `backend/changelog.json` | Neuer Eintrag am Anfang des Arrays |
| 4 | `CHANGELOG.md` | Neuer Abschnitt am Anfang (für GitHub) |

**package.json hat höchste Priorität** — wenn dort die alte Version steht, ignoriert das System config.ts!

---

## Changelog-Format

### Typen (Übergeordnete Gruppierung)

| Typ | Prefix | Farbe | Verwendung |
|-----|--------|-------|------------|
| Neu | `[Neu]` | Grün | Neue Features, Endpunkte, Komponenten |
| Fix | `[Fix]` | Orange | Bugfixes, Korrekturen |
| Entfernt | `[Entfernt]` | Rot | Entfernte Features, deprecated Code |

### Kategorien (Farbige Tags)

| Kategorie | Prefix | Farbe |
|-----------|--------|-------|
| Security | `Security:` | Rot |
| UI/UX | `UI:` | Violett |
| Auth | `Auth:` | Cyan |
| API | `API:` | Blau |
| Admin | `Admin:` | Lila |
| Core | `Core:` | Grau |
| Locking | `Locking:` | Gelb |
| Plugin | `Plugin:` | Orange |
| Docs | `Docs:` | Grün |

### changelog.json Format

Jeder Eintrag: `"[Typ] Kategorie: Beschreibungstext"`

```json
{
  "version": "1.17.0",
  "date": "2026-03-29",
  "changes": [
    "[Neu] Core: Toast-Popup-Benachrichtigungen",
    "[Fix] UI: Umlaut-Standard durchgesetzt",
    "[Entfernt] Security: addHook Auth-Hooks entfernt"
  ]
}
```

### CHANGELOG.md Format (GitHub)

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Neu
#### Core
- Beschreibung

### Fix
#### UI
- Beschreibung

### Entfernt
#### Security
- Beschreibung
```

## Versionsschema

MAJOR.MINOR.PATCH — Major=Breaking, Minor=Features, Patch=Fixes

## Regeln

- Umlaute: ü, ö, ä. Niemals ue, oe, ae!
- Typ-Prefix Pflicht: [Neu], [Fix] oder [Entfernt]
- Kategorie Pflicht: Nach Typ immer Kategorie mit Doppelpunkt
- **Sortierung Pflicht**: Einträge innerhalb eines Typs nach Kategorie gruppieren! Nicht Core, API, Core, API — sondern alle Core zusammen, dann alle API zusammen usw.
- Empfohlene Kategorie-Reihenfolge: Core, API, UI, Admin, Security, Docs, Plugin
- Gilt auch für Plugins (gleiche Struktur)
