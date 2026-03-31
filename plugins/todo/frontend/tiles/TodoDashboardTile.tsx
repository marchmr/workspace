import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@mike/hooks/usePluginNavigate';
import { apiFetch } from '@mike/context/AuthContext';

const checkIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);
const alertIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
);

interface TodoItem {
    id: number;
    title: string;
    priority: string;
    status: string;
    due_date: string | null;
}

function isOverdue(dueDate: string | null, status: string): boolean {
    if (!dueDate || status === 'erledigt') return false;
    return new Date(dueDate) < new Date(new Date().toDateString());
}

export default function TodoDashboardTile() {
    const navigate = useNavigate();
    const [items, setItems] = useState<TodoItem[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const res = await apiFetch('/api/plugins/todo/');
            if (res.ok) {
                const data = await res.json();
                const active = (data.items || []).filter((i: TodoItem) => i.status !== 'erledigt');
                setItems(active.slice(0, 5));
            }
        } catch { /* */ }
        setLoading(false);
    }, []);

    useEffect(() => { void load(); }, [load]);

    const markDone = async (id: number) => {
        await apiFetch(`/api/plugins/todo/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'erledigt' }),
        });
        await load();
    };

    if (loading) return <div className="text-muted" style={{ padding: 'var(--space-sm)' }}>Laden...</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div
                onClick={() => navigate('/todo')}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 0 var(--space-sm) 0',
                    marginBottom: 'var(--space-sm)',
                    borderBottom: '1px solid var(--color-border)',
                    cursor: 'pointer',
                }}
            >
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Todo</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </div>

            {items.length === 0 ? (
                <div
                    className="text-muted"
                    onClick={() => navigate('/todo')}
                    style={{ textAlign: 'center', padding: 'var(--space-md)', fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}
                >
                    Keine offenen Aufgaben
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    {items.map((item) => {
                        const overdue = isOverdue(item.due_date, item.status);
                        return (
                            <div
                                key={item.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-sm)',
                                    padding: '4px 0',
                                    borderBottom: '1px solid var(--color-border)',
                                }}
                            >
                                <button
                                    onClick={() => markDone(item.id)}
                                    style={{
                                        width: 22, height: 22, borderRadius: '50%',
                                        border: '1.5px solid var(--color-border)',
                                        background: 'transparent', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: 'var(--color-text-muted)', flexShrink: 0,
                                        transition: 'all 120ms ease',
                                    }}
                                    title="Erledigt"
                                >
                                    {checkIcon}
                                </button>
                                <span
                                    onClick={() => navigate('/todo')}
                                    style={{
                                        flex: 1,
                                        fontSize: 'var(--font-size-sm)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        cursor: 'pointer',
                                    }}
                                >
                                    {item.title}
                                </span>
                                {overdue && (
                                    <span style={{ color: 'var(--color-danger)', flexShrink: 0, display: 'flex' }} title="Ueberfaellig">
                                        {alertIcon}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
