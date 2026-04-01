import { FormEvent, useEffect, useMemo, useState } from 'react';

type PortalFileItem = {
    id: number;
    folderPath: string;
    displayName: string;
    workflowStatus: 'pending' | 'clean' | 'rejected' | 'reviewed';
    currentVersionId: number | null;
    updatedAt: string | null;
};

type Props = {
    sessionToken: string;
    formatDate: (value: string | null | undefined) => string;
};

type ViewMode = 'list' | 'tiles';

function buildDownloadUrl(item: PortalFileItem, sessionToken: string): string {
    if (!item.currentVersionId) return '#';
    return `/api/plugins/dateiaustausch/public/files/${item.id}/versions/${item.currentVersionId}/download?sessionToken=${encodeURIComponent(sessionToken)}`;
}

function splitPath(pathValue: string): string[] {
    return String(pathValue || '')
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean);
}

function getParentPath(pathValue: string): string {
    const parts = splitPath(pathValue);
    return parts.slice(0, -1).join('/');
}

function getBaseName(pathValue: string): string {
    const parts = splitPath(pathValue);
    return parts.length > 0 ? parts[parts.length - 1] : 'Root';
}

function statusLabel(value: PortalFileItem['workflowStatus']): string {
    if (value === 'clean' || value === 'reviewed') return 'Verfügbar';
    if (value === 'rejected') return 'Blockiert';
    return 'Wird geprüft';
}

