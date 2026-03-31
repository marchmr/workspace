import { useState, useEffect } from 'react';
import { apiFetch } from '../../context/AuthContext';

interface EmailAccount {
    id: number;
    name: string;
    provider: string;
    smtp_host: string | null;
    smtp_port: number | null;
    smtp_user: string | null;
    smtp_password: string | null;
    smtp_secure: boolean;
    from_address: string | null;
    from_name: string | null;
    is_default: boolean;
    created_at: string;
    updated_at: string;
}

const emptyAccount: Omit<EmailAccount, 'id' | 'created_at' | 'updated_at'> = {
    name: '',
    provider: 'smtp',
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
    smtp_secure: true,
    from_address: '',
    from_name: '',
    is_default: false,
};

export default function EmailAccounts() {
    const [accounts, setAccounts] = useState<EmailAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<number | 'new' | null>(null);
    const [form, setForm] = useState<any>(emptyAccount);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [testEmail, setTestEmail] = useState('');
    const [testingId, setTestingId] = useState<number | null>(null);

    useEffect(() => { loadAccounts(); }, []);

    const loadAccounts = async () => {
        try {
            const res = await apiFetch('/api/admin/email/accounts');
            if (res.ok) setAccounts(await res.json());
        } catch { /* */ }
        setLoading(false);
    };

    const handleNew = () => {
        setEditingId('new');
        setForm({ ...emptyAccount });
        setMessage(null);
    };

    const handleEdit = (account: EmailAccount) => {
        setEditingId(account.id);
        setForm({
            name: account.name,
            provider: account.provider,
            smtp_host: account.smtp_host || '',
            smtp_port: account.smtp_port || 587,
            smtp_user: account.smtp_user || '',
            smtp_password: account.smtp_password || '',
            smtp_secure: account.smtp_secure,
            from_address: account.from_address || '',
            from_name: account.from_name || '',
            is_default: account.is_default,
        });
        setMessage(null);
    };

    const handleCancel = () => {
        setEditingId(null);
        setMessage(null);
    };

    const handleSave = async () => {
        if (!form.name.trim()) {
            setMessage({ type: 'error', text: 'Name ist erforderlich' });
            return;
        }
        setSaving(true);
        setMessage(null);
        try {
            const isNew = editingId === 'new';
            const url = isNew ? '/api/admin/email/accounts' : `/api/admin/email/accounts/${editingId}`;
            const res = await apiFetch(url, {
                method: isNew ? 'POST' : 'PUT',
                body: JSON.stringify(form),
            });
            if (res.ok) {
                setMessage({ type: 'success', text: isNew ? 'Konto erstellt' : 'Konto gespeichert' });
                setEditingId(null);
                await loadAccounts();
            } else {
                const err = await res.json().catch(() => ({ error: 'Fehler' }));
                setMessage({ type: 'error', text: err.error || 'Fehler beim Speichern' });
            }
        } catch {
            setMessage({ type: 'error', text: 'Netzwerkfehler' });
        }
        setSaving(false);
    };

    const handleDelete = async (id: number) => {
        if (!confirm('E-Mail-Konto wirklich loeschen?')) return;
        try {
            const res = await apiFetch(`/api/admin/email/accounts/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setMessage({ type: 'success', text: 'Konto geloescht' });
                await loadAccounts();
            }
        } catch { /* */ }
    };

    const handleSetDefault = async (id: number) => {
        try {
            const account = accounts.find(a => a.id === id);
            if (!account) return;
            await apiFetch(`/api/admin/email/accounts/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ ...account, is_default: true, smtp_password: '••••••' }),
            });
            await loadAccounts();
            setMessage({ type: 'success', text: 'Standard-Konto gesetzt' });
        } catch { /* */ }
    };

    const handleTest = async (accountId: number) => {
        if (!testEmail.trim()) return;
        setTestingId(accountId);
        setMessage(null);
        try {
            const res = await apiFetch(`/api/admin/email/accounts/${accountId}/test`, {
                method: 'POST',
                body: JSON.stringify({ to: testEmail }),
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: 'success', text: data.message || 'Test-E-Mail gesendet' });
            } else {
                setMessage({ type: 'error', text: data.error || 'Fehler beim Senden' });
            }
        } catch {
            setMessage({ type: 'error', text: 'Netzwerkfehler' });
        }
        setTestingId(null);
    };

    if (loading) return <div className="text-muted">Laden...</div>;

    return (
        <div>
            <div className="page-header">
                <div className="flex-between">
                    <div>
                        <h1 className="page-title">E-Mail-Konten</h1>
                        <p className="page-subtitle">SMTP- und E-Mail-Konten fuer den Systemversand verwalten</p>
                    </div>
                    {editingId === null && (
                        <button className="btn btn-primary" onClick={handleNew}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            {' '}Konto hinzufuegen
                        </button>
                    )}
                </div>
            </div>

            {message && (
                <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: 'var(--space-md)' }}>
                    {message.text}
                </div>
            )}

            {/* Formular: Erstellen / Bearbeiten */}
            {editingId !== null && (
                <div className="card mb-md">
                    <div className="card-title">{editingId === 'new' ? 'Neues E-Mail-Konto' : 'Konto bearbeiten'}</div>
                    <div style={{ marginTop: 'var(--space-md)', display: 'grid', gap: 'var(--space-md)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                            <div className="form-group">
                                <label className="form-label">Anzeigename *</label>
                                <input
                                    className="form-input"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="z.B. Benachrichtigungen, Support, Rechnungen"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Provider</label>
                                <select className="form-input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                                    <option value="smtp">SMTP</option>
                                    <option value="m365">Microsoft 365 (bald verfuegbar)</option>
                                </select>
                            </div>
                        </div>

                        {form.provider === 'smtp' && (
                            <>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 'var(--space-md)' }}>
                                    <div className="form-group">
                                        <label className="form-label">SMTP Host</label>
                                        <input className="form-input" value={form.smtp_host} onChange={(e) => setForm({ ...form, smtp_host: e.target.value })} placeholder="smtp.example.com" />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Port</label>
                                        <input className="form-input" type="number" value={form.smtp_port} onChange={(e) => setForm({ ...form, smtp_port: parseInt(e.target.value, 10) || 587 })} placeholder="587" />
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                                    <div className="form-group">
                                        <label className="form-label">Benutzername</label>
                                        <input className="form-input" value={form.smtp_user} onChange={(e) => setForm({ ...form, smtp_user: e.target.value })} placeholder="user@example.com" />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Passwort</label>
                                        <input className="form-input" type="password" value={form.smtp_password} onChange={(e) => setForm({ ...form, smtp_password: e.target.value })} placeholder="••••••" />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">TLS/SSL</label>
                                    <select className="form-input" value={form.smtp_secure ? 'true' : 'false'} onChange={(e) => setForm({ ...form, smtp_secure: e.target.value === 'true' })}>
                                        <option value="true">Ja (empfohlen)</option>
                                        <option value="false">Nein</option>
                                    </select>
                                </div>
                            </>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                            <div className="form-group">
                                <label className="form-label">Absender-Adresse</label>
                                <input className="form-input" value={form.from_address} onChange={(e) => setForm({ ...form, from_address: e.target.value })} placeholder="noreply@firma.de" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Absender-Name</label>
                                <input className="form-input" value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} placeholder="MIKE System" />
                            </div>
                        </div>

                        <div className="form-group">
                            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={form.is_default}
                                    onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                                />
                                Als Standard-Konto verwenden
                            </label>
                            <small className="text-muted" style={{ display: 'block', marginTop: 4 }}>
                                Das Standard-Konto wird verwendet, wenn ein Plugin keinen bestimmten Account auswaehlt.
                            </small>
                        </div>

                        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                {saving ? 'Speichern...' : 'Speichern'}
                            </button>
                            <button className="btn" onClick={handleCancel}>Abbrechen</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Kontenliste */}
            {accounts.length === 0 && editingId === null ? (
                <div className="card">
                    <div className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3, marginBottom: 'var(--space-md)' }}>
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                            <polyline points="22,6 12,13 2,6"/>
                        </svg>
                        <div>Noch keine E-Mail-Konten konfiguriert.</div>
                        <button className="btn btn-primary" style={{ marginTop: 'var(--space-md)' }} onClick={handleNew}>
                            Erstes Konto einrichten
                        </button>
                    </div>
                </div>
            ) : (
                <div className="card">
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Provider</th>
                                    <th>Absender</th>
                                    <th>SMTP Host</th>
                                    <th>Standard</th>
                                    <th style={{ textAlign: 'right' }}>Aktionen</th>
                                </tr>
                            </thead>
                            <tbody>
                                {accounts.map((account) => (
                                    <tr key={account.id}>
                                        <td><strong>{account.name}</strong></td>
                                        <td><span className="badge badge-info">{account.provider.toUpperCase()}</span></td>
                                        <td className="text-muted">{account.from_address || '–'}</td>
                                        <td className="text-muted">{account.smtp_host || '–'}</td>
                                        <td>
                                            {account.is_default ? (
                                                <span className="badge badge-success">Standard</span>
                                            ) : (
                                                <button
                                                    className="btn btn-sm"
                                                    style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px' }}
                                                    onClick={() => handleSetDefault(account.id)}
                                                >
                                                    Als Standard
                                                </button>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                                <button className="btn btn-sm" onClick={() => handleEdit(account)}>
                                                    Bearbeiten
                                                </button>
                                                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(account.id)}>
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Test-Mail Bereich */}
            {accounts.length > 0 && (
                <div className="card" style={{ marginTop: 'var(--space-md)' }}>
                    <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                        Test-E-Mail senden
                    </div>
                    <div style={{ marginTop: 'var(--space-md)', display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
                            <label className="form-label">Empfaenger</label>
                            <input
                                className="form-input"
                                value={testEmail}
                                onChange={(e) => setTestEmail(e.target.value)}
                                placeholder="test@firma.de"
                            />
                        </div>
                        {accounts.map((account) => (
                            <button
                                key={account.id}
                                className="btn"
                                disabled={testingId !== null || !testEmail.trim()}
                                onClick={() => handleTest(account.id)}
                            >
                                {testingId === account.id ? 'Sende...' : `Test: ${account.name}`}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
