import { FormEvent, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@mike/context/AuthContext';
import { useModal, useToast } from '@mike/components/ModalProvider';
import '../videoplattform.css';

type Customer = {
    id: number;
    name: string;
    createdAt: string;
    videoCount: number;
    activeCodeCount: number;
};

type Video = {
    id: number;
    title: string;
    description: string;
    sourceType: 'upload' | 'url';
    videoUrl: string | null;
    fileName: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    category: string;
    customerId: number | null;
    customerName: string | null;
    createdAt: string;
    activeCodeCount: number;
    streamUrl?: string;
};

type ShareCode = {
    id: number;
    code: string;
    scope: 'video' | 'customer';
    isActive: boolean;
    expiresAt: string | null;
    createdAt: string;
};

type ActivityLog = {
    id: number;
    createdAt: string;
    eventType: string;
    ip: string;
    code: string | null;
    success: boolean;
    detail: string | null;
    videoTitle: string | null;
    customerName: string | null;
};

type EditVideoState = {
    videoId: number;
    title: string;
    category: string;
    description: string;
    customerId: string;
    replacementFile: File | null;
    saving: boolean;
};

function formatDate(value: string | null | undefined): string {
    if (!value) return '—';
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

function formatBytes(value: number | null | undefined): string {
    const size = Number(value || 0);
    if (!Number.isFinite(size) || size <= 0) return '—';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function VideoPlatformAdminPage() {
    const toast = useToast();
    const modal = useModal();

    const [customers, setCustomers] = useState<Customer[]>([]);
    const [videos, setVideos] = useState<Video[]>([]);
    const [logs, setLogs] = useState<ActivityLog[]>([]);

    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [customerSource, setCustomerSource] = useState<'videoplattform' | 'crm'>('videoplattform');
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);

    const [newCustomerName, setNewCustomerName] = useState('');

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState('Allgemein');
    const [customerId, setCustomerId] = useState<string>('');
    const [videoType, setVideoType] = useState<'upload' | 'url'>('upload');
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoUrl, setVideoUrl] = useState('');

    const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
    const [videoCodes, setVideoCodes] = useState<ShareCode[]>([]);

    const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
    const [customerCodes, setCustomerCodes] = useState<ShareCode[]>([]);

    const [activeTab, setActiveTab] = useState<'videos' | 'customers' | 'activity'>('videos');
    const [editVideoState, setEditVideoState] = useState<EditVideoState | null>(null);

    const selectedVideo = useMemo(() => videos.find((item) => item.id === selectedVideoId) || null, [videos, selectedVideoId]);
    const selectedCustomer = useMemo(() => customers.find((item) => item.id === selectedCustomerId) || null, [customers, selectedCustomerId]);

    useEffect(() => {
        void reloadAll();
    }, []);

    useEffect(() => {
        if (customerSource === 'crm' && activeTab === 'customers') {
            setActiveTab('videos');
        }
    }, [customerSource, activeTab]);

    async function reloadAll() {
        setLoading(true);
        try {
            const [customersRes, videosRes, logsRes] = await Promise.all([
                apiFetch('/api/plugins/videoplattform/customers'),
                apiFetch('/api/plugins/videoplattform/videos'),
                apiFetch('/api/plugins/videoplattform/activity?limit=50'),
            ]);

            if (!customersRes.ok || !videosRes.ok || !logsRes.ok) {
                throw new Error('Daten konnten nicht geladen werden');
            }

            const sourceHeader = customersRes.headers.get('X-Videoplattform-Customer-Source');
            setCustomerSource(sourceHeader === 'crm' ? 'crm' : 'videoplattform');
            setCustomers(await customersRes.json());
            setVideos(await videosRes.json());
            setLogs(await logsRes.json());
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Laden fehlgeschlagen');
        } finally {
            setLoading(false);
        }
    }

    async function createCustomer(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!newCustomerName.trim()) return;
        setBusy(true);

        try {
            const res = await apiFetch('/api/plugins/videoplattform/customers', {
                method: 'POST',
                body: JSON.stringify({ name: newCustomerName.trim() }),
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload?.error || 'Kunde konnte nicht erstellt werden');
            }
            setNewCustomerName('');
            toast.success('Kunde erstellt');
            await reloadAll();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Kunde konnte nicht erstellt werden');
        } finally {
            setBusy(false);
        }
    }

    async function createVideo(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        setUploadProgress(null);

        try {
            let res: Response;
            if (videoType === 'upload') {
                if (!videoFile) {
                    throw new Error('Bitte zuerst eine Videodatei auswählen');
                }
                const data = new FormData();
                data.append('title', title.trim());
                data.append('description', description.trim());
                data.append('category', category.trim());
                if (customerId) data.append('customerId', customerId);
                data.append('file', videoFile);

                res = await uploadVideoWithProgress('/api/plugins/videoplattform/videos', data, (percent) => {
                    setUploadProgress(percent);
                });
            } else {
                res = await apiFetch('/api/plugins/videoplattform/videos', {
                    method: 'POST',
                    body: JSON.stringify({
                        title: title.trim(),
                        description: description.trim(),
                        category: category.trim(),
                        customerId: customerId || null,
                        videoUrl: videoUrl.trim(),
                    }),
                });
            }

            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload?.error || 'Video konnte nicht erstellt werden');
            }

            setTitle('');
            setDescription('');
            setCategory('Allgemein');
            setCustomerId('');
            setVideoUrl('');
            setVideoFile(null);
            setUploadProgress(null);
            toast.success('Video gespeichert');
            await reloadAll();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Video konnte nicht erstellt werden');
        } finally {
            setUploadProgress(null);
            setBusy(false);
        }
    }

    function uploadVideoWithProgress(url: string, formData: FormData, onProgress: (percent: number) => void): Promise<Response> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.withCredentials = true;

            xhr.upload.onprogress = (event) => {
                if (!event.lengthComputable) return;
                const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
                onProgress(percent);
            };

            xhr.onerror = () => reject(new Error('Upload fehlgeschlagen'));
            xhr.onload = () => {
                const body = xhr.responseText || '';
                resolve(new Response(body, {
                    status: xhr.status,
                    statusText: xhr.statusText,
                    headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/json' },
                }));
            };

            xhr.send(formData);
        });
    }

    async function deleteVideo(id: number) {
        const ok = await modal.confirm({
            title: 'Video löschen',
            message: 'Video wirklich löschen?',
            confirmText: 'Löschen',
            variant: 'danger',
        });
        if (!ok) return;

        setBusy(true);
        try {
            const res = await apiFetch(`/api/plugins/videoplattform/videos/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Video konnte nicht gelöscht werden');
            if (selectedVideoId === id) {
                setSelectedVideoId(null);
                setVideoCodes([]);
            }
            toast.success('Video gelöscht');
            await reloadAll();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Video konnte nicht gelöscht werden');
        } finally {
            setBusy(false);
        }
    }

    function openEditVideoModal(video: Video) {
        setEditVideoState({
            videoId: video.id,
            title: video.title || '',
            category: video.category || 'Allgemein',
            description: video.description || '',
            customerId: video.customerId ? String(video.customerId) : '',
            replacementFile: null,
            saving: false,
        });
    }

    function closeEditVideoModal() {
        if (editVideoState?.saving) return;
        setEditVideoState(null);
    }

    async function saveEditVideo(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!editVideoState) return;

        const snapshot = editVideoState;
        const nextTitle = snapshot.title.trim();
        if (!nextTitle) {
            toast.error('Titel ist erforderlich');
            return;
        }

        const nextCategory = snapshot.category.trim() || 'Allgemein';
        const nextDescription = snapshot.description;
        const nextCustomerId = snapshot.customerId ? Number(snapshot.customerId) : null;
        const validCustomerId = Number.isFinite(nextCustomerId as number) ? nextCustomerId : null;

        setEditVideoState((prev) => (prev ? { ...prev, saving: true } : prev));
        setBusy(true);
        try {
            const res = await apiFetch(`/api/plugins/videoplattform/videos/${snapshot.videoId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    title: nextTitle,
                    category: nextCategory,
                    description: nextDescription,
                    customerId: validCustomerId,
                }),
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload?.error || 'Video konnte nicht aktualisiert werden');
            }

            if (snapshot.replacementFile) {
                const formData = new FormData();
                formData.append('file', snapshot.replacementFile);
                const replaceRes = await apiFetch(`/api/plugins/videoplattform/videos/${snapshot.videoId}/replace`, {
                    method: 'POST',
                    body: formData,
                });
                if (!replaceRes.ok) {
                    const payload = await replaceRes.json().catch(() => ({}));
                    throw new Error(payload?.error || 'Videodatei konnte nicht ersetzt werden');
                }
            }

            toast.success('Video aktualisiert');
            await reloadAll();
            setEditVideoState(null);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Video konnte nicht aktualisiert werden');
        } finally {
            setEditVideoState((prev) => (prev ? { ...prev, saving: false } : prev));
            setBusy(false);
        }
    }

    async function deleteCustomer(id: number) {
        const ok = await modal.confirm({
            title: 'Kunde löschen',
            message: 'Kunde wirklich löschen?\nZugeordnete Videos bleiben erhalten, aber ohne Kundenzuordnung.',
            confirmText: 'Löschen',
            variant: 'danger',
        });
        if (!ok) return;

        setBusy(true);
        try {
            const res = await apiFetch(`/api/plugins/videoplattform/customers/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Kunde konnte nicht gelöscht werden');
            if (selectedCustomerId === id) {
                setSelectedCustomerId(null);
                setCustomerCodes([]);
            }
            toast.success('Kunde gelöscht');
            await reloadAll();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Kunde konnte nicht gelöscht werden');
        } finally {
            setBusy(false);
        }
    }

    async function loadVideoCodes(videoId: number) {
        setSelectedVideoId(videoId);
        try {
            const res = await apiFetch(`/api/plugins/videoplattform/videos/${videoId}/codes`);
            if (!res.ok) throw new Error('Codes konnten nicht geladen werden');
            const payload = await res.json();
            setVideoCodes(Array.isArray(payload.items) ? payload.items : []);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Codes konnten nicht geladen werden');
            setVideoCodes([]);
        }
    }

    async function loadCustomerCodes(customerIdValue: number) {
        setSelectedCustomerId(customerIdValue);
        try {
            const res = await apiFetch(`/api/plugins/videoplattform/customers/${customerIdValue}/codes`);
            if (!res.ok) throw new Error('Codes konnten nicht geladen werden');
            const payload = await res.json();
            setCustomerCodes(Array.isArray(payload.items) ? payload.items : []);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Codes konnten nicht geladen werden');
            setCustomerCodes([]);
        }
    }

    async function createVideoCode(videoId: number) {
        setBusy(true);
        try {
            const res = await apiFetch(`/api/plugins/videoplattform/videos/${videoId}/codes`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            if (!res.ok) throw new Error('Code konnte nicht erstellt werden');
            toast.success('Video-Code erstellt');
            await Promise.all([reloadAll(), loadVideoCodes(videoId)]);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Code konnte nicht erstellt werden');
        } finally {
            setBusy(false);
        }
    }

    async function createCustomerCode(customerIdValue: number) {
        setBusy(true);
        try {
            const res = await apiFetch(`/api/plugins/videoplattform/customers/${customerIdValue}/codes`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            if (!res.ok) throw new Error('Code konnte nicht erstellt werden');
            toast.success('Kunden-Code erstellt');
            await Promise.all([reloadAll(), loadCustomerCodes(customerIdValue)]);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Code konnte nicht erstellt werden');
        } finally {
            setBusy(false);
        }
    }

    async function toggleCode(item: ShareCode) {
        setBusy(true);
        try {
            const res = await apiFetch(`/api/plugins/videoplattform/codes/${item.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ isActive: !item.isActive }),
            });
            if (!res.ok) throw new Error('Code konnte nicht aktualisiert werden');
            toast.success('Code aktualisiert');
            if (item.scope === 'video' && selectedVideoId) {
                await Promise.all([reloadAll(), loadVideoCodes(selectedVideoId)]);
            }
            if (item.scope === 'customer' && selectedCustomerId) {
                await Promise.all([reloadAll(), loadCustomerCodes(selectedCustomerId)]);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Code konnte nicht aktualisiert werden');
        } finally {
            setBusy(false);
        }
    }

    async function deleteCode(item: ShareCode) {
        const ok = await modal.confirm({
            title: 'Freigabecode löschen',
            message: `Code ${item.code} wirklich löschen?`,
            confirmText: 'Löschen',
            variant: 'danger',
        });
        if (!ok) return;

        setBusy(true);
        try {
            const res = await apiFetch(`/api/plugins/videoplattform/codes/${item.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Code konnte nicht gelöscht werden');
            toast.success('Code gelöscht');
            if (item.scope === 'video' && selectedVideoId) {
                await Promise.all([reloadAll(), loadVideoCodes(selectedVideoId)]);
            }
            if (item.scope === 'customer' && selectedCustomerId) {
                await Promise.all([reloadAll(), loadCustomerCodes(selectedCustomerId)]);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Code konnte nicht gelöscht werden');
        } finally {
            setBusy(false);
        }
    }

    if (loading) {
        return <div className="text-muted">Videoplattform wird geladen...</div>;
    }

    return (
        <div className="vp-admin-page">
            <div className="vp-admin-shell">
                <aside className="vp-admin-sidebar">
                    <div className="vp-admin-brand">Videoplattform</div>
                    <p className="text-muted">Videos und Codes</p>

                    <div className="vp-sidebar-nav">
                        <button className={`btn ${activeTab === 'videos' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('videos')}>Videos</button>
                        {customerSource !== 'crm' && (
                            <button className={`btn ${activeTab === 'customers' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('customers')}>Kunden</button>
                        )}
                        <button className={`btn ${activeTab === 'activity' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab('activity')}>Aktivität</button>
                    </div>

                    <div className="vp-sidebar-stats">
                        <div><strong>{videos.length}</strong> Videos</div>
                        <div><strong>{customers.length}</strong> Kunden</div>
                        <div><strong>{logs.length}</strong> Logs</div>
                    </div>
                </aside>

                <div className="vp-admin-content">
                    <div className="page-header vp-header-card">
                        <h1 className="page-title">Videos & Freigabecodes</h1>
                        <p className="page-subtitle">Zentrale Verwaltung für Inhalte, Kunden und Zugriffscodes</p>
                    </div>

            {activeTab === 'videos' && (
                <>
                    <div className="card vp-panel">
                        <div className="card-title">Neues Video</div>
                        <form onSubmit={createVideo} className="vp-form-grid">
                            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel" required />
                            <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Kategorie" />
                            <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                                <option value="">Kein Kunde</option>
                                {customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                            <select className="input" value={videoType} onChange={(e) => setVideoType(e.target.value as 'upload' | 'url')}>
                                <option value="upload">Datei-Upload</option>
                                <option value="url">Externe Video-URL</option>
                            </select>
                            <textarea className="input vp-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Beschreibung" />

                            {videoType === 'upload' ? (
                                <>
                                    <input className="input" type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} required />
                                    {busy && uploadProgress !== null && (
                                        <div className="vp-upload-progress">
                                            <div className="vp-upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
                                            <span>{uploadProgress}%</span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <input className="input" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://..." required />
                            )}

                            <button className="btn btn-primary" type="submit" disabled={busy}>Video speichern</button>
                        </form>
                    </div>

                    <div className="card vp-panel" style={{ marginTop: 'var(--space-md)' }}>
                        <div className="card-title">Videos ({videos.length})</div>
                        <div className="vp-video-grid" style={{ marginTop: 'var(--space-sm)' }}>
                            {videos.map((video) => (
                                <article key={video.id} className="vp-video-card">
                                    <div className="vp-video-preview">
                                        {video.sourceType === 'upload' ? (
                                            <video
                                                controls
                                                playsInline
                                                preload="metadata"
                                                controlsList="nodownload"
                                                src={`/api/plugins/videoplattform/videos/${video.id}/stream`}
                                            />
                                        ) : (
                                            <a className="btn btn-primary" href={video.videoUrl || '#'} target="_blank" rel="noreferrer">
                                                Externes Video öffnen
                                            </a>
                                        )}
                                    </div>
                                    <div className="vp-video-body">
                                        <h3>{video.title}</h3>
                                        <p className="text-muted">
                                            {video.customerName || 'Ohne Kunde'} | {video.category} | {formatBytes(video.sizeBytes)}
                                        </p>
                                        <p className="text-muted">Aktive Codes: {video.activeCodeCount} | Erstellt: {formatDate(video.createdAt)}</p>
                                        {video.description ? <p>{video.description}</p> : null}
                                    </div>
                                    <div className="vp-action-row" style={{ padding: '0 var(--space-md) var(--space-md) var(--space-md)' }}>
                                        <button className="btn btn-secondary" onClick={() => openEditVideoModal(video)} disabled={busy}>Bearbeiten</button>
                                        <button className="btn btn-secondary" onClick={() => loadVideoCodes(video.id)}>Codes anzeigen</button>
                                        <button className="btn btn-secondary" onClick={() => createVideoCode(video.id)} disabled={busy}>Code erstellen</button>
                                        <button className="btn btn-danger" onClick={() => deleteVideo(video.id)} disabled={busy}>Löschen</button>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>

                    {selectedVideo && (
                        <div className="card vp-panel" style={{ marginTop: 'var(--space-md)' }}>
                            <div className="card-title">Codes für Video: {selectedVideo.title}</div>
                            <div className="vp-code-list" style={{ marginTop: 'var(--space-sm)' }}>
                                {videoCodes.length === 0 && <p className="text-muted">Noch keine Codes vorhanden.</p>}
                                {videoCodes.map((item) => (
                                    <div key={item.id} className="vp-code-row">
                                        <code>{item.code}</code>
                                        <span className={`badge ${item.isActive ? 'badge-success' : 'badge-danger'}`}>
                                            {item.isActive ? 'Aktiv' : 'Inaktiv'}
                                        </span>
                                        <span className="text-muted">Ablauf: {formatDate(item.expiresAt)}</span>
                                        <button className="btn btn-secondary" onClick={() => toggleCode(item)} disabled={busy}>
                                            {item.isActive ? 'Deaktivieren' : 'Aktivieren'}
                                        </button>
                                        <button className="btn btn-danger" onClick={() => deleteCode(item)} disabled={busy}>Löschen</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {activeTab === 'customers' && (
                <>
                    {customerSource === 'crm' ? (
                        <div className="card vp-panel">
                            <div className="card-title">Kundenquelle</div>
                            <p className="text-muted">Kunden werden aus dem CRM-Plugin synchronisiert. Anlage und Löschen erfolgt im CRM.</p>
                        </div>
                    ) : (
                        <div className="card vp-panel">
                            <div className="card-title">Neuer Kunde</div>
                            <form onSubmit={createCustomer} className="vp-inline-form">
                                <input className="input" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} placeholder="Kundenname" required />
                                <button className="btn btn-primary" type="submit" disabled={busy}>Kunde erstellen</button>
                            </form>
                        </div>
                    )}

                    <div className="card vp-panel" style={{ marginTop: 'var(--space-md)' }}>
                        <div className="card-title">Kunden ({customers.length})</div>
                        <div className="vp-list" style={{ marginTop: 'var(--space-sm)' }}>
                            {customers.map((customer) => (
                                <article key={customer.id} className="vp-item">
                                    <div className="vp-item-main">
                                        <strong>{customer.name}</strong>
                                        <p className="text-muted">Videos: {customer.videoCount} • Aktive Codes: {customer.activeCodeCount}</p>
                                    </div>
                                    <div className="vp-item-actions">
                                        <button className="btn btn-secondary" onClick={() => loadCustomerCodes(customer.id)}>Codes anzeigen</button>
                                        <button className="btn btn-secondary" onClick={() => createCustomerCode(customer.id)} disabled={busy}>Code erstellen</button>
                                        {customerSource !== 'crm' && (
                                            <button className="btn btn-danger" onClick={() => deleteCustomer(customer.id)} disabled={busy}>Löschen</button>
                                        )}
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>

                    {selectedCustomer && (
                        <div className="card vp-panel" style={{ marginTop: 'var(--space-md)' }}>
                            <div className="card-title">Codes für Kunde: {selectedCustomer.name}</div>
                            <div className="vp-code-list" style={{ marginTop: 'var(--space-sm)' }}>
                                {customerCodes.length === 0 && <p className="text-muted">Noch keine Codes vorhanden.</p>}
                                {customerCodes.map((item) => (
                                    <div key={item.id} className="vp-code-row">
                                        <code>{item.code}</code>
                                        <span className={`badge ${item.isActive ? 'badge-success' : 'badge-danger'}`}>
                                            {item.isActive ? 'Aktiv' : 'Inaktiv'}
                                        </span>
                                        <span className="text-muted">Ablauf: {formatDate(item.expiresAt)}</span>
                                        <button className="btn btn-secondary" onClick={() => toggleCode(item)} disabled={busy}>
                                            {item.isActive ? 'Deaktivieren' : 'Aktivieren'}
                                        </button>
                                        <button className="btn btn-danger" onClick={() => deleteCode(item)} disabled={busy}>Löschen</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {activeTab === 'activity' && (
                <div className="card vp-panel">
                    <div className="card-title">Aktivitätsprotokoll</div>
                    <div className="table-container" style={{ marginTop: 'var(--space-sm)' }}>
                        <table>
                            <thead>
                                <tr>
                                    <th>Zeit</th>
                                    <th>Event</th>
                                    <th>Code</th>
                                    <th>Video</th>
                                    <th>Kunde</th>
                                    <th>Status</th>
                                    <th>IP</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((log) => (
                                    <tr key={log.id}>
                                        <td>{formatDate(log.createdAt)}</td>
                                        <td>{log.eventType}</td>
                                        <td><code>{log.code || '—'}</code></td>
                                        <td>{log.videoTitle || '—'}</td>
                                        <td>{log.customerName || '—'}</td>
                                        <td>
                                            <span className={`badge ${log.success ? 'badge-success' : 'badge-danger'}`}>
                                                {log.success ? 'OK' : 'Fehler'}
                                            </span>
                                        </td>
                                        <td>{log.ip || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
                </div>
            </div>

            {editVideoState && (
                <div className="modal-overlay" style={{ zIndex: 10000 }} onClick={closeEditVideoModal}>
                    <div className="modal-card vp-edit-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Video bearbeiten</h3>
                            <button className="modal-close" onClick={closeEditVideoModal}>×</button>
                        </div>

                        <form className="vp-edit-form" onSubmit={saveEditVideo}>
                            <div className="vp-edit-grid">
                                <div className="vp-settings">
                                    <label className="form-label">Titel</label>
                                    <input
                                        className="input"
                                        value={editVideoState.title}
                                        onChange={(event) => setEditVideoState((prev) => prev ? { ...prev, title: event.target.value } : prev)}
                                        required
                                    />
                                </div>
                                <div className="vp-settings">
                                    <label className="form-label">Kategorie</label>
                                    <input
                                        className="input"
                                        value={editVideoState.category}
                                        onChange={(event) => setEditVideoState((prev) => prev ? { ...prev, category: event.target.value } : prev)}
                                    />
                                </div>
                            </div>

                            <div className="vp-settings">
                                <label className="form-label">Kunde</label>
                                <select
                                    className="input"
                                    value={editVideoState.customerId}
                                    onChange={(event) => setEditVideoState((prev) => prev ? { ...prev, customerId: event.target.value } : prev)}
                                >
                                    <option value="">Kein Kunde</option>
                                    {customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                                </select>
                            </div>

                            <div className="vp-settings">
                                <label className="form-label">Beschreibung</label>
                                <textarea
                                    className="input vp-textarea"
                                    value={editVideoState.description}
                                    onChange={(event) => setEditVideoState((prev) => prev ? { ...prev, description: event.target.value } : prev)}
                                />
                            </div>

                            <div className="vp-settings">
                                <label className="form-label">Videodatei ersetzen (optional)</label>
                                <input
                                    className="input"
                                    type="file"
                                    accept="video/*"
                                    onChange={(event) => setEditVideoState((prev) => prev ? { ...prev, replacementFile: event.target.files?.[0] || null } : prev)}
                                />
                                {editVideoState.replacementFile && (
                                    <p className="text-muted" style={{ marginTop: '6px' }}>{editVideoState.replacementFile.name}</p>
                                )}
                            </div>

                            <div className="modal-actions">
                                <button className="btn btn-secondary" type="button" onClick={closeEditVideoModal} disabled={editVideoState.saving}>
                                    Schließen
                                </button>
                                <button className="btn btn-primary" type="submit" disabled={editVideoState.saving}>
                                    {editVideoState.saving ? 'Speichert...' : 'Änderungen speichern'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
