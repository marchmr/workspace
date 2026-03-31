import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@mike/hooks/usePluginNavigate';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';

/* ════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════ */

const plusIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

const searchIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);

/* ════════════════════════════════════════════
   Types & Constants
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
const priorityColors: Record<string, string> = {
    low: 'var(--color-text-muted)', normal: 'var(--color-primary)',
    high: 'var(--color-warning)', urgent: 'var(--color-danger)',
};

/* ════════════════════════════════════════════
   TicketListPage
   ════════════════════════════════════════════ */

export default function TicketListPage() {
    const navigate = useNavigate();
    const toast = useToast();

    const [tickets, setTickets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [priorityFilter, setPriorityFilter] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [sortBy, setSortBy] = useState('created_at');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    // Neues Ticket Modal
    const [showNew, setShowNew] = useState(false);
    const [newSubject, setNewSubject] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [newPriority, setNewPriority] = useState('normal');
    const [newCustomerId, setNewCustomerId] = useState('');
    const [newContactId, setNewContactId] = useState('');
    const [customerSearch, setCustomerSearch] = useState('');
    const [customerResults, setCustomerResults] = useState<any[]>([]);
    const [customerContacts, setCustomerContacts] = useState<any[]>([]);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(page), pageSize: '25', sortBy, sortOrder,
            });
            if (search) params.set('search', search);
            if (statusFilter) params.set('status', statusFilter);
            if (priorityFilter) params.set('priority', priorityFilter);

            const res = await apiFetch(`/api/plugins/crm/tickets/?${params}`);
            if (res.ok) {
                const data = await res.json();
                setTickets(data.items || []);
                setTotalPages(data.pagination?.totalPages || 1);
                setTotal(data.pagination?.total || 0);
            }
        } catch { /* */ }
        setLoading(false);
    }, [page, search, statusFilter, priorityFilter, sortBy, sortOrder]);

    useEffect(() => { void load(); }, [load]);

    // Kunden-Suche für Modal
    useEffect(() => {
        if (customerSearch.length < 2) { setCustomerResults([]); return; }
        const t = setTimeout(async () => {
            try {
                const res = await apiFetch(`/api/plugins/crm/customers/search?q=${encodeURIComponent(customerSearch)}`);
                if (res.ok) {
                    const data = await res.json();
                    setCustomerResults(data.results || []);
                }
            } catch { /* */ }
        }, 300);
        return () => clearTimeout(t);
    }, [customerSearch]);

    const handleCreate = async () => {
        if (!newSubject.trim()) return;
        setSaving(true);
        try {
            const res = await apiFetch('/api/plugins/crm/tickets/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subject: newSubject.trim(),
                    description: newDescription.trim() || null,
                    priority: newPriority,
                    customer_id: newCustomerId ? parseInt(newCustomerId) : null,
                    contact_id: newContactId ? parseInt(newContactId) : null,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                toast.success(`Ticket ${data.ticket_number} erstellt`);
                setShowNew(false);
                setNewSubject('');
                setNewDescription('');
                setNewPriority('normal');
                setNewCustomerId('');
                setNewContactId('');
                setCustomerSearch('');
                setCustomerContacts([]);
                void load();
            } else {
                const err = await res.json();
                toast.error(err.error || 'Fehler');
            }
        } catch { toast.error('Netzwerkfehler'); }
        setSaving(false);
    };

    const handleSort = (col: string) => {
        if (sortBy === col) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        else { setSortBy(col); setSortOrder('desc'); }
    };

    const sortArrow = (col: string) => sortBy === col ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '';

    const formatDate = (d: string | null) => {
        if (!d) return '—';
        return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    return (
        <div style={{ padding: 'var(--space-md)' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Tickets</h1>
                    <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>{total} Tickets</span>
                </div>
                <button className="btn btn-primary" onClick={() => setShowNew(true)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {plusIcon} Neues Ticket
                </button>
            </div>

            {/* Filter-Bar */}
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 200px' }}>
                    <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>{searchIcon}</span>
                    <input className="input" placeholder="Suche (Nr., Betreff)..." value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                        style={{ paddingLeft: 30 }} />
                </div>
                <select className="input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ width: 160 }}>
                    <option value="">Alle Status</option>
                    {Object.entries(statusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <select className="input" value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }} style={{ width: 140 }}>
                    <option value="">Alle Prioritäten</option>
                    {Object.entries(priorityLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
            </div>

            {/* Neues Ticket Modal */}
            {showNew && (
                <div className="card" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)', borderLeft: '3px solid var(--color-primary)' }}>
                    <div style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>Neues Ticket</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                        <input className="input" placeholder="Betreff *" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} autoFocus />
                        <textarea className="textarea" placeholder="Beschreibung (optional)" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} rows={3} />
                        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                            <select className="input" value={newPriority} onChange={(e) => setNewPriority(e.target.value)} style={{ flex: 1 }}>
                                {Object.entries(priorityLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                            <div style={{ flex: 2, position: 'relative' }}>
                                <input className="input" placeholder="Kunde suchen..." value={customerSearch}
                                    onChange={(e) => { setCustomerSearch(e.target.value); setNewCustomerId(''); }} />
                                {customerResults.length > 0 && !newCustomerId && (
                                    <div style={{
                                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                                        background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
                                        borderRadius: 'var(--radius-sm)', maxHeight: 150, overflowY: 'auto',
                                    }}>
                                        {customerResults.map((c: any) => (
                                            <div key={c.id} onClick={async () => {
                                                setNewCustomerId(String(c.id));
                                                setCustomerSearch(c.display_name);
                                                setCustomerResults([]);
                                                // Ansprechpartner laden
                                                try {
                                                    const cRes = await apiFetch(`/api/plugins/crm/contacts/?customer_id=${c.id}`);
                                                    if (cRes.ok) { const cd = await cRes.json(); setCustomerContacts(cd.contacts || []); }
                                                } catch { /* */ }
                                            }}
                                                style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}
                                                onMouseOver={(e) => (e.currentTarget.style.background = 'var(--color-border)')}
                                                onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                                            >
                                                <strong>{c.display_name}</strong>
                                                <span className="text-muted" style={{ marginLeft: 8, fontSize: 11 }}>{c.customer_number}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        {/* Ansprechpartner (nur wenn Kunde gewählt) */}
                        {newCustomerId && customerContacts.length > 0 && (
                            <select className="input" value={newContactId} onChange={(e) => setNewContactId(e.target.value)}>
                                <option value="">Ansprechpartner wählen...</option>
                                {customerContacts.map((c: any) => (
                                    <option key={c.id} value={c.id}>
                                        {c.first_name} {c.last_name}{c.is_primary ? ' *' : ''}
                                    </option>
                                ))}
                            </select>
                        )}
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Abbrechen</button>
                            <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !newSubject.trim()}>
                                {saving ? 'Erstellen...' : 'Ticket erstellen'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Ticket-Tabelle */}
            <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                            <th onClick={() => handleSort('ticket_number')} style={{ padding: '8px 10px', textAlign: 'left', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Nr.{sortArrow('ticket_number')}</th>
                            <th onClick={() => handleSort('subject')} style={{ padding: '8px 10px', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}>Betreff{sortArrow('subject')}</th>
                            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Kunde</th>
                            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Ansprechpartner</th>
                            <th onClick={() => handleSort('status')} style={{ padding: '8px 10px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}>Status{sortArrow('status')}</th>
                            <th onClick={() => handleSort('priority')} style={{ padding: '8px 10px', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}>Priorität{sortArrow('priority')}</th>
                            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Zugewiesen</th>
                            <th onClick={() => handleSort('due_date')} style={{ padding: '8px 10px', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}>Fällig{sortArrow('due_date')}</th>
                            <th onClick={() => handleSort('created_at')} style={{ padding: '8px 10px', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}>Erstellt{sortArrow('created_at')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={9} style={{ padding: 'var(--space-lg)', textAlign: 'center' }} className="text-muted">Laden...</td></tr>
                        ) : tickets.length === 0 ? (
                            <tr><td colSpan={9} style={{ padding: 'var(--space-lg)', textAlign: 'center' }} className="text-muted">Keine Tickets gefunden</td></tr>
                        ) : tickets.map((t) => (
                            <tr key={t.id} onClick={() => navigate(`/crm/tickets/${t.id}`)}
                                style={{ borderBottom: '1px solid var(--color-border)', cursor: 'pointer', transition: 'background 100ms' }}
                                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(var(--color-primary-rgb, 99,102,241), 0.05)')}
                                onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                                <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono, monospace)', fontSize: 11, whiteSpace: 'nowrap' }}>{t.ticket_number}</td>
                                <td style={{ padding: '8px 10px', fontWeight: 500, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</td>
                                <td style={{ padding: '8px 10px', color: 'var(--color-text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.customer_name || '—'}</td>
                                <td style={{ padding: '8px 10px', color: 'var(--color-text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.contact_name?.trim() || '—'}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                    <span style={{
                                        display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                                        background: statusColors[t.status] + '20', color: statusColors[t.status],
                                    }}>
                                        {statusLabels[t.status] || t.status}
                                    </span>
                                </td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                    <span style={{ color: priorityColors[t.priority], fontWeight: t.priority === 'urgent' ? 700 : 400, fontSize: 11 }}>
                                        {priorityLabels[t.priority] || t.priority}
                                    </span>
                                </td>
                                <td style={{ padding: '8px 10px', color: 'var(--color-text-muted)' }}>{t.assigned_to_name || '—'}</td>
                                <td style={{ padding: '8px 10px', color: t.due_date && new Date(t.due_date) < new Date() ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>{formatDate(t.due_date)}</td>
                                <td style={{ padding: '8px 10px', color: 'var(--color-text-muted)' }}>{formatDate(t.created_at)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
                    <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Zurück</button>
                    <span className="text-muted" style={{ alignSelf: 'center', fontSize: 'var(--font-size-sm)' }}>Seite {page} von {totalPages}</span>
                    <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Weiter</button>
                </div>
            )}
        </div>
    );
}
