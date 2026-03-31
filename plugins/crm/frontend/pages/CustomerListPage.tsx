import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from '@mike/hooks/usePluginNavigate';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';
import { usePermission } from '@mike/hooks/usePermission';

/* ════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════ */

const searchIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);

const plusIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

const trashIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
);

const starIcon = (filled: boolean) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'var(--color-warning)' : 'none'} stroke={filled ? 'var(--color-warning)' : 'var(--color-text-muted)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
);

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

interface Customer {
    id: number;
    customer_number: string;
    type: string;
    company_name: string | null;
    first_name: string | null;
    last_name: string | null;
    display_name: string;
    email: string | null;
    phone: string | null;
    city: string | null;
    status: string;
    category: string | null;
    primary_contact_name: string | null;
    created_at: string;
}

/* ════════════════════════════════════════════
   CustomerListPage
   ════════════════════════════════════════════ */

export default function CustomerListPage() {
    const navigate = useNavigate();
    const toast = useToast();
    const canCreate = usePermission('crm.create');
    const canEdit = usePermission('crm.edit');
    const canDelete = usePermission('crm.delete');

    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [sortBy, setSortBy] = useState('created_at');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    // Bulk-Auswahl
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [favorites, setFavorites] = useState<Set<number>>(new Set());

    // Neuer-Kunde-Modal
    const [showForm, setShowForm] = useState(false);
    const [formData, setFormData] = useState<any>({ type: 'company', status: 'active', country: 'Deutschland' });
    const [saving, setSaving] = useState(false);
    const [duplicates, setDuplicates] = useState<any[]>([]);

    const load = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            params.set('page', String(page));
            params.set('pageSize', '25');
            params.set('sortBy', sortBy);
            params.set('sortOrder', sortOrder);
            if (search) params.set('search', search);
            if (statusFilter) params.set('status', statusFilter);
            if (typeFilter) params.set('type', typeFilter);

            const res = await apiFetch(`/api/plugins/crm/customers/?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                setCustomers(data.items || []);
                setTotalPages(data.pagination?.totalPages || 1);
                setTotal(data.pagination?.total || 0);
            }

            // Favoriten laden
            const favRes = await apiFetch('/api/plugins/crm/layout/favorites');
            if (favRes.ok) {
                const favData = await favRes.json();
                setFavorites(new Set((favData.favorites || []).map((f: any) => f.id)));
            }
        } catch { /* */ }
        setLoading(false);
    }, [page, search, statusFilter, typeFilter, sortBy, sortOrder]);

    useEffect(() => { setLoading(true); void load(); }, [load]);

    // URL-Parameter: ?new=1
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('new') === '1') {
            setShowForm(true);
        }
    }, []);

    // Duplikat-Check (Debounce)
    useEffect(() => {
        if (!showForm) return;
        const hasData = formData.email || formData.company_name || formData.last_name;
        if (!hasData) { setDuplicates([]); return; }

        const timer = setTimeout(async () => {
            try {
                const res = await apiFetch('/api/plugins/crm/customers/check-duplicates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData),
                });
                if (res.ok) {
                    const data = await res.json();
                    setDuplicates(data.duplicates || []);
                }
            } catch { /* */ }
        }, 500);

        return () => clearTimeout(timer);
    }, [formData.email, formData.company_name, formData.last_name, formData.zip, showForm]);

    const handleSort = (field: string) => {
        if (sortBy === field) {
            setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortOrder('asc');
        }
    };

    const handleSelectAll = () => {
        if (selected.size === customers.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(customers.map(c => c.id)));
        }
    };

    const handleSelect = (id: number) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    };

    const handleBulkStatus = async (status: string) => {
        try {
            const res = await apiFetch('/api/plugins/crm/customers/bulk/status', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [...selected], status }),
            });
            if (res.ok) {
                toast.success(`Status für ${selected.size} Kunden geändert`);
                setSelected(new Set());
                void load();
            }
        } catch { toast.error('Fehler bei Bulk-Aktion'); }
    };

    const handleBulkDelete = async () => {
        try {
            const res = await apiFetch('/api/plugins/crm/customers/bulk', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [...selected] }),
            });
            if (res.ok) {
                const data = await res.json();
                toast.success(`${data.deleted} Kunden unwiderruflich gelöscht`);
                setSelected(new Set());
                setShowDeleteConfirm(false);
                void load();
            }
        } catch { toast.error('Fehler beim Löschen'); }
    };

    const handleToggleFavorite = async (e: React.MouseEvent, customerId: number) => {
        e.stopPropagation();
        const isFav = favorites.has(customerId);
        try {
            await apiFetch(`/api/plugins/crm/layout/favorites/${customerId}`, {
                method: isFav ? 'DELETE' : 'POST',
            });
            const next = new Set(favorites);
            if (isFav) next.delete(customerId);
            else next.add(customerId);
            setFavorites(next);
        } catch { /* */ }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await apiFetch('/api/plugins/crm/customers/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            // Robuster Response-Parse (falls Backend kein JSON liefert)
            let data: any;
            const responseText = await res.text();
            try { data = JSON.parse(responseText); } catch { data = { error: responseText || `HTTP ${res.status}` }; }

            if (res.ok) {
                toast.success(`Kunde ${data.customer_number} erstellt`);

                // Bei Firma: wenn optionale Ansprechpartner-Daten vorhanden, Contact erstellen
                if (formData.type === 'company' && (formData.first_name || formData.last_name)) {
                    try {
                        await apiFetch('/api/plugins/crm/contacts/', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                customer_id: data.id,
                                salutation: formData.salutation || null,
                                first_name: formData.first_name || null,
                                last_name: formData.last_name || null,
                                email: formData.email || null,
                                phone: formData.phone || null,
                                mobile: formData.mobile || null,
                                is_primary: true,
                            }),
                        });
                    } catch { /* Ansprechpartner-Fehler ist nicht kritisch */ }
                }

                setShowForm(false);
                setFormData({ type: 'company', status: 'active', country: 'Deutschland' });
                setDuplicates([]);
                navigate(`/crm/customers/${data.id}`);
            } else {
                const errorMsg = data.error || 'Fehler beim Erstellen';
                const details = `Status: ${res.status}\nURL: /api/plugins/crm/customers/\nResponse:\n${responseText}`;
                toast.error(`${errorMsg}\n${details}`);
            }
        } catch (err: any) {
            toast.error(`Netzwerkfehler: ${err?.message || String(err)}`);
        }
        setSaving(false);
    };

    const sortArrow = (field: string) => {
        if (sortBy !== field) return '';
        return sortOrder === 'asc' ? ' ↑' : ' ↓';
    };

    const statusBadge = (status: string) => {
        const colors: Record<string, { bg: string; text: string; label: string }> = {
            active: { bg: 'rgba(34,197,94,0.1)', text: '#22c55e', label: 'Aktiv' },
            inactive: { bg: 'rgba(239,68,68,0.1)', text: '#ef4444', label: 'Inaktiv' },
            prospect: { bg: 'rgba(234,179,8,0.1)', text: '#eab308', label: 'Interessent' },
        };
        const c = colors[status] || colors.active;
        return (
            <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: c.bg, color: c.text, fontWeight: 600 }}>
                {c.label}
            </span>
        );
    };

    return (
        <div>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 className="page-title">Kunden</h1>
                    <p className="page-subtitle">{total} Kunden gesamt</p>
                </div>
                {canCreate && (
                    <button className="btn btn-primary" onClick={() => setShowForm(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {plusIcon} Neuer Kunde
                    </button>
                )}
            </div>

            {/* Filter-Leiste */}
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: '1 1 200px' }}>
                    <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>{searchIcon}</span>
                    <input
                        className="input"
                        placeholder="Suche..."
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                        style={{ paddingLeft: 32 }}
                    />
                </div>
                <select className="input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ width: 'auto', minWidth: 120 }}>
                    <option value="">Alle Status</option>
                    <option value="active">Aktiv</option>
                    <option value="inactive">Inaktiv</option>
                    <option value="prospect">Interessent</option>
                </select>
                <select className="input" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} style={{ width: 'auto', minWidth: 120 }}>
                    <option value="">Alle Typen</option>
                    <option value="company">Firma</option>
                    <option value="person">Person</option>
                </select>
            </div>

            {/* Bulk-Aktionsleiste */}
            {selected.size > 0 && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
                    padding: 'var(--space-sm) var(--space-md)',
                    background: 'var(--color-primary-bg, rgba(59,130,246,0.1))',
                    borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-sm)',
                    fontSize: 'var(--font-size-sm)',
                }}>
                    <strong>{selected.size} ausgewaehlt</strong>
                    {canEdit && (
                        <>
                            <select
                                className="input"
                                onChange={(e) => { if (e.target.value) handleBulkStatus(e.target.value); e.target.value = ''; }}
                                style={{ width: 'auto', minWidth: 140, fontSize: 'var(--font-size-sm)', padding: '4px 8px' }}
                                defaultValue=""
                            >
                                <option value="" disabled>Status ändern...</option>
                                <option value="active">Aktiv</option>
                                <option value="inactive">Inaktiv</option>
                                <option value="prospect">Interessent</option>
                            </select>
                        </>
                    )}
                    {canDelete && (
                        <button
                            className="btn btn-secondary"
                            onClick={() => setShowDeleteConfirm(true)}
                            style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                            {trashIcon} Löschen
                        </button>
                    )}
                    <button className="btn btn-secondary" onClick={() => setSelected(new Set())} style={{ marginLeft: 'auto', fontSize: 'var(--font-size-sm)', padding: '4px 8px' }}>
                        Auswahl aufheben
                    </button>
                </div>
            )}

            {/* Tabelle */}
            <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                            <th style={{ padding: '8px 12px', textAlign: 'left', width: 40 }}>
                                <input type="checkbox" checked={customers.length > 0 && selected.size === customers.length} onChange={handleSelectAll} />
                            </th>
                            <th style={{ padding: '8px 4px', width: 30 }}></th>
                            <th style={{ padding: '8px 12px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('customer_number')}>
                                Nr.{sortArrow('customer_number')}
                            </th>
                            <th style={{ padding: '8px 12px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('company_name')}>
                                Name{sortArrow('company_name')}
                            </th>
                            <th style={{ padding: '8px 12px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('city')}>
                                Ort{sortArrow('city')}
                            </th>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>Telefon</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left' }}>E-Mail</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('status')}>
                                Status{sortArrow('status')}
                            </th>
                            <th style={{ padding: '8px 12px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('created_at')}>
                                Erstellt{sortArrow('created_at')}
                            </th>
                            <th style={{ padding: '8px 12px', textAlign: 'left', cursor: 'pointer' }} onClick={() => handleSort('primary_contact')}>
                                Ansprechpartner{sortArrow('primary_contact')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={10} style={{ padding: 'var(--space-lg)', textAlign: 'center' }} className="text-muted">Laden...</td></tr>
                        ) : customers.length === 0 ? (
                            <tr><td colSpan={10} style={{ padding: 'var(--space-lg)', textAlign: 'center' }} className="text-muted">Keine Kunden gefunden</td></tr>
                        ) : (
                            customers.map((c) => (
                                <tr
                                    key={c.id}
                                    onClick={() => navigate(`/crm/customers/${c.id}`)}
                                    style={{
                                        borderBottom: '1px solid var(--color-border)',
                                        cursor: 'pointer', transition: 'background 120ms ease',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                >
                                    <td style={{ padding: '8px 12px' }} onClick={(e) => e.stopPropagation()}>
                                        <input type="checkbox" checked={selected.has(c.id)} onChange={() => handleSelect(c.id)} />
                                    </td>
                                    <td style={{ padding: '8px 4px' }} onClick={(e) => handleToggleFavorite(e, c.id)}>
                                        <span style={{ display: 'flex', cursor: 'pointer' }}>{starIcon(favorites.has(c.id))}</span>
                                    </td>
                                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono, monospace)', fontSize: 12, color: 'var(--color-text-muted)' }}>
                                        {c.customer_number}
                                    </td>
                                    <td style={{ padding: '8px 12px', fontWeight: 500 }}>{c.display_name}</td>
                                    <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)' }}>{c.city || '—'}</td>
                                    <td style={{ padding: '8px 12px' }}>
                                        {c.phone ? <a href={`tel:${c.phone}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{c.phone}</a> : '—'}
                                    </td>
                                    <td style={{ padding: '8px 12px' }}>
                                        {c.email ? <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{c.email}</a> : '—'}
                                    </td>
                                    <td style={{ padding: '8px 12px' }}>{statusBadge(c.status)}</td>
                                    <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)', fontSize: 12 }}>
                                        {new Date(c.created_at).toLocaleDateString('de-DE')}
                                    </td>
                                    <td style={{ padding: '8px 12px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                                        {c.primary_contact_name || <span className="text-muted">—</span>}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
                    <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ fontSize: 'var(--font-size-sm)', padding: '4px 12px' }}>
                        Zurück
                    </button>
                    <span style={{ display: 'flex', alignItems: 'center', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                        Seite {page} von {totalPages}
                    </span>
                    <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ fontSize: 'var(--font-size-sm)', padding: '4px 12px' }}>
                        Weiter
                    </button>
                </div>
            )}

            {/* Neuer-Kunde-Modal */}
            {showForm && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-md)',
                }} onClick={() => setShowForm(false)}>
                    <div className="card" style={{ padding: 'var(--space-lg)', maxWidth: 600, width: '100%', maxHeight: '90vh', overflow: 'auto' }}
                        onClick={(e) => e.stopPropagation()}>
                        <h2 style={{ marginBottom: 'var(--space-md)', fontSize: 'var(--font-size-lg)' }}>Neuer Kunde</h2>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                            {/* Typ */}
                            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                                    <input type="radio" name="type" value="company" checked={formData.type === 'company'} onChange={() => setFormData({ ...formData, type: 'company' })} />
                                    Firma
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                                    <input type="radio" name="type" value="person" checked={formData.type === 'person'} onChange={() => setFormData({ ...formData, type: 'person' })} />
                                    Privatperson
                                </label>
                            </div>

                            {formData.type === 'company' && (
                                <input className="input" placeholder="Firmenname *" value={formData.company_name || ''} onChange={(e) => setFormData({ ...formData, company_name: e.target.value })} autoFocus />
                            )}

                            {/* Bei Firma: Adresse zuerst, Personen-Felder optional */}
                            {formData.type === 'company' ? (
                                <>
                                    <input className="input" placeholder="Strasse" value={formData.street || ''} onChange={(e) => setFormData({ ...formData, street: e.target.value })} />
                                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 'var(--space-sm)' }}>
                                        <input className="input" placeholder="PLZ" value={formData.zip || ''} onChange={(e) => setFormData({ ...formData, zip: e.target.value })} />
                                        <input className="input" placeholder="Ort" value={formData.city || ''} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
                                    </div>

                                    <select className="input" value={formData.status || 'active'} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                                        <option value="active">Aktiv</option>
                                        <option value="inactive">Inaktiv</option>
                                        <option value="prospect">Interessent</option>
                                    </select>

                                    {/* Optionaler 1. Ansprechpartner */}
                                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-sm)', marginTop: 'var(--space-xs)' }}>
                                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'var(--space-xs)' }}>
                                            Optional: 1. Ansprechpartner
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                                            <select className="input" value={formData.salutation || ''} onChange={(e) => setFormData({ ...formData, salutation: e.target.value })}>
                                                <option value="">Anrede</option>
                                                <option value="Herr">Herr</option>
                                                <option value="Frau">Frau</option>
                                                <option value="Divers">Divers</option>
                                            </select>
                                            <div></div>
                                            <input className="input" placeholder="Vorname" value={formData.first_name || ''} onChange={(e) => setFormData({ ...formData, first_name: e.target.value })} />
                                            <input className="input" placeholder="Nachname" value={formData.last_name || ''} onChange={(e) => setFormData({ ...formData, last_name: e.target.value })} />
                                        </div>
                                        <input className="input" placeholder="E-Mail" value={formData.email || ''} onChange={(e) => setFormData({ ...formData, email: e.target.value })} style={{ marginTop: 'var(--space-sm)' }} />
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                                            <input className="input" placeholder="Telefon" value={formData.phone || ''} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
                                            <input className="input" placeholder="Mobil" value={formData.mobile || ''} onChange={(e) => setFormData({ ...formData, mobile: e.target.value })} />
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                                        <select className="input" value={formData.salutation || ''} onChange={(e) => setFormData({ ...formData, salutation: e.target.value })}>
                                            <option value="">Anrede</option>
                                            <option value="Herr">Herr</option>
                                            <option value="Frau">Frau</option>
                                            <option value="Divers">Divers</option>
                                        </select>
                                        <div></div>
                                        <input className="input" placeholder="Vorname" value={formData.first_name || ''} onChange={(e) => setFormData({ ...formData, first_name: e.target.value })} />
                                        <input className="input" placeholder="Nachname *" value={formData.last_name || ''} onChange={(e) => setFormData({ ...formData, last_name: e.target.value })} />
                                    </div>
                                    <input className="input" placeholder="E-Mail" value={formData.email || ''} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                                        <input className="input" placeholder="Telefon" value={formData.phone || ''} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
                                        <input className="input" placeholder="Mobil" value={formData.mobile || ''} onChange={(e) => setFormData({ ...formData, mobile: e.target.value })} />
                                    </div>
                                    <input className="input" placeholder="Strasse" value={formData.street || ''} onChange={(e) => setFormData({ ...formData, street: e.target.value })} />
                                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 'var(--space-sm)' }}>
                                        <input className="input" placeholder="PLZ" value={formData.zip || ''} onChange={(e) => setFormData({ ...formData, zip: e.target.value })} />
                                        <input className="input" placeholder="Ort" value={formData.city || ''} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
                                    </div>
                                    <select className="input" value={formData.status || 'active'} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                                        <option value="active">Aktiv</option>
                                        <option value="inactive">Inaktiv</option>
                                        <option value="prospect">Interessent</option>
                                    </select>
                                </>
                            )}

                            {/* Duplikat-Warnung */}
                            {duplicates.length > 0 && (
                                <div style={{
                                    padding: 'var(--space-sm)', borderRadius: 'var(--radius-md)',
                                    background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)',
                                }}>
                                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 4, color: 'var(--color-warning)' }}>
                                        Moeglicherweise existiert dieser Kunde bereits:
                                    </div>
                                    {duplicates.map((d: any) => (
                                        <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)', padding: '2px 0' }}>
                                            <span>[{d.customer_number}] {d.display_name} — {d.city || ''} ({d.match_reason})</span>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={() => { setShowForm(false); navigate(`/crm/customers/${d.id}`); }}
                                                style={{ fontSize: 11, padding: '2px 6px' }}
                                            >
                                                Öffnen
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
                                <button className="btn btn-secondary" onClick={() => { setShowForm(false); setDuplicates([]); }}>Abbrechen</button>
                                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                    {saving ? 'Speichern...' : (duplicates.length > 0 ? 'Trotzdem erstellen' : 'Erstellen')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk-Delete Bestätigung */}
            {showDeleteConfirm && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }} onClick={() => setShowDeleteConfirm(false)}>
                    <div className="card" style={{ padding: 'var(--space-lg)', maxWidth: 450, width: '100%' }}
                        onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-sm)' }}>Unwiderruflich löschen</h3>
                        <p style={{ marginBottom: 'var(--space-md)', fontSize: 'var(--font-size-sm)' }}>
                            {selected.size === 1
                                ? 'Soll dieser Kunde wirklich unwiderruflich gelöscht werden? Diese Aktion kann nicht rückgaengig gemacht werden.'
                                : `Sollen diese ${selected.size} Kunden wirklich unwiderruflich gelöscht werden? Diese Aktion kann nicht rückgaengig gemacht werden.`}
                        </p>
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Abbrechen</button>
                            <button className="btn" style={{ background: 'var(--color-danger)', color: 'white' }} onClick={handleBulkDelete}>
                                Unwiderruflich löschen
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
