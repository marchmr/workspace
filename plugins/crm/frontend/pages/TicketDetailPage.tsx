import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from '@mike/hooks/usePluginNavigate';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';

/* ════════════════════════════════════════════
   Icons
   ════════════════════════════════════════════ */

const backIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
);

const sendIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
);

/* ════════════════════════════════════════════
   Constants
   ════════════════════════════════════════════ */

const statusLabels: Record<string, string> = {
    open: 'Offen', in_progress: 'In Bearbeitung', waiting: 'Wartend',
    resolved: 'Gelöst', closed: 'Geschlossen',
};
const statusColors: Record<string, string> = {
    open: 'var(--color-primary)', in_progress: 'var(--color-warning)',
    waiting: '#a78bfa', resolved: 'var(--color-success)', closed: 'var(--color-text-muted)',
};
const priorityLabels: Record<string, string> = {
    low: 'Niedrig', normal: 'Normal', high: 'Hoch', urgent: 'Dringend',
};

/* ════════════════════════════════════════════
   TicketDetailPage
   ════════════════════════════════════════════ */

export default function TicketDetailPage() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const toast = useToast();

    const [ticket, setTicket] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [commentText, setCommentText] = useState('');
    const [isInternal, setIsInternal] = useState(false);
    const [sendingComment, setSendingComment] = useState(false);
    const [customerContacts, setCustomerContacts] = useState<any[]>([]);

    const load = useCallback(async () => {
        try {
            const res = await apiFetch(`/api/plugins/crm/tickets/${id}`);
            if (res.ok) {
                const data = await res.json();
                setTicket(data);
                // Ansprechpartner des Kunden laden
                if (data.customer_id) {
                    const cRes = await apiFetch(`/api/plugins/crm/contacts/?customer_id=${data.customer_id}`);
                    if (cRes.ok) { const cd = await cRes.json(); setCustomerContacts(cd.contacts || []); }
                }
            }
            else navigate('/crm/tickets');
        } catch { navigate('/crm/tickets'); }
        setLoading(false);
    }, [id, navigate]);

    useEffect(() => { void load(); }, [load]);

    const updateField = async (field: string, value: any) => {
        try {
            const res = await apiFetch(`/api/plugins/crm/tickets/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [field]: value }),
            });
            if (res.ok) {
                setTicket((prev: any) => ({ ...prev, [field]: value }));
                toast.success('Gespeichert');
            }
        } catch { toast.error('Fehler'); }
    };

    const handleComment = async () => {
        if (!commentText.trim()) return;
        setSendingComment(true);
        try {
            const res = await apiFetch(`/api/plugins/crm/tickets/${id}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: commentText.trim(), is_internal: isInternal }),
            });
            if (res.ok) {
                setCommentText('');
                setIsInternal(false);
                void load();
                toast.success('Kommentar hinzugefügt');
            }
        } catch { toast.error('Fehler'); }
        setSendingComment(false);
    };

    const handleDelete = async () => {
        if (!confirm('Ticket wirklich löschen?')) return;
        try {
            const res = await apiFetch(`/api/plugins/crm/tickets/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('Ticket gelöscht');
                navigate('/crm/tickets');
            }
        } catch { toast.error('Fehler'); }
    };

    const formatDateTime = (d: string | null) => {
        if (!d) return '—';
        return new Date(d).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    };

    if (loading) return <div style={{ padding: 'var(--space-md)' }} className="text-muted">Laden...</div>;
    if (!ticket) return null;

    return (
        <div style={{ padding: 'var(--space-md)', maxWidth: 1200, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                <button onClick={() => navigate('/crm/tickets')} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {backIcon} Zurück
                </button>
                <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{ticket.ticket_number}</span>
                <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)', flex: 1 }}>{ticket.subject}</h1>
                <button className="btn btn-danger btn-sm" onClick={handleDelete}>Löschen</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 'var(--space-md)' }}>
                {/* Linke Seite: Beschreibung + Kommentare */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    {/* Beschreibung */}
                    {ticket.description && (
                        <div className="card" style={{ padding: 'var(--space-md)' }}>
                            <div style={{ fontWeight: 600, marginBottom: 'var(--space-xs)', fontSize: 'var(--font-size-sm)' }}>Beschreibung</div>
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>{ticket.description}</div>
                        </div>
                    )}

                    {/* Kommentare */}
                    <div className="card" style={{ padding: 'var(--space-md)' }}>
                        <div style={{ fontWeight: 600, marginBottom: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' }}>
                            Kommentare ({ticket.comments?.length || 0})
                        </div>

                        {(ticket.comments || []).length === 0 ? (
                            <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)', padding: 'var(--space-sm) 0' }}>Noch keine Kommentare</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                                {ticket.comments.map((c: any) => (
                                    <div key={c.id} style={{
                                        padding: 'var(--space-sm)', borderRadius: 'var(--radius-sm)',
                                        background: c.is_internal ? 'rgba(255,193,7,0.08)' : 'rgba(var(--color-primary-rgb, 99,102,241), 0.04)',
                                        borderLeft: c.is_internal ? '3px solid var(--color-warning)' : '3px solid var(--color-border)',
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <span style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>
                                                {c.author_name || 'System'}
                                                {c.is_internal && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--color-warning)', fontWeight: 600 }}>INTERN</span>}
                                            </span>
                                            <span className="text-muted" style={{ fontSize: 11 }}>{formatDateTime(c.created_at)}</span>
                                        </div>
                                        <div style={{ fontSize: 'var(--font-size-sm)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{c.content}</div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Neuer Kommentar */}
                        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-sm)' }}>
                            <textarea className="textarea" placeholder="Kommentar schreiben..." value={commentText}
                                onChange={(e) => setCommentText(e.target.value)} rows={3}
                                style={{ marginBottom: 'var(--space-xs)' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                                    Interne Notiz
                                </label>
                                <button className="btn btn-primary btn-sm" onClick={handleComment} disabled={sendingComment || !commentText.trim()}
                                    style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    {sendIcon} {sendingComment ? 'Senden...' : 'Senden'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Rechte Sidebar: Metadaten */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    {/* Status */}
                    <div className="card" style={{ padding: 'var(--space-md)' }}>
                        <div style={{ fontWeight: 600, marginBottom: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' }}>Status</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {Object.entries(statusLabels).map(([key, label]) => (
                                <button key={key} onClick={() => updateField('status', key)}
                                    style={{
                                        padding: '4px 10px', borderRadius: 12, border: 'none', cursor: 'pointer',
                                        fontSize: 11, fontWeight: 500, transition: 'all 150ms',
                                        background: ticket.status === key ? statusColors[key] + '30' : 'var(--color-border)',
                                        color: ticket.status === key ? statusColors[key] : 'var(--color-text-muted)',
                                        outline: ticket.status === key ? `2px solid ${statusColors[key]}` : 'none',
                                    }}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Priorität */}
                    <div className="card" style={{ padding: 'var(--space-md)' }}>
                        <div style={{ fontWeight: 600, marginBottom: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' }}>Priorität</div>
                        <select className="input" value={ticket.priority} onChange={(e) => updateField('priority', e.target.value)}>
                            {Object.entries(priorityLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                    </div>

                    {/* Kunde */}
                    {ticket.customer_name && (
                        <div className="card" style={{ padding: 'var(--space-md)' }}>
                            <div style={{ fontWeight: 600, marginBottom: 'var(--space-xs)', fontSize: 'var(--font-size-sm)' }}>Kunde</div>
                            <div onClick={() => navigate(`/crm/customers/${ticket.customer_id}`)}
                                style={{ cursor: 'pointer', color: 'var(--color-primary)', fontSize: 'var(--font-size-sm)' }}>
                                {ticket.customer_name}
                            </div>
                            <div className="text-muted" style={{ fontSize: 11 }}>{ticket.customer_number}</div>
                        </div>
                    )}

                    {/* Fälligkeit */}
                    <div className="card" style={{ padding: 'var(--space-md)' }}>
                        <div style={{ fontWeight: 600, marginBottom: 'var(--space-xs)', fontSize: 'var(--font-size-sm)' }}>Fällig am</div>
                        <input type="date" className="input"
                            value={ticket.due_date ? new Date(ticket.due_date).toISOString().split('T')[0] : ''}
                            onChange={(e) => updateField('due_date', e.target.value || null)} />
                    </div>

                    {/* Ansprechpartner */}
                    {ticket.customer_id && (
                        <div className="card" style={{ padding: 'var(--space-md)' }}>
                            <div style={{ fontWeight: 600, marginBottom: 'var(--space-xs)', fontSize: 'var(--font-size-sm)' }}>Ansprechpartner</div>
                            <select className="input" value={ticket.contact_id || ''}
                                onChange={(e) => updateField('contact_id', e.target.value ? parseInt(e.target.value) : null)}>
                                <option value="">— Keiner —</option>
                                {customerContacts.map((c: any) => (
                                    <option key={c.id} value={c.id}>
                                        {c.first_name} {c.last_name}{c.category_name ? ` (${c.category_name})` : ''}{c.is_primary ? ' *' : ''}
                                    </option>
                                ))}
                            </select>
                            {ticket.contact_name?.trim() && (
                                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>Aktuell: {ticket.contact_name}</div>
                            )}
                        </div>
                    )}

                    {/* Metadaten */}
                    <div className="card" style={{ padding: 'var(--space-md)', fontSize: 'var(--font-size-sm)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div><span className="text-muted">Erstellt von:</span> {ticket.created_by_name || '—'}</div>
                            <div><span className="text-muted">Erstellt am:</span> {formatDateTime(ticket.created_at)}</div>
                            <div><span className="text-muted">Aktualisiert:</span> {formatDateTime(ticket.updated_at)}</div>
                            {ticket.resolved_at && <div><span className="text-muted">Gelöst am:</span> {formatDateTime(ticket.resolved_at)}</div>}
                            {ticket.closed_at && <div><span className="text-muted">Geschlossen am:</span> {formatDateTime(ticket.closed_at)}</div>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
