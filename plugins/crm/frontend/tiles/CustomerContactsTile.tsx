import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';

interface ContactCategory {
    id: number;
    name: string;
    color: string;
}

export default function CustomerContactsTile({ customerId }: { customerId: number }) {
    const toast = useToast();
    const [contacts, setContacts] = useState<any[]>([]);
    const [categories, setCategories] = useState<ContactCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [showNew, setShowNew] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState({
        first_name: '', last_name: '', email: '', phone: '', mobile: '',
        position: '', department: '', is_primary: false, is_billing_contact: false,
        category_id: '' as string | number,
    });
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const [cRes, catRes] = await Promise.all([
                apiFetch(`/api/plugins/crm/contacts/?customer_id=${customerId}`),
                apiFetch('/api/plugins/crm/contacts/categories'),
            ]);
            if (cRes.ok) { const d = await cRes.json(); setContacts(d.contacts || []); }
            if (catRes.ok) { const d = await catRes.json(); setCategories(d.categories || []); }
        } catch { /* */ }
        setLoading(false);
    }, [customerId]);

    useEffect(() => { void load(); }, [load]);

    const resetForm = () => {
        setForm({
            first_name: '', last_name: '', email: '', phone: '', mobile: '',
            position: '', department: '', is_primary: false, is_billing_contact: false,
            category_id: '',
        });
        setEditId(null);
        setShowNew(false);
    };

    const handleSave = async () => {
        if (!form.last_name.trim()) { toast.error('Nachname erforderlich'); return; }
        setSaving(true);
        try {
            const payload = {
                ...form,
                customer_id: customerId,
                category_id: form.category_id ? Number(form.category_id) : null,
            };
            const url = editId ? `/api/plugins/crm/contacts/${editId}` : '/api/plugins/crm/contacts/';
            const res = await apiFetch(url, {
                method: editId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                toast.success(editId ? 'Kontakt aktualisiert' : 'Kontakt erstellt');
                resetForm();
                void load();
            } else { const e = await res.json(); toast.error(e.error || 'Fehler'); }
        } catch { toast.error('Fehler'); }
        setSaving(false);
    };

    const handleEdit = (c: any) => {
        setForm({
            first_name: c.first_name || '', last_name: c.last_name || '',
            email: c.email || '', phone: c.phone || '', mobile: c.mobile || '',
            position: c.position || '', department: c.department || '',
            is_primary: c.is_primary, is_billing_contact: c.is_billing_contact || false,
            category_id: c.category_id || '',
        });
        setEditId(c.id);
        setShowNew(true);
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Kontakt wirklich löschen?')) return;
        try {
            const res = await apiFetch(`/api/plugins/crm/contacts/${id}`, { method: 'DELETE' });
            if (res.ok) { toast.success('Kontakt gelöscht'); void load(); }
        } catch { toast.error('Fehler'); }
    };

    const handleVcard = async (id: number) => {
        try {
            const res = await apiFetch(`/api/plugins/crm/contacts/${id}/vcard`);
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `kontakt_${id}.vcf`;
                a.click();
                URL.revokeObjectURL(url);
            }
        } catch { toast.error('vCard-Export fehlgeschlagen'); }
    };

    // Nach Kategorie gruppieren
    const grouped = new Map<string, any[]>();
    contacts.forEach((c) => {
        const key = c.category_name || 'Ohne Kategorie';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(c);
    });

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Ansprechpartner ({contacts.length})</span>
                <button onClick={() => { resetForm(); setShowNew(!showNew); }} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 18, lineHeight: 1,
                }}>{showNew ? '\u00d7' : '+'}</button>
            </div>

            {showNew && (
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                        <input className="input input-sm" placeholder="Vorname" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} style={{ flex: 1 }} />
                        <input className="input input-sm" placeholder="Nachname *" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} style={{ flex: 1 }} />
                    </div>
                    <input className="input input-sm" placeholder="E-Mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    <div style={{ display: 'flex', gap: 4 }}>
                        <input className="input input-sm" placeholder="Telefon" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ flex: 1 }} />
                        <input className="input input-sm" placeholder="Mobil" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} style={{ flex: 1 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                        <input className="input input-sm" placeholder="Position" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} style={{ flex: 1 }} />
                        <input className="input input-sm" placeholder="Abteilung" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} style={{ flex: 1 }} />
                    </div>
                    {/* Kategorie */}
                    <select
                        className="input input-sm"
                        value={form.category_id}
                        onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    >
                        <option value="">Kategorie wählen...</option>
                        {categories.map((cat) => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                    </select>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, cursor: 'pointer' }}>
                                <input type="checkbox" checked={form.is_primary} onChange={(e) => setForm({ ...form, is_primary: e.target.checked })} />
                                Hauptkontakt
                            </label>
                            <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, cursor: 'pointer' }}>
                                <input type="checkbox" checked={form.is_billing_contact} onChange={(e) => setForm({ ...form, is_billing_contact: e.target.checked })} />
                                Rechnungskontakt
                            </label>
                        </div>
                        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !form.last_name.trim()} style={{ fontSize: 11 }}>
                            {editId ? 'Speichern' : 'Anlegen'}
                        </button>
                    </div>
                </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                {loading ? (
                    <div className="text-muted" style={{ padding: 12, textAlign: 'center', fontSize: 12 }}>Laden...</div>
                ) : contacts.length === 0 ? (
                    <div className="text-muted" style={{ padding: 12, textAlign: 'center', fontSize: 12 }}>Keine Ansprechpartner</div>
                ) : (
                    Array.from(grouped.entries()).map(([groupName, groupContacts]) => (
                        <div key={groupName}>
                            {/* Kategorie-Header nur wenn mehr als eine Gruppe */}
                            {grouped.size > 1 && (
                                <div style={{
                                    padding: '4px 12px', fontSize: 10, fontWeight: 600,
                                    color: groupContacts[0]?.category_color || 'var(--color-text-muted)',
                                    textTransform: 'uppercase', letterSpacing: '0.5px',
                                    background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)',
                                }}>
                                    {groupName}
                                </div>
                            )}
                            {groupContacts.map((c: any) => (
                                <div key={c.id} style={{ padding: '6px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 12 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                            <span style={{ fontWeight: 500 }}>{c.first_name} {c.last_name}</span>
                                            {c.is_primary && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 6, background: 'var(--color-primary)', color: '#fff', fontWeight: 600 }}>HAUPT</span>}
                                            {c.is_billing_contact && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 6, background: 'var(--color-warning)', color: '#fff', fontWeight: 600 }}>RECHNUNG</span>}
                                            {c.category_name && grouped.size <= 1 && (
                                                <span style={{
                                                    fontSize: 9, padding: '1px 6px', borderRadius: 6,
                                                    background: `${c.category_color}18`, color: c.category_color,
                                                    fontWeight: 600, border: `1px solid ${c.category_color}30`,
                                                }}>{c.category_name}</span>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                            <button onClick={() => handleVcard(c.id)} title="vCard exportieren" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-text-muted)' }}>
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                            </button>
                                            <button onClick={() => handleEdit(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-primary)' }}>Bearbeiten</button>
                                            <button onClick={() => handleDelete(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-danger)' }}>{'\u00d7'}</button>
                                        </div>
                                    </div>
                                    <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>
                                        {c.position && <span>{c.position}</span>}
                                        {c.position && c.department && <span> · </span>}
                                        {c.department && <span>{c.department}</span>}
                                    </div>
                                    <div className="text-muted" style={{ fontSize: 10 }}>
                                        {c.email && <span>{c.email}</span>}
                                        {c.email && c.phone && <span> · </span>}
                                        {c.phone && <span>{c.phone}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
