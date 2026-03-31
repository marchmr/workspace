import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@mike/hooks/usePluginNavigate';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';

const statusLabels: Record<string, string> = {
    open: 'Offen', in_progress: 'In Bearbeitung', waiting: 'Wartend', resolved: 'Gelöst', closed: 'Geschlossen',
};
const statusColors: Record<string, string> = {
    open: '#6366f1', in_progress: '#f59e0b', waiting: '#a78bfa', resolved: '#22c55e', closed: '#64748b',
};
const priorityLabels: Record<string, string> = { low: 'Niedrig', normal: 'Normal', high: 'Hoch', urgent: 'Dringend' };
const priorityColors: Record<string, string> = { low: '#64748b', normal: '#6366f1', high: '#f59e0b', urgent: '#ef4444' };

export default function CustomerTicketsTile({ customerId }: { customerId: number }) {
    const navigate = useNavigate();
    const toast = useToast();
    const [tickets, setTickets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showNew, setShowNew] = useState(false);
    const [subject, setSubject] = useState('');
    const [priority, setPriority] = useState('normal');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await apiFetch(`/api/plugins/crm/tickets/?customer_id=${customerId}&pageSize=50`);
            if (res.ok) { const d = await res.json(); setTickets(d.items || []); }
        } catch { /* */ }
        setLoading(false);
    }, [customerId]);

    useEffect(() => { void load(); }, [load]);

    const onCreate = async () => {
        if (!subject.trim()) return;
        setSaving(true);
        try {
            const res = await apiFetch('/api/plugins/crm/tickets/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject: subject.trim(), priority, customer_id: customerId }),
            });
            if (res.ok) {
                toast.success('Ticket erstellt');
                setShowNew(false); setSubject(''); setPriority('normal');
                void load();
            }
        } catch { toast.error('Fehler'); }
        setSaving(false);
    };

    const formatDate = (d: string) => new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Tickets ({tickets.length})</span>
                <button onClick={() => setShowNew(!showNew)} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 18, lineHeight: 1,
                }}>+</button>
            </div>

            {showNew && (
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input className="input" placeholder="Betreff *" value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus style={{ fontSize: 12 }} />
                    <div style={{ display: 'flex', gap: 6 }}>
                        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)} style={{ flex: 1, fontSize: 12 }}>
                            {Object.entries(priorityLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <button className="btn btn-primary btn-sm" onClick={onCreate} disabled={saving || !subject.trim()} style={{ fontSize: 11 }}>Erstellen</button>
                    </div>
                </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                {loading ? (
                    <div className="text-muted" style={{ padding: 12, textAlign: 'center', fontSize: 12 }}>Laden...</div>
                ) : tickets.length === 0 ? (
                    <div className="text-muted" style={{ padding: 12, textAlign: 'center', fontSize: 12 }}>Keine Tickets</div>
                ) : tickets.map((t) => (
                    <div key={t.id} onClick={() => navigate(`/crm/tickets/${t.id}`)}
                        style={{
                            padding: '6px 12px', cursor: 'pointer', borderBottom: '1px solid var(--color-border)',
                            transition: 'background 100ms', fontSize: 12,
                        }}
                        onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(99,102,241,.05)')}
                        onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{t.subject}</span>
                            <span style={{
                                padding: '1px 6px', borderRadius: 8, fontSize: 10,
                                background: statusColors[t.status] + '20', color: statusColors[t.status],
                            }}>{statusLabels[t.status]}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 2 }} className="text-muted">
                            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono, monospace)' }}>{t.ticket_number}</span>
                            <span style={{ fontSize: 10, color: priorityColors[t.priority] }}>{priorityLabels[t.priority]}</span>
                            <span style={{ fontSize: 10 }}>{formatDate(t.created_at)}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
