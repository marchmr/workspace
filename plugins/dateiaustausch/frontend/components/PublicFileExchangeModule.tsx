import { DragEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';

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

type BrowserEntry =
    | { kind: 'folder'; key: string; name: string; fullPath: string }
    | { kind: 'file'; key: string; file: PortalFileItem };

type TreeItem = {
    path: string;
    name: string;
    depth: number;
};

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

function getFileTypeLabel(fileName: string): string {
    const ext = getExtension(fileName);
    if (!ext) return 'Datei';
    if (['doc', 'docx', 'txt'].includes(ext)) return 'Dokument';
    if (['xls', 'xlsx'].includes(ext)) return 'Tabelle';
    if (['ppt', 'pptx'].includes(ext)) return 'Praesentation';
    if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'Video';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) return 'Bild';
    if (ext === 'pdf') return 'PDF';
    if (ext === 'zip') return 'Archiv';
    return ext.toUpperCase();
}

function buildDownloadUrl(item: PortalFileItem, sessionToken: string): string {
    if (!item.currentVersionId) return '#';
    return `/api/plugins/dateiaustausch/public/files/${item.id}/versions/${item.currentVersionId}/download?sessionToken=${encodeURIComponent(sessionToken)}`;
}

function buildFolderTree(paths: string[]): TreeItem[] {
    return paths
        .map((value) => normalizePath(value))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'de'))
        .map((pathValue) => ({
            path: pathValue,
            name: getBaseName(pathValue),
            depth: pathValue.split('/').length - 1,
        }));
}

function FileTypeIcon({ fileName }: { fileName: string }) {
    const type = getFileTypeLabel(fileName);
    if (type === 'Bild') return <span className="kp-fm-type is-image">IMG</span>;
    if (type === 'PDF') return <span className="kp-fm-type is-pdf">PDF</span>;
    if (type === 'Video') return <span className="kp-fm-type is-video">VID</span>;
    if (type === 'Dokument') return <span className="kp-fm-type is-doc">DOC</span>;
    if (type === 'Tabelle') return <span className="kp-fm-type is-sheet">XLS</span>;
    if (type === 'Archiv') return <span className="kp-fm-type is-zip">ZIP</span>;
    return <span className="kp-fm-type">FILE</span>;
}

