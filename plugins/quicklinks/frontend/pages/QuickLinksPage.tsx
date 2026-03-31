import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';
import { usePermission } from '@mike/hooks/usePermission';

/* ════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════ */

const globeIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
);

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

const externalIcon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
);

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

interface Quicklink {
    id: number;
    url: string;
    title: string;
    category: string;
    scope: 'personal' | 'tenant';
    favicon_base64: string | null;
    sort_order: number;
    created_at: string;
}

/* ════════════════════════════════════════════
   Quicklinks Page
   ════════════════════════════════════════════ */

export default function QuicklinksPage() {
    const toast = useToast();
    const canManage = usePermission('quicklinks.manage');
    const [activeTab, setActiveTab] = useState<'personal' | 'tenant'>('personal');
    const [links, setLinks] = useState<{ tenantLinks: Quicklink[]; personalLinks: Quicklink[] }>({ tenantLinks: [], personalLinks: [] });
    const [categories, setCategories] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    // Formular
    const [showForm, setShowForm] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [formUrl, setFormUrl] = useState('');
    const [formTitle, setFormTitle] = useState('');
    const [formCategory, setFormCategory] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const [linksRes, catRes] = await Promise.all([
                apiFetch('/api/plugins/quicklinks/'),
                apiFetch('/api/plugins/quicklinks/categories'),
            ]);
            if (linksRes.ok) setLinks(await linksRes.json());
            if (catRes.ok) {
                const catData = await catRes.json();
                setCategories(catData.categories || []);
            }
        } catch { /* */ }
        setLoading(false);
    }, []);

    useEffect(() => { void load(); }, [load]);

    const resetForm = () => {
        setShowForm(false);
        setEditId(null);
        setFormUrl('');
        setFormTitle('');
        setFormCategory('');
    };

    const handleSave = async () => {
        if (!formUrl.trim() || !formTitle.trim()) return;
        setSaving(true);

        try {
            const body = {
                url: formUrl.trim(),
                title: formTitle.trim(),
                category: formCategory.trim() || 'Allgemein',
            };

            let res;
            if (editId) {
                res = await apiFetch(`/api/plugins/quicklinks/${editId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            } else {
                const endpoint = activeTab === 'tenant' ? '/api/plugins/quicklinks/tenant' : '/api/plugins/quicklinks/';
                res = await apiFetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            }

            if (res.ok) {
                toast.success(editId ? 'Link aktualisiert' : 'Link erstellt');
                resetForm();
                await load();
            } else {
                const data = await res.json();
                toast.error(data.error || 'Fehler');
            }
        } catch {
            toast.error('Netzwerkfehler');
        }
        setSaving(false);
    };

    const handleEdit = (link: Quicklink) => {
        setEditId(link.id);
        setFormUrl(link.url);
        setFormTitle(link.title);
        setFormCategory(link.category);
        setShowForm(true);
    };

    const handleDelete = async (id: number) => {
        try {
            const res = await apiFetch(`/api/plugins/quicklinks/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('Link geloescht');
                await load();
            }
        } catch { toast.error('Fehler beim Loeschen'); }
    };

    const currentLinks = activeTab === 'personal' ? links.personalLinks : links.tenantLinks;

    // Nach Kategorie gruppieren
    const grouped = currentLinks.reduce<Record<string, Quicklink[]>>((acc, link) => {
        const cat = link.category || 'Allgemein';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(link);
        return acc;
    }, {});
    const groupedCategories = Object.keys(grouped).sort();

    if (loading) return <div className="text-muted" style={{ padding: 'var(--space-lg)' }}>Laden...</div>;

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Schnellzugriff</h1>
                <p className="page-subtitle">Persoenliche und Team-Links verwalten</p>
            </div>

            {/* Tabs */}
            <div style={{
                display: 'flex', gap: 0, marginBottom: 'var(--space-md)',
                borderBottom: '2px solid var(--color-border)',
            }}>
                <button
                    onClick={() => { setActiveTab('personal'); resetForm(); }}
                    style={{
                        padding: 'var(--space-sm) var(--space-md)',
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontWeight: activeTab === 'personal' ? 600 : 400,
                        color: activeTab === 'personal' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                        borderBottom: activeTab === 'personal' ? '2px solid var(--color-primary)' : '2px solid transparent',
                        marginBottom: '-2px', fontSize: 'var(--font-size-base)',
                        transition: 'all 150ms ease',
                    }}
                >
                    Meine Links ({links.personalLinks.length})
                </button>
                <button
                    onClick={() => { setActiveTab('tenant'); resetForm(); }}
                    style={{
                        padding: 'var(--space-sm) var(--space-md)',
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontWeight: activeTab === 'tenant' ? 600 : 400,
                        color: activeTab === 'tenant' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                        borderBottom: activeTab === 'tenant' ? '2px solid var(--color-primary)' : '2px solid transparent',
                        marginBottom: '-2px', fontSize: 'var(--font-size-base)',
                        transition: 'all 150ms ease',
                    }}
                >
                    Team-Links ({links.tenantLinks.length})
                </button>
            </div>

            {/* Neuer Link Button */}
            {(activeTab === 'personal' || canManage) && (
                <div style={{ marginBottom: 'var(--space-md)' }}>
                    {!showForm ? (
                        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
                            Link hinzufuegen
                        </button>
                    ) : (
                        <div className="card" style={{ padding: 'var(--space-md)' }}>
                            <div className="card-title">{editId ? 'Link bearbeiten' : 'Neuer Link'}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                                <input
                                    className="input"
                                    placeholder="URL (z.B. https://github.com)"
                                    value={formUrl}
                                    onChange={(e) => setFormUrl(e.target.value)}
                                    autoFocus
                                />
                                <input
                                    className="input"
                                    placeholder="Anzeigename"
                                    value={formTitle}
                                    onChange={(e) => setFormTitle(e.target.value)}
                                />
                                <div style={{ position: 'relative' }}>
                                    <input
                                        className="input"
                                        placeholder="Kategorie (z.B. Tools, Dokumente, ...)"
                                        value={formCategory}
                                        onChange={(e) => setFormCategory(e.target.value)}
                                        list="ql-categories"
                                    />
                                    {categories.length > 0 && (
                                        <datalist id="ql-categories">
                                            {categories.map(c => <option key={c} value={c} />)}
                                        </datalist>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                                    <button className="btn btn-secondary" onClick={resetForm}>Abbrechen</button>
                                    <button
                                        className="btn btn-primary"
                                        onClick={handleSave}
                                        disabled={saving || !formUrl.trim() || !formTitle.trim()}
                                    >
                                        {saving ? 'Speichern...' : (editId ? 'Aktualisieren' : 'Speichern')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Links nach Kategorie */}
            {currentLinks.length === 0 ? (
                <div className="card" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>
                    <span className="text-muted">
                        {activeTab === 'personal'
                            ? 'Du hast noch keine persoenlichen Links erstellt.'
                            : 'Es sind noch keine Team-Links vorhanden.'
                        }
                    </span>
                </div>
            ) : (
                groupedCategories.map(cat => (
                    <div key={cat} style={{ marginBottom: 'var(--space-md)' }}>
                        <div style={{
                            fontSize: 'var(--font-size-sm)', fontWeight: 600,
                            color: 'var(--color-text-muted)', textTransform: 'uppercase',
                            letterSpacing: '0.5px', padding: 'var(--space-xs) 0',
                            marginBottom: 'var(--space-xs)',
                        }}>
                            {cat}
                        </div>
                        <div className="card" style={{ padding: 0 }}>
                            {grouped[cat].map((link, idx) => (
                                <div
                                    key={link.id}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
                                        padding: 'var(--space-sm) var(--space-md)',
                                        borderBottom: idx < grouped[cat].length - 1 ? '1px solid var(--color-border)' : 'none',
                                        transition: 'background 120ms ease',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                >
                                    {/* Favicon */}
                                    {link.favicon_base64 ? (
                                        <img src={link.favicon_base64} alt="" width={20} height={20}
                                            style={{ borderRadius: 3, flexShrink: 0 }}
                                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                        />
                                    ) : (
                                        <span style={{ flexShrink: 0, display: 'flex' }}>{globeIcon}</span>
                                    )}

                                    {/* Titel + URL */}
                                    <a
                                        href={link.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{
                                            flex: 1, textDecoration: 'none', color: 'var(--color-text)',
                                            display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden',
                                        }}
                                    >
                                        <span style={{
                                            fontWeight: 500, fontSize: 'var(--font-size-base)',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            display: 'flex', alignItems: 'center', gap: 6,
                                        }}>
                                            {link.title}
                                            <span style={{ display: 'inline-flex', opacity: 0.4 }}>{externalIcon}</span>
                                        </span>
                                        <span style={{
                                            fontSize: '12px', color: 'var(--color-text-muted)',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>
                                            {link.url}
                                        </span>
                                    </a>

                                    {/* Aktionen */}
                                    {(activeTab === 'personal' || canManage) && (
                                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                            <button
                                                onClick={() => handleEdit(link)}
                                                style={{
                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                    color: 'var(--color-text-muted)', display: 'flex', padding: 4,
                                                }}
                                                title="Bearbeiten"
                                            >
                                                {editIcon}
                                            </button>
                                            <button
                                                onClick={() => handleDelete(link.id)}
                                                style={{
                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                    color: 'var(--color-danger)', display: 'flex', padding: 4,
                                                }}
                                                title="Loeschen"
                                            >
                                                {trashIcon}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}
