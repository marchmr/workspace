import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_SESSION_KEY = 'kundenportal.session';

type Entry = {
    id: string;
    name: string;
    mimeType: string;
    size: number | null;
    modifiedTime: string | null;
    isFolder: boolean;
};

type ListResponse = {
    provider?: 'google_drive' | 'sharepoint';
    entries: Entry[];
    folderName: string;
    baseFolderName?: string;
    currentPath?: string;
    uploadFolderName?: string;
};

function formatDate(value: string | null): string {
    if (!value) return '-';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatBytes(value: number | null): string {
    if (!Number.isFinite(value || NaN) || value === null) return '-';
    if (value < 1024) return `${value} B`;
    const kb = value / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
}

function isDateFolderName(name: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(name || '').trim());
}

function getTodayIsoDate(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function normalizeUploadErrorMessage(message: string): string {
    const raw = String(message || '').trim();
    if (!raw) return 'Upload fehlgeschlagen.';
    const lower = raw.toLowerCase();
    if (
        lower.includes('service accounts do not have storage quota') ||
        lower.includes('storagequotaexceeded')
    ) {
        return 'Google Drive blockiert Uploads für diesen Service-Account (kein eigenes Speicherkontingent). Bitte auf OAuth (persönliches Drive) wechseln oder Shared Drive konfigurieren.';
    }
    return raw;
}

function Icon({ path }: { path: string }) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="dtxd-icon">
            <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

const ICONS = {
    root: 'M3 12l9-8 9 8M5 10v10h14V10',
    up: 'M18 15l-6-6-6 6M12 9v11',
    refresh: 'M20 11a8 8 0 10.8 3.5M20 5v6h-6',
    upload: 'M12 16V6M8 10l4-4 4 4M4 18h16',
    download: 'M12 4v10M8 10l4 4 4-4M4 20h16',
    delete: 'M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12',
    folder: 'M3 7h7l2 2h9v10a2 2 0 01-2 2H5a2 2 0 01-2-2z',
    file: 'M7 3h7l5 5v13H7zM14 3v5h5',
    open: 'M15 9l6-6M16 3h5v5M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5',
};

export default function PublicGoogleDriveModule() {
    const sessionToken = useMemo(() => localStorage.getItem(STORAGE_SESSION_KEY) || '', []);
    const [entries, setEntries] = useState<Entry[]>([]);
    const [folderName, setFolderName] = useState('Kundenordner');
    const [baseFolderName, setBaseFolderName] = useState('Kundenordner');
    const [currentPath, setCurrentPath] = useState('');
    const [uploadFolderName, setUploadFolderName] = useState('');
    const [provider, setProvider] = useState<'google_drive' | 'sharepoint'>('google_drive');
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const pathParts = useMemo(
        () => String(currentPath || '').split('/').map((part) => part.trim()).filter(Boolean),
        [currentPath],
    );
    const todayIso = useMemo(() => getTodayIsoDate(), []);

    const openPath = useCallback((parts: string[]) => {
        setCurrentPath(parts.join('/'));
    }, []);

    const load = useCallback(async () => {
        if (!sessionToken) {
            setError('Session-Token fehlt.');
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (currentPath) params.set('folderPath', currentPath);
            const query = params.toString();
            const url = query
                ? `/api/plugins/dateiaustausch_drive/public/files?${query}`
                : '/api/plugins/dateiaustausch_drive/public/files';

            const res = await fetch(url, {
                headers: { 'x-public-session-token': sessionToken },
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Dateiliste konnte nicht geladen werden.');
            const data = payload as ListResponse;
            setProvider(data.provider === 'sharepoint' ? 'sharepoint' : 'google_drive');
            setEntries(Array.isArray(data.entries) ? data.entries : []);
            setFolderName(String(data.folderName || 'Kundenordner'));
            setBaseFolderName(String(data.baseFolderName || 'Kundenordner'));
            setCurrentPath(String(data.currentPath || ''));
            setUploadFolderName(String(data.uploadFolderName || ''));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Dateiliste konnte nicht geladen werden.');
        } finally {
            setLoading(false);
        }
    }, [sessionToken, currentPath]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        setSelectedIds(new Set());
    }, [currentPath, entries.length]);

    const visibleEntries = useMemo(() => {
        const needle = searchTerm.trim().toLowerCase();
        const filtered = needle
            ? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
            : entries;

        return [...filtered].sort((a, b) => {
            if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
            return a.name.localeCompare(b.name, 'de');
        });
    }, [entries, searchTerm]);

    const quickFolders = useMemo(
        () => visibleEntries.filter((entry) => entry.isFolder).slice(0, 10),
        [visibleEntries],
    );

    async function onUpload(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!sessionToken || selectedFiles.length === 0) return;

        setUploading(true);
        setUploadProgress(0);
        setError(null);
        setSuccess(null);
        try {
            const formData = new FormData();
            selectedFiles.forEach((file) => {
                formData.append('file', file, file.name);
            });
            const uploadRes = await fetch('/api/plugins/dateiaustausch_drive/public/files/upload', {
                method: 'POST',
                headers: {
                    'x-public-session-token': sessionToken,
                },
                body: formData,
            });
            const payload = await uploadRes.json().catch(() => ({}));
            if (!uploadRes.ok) throw new Error(payload?.error || 'Upload fehlgeschlagen.');
            setUploadProgress(100);

            setSelectedFiles([]);
            const uploadedCount = Number(payload?.uploadedCount || selectedFiles.length || 1);
            setSuccess(`${uploadedCount} Datei(en) erfolgreich hochgeladen.`);
            await load();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Upload fehlgeschlagen.';
            setError(normalizeUploadErrorMessage(msg));
        } finally {
            setUploadProgress(null);
            setUploading(false);
        }
    }

    async function download(fileId: string, fileName: string) {
        if (!sessionToken) return;
        const params = new URLSearchParams();
        if (currentPath) params.set('folderPath', currentPath);
        const query = params.toString();
        const url = query
            ? `/api/plugins/dateiaustausch_drive/public/files/${encodeURIComponent(fileId)}/download?${query}`
            : `/api/plugins/dateiaustausch_drive/public/files/${encodeURIComponent(fileId)}/download`;

        const res = await fetch(url, {
            headers: { 'x-public-session-token': sessionToken },
        });
        if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            setError(payload?.error || 'Download fehlgeschlagen.');
            return;
        }
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = fileName || 'download';
        a.click();
        URL.revokeObjectURL(objectUrl);
    }

    function toggleSelect(id: string) {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    function toggleSelectAll() {
        const visibleIds = visibleEntries.map((entry) => entry.id);
        setSelectedIds((prev) => {
            const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
            if (allSelected) return new Set();
            return new Set(visibleIds);
        });
    }

    async function deleteSelected() {
        if (!sessionToken || selectedIds.size === 0) return;
        setError(null);
        setSuccess(null);
        try {
            const params = new URLSearchParams();
            if (currentPath) params.set('folderPath', currentPath);
            const query = params.toString();
            const url = query
                ? `/api/plugins/dateiaustausch_drive/public/items/delete?${query}`
                : '/api/plugins/dateiaustausch_drive/public/items/delete';

            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-public-session-token': sessionToken,
                },
                body: JSON.stringify({ ids: Array.from(selectedIds) }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Löschen fehlgeschlagen.');
            const deletedCount = Number(payload?.deletedCount || 0);
            setSelectedIds(new Set());
            setSuccess(`${deletedCount} Eintrag/Einträge gelöscht.`);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
        }
    }

    const isConnectorNotConfigured = Boolean(error && /nicht\s+konfiguriert/i.test(error));

    return (
        <div className="card dtxd-shell">
            <div className="dtxd-header">
                <div>
                    <h2 className="section-title">Dateiaustausch Cloud</h2>
                    <p className="text-muted dtxd-subtitle">
                        <span className="dtxd-badge">{provider === 'sharepoint' ? 'SharePoint' : 'Google Drive'}</span>
                        <span>Aktueller Ordner: <strong>{folderName}</strong></span>
                        {uploadFolderName ? <span>Upload-Ziel heute: <strong>{baseFolderName}/{uploadFolderName}</strong></span> : null}
                    </p>
                </div>

                <form className="dtxd-upload-inline" onSubmit={onUpload}>
                    <label className="dtxd-upload-pick">
                        <Icon path={ICONS.upload} />
                        <span>Dateien auswählen</span>
                        <input
                            type="file"
                            multiple
                            onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
                            required
                        />
                    </label>
                    <button className="btn btn-primary" type="submit" disabled={uploading || selectedFiles.length === 0}>
                        {uploading ? 'Lädt hoch...' : 'Hochladen'}
                    </button>
                    {selectedFiles.length > 0 ? <span className="text-muted">{selectedFiles.length} Datei(en) gewählt</span> : null}
                </form>
            </div>

            <div className="dtxd-main">
                <aside className="dtxd-sidebar">
                    <div className="dtxd-side-title">Schnellzugriff</div>
                    <button className="dtxd-side-item" type="button" onClick={() => openPath([])}>
                        <Icon path={ICONS.root} />
                        <span>Root</span>
                    </button>
                    {quickFolders.map((entry) => (
                        <button
                            key={entry.id}
                            className="dtxd-side-item"
                            type="button"
                            onClick={() => openPath([...pathParts, entry.name])}
                        >
                            <Icon path={ICONS.folder} />
                            <span>{entry.name}</span>
                        </button>
                    ))}
                    {quickFolders.length === 0 ? <div className="dtxd-side-empty">Keine Ordner in dieser Ansicht.</div> : null}
                </aside>

                <section className="dtxd-content">
                    <div className="dtxd-breadcrumb-row">
                        <button className="dtxd-crumb" type="button" onClick={() => openPath([])}>Eigene Dateien</button>
                        {pathParts.map((part, index) => (
                            <button
                                key={`${part}-${index}`}
                                className="dtxd-crumb"
                                type="button"
                                onClick={() => openPath(pathParts.slice(0, index + 1))}
                            >
                                {part}
                            </button>
                        ))}
                    </div>

                    <div className="dtxd-controls">
                        <input
                            className="input dtxd-search"
                            type="search"
                            placeholder="Dateien oder Ordner suchen"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <div className="dtxd-actions">
                            <button
                                className="dtxd-icon-btn danger"
                                type="button"
                                onClick={deleteSelected}
                                disabled={selectedIds.size === 0}
                                title="Auswahl löschen"
                            >
                                <Icon path={ICONS.delete} />
                            </button>
                            <button className="dtxd-icon-btn" type="button" onClick={load} disabled={loading} title="Aktualisieren">
                                <Icon path={ICONS.refresh} />
                            </button>
                            <button
                                className="dtxd-icon-btn"
                                type="button"
                                onClick={() => openPath(pathParts.slice(0, -1))}
                                disabled={pathParts.length === 0}
                                title="Nach oben"
                            >
                                <Icon path={ICONS.up} />
                            </button>
                        </div>
                        <div className="dtxd-selection-count">{selectedIds.size} ausgewählt</div>
                    </div>

                    {isConnectorNotConfigured ? <div className="dtxd-info">Cloud-Connector ist noch nicht konfiguriert. Bitte in den Plugin-Einstellungen verbinden.</div> : null}
                    {error && !isConnectorNotConfigured ? <p className="text-danger">{error}</p> : null}
                    {success ? <p className="text-success">{success}</p> : null}
                    {uploadProgress !== null ? <p className="text-muted">Upload-Fortschritt: {uploadProgress}%</p> : null}

                    <div className="dtxd-table-wrap">
                        <table className="dtxd-table">
                            <thead>
                                <tr>
                                    <th>
                                        <input
                                            type="checkbox"
                                            checked={visibleEntries.length > 0 && visibleEntries.every((entry) => selectedIds.has(entry.id))}
                                            onChange={toggleSelectAll}
                                            aria-label="Alle auswählen"
                                        />
                                    </th>
                                    <th>Name</th>
                                    <th>Typ</th>
                                    <th>Größe</th>
                                    <th>Geändert</th>
                                    <th>Aktion</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan={6} className="text-muted">Lade Dateien...</td></tr>
                                ) : visibleEntries.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="dtxd-empty-state">
                                            <div className="dtxd-empty-title">Dieser Ordner ist leer</div>
                                            <div className="text-muted">Zieh Dateien hier hinein oder lade oben eine Datei hoch.</div>
                                        </td>
                                    </tr>
                                ) : visibleEntries.map((entry) => (
                                    <tr
                                        key={entry.id}
                                        className={entry.isFolder ? 'dtxd-row-folder' : undefined}
                                        onDoubleClick={() => {
                                            if (entry.isFolder) openPath([...pathParts, entry.name]);
                                        }}
                                    >
                                        <td>
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(entry.id)}
                                                onChange={() => toggleSelect(entry.id)}
                                                aria-label={`${entry.name} auswählen`}
                                            />
                                        </td>
                                        <td>
                                            <div className="dtxd-name-cell">
                                                <span className={`dtxd-type-icon ${entry.isFolder ? 'is-folder' : 'is-file'}`}>
                                                    <Icon path={entry.isFolder ? ICONS.folder : ICONS.file} />
                                                </span>
                                                <span>{entry.name}</span>
                                                {entry.isFolder && isDateFolderName(entry.name) && entry.name === todayIso ? (
                                                    <span className="dtxd-tag-today">Heute</span>
                                                ) : null}
                                            </div>
                                        </td>
                                        <td><span className="dtxd-pill">{entry.isFolder ? 'Ordner' : 'Datei'}</span></td>
                                        <td>{entry.isFolder ? '-' : formatBytes(entry.size)}</td>
                                        <td>{formatDate(entry.modifiedTime)}</td>
                                        <td>
                                            {entry.isFolder ? (
                                                <button
                                                    className="dtxd-inline-action"
                                                    type="button"
                                                    onClick={() => openPath([...pathParts, entry.name])}
                                                >
                                                    <Icon path={ICONS.open} />
                                                    <span>Öffnen</span>
                                                </button>
                                            ) : (
                                                <button className="dtxd-inline-action" type="button" onClick={() => download(entry.id, entry.name)}>
                                                    <Icon path={ICONS.download} />
                                                    <span>Download</span>
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
}
