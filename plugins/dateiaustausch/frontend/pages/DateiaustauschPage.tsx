import { MouseEvent, useEffect, useMemo, useState } from 'react';
import '../../../kundenportal/frontend/kundenportal.css';

type ItemRow = {
    id: number;
    customerId: number;
    customerName: string | null;
    customerNumber?: string | null;
    customerCompanyName?: string | null;
    customerFirstName?: string | null;
    customerLastName?: string | null;
    folderPath: string;
    displayName: string;
    updatedAt: string | null;
    currentVersionId: number | null;
};

type FolderRow = {
    id: number;
    customerId: number;
    customerName: string | null;
    customerNumber?: string | null;
    customerCompanyName?: string | null;
    customerFirstName?: string | null;
    customerLastName?: string | null;
    folderPath: string;
    updatedAt: string | null;
};

type BrowserEntry =
    | { kind: 'folder'; key: string; name: string; fullPath: string }
    | { kind: 'file'; key: string; file: ItemRow };

type ActionMenuState = {
    key: string;
    x: number;
    y: number;
};

type CustomerItem = {
    customerId: number;
    number: string | null;
    label: string;
    companyName: string | null;
    lastName: string | null;
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

function formatDate(value: string | null | undefined): string {
    if (!value) return '-';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function getCustomerLabel(row: {
    customerId: number;
    customerName: string | null;
    customerNumber?: string | null;
    customerCompanyName?: string | null;
    customerLastName?: string | null;
}): CustomerItem {
    const customerId = Number(row.customerId || 0);
    const number = String(row.customerNumber || '').trim() || null;
    const companyName = String(row.customerCompanyName || '').trim() || null;
    const lastName = String(row.customerLastName || '').trim() || null;
    const fallback = String(row.customerName || '').trim() || `Kunde #${customerId}`;
    const namePart = companyName || lastName || fallback;
    return {
        customerId,
        number,
        label: number ? `${number} - ${namePart}` : namePart,
        companyName,
        lastName,
    };
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

function getPreviewType(fileName: string): 'image' | 'pdf' | 'video' | 'other' {
    const ext = getExtension(fileName);
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
    return 'other';
}

export default function DateiaustauschPage() {
    const [rows, setRows] = useState<ItemRow[]>([]);
    const [folders, setFolders] = useState<FolderRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
    const [currentPath, setCurrentPath] = useState('');
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [menuState, setMenuState] = useState<ActionMenuState | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewIndex, setPreviewIndex] = useState(0);

    async function loadRows() {
        setLoading(true);
        setError(null);
        try {
            const [itemsRes, foldersRes] = await Promise.all([
                fetch('/api/plugins/dateiaustausch/items'),
                fetch('/api/plugins/dateiaustausch/folders'),
            ]);
            const itemsPayload = await itemsRes.json().catch(() => []);
            const foldersPayload = await foldersRes.json().catch(() => []);
            if (!itemsRes.ok) throw new Error(itemsPayload?.error || 'Dateien konnten nicht geladen werden.');
            if (!foldersRes.ok) throw new Error(foldersPayload?.error || 'Ordner konnten nicht geladen werden.');
            setRows(Array.isArray(itemsPayload) ? itemsPayload : []);
            setFolders(Array.isArray(foldersPayload) ? foldersPayload : []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Dateien konnten nicht geladen werden.');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadRows().catch(() => undefined);
    }, []);

    useEffect(() => {
        function close() {
            setMenuState(null);
        }
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, []);

    const customers = useMemo(() => {
        const byId = new Map<number, CustomerItem>();
        for (const row of rows) {
            if (!Number.isInteger(row.customerId) || row.customerId <= 0) continue;
            if (!byId.has(row.customerId)) byId.set(row.customerId, getCustomerLabel(row));
        }
        for (const folder of folders) {
            if (!Number.isInteger(folder.customerId) || folder.customerId <= 0) continue;
            if (!byId.has(folder.customerId)) byId.set(folder.customerId, getCustomerLabel(folder));
        }
        return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label, 'de'));
    }, [rows, folders]);

    useEffect(() => {
        if (!customers.length) {
            setSelectedCustomerId(null);
            return;
        }
        if (!selectedCustomerId || !customers.find((value) => value.customerId === selectedCustomerId)) {
            setSelectedCustomerId(customers[0].customerId);
            setCurrentPath('');
            setSelectedKey(null);
        }
    }, [customers, selectedCustomerId]);

    const allFoldersForCustomer = useMemo(() => {
        if (!selectedCustomerId) return [] as string[];
        const set = new Set<string>();
        for (const row of rows) {
            if (Number(row.customerId) !== selectedCustomerId) continue;
            const folderPath = normalizePath(row.folderPath);
            if (folderPath) set.add(folderPath);
        }
        for (const folder of folders) {
            if (Number(folder.customerId) !== selectedCustomerId) continue;
            const folderPath = normalizePath(folder.folderPath);
            if (folderPath) set.add(folderPath);
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'de'));
    }, [rows, folders, selectedCustomerId]);

    const childFolders = useMemo(() => {
        const prefix = currentPath ? `${currentPath}/` : '';
        const result = new Set<string>();
        for (const folder of allFoldersForCustomer) {
            if (!folder.startsWith(prefix)) continue;
            const rest = folder.slice(prefix.length);
            if (!rest) continue;
            const next = rest.split('/')[0];
            result.add(next);
        }
        return Array.from(result).sort((a, b) => a.localeCompare(b, 'de'));
    }, [allFoldersForCustomer, currentPath]);

    const visibleFiles = useMemo(() => {
        const query = search.trim().toLowerCase();
        return rows
            .filter((row) => Number(row.customerId) === Number(selectedCustomerId || 0))
            .filter((row) => normalizePath(row.folderPath) === currentPath)
            .filter((row) => {
                if (!query) return true;
                return `${row.displayName} ${row.folderPath}`.toLowerCase().includes(query);
            })
            .sort((a, b) => new Date(String(b.updatedAt || 0)).getTime() - new Date(String(a.updatedAt || 0)).getTime());
    }, [rows, selectedCustomerId, currentPath, search]);

    const breadcrumbs = useMemo(() => {
        const parts = normalizePath(currentPath).split('/').filter(Boolean);
        const result: Array<{ label: string; path: string }> = [{ label: 'Dateien', path: '' }];
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
        [visibleEntries, selectedKey],
    );
    const previewFiles = useMemo(() => visibleFiles.filter((file) => !!file.currentVersionId), [visibleFiles]);
    const previewFile = previewFiles[previewIndex] || null;

    function openActionMenu(event: MouseEvent, key: string) {
        event.preventDefault();
        event.stopPropagation();
        setSelectedKey(key);
        setMenuState({ key, x: event.clientX, y: event.clientY });
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
        window.open(`/api/plugins/dateiaustausch/items/${entry.file.id}/versions/${entry.file.currentVersionId}/download`, '_blank', 'noopener,noreferrer');
    }

    const selectedCustomerLabel = useMemo(() => {
        const selected = customers.find((value) => value.customerId === selectedCustomerId);
        return selected?.label || 'Kein Kunde';
    }, [customers, selectedCustomerId]);

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
        <div className="page-shell kp-page">
            <section className="card" style={{ padding: 0, border: 0, background: 'transparent', boxShadow: 'none' }}>
                <div className="kp-uploader-shell kp-od-shell">
                    <div className="kp-od-layout">
                        <aside className="kp-od-left">
                            <div className="kp-od-brand">
                                <div className="kp-od-brand-dot" />
                                <strong>Dateicloud Workspace</strong>
                            </div>

                            <button className="btn btn-secondary kp-od-create" type="button" onClick={() => loadRows()} disabled={loading}>
                                Aktualisieren
                            </button>

                            <div className="kp-od-folder-tree">
                                {customers.map((customer) => (
                                    <button
                                        key={customer.customerId}
                                        className={`kp-od-tree-item ${selectedCustomerId === customer.customerId ? 'is-active' : ''}`}
                                        type="button"
                                        onClick={() => {
                                            setSelectedCustomerId(customer.customerId);
                                            setCurrentPath('');
                                            setSelectedKey(null);
                                        }}
                                    >
                                        {customer.label}
                                    </button>
                                ))}
                                {!loading && customers.length === 0 && (
                                    <span className="text-muted" style={{ padding: 8 }}>Keine Kunden mit Dateien gefunden.</span>
                                )}
                            </div>
                        </aside>

                        <main className="kp-od-main">
                            <div className="kp-od-top">
                                <div className="kp-od-breadcrumbs">
                                    <strong>{selectedCustomerLabel}</strong>
                                    <span style={{ marginLeft: 8, opacity: 0.75 }}>|</span>
                                    <span style={{ marginLeft: 8 }}>
                                        {breadcrumbs.map((entry, index) => (
                                            <span key={entry.path}>
                                                {index > 0 ? ' > ' : ''}
                                                <button className="btn-link" type="button" onClick={() => setCurrentPath(entry.path)}>
                                                    {entry.label}
                                                </button>
                                            </span>
                                        ))}
                                    </span>
                                </div>
                                <div className="kp-od-search-wrap">
                                    <input
                                        className="input"
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                        placeholder="Dateien oder Ordner suchen"
                                    />
                                </div>
                            </div>

                            <div className="kp-od-commandbar">
                                <div className="kp-od-command-left">
                                    <button
                                        className="btn btn-secondary"
                                        type="button"
                                        onClick={() => setCurrentPath(getParentPath(currentPath))}
                                        disabled={!currentPath}
                                    >
                                        Nach oben
                                    </button>
                                    <button
                                        className="btn btn-secondary"
                                        type="button"
                                        disabled={!selectedEntry}
                                        onClick={() => {
                                            if (selectedEntry) openEntry(selectedEntry);
                                        }}
                                    >
                                        Oeffnen
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
                                    <button
                                        className="btn btn-secondary"
                                        type="button"
                                        disabled={selectedEntry?.kind !== 'file' || !selectedEntry.file.currentVersionId}
                                        onClick={() => {
                                            if (!selectedEntry || selectedEntry.kind !== 'file') return;
                                            const idx = previewFiles.findIndex((value) => value.id === selectedEntry.file.id);
                                            if (idx >= 0) {
                                                setPreviewIndex(idx);
                                                setPreviewOpen(true);
                                            }
                                        }}
                                    >
                                        Vorschau
                                    </button>
                                    {selectedEntry ? <span className="kp-od-selection">1 ausgewaehlt</span> : <span className="kp-od-selection">Keine Auswahl</span>}
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
                                                            <td>
                                                                <button className="btn btn-secondary" type="button" onClick={(event) => openActionMenu(event, entry.key)}>
                                                                    •••
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                }
                                                return (
                                                    <tr
                                                        key={entry.key}
                                                        className={isSelected ? 'is-selected' : ''}
                                                        onClick={() => setSelectedKey(entry.key)}
                                                        onDoubleClick={() => {
                                                            if (!entry.file.currentVersionId) return;
                                                            const idx = previewFiles.findIndex((value) => value.id === entry.file.id);
                                                            if (idx >= 0) {
                                                                setPreviewIndex(idx);
                                                                setPreviewOpen(true);
                                                            }
                                                        }}
                                                        onContextMenu={(event) => openActionMenu(event, entry.key)}
                                                    >
                                                        <td>
                                                            <span className="kp-od-name">
                                                                <FileTypeIcon fileName={entry.file.displayName} />
                                                                <span>{entry.file.displayName}</span>
                                                            </span>
                                                        </td>
                                                        <td>{getFileTypeLabel(entry.file.displayName)}</td>
                                                        <td>{formatDate(entry.file.updatedAt)}</td>
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
                                                        Keine Dateien in diesem Ordner.
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
                                                    onContextMenu={(event) => openActionMenu(event, entry.key)}
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
                                                onDoubleClick={() => {
                                                    const idx = previewFiles.findIndex((value) => value.id === entry.file.id);
                                                    if (idx >= 0) {
                                                        setPreviewIndex(idx);
                                                        setPreviewOpen(true);
                                                    }
                                                }}
                                                onContextMenu={(event) => openActionMenu(event, entry.key)}
                                            >
                                                <FileTypeIcon fileName={entry.file.displayName} />
                                                <strong>{entry.file.displayName}</strong>
                                                <span className="text-muted">{formatDate(entry.file.updatedAt)}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </main>
                    </div>
                </div>

                {menuState && (
                    <div className="kp-fm-menu" style={{ left: menuState.x, top: menuState.y }} onClick={(event) => event.stopPropagation()}>
                        {menuState.key.startsWith('folder:') ? (
                            <button
                                type="button"
                                onClick={() => {
                                    setCurrentPath(menuState.key.replace('folder:', ''));
                                    setMenuState(null);
                                }}
                            >
                                Oeffnen
                            </button>
                        ) : (
                            (() => {
                                const fileId = Number(menuState.key.replace('file:', ''));
                                const file = rows.find((value) => value.id === fileId);
                                return file && file.currentVersionId ? (
                                    <>
                                        <button
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
                                        <a href={`/api/plugins/dateiaustausch/items/${file.id}/versions/${file.currentVersionId}/download`} target="_blank" rel="noreferrer">
                                            Oeffnen
                                        </a>
                                    </>
                                ) : (
                                    <span className="is-disabled">Oeffnen</span>
                                );
                            })()
                        )}
                    </div>
                )}

                {previewOpen && previewFile && (
                    <div className="kp-od-preview-backdrop" onClick={() => setPreviewOpen(false)}>
                        <div className="kp-od-preview-modal" onClick={(event) => event.stopPropagation()}>
                            <div className="kp-od-preview-head">
                                <strong>{previewFile.displayName}</strong>
                                <div className="kp-od-preview-actions">
                                    <button
                                        className="btn btn-secondary"
                                        type="button"
                                        onClick={() => setPreviewIndex((current) => (current - 1 + previewFiles.length) % previewFiles.length)}
                                        disabled={previewFiles.length <= 1}
                                    >
                                        Zurueck
                                    </button>
                                    <button
                                        className="btn btn-secondary"
                                        type="button"
                                        onClick={() => setPreviewIndex((current) => (current + 1) % previewFiles.length)}
                                        disabled={previewFiles.length <= 1}
                                    >
                                        Weiter
                                    </button>
                                    <a className="btn btn-primary" href={`/api/plugins/dateiaustausch/items/${previewFile.id}/versions/${previewFile.currentVersionId}/download`} target="_blank" rel="noreferrer">
                                        Herunterladen
                                    </a>
                                    <button className="btn btn-secondary" type="button" onClick={() => setPreviewOpen(false)}>
                                        Schliessen
                                    </button>
                                </div>
                            </div>
                            <div className="kp-od-preview-body">
                                {getPreviewType(previewFile.displayName) === 'image' && (
                                    <img src={`/api/plugins/dateiaustausch/items/${previewFile.id}/versions/${previewFile.currentVersionId}/preview`} alt={previewFile.displayName} />
                                )}
                                {getPreviewType(previewFile.displayName) === 'pdf' && (
                                    <iframe title={previewFile.displayName} src={`/api/plugins/dateiaustausch/items/${previewFile.id}/versions/${previewFile.currentVersionId}/preview`} />
                                )}
                                {getPreviewType(previewFile.displayName) === 'video' && (
                                    <video controls playsInline src={`/api/plugins/dateiaustausch/items/${previewFile.id}/versions/${previewFile.currentVersionId}/preview`} />
                                )}
                                {getPreviewType(previewFile.displayName) === 'other' && (
                                    <iframe title={previewFile.displayName} src={`/api/plugins/dateiaustausch/items/${previewFile.id}/versions/${previewFile.currentVersionId}/preview`} />
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {error && <p className="text-danger" style={{ marginTop: 10 }}>{error}</p>}
            </section>
        </div>
    );
}
