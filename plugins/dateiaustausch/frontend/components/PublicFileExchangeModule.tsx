import { FormEvent, MouseEvent, useEffect, useMemo, useState } from 'react';

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

type ViewMode = 'list' | 'grid';
type BrowserEntry =
    | { kind: 'folder'; name: string; fullPath: string }
    | { kind: 'file'; file: PortalFileItem };

type ActionMenuState = {
    key: string;
    x: number;
    y: number;
};

function normalizePath(input: string): string {
    return String(input || '')
        .replace(/\\/g, '/')
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)
        .join('/');
}

function getBaseName(pathValue: string): string {
    const parts = normalizePath(pathValue).split('/').filter(Boolean);
    return parts[parts.length - 1] || 'Root';
}

function getParentPath(pathValue: string): string {
    const parts = normalizePath(pathValue).split('/').filter(Boolean);
    return parts.slice(0, -1).join('/');
}

function getExtension(fileName: string): string {
    const clean = String(fileName || '').trim().toLowerCase();
    const idx = clean.lastIndexOf('.');
    if (idx < 0 || idx >= clean.length - 1) return '';
    return clean.slice(idx + 1);
}

function isImageExt(ext: string): boolean {
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext);
}

function isPdfExt(ext: string): boolean {
    return ext === 'pdf';
}

function getFileTypeLabel(fileName: string): string {
    const ext = getExtension(fileName);
    if (!ext) return 'Datei';
    if (['doc', 'docx'].includes(ext)) return 'Dokument';
    if (['xls', 'xlsx'].includes(ext)) return 'Tabelle';
    if (['ppt', 'pptx'].includes(ext)) return 'Präsentation';
    if (['mp4', 'mov', 'webm'].includes(ext)) return 'Video';
    if (isImageExt(ext)) return 'Bild';
    if (isPdfExt(ext)) return 'PDF';
    if (ext === 'zip') return 'Archiv';
    return ext.toUpperCase();
}

function buildDownloadUrl(item: PortalFileItem, sessionToken: string): string {
    if (!item.currentVersionId) return '#';
    return `/api/plugins/dateiaustausch/public/files/${item.id}/versions/${item.currentVersionId}/download?sessionToken=${encodeURIComponent(sessionToken)}`;
}

function FileTypeIcon({ fileName }: { fileName: string }) {
    const ext = getExtension(fileName);
    if (isImageExt(ext)) return <span className="kp-fm-type is-image">IMG</span>;
    if (isPdfExt(ext)) return <span className="kp-fm-type is-pdf">PDF</span>;
    if (['mp4', 'mov', 'webm'].includes(ext)) return <span className="kp-fm-type is-video">VID</span>;
    if (['doc', 'docx', 'txt'].includes(ext)) return <span className="kp-fm-type is-doc">DOC</span>;
    if (['xls', 'xlsx'].includes(ext)) return <span className="kp-fm-type is-sheet">XLS</span>;
    if (ext === 'zip') return <span className="kp-fm-type is-zip">ZIP</span>;
    return <span className="kp-fm-type">FILE</span>;
}

