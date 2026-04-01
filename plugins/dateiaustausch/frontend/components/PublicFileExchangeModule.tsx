import { FormEvent, useEffect, useMemo, useState } from 'react';

type PortalFileItemLike = {
    id: number;
    folderPath: string;
    displayName: string;
    workflowStatus: 'pending' | 'clean' | 'rejected' | 'reviewed';
    currentVersionId: number | null;
    currentVersionNo: number | null;
    updatedAt: string | null;
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

function buildDownloadUrl(item: PortalFileItemLike, sessionToken: string): string {
    return `/api/plugins/dateiaustausch/public/files/${item.id}/versions/${item.currentVersionId}/download?sessionToken=${encodeURIComponent(sessionToken)}`;
}

function getFileExt(name: string): string {
    const raw = String(name || '').trim().toLowerCase();
    const index = raw.lastIndexOf('.');
    if (index <= 0 || index === raw.length - 1) return '';
    return raw.slice(index + 1);
}

function isImageExt(ext: string): boolean {
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext);
}

function isPdfExt(ext: string): boolean {
    return ext === 'pdf';
}

export default function PublicFileExchangeModule({ sessionToken, formatDate }: Props) {
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
    const [searchQuery, setSearchQuery] = useState('');

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
        const query = searchQuery.trim().toLowerCase();
        if (query) {
            list = list.filter((entry) => {
                const haystack = `${entry.displayName} ${entry.folderPath}`.toLowerCase();
                return haystack.includes(query);
            });
        }
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
    }, [files, filesFolderFilter, filesSort, searchQuery]);

    const previewFiles = useMemo(
        () => visibleFiles.filter((item) => item.currentVersionId && (item.workflowStatus === 'clean' || item.workflowStatus === 'reviewed')),
        [visibleFiles],
    );

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

    return (
        <section className="kp-uploader-shell">
            <header className="kp-uploader-head">
                <div>
                    <h3 className="kp-module-title">Dateiaustausch</h3>
                    <p className="kp-module-subtitle">Private Cloud für sicheren Upload, Ordner und Versionen.</p>
                </div>
                <button className="btn btn-secondary" type="button" onClick={() => loadFiles()}>
                    Aktualisieren
                </button>
            </header>

            {!available ? (
                <p className="text-muted">
                    Das Plugin <strong>Dateiaustausch</strong> ist derzeit deaktiviert. Aktivieren Sie es in der Regie/Plugin-Verwaltung.
                </p>
            ) : null}

            <form onSubmit={uploadFile} className="kp-uploader-board">
                <div
                    className={`kp-uploader-dropzone${dragOverUpload ? ' is-dragover' : ''}`}
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
                    <div className="kp-uploader-dropzone-copy">
                        <strong>Dateien hier ablegen</strong>
                        <span>oder über den Button auswählen</span>
                    </div>
                    <label className="btn btn-primary kp-uploader-file-btn">
                        Dateien auswählen
                        <input
                            className="kp-uploader-file-input"
                            type="file"
                            multiple
                            onChange={(event) => onFileInputChange(event.target.files)}
                            accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.pdf,.doc,.docx,.xlsx,.pptx,.txt,.zip"
                            disabled={!available}
                        />
                    </label>
                </div>

                <div className="kp-uploader-controls">
                    <select className="input" value={uploadFolderPath} onChange={(event) => setUploadFolderPath(event.target.value)}>
                        <option value="">Zielordner wählen</option>
                        {folderOptions.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
                    </select>
                    <input
                        className="input"
                        value={newFolderName}
                        onChange={(event) => setNewFolderName(event.target.value)}
                        disabled={!available}
                        placeholder="Neuen Ordner anlegen (optional)"
                    />
                    <input
                        className="input"
                        value={uploadComment}
                        onChange={(event) => setUploadComment(event.target.value)}
                        disabled={!available}
                        placeholder="Kommentar (optional)"
                    />
                    <button className="btn btn-primary" type="submit" disabled={filesLoading || !available || selectedFiles.length === 0}>
                        {filesLoading ? (uploadProgress ? `Upload ${uploadProgress.done}/${uploadProgress.total}` : 'Upload läuft...') : 'Sicher hochladen'}
                    </button>
                </div>

                {selectedFiles.length > 0 ? (
                    <div className="kp-uploader-selected">
                        {selectedFiles.map((file) => (
                            <span key={`${file.name}-${file.size}-${file.lastModified}`} className="kp-uploader-pill">
                                {file.name}
                            </span>
                        ))}
                    </div>
                ) : null}
            </form>

            {filesError && <p className="text-danger" style={{ marginTop: 8 }}>{filesError}</p>}

            <div className="kp-uploader-toolbar">
                <input
                    className="input"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Dateien und Ordner durchsuchen"
                />
                <select className="input" value={filesFolderFilter} onChange={(event) => setFilesFolderFilter(event.target.value)}>
                    <option value="">Alle Ordner</option>
                    {folderOptions.map((folder) => <option key={folder} value={folder}>{folder}</option>)}
                </select>
                <select className="input" value={filesSort} onChange={(event) => setFilesSort(event.target.value as 'newest' | 'name' | 'folder')}>
                    <option value="newest">Neueste</option>
                    <option value="name">Dateiname</option>
                    <option value="folder">Ordner</option>
                </select>
            </div>

            <div className="kp-uploader-preview-grid">
                {previewFiles.map((entry) => {
                    const ext = getFileExt(entry.displayName);
                    const canImagePreview = isImageExt(ext);
                    const isPdf = isPdfExt(ext);
                    const downloadUrl = buildDownloadUrl(entry, sessionToken);
                    return (
                        <article key={`preview-${entry.id}`} className="kp-uploader-preview-card">
                            <div className="kp-uploader-preview-media">
                                {canImagePreview ? (
                                    <img src={downloadUrl} alt={entry.displayName} loading="lazy" />
                                ) : (
                                    <div className="kp-uploader-preview-filetype">
                                        {isPdf ? 'PDF' : (ext || 'DATEI').toUpperCase()}
                                    </div>
                                )}
                            </div>
                            <div className="kp-uploader-preview-body">
                                <strong title={entry.displayName}>{entry.displayName}</strong>
                                <span className="text-muted">{entry.folderPath || 'Root'} • {formatDate(entry.updatedAt)}</span>
                            </div>
                        </article>
                    );
                })}
                {!filesLoading && previewFiles.length === 0 && (
                    <div className="kp-uploader-preview-empty text-muted">
                        Noch keine freigegebenen Dateien für Vorschau verfügbar.
                    </div>
                )}
            </div>

            <div className="kp-uploader-table-wrap">
                <table className="kp-module-table kp-drive-table">
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
                                <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                                    <span className="kp-drive-file">
                                        <span className="kp-drive-file-icon" aria-hidden="true" />
                                        <span>{entry.displayName}</span>
                                    </span>
                                </td>
                                <td style={{ padding: '10px 12px' }}>{entry.folderPath || 'Root'}</td>
                                <td style={{ padding: '10px 12px' }}>
                                    <span className={`kp-status-badge is-${entry.workflowStatus}`}>{formatWorkflowStatus(entry.workflowStatus)}</span>
                                </td>
                                <td style={{ padding: '10px 12px' }}>V{entry.currentVersionNo || 0}</td>
                                <td style={{ padding: '10px 12px' }}>{formatDate(entry.updatedAt)}</td>
                                <td style={{ padding: '10px 12px' }}>
                                    {entry.currentVersionId && (entry.workflowStatus === 'clean' || entry.workflowStatus === 'reviewed') ? (
                                        <a href={buildDownloadUrl(entry, sessionToken)} target="_blank" rel="noreferrer">Laden</a>
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
                                    Keine Dateien vorhanden.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
