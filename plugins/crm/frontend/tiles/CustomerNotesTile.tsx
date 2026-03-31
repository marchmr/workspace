import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';

export default function CustomerNotesTile({ customerId }: { customerId: number }) {
    const toast = useToast();
    const [notes, setNotes] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showNew, setShowNew] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await apiFetch(`/api/plugins/crm/notes/?customer_id=${customerId}`);
            if (res.ok) { const d = await res.json(); setNotes(d.notes || []); }
        } catch { /* */ }
        setLoading(false);
    }, [customerId]);

    useEffect(() => { void load(); }, [load]);

    const reset = () => { setTitle(''); setContent(''); setEditId(null); setShowNew(false); };

    const handleSave = async () => {
        if (!content.trim()) { toast.error('Inhalt erforderlich'); return; }
        setSaving(true);
        try {
            const url = editId ? `/api/plugins/crm/notes/${editId}` : '/api/plugins/crm/notes/';
            const res = await apiFetch(url, {
                method: editId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title.trim() || null, content: content.trim(), customer_id: customerId }),
            });
            if (res.ok) {
                toast.success(editId ? 'Notiz aktualisiert' : 'Notiz erstellt');
                reset();
                void load();
            }
        } catch { toast.error('Fehler'); }
        setSaving(false);
    };

    const handlePin = async (id: number) => {
        try {
            const res = await apiFetch(`/api/plugins/crm/notes/${id}/pin`, { method: 'PATCH' });
            if (res.ok) void load();
        } catch { /* */ }
    };

    const handleEdit = (n: any) => {
        setTitle(n.title || ''); setContent(n.content || ''); setEditId(n.id); setShowNew(true);
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Notiz wirklich löschen?')) return;
        try {
            const res = await apiFetch(`/api/plugins/crm/notes/${id}`, { method: 'DELETE' });
            if (res.ok) { toast.success('Gelöscht'); void load(); }
        } catch { /* */ }
    };

    const formatDate = (d: string) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Notizen ({notes.length})</span>
                <button onClick={() => { reset(); setShowNew(!showNew); }} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 18, lineHeight: 1,
                }}>{showNew ? '×' : '+'}</button>
            </div>

            {showNew && (
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <input className="input" placeholder="Titel (optional)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontSize: 12, padding: '4px 8px' }} />
                    <textarea className="textarea" placeholder="Notiz *" value={content} onChange={(e) => setContent(e.target.value)} rows={4} style={{ fontSize: 12, padding: '4px 8px' }} />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                        <button className="btn btn-secondary btn-sm" onClick={reset} style={{ fontSize: 11 }}>Abbrechen</button>
                        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !content.trim()} style={{ fontSize: 11 }}>
                            {editId ? 'Speichern' : 'Erstellen'}
                        </button>
                    </div>
                </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                {loading ? (
                    <div className="text-muted" style={{ padding: 12, textAlign: 'center', fontSize: 12 }}>Laden...</div>
                ) : notes.length === 0 ? (
                    <div className="text-muted" style={{ padding: 12, textAlign: 'center', fontSize: 12 }}>Keine Notizen</div>
                ) : notes.map((n) => (
                    <div key={n.id} style={{
                        padding: '6px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 12,
                        borderLeft: n.is_pinned ? '3px solid var(--color-warning)' : '3px solid transparent',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontWeight: 500 }}>
                                {n.is_pinned && <span style={{ color: 'var(--color-warning)', marginRight: 4, fontSize: 10 }}>&#9733;</span>}
                                {n.title || 'Ohne Titel'}
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <button onClick={() => handlePin(n.id)} title={n.is_pinned ? 'Lospinnen' : 'Anpinnen'}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: n.is_pinned ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
                                    &#9733;
                                </button>
                                <button onClick={() => handleEdit(n)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-primary)' }}>&#9998;</button>
                                <button onClick={() => handleDelete(n.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--color-danger)' }}>×</button>
                            </div>
                        </div>
                        <div className="text-muted" style={{ fontSize: 10, marginTop: 2, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>{n.content}</div>
                        <div className="text-muted" style={{ fontSize: 9, marginTop: 2 }}>{n.created_by_name} · {formatDate(n.created_at)}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