export default function PublicFileExchangeModule({ sessionToken, formatDate }: Props) {
    const [available, setAvailable] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [files, setFiles] = useState<PortalFileItem[]>([]);
    const [folders, setFolders] = useState<string[]>([]);
    const [currentPath, setCurrentPath] = useState('');
    const [search, setSearch] = useState('');
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [menuState, setMenuState] = useState<ActionMenuState | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [dragOver, setDragOver] = useState(false);
    const hiddenUploadInputRef = useRef<HTMLInputElement | null>(null);

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
            setFolders(
                Array.isArray(foldersPayload)
                    ? foldersPayload.map((v) => normalizePath(String(v))).filter(Boolean)
                    : [],
            );
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
            setCreateOpen(false);
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
        return Array.from(set);
    }, [folders, files]);

    const treeFolders = useMemo(() => buildFolderTree(allFolders), [allFolders]);

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
        const result: Array<{ label: string; path: string }> = [{ label: 'Eigene Dateien', path: '' }];
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
            key: `folder:${currentPath ? `${currentPath}/` : ''}${folderName}`,
            name: folderName,
            fullPath: currentPath ? `${currentPath}/${folderName}` : folderName,
        }));
        const fileEntries: BrowserEntry[] = visibleFiles.map((file) => ({ kind: 'file', key: `file:${file.id}`, file }));
        return [...folderEntries, ...fileEntries];
    }, [childFolders, currentPath, visibleFiles]);

    const selectedEntry = useMemo(
        () => visibleEntries.find((entry) => entry.key === selectedKey) || null,
        [selectedKey, visibleEntries],
    );

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

    async function uploadFiles(fileList: FileList | null) {
        if (!fileList || fileList.length === 0) return;
        try {
            setLoading(true);
            setError(null);
            for (const file of Array.from(fileList)) {
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
            await loadData();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen.');
        } finally {
            setLoading(false);
        }
    }

    async function deleteFolder(folderPath: string) {
        const res = await fetch(
            `/api/plugins/dateiaustausch/public/folders?sessionToken=${encodeURIComponent(sessionToken)}&folderPath=${encodeURIComponent(folderPath)}`,
            {
                method: 'DELETE',
                headers: { 'x-public-session-token': sessionToken },
            },
        );
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || 'Ordner konnte nicht geloescht werden.');
    }

    async function deleteFile(itemId: number) {
        const res = await fetch(`/api/plugins/dateiaustausch/public/files/${itemId}?sessionToken=${encodeURIComponent(sessionToken)}`, {
            method: 'DELETE',
            headers: { 'x-public-session-token': sessionToken },
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || 'Datei konnte nicht geloescht werden.');
    }

    function openEntry(entry: BrowserEntry) {
        if (entry.kind === 'folder') {
            setCurrentPath(entry.fullPath);
            return;
        }
        if (!entry.file.currentVersionId) return;
        window.open(buildDownloadUrl(entry.file, sessionToken), '_blank', 'noopener,noreferrer');
    }

    async function runDeleteSelected() {
        if (!selectedEntry) return;
        const label = selectedEntry.kind === 'folder'
            ? `Ordner "${selectedEntry.name}"`
            : `Datei "${selectedEntry.file.displayName}"`;
        if (!window.confirm(`${label} wirklich loeschen?`)) return;

        try {
            setLoading(true);
            setError(null);
            if (selectedEntry.kind === 'folder') {
                await deleteFolder(selectedEntry.fullPath);
                if (currentPath === selectedEntry.fullPath) setCurrentPath(getParentPath(currentPath));
            } else {
                await deleteFile(selectedEntry.file.id);
            }
            setSelectedKey(null);
            await loadData();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Loeschen fehlgeschlagen.');
        } finally {
            setLoading(false);
        }
    }

    function openActionMenu(event: MouseEvent, key: string) {
        event.preventDefault();
        event.stopPropagation();
        setMenuState({ key, x: event.clientX, y: event.clientY });
    }

    function handleDrop(event: DragEvent<HTMLElement>) {
        event.preventDefault();
        setDragOver(false);
        if (event.dataTransfer?.files?.length) {
            uploadFiles(event.dataTransfer.files).catch(() => undefined);
        }
    }

    return (
        <section className="kp-uploader-shell kp-od-shell">
            {!available ? (
                <p className="text-muted">Das Plugin <strong>Dateiaustausch</strong> ist aktuell deaktiviert.</p>
            ) : (
                <div className="kp-od-layout">
                    <aside className="kp-od-left">
                        <div className="kp-od-brand">
                            <div className="kp-od-brand-dot" />
                            <strong>Dateicloud</strong>
                        </div>

                        <div className="kp-od-create-wrap">
                            <button
                                className="btn btn-primary kp-od-create"
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setCreateOpen((prev) => !prev);
                                }}
                            >
                                + Erstellen oder hochladen
                            </button>
                            {createOpen && (
                                <div className="kp-od-create-menu" onClick={(event) => event.stopPropagation()}>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            const name = window.prompt('Name des neuen Ordners');
                                            if (!name?.trim()) return;
                                            try {
                                                setLoading(true);
                                                await createFolder(currentPath ? `${currentPath}/${name.trim()}` : name.trim());
                                                await loadData();
                                            } finally {
                                                setLoading(false);
                                                setCreateOpen(false);
                                            }
                                        }}
                                    >
                                        Ordner erstellen
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            hiddenUploadInputRef.current?.click();
                                            setCreateOpen(false);
                                        }}
                                    >
                                        Dateien hochladen
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="kp-od-folder-tree">
                            <button
                                className={`kp-od-tree-item ${currentPath === '' ? 'is-active' : ''}`}
                                type="button"
                                onClick={() => {
                                    setCurrentPath('');
                                    setSelectedKey(null);
                                }}
                            >
                                Eigene Dateien
                            </button>
                            {treeFolders.map((folder) => (
                                <button
                                    key={folder.path}
                                    className={`kp-od-tree-item ${currentPath === folder.path ? 'is-active' : ''}`}
                                    type="button"
                                    style={{ paddingLeft: `${14 + folder.depth * 14}px` }}
                                    onClick={() => {
                                        setCurrentPath(folder.path);
                                        setSelectedKey(null);
                                    }}
                                >
                                    {folder.name}
                                </button>
                            ))}
                        </div>
                    </aside>

                    <main
                        className={`kp-od-main ${dragOver ? 'is-dragover' : ''}`}
                        onDragEnter={(event) => {
                            event.preventDefault();
                            setDragOver(true);
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                    >
                        <div className="kp-od-top">
                            <div className="kp-od-breadcrumbs">
                                {breadcrumbs.map((entry, index) => (
                                    <span key={entry.path}>
                                        {index > 0 ? ' > ' : ''}
                                        <button className="btn-link" type="button" onClick={() => setCurrentPath(entry.path)}>
                                            {entry.label}
                                        </button>
                                    </span>
                                ))}
                            </div>
                            <div className="kp-od-search-wrap">
                                <input
                                    className="input"
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Suche in diesem Ordner"
                                />
                            </div>
                        </div>

                        <div className="kp-od-commandbar">
                            <div className="kp-od-command-left">
                                <button className="btn btn-secondary" type="button" onClick={() => loadData()} disabled={loading}>
                                    Aktualisieren
                                </button>
                                <button className="btn btn-secondary" type="button" onClick={() => hiddenUploadInputRef.current?.click()}>
                                    Upload
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    type="button"
                                    onClick={() => setCurrentPath(getParentPath(currentPath))}
                                    disabled={!currentPath}
                                >
                                    Nach oben
                                </button>
                            </div>
                            <div className="kp-od-command-right">
                                <button
                                    className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
                                    type="button"
                                    onClick={() => setViewMode('list')}
                                >
                                    Liste
                                </button>
                                <button
                                    className={`btn ${viewMode === 'grid' ? 'btn-primary' : 'btn-secondary'}`}
                                    type="button"
                                    onClick={() => setViewMode('grid')}
                                >
                                    Kacheln
                                </button>
                                {selectedEntry ? (
                                    <>
                                        <button className="btn btn-secondary" type="button" onClick={() => openEntry(selectedEntry)}>
                                            Oeffnen
                                        </button>
                                        <button className="btn btn-danger" type="button" onClick={() => runDeleteSelected()}>
                                            Loeschen
                                        </button>
                                    </>
                                ) : (
                                    <span className="kp-od-selection">Keine Auswahl</span>
                                )}
                            </div>
                        </div>

                        {viewMode === 'list' ? (
                            <div className="kp-od-table-wrap">
                                <table className="kp-module-table kp-od-table">
                                    <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Typ</th>
                                            <th>Geaendert</th>
                                            <th style={{ width: 82 }}>Aktion</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleEntries.map((entry) => {
                                            const isSelected = selectedKey === entry.key;
                                            if (entry.kind === 'folder') {
                                                return (
                                                    <tr
                                                        key={entry.key}
                                                        className={isSelected ? 'is-selected' : ''}
                                                        onClick={() => setSelectedKey(entry.key)}
                                                        onDoubleClick={() => setCurrentPath(entry.fullPath)}
                                                    >
                                                        <td>
                                                            <span className="kp-od-name">
                                                                <span className="kp-od-folder-icon" aria-hidden="true" />
                                                                <span>{entry.name}</span>
                                                            </span>
                                                        </td>
                                                        <td>Ordner</td>
                                                        <td>-</td>
                                                        <td>
                                                            <button className="btn btn-secondary" type="button" onClick={(event) => openActionMenu(event, entry.key)}>
                                                                •••
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            }

                                            const file = entry.file;
                                            return (
                                                <tr
                                                    key={entry.key}
                                                    className={isSelected ? 'is-selected' : ''}
                                                    onClick={() => setSelectedKey(entry.key)}
                                                    onDoubleClick={() => {
                                                        if (file.currentVersionId) {
                                                            window.open(buildDownloadUrl(file, sessionToken), '_blank', 'noopener,noreferrer');
                                                        }
                                                    }}
                                                >
                                                    <td>
                                                        <span className="kp-od-name">
                                                            <FileTypeIcon fileName={file.displayName} />
                                                            <span>{file.displayName}</span>
                                                        </span>
                                                    </td>
                                                    <td>{getFileTypeLabel(file.displayName)}</td>
                                                    <td>{formatDate(file.updatedAt)}</td>
                                                    <td>
                                                        <button className="btn btn-secondary" type="button" onClick={(event) => openActionMenu(event, entry.key)}>
                                                            •••
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {!loading && visibleEntries.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="text-muted" style={{ padding: 20 }}>
                                                    Dieser Ordner ist leer. Dateien hier hineinziehen oder hochladen.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="kp-od-grid">
                                {visibleEntries.map((entry) => {
                                    const isSelected = selectedKey === entry.key;
                                    if (entry.kind === 'folder') {
                                        return (
                                            <button
                                                key={entry.key}
                                                type="button"
                                                className={`kp-od-tile ${isSelected ? 'is-selected' : ''}`}
                                                onClick={() => setSelectedKey(entry.key)}
                                                onDoubleClick={() => setCurrentPath(entry.fullPath)}
                                            >
                                                <span className="kp-od-folder-icon" aria-hidden="true" />
                                                <strong>{entry.name}</strong>
                                                <span className="text-muted">Ordner</span>
                                            </button>
                                        );
                                    }
                                    return (
                                        <button
                                            key={entry.key}
                                            type="button"
                                            className={`kp-od-tile ${isSelected ? 'is-selected' : ''}`}
                                            onClick={() => setSelectedKey(entry.key)}
                                        >
                                            <FileTypeIcon fileName={entry.file.displayName} />
                                            <strong>{entry.file.displayName}</strong>
                                            <span className="text-muted">{formatDate(entry.file.updatedAt)}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <input
                            ref={hiddenUploadInputRef}
                            type="file"
                            multiple
                            style={{ display: 'none' }}
                            onChange={async (event) => {
                                await uploadFiles(event.target.files);
                                if (hiddenUploadInputRef.current) hiddenUploadInputRef.current.value = '';
                            }}
                        />
                    </main>
                </div>
            )}

            {menuState && (
                <div className="kp-fm-menu" style={{ left: menuState.x, top: menuState.y }} onClick={(event) => event.stopPropagation()}>
                    {menuState.key.startsWith('folder:') ? (
                        <>
                            <button
                                type="button"
                                onClick={() => {
                                    setCurrentPath(menuState.key.replace('folder:', ''));
                                    setMenuState(null);
                                }}
                            >
                                Oeffnen
                            </button>
                            <button
                                type="button"
                                onClick={async () => {
                                    try {
                                        setLoading(true);
                                        await deleteFolder(menuState.key.replace('folder:', ''));
                                        await loadData();
                                    } catch (err) {
                                        setError(err instanceof Error ? err.message : 'Ordner konnte nicht geloescht werden.');
                                    } finally {
                                        setLoading(false);
                                        setMenuState(null);
                                    }
                                }}
                            >
                                Loeschen
                            </button>
                        </>
                    ) : (
                        (() => {
                            const fileId = Number(menuState.key.replace('file:', ''));
                            const file = files.find((entry) => entry.id === fileId);
                            const canOpen = !!file?.currentVersionId;
                            return (
                                <>
                                    {file && canOpen ? (
                                        <a href={buildDownloadUrl(file, sessionToken)} target="_blank" rel="noreferrer">Oeffnen</a>
                                    ) : (
                                        <span className="is-disabled">Oeffnen</span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            try {
                                                setLoading(true);
                                                await deleteFile(fileId);
                                                await loadData();
                                            } catch (err) {
                                                setError(err instanceof Error ? err.message : 'Datei konnte nicht geloescht werden.');
                                            } finally {
                                                setLoading(false);
                                                setMenuState(null);
                                            }
                                        }}
                                    >
                                        Loeschen
                                    </button>
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
