import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';

/* ── SVG Icons ── */
const plusIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const editIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
const trashIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>;
const copyIcon = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>;
const mapIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>;
const starIcon = <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>;

interface Address {
    id: number;
    customer_id: number;
    address_type: string;
    custom_label: string | null;
    is_default: boolean;
    company_name: string | null;
    recipient: string | null;
    street: string | null;
    street2: string | null;
    zip: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    notes: string | null;
    type_label: string;
}

const TYPE_CONFIG: Record<string, { color: string; bg: string }> = {
    main:     { color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
    billing:  { color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
    shipping: { color: '#16a34a', bg: 'rgba(22,163,74,0.1)' },
    branch:   { color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
    custom:   { color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
};

const EMPTY_FORM = {
    address_type: 'billing',
    custom_label: '',
    is_default: false,
    company_name: '',
    recipient: '',
    street: '',
    street2: '',
    zip: '',
    city: '',
    state: '',
    country: 'Deutschland',
    notes: '',
};

export default function CustomerAddressesTile({ customerId }: { customerId: number }) {
    const toast = useToast();
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<any>({ ...EMPTY_FORM });
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await apiFetch(`/api/plugins/crm/addresses/?customer_id=${customerId}`);
            if (res.ok) {
                const data = await res.json();
                setAddresses(data.addresses || []);
            }
        } catch { /* */ }
        setLoading(false);
    }, [customerId]);

    useEffect(() => { void load(); }, [load]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const url = editId
                ? `/api/plugins/crm/addresses/${editId}`
                : '/api/plugins/crm/addresses/';
            const method = editId ? 'PUT' : 'POST';
            const body = editId ? form : { ...form, customer_id: customerId };

            const res = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (res.ok) {
                toast.success(editId ? 'Adresse aktualisiert' : 'Adresse erstellt');
                setShowForm(false);
                setEditId(null);
                setForm({ ...EMPTY_FORM });
                void load();
            } else {
                const err = await res.json().catch(() => ({ error: 'Unbekannter Fehler' }));
                toast.error(err.error || 'Fehler beim Speichern');
            }
        } catch { toast.error('Netzwerkfehler'); }
        setSaving(false);
    };

    const handleEdit = (addr: Address) => {
        setEditId(addr.id);
        setForm({
            address_type: addr.address_type,
            custom_label: addr.custom_label || '',
            is_default: addr.is_default,
            company_name: addr.company_name || '',
            recipient: addr.recipient || '',
            street: addr.street || '',
            street2: addr.street2 || '',
            zip: addr.zip || '',
            city: addr.city || '',
            state: addr.state || '',
            country: addr.country || 'Deutschland',
            notes: addr.notes || '',
        });
        setShowForm(true);
    };

    const handleDelete = async (id: number) => {
        try {
            const res = await apiFetch(`/api/plugins/crm/addresses/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('Adresse gelöscht');
                void load();
            }
        } catch { toast.error('Fehler'); }
    };

    const copyAddress = (addr: Address) => {
        const parts = [
            addr.company_name,
            addr.recipient,
            addr.street,
            addr.street2,
            [addr.zip, addr.city].filter(Boolean).join(' '),
            addr.state,
            addr.country !== 'Deutschland' ? addr.country : null,
        ].filter(Boolean);
        navigator.clipboard.writeText(parts.join('\n')).then(() => toast.success('Adresse kopiert'));
    };

    // Gruppiert nach Typ
    const grouped = new Map<string, Address[]>();
    const typeOrder = ['main', 'billing', 'shipping', 'branch', 'custom'];
    for (const t of typeOrder) grouped.set(t, []);
    for (const a of addresses) {
        const list = grouped.get(a.address_type) || [];
        list.push(a);
        grouped.set(a.address_type, list);
    }

    // Pruefen ob main existiert (fuer "Neuer Typ" Dropdown)
    const hasMain = addresses.some(a => a.address_type === 'main');

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'flex', color: 'var(--color-text-muted)' }}>{mapIcon}</span>
                    <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Adressen ({addresses.length})</span>
                </div>
                <button
                    onClick={() => { setEditId(null); setForm({ ...EMPTY_FORM }); setShowForm(true); }}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 4,
                        fontSize: 'var(--font-size-xs)', fontWeight: 600,
                    }}
                >
                    {plusIcon} Hinzufügen
                </button>
            </div>

            {/* Inhalt */}
            <div style={{ flex: 1, overflow: 'auto' }}>
                {loading ? (
                    <div className="text-muted" style={{ padding: 'var(--space-md)', textAlign: 'center' }}>Laden...</div>
                ) : addresses.length === 0 ? (
                    <div className="text-muted" style={{ padding: 'var(--space-md)', textAlign: 'center', fontSize: 'var(--font-size-sm)' }}>
                        Keine Adressen hinterlegt
                    </div>
                ) : (
                    Array.from(grouped.entries()).map(([type, addrs]) => {
                        if (addrs.length === 0) return null;
                        const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.custom;
                        const typeLabel = type === 'main' ? 'Kundenanschrift'
                            : type === 'billing' ? 'Rechnungsadressen'
                            : type === 'shipping' ? 'Lieferadressen'
                            : type === 'branch' ? 'Niederlassungen'
                            : 'Sonstige';

                        return (
                            <div key={type} style={{ marginBottom: 'var(--space-sm)' }}>
                                <div style={{
                                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                                    color: cfg.color, marginBottom: 4,
                                }}>
                                    {typeLabel} ({addrs.length})
                                </div>
                                {addrs.map((addr) => (
                                    <div
                                        key={addr.id}
                                        style={{
                                            padding: '8px 10px', borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--color-border)', marginBottom: 6,
                                            fontSize: 'var(--font-size-xs)', position: 'relative',
                                            background: addr.is_default ? cfg.bg : 'transparent',
                                        }}
                                    >
                                        {/* Badge + Default */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                            <span style={{
                                                fontSize: 9, padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                                                background: cfg.bg, color: cfg.color, fontWeight: 700, textTransform: 'uppercase',
                                            }}>
                                                {addr.type_label}
                                            </span>
                                            {addr.is_default && (
                                                <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, color: '#eab308', fontWeight: 600 }}>
                                                    {starIcon} Standard
                                                </span>
                                            )}
                                        </div>

                                        {/* Adresse */}
                                        <div style={{ lineHeight: 1.5, color: 'var(--color-text-secondary)' }}>
                                            {addr.company_name && <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{addr.company_name}</div>}
                                            {addr.recipient && <div>{addr.recipient}</div>}
                                            {addr.street && <div>{addr.street}</div>}
                                            {addr.street2 && <div>{addr.street2}</div>}
                                            {(addr.zip || addr.city) && <div>{[addr.zip, addr.city].filter(Boolean).join(' ')}</div>}
                                            {addr.state && <div>{addr.state}</div>}
                                            {addr.country && addr.country !== 'Deutschland' && <div>{addr.country}</div>}
                                        </div>

                                        {/* Aktionen */}
                                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                            <button onClick={() => copyAddress(addr)} title="Kopieren" style={{
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                color: 'var(--color-text-muted)', display: 'flex', padding: 2,
                                            }}>{copyIcon}</button>
                                            <button onClick={() => handleEdit(addr)} title="Bearbeiten" style={{
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                color: 'var(--color-text-muted)', display: 'flex', padding: 2,
                                            }}>{editIcon}</button>
                                            {addr.address_type !== 'main' && (
                                                <button onClick={() => handleDelete(addr.id)} title="Löschen" style={{
                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                    color: 'var(--color-danger)', display: 'flex', padding: 2,
                                                }}>{trashIcon}</button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Erstellen/Bearbeiten Modal */}
            {showForm && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }} onClick={() => { setShowForm(false); setEditId(null); }}>
                    <div className="card" style={{ padding: 'var(--space-lg)', maxWidth: 500, width: '100%' }}
                        onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ marginBottom: 'var(--space-md)', fontSize: 'var(--font-size-md)' }}>
                            {editId ? 'Adresse bearbeiten' : 'Neue Adresse'}
                        </h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                            {/* Typ */}
                            {!editId && (
                                <select className="input" value={form.address_type}
                                    onChange={(e) => setForm({ ...form, address_type: e.target.value })}>
                                    {!hasMain && <option value="main">Kundenanschrift</option>}
                                    <option value="billing">Rechnungsadresse</option>
                                    <option value="shipping">Lieferadresse</option>
                                    <option value="branch">Niederlassung</option>
                                    <option value="custom">Sonstige</option>
                                </select>
                            )}

                            {/* Custom Label (bei branch/custom) */}
                            {(form.address_type === 'custom' || form.address_type === 'branch') && (
                                <input className="input" placeholder="Bezeichnung (z.B. Zweigstelle Muenchen)"
                                    value={form.custom_label} onChange={(e) => setForm({ ...form, custom_label: e.target.value })} />
                            )}

                            <input className="input" placeholder="Abweichende Firma (optional)"
                                value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
                            <input className="input" placeholder="Empfaenger / z.Hd."
                                value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} />
                            <input className="input" placeholder="Strasse"
                                value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} autoFocus />
                            <input className="input" placeholder="Adresszusatz"
                                value={form.street2} onChange={(e) => setForm({ ...form, street2: e.target.value })} />
                            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 'var(--space-sm)' }}>
                                <input className="input" placeholder="PLZ"
                                    value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
                                <input className="input" placeholder="Ort"
                                    value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                                <input className="input" placeholder="Bundesland"
                                    value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                                <input className="input" placeholder="Land"
                                    value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
                            </div>

                            {form.address_type !== 'main' && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={form.is_default}
                                        onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
                                    Als Standard fuer diesen Typ markieren
                                </label>
                            )}

                            <textarea className="input" placeholder="Notizen (optional)" rows={2}
                                value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                style={{ resize: 'vertical' }} />
                        </div>

                        <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end', marginTop: 'var(--space-md)' }}>
                            <button className="btn btn-secondary" onClick={() => { setShowForm(false); setEditId(null); }}>Abbrechen</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                {saving ? 'Speichern...' : (editId ? 'Aktualisieren' : 'Erstellen')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
