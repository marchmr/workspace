import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';

/* ════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════ */

const trashIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
);

const editIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
);

const plusIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

interface CustomField {
    id: number;
    field_key: string;
    label: string;
    field_type: string;
    options: string[];
    required: boolean;
    sort_order: number;
    entity_type: string;
    is_active: boolean;
}

/* ════════════════════════════════════════════
   CRM Admin Settings
   ════════════════════════════════════════════ */

export default function CrmSettingsPage() {
    const toast = useToast();
    const [fields, setFields] = useState<CustomField[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'customer' | 'ticket' | 'contact'>('customer');

    // Neues-Feld-Formular
    const [showForm, setShowForm] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [formLabel, setFormLabel] = useState('');
    const [formType, setFormType] = useState('text');
    const [formRequired, setFormRequired] = useState(false);
    const [formOptions, setFormOptions] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await apiFetch(`/api/plugins/crm/settings/custom-fields?entity_type=${activeTab}`);
            if (res.ok) {
                const data = await res.json();
                setFields(data.fields || []);
            }
        } catch { /* */ }
        setLoading(false);
    }, [activeTab]);

    useEffect(() => { setLoading(true); void load(); }, [load]);

    const resetForm = () => {
        setShowForm(false);
        setEditId(null);
        setFormLabel('');
        setFormType('text');
        setFormRequired(false);
        setFormOptions('');
    };

    const handleSave = async () => {
        if (!formLabel.trim()) return;
        setSaving(true);

        const body: any = {
            label: formLabel.trim(),
            field_type: formType,
            required: formRequired,
            entity_type: activeTab,
        };

        if (formType === 'select' && formOptions.trim()) {
            body.options = formOptions.split(',').map((o: string) => o.trim()).filter(Boolean);
        }

        try {
            let res;
            if (editId) {
                res = await apiFetch(`/api/plugins/crm/settings/custom-fields/${editId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            } else {
                res = await apiFetch('/api/plugins/crm/settings/custom-fields', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            }

            if (res.ok) {
                toast.success(editId ? 'Feld aktualisiert' : 'Feld erstellt');
                resetForm();
                void load();
            } else {
                const err = await res.json();
                toast.error(err.error || 'Fehler');
            }
        } catch { toast.error('Netzwerkfehler'); }
        setSaving(false);
    };

    const handleEdit = (field: CustomField) => {
        setEditId(field.id);
        setFormLabel(field.label);
        setFormType(field.field_type);
        setFormRequired(field.required);
        setFormOptions(field.options?.join(', ') || '');
        setShowForm(true);
    };

    const handleDelete = async (id: number) => {
        try {
            const res = await apiFetch(`/api/plugins/crm/settings/custom-fields/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('Feld gelöscht');
                void load();
            }
        } catch { toast.error('Fehler'); }
    };

    const handleToggle = async (field: CustomField) => {
        try {
            const res = await apiFetch(`/api/plugins/crm/settings/custom-fields/${field.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: !field.is_active }),
            });
            if (res.ok) void load();
        } catch { /* */ }
    };

    const fieldTypeLabels: Record<string, string> = {
        text: 'Text',
        number: 'Zahl',
        date: 'Datum',
        select: 'Auswahl',
        checkbox: 'Checkbox',
        textarea: 'Textfeld (mehrzeilig)',
    };

    const entityLabels: Record<string, string> = {
        customer: 'Kunden',
        ticket: 'Tickets',
        contact: 'Kontakte',
    };

    return (
        <div>
            <h2 style={{ marginBottom: 'var(--space-sm)' }}>CRM Einstellungen</h2>
            <p className="text-muted" style={{ marginBottom: 'var(--space-md)', fontSize: 'var(--font-size-sm)' }}>
                Benutzerdefinierte Felder pro Mandant verwalten
            </p>

            {/* Entity-Tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 'var(--space-md)', borderBottom: '2px solid var(--color-border)' }}>
                {(['customer', 'ticket', 'contact'] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => { setActiveTab(tab); resetForm(); }}
                        style={{
                            padding: 'var(--space-sm) var(--space-md)', background: 'none', border: 'none',
                            cursor: 'pointer', fontWeight: activeTab === tab ? 600 : 400,
                            color: activeTab === tab ? 'var(--color-primary)' : 'var(--color-text-muted)',
                            borderBottom: activeTab === tab ? '2px solid var(--color-primary)' : '2px solid transparent',
                            marginBottom: '-2px', fontSize: 'var(--font-size-base)', transition: 'all 150ms ease',
                        }}
                    >
                        {entityLabels[tab]} Felder
                    </button>
                ))}
            </div>

            {/* Neues Feld */}
            <div style={{ marginBottom: 'var(--space-md)' }}>
                {!showForm ? (
                    <button className="btn btn-primary" onClick={() => setShowForm(true)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {plusIcon} Neues Feld
                    </button>
                ) : (
                    <div className="card" style={{ padding: 'var(--space-md)' }}>
                        <div style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>{editId ? 'Feld bearbeiten' : 'Neues Feld'}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                            <input className="input" placeholder="Feldname (z.B. Kundennummer Alt)" value={formLabel} onChange={(e) => setFormLabel(e.target.value)} autoFocus />
                            <select className="input" value={formType} onChange={(e) => setFormType(e.target.value)}>
                                {Object.entries(fieldTypeLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                            {formType === 'select' && (
                                <input className="input" placeholder="Optionen (kommagetrennt)" value={formOptions} onChange={(e) => setFormOptions(e.target.value)} />
                            )}
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}>
                                <input type="checkbox" checked={formRequired} onChange={(e) => setFormRequired(e.target.checked)} />
                                Pflichtfeld
                            </label>
                            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                                <button className="btn btn-secondary" onClick={resetForm}>Abbrechen</button>
                                <button className="btn btn-primary" onClick={handleSave} disabled={saving || !formLabel.trim()}>
                                    {saving ? 'Speichern...' : (editId ? 'Aktualisieren' : 'Erstellen')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Feldliste */}
            {loading ? (
                <div className="text-muted" style={{ padding: 'var(--space-md)' }}>Laden...</div>
            ) : fields.length === 0 ? (
                <div className="card" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>
                    <span className="text-muted">Keine benutzerdefinierten Felder für {entityLabels[activeTab]} definiert</span>
                </div>
            ) : (
                <div className="card" style={{ padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                                <th style={{ padding: '8px 12px', textAlign: 'left' }}>Label</th>
                                <th style={{ padding: '8px 12px', textAlign: 'left' }}>Schluessel</th>
                                <th style={{ padding: '8px 12px', textAlign: 'left' }}>Typ</th>
                                <th style={{ padding: '8px 12px', textAlign: 'center' }}>Pflicht</th>
                                <th style={{ padding: '8px 12px', textAlign: 'center' }}>Aktiv</th>
                                <th style={{ padding: '8px 12px', width: 80 }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {fields.map((f) => (
                                <tr key={f.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td style={{ padding: '8px 12px', fontWeight: 500 }}>{f.label}</td>
                                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--color-text-muted)' }}>{f.field_key}</td>
                                    <td style={{ padding: '8px 12px' }}>{fieldTypeLabels[f.field_type] || f.field_type}</td>
                                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>{f.required ? 'Ja' : '—'}</td>
                                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                        <input type="checkbox" checked={f.is_active} onChange={() => handleToggle(f)} />
                                    </td>
                                    <td style={{ padding: '8px 12px' }}>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            <button onClick={() => handleEdit(f)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2 }} title="Bearbeiten">
                                                {editIcon}
                                            </button>
                                            <button onClick={() => handleDelete(f.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', display: 'flex', padding: 2 }} title="Löschen">
                                                {trashIcon}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