export default function PublicFileExchangeModule({ sessionToken, formatDate }: Props) {
    const [available, setAvailable] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [files, setFiles] = useState<PortalFileItem[]>([]);
    const [folders, setFolders] = useState<string[]>([]);
    const [currentPath, setCurrentPath] = useState('');
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [search, setSearch] = useState('');
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [newFolderName, setNewFolderName] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const [menuState, setMenuState] = useState<ActionMenuState | null>(null);

    async function loadData() {
        setLoading(true);
        setError(null);
        try {
            const [filesRes, foldersRes] = await Promise.all([
                fetch(`/api/plugins/dateiaustausch/public/files?sessionToken=${encodeURIComponent(sessionToken)}`),
                fetch(`/api/plugins/dateiaustausch/public/folders?sessionToken=${encodeURIComponent(sessionToken)}`),
            ]);

            const filesPayload = await filesRes.json().catch(() => []);
            const foldersPayload = await foldersRes.json().catch(() => []);
            if (filesRes.status === 404 || foldersRes.status === 404) {
                setAvailable(false);
                setFiles([]);
                setFolders([]);
                return;
            }
            if (!filesRes.ok) throw new Error(filesPayload?.error || 'Dateien konnten nicht geladen werden.');
            if (!foldersRes.ok) throw new Error(foldersPayload?.error || 'Ordner konnten nicht geladen werden.');

            setAvailable(true);
            setFiles(Array.isArray(filesPayload) ? filesPayload : []);
            setFolders(Array.isArray(foldersPayload) ? foldersPayload.map((v) => normalizePath(String(v))).filter(Boolean) : []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Dateiaustausch konnte nicht geladen werden.');
            setFiles([]);
            setFolders([]);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadData().catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionToken]);

    useEffect(() => {
        function close() {
            setMenuState(null);
        }
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, []);

    const allFolders = useMemo(() => {
        const set = new Set<string>(folders);
        for (const file of files) {
            const folderPath = normalizePath(file.folderPath);
            if (folderPath) set.add(folderPath);
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
    }, [folders, files]);

    const childFolders = useMemo(() => {
        const prefix = currentPath ? `${currentPath}/` : '';
        const result = new Set<string>();
        for (const folder of allFolders) {
            if (!folder.startsWith(prefix)) continue;
            const rest = folder.slice(prefix.length);
            if (!rest) continue;
            const next = rest.split('/')[0];
            result.add(next);
        }
        return Array.from(result).sort((a, b) => a.localeCompare(b, 'de'));
    }, [allFolders, currentPath]);

    const visibleFiles = useMemo(() => {
        const query = search.trim().toLowerCase();
        return files
            .filter((file) => normalizePath(file.folderPath) === currentPath)
            .filter((file) => !query || file.displayName.toLowerCase().includes(query))
            .sort((a, b) => new Date(String(b.updatedAt || 0)).getTime() - new Date(String(a.updatedAt || 0)).getTime());
    }, [files, currentPath, search]);

    const breadcrumbs = useMemo(() => {
        const parts = normalizePath(currentPath).split('/').filter(Boolean);
        const result: Array<{ label: string; path: string }> = [{ label: 'Root', path: '' }];
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            result.push({ label: part, path: current });
        }
        return result;
    }, [currentPath]);

    const visibleEntries = useMemo<BrowserEntry[]>(() => {
        const folderEntries: BrowserEntry[] = childFolders.map((folderName) => ({
            kind: 'folder',
            name: folderName,
            fullPath: currentPath ? `${currentPath}/${folderName}` : folderName,
        }));
        const fileEntries: BrowserEntry[] = visibleFiles.map((file) => ({ kind: 'file', file }));
        return [...folderEntries, ...fileEntries];
    }, [childFolders, currentPath, visibleFiles]);

    async function createFolder(pathValue: string) {
        const folderPath = normalizePath(pathValue);
        if (!folderPath) return;
        const res = await fetch(`/api/plugins/dateiaustausch/public/folders?sessionToken=${encodeURIComponent(sessionToken)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-public-session-token': sessionToken },
            body: JSON.stringify({ folderPath }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || 'Ordner konnte nicht angelegt werden.');
    }

    async function handleCreateFolder(event: FormEvent) {
        event.preventDefault();
        if (!newFolderName.trim()) return;
        try {
            setLoading(true);
            setError(null);
            const target = currentPath ? `${currentPath}/${newFolderName.trim()}` : newFolderName.trim();
            await createFolder(target);
            setNewFolderName('');
            await loadData();
            setCurrentPath(normalizePath(target));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Ordner konnte nicht angelegt werden.');
        } finally {
            setLoading(false);
        }
    }

    async function handleDeleteCurrentFolder() {
        if (!currentPath) return;
        if (!window.confirm(`Ordner "${getBaseName(currentPath)}" wirklich löschen?`)) return;
        try {
            setLoading(true);
            setError(null);
            const res = await fetch(`/api/plugins/dateiaustausch/public/folders?sessionToken=${encodeURIComponent(sessionToken)}&folderPath=${encodeURIComponent(currentPath)}`, {
                method: 'DELETE',
                headers: { 'x-public-session-token': sessionToken },
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Ordner konnte nicht gelöscht werden.');
            const parent = getParentPath(currentPath);
            await loadData();
            setCurrentPath(parent);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Ordner konnte nicht gelöscht werden.');
        } finally {
            setLoading(false);
        }
    }

    async function handleUpload(event: FormEvent) {
        event.preventDefault();
        if (selectedFiles.length === 0) return;

        try {
            setLoading(true);
            setError(null);
            for (const file of selectedFiles) {
                const formData = new FormData();
                formData.append('sessionToken', sessionToken);
                if (currentPath) formData.append('folderPath', currentPath);
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
            await loadData();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen.');
        } finally {
            setLoading(false);
        }
    }

    async function handleDeleteFile(itemId: number) {
        if (!window.confirm('Datei wirklich löschen?')) return;
        try {
            setLoading(true);
            setError(null);
            const res = await fetch(`/api/plugins/dateiaustausch/public/files/${itemId}?sessionToken=${encodeURIComponent(sessionToken)}`, {
                method: 'DELETE',
                headers: { 'x-public-session-token': sessionToken },
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Datei konnte nicht gelöscht werden.');
            await loadData();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Datei konnte nicht gelöscht werden.');
        } finally {
            setLoading(false);
        }
    }

    function openActionMenu(event: MouseEvent, key: string) {
        event.preventDefault();
        event.stopPropagation();
        setMenuState({ key, x: event.clientX, y: event.clientY });
    }

    return (
        <section className="kp-uploader-shell">
            <header className="kp-uploader-head">
                <div>
                    <h3 className="kp-module-title">Dateicloud</h3>
                    <p className="kp-module-subtitle">Interaktive Ordnerstruktur wie ein moderner Cloud-Explorer.</p>
                </div>
                <button className="btn btn-secondary" type="button" onClick={() => loadData()} disabled={loading}>
                    Aktualisieren
                </button>
            </header>

            {!available ? (
                <p className="text-muted">Das Plugin <strong>Dateiaustausch</strong> ist aktuell deaktiviert.</p>
            ) : (
                <div className="kp-cloud-layout">
                    <aside className="kp-cloud-sidebar">
                        <button className={`btn ${currentPath ? 'btn-secondary' : 'btn-primary'}`} type="button" onClick={() => setCurrentPath('')}>
                            Root
                        </button>
                        {allFolders.map((folder) => (
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
                                    placeholder="Dateien suchen"
                                />
                            </div>
                            <div className="kp-drive-actions">
                                <button className="btn btn-secondary" type="button" onClick={() => setCurrentPath(getParentPath(currentPath))} disabled={!currentPath}>
                                    Nach oben
                                </button>
                                <button className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`} type="button" onClick={() => setViewMode('list')}>Liste</button>
                                <button className={`btn ${viewMode === 'grid' ? 'btn-primary' : 'btn-secondary'}`} type="button" onClick={() => setViewMode('grid')}>Kacheln</button>
                                <button className="btn btn-danger" type="button" onClick={handleDeleteCurrentFolder} disabled={!currentPath}>
                                    Ordner löschen
                                </button>
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
                            <span>{visibleEntries.length} Elemente</span>
                        </div>

                        <form onSubmit={handleCreateFolder} className="kp-cloud-toolbar">
                            <input
                                className="input"
                                value={newFolderName}
                                onChange={(event) => setNewFolderName(event.target.value)}
                                placeholder="Neuen Ordner anlegen"
                            />
                            <button className="btn btn-secondary" type="submit" disabled={!newFolderName.trim() || loading}>
                                Ordner erstellen
                            </button>
                        </form>

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
                                <p className="kp-cloud-dropzone-title">Dateien in "{currentPath || 'Root'}" hochladen</p>
                                <p className="kp-cloud-dropzone-subtitle text-muted">
                                    Drag & Drop oder Dateiauswahl
                                </p>
                                <label className="btn btn-primary kp-uploader-file-btn">
                                    Dateien auswählen
                                    <input
                                        className="kp-uploader-file-input"
                                        type="file"
                                        multiple
                                        onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
                                        accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.pdf,.doc,.docx,.xlsx,.pptx,.txt,.zip"
                                        disabled={loading}
                                    />
                                </label>
                                <p className="kp-cloud-selected-count text-muted">
                                    {selectedFiles.length > 0 ? `${selectedFiles.length} Datei(en) ausgewählt` : 'Keine Datei ausgewählt'}
                                </p>
                            </div>
                            <button className="btn btn-primary" type="submit" disabled={loading || selectedFiles.length === 0}>
                                {loading ? 'Upload läuft...' : 'Upload starten'}
                            </button>
                        </form>

                        {viewMode === 'grid' ? (
                            <div className="kp-uploader-preview-grid">
                                {visibleEntries.map((entry) => {
                                    if (entry.kind === 'folder') {
                                        return (
                                            <article key={`folder-${entry.fullPath}`} className="kp-uploader-preview-card is-folder" onDoubleClick={() => setCurrentPath(entry.fullPath)}>
                                                <div className="kp-uploader-preview-media">
                                                    <div className="kp-uploader-preview-filetype">ORDNER</div>
                                                </div>
                                                <div className="kp-uploader-preview-body">
                                                    <strong title={entry.name}>{entry.name}</strong>
                                                    <span className="text-muted">Ordner</span>
                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                        <button className="btn-link" type="button" onClick={() => setCurrentPath(entry.fullPath)}>Öffnen</button>
                                                        <button className="btn-link" type="button" onClick={(event) => openActionMenu(event, `folder-${entry.fullPath}`)}>•••</button>
                                                    </div>
                                                </div>
                                            </article>
                                        );
                                    }
                                    const file = entry.file;
                                    const ext = getExtension(file.displayName);
                                    const canDownload = file.currentVersionId && (file.workflowStatus === 'clean' || file.workflowStatus === 'reviewed');
                                    const downloadUrl = buildDownloadUrl(file, sessionToken);
                                    const canPreview = !!canDownload && (isImageExt(ext) || isPdfExt(ext));
                                    return (
                                        <article key={file.id} className="kp-uploader-preview-card">
                                            <div className="kp-uploader-preview-media">
                                                {canPreview && isImageExt(ext) ? (
                                                    <img src={downloadUrl} alt={file.displayName} loading="lazy" />
                                                ) : canPreview && isPdfExt(ext) ? (
                                                    <iframe src={downloadUrl} title={file.displayName} loading="lazy" />
                                                ) : (
                                                    <FileTypeIcon fileName={file.displayName} />
                                                )}
                                            </div>
                                            <div className="kp-uploader-preview-body">
                                                <strong title={file.displayName}>{file.displayName}</strong>
                                                <span className="text-muted">{getFileTypeLabel(file.displayName)} • {formatDate(file.updatedAt)}</span>
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    {canDownload ? (
                                                        <a href={downloadUrl} target="_blank" rel="noreferrer">Öffnen</a>
                                                    ) : <span className="text-muted">Verarbeitung</span>}
                                                    <button className="btn-link text-danger" type="button" onClick={() => handleDeleteFile(file.id)}>Löschen</button>
                                                    <button className="btn-link" type="button" onClick={(event) => openActionMenu(event, `file-${file.id}`)}>•••</button>
                                                </div>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="kp-uploader-table-wrap">
                                <table className="kp-module-table kp-drive-table">
                                    <thead>
                                        <tr style={{ textAlign: 'left', background: 'var(--panel-muted)' }}>
                                            <th style={{ padding: '10px 12px' }}>Name</th>
                                            <th style={{ padding: '10px 12px' }}>Typ</th>
                                            <th style={{ padding: '10px 12px' }}>Aktualisiert</th>
                                            <th style={{ padding: '10px 12px' }}>Aktion</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleEntries.map((entry) => {
                                            if (entry.kind === 'folder') {
                                                return (
                                                    <tr key={`folder-row-${entry.fullPath}`} style={{ borderTop: '1px solid var(--line)' }} className="kp-fm-folder-row">
                                                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                                                            <button className="btn-link kp-fm-open" type="button" onClick={() => setCurrentPath(entry.fullPath)}>
                                                                {entry.name}
                                                            </button>
                                                        </td>
                                                        <td style={{ padding: '10px 12px' }}>Ordner</td>
                                                        <td style={{ padding: '10px 12px' }}>-</td>
                                                        <td style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
                                                            <button className="btn btn-secondary" type="button" onClick={() => setCurrentPath(entry.fullPath)}>Öffnen</button>
                                                            <button className="btn btn-secondary" type="button" onClick={(event) => openActionMenu(event, `folder-${entry.fullPath}`)}>•••</button>
                                                        </td>
                                                    </tr>
                                                );
                                            }
                                            const file = entry.file;
                                            const canDownload = file.currentVersionId && (file.workflowStatus === 'clean' || file.workflowStatus === 'reviewed');
                                            const downloadUrl = buildDownloadUrl(file, sessionToken);
                                            return (
                                                <tr key={file.id} style={{ borderTop: '1px solid var(--line)' }}>
                                                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                                                        <span className="kp-drive-file">
                                                            <FileTypeIcon fileName={file.displayName} />
                                                            <span>{file.displayName}</span>
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '10px 12px' }}>{getFileTypeLabel(file.displayName)}</td>
                                                    <td style={{ padding: '10px 12px' }}>{formatDate(file.updatedAt)}</td>
                                                    <td style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
                                                        {canDownload ? (
                                                            <a href={downloadUrl} target="_blank" rel="noreferrer">Öffnen</a>
                                                        ) : <span className="text-muted">Verarbeitung</span>}
                                                        <button className="btn btn-danger" type="button" onClick={() => handleDeleteFile(file.id)} disabled={loading}>
                                                            Löschen
                                                        </button>
                                                        <button className="btn btn-secondary" type="button" onClick={(event) => openActionMenu(event, `file-${file.id}`)}>•••</button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {!loading && visibleEntries.length === 0 && (
                                            <tr>
                                                <td colSpan={4} style={{ padding: '12px' }} className="text-muted">Dieser Ordner ist leer.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {menuState && (
                <div className="kp-fm-menu" style={{ left: menuState.x, top: menuState.y }} onClick={(event) => event.stopPropagation()}>
                    {menuState.key.startsWith('folder-') ? (
                        <>
                            <button type="button" onClick={() => { setCurrentPath(menuState.key.replace('folder-', '')); setMenuState(null); }}>Öffnen</button>
                            <button type="button" onClick={async () => {
                                const folderPath = menuState.key.replace('folder-', '');
                                const res = await fetch(`/api/plugins/dateiaustausch/public/folders?sessionToken=${encodeURIComponent(sessionToken)}&folderPath=${encodeURIComponent(folderPath)}`, {
                                    method: 'DELETE',
                                    headers: { 'x-public-session-token': sessionToken },
                                });
                                const payload = await res.json().catch(() => ({}));
                                if (!res.ok) setError(payload?.error || 'Ordner konnte nicht gelöscht werden.');
                                await loadData();
                                setMenuState(null);
                            }}>Löschen</button>
                        </>
                    ) : (
                        (() => {
                            const fileId = Number(menuState.key.replace('file-', ''));
                            const file = files.find((entry) => entry.id === fileId);
                            const canDownload = !!(file?.currentVersionId && (file.workflowStatus === 'clean' || file.workflowStatus === 'reviewed'));
                            return (
                                <>
                                    {file && canDownload ? (
                                        <a href={buildDownloadUrl(file, sessionToken)} target="_blank" rel="noreferrer">Öffnen</a>
                                    ) : <span className="is-disabled">Öffnen</span>}
                                    <button type="button" onClick={async () => {
                                        await handleDeleteFile(fileId);
                                        setMenuState(null);
                                    }}>Löschen</button>
                                </>
                            );
                        })()
                    )}
                </div>
            )}

            {error && <p className="text-danger" style={{ marginTop: 8 }}>{error}</p>}
        </section>
    );
}
