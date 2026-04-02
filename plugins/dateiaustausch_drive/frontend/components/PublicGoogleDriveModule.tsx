import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_SESSION_KEY = 'kundenportal.session';
const API_BASE_PRIMARY = '/api/plugins/dateiaustausch_drive';
const API_BASE_FALLBACK = '/api/plugins/dateiaustausch';

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

function getExt(name: string): string {
    const dot = String(name || '').lastIndexOf('.');
    if (dot < 0) return '';
    return String(name || '').slice(dot).toLowerCase();
}

function isImageEntry(entry: Entry): boolean {
    if (String(entry.mimeType || '').toLowerCase().startsWith('image/')) return true;
    return new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']).has(getExt(entry.name));
}

function isPdfEntry(entry: Entry): boolean {
    if (String(entry.mimeType || '').toLowerCase().includes('pdf')) return true;
    return getExt(entry.name) === '.pdf';
}

function isPreviewableEntry(entry: Entry): boolean {
    return !entry.isFolder && (isImageEntry(entry) || isPdfEntry(entry));
}

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
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const loadRequestIdRef = useRef(0);
    const [entries, setEntries] = useState<Entry[]>([]);
    const [folderName, setFolderName] = useState('Kundenordner');
    const [baseFolderName, setBaseFolderName] = useState('Kundenordner');
    const [currentPath, setCurrentPath] = useState('');
    const [uploadFolderName, setUploadFolderName] = useState('');
    const [provider, setProvider] = useState<'google_drive' | 'sharepoint'>('google_drive');
    const [apiBase, setApiBase] = useState(API_BASE_PRIMARY);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [previewEntry, setPreviewEntry] = useState<Entry | null>(null);

    const pathParts = useMemo(
        () => String(currentPath || '').split('/').map((part) => part.trim()).filter(Boolean),
        [currentPath],
    );
    const todayIso = useMemo(() => getTodayIsoDate(), []);

    const openPath = useCallback((parts: string[]) => {
        setCurrentPath(parts.join('/'));
    }, []);

    const requestPluginApi = useCallback(async (pathName: string, init?: RequestInit): Promise<Response> => {
        const run = async (base: string): Promise<Response> => fetch(`${base}${pathName}`, init);

        const primary = await run(apiBase);
        if (primary.status !== 404) return primary;

        const altBase = apiBase === API_BASE_PRIMARY ? API_BASE_FALLBACK : API_BASE_PRIMARY;
        const fallback = await run(altBase);
        if (fallback.ok || fallback.status !== 404) {
            setApiBase(altBase);
            return fallback;
        }

        return primary;
    }, [apiBase]);

    const load = useCallback(async () => {
        const requestId = ++loadRequestIdRef.current;
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
            const pathName = query ? `/public/files?${query}` : '/public/files';

            const res = await requestPluginApi(pathName, {
                headers: { 'x-public-session-token': sessionToken },
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Dateiliste konnte nicht geladen werden.');
            if (requestId !== loadRequestIdRef.current) return;
            const data = payload as ListResponse;
            setProvider(data.provider === 'sharepoint' ? 'sharepoint' : 'google_drive');
            setEntries(Array.isArray(data.entries) ? data.entries : []);
            setFolderName(String(data.folderName || 'Kundenordner'));
            setBaseFolderName(String(data.baseFolderName || 'Kundenordner'));
            setCurrentPath(String(data.currentPath || ''));
            setUploadFolderName(String(data.uploadFolderName || ''));
        } catch (err) {
            if (requestId !== loadRequestIdRef.current) return;
            setError(err instanceof Error ? err.message : 'Dateiliste konnte nicht geladen werden.');
        } finally {
            if (requestId === loadRequestIdRef.current) setLoading(false);
        }
    }, [sessionToken, currentPath, requestPluginApi]);

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

    const quickFolders = useMemo(() => {
        // While a path switch is loading, avoid rendering stale folder entries from the
        // previous path to prevent temporary duplicate labels in the sidebar.
        if (loading) return [];
        return visibleEntries.filter((entry) => entry.isFolder).slice(0, 10);
    }, [visibleEntries, loading]);
    const queuedFilesTotalBytes = useMemo(
        () => selectedFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
        [selectedFiles],
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
            const uploadRes = await requestPluginApi('/public/files/upload', {
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
            if (fileInputRef.current) fileInputRef.current.value = '';
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

    function removeQueuedFile(index: number) {
        setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    }

    function clearQueuedFiles() {
        setSelectedFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    function buildFileUrl(fileId: string, mode: 'download' | 'preview'): string {
        const params = new URLSearchParams();
        if (currentPath) params.set('folderPath', currentPath);
        params.set('sessionToken', sessionToken);
        const qs = params.toString();
        return `${apiBase}/public/files/${encodeURIComponent(fileId)}/${mode}?${qs}`;
    }

    async function download(fileId: string, fileName: string) {
        if (!sessionToken) return;
        const params = new URLSearchParams();
        if (currentPath) params.set('folderPath', currentPath);
        const query = params.toString();
        const pathName = query
            ? `/public/files/${encodeURIComponent(fileId)}/download?${query}`
            : `/public/files/${encodeURIComponent(fileId)}/download`;

        const res = await requestPluginApi(pathName, {
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

    async function downloadSelected() {
        if (!sessionToken || selectedIds.size === 0) return;
        const selectedEntries = entries.filter((entry) => selectedIds.has(entry.id));
        if (selectedEntries.length === 0) return;

        if (selectedEntries.length === 1 && !selectedEntries[0].isFolder) {
            await download(selectedEntries[0].id, selectedEntries[0].name);
            return;
        }

        setError(null);
        try {
            const params = new URLSearchParams();
            if (currentPath) params.set('folderPath', currentPath);
            const query = params.toString();
            const pathName = query
                ? `/public/items/download?${query}`
                : '/public/items/download';

            const res = await requestPluginApi(pathName, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-public-session-token': sessionToken,
                },
                body: JSON.stringify({ ids: Array.from(selectedIds) }),
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload?.error || 'ZIP-Download fehlgeschlagen.');
            }

            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const disposition = res.headers.get('content-disposition') || '';
            const fileNameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i);
            const encodedName = fileNameMatch?.[1] || fileNameMatch?.[2] || 'dateiaustausch-download.zip';
            const suggestedName = decodeURIComponent(encodedName);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = suggestedName;
            a.click();
            URL.revokeObjectURL(objectUrl);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'ZIP-Download fehlgeschlagen.');
        }
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
            const pathName = query
                ? `/public/items/delete?${query}`
                : '/public/items/delete';

            const res = await requestPluginApi(pathName, {
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
                            ref={fileInputRef}
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
                    {selectedFiles.length > 0 ? (
                        <button className="btn btn-secondary" type="button" onClick={clearQueuedFiles}>
                            Queue leeren
                        </button>
                    ) : null}
                </form>
            </div>

            {selectedFiles.length > 0 ? (
                <div className="dtxd-queue">
                    <div className="dtxd-queue-header">
                        <strong>Upload-Queue</strong>
                        <span className="text-muted">{selectedFiles.length} Datei(en) · {formatBytes(queuedFilesTotalBytes)}</span>
                    </div>
                    <div className="dtxd-queue-list">
                        {selectedFiles.map((file, index) => (
                            <div className="dtxd-queue-item" key={`${file.name}-${file.size}-${index}`}>
                                <span className="dtxd-queue-name">{file.name}</span>
                                <span className="text-muted">{formatBytes(file.size)}</span>
                                <button className="dtxd-inline-action" type="button" onClick={() => removeQueuedFile(index)}>
                                    Entfernen
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            <div className="dtxd-main">
                <aside className="dtxd-sidebar">
                    <div className="dtxd-side-title">Schnellzugriff</div>
                    <button
                        className={`dtxd-side-item ${currentPath === '' ? 'is-active' : ''}`}
                        type="button"
                        onClick={() => openPath([])}
                    >
                        <Icon path={ICONS.root} />
                        <span>{baseFolderName || folderName || 'Root'}</span>
                    </button>
                    {pathParts.map((part, index) => {
                        const targetPath = pathParts.slice(0, index + 1).join('/');
                        return (
                            <button
                                key={`path-${targetPath}`}
                                className={`dtxd-side-item ${targetPath === currentPath ? 'is-active' : ''}`}
                                type="button"
                                onClick={() => openPath(pathParts.slice(0, index + 1))}
                            >
                                <Icon path={ICONS.folder} />
                                <span>{part}</span>
                            </button>
                        );
                    })}
                    {quickFolders.map((entry) => {
                        const targetPath = [...pathParts, entry.name].join('/');
                        return (
                            <button
                                key={entry.id}
                                className={`dtxd-side-item ${targetPath === currentPath ? 'is-active' : ''}`}
                                type="button"
                                onClick={() => openPath([...pathParts, entry.name])}
                            >
                                <Icon path={ICONS.folder} />
                                <span>{entry.name}</span>
                            </button>
                        );
                    })}
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
                                className="dtxd-icon-btn"
                                type="button"
                                onClick={downloadSelected}
                                disabled={selectedIds.size === 0}
                                title={selectedIds.size > 1 ? 'Auswahl als ZIP herunterladen' : 'Auswahl herunterladen'}
                            >
                                <Icon path={ICONS.download} />
                            </button>
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
                                                {entry.isFolder ? (
                                                    <span className="dtxd-type-icon is-folder">
                                                        <Icon path={ICONS.folder} />
                                                    </span>
                                                ) : isPreviewableEntry(entry) ? (
                                                    <button
                                                        type="button"
                                                        className="dtxd-inline-thumb"
                                                        onClick={() => setPreviewEntry(entry)}
                                                        title={`${entry.name} Vorschau`}
                                                    >
                                                        {isImageEntry(entry) ? (
                                                            <img
                                                                src={buildFileUrl(entry.id, 'preview')}
                                                                loading="lazy"
                                                                alt={entry.name}
                                                            />
                                                        ) : (
                                                            <span className="dtxd-inline-pdf">PDF</span>
                                                        )}
                                                    </button>
                                                ) : (
                                                    <span className="dtxd-type-icon is-file">
                                                        <Icon path={ICONS.file} />
                                                    </span>
                                                )}
                                                <span className="dtxd-name-text">{entry.name}</span>
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
                                                <div className="dtxd-row-actions">
                                                    {isPreviewableEntry(entry) ? (
                                                        <button className="dtxd-inline-action" type="button" onClick={() => setPreviewEntry(entry)}>
                                                            <Icon path={ICONS.open} />
                                                            <span>Vorschau</span>
                                                        </button>
                                                    ) : null}
                                                    <button className="dtxd-inline-action" type="button" onClick={() => download(entry.id, entry.name)}>
                                                        <Icon path={ICONS.download} />
                                                        <span>Download</span>
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            {previewEntry ? (
                <div className="dtxd-preview-modal-overlay" onClick={() => setPreviewEntry(null)}>
                    <div className="dtxd-preview-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="dtxd-preview-modal-head">
                            <strong>{previewEntry.name}</strong>
                            <div className="dtxd-row-actions">
                                <button className="btn btn-secondary" type="button" onClick={() => download(previewEntry.id, previewEntry.name)}>
                                    Download
                                </button>
                                <button className="btn btn-secondary" type="button" onClick={() => setPreviewEntry(null)}>
                                    Schließen
                                </button>
                            </div>
                        </div>
                        <div className="dtxd-preview-modal-body">
                            {isImageEntry(previewEntry) ? (
                                <img src={buildFileUrl(previewEntry.id, 'preview')} alt={previewEntry.name} />
                            ) : (
                                <iframe src={buildFileUrl(previewEntry.id, 'preview')} title={previewEntry.name} />
                            )}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
