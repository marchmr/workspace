import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../context/AuthContext';

type BindingMode = 'local' | 'external';
type ExplorerScope = 'local' | 'external';

type PreviewKind = 'pdf' | 'image' | 'text' | 'none';

interface DirectoryStatus {
    exists: boolean;
    readable: boolean;
}

interface ExternalDirectory extends DirectoryStatus {
    id: string;
    name: string;
    path: string;
    isActive: boolean;
}

interface StorageBinding {
    mode: BindingMode;
    externalDirectoryId: string | null;
}

interface StorageResponse {
    storageProvider: string;
    localDirectory: {
        name: string;
        path: string;
        isActive: boolean;
    } & DirectoryStatus;
    binding: StorageBinding;
    externalDirectories: ExternalDirectory[];
    note?: string;
}

interface ExplorerRoot {
    scope: ExplorerScope;
    id: string | null;
    name: string;
    path: string;
}

interface ExplorerEntry {
    name: string;
    kind: 'directory' | 'file';
    path: string;
    sizeBytes: number | null;
    modifiedAt: string;
    mimeType: string | null;
    previewKind: PreviewKind;
}

interface ExplorerResponse {
    root: ExplorerRoot;
    currentPath: string;
    parentPath: string | null;
    entries: ExplorerEntry[];
}

const iconProps = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
};

function formatFileSize(size: number | null): string {
    if (size === null) return '-';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('de-DE');
}

