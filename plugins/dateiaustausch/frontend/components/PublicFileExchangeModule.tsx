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
    entries: BrowserEntry[];
};

type ClipboardEntry = {
    kind: 'folder' | 'file';
    folderPath?: string;
    itemId?: number;
    label: string;
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

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'webp',
    'mp4', 'mov', 'webm',
    'pdf',
    'doc', 'docx', 'txt',
    'xls', 'xlsx',
    'ppt', 'pptx',
    'zip',
]);

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

function parseFilenameFromDisposition(headerValue: string | null, fallback: string): string {
    if (!headerValue) return fallback;
    const utf = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
    if (utf?.[1]) return decodeURIComponent(utf[1]);
    const ascii = /filename="([^"]+)"/i.exec(headerValue);
    if (ascii?.[1]) return ascii[1];
    return fallback;
}

const ICONS = {
    folderNew: 'M3 6h6l2-2h10v14H3V6zm9 4v6m-3-3h6',
    refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
    upload: 'M12 16V5m0 0-4 4m4-4 4 4M4 20h16',
    download: 'M12 4v11m0 0-4-4m4 4 4-4M4 20h16',
    up: 'M9 14l-4-4 4-4M5 10h9a5 5 0 0 1 5 5v1',
    copy: 'M9 9h11v11H9zM4 4h11v11H4z',
    paste: 'M9 3h6l1 2h3v16H5V5h3l1-2zm0 9h6m-6 4h6',
    eye: 'M1.5 12s3.8-6 10.5-6 10.5 6 10.5 6-3.8 6-10.5 6S1.5 12 1.5 12zm10.5 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    trash: 'M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13',
    open: 'M3 6h6l2-2h10v4M3 10h18v10H3z',
};

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
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
    const [menuState, setMenuState] = useState<ActionMenuState | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [newlyInsertedFolderPath, setNewlyInsertedFolderPath] = useState<string | null>(null);
    const [deleteCandidate, setDeleteCandidate] = useState<DeleteCandidate | null>(null);
    const [clipboardEntries, setClipboardEntries] = useState<ClipboardEntry[]>([]);
    const [pastePending, setPastePending] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [downloadPending, setDownloadPending] = useState(false);
    const downloadInFlightRef = useRef(false);
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

    const selectedEntries = useMemo(
        () => visibleEntries.filter((entry) => selectedKeys.includes(entry.key)),
        [selectedKeys, visibleEntries],
    );
    const selectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;
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
            const filesToUpload = Array.from(fileList);
            const blockedFiles = filesToUpload.filter((file) => {
                const ext = getExtension(file.name);
                return !ALLOWED_UPLOAD_EXTENSIONS.has(ext);
            });
            if (blockedFiles.length > 0) {
                throw new Error(`Nicht erlaubte Dateitypen im Upload: ${blockedFiles.map((file) => file.name).join(', ')}`);
            }
            for (const file of filesToUpload) {
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

    function setSingleSelection(key: string | null) {
        if (!key) {
            setSelectedKeys([]);
            return;
        }
        setSelectedKeys([key]);
    }

    function toggleSelection(key: string) {
        setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((value) => value !== key) : [...prev, key]));
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

    function requestDelete(entries: BrowserEntry[] | null) {
        if (!entries || entries.length === 0) return;
        setDeleteCandidate({ entries });
    }

    async function runDeleteCandidate() {
        if (!deleteCandidate) return;

        try {
            setLoading(true);
            setError(null);
            const folderPaths = deleteCandidate.entries
                .filter((entry) => entry.kind === 'folder')
                .map((entry) => entry.fullPath);
            const fileIds = deleteCandidate.entries
                .filter((entry) => entry.kind === 'file')
                .map((entry) => entry.file.id);

            const res = await fetch(`/api/plugins/dateiaustausch/public/files/bulk-delete?sessionToken=${encodeURIComponent(sessionToken)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-public-session-token': sessionToken },
                body: JSON.stringify({ fileIds, folderPaths }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Löschen fehlgeschlagen.');

            const deletedPaths = new Set(folderPaths);
            if (currentPath && [...deletedPaths].some((folderPath) => currentPath === folderPath || currentPath.startsWith(`${folderPath}/`))) {
                setCurrentPath(getParentPath(currentPath));
            }
            setSelectedKeys([]);
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
            setSelectedKeys([`folder:${target}`]);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Ordner konnte nicht angelegt werden.');
        } finally {
            setLoading(false);
        }
    }

    function openActionMenu(event: MouseEvent, key: string) {
        event.preventDefault();
        event.stopPropagation();
        if (!selectedKeys.includes(key)) {
            setSelectedKeys([key]);
        }
        setMenuState({ key, x: event.clientX, y: event.clientY });
    }

    function openRootActionMenu(event: MouseEvent) {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        setMenuState({ key: ROOT_CONTEXT_KEY, x: event.clientX, y: event.clientY });
    }

    function copySelection(entries: BrowserEntry[] = selectedEntries) {
        if (!entries.length) return;
        const payload: ClipboardEntry[] = entries.map((entry) => (
            entry.kind === 'folder'
                ? { kind: 'folder', folderPath: entry.fullPath, label: entry.name }
                : { kind: 'file', itemId: entry.file.id, label: entry.file.displayName }
        ));
        setClipboardEntries(payload);
    }

    async function pasteClipboard(targetFolderPath: string = currentPath) {
        if (!clipboardEntries.length) return;
        try {
            setPastePending(true);
            setLoading(true);
            setError(null);
            const itemIds = clipboardEntries.filter((entry) => entry.kind === 'file').map((entry) => Number(entry.itemId));
            const folderPaths = clipboardEntries.filter((entry) => entry.kind === 'folder').map((entry) => String(entry.folderPath || ''));
            const res = await fetch(`/api/plugins/dateiaustausch/public/files/copy?sessionToken=${encodeURIComponent(sessionToken)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-public-session-token': sessionToken },
                body: JSON.stringify({
                    itemIds,
                    folderPaths,
                    targetFolderPath: normalizePath(targetFolderPath),
                }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Einfügen fehlgeschlagen.');
            await loadData();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Einfügen fehlgeschlagen.');
        } finally {
            setPastePending(false);
            setLoading(false);
        }
    }

    function handleDrop(event: DragEvent<HTMLElement>) {
        event.preventDefault();
        setDragOver(false);
        if (event.dataTransfer?.files?.length) {
            uploadFiles(event.dataTransfer.files).catch(() => undefined);
        }
    }

    async function triggerDownload(url: string, fallbackName: string) {
        if (downloadInFlightRef.current) {
            throw new Error('Download läuft bereits. Bitte kurz warten.');
        }
        downloadInFlightRef.current = true;
        setDownloadPending(true);
        try {
            const response = await fetch(url, { headers: { 'x-public-session-token': sessionToken } });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error || `Download fehlgeschlagen (${response.status}).`);
            }
            const blob = await response.blob();
            if (!blob || blob.size === 0) {
                throw new Error('Download ist leer oder ungültig.');
            }
            const fileName = parseFilenameFromDisposition(response.headers.get('content-disposition'), fallbackName);
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        } finally {
            downloadInFlightRef.current = false;
            setDownloadPending(false);
        }
    }

    async function downloadEntry(entry: BrowserEntry | null) {
        if (!entry) {
            const url = `/api/plugins/dateiaustausch/public/folders/download?sessionToken=${encodeURIComponent(sessionToken)}&folderPath=${encodeURIComponent(currentPath)}`;
            const folderName = getBaseName(currentPath) || 'Dateien';
            await triggerDownload(url, `dateiaustausch-${folderName}.zip`);
            return;
        }
        if (entry.kind === 'folder') {
            const url = `/api/plugins/dateiaustausch/public/folders/download?sessionToken=${encodeURIComponent(sessionToken)}&folderPath=${encodeURIComponent(entry.fullPath)}`;
            const folderName = getBaseName(entry.fullPath) || 'Ordner';
            await triggerDownload(url, `dateiaustausch-${folderName}.zip`);
            return;
        }
        if (!entry.file.currentVersionId) return;
        await triggerDownload(buildDownloadUrl(entry.file, sessionToken), entry.file.displayName);
    }

    async function downloadCurrentSelection() {
        if (selectedEntries.length > 1) {
            for (const entry of selectedEntries) {
                await downloadEntry(entry);
            }
            return;
        }
        await downloadEntry(selectedEntry);
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
                                    setSelectedKeys([]);
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
                                        setSelectedKeys([]);
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
                                        <button className="btn-link" type="button" onClick={() => {
                                            setCurrentPath(entry.path);
                                            setSelectedKeys([]);
                                        }}>
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
                                    <ActionIcon path={ICONS.folderNew} />
                                </button>
                                <button className="btn btn-secondary kp-icon-btn" type="button" onClick={() => loadData()} disabled={loading} title="Aktualisieren" aria-label="Aktualisieren">
                                    <ActionIcon path={ICONS.refresh} />
                                </button>
                                <button className="btn btn-secondary kp-icon-btn" type="button" onClick={() => hiddenUploadInputRef.current?.click()} title="Hochladen" aria-label="Hochladen">
                                    <ActionIcon path={ICONS.upload} />
                                </button>
                                <button className="btn btn-secondary kp-icon-btn" type="button" onClick={() => downloadCurrentSelection().catch((err) => setError(err instanceof Error ? err.message : 'Download fehlgeschlagen.'))} disabled={downloadPending} title="Download" aria-label="Download">
                                    <ActionIcon path={ICONS.download} />
                                </button>
                                <button
                                    className="btn btn-secondary kp-icon-btn"
                                    type="button"
                                    onClick={() => copySelection()}
                                    disabled={selectedEntries.length === 0}
                                    title="Kopieren"
                                    aria-label="Kopieren"
                                >
                                    <ActionIcon path={ICONS.copy} />
                                </button>
                                <button
                                    className="btn btn-secondary kp-icon-btn"
                                    type="button"
                                    onClick={() => pasteClipboard(currentPath)}
                                    disabled={!clipboardEntries.length || pastePending}
                                    title="Einfügen"
                                    aria-label="Einfügen"
                                >
                                    <ActionIcon path={ICONS.paste} />
                                </button>
                                <button
                                    className="btn btn-secondary kp-icon-btn"
                                    type="button"
                                    onClick={() => {
                                        setCurrentPath(getParentPath(currentPath));
                                        setSelectedKeys([]);
                                    }}
                                    disabled={!currentPath}
                                    title="Eine Ebene nach oben"
                                    aria-label="Eine Ebene nach oben"
                                >
                                    <ActionIcon path={ICONS.up} />
                                </button>
                            </div>
                            <div className="kp-od-command-right">
                                {selectedEntries.length > 0 ? (
                                    <>
                                        <button
                                            className="btn btn-secondary kp-icon-btn"
                                            type="button"
                                            disabled={selectedEntry?.kind !== 'file' || !selectedEntry.file.currentVersionId}
                                            onClick={() => {
                                                if (!selectedEntry || selectedEntry.kind === 'folder') return;
                                                openEntry(selectedEntry);
                                            }}
                                            title="Vorschau"
                                            aria-label="Vorschau"
                                        >
                                            <ActionIcon path={ICONS.eye} />
                                        </button>
                                        <button className="btn btn-secondary kp-icon-btn" type="button" onClick={() => downloadCurrentSelection().catch((err) => setError(err instanceof Error ? err.message : 'Download fehlgeschlagen.'))} disabled={downloadPending} title="Download" aria-label="Download">
                                            <ActionIcon path={ICONS.download} />
                                        </button>
                                        <button className="btn btn-danger kp-icon-btn" type="button" onClick={() => requestDelete(selectedEntries)} title="Löschen" aria-label="Löschen">
                                            <ActionIcon path={ICONS.trash} />
                                        </button>
                                        <span className="kp-od-selection">{selectedEntries.length} ausgewählt</span>
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
                                        <th style={{ width: 36 }}>
                                            <input
                                                type="checkbox"
                                                aria-label="Alle auswählen"
                                                checked={visibleEntries.length > 0 && selectedEntries.length === visibleEntries.length}
                                                onChange={(event) => {
                                                    if (event.target.checked) {
                                                        setSelectedKeys(visibleEntries.map((entry) => entry.key));
                                                    } else {
                                                        setSelectedKeys([]);
                                                    }
                                                }}
                                            />
                                        </th>
                                        <th>Name</th>
                                        <th>Typ</th>
                                        <th>Geändert</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleEntries.map((entry) => {
                                        const isSelected = selectedKeys.includes(entry.key);
                                        if (entry.kind === 'folder') {
                                            const isNew = newlyInsertedFolderPath === entry.fullPath;
                                            return (
                                                <tr
                                                    key={entry.key}
                                                    className={`${isSelected ? 'is-selected' : ''}${isNew ? ' is-new' : ''}`}
                                                    onClick={(event) => {
                                                        if (event.metaKey || event.ctrlKey) {
                                                            toggleSelection(entry.key);
                                                            return;
                                                        }
                                                        setSingleSelection(entry.key);
                                                    }}
                                                    onDoubleClick={() => setCurrentPath(entry.fullPath)}
                                                    onContextMenu={(event) => openActionMenu(event, entry.key)}
                                                >
                                                    <td>
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleSelection(entry.key)}
                                                            onClick={(event) => event.stopPropagation()}
                                                            aria-label={`${entry.name} auswählen`}
                                                        />
                                                    </td>
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
                                                onClick={(event) => {
                                                    if (event.metaKey || event.ctrlKey) {
                                                        toggleSelection(entry.key);
                                                        return;
                                                    }
                                                    setSingleSelection(entry.key);
                                                }}
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
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleSelection(entry.key)}
                                                        onClick={(event) => event.stopPropagation()}
                                                        aria-label={`${file.displayName} auswählen`}
                                                    />
                                                </td>
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
                                            <td colSpan={4} className="text-muted" style={{ padding: 20 }}>
                                                Dieser Ordner ist leer. Dateien hier hineinziehen oder hochladen.
                                            </td>
                                        </tr>
                                    )}
                                    {creatingFolder && (
                                        <tr className="kp-od-new-folder-row">
                                            <td />
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
                                <ActionIcon path={ICONS.open} /> Öffnen
                            </button>
                            <button
                                className="kp-fm-menu-item tile-grid-context-menu-item"
                                type="button"
                                onClick={() => {
                                    const folderPath = menuState.key.replace('folder:', '');
                                    copySelection([{ kind: 'folder', key: menuState.key, name: getBaseName(folderPath), fullPath: folderPath }]);
                                    setMenuState(null);
                                }}
                            >
                                <ActionIcon path={ICONS.copy} /> Kopieren
                            </button>
                            <button
                                className={`kp-fm-menu-item tile-grid-context-menu-item ${!clipboardEntries.length ? 'is-disabled' : ''}`}
                                type="button"
                                disabled={!clipboardEntries.length}
                                onClick={() => {
                                    const folderPath = menuState.key.replace('folder:', '');
                                    pasteClipboard(folderPath).catch(() => undefined);
                                    setMenuState(null);
                                }}
                            >
                                <ActionIcon path={ICONS.paste} /> Einfügen
                            </button>
                                <button
                                    className="kp-fm-menu-item tile-grid-context-menu-item"
                                    type="button"
                                    disabled={downloadPending}
                                    onClick={async () => {
                                        const folderPath = menuState.key.replace('folder:', '');
                                        const url = `/api/plugins/dateiaustausch/public/folders/download?sessionToken=${encodeURIComponent(sessionToken)}&folderPath=${encodeURIComponent(folderPath)}`;
                                        const folderName = getBaseName(folderPath) || 'Ordner';
                                        await triggerDownload(url, `dateiaustausch-${folderName}.zip`);
                                        setMenuState(null);
                                }}
                            >
                                <ActionIcon path={ICONS.download} /> Download
                            </button>
                            <div className="kp-fm-menu-divider tile-grid-context-menu-divider" />
                            <button
                                className="kp-fm-menu-item kp-fm-menu-item--danger tile-grid-context-menu-item tile-grid-context-menu-item--danger"
                                type="button"
                                onClick={async () => {
                                    const fullPath = menuState.key.replace('folder:', '');
                                    const name = getBaseName(fullPath);
                                    requestDelete([{ kind: 'folder', key: `folder:${fullPath}`, name, fullPath }]);
                                    setMenuState(null);
                                }}
                            >
                                <ActionIcon path={ICONS.trash} /> Löschen
                            </button>
                        </>
                    ) : menuState.key === ROOT_CONTEXT_KEY ? (
                        <>
                            <button
                                className="kp-fm-menu-item tile-grid-context-menu-item"
                                type="button"
                                onClick={() => {
                                    setCreatingFolder(true);
                                    setCreateOpen(false);
                                    setMenuState(null);
                                }}
                            >
                                <ActionIcon path={ICONS.folderNew} /> Neuer Ordner
                            </button>
                            <button
                                className={`kp-fm-menu-item tile-grid-context-menu-item ${!clipboardEntries.length ? 'is-disabled' : ''}`}
                                type="button"
                                disabled={!clipboardEntries.length}
                                onClick={() => {
                                    pasteClipboard(currentPath).catch(() => undefined);
                                    setMenuState(null);
                                }}
                            >
                                <ActionIcon path={ICONS.paste} /> Einfügen
                            </button>
                        </>
                    ) : (
                        (() => {
                            const fileId = Number(menuState.key.replace('file:', ''));
                            const file = files.find((entry) => entry.id === fileId);
                            const canOpen = !!file?.currentVersionId;
                            return (
                                <>
                                    {file ? (
                                        <button
                                            className="kp-fm-menu-item tile-grid-context-menu-item"
                                            type="button"
                                            onClick={() => {
                                                copySelection([{ kind: 'file', key: menuState.key, file }]);
                                                setMenuState(null);
                                            }}
                                        >
                                            <ActionIcon path={ICONS.copy} /> Kopieren
                                        </button>
                                    ) : (
                                        <span className="kp-fm-menu-item tile-grid-context-menu-item is-disabled">Kopieren</span>
                                    )}
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
                                            <ActionIcon path={ICONS.eye} /> Vorschau
                                        </button>
                                    ) : (
                                        <span className="kp-fm-menu-item tile-grid-context-menu-item is-disabled">Vorschau</span>
                                    )}
                                    {file && canOpen ? (
                                        <button
                                            className="kp-fm-menu-item tile-grid-context-menu-item"
                                            type="button"
                                            disabled={downloadPending}
                                            onClick={() => {
                                                triggerDownload(buildDownloadUrl(file, sessionToken), file.displayName).catch((err) => {
                                                    setError(err instanceof Error ? err.message : 'Download fehlgeschlagen.');
                                                });
                                                setMenuState(null);
                                            }}
                                        >
                                            <ActionIcon path={ICONS.download} /> Download
                                        </button>
                                    ) : (
                                        <span className="kp-fm-menu-item tile-grid-context-menu-item is-disabled">Download</span>
                                    )}
                                    <div className="kp-fm-menu-divider tile-grid-context-menu-divider" />
                                    <button
                                        className="kp-fm-menu-item kp-fm-menu-item--danger tile-grid-context-menu-item tile-grid-context-menu-item--danger"
                                        type="button"
                                        onClick={async () => {
                                            if (!file) return;
                                            requestDelete([{ kind: 'file', key: menuState.key, file }]);
                                            setMenuState(null);
                                        }}
                                    >
                                        <ActionIcon path={ICONS.trash} /> Löschen
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
                                <button
                                    className="btn btn-primary"
                                    type="button"
                                    disabled={downloadPending}
                                    onClick={() => {
                                        triggerDownload(buildDownloadUrl(previewFile, sessionToken), previewFile.displayName).catch((err) => {
                                            setError(err instanceof Error ? err.message : 'Download fehlgeschlagen.');
                                        });
                                    }}
                                >
                                    Herunterladen
                                </button>
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
                                Soll{deleteCandidate.entries.length > 1 ? 'en diese Elemente' : ' dieses Element'} wirklich gelöscht werden?
                            </p>
                            {deleteCandidate.entries.length === 1 && (
                                <p>
                                    <strong>
                                        {deleteCandidate.entries[0].kind === 'folder'
                                            ? deleteCandidate.entries[0].name
                                            : deleteCandidate.entries[0].file.displayName}
                                    </strong>
                                </p>
                            )}
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
