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

type UploadSessionResponse = {
    provider: 'google_drive' | 'sharepoint';
    session: {
        provider: 'google_drive' | 'sharepoint';
        uploadUrl: string;
        method: 'PUT';
        chunkSizeBytes: number | null;
    };
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

export default function PublicGoogleDriveModule() {
    const sessionToken = useMemo(() => localStorage.getItem(STORAGE_SESSION_KEY) || '', []);
    const [entries, setEntries] = useState<Entry[]>([]);
    const [folderName, setFolderName] = useState('Kundenordner');
    const [baseFolderName, setBaseFolderName] = useState('Kundenordner');
    const [currentPath, setCurrentPath] = useState('');
    const [uploadFolderName, setUploadFolderName] = useState('');
    const [provider, setProvider] = useState<'google_drive' | 'sharepoint'>('google_drive');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
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

    async function onUpload(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!sessionToken || !selectedFile) return;

        setUploading(true);
        setUploadProgress(0);
        setError(null);
        setSuccess(null);
        try {
            const sessionRes = await fetch('/api/plugins/dateiaustausch_drive/public/files/upload/session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-public-session-token': sessionToken,
                },
                body: JSON.stringify({
                    fileName: selectedFile.name,
                    mimeType: selectedFile.type || 'application/octet-stream',
                    sizeBytes: selectedFile.size,
                }),
            });
            const sessionPayload = await sessionRes.json().catch(() => ({}));
            if (!sessionRes.ok) throw new Error(sessionPayload?.error || 'Upload-Session konnte nicht erstellt werden.');
            const uploadSession = sessionPayload as UploadSessionResponse;

            if (uploadSession.provider === 'google_drive') {
                const uploadRes = await fetch(uploadSession.session.uploadUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': selectedFile.type || 'application/octet-stream',
                    },
                    body: selectedFile,
                });
                if (!uploadRes.ok) {
                    const detail = await uploadRes.text().catch(() => '');
                    throw new Error(`Google-Upload fehlgeschlagen (${uploadRes.status}). ${detail}`);
                }
                setUploadProgress(100);
            } else {
                const chunkSize = uploadSession.session.chunkSizeBytes || 8 * 1024 * 1024;
                let offset = 0;
                while (offset < selectedFile.size) {
                    const next = Math.min(offset + chunkSize, selectedFile.size);
                    const chunk = selectedFile.slice(offset, next);
                    const uploadRes = await fetch(uploadSession.session.uploadUrl, {
                        method: 'PUT',
                        headers: {
                            'Content-Length': String(chunk.size),
                            'Content-Range': `bytes ${offset}-${next - 1}/${selectedFile.size}`,
                        },
                        body: chunk,
                    });
                    if (!(uploadRes.ok || uploadRes.status === 202)) {
                        const detail = await uploadRes.text().catch(() => '');
                        throw new Error(`SharePoint-Upload fehlgeschlagen (${uploadRes.status}). ${detail}`);
                    }
                    offset = next;
                    setUploadProgress(Math.round((offset / selectedFile.size) * 100));
                }
            }

            setSelectedFile(null);
            setSuccess('Datei erfolgreich hochgeladen.');
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen.');
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

    return (
        <div className="card dtxd-stack">
            <div>
                <h2 className="section-title">Dateiaustausch Cloud</h2>
                <p className="text-muted">
                    Provider: <strong>{provider === 'sharepoint' ? 'SharePoint' : 'Google Drive'}</strong>
                    {' '}· Aktueller Ordner: <strong>{folderName}</strong>
                    {uploadFolderName ? (
                        <>
                            {' '}· Upload-Ziel heute: <strong>{baseFolderName}/{uploadFolderName}</strong>
                        </>
                    ) : null}
                </p>
                <div className="dtxd-toolbar">
                    <button className="btn btn-secondary" type="button" onClick={() => openPath([])}>
                        Root
                    </button>
                    {pathParts.map((part, index) => (
                        <button
                            key={`${part}-${index}`}
                            className="btn btn-secondary"
                            type="button"
                            onClick={() => openPath(pathParts.slice(0, index + 1))}
                        >
                            {part}
                        </button>
                    ))}
                    <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() => openPath(pathParts.slice(0, -1))}
                        disabled={pathParts.length === 0}
                    >
                        Nach oben
                    </button>
                </div>
            </div>

            <form className="dtxd-toolbar" onSubmit={onUpload}>
                <input
                    className="input"
                    type="file"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    required
                />
                <button className="btn btn-primary" type="submit" disabled={uploading || !selectedFile}>
                    {uploading ? 'Lädt hoch...' : 'Datei hochladen'}
                </button>
                <button className="btn btn-secondary" type="button" onClick={load} disabled={loading}>
                    Aktualisieren
                </button>
            </form>

            {error ? <p className="text-danger">{error}</p> : null}
            {success ? <p className="text-success">{success}</p> : null}
            {uploadProgress !== null ? <p className="text-muted">Upload-Fortschritt: {uploadProgress}%</p> : null}

            <div className="dtxd-table-wrap">
                <table className="dtxd-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Typ</th>
                            <th>Größe</th>
                            <th>Geändert</th>
                            <th>Aktion</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={5} className="text-muted">Lade Dateien...</td></tr>
                        ) : entries.length === 0 ? (
                            <tr><td colSpan={5} className="text-muted">Keine Dateien vorhanden.</td></tr>
                        ) : entries.map((entry) => (
                            <tr key={entry.id}>
                                <td>
                                    {entry.name}
                                    {entry.isFolder && isDateFolderName(entry.name) && entry.name === todayIso ? (
                                        <span className="dtxd-tag-today">Heute</span>
                                    ) : null}
                                </td>
                                <td><span className="dtxd-pill">{entry.isFolder ? 'Ordner' : 'Datei'}</span></td>
                                <td>{entry.isFolder ? '-' : formatBytes(entry.size)}</td>
                                <td>{formatDate(entry.modifiedTime)}</td>
                                <td>
                                    {entry.isFolder ? (
                                        <button
                                            className="btn btn-secondary"
                                            type="button"
                                            onClick={() => openPath([...pathParts, entry.name])}
                                        >
                                            Öffnen
                                        </button>
                                    ) : (
                                        <button className="btn btn-secondary" type="button" onClick={() => download(entry.id, entry.name)}>
                                            Download
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