export default function PublicFileExchangeModule({ sessionToken, formatDate }: Props) {
    const [available, setAvailable] = useState(true);
    const [files, setFiles] = useState<PortalFileItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [newFolderInput, setNewFolderInput] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [currentPath, setCurrentPath] = useState('');
    const [search, setSearch] = useState('');

    async function loadFiles() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/plugins/dateiaustausch/public/files?sessionToken=${encodeURIComponent(sessionToken)}`);
            const payload = await res.json().catch(() => ([]));
            if (res.status === 404) {
                setAvailable(false);
                setFiles([]);
                return;
            }
            if (!res.ok) throw new Error((payload as any)?.error || 'Dateien konnten nicht geladen werden.');
            setAvailable(true);
            setFiles(Array.isArray(payload) ? payload : []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Dateien konnten nicht geladen werden.');
            setFiles([]);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadFiles().catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionToken]);

    const folderEntries = useMemo(() => {
        const all = new Set<string>();
        for (const file of files) {
            const parts = splitPath(file.folderPath);
            for (let i = 1; i <= parts.length; i += 1) {
                all.add(parts.slice(0, i).join('/'));
            }
        }
        return Array.from(all).sort((a, b) => a.localeCompare(b, 'de'));
    }, [files]);

    const childFolders = useMemo(() => {
        const prefix = currentPath ? `${currentPath}/` : '';
        const found = new Set<string>();
        for (const folderPath of folderEntries) {
            if (!folderPath.startsWith(prefix)) continue;
            const rest = folderPath.slice(prefix.length);
            if (!rest) continue;
            const next = rest.split('/')[0];
            found.add(next);
        }
        return Array.from(found).sort((a, b) => a.localeCompare(b, 'de'));
    }, [folderEntries, currentPath]);

    const visibleFiles = useMemo(() => {
        const prefix = currentPath ? `${currentPath}/` : '';
        const query = search.trim().toLowerCase();
        return files
            .filter((file) => {
                const folder = String(file.folderPath || '');
                if (currentPath) {
                    if (folder !== currentPath) return false;
                } else if (folder.includes('/')) {
                    return false;
                }
                if (!query) return true;
                return `${file.displayName} ${folder}`.toLowerCase().includes(query);
            })
            .sort((a, b) => {
                const aTime = new Date(String(a.updatedAt || 0)).getTime();
                const bTime = new Date(String(b.updatedAt || 0)).getTime();
                return bTime - aTime;
            });
    }, [files, currentPath, search]);

    const breadcrumbs = useMemo(() => {
        const parts = splitPath(currentPath);
        const result: Array<{ label: string; path: string }> = [{ label: 'Root', path: '' }];
        let cursor = '';
        for (const part of parts) {
            cursor = cursor ? `${cursor}/${part}` : part;
            result.push({ label: part, path: cursor });
        }
        return result;
    }, [currentPath]);

    async function handleUpload(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!available) return;
        if (selectedFiles.length === 0) {
            setError('Bitte mindestens eine Datei auswählen.');
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const targetFolder = (newFolderInput.trim() || currentPath).trim();
            for (const file of selectedFiles) {
                const formData = new FormData();
                formData.append('sessionToken', sessionToken);
                if (targetFolder) formData.append('folderPath', targetFolder);
                formData.append('file', file);

                const res = await fetch(`/api/plugins/dateiaustausch/public/files/upload?sessionToken=${encodeURIComponent(sessionToken)}`, {
                    method: 'POST',
                    headers: { 'x-public-session-token': sessionToken },
                    body: formData,
                });
                const payload = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(payload?.error || `Upload fehlgeschlagen (${file.name}).`);
            }

            setSelectedFiles([]);
            setNewFolderInput('');
            await loadFiles();
            if (newFolderInput.trim()) {
                setCurrentPath(newFolderInput.trim());
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen.');
        } finally {
            setLoading(false);
        }
    }

    async function deleteFile(itemId: number) {
        if (!window.confirm('Datei wirklich löschen?')) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/plugins/dateiaustausch/public/files/${itemId}?sessionToken=${encodeURIComponent(sessionToken)}`, {
                method: 'DELETE',
                headers: { 'x-public-session-token': sessionToken },
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Datei konnte nicht gelöscht werden.');
            await loadFiles();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Datei konnte nicht gelöscht werden.');
        } finally {
            setLoading(false);
        }
    }

    return (
        <section className="kp-uploader-shell">
            <header className="kp-uploader-head">
                <div>
                    <h3 className="kp-module-title">Dateiaustausch</h3>
                    <p className="kp-module-subtitle">Cloud-Dateimanager mit Ordnern, Listen- und Kachelansicht.</p>
                </div>
                <button className="btn btn-secondary" type="button" onClick={() => loadFiles()}>
                    Aktualisieren
                </button>
            </header>

            {!available ? (
                <p className="text-muted">
                    Das Plugin <strong>Dateiaustausch</strong> ist derzeit deaktiviert.
                </p>
            ) : (
                <>
                    <div className="kp-cloud-layout">
                        <aside className="kp-cloud-sidebar">
                            <button className={`btn ${currentPath ? 'btn-secondary' : 'btn-primary'}`} type="button" onClick={() => setCurrentPath('')}>
                                Root
                            </button>
                            {folderEntries.map((folder) => (
                                <button
                                    key={folder}
                                    className={`btn ${folder === currentPath ? 'btn-primary' : 'btn-secondary'}`}
                                    type="button"
                                    onClick={() => setCurrentPath(folder)}
                                >
                                    {getBaseName(folder)}
                                </button>
                            ))}
                        </aside>

                        <div className="kp-cloud-main">
                            <div className="kp-drive-toolbar">
                                <div className="kp-drive-search">
                                    <input
                                        className="input"
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                        placeholder="Dateien im aktuellen Ordner durchsuchen"
                                    />
                                </div>
                                <div className="kp-drive-actions">
                                    <button className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`} type="button" onClick={() => setViewMode('list')}>Liste</button>
                                    <button className={`btn ${viewMode === 'tiles' ? 'btn-primary' : 'btn-secondary'}`} type="button" onClick={() => setViewMode('tiles')}>Kacheln</button>
                                </div>
                            </div>

                            <div className="kp-drive-meta">
                                <span>
                                    {breadcrumbs.map((entry, index) => (
                                        <span key={entry.path}>
                                            {index > 0 ? ' / ' : ''}
                                            <button className="btn-link" type="button" onClick={() => setCurrentPath(entry.path)}>
                                                {entry.label}
                                            </button>
                                        </span>
                                    ))}
                                </span>
                                <span>{visibleFiles.length} Datei(en)</span>
                            </div>

                            {childFolders.length > 0 && (
                                <div className="kp-uploader-selected">
                                    {childFolders.map((name) => (
                                        <button
                                            key={name}
                                            className="kp-uploader-pill"
                                            type="button"
                                            onClick={() => setCurrentPath(currentPath ? `${currentPath}/${name}` : name)}
                                        >
                                            {name}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <form onSubmit={handleUpload} className="kp-drive-upload-panel">
                                <div
                                    className={`kp-cloud-dropzone${dragOver ? ' is-dragover' : ''}`}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        setDragOver(true);
                                    }}
                                    onDragLeave={() => setDragOver(false)}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        setDragOver(false);
                                        setSelectedFiles(Array.from(event.dataTransfer.files || []));
                                    }}
                                >
                                    <p className="kp-cloud-dropzone-title">Dateien hochladen</p>
                                    <p className="kp-cloud-dropzone-subtitle text-muted">
                                        Per Drag & Drop oder Datei-Auswahl in den aktuellen Ordner.
                                    </p>
                                    <label className="btn btn-primary kp-uploader-file-btn">
                                        Dateien auswählen
                                        <input
                                            className="kp-uploader-file-input"
                                            type="file"
                                            multiple
                                            onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
                                            accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.pdf,.doc,.docx,.xlsx,.pptx,.txt,.zip"
                                            disabled={!available}
                                        />
                                    </label>
                                    <p className="kp-cloud-selected-count text-muted">
                                        {selectedFiles.length > 0 ? `${selectedFiles.length} Datei(en) ausgewählt` : 'Keine Datei ausgewählt'}
                                    </p>
                                </div>

                                <div className="kp-cloud-toolbar">
                                    <input
                                        className="input"
                                        value={currentPath}
                                        onChange={(event) => setCurrentPath(event.target.value.trim())}
                                        placeholder="Aktueller Ordner"
                                    />
                                    <input
                                        className="input"
                                        value={newFolderInput}
                                        onChange={(event) => setNewFolderInput(event.target.value)}
                                        placeholder="Oder neuer Zielordner"
                                    />
                                </div>

                                <button className="btn btn-primary" type="submit" disabled={loading || selectedFiles.length === 0}>
                                    {loading ? 'Upload läuft...' : 'Upload starten'}
                                </button>
                            </form>

                            {viewMode === 'tiles' ? (
                                <div className="kp-uploader-preview-grid">
                                    {visibleFiles.map((entry) => (
                                        <article key={entry.id} className="kp-uploader-preview-card">
                                            <div className="kp-uploader-preview-media">
                                                <div className="kp-uploader-preview-filetype">DATEI</div>
                                            </div>
                                            <div className="kp-uploader-preview-body">
                                                <strong title={entry.displayName}>{entry.displayName}</strong>
                                                <span className="text-muted">{statusLabel(entry.workflowStatus)} • {formatDate(entry.updatedAt)}</span>
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    {entry.currentVersionId && (entry.workflowStatus === 'clean' || entry.workflowStatus === 'reviewed') ? (
                                                        <a href={buildDownloadUrl(entry, sessionToken)} target="_blank" rel="noreferrer">Laden</a>
                                                    ) : (
                                                        <span className="text-muted">Nicht verfügbar</span>
                                                    )}
                                                    <button className="btn-link text-danger" type="button" onClick={() => deleteFile(entry.id)}>Löschen</button>
                                                </div>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <div className="kp-uploader-table-wrap">
                                    <table className="kp-module-table kp-drive-table">
                                        <thead>
                                            <tr style={{ textAlign: 'left', background: 'var(--panel-muted)' }}>
                                                <th style={{ padding: '10px 12px' }}>Datei</th>
                                                <th style={{ padding: '10px 12px' }}>Status</th>
                                                <th style={{ padding: '10px 12px' }}>Aktualisiert</th>
                                                <th style={{ padding: '10px 12px' }}>Download</th>
                                                <th style={{ padding: '10px 12px' }}>Aktion</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {visibleFiles.map((entry) => (
                                                <tr key={entry.id} style={{ borderTop: '1px solid var(--line)' }}>
                                                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                                                        <span className="kp-drive-file">
                                                            <span className="kp-drive-file-icon" aria-hidden="true" />
                                                            <span>{entry.displayName}</span>
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '10px 12px' }}>{statusLabel(entry.workflowStatus)}</td>
                                                    <td style={{ padding: '10px 12px' }}>{formatDate(entry.updatedAt)}</td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        {entry.currentVersionId && (entry.workflowStatus === 'clean' || entry.workflowStatus === 'reviewed') ? (
                                                            <a href={buildDownloadUrl(entry, sessionToken)} target="_blank" rel="noreferrer">Laden</a>
                                                        ) : (
                                                            <span className="text-muted">Nicht verfügbar</span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '10px 12px' }}>
                                                        <button className="btn btn-danger" type="button" onClick={() => deleteFile(entry.id)} disabled={loading}>
                                                            Löschen
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {!loading && visibleFiles.length === 0 && (
                                                <tr>
                                                    <td colSpan={5} style={{ padding: '12px' }} className="text-muted">
                                                        Keine Dateien im aktuellen Ordner.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {error && <p className="text-danger" style={{ marginTop: 8 }}>{error}</p>}
        </section>
    );
}
