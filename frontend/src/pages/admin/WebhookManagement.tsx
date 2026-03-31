import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../context/AuthContext';
import { useModal, useToast } from '../../components/ModalProvider';

interface Webhook {
    id: number;
    name: string;
    url: string;
    events: string[];
    is_active: boolean;
    created_at: string;
}

interface WebhookLog {
    id: number;
    event: string;
    status_code: number | null;
    error: string | null;
    duration_ms: number;
    created_at: string;
}

interface FormData {
    name: string;
    url: string;
    events: string;
    secret: string;
}

const EMPTY_FORM: FormData = { name: '', url: '', events: '', secret: '' };

export default function WebhookManagement() {
    const modal = useModal();
    const toast = useToast();
    const [webhooks, setWebhooks] = useState<Webhook[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<FormData>(EMPTY_FORM);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    // Log viewer
    const [logWebhookId, setLogWebhookId] = useState<number | null>(null);
    const [logWebhookName, setLogWebhookName] = useState('');
    const [logs, setLogs] = useState<WebhookLog[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);

    const fetchWebhooks = useCallback(async () => {
        try {
            const res = await apiFetch('/api/admin/webhooks');
            if (res.ok) setWebhooks(await res.json());
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

    const openCreate = () => {
        setEditId(null);
        setForm(EMPTY_FORM);
        setError('');
        setShowModal(true);
    };

    const openEdit = (wh: Webhook) => {
        setEditId(wh.id);
        setForm({
            name: wh.name,
            url: wh.url,
            events: wh.events.join(', '),
            secret: '',
        });
        setError('');
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!form.name.trim() || !form.url.trim() || !form.events.trim()) {
            setError('Name, URL und Events sind erforderlich');
            return;
        }

        const events = form.events.split(',').map((e) => e.trim()).filter(Boolean);
        if (events.length === 0) {
            setError('Mindestens ein Event ist erforderlich');
            return;
        }

        setSaving(true);
        setError('');

        try {
            const body: any = { name: form.name.trim(), url: form.url.trim(), events };
            if (!editId && form.secret.trim()) body.secret = form.secret.trim();

            const res = editId
                ? await apiFetch(`/api/admin/webhooks/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                : await apiFetch('/api/admin/webhooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Fehler beim Speichern');
                setSaving(false);
                return;
            }

            if (!editId) {
                const data = await res.json();
                if (data.secret) {
                    await modal.alert({
                        title: 'Webhook erstellt',
                        message: `Secret (nur jetzt sichtbar):\n\n${data.secret}\n\nBitte sicher aufbewahren!`,
                        variant: 'success',
                    });
                }
            }

            setShowModal(false);
            await fetchWebhooks();
        } catch {
            setError('Netzwerkfehler');
        }
        setSaving(false);
    };

    const handleDelete = async (id: number, name: string) => {
        const ok = await modal.confirm({ title: 'Webhook löschen', message: `Webhook "${name}" wirklich löschen?`, confirmText: 'Löschen', variant: 'danger' });
        if (!ok) return;
        await apiFetch(`/api/admin/webhooks/${id}`, { method: 'DELETE' });
        await fetchWebhooks();
    };

    const handleToggle = async (wh: Webhook) => {
        await apiFetch(`/api/admin/webhooks/${wh.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: !wh.is_active }),
        });
        await fetchWebhooks();
    };

    const handleTestPing = async (id: number) => {
        const res = await apiFetch(`/api/admin/webhooks/${id}/test`, { method: 'POST' });
        if (res.ok) {
            toast.success('Test-Event gesendet!');
        } else {
            toast.error('Fehler beim Senden des Test-Events');
        }
    };

    const openLogs = async (wh: Webhook) => {
        setLogWebhookId(wh.id);
        setLogWebhookName(wh.name);
        setLogsLoading(true);
        setLogs([]);
        try {
            const res = await apiFetch(`/api/admin/webhooks/${wh.id}/logs`);
            if (res.ok) setLogs(await res.json());
        } catch { /* ignore */ }
        setLogsLoading(false);
    };

    const formatDate = (d: string) => new Date(d).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    return (
        <div className="admin-page">
            <div className="admin-page-header" style={{ marginBottom: 'var(--space-md)' }}>
                <h2>Webhook-Verwaltung</h2>
                <button className="btn btn-primary" onClick={openCreate}>+ Webhook erstellen</button>
            </div>

            {loading ? (
                <p style={{ padding: 'var(--space-lg)', color: 'var(--color-text-muted)' }}>Lade...</p>
            ) : webhooks.length === 0 ? (
                <div className="card" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
                    <p style={{ color: 'var(--color-text-muted)' }}>Keine Webhooks konfiguriert.</p>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-sm)' }}>
                        Webhooks senden HTTP-POST-Requests an externe URLs wenn bestimmte Events im System auftreten.
                    </p>
                </div>
            ) : (
                <div className="card" style={{ overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>URL</th>
                                <th>Events</th>
                                <th style={{ width: 80 }}>Status</th>
                                <th style={{ width: 220 }}>Aktionen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {webhooks.map((wh) => (
                                <tr key={wh.id}>
                                    <td style={{ fontWeight: 600 }}>{wh.name}</td>
                                    <td style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {wh.url}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                            {wh.events.map((ev, i) => (
                                                <span key={i} style={{
                                                    fontSize: 'var(--font-size-xs)',
                                                    padding: '1px 6px',
                                                    borderRadius: 'var(--radius-sm)',
                                                    backgroundColor: 'var(--color-bg-secondary)',
                                                    border: '1px solid var(--color-border)',
                                                }}>{ev}</span>
                                            ))}
                                        </div>
                                    </td>
                                    <td>
                                        <button
                                            className={`btn btn-sm ${wh.is_active ? 'btn-success' : 'btn-secondary'}`}
                                            onClick={() => handleToggle(wh)}
                                            title={wh.is_active ? 'Deaktivieren' : 'Aktivieren'}
                                            style={{ minWidth: 60 }}
                                        >
                                            {wh.is_active ? 'Aktiv' : 'Aus'}
                                        </button>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                                            <button className="btn btn-sm btn-secondary" onClick={() => openEdit(wh)}>✏️</button>
                                            <button className="btn btn-sm btn-secondary" onClick={() => openLogs(wh)} title="Logs anzeigen">📋</button>
                                            <button className="btn btn-sm btn-secondary" onClick={() => handleTestPing(wh.id)} title="Test-Event senden">🔔</button>
                                            <button className="btn btn-sm btn-danger" onClick={() => handleDelete(wh.id, wh.name)} title="Löschen">🗑️</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
                        <div className="modal-header">
                            <h3>{editId ? 'Webhook bearbeiten' : 'Neuen Webhook erstellen'}</h3>
                            <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            {error && <div className="alert alert-danger" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}

                            <div className="form-group">
                                <label className="form-label">Name *</label>
                                <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z.B. Slack Notification" />
                            </div>

                            <div className="form-group">
                                <label className="form-label">URL * <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>(nur externe HTTPS-URLs)</span></label>
                                <input className="form-input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/webhook" />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Events * <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>(kommagetrennt)</span></label>
                                <input className="form-input" value={form.events} onChange={(e) => setForm({ ...form, events: e.target.value })} placeholder="user.created, user.*, *" />
                                <small style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}>
                                    Beispiele: <code>user.created</code>, <code>user.*</code> (alle User-Events), <code>*</code> (alle Events)
                                </small>
                            </div>

                            {!editId && (
                                <div className="form-group">
                                    <label className="form-label">Secret <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>(leer = automatisch generiert)</span></label>
                                    <input className="form-input" type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} placeholder="Wird automatisch generiert" />
                                </div>
                            )}
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Abbrechen</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                {saving ? 'Speichern...' : (editId ? 'Speichern' : 'Erstellen')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Log Viewer Modal */}
            {logWebhookId !== null && (
                <div className="modal-overlay" onClick={() => setLogWebhookId(null)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
                        <div className="modal-header">
                            <h3>Logs: {logWebhookName}</h3>
                            <button className="modal-close" onClick={() => setLogWebhookId(null)}>×</button>
                        </div>
                        <div className="modal-body" style={{ maxHeight: 400, overflowY: 'auto' }}>
                            {logsLoading ? (
                                <p style={{ color: 'var(--color-text-muted)' }}>Lade Logs...</p>
                            ) : logs.length === 0 ? (
                                <p style={{ color: 'var(--color-text-muted)' }}>Keine Logs vorhanden.</p>
                            ) : (
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Event</th>
                                            <th>Status</th>
                                            <th>Dauer</th>
                                            <th>Datum</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {logs.map((log) => (
                                            <tr key={log.id}>
                                                <td><code style={{ fontSize: 'var(--font-size-xs)' }}>{log.event}</code></td>
                                                <td>
                                                    {log.error ? (
                                                        <span style={{ color: '#ef4444', fontSize: 'var(--font-size-xs)' }} title={log.error}>❌ Fehler</span>
                                                    ) : (
                                                        <span style={{
                                                            color: (log.status_code || 0) < 300 ? '#22c55e' : '#f59e0b',
                                                            fontSize: 'var(--font-size-xs)',
                                                        }}>
                                                            {(log.status_code || 0) < 300 ? '✅' : '⚠️'} {log.status_code}
                                                        </span>
                                                    )}
                                                </td>
                                                <td style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{log.duration_ms}ms</td>
                                                <td style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{formatDate(log.created_at)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setLogWebhookId(null)}>Schließen</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
