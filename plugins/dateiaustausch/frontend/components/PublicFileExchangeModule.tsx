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

const ROOT_CONTEXT_KEY = '__context:create';

type DeleteCandidate = {
    kind: 'folder' | 'file';
    label: string;
    fullPath?: string;
    itemId?: number;
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
    if (['ppt', 'pptx'].includes(ext)) return 'Präsentation';
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

function buildPreviewUrl(item: PortalFileItem, sessionToken: string): string {
    if (!item.currentVersionId) return '#';
    return `/api/plugins/dateiaustausch/public/files/${item.id}/versions/${item.currentVersionId}/preview?sessionToken=${encodeURIComponent(sessionToken)}`;
}

function getPreviewType(fileName: string): 'image' | 'pdf' | 'video' | 'other' {
    const ext = getExtension(fileName);
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
    return 'other';
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
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [newlyInsertedFolderPath, setNewlyInsertedFolderPath] = useState<string | null>(null);
    const [deleteCandidate, setDeleteCandidate] = useState<DeleteCandidate | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewIndex, setPreviewIndex] = useState(0);
    const hiddenUploadInputRef = useRef<HTMLInputElement | null>(null);
    const newFolderInputRef = useRef<HTMLInputElement | null>(null);

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

    useEffect(() => {
        if (!creatingFolder) return;
        const id = window.setTimeout(() => {
            newFolderInputRef.current?.focus();
            newFolderInputRef.current?.select();
        }, 0);
        return () => window.clearTimeout(id);
    }, [creatingFolder]);

    useEffect(() => {
        if (!newlyInsertedFolderPath) return;
        const id = window.setTimeout(() => setNewlyInsertedFolderPath(null), 2200);
        return () => window.clearTimeout(id);
    }, [newlyInsertedFolderPath]);

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
    const previewFiles = useMemo(() => visibleFiles.filter((file) => !!file.currentVersionId), [visibleFiles]);
    const previewFile = previewFiles[previewIndex] || null;

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
        if (!res.ok) throw new Error(payload?.error || 'Ordner konnte nicht gelöscht werden.');
    }

    async function deleteFile(itemId: number) {
        const res = await fetch(`/api/plugins/dateiaustausch/public/files/${itemId}?sessionToken=${encodeURIComponent(sessionToken)}`, {
            method: 'DELETE',
            headers: { 'x-public-session-token': sessionToken },
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || 'Datei konnte nicht gelöscht werden.');
    }

    function openEntry(entry: BrowserEntry) {
        if (entry.kind === 'folder') {
            setCurrentPath(entry.fullPath);
            return;
        }
        if (!entry.file.currentVersionId) return;
        const idx = previewFiles.findIndex((value) => value.id === entry.file.id);
        if (idx >= 0) {
            setPreviewIndex(idx);
            setPreviewOpen(true);
            return;
        }
        window.open(buildDownloadUrl(entry.file, sessionToken), '_blank', 'noopener,noreferrer');
    }

    function ActionIcon({ path, viewBox = '0 0 24 24' }: { path: string; viewBox?: string }) {
        return (
            <span className="kp-btn-icon" aria-hidden="true">
                <svg viewBox={viewBox} focusable="false">
                    <path d={path} />
                </svg>
            </span>
        );
    }

    function requestDelete(entry: BrowserEntry | null) {
        if (!entry) return;
        if (entry.kind === 'folder') {
            setDeleteCandidate({
                kind: 'folder',
                label: entry.name,
                fullPath: entry.fullPath,
            });
            return;
        }
        setDeleteCandidate({
            kind: 'file',
            label: entry.file.displayName,
            itemId: entry.file.id,
        });
    }

    async function runDeleteCandidate() {
        if (!deleteCandidate) return;

        try {
            setLoading(true);
            setError(null);
            if (deleteCandidate.kind === 'folder' && deleteCandidate.fullPath) {
                await deleteFolder(deleteCandidate.fullPath);
                if (currentPath === deleteCandidate.fullPath) setCurrentPath(getParentPath(currentPath));
            } else {
                await deleteFile(Number(deleteCandidate.itemId));
            }
            setSelectedKey(null);
            setDeleteCandidate(null);
            await loadData();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
        } finally {
            setLoading(false);
        }
    }

    async function submitCreateFolder() {
        const normalizedName = normalizePath(newFolderName).split('/').filter(Boolean).join(' ');
        if (!normalizedName) return;
        const target = currentPath ? `${currentPath}/${normalizedName}` : normalizedName;
        try {
            setLoading(true);
            setError(null);
            await createFolder(target);
            await loadData();
            setCreatingFolder(false);
            setCreateOpen(false);
            setNewFolderName('');
            setNewlyInsertedFolderPath(target);
            setSelectedKey(`folder:${target}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Ordner konnte nicht angelegt werden.');
        } finally {
            setLoading(false);
        }
    }

    function openActionMenu(event: MouseEvent, key: string) {
        event.preventDefault();
        event.stopPropagation();
        setSelectedKey(key);
        setMenuState({ key, x: event.clientX, y: event.clientY });
    }

    function openRootActionMenu(event: MouseEvent) {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        setSelectedKey(null);
        setMenuState({ key: ROOT_CONTEXT_KEY, x: event.clientX, y: event.clientY });
    }

    function handleDrop(event: DragEvent<HTMLElement>) {
        event.preventDefault();
        setDragOver(false);
        if (event.dataTransfer?.files?.length) {
            uploadFiles(event.dataTransfer.files).catch(() => undefined);
        }
    }

    function triggerDownload(url: string) {
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noreferrer noopener';
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    function downloadEntry(entry: BrowserEntry | null) {
        if (!entry) {
            const url = `/api/plugins/dateiaustausch/public/folders/download?sessionToken=${encodeURIComponent(sessionToken)}&folderPath=${encodeURIComponent(currentPath)}`;
            triggerDownload(url);
            return;
        }
        if (entry.kind === 'folder') {
            const url = `/api/plugins/dateiaustausch/public/folders/download?sessionToken=${encodeURIComponent(sessionToken)}&folderPath=${encodeURIComponent(entry.fullPath)}`;
            triggerDownload(url);
            return;
        }
        if (!entry.file.currentVersionId) return;
        triggerDownload(buildDownloadUrl(entry.file, sessionToken));
    }

    useEffect(() => {
        if (!previewOpen) return;
        function onKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') setPreviewOpen(false);
            if (event.key === 'ArrowRight') {
                setPreviewIndex((current) => (previewFiles.length ? (current + 1) % previewFiles.length : 0));
            }
            if (event.key === 'ArrowLeft') {
                setPreviewIndex((current) => (previewFiles.length ? (current - 1 + previewFiles.length) % previewFiles.length : 0));
            }
        }
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [previewOpen, previewFiles.length]);

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
                                        onClick={() => {
                                            setCreatingFolder(true);
                                            setCreateOpen(false);
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
                        onContextMenu={openRootActionMenu}
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
                                <button
                                    className="btn btn-secondary kp-icon-btn"
                                    type="button"
                                    onClick={() => {
                                        setCreatingFolder(true);
                                        setCreateOpen(false);
                                    }}
                                    title="Neuer Ordner"
                                    aria-label="Neuer Ordner"
                                >
                                    <ActionIcon path="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm14 7h-2v-2h-2v2h-2v2h2v2h2v-2h2v-2z" />
                                </button>
                                <button className="btn btn-secondary kp-icon-btn" type="button" onClick={() => loadData()} disabled={loading} title="Aktualisieren" aria-label="Aktualisieren">
                                    <ActionIcon path="M12 5v4m0 6v4m-7-7h4m6 0h4" />
                                </button>
                                <button className="btn btn-secondary kp-icon-btn" type="button" onClick={() => hiddenUploadInputRef.current?.click()} title="Hochladen" aria-label="Hochladen">
                                    <ActionIcon path="M12 21V10m0 0l4 4m-4-4l-4 4M5 3h14" />
                                </button>
                                <button className="btn btn-secondary kp-icon-btn" type="button" onClick={() => downloadEntry(selectedEntry)} title="Download" aria-label="Download">
                                    <ActionIcon path="M12 4v14m0 0l-3-3m3 3l3-3" />
                                </button>
                                <button
                                    className="btn btn-secondary kp-icon-btn"
                                    type="button"
                                    onClick={() => setCurrentPath(getParentPath(currentPath))}
                                    disabled={!currentPath}
                                    title="Eine Ebene nach oben"
                                    aria-label="Eine Ebene nach oben"
                                >
                                    <ActionIcon path="M9 6l-6 6 6 6M4 12h16" />
                                </button>
                            </div>
                            <div className="kp-od-command-right">
                                {selectedEntry ? (
                                    <>
                                        <button
                                            className="btn btn-secondary kp-icon-btn"
                                            type="button"
                                            disabled={selectedEntry.kind === 'folder' || !selectedEntry.file.currentVersionId}
                                            onClick={() => {
                                                if (selectedEntry.kind === 'folder') return;
                                                openEntry(selectedEntry);
                                            }}
                                            title="Vorschau"
                                            aria-label="Vorschau"
                                        >
                                            <ActionIcon path="M1.5 12s3.8-6 10.5-6 10.5 6 10.5 6-3.8 6-10.5 6S1.5 12 1.5 12zm10.5 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
                                        </button>
                                        <button className="btn btn-secondary kp-icon-btn" type="button" onClick={() => downloadEntry(selectedEntry)} title="Download" aria-label="Download">
                                            <ActionIcon path="M12 4v14m0 0l-3-3m3 3l3-3" />
                                        </button>
                                        <button className="btn btn-danger kp-icon-btn" type="button" onClick={() => requestDelete(selectedEntry)} title="Löschen" aria-label="Löschen">
                                            <ActionIcon path="M6 7h12M9 7V5h6v2m-8 0l1 12h6l1-12" />
                                        </button>
                                    </>
                                ) : (
                                    <span className="kp-od-selection">Keine Auswahl</span>
                                )}
                            </div>
                        </div>

                        <div className="kp-od-table-wrap">
                            <table className="kp-module-table kp-od-table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Typ</th>
                                        <th>Geändert</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleEntries.map((entry) => {
                                        const isSelected = selectedKey === entry.key;
                                        if (entry.kind === 'folder') {
                                            const isNew = newlyInsertedFolderPath === entry.fullPath;
                                            return (
                                                <tr
                                                    key={entry.key}
                                                    className={`${isSelected ? 'is-selected' : ''}${isNew ? ' is-new' : ''}`}
                                                    onClick={() => setSelectedKey(entry.key)}
                                                    onDoubleClick={() => setCurrentPath(entry.fullPath)}
                                                    onContextMenu={(event) => openActionMenu(event, entry.key)}
                                                >
                                                    <td>
                                                        <span className="kp-od-name">
                                                            <span className="kp-od-folder-icon" aria-hidden="true" />
                                                            <span>{entry.name}</span>
                                                        </span>
                                                    </td>
                                                    <td>Ordner</td>
                                                    <td>-</td>
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
                                                    if (!file.currentVersionId) return;
                                                    const idx = previewFiles.findIndex((value) => value.id === file.id);
                                                    if (idx >= 0) {
                                                        setPreviewIndex(idx);
                                                        setPreviewOpen(true);
                                                    }
                                                }}
                                                onContextMenu={(event) => openActionMenu(event, entry.key)}
                                            >
                                                <td>
                                                    <span className="kp-od-name">
                                                        <FileTypeIcon fileName={file.displayName} />
                                                        <span>{file.displayName}</span>
                                                    </span>
                                                </td>
                                                <td>{getFileTypeLabel(file.displayName)}</td>
                                                <td>{formatDate(file.updatedAt)}</td>
                                            </tr>
                                        );
                                    })}
                                    {!loading && visibleEntries.length === 0 && (
                                        <tr>
                                            <td colSpan={3} className="text-muted" style={{ padding: 20 }}>
                                                Dieser Ordner ist leer. Dateien hier hineinziehen oder hochladen.
                                            </td>
                                        </tr>
                                    )}
                                    {creatingFolder && (
                                        <tr className="kp-od-new-folder-row">
                                            <td>
                                                <span className="kp-od-name">
                                                    <span className="kp-od-folder-icon" aria-hidden="true" />
                                                    <input
                                                        ref={newFolderInputRef}
                                                        className="input"
                                                        value={newFolderName}
                                                        onChange={(event) => setNewFolderName(event.target.value)}
                                                        placeholder="Neuen Ordner benennen"
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') submitCreateFolder().catch(() => undefined);
                                                            if (event.key === 'Escape') {
                                                                setCreatingFolder(false);
                                                                setNewFolderName('');
                                                            }
                                                        }}
                                                    />
                                                </span>
                                            </td>
                                            <td>Ordner</td>
                                            <td>-</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

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
                <div className="kp-fm-menu tile-grid-context-menu" style={{ left: menuState.x, top: menuState.y }} onClick={(event) => event.stopPropagation()}>
                    <div className="kp-fm-menu-title tile-grid-context-menu-title">Dateiaustausch</div>
                    <div className="kp-fm-menu-divider tile-grid-context-menu-divider" />
                    {menuState.key.startsWith('folder:') ? (
                        <>
                            <button
                                className="kp-fm-menu-item tile-grid-context-menu-item"
                                type="button"
                                onClick={() => {
                                    setCurrentPath(menuState.key.replace('folder:', ''));
                                    setMenuState(null);
                                }}
                            >
                                Öffnen
                            </button>
                            <button
                                className="kp-fm-menu-item tile-grid-context-menu-item"
                                type="button"
                                onClick={() => {
                                    const folderPath = menuState.key.replace('folder:', '');
                                    const url = `/api/plugins/dateiaustausch/public/folders/download?sessionToken=${encodeURIComponent(sessionToken)}&folderPath=${encodeURIComponent(folderPath)}`;
                                    triggerDownload(url);
                                    setMenuState(null);
                                }}
                            >
                                Download
                            </button>
                            <div className="kp-fm-menu-divider tile-grid-context-menu-divider" />
                            <button
                                className="kp-fm-menu-item kp-fm-menu-item--danger tile-grid-context-menu-item tile-grid-context-menu-item--danger"
                                type="button"
                                onClick={async () => {
                                    const fullPath = menuState.key.replace('folder:', '');
                                    const name = getBaseName(fullPath);
                                    setDeleteCandidate({ kind: 'folder', label: name, fullPath });
                                    setMenuState(null);
                                }}
                            >
                                Löschen
                            </button>
                        </>
                    ) : menuState.key === ROOT_CONTEXT_KEY ? (
                        <button
                            className="kp-fm-menu-item tile-grid-context-menu-item"
                            type="button"
                            onClick={() => {
                                setCreatingFolder(true);
                                setCreateOpen(false);
                                setMenuState(null);
                            }}
                        >
                            Neuer Ordner
                        </button>
                    ) : (
                        (() => {
                            const fileId = Number(menuState.key.replace('file:', ''));
                            const file = files.find((entry) => entry.id === fileId);
                            const canOpen = !!file?.currentVersionId;
                            return (
                                <>
                                    {file && canOpen ? (
                                        <button
                                            className="kp-fm-menu-item tile-grid-context-menu-item"
                                            type="button"
                                            onClick={() => {
                                                const idx = previewFiles.findIndex((value) => value.id === file.id);
                                                if (idx >= 0) {
                                                    setPreviewIndex(idx);
                                                    setPreviewOpen(true);
                                                }
                                                setMenuState(null);
                                            }}
                                        >
                                            Vorschau
                                        </button>
                                    ) : (
                                        <span className="kp-fm-menu-item tile-grid-context-menu-item is-disabled">Vorschau</span>
                                    )}
                                    {file && canOpen ? (
                                        <a className="kp-fm-menu-item tile-grid-context-menu-item" href={buildDownloadUrl(file, sessionToken)} target="_blank" rel="noreferrer">Download</a>
                                    ) : (
                                        <span className="kp-fm-menu-item tile-grid-context-menu-item is-disabled">Download</span>
                                    )}
                                    <div className="kp-fm-menu-divider tile-grid-context-menu-divider" />
                                    <button
                                        className="kp-fm-menu-item kp-fm-menu-item--danger tile-grid-context-menu-item tile-grid-context-menu-item--danger"
                                        type="button"
                                        onClick={async () => {
                                            setDeleteCandidate({
                                                kind: 'file',
                                                label: file?.displayName || `Datei #${fileId}`,
                                                itemId: fileId,
                                            });
                                            setMenuState(null);
                                        }}
                                    >
                                        Löschen
                                    </button>
                                </>
                            );
                        })()
                    )}
                </div>
            )}

            {previewOpen && previewFile && (
                <div className="kp-od-preview-backdrop modal-overlay" onClick={() => setPreviewOpen(false)}>
                    <div className="kp-od-preview-modal modal-card" onClick={(event) => event.stopPropagation()}>
                        <div className="kp-od-preview-head">
                            <strong>{previewFile.displayName}</strong>
                            <div className="kp-od-preview-actions">
                                <button
                                    className="btn btn-secondary"
                                    type="button"
                                    onClick={() => setPreviewIndex((current) => (current - 1 + previewFiles.length) % previewFiles.length)}
                                    disabled={previewFiles.length <= 1}
                                >
                                    Zurück
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    type="button"
                                    onClick={() => setPreviewIndex((current) => (current + 1) % previewFiles.length)}
                                    disabled={previewFiles.length <= 1}
                                >
                                    Weiter
                                </button>
                                <a className="btn btn-primary" href={buildDownloadUrl(previewFile, sessionToken)} target="_blank" rel="noreferrer">
                                    Herunterladen
                                </a>
                                <button className="btn btn-secondary" type="button" onClick={() => setPreviewOpen(false)}>
                                    Schließen
                                </button>
                            </div>
                        </div>
                        <div className="kp-od-preview-body">
                            {getPreviewType(previewFile.displayName) === 'image' && (
                                <img src={buildPreviewUrl(previewFile, sessionToken)} alt={previewFile.displayName} />
                            )}
                            {getPreviewType(previewFile.displayName) === 'pdf' && (
                                <iframe title={previewFile.displayName} src={buildPreviewUrl(previewFile, sessionToken)} />
                            )}
                            {getPreviewType(previewFile.displayName) === 'video' && (
                                <video controls playsInline src={buildPreviewUrl(previewFile, sessionToken)} />
                            )}
                            {getPreviewType(previewFile.displayName) === 'other' && (
                                <iframe title={previewFile.displayName} src={buildPreviewUrl(previewFile, sessionToken)} />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {deleteCandidate && (
                <div className="kp-od-preview-backdrop modal-overlay" onClick={() => setDeleteCandidate(null)}>
                    <div className="kp-od-preview-modal kp-od-dialog-modal modal-card" onClick={(event) => event.stopPropagation()}>
                        <div className="kp-od-preview-head">
                            <strong>Element löschen</strong>
                        </div>
                        <div className="kp-od-dialog-body">
                            <p>
                                Soll {deleteCandidate.kind === 'folder' ? 'der Ordner' : 'die Datei'} <strong>{deleteCandidate.label}</strong> wirklich gelöscht werden?
                            </p>
                            <div className="kp-od-preview-actions">
                                <button className="btn btn-secondary" type="button" onClick={() => setDeleteCandidate(null)}>
                                    Abbrechen
                                </button>
                                <button className="btn btn-danger" type="button" onClick={() => runDeleteCandidate()}>
                                    Löschen
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {error && <p className="text-danger" style={{ marginTop: 8 }}>{error}</p>}
        </section>
    );
}
