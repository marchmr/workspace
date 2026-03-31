# Branching & Release Workflow

## Übersicht

```
experimental  →  dev  →  main
 (Commits)    (Pre-Releases)  (Stable Releases)
```

| Branch | Zweck | Server erkennt |
|---|---|---|
| **experimental** | Tägliche Entwicklung | Neuer Commit auf GitHub |
| **dev** | Feature-Tests | Neues Pre-Release auf GitHub |
| **main** | Produktiv | Neues Release auf GitHub |

---

## 1. Tägliche Entwicklung (experimental)

```bash
git checkout experimental
git add -A
git commit -m "feat: Beschreibung"
git push WorkSpace experimental
```

Server erkennt jeden neuen Commit automatisch.

---

## 2. Promote zu Dev (Pre-Release)

### Schritt 1: Merge

```bash
git checkout dev
git merge experimental
git push WorkSpace dev
git checkout experimental
```

**Alternativ als Squash** (alle Commits zu einem):

```bash
git checkout dev
git merge --squash experimental
git commit -m "v1.19.0-dev.1: Feature XYZ"
git push WorkSpace dev
git checkout experimental
```

### Schritt 2: GitHub Pre-Release erstellen

1. Öffne https://github.com/marchmr/workspace/releases/new
2. **Target branch**: `dev`
3. **Tag**: z.B. `v1.19.0-dev.1` → "Create new tag on publish"
4. **Title**: `v1.19.0-dev.1 - Kurzbeschreibung`
5. **Description**: Changelog einfügen
6. **Checkbox "Set as a pre-release" AKTIVIEREN**
7. Publish

---

## 3. Promote zu Main (Stable Release)

### Schritt 1: Merge

```bash
git checkout main
git merge dev
git push WorkSpace main
git checkout experimental
```

### Schritt 2: GitHub Release erstellen

1. Öffne https://github.com/marchmr/workspace/releases/new
2. **Target branch**: `main`
3. **Tag**: z.B. `v1.19.0` → "Create new tag on publish"
4. **Title**: `v1.19.0 - Kurzbeschreibung`
5. **Description**: Changelog einfügen
6. **Checkbox "Set as a pre-release" NICHT aktivieren**
7. Publish

---

## Server-Update ausführen

Per SSH auf dem Server:

```bash
# Stabiler Branch
sudo bash /opt/mike-workspace/update.sh --branch main

# Entwicklungs-Branch
sudo bash /opt/mike-workspace/update.sh --branch dev

# Experimenteller Branch
sudo bash /opt/mike-workspace/update.sh --branch experimental
```

Vor jedem Update wird automatisch ein Backup erstellt.

---

## Backup & Restore

| Branch | Max. Backups | Pfad |
|---|---|---|
| main | 5 | `/opt/mike-workspace/backups/pre-update/main/` |
| dev | 5 | `/opt/mike-workspace/backups/pre-update/dev/` |
| experimental | 10 | `/opt/mike-workspace/backups/pre-update/experimental/` |

```bash
# Alle Backups anzeigen
sudo bash /opt/mike-workspace/restore.sh

# Bestimmtes Backup wiederherstellen
sudo bash /opt/mike-workspace/restore.sh /pfad/zur/backup.zip
```

---

## Versionsnummern

| Branch | Format | Beispiel |
|---|---|---|
| experimental | Keine Version nötig | Commit-basiert |
| dev | `X.Y.Z-dev.N` | `1.19.0-dev.1` |
| main | `X.Y.Z` | `1.19.0` |

---

## Kurzfassung

```
1. Entwickeln auf experimental → committen → pushen
2. Feature fertig? → experimental in dev mergen → Pre-Release auf GitHub
3. Alles stabil? → dev in main mergen → Release auf GitHub
4. Server updaten per SSH
```