export default function DocumentManagement() {
    const [data, setData] = useState<StorageResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const [editingId, setEditingId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [directoryPath, setDirectoryPath] = useState('');
    const [isActive, setIsActive] = useState(true);

    const [bindingModalOpen, setBindingModalOpen] = useState(false);
    const [bindingMode, setBindingMode] = useState<BindingMode>('local');
    const [bindingExternalDirectoryId, setBindingExternalDirectoryId] = useState<string>('');
    const [bindingSaving, setBindingSaving] = useState(false);
    const [bindingError, setBindingError] = useState('');

    const [explorerModalOpen, setExplorerModalOpen] = useState(false);
    const [explorerRoot, setExplorerRoot] = useState<ExplorerRoot | null>(null);
    const [explorerEntries, setExplorerEntries] = useState<ExplorerEntry[]>([]);
    const [explorerPath, setExplorerPath] = useState('');
    const [explorerParentPath, setExplorerParentPath] = useState<string | null>(null);
    const [explorerLoading, setExplorerLoading] = useState(false);
    const [explorerError, setExplorerError] = useState('');
    const [selectedFile, setSelectedFile] = useState<ExplorerEntry | null>(null);
    const [selectedTextPreview, setSelectedTextPreview] = useState('');
    const [textPreviewLoading, setTextPreviewLoading] = useState(false);

    const externalSorted = useMemo(
        () => [...(data?.externalDirectories || [])].sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })),
        [data]
    );

    useEffect(() => {
        void loadStorage();
    }, []);

    const loadStorage = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch('/api/admin/documents/storage');
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Daten konnten nicht geladen werden');
            }
            setData(payload as StorageResponse);
        } catch (err: any) {
            setError(err?.message || 'Daten konnten nicht geladen werden');
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setEditingId(null);
        setName('');
        setDirectoryPath('');
        setIsActive(true);
    };

    const persistDirectories = async (nextList: ExternalDirectory[]) => {
        setSaving(true);
        setError('');
        setNotice('');
        try {
            const payload = nextList.map((entry) => ({
                id: entry.id,
                name: entry.name,
                path: entry.path,
                isActive: entry.isActive,
            }));

            const res = await apiFetch('/api/admin/documents/storage', {
                method: 'PUT',
                body: JSON.stringify({ externalDirectories: payload }),
            });
            const response = await res.json();
            if (!res.ok) {
                throw new Error(response.error || 'Speichern fehlgeschlagen');
            }

            setNotice('Externe Verzeichnisse wurden gespeichert.');
            await loadStorage();
            resetForm();
        } catch (err: any) {
            setError(err?.message || 'Speichern fehlgeschlagen');
        } finally {
            setSaving(false);
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!data) return;

        const normalizedName = name.trim();
        const normalizedPath = directoryPath.trim();
        if (!normalizedName || !normalizedPath) {
            setError('Name und Pfad sind erforderlich.');
            return;
        }

        const existsDuplicatePath = data.externalDirectories.some((entry) =>
            entry.id !== editingId && entry.path.trim().toLowerCase() === normalizedPath.toLowerCase()
        );
        if (existsDuplicatePath) {
            setError('Dieser Pfad ist bereits vorhanden.');
            return;
        }

        const updatedEntries = editingId
            ? data.externalDirectories.map((entry) =>
                entry.id === editingId
                    ? { ...entry, name: normalizedName, path: normalizedPath, isActive }
                    : entry
            )
            : [
                ...data.externalDirectories,
                {
                    id: `ext-${Date.now()}`,
                    name: normalizedName,
                    path: normalizedPath,
                    isActive,
                    exists: false,
                    readable: false,
                },
            ];

        await persistDirectories(updatedEntries);
    };

    const startEdit = (entry: ExternalDirectory) => {
        setEditingId(entry.id);
        setName(entry.name);
        setDirectoryPath(entry.path);
        setIsActive(entry.isActive);
        setError('');
        setNotice('');
    };

    const deleteEntry = async (id: string) => {
        if (!data) return;
        const nextList = data.externalDirectories.filter((entry) => entry.id !== id);
        await persistDirectories(nextList);
    };

    const toggleEntry = async (id: string) => {
        if (!data) return;
        const nextList = data.externalDirectories.map((entry) =>
            entry.id === id ? { ...entry, isActive: !entry.isActive } : entry
        );
        await persistDirectories(nextList);
    };

    const openBindingModal = () => {
        if (!data) return;
        setBindingMode(data.binding?.mode || 'local');
        setBindingExternalDirectoryId(data.binding?.externalDirectoryId || '');
        setBindingError('');
        setBindingModalOpen(true);
    };

    const saveBinding = async () => {
        if (!data) return;
        if (bindingMode === 'external' && !bindingExternalDirectoryId) {
            setBindingError('Bitte ein externes Verzeichnis auswählen.');
            return;
        }

        setBindingSaving(true);
        setBindingError('');
        setError('');
        setNotice('');

        try {
            const res = await apiFetch('/api/admin/documents/storage/binding', {
                method: 'PUT',
                body: JSON.stringify({
                    mode: bindingMode,
                    externalDirectoryId: bindingMode === 'external' ? bindingExternalDirectoryId : null,
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Anbindung konnte nicht gespeichert werden');
            }

            setNotice('Anbindung wurde gespeichert.');
            setBindingModalOpen(false);
            await loadStorage();
        } catch (err: any) {
            setBindingError(err?.message || 'Anbindung konnte nicht gespeichert werden');
        } finally {
            setBindingSaving(false);
        }
    };

    const openExplorer = async (scope: ExplorerScope, id: string | null) => {
        setExplorerModalOpen(true);
        setExplorerRoot(null);
        setExplorerEntries([]);
        setExplorerPath('');
        setExplorerParentPath(null);
        setExplorerError('');
        setSelectedFile(null);
        setSelectedTextPreview('');

        await loadExplorer(scope, id, '');
    };

    const loadExplorer = async (scope: ExplorerScope, id: string | null, targetPath: string) => {
        setExplorerLoading(true);
        setExplorerError('');
        setSelectedFile(null);
        setSelectedTextPreview('');

        try {
            const params = new URLSearchParams();
            params.set('scope', scope);
            if (id) params.set('id', id);
            if (targetPath) params.set('path', targetPath);

            const res = await apiFetch(`/api/admin/documents/storage/explorer?${params.toString()}`);
            const payload = await res.json() as ExplorerResponse | { error?: string };
            if (!res.ok) {
                throw new Error((payload as { error?: string }).error || 'Explorer konnte nicht geladen werden');
            }

            const response = payload as ExplorerResponse;
            setExplorerRoot(response.root);
            setExplorerEntries(response.entries);
            setExplorerPath(response.currentPath || '');
            setExplorerParentPath(response.parentPath);
        } catch (err: any) {
            setExplorerError(err?.message || 'Explorer konnte nicht geladen werden');
        } finally {
            setExplorerLoading(false);
        }
    };

    const buildExplorerFileUrl = (entryPath: string, download: boolean = false): string => {
        if (!explorerRoot) return '#';
        const params = new URLSearchParams();
        params.set('scope', explorerRoot.scope);
        if (explorerRoot.id) params.set('id', explorerRoot.id);
        params.set('path', entryPath);
        if (download) params.set('download', '1');
        return `/api/admin/documents/storage/explorer/file?${params.toString()}`;
    };

    const selectFile = async (entry: ExplorerEntry) => {
        setSelectedFile(entry);
        setSelectedTextPreview('');

        if (entry.kind !== 'file' || entry.previewKind !== 'text') {
            return;
        }

        if (!entry.sizeBytes || entry.sizeBytes > 1024 * 1024) {
            setSelectedTextPreview('Datei ist zu groß für die Textvorschau (max. 1 MB).');
            return;
        }

        setTextPreviewLoading(true);
        try {
            const res = await apiFetch(buildExplorerFileUrl(entry.path));
            if (!res.ok) {
                setSelectedTextPreview('Textvorschau konnte nicht geladen werden.');
                return;
            }
            const text = await res.text();
            setSelectedTextPreview(text);
        } catch {
            setSelectedTextPreview('Textvorschau konnte nicht geladen werden.');
        } finally {
            setTextPreviewLoading(false);
        }
    };

    if (loading) {
        return <div className="text-muted">Dokumentenverwaltung wird geladen...</div>;
    }

    const activeBindingLabel = data?.binding.mode === 'external'
        ? `Externes Verzeichnis${data.binding.externalDirectoryId ? ` (${data.binding.externalDirectoryId})` : ''}`
        : 'Lokal';

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Dokumentenverwaltung</h1>
                <p className="page-subtitle">Angebundene Dokumentenordner anzeigen und externe Verzeichnisse vorbereiten</p>
            </div>

            {error && (
                <div className="modal-alert error" style={{ marginBottom: 'var(--space-md)' }}>
                    {error}
                </div>
            )}
            {notice && (
                <div className="modal-alert" style={{ marginBottom: 'var(--space-md)' }}>
                    {notice}
                </div>
            )}

            <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                <div className="card-header" style={{ marginBottom: 0 }}>
                    <div className="card-title">Aktive Speicheranbindung</div>
                    <button className="btn btn-secondary btn-sm icon-only-btn" onClick={openBindingModal} title="Anbindung bearbeiten" aria-label="Anbindung bearbeiten">
                        <svg {...iconProps}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                    </button>
                </div>
                {data && (
                    <>
                        <p className="text-muted mt-md" style={{ fontSize: 'var(--font-size-sm)' }}>
                            Storage-Provider: <strong>{data.storageProvider}</strong> · Bindung: <strong>{activeBindingLabel}</strong>
                        </p>
                        <div className="table-container mt-md">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Ordner</th>
                                        <th>Pfad</th>
                                        <th>Status</th>
                                        <th>Lesbar</th>
                                        <th>Aktionen</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>{data.localDirectory.name}</td>
                                        <td><code>{data.localDirectory.path}</code></td>
                                        <td>
                                            <span className={`badge ${data.localDirectory.exists ? 'badge-success' : 'badge-danger'}`}>
                                                {data.localDirectory.exists ? 'Verfügbar' : 'Nicht gefunden'}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`badge ${data.localDirectory.readable ? 'badge-success' : 'badge-warning'}`}>
                                                {data.localDirectory.readable ? 'Ja' : 'Nein'}
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                                                <button
                                                    className="btn btn-secondary btn-sm icon-only-btn"
                                                    onClick={() => void openExplorer('local', null)}
                                                    title="Datei-Explorer öffnen"
                                                    aria-label="Datei-Explorer öffnen"
                                                >
                                                    <svg {...iconProps}><path d="M3 7h5l2 2h11v9a2 2 0 01-2 2H3a2 2 0 01-2-2V9a2 2 0 012-2z" /></svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>

            <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                <div className="card-title">Externe Verzeichnisse (vorbereitet)</div>
                <p className="text-muted mt-md" style={{ fontSize: 'var(--font-size-sm)' }}>
                    Diese Einträge werden zentral gespeichert. Die aktive Nutzung erfolgt mit einem zukünftigen Storage-Adapter.
                </p>
                {data?.note && (
                    <p className="text-muted mt-md" style={{ fontSize: 'var(--font-size-xs)' }}>
                        {data.note}
                    </p>
                )}

                <form onSubmit={handleSubmit} className="mt-md">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto auto', gap: 'var(--space-sm)', alignItems: 'end' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Name</label>
                            <input
                                className="form-input"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                placeholder="z. B. DMS-Archiv"
                                disabled={saving}
                                required
                            />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">Pfad</label>
                            <input
                                className="form-input"
                                value={directoryPath}
                                onChange={(event) => setDirectoryPath(event.target.value)}
                                placeholder="z. B. /mnt/dms-archiv"
                                disabled={saving}
                                required
                            />
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', fontSize: 'var(--font-size-sm)' }}>
                            <input
                                type="checkbox"
                                checked={isActive}
                                onChange={(event) => setIsActive(event.target.checked)}
                                disabled={saving}
                            />
                            Aktiv
                        </label>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                            <button className="btn btn-primary" type="submit" disabled={saving}>
                                {editingId ? 'Aktualisieren' : 'Hinzufügen'}
                            </button>
                            {editingId && (
                                <button className="btn btn-secondary" type="button" onClick={resetForm} disabled={saving}>
                                    Abbrechen
                                </button>
                            )}
                        </div>
                    </div>
                </form>

                <div className="table-container mt-md">
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Pfad</th>
                                <th>Aktiv</th>
                                <th>Status</th>
                                <th>Aktionen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {externalSorted.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-muted">Keine externen Verzeichnisse hinterlegt.</td>
                                </tr>
                            ) : (
                                externalSorted.map((entry) => (
                                    <tr key={entry.id}>
                                        <td>{entry.name}</td>
                                        <td><code>{entry.path}</code></td>
                                        <td>
                                            <span className={`badge ${entry.isActive ? 'badge-success' : 'badge-warning'}`}>
                                                {entry.isActive ? 'Ja' : 'Nein'}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`badge ${entry.exists ? 'badge-success' : 'badge-warning'}`}>
                                                {entry.exists ? 'Verfügbar' : 'Nicht erreichbar'}
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                                                <button
                                                    className="btn btn-secondary btn-sm icon-only-btn"
                                                    onClick={() => void openExplorer('external', entry.id)}
                                                    disabled={saving}
                                                    title="Datei-Explorer öffnen"
                                                    aria-label="Datei-Explorer öffnen"
                                                >
                                                    <svg {...iconProps}><path d="M3 7h5l2 2h11v9a2 2 0 01-2 2H3a2 2 0 01-2-2V9a2 2 0 012-2z" /></svg>
                                                </button>
                                                <button className="btn btn-secondary btn-sm" onClick={() => startEdit(entry)} disabled={saving}>Bearbeiten</button>
                                                <button className="btn btn-secondary btn-sm" onClick={() => toggleEntry(entry.id)} disabled={saving}>
                                                    {entry.isActive ? 'Deaktivieren' : 'Aktivieren'}
                                                </button>
                                                <button className="btn btn-danger btn-sm" onClick={() => deleteEntry(entry.id)} disabled={saving}>Löschen</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {bindingModalOpen && data && (
                <div className="modal-overlay" onClick={() => !bindingSaving && setBindingModalOpen(false)}>
                    <div className="modal-card user-edit-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Anbindung bearbeiten</h2>
                            <button className="modal-close" onClick={() => setBindingModalOpen(false)} disabled={bindingSaving} aria-label="Schließen">×</button>
                        </div>

                        {bindingError && <div className="modal-alert error">{bindingError}</div>}

                        <div className="modal-grid">
                            <div className="form-group">
                                <label className="form-label">Storage-Provider</label>
                                <input className="form-input" value={data.storageProvider} disabled />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Anbindungsmodus</label>
                                <select
                                    className="form-input"
                                    value={bindingMode}
                                    onChange={(event) => setBindingMode(event.target.value === 'external' ? 'external' : 'local')}
                                    disabled={bindingSaving}
                                >
                                    <option value="local">Lokal</option>
                                    <option value="external">Externes Verzeichnis</option>
                                </select>
                            </div>

                            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                <label className="form-label">Lokaler Pfad</label>
                                <input className="form-input" value={data.localDirectory.path} disabled />
                            </div>

                            {bindingMode === 'external' && (
                                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                    <label className="form-label">Externes Verzeichnis</label>
                                    <select
                                        className="form-input"
                                        value={bindingExternalDirectoryId}
                                        onChange={(event) => setBindingExternalDirectoryId(event.target.value)}
                                        disabled={bindingSaving}
                                    >
                                        <option value="">Bitte wählen</option>
                                        {externalSorted.map((entry) => (
                                            <option key={entry.id} value={entry.id}>{entry.name} ({entry.path})</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        <p className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                            Hinweis: Der externe Modus wird bereits gespeichert und für zukünftige Storage-Adapter vorbereitet.
                        </p>

                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setBindingModalOpen(false)} disabled={bindingSaving}>Abbrechen</button>
                            <button className="btn btn-primary" onClick={saveBinding} disabled={bindingSaving}>
                                {bindingSaving ? 'Speichern...' : 'Speichern'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {explorerModalOpen && (
                <div className="modal-overlay" onClick={() => !explorerLoading && setExplorerModalOpen(false)}>
                    <div className="modal-card" style={{ width: 'min(1240px, 100%)' }} onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Datei-Explorer {explorerRoot ? `· ${explorerRoot.name}` : ''}</h2>
                            <button className="modal-close" onClick={() => setExplorerModalOpen(false)} aria-label="Schließen">×</button>
                        </div>

                        {explorerError && <div className="modal-alert error">{explorerError}</div>}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                            <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                                Pfad: <code>{explorerPath || '/'}</code>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => explorerRoot && void loadExplorer(explorerRoot.scope, explorerRoot.id, explorerParentPath || '')}
                                    disabled={!explorerRoot || explorerParentPath === null || explorerLoading}
                                >
                                    Eine Ebene hoch
                                </button>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => explorerRoot && void loadExplorer(explorerRoot.scope, explorerRoot.id, explorerPath)}
                                    disabled={!explorerRoot || explorerLoading}
                                >
                                    Aktualisieren
                                </button>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 'var(--space-md)' }}>
                            <div className="table-container">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Typ</th>
                                            <th>Größe</th>
                                            <th>Geändert</th>
                                            <th>Aktion</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {explorerLoading ? (
                                            <tr>
                                                <td colSpan={5} className="text-muted">Explorer lädt...</td>
                                            </tr>
                                        ) : explorerEntries.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="text-muted">Dieses Verzeichnis ist leer.</td>
                                            </tr>
                                        ) : (
                                            explorerEntries.map((entry) => (
                                                <tr key={entry.path}>
                                                    <td>{entry.name}</td>
                                                    <td>{entry.kind === 'directory' ? 'Ordner' : 'Datei'}</td>
                                                    <td>{formatFileSize(entry.sizeBytes)}</td>
                                                    <td>{formatDate(entry.modifiedAt)}</td>
                                                    <td>
                                                        {entry.kind === 'directory' ? (
                                                            <button
                                                                className="btn btn-secondary btn-sm"
                                                                onClick={() => explorerRoot && void loadExplorer(explorerRoot.scope, explorerRoot.id, entry.path)}
                                                            >
                                                                Öffnen
                                                            </button>
                                                        ) : (
                                                            <button
                                                                className="btn btn-secondary btn-sm"
                                                                onClick={() => void selectFile(entry)}
                                                            >
                                                                Vorschau
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div className="card" style={{ minHeight: 420 }}>
                                <div className="card-title" style={{ marginBottom: 'var(--space-sm)' }}>Vorschau</div>

                                {!selectedFile && (
                                    <p className="text-muted">Wähle eine Datei für die Vorschau aus.</p>
                                )}

                                {selectedFile && (
                                    <>
                                        <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-sm)' }}>
                                            <strong>{selectedFile.name}</strong> · {formatFileSize(selectedFile.sizeBytes)}
                                        </p>

                                        {selectedFile.previewKind === 'pdf' && (
                                            <iframe
                                                title={selectedFile.name}
                                                src={buildExplorerFileUrl(selectedFile.path)}
                                                style={{ width: '100%', height: 360, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}
                                            />
                                        )}

                                        {selectedFile.previewKind === 'image' && (
                                            <img
                                                src={buildExplorerFileUrl(selectedFile.path)}
                                                alt={selectedFile.name}
                                                style={{ width: '100%', maxHeight: 360, objectFit: 'contain', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: '#fff' }}
                                            />
                                        )}

                                        {selectedFile.previewKind === 'text' && (
                                            <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: '#fff', padding: 'var(--space-sm)', height: 360, overflow: 'auto' }}>
                                                {textPreviewLoading ? (
                                                    <p className="text-muted">Textvorschau wird geladen...</p>
                                                ) : (
                                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 'var(--font-size-xs)' }}>{selectedTextPreview}</pre>
                                                )}
                                            </div>
                                        )}

                                        {selectedFile.previewKind === 'none' && (
                                            <p className="text-muted">Für diesen Dateityp ist keine direkte Vorschau verfügbar.</p>
                                        )}

                                        <div className="mt-md">
                                            <a href={buildExplorerFileUrl(selectedFile.path, true)} className="btn btn-secondary" target="_blank" rel="noreferrer">
                                                Datei herunterladen
                                            </a>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
