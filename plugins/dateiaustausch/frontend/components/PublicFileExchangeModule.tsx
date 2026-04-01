import { useState, useEffect, useMemo, FormEvent, ReactNode } from 'react';

type PortalFileItemLike = {
    id: number;
    folderPath: string;
    displayName: string;
    workflowStatus: 'pending' | 'clean' | 'rejected' | 'reviewed';
    currentVersionId: number | null;
    currentVersionNo: number | null;
    updatedAt: string | null;
};

type FolderTreeNode = {
    name: string;
    path: string;
    count: number;
    childList: FolderTreeNode[];
};

type Props = {
    sessionToken: string;
    formatDate: (value: string | null | undefined) => string;
};

function formatWorkflowStatus(value: PortalFileItemLike['workflowStatus']): string {
    if (value === 'clean') return 'Geprüft';
    if (value === 'reviewed') return 'Freigegeben';
    if (value === 'rejected') return 'Gesperrt';
    return 'In Prüfung';
}

function renderFolderTree(
    nodes: FolderTreeNode[],
    depth: number,
    activePath: string,
    onSelect: (path: string) => void,
): ReactNode[] {
    return nodes.flatMap((node) => {
        const isActive = activePath === node.path;
        const row = (
            <button
                key={node.path}
                type="button"
                className={`btn ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                style={{ justifyContent: 'space-between', paddingLeft: `${12 + depth * 16}px` }}
                onClick={() => onSelect(node.path)}
            >
                <span>{node.name}</span>
                <span className="text-muted" style={{ fontSize: 12 }}>{node.count}</span>
            </button>
        );
        if (!node.childList.length) return [row];
        return [row, ...renderFolderTree(node.childList, depth + 1, activePath, onSelect)];
    });
}

export default function PublicFileExchangeModule(props: Props) {
    const { sessionToken, formatDate } = props;

    const [available, setAvailable] = useState(true);
    const [files, setFiles] = useState<PortalFileItemLike[]>([]);
    const [filesLoading, setFilesLoading] = useState(false);
    const [filesError, setFilesError] = useState<string | null>(null);
    const [uploadFolderPath, setUploadFolderPath] = useState('');
    const [newFolderName, setNewFolderName] = useState('');
    const [uploadComment, setUploadComment] = useState('');
    const [dragOverUpload, setDragOverUpload] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [filesSort, setFilesSort] = useState<'newest' | 'name' | 'folder'>('newest');
    const [filesFolderFilter, setFilesFolderFilter] = useState('');
    const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

    async function loadFiles() {
        setFilesLoading(true);
        setFilesError(null);
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
            setFilesError(err instanceof Error ? err.message : 'Dateien konnten nicht geladen werden.');
            setFiles([]);
        } finally {
            setFilesLoading(false);
        }
    }

    useEffect(() => {
        loadFiles();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionToken]);

    async function uploadFile(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!available) {
            setFilesError('Dateiaustausch-Plugin ist aktuell deaktiviert.');
            return;
        }
        if (selectedFiles.length === 0) {
            setFilesError('Bitte wählen Sie zuerst mindestens eine Datei aus.');
            return;
        }

        setFilesLoading(true);
        setFilesError(null);
        setUploadProgress({ done: 0, total: selectedFiles.length });
        try {
            const resolvedFolder = (newFolderName.trim() || uploadFolderPath.trim());
            let done = 0;
            for (const file of selectedFiles) {
                const formData = new FormData();
                formData.append('sessionToken', sessionToken);
                if (resolvedFolder) formData.append('folderPath', resolvedFolder);
                if (uploadComment.trim()) formData.append('comment', uploadComment.trim());
                formData.append('file', file);

                const res = await fetch(`/api/plugins/dateiaustausch/public/files/upload?sessionToken=${encodeURIComponent(sessionToken)}`, {
                    method: 'POST',
                    headers: {
                        'x-public-session-token': sessionToken,
                    },
                    body: formData,
                });
                const payload = await res.json().catch(() => ({}));
                if (res.status === 404) {
                    setAvailable(false);
                    throw new Error('Dateiaustausch-Plugin ist aktuell deaktiviert.');
                }
                if (!res.ok) throw new Error(payload?.error || `Upload fehlgeschlagen (${file.name}).`);
                done += 1;
                setUploadProgress({ done, total: selectedFiles.length });
            }

            setSelectedFiles([]);
            setUploadComment('');
            setNewFolderName('');
            await loadFiles();
        } catch (err) {
            setFilesError(err instanceof Error ? err.message : 'Upload fehlgeschlagen.');
        } finally {
            setUploadProgress(null);
            setFilesLoading(false);
        }
    }

    function onFileInputChange(fileList: FileList | null) {
        if (!fileList) {
            setSelectedFiles([]);
            return;
        }
        setSelectedFiles(Array.from(fileList));
    }

    function onDropFiles(fileList: FileList | null) {
        onFileInputChange(fileList);
        setDragOverUpload(false);
    }

    async function deleteFile(itemId: number) {
        if (!available) return;
        if (!window.confirm('Datei wirklich löschen?')) return;

        setFilesLoading(true);
        setFilesError(null);
        try {
            const res = await fetch(`/api/plugins/dateiaustausch/public/files/${itemId}?sessionToken=${encodeURIComponent(sessionToken)}`, {
                method: 'DELETE',
                headers: {
                    'x-public-session-token': sessionToken,
                },
            });
            const payload = await res.json().catch(() => ({}));
            if (res.status === 404) {
                setAvailable(false);
                throw new Error('Dateiaustausch-Plugin ist aktuell deaktiviert.');
            }
            if (!res.ok) throw new Error(payload?.error || 'Datei konnte nicht gelöscht werden.');
            await loadFiles();
        } catch (err) {
            setFilesError(err instanceof Error ? err.message : 'Datei konnte nicht gelöscht werden.');
        } finally {
            setFilesLoading(false);
        }
    }

    const folderOptions = useMemo(() => {
        const values = Array.from(new Set(files.map((entry) => String(entry.folderPath || '').trim()).filter(Boolean)));
        values.sort((a, b) => a.localeCompare(b, 'de'));
        return values;
    }, [files]);

    const visibleFiles = useMemo(() => {
        let list = files.slice();
        if (filesFolderFilter.trim()) {
            list = list.filter((entry) => String(entry.folderPath || '') === filesFolderFilter.trim());
        }
        if (filesSort === 'name') {
            list.sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || ''), 'de'));
        } else if (filesSort === 'folder') {
            list.sort((a, b) => `${a.folderPath || ''}/${a.displayName || ''}`.localeCompare(`${b.folderPath || ''}/${b.displayName || ''}`, 'de'));
        } else {
            list.sort((a, b) => new Date(String(b.updatedAt || 0)).getTime() - new Date(String(a.updatedAt || 0)).getTime());
        }
        return list;
    }, [files, filesFolderFilter, filesSort]);

    const folderTreeNodes = useMemo<FolderTreeNode[]>(() => {
        type Node = { name: string; path: string; children: Record<string, Node>; count: number };
        const root: Record<string, Node> = {};

        for (const entry of files) {
            const folder = String(entry.folderPath || '').trim();
            const segments = folder ? folder.split('/').filter(Boolean) : [];
            if (segments.length === 0) continue;
            let cursor = root;
            let currentPath = '';
            for (const segment of segments) {
                currentPath = currentPath ? `${currentPath}/${segment}` : segment;
                if (!cursor[segment]) {
                    cursor[segment] = { name: segment, path: currentPath, children: {}, count: 0 };
                }
                cursor[segment].count += 1;
                cursor = cursor[segment].children;
            }
        }

        const toArray = (nodes: Record<string, Node>): FolderTreeNode[] =>
            Object.values(nodes)
                .sort((a, b) => a.name.localeCompare(b.name, 'de'))
                .map((node) => ({ ...node, childList: toArray(node.children) }));

        return toArray(root);
    }, [files]);

    return (
        <div className="kp-coming-soon kp-module-shell">
            <h3 className="kp-module-title">Dateiaustausch</h3>
            {!available ? (
                <p className="text-muted" style={{ marginTop: 0 }}>
                    Das Plugin <strong>Dateiaustausch</strong> ist derzeit deaktiviert. Aktivieren Sie es in der Regie/Plugin-Verwaltung.
                </p>
            ) : null}
            <p className="text-muted kp-module-subtitle" style={{ marginTop: 0 }}>Sicherer Dateiaustausch wie eine private Cloud, mit Ordnerstruktur und Versionen.</p>

            <div className="kp-cloud-layout">
                <aside className="kp-module-block kp-cloud-sidebar">
                    <div className="kp-cloud-sidebar-head">
                        <h4>Ordner</h4>
                    </div>
                    <button
                        type="button"
                        className={`btn ${filesFolderFilter ? 'btn-secondary' : 'btn-primary'}`}
                        onClick={() => setFilesFolderFilter('')}
                    >
                        Alle Ordner
                    </button>
                    {renderFolderTree(folderTreeNodes, 0, filesFolderFilter, setFilesFolderFilter)}
                </aside>

                <div className="kp-cloud-main">
                    <form onSubmit={uploadFile} className="vp-stack">
                        <div
                            className={`kp-cloud-dropzone${dragOverUpload ? ' is-dragover' : ''}`}
                            onDragOver={(event) => {
                                event.preventDefault();
                                setDragOverUpload(true);
                            }}
                            onDragLeave={() => setDragOverUpload(false)}
                            onDrop={(event) => {
                                event.preventDefault();
                                onDropFiles(event.dataTransfer?.files || null);
                            }}
                        >
                            <p className="kp-cloud-dropzone-title">Dateien hier hineinziehen oder auswaehlen</p>
                            <p className="text-muted kp-cloud-dropzone-subtitle">Mehrere Dateien gleichzeitig moeglich.</p>
                            <input
                                className="input"
                                type="file"
                                multiple
                                onChange={(event) => onFileInputChange(event.target.files)}
                                accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.pdf,.doc,.docx,.xlsx,.pptx,.txt,.zip"
                                disabled={!available}
                                required
                            />
                            {selectedFiles.length > 0 && (
                                <p className="text-muted kp-cloud-selected-count">
                                    {selectedFiles.length} Datei(en) ausgewählt
                                </p>
                            )}
                        </div>
                        <select className="input" value={uploadFolderPath} onChange={(event) => setUploadFolderPath(event.target.value)}>
                            <option value="">Ordner auswählen (optional)</option>
                            {folderOptions.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
                        </select>
                        <input
                            className="input"
                            value={newFolderName}
                            onChange={(event) => setNewFolderName(event.target.value)}
                            disabled={!available}
                            placeholder="Oder neuen Ordner anlegen, z. B. Fotos/April"
                        />
                        <textarea
                            className="input"
                            rows={3}
                            value={uploadComment}
                            onChange={(event) => setUploadComment(event.target.value)}
                            disabled={!available}
                            placeholder="Kommentar zur Datei (optional)"
                        />
                        <button className="btn btn-primary" type="submit" disabled={filesLoading || !available}>
                            {filesLoading ? (uploadProgress ? `Lade hoch... (${uploadProgress.done}/${uploadProgress.total})` : 'Lade hoch...') : 'Dateien sicher hochladen'}
                        </button>
                    </form>

                    {filesError && <p className="text-danger" style={{ marginTop: 10 }}>{filesError}</p>}

                    <div className="kp-cloud-toolbar">
                        <select className="input" value={filesFolderFilter} onChange={(event) => setFilesFolderFilter(event.target.value)}>
                            <option value="">Alle Ordner</option>
                            {folderOptions.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
                        </select>
                        <select className="input" value={filesSort} onChange={(event) => setFilesSort(event.target.value as 'newest' | 'name' | 'folder')}>
                            <option value="newest">Sortierung: Neueste</option>
                            <option value="name">Sortierung: Dateiname</option>
                            <option value="folder">Sortierung: Ordner</option>
                        </select>
                    </div>

                    <div className="kp-module-table-wrap">
                        <table className="kp-module-table">
                            <thead>
                                <tr style={{ textAlign: 'left', background: 'var(--panel-muted)' }}>
                                    <th style={{ padding: '10px 12px' }}>Datei</th>
                                    <th style={{ padding: '10px 12px' }}>Ordner</th>
                                    <th style={{ padding: '10px 12px' }}>Status</th>
                                    <th style={{ padding: '10px 12px' }}>Version</th>
                                    <th style={{ padding: '10px 12px' }}>Aktualisiert</th>
                                    <th style={{ padding: '10px 12px' }}>Download</th>
                                    <th style={{ padding: '10px 12px' }}>Aktion</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleFiles.map((entry) => (
                                    <tr key={entry.id} style={{ borderTop: '1px solid var(--line)' }}>
                                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{entry.displayName}</td>
                                        <td style={{ padding: '10px 12px' }}>{entry.folderPath || 'Root'}</td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <span className={`kp-status-badge is-${entry.workflowStatus}`}>{formatWorkflowStatus(entry.workflowStatus)}</span>
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>V{entry.currentVersionNo || 0}</td>
                                        <td style={{ padding: '10px 12px' }}>{formatDate(entry.updatedAt)}</td>
                                        <td style={{ padding: '10px 12px' }}>
                                            {entry.currentVersionId && (entry.workflowStatus === 'clean' || entry.workflowStatus === 'reviewed') ? (
                                                <a
                                                    href={`/api/plugins/dateiaustausch/public/files/${entry.id}/versions/${entry.currentVersionId}/download?sessionToken=${encodeURIComponent(sessionToken)}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    Laden
                                                </a>
                                            ) : <span className="text-muted">Gesperrt</span>}
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <button className="btn btn-danger" type="button" onClick={() => deleteFile(entry.id)} disabled={filesLoading}>
                                                Löschen
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {!filesLoading && visibleFiles.length === 0 && (
                                    <tr>
                                        <td colSpan={7} style={{ padding: '12px' }} className="text-muted">
                                            Keine Dateien im gewählten Ordner.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
