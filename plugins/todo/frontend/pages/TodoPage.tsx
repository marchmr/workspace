import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast, useModal } from '@mike/components/ModalProvider';

// SVG Icons
const plusIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);
const checkIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
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
const clockIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
);

interface TodoItem {
    id: number;
    title: string;
    description: string;
    priority: 'niedrig' | 'mittel' | 'hoch' | 'dringend';
    status: 'offen' | 'in_bearbeitung' | 'erledigt';
    due_date: string | null;
    completed_at: string | null;
    created_at: string;
    total_seconds: number;
    timer_started_at: string | null;
}

interface TodoStats {
    total: number;
    offen: number;
    in_bearbeitung: number;
    erledigt: number;
    ueberfaellig: number;
}

const priorityColors: Record<string, string> = {
    niedrig: 'var(--color-text-muted)',
    mittel: 'var(--color-primary)',
    hoch: '#e67e22',
    dringend: 'var(--color-danger)',
};

const priorityLabels: Record<string, string> = {
    niedrig: 'Niedrig',
    mittel: 'Mittel',
    hoch: 'Hoch',
    dringend: 'Dringend',
};

const statusLabels: Record<string, string> = {
    offen: 'Offen',
    in_bearbeitung: 'In Bearbeitung',
    erledigt: 'Erledigt',
};

function formatDate(dateStr: string | null): string {
    if (!dateStr) return '';
    try {
        return new Date(dateStr).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return dateStr; }
}

function isOverdue(dueDate: string | null, status: string): boolean {
    if (!dueDate || status === 'erledigt') return false;
    return new Date(dueDate) < new Date(new Date().toDateString());
}

function formatTime(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function getElapsedSeconds(item: TodoItem): number {
    let seconds = item.total_seconds || 0;
    if (item.timer_started_at) {
        seconds += Math.floor((Date.now() - new Date(item.timer_started_at).getTime()) / 1000);
    }
    return seconds;
}

export default function TodoPage() {
    const toast = useToast();
    const modal = useModal();

    const [items, setItems] = useState<TodoItem[]>([]);
    const [stats, setStats] = useState<TodoStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<string>('active');

    // Neues Todo Form
    const [showForm, setShowForm] = useState(false);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<string>('mittel');
    const [dueDate, setDueDate] = useState('');

    // Timer-Tick: Jede Sekunde neu rendern wenn ein Timer laeuft
    const [, setTick] = useState(0);
    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => {
        const hasRunning = items.some((i) => i.timer_started_at);
        if (hasRunning && !tickRef.current) {
            tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
        } else if (!hasRunning && tickRef.current) {
            clearInterval(tickRef.current);
            tickRef.current = null;
        }
        return () => { if (tickRef.current) clearInterval(tickRef.current); };
    }, [items]);

    // Edit
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editPriority, setEditPriority] = useState<string>('mittel');
    const [editDueDate, setEditDueDate] = useState('');

    const loadItems = useCallback(async () => {
        try {
            const statusParam = filter === 'active' ? '' : filter === 'erledigt' ? '?status=erledigt' : '';
            const res = await apiFetch(`/api/plugins/todo/${statusParam}`);
            if (res.ok) {
                const data = await res.json();
                let filtered = data.items || [];
                if (filter === 'active') {
                    filtered = filtered.filter((i: TodoItem) => i.status !== 'erledigt');
                }
                setItems(filtered);
            }
        } catch { /* */ }
    }, [filter]);

    const loadStats = useCallback(async () => {
        try {
            const res = await apiFetch('/api/plugins/todo/stats');
            if (res.ok) {
                const data = await res.json();
                setStats(data.stats);
            }
        } catch { /* */ }
    }, []);

    useEffect(() => {
        setLoading(true);
        Promise.all([loadItems(), loadStats()]).finally(() => setLoading(false));
    }, [loadItems, loadStats]);

    const createTodo = async () => {
        if (!title.trim()) { toast.error('Titel ist erforderlich'); return; }
        const res = await apiFetch('/api/plugins/todo/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, description, priority, due_date: dueDate || null }),
        });
        if (res.ok) {
            toast.success('Aufgabe erstellt');
            setTitle(''); setDescription(''); setPriority('mittel'); setDueDate('');
            setShowForm(false);
            await Promise.all([loadItems(), loadStats()]);
        } else {
            const data = await res.json().catch(() => ({}));
            toast.error(data.error || 'Fehler beim Erstellen');
        }
    };

    const setStatus = async (item: TodoItem, nextStatus: string) => {
        const res = await apiFetch(`/api/plugins/todo/${item.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus }),
        });
        if (res.ok) {
            if (nextStatus === 'erledigt') toast.success('Aufgabe erledigt');
            if (nextStatus === 'in_bearbeitung') toast.success('Timer gestartet');
            await Promise.all([loadItems(), loadStats()]);
        }
    };

    const deleteTodo = async (item: TodoItem) => {
        const ok = await modal.confirm({
            title: 'Aufgabe loeschen',
            message: `"${item.title}" wirklich loeschen?`,
            confirmText: 'Loeschen',
            variant: 'danger',
        });
        if (!ok) return;
        const res = await apiFetch(`/api/plugins/todo/${item.id}`, { method: 'DELETE' });
        if (res.ok) {
            toast.success('Aufgabe geloescht');
            await Promise.all([loadItems(), loadStats()]);
        }
    };

    const startEdit = (item: TodoItem) => {
        setEditingId(item.id);
        setEditTitle(item.title);
        setEditDescription(item.description);
        setEditPriority(item.priority);
        setEditDueDate(item.due_date || '');
    };

    const saveEdit = async () => {
        if (!editingId) return;
        const res = await apiFetch(`/api/plugins/todo/${editingId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: editTitle,
                description: editDescription,
                priority: editPriority,
                due_date: editDueDate || null,
            }),
        });
        if (res.ok) {
            toast.success('Aufgabe aktualisiert');
            setEditingId(null);
            await Promise.all([loadItems(), loadStats()]);
        }
    };

    if (loading) return <div className="text-muted" style={{ padding: 'var(--space-xl)' }}>Laden...</div>;

    return (
        <div>
            <div className="flex-between">
                <div className="page-header">
                    <h1 className="page-title">Aufgaben</h1>
                    <p className="page-subtitle">Persoenliche Aufgabenliste</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowForm(!showForm)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {plusIcon} Neue Aufgabe
                </button>
            </div>

            {/* Statistiken */}
            {stats && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
                    {[
                        { label: 'Gesamt', value: stats.total, color: 'var(--color-text)' },
                        { label: 'Offen', value: stats.offen, color: 'var(--color-primary)' },
                        { label: 'In Arbeit', value: stats.in_bearbeitung, color: '#e67e22' },
                        { label: 'Erledigt', value: stats.erledigt, color: 'var(--color-success)' },
                        { label: 'Ueberfaellig', value: stats.ueberfaellig, color: 'var(--color-danger)' },
                    ].map((stat) => (
                        <div key={stat.label} className="card" style={{ textAlign: 'center', padding: 'var(--space-md)' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: stat.color }}>{stat.value}</div>
                            <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 2 }}>{stat.label}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Neues Todo Form */}
            {showForm && (
                <div className="card mb-md" style={{ borderColor: 'var(--color-primary)' }}>
                    <div className="card-title mb-md">Neue Aufgabe</div>
                    <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                        <input className="input" placeholder="Titel *" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
                        <textarea className="textarea" placeholder="Beschreibung (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                                <option value="niedrig">Niedrig</option>
                                <option value="mittel">Mittel</option>
                                <option value="hoch">Hoch</option>
                                <option value="dringend">Dringend</option>
                            </select>
                            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>Abbrechen</button>
                            <button className="btn btn-primary btn-sm" onClick={createTodo}>Erstellen</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Filter */}
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                {[
                    { key: 'active', label: 'Aktiv' },
                    { key: 'erledigt', label: 'Erledigt' },
                    { key: 'alle', label: 'Alle' },
                ].map((f) => (
                    <button
                        key={f.key}
                        className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setFilter(f.key)}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Aufgaben-Liste */}
            {items.length === 0 ? (
                <div className="card">
                    <p className="text-muted" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                        {filter === 'erledigt' ? 'Keine erledigten Aufgaben.' : 'Keine offenen Aufgaben. Erstelle deine erste Aufgabe!'}
                    </p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    {items.map((item) => {
                        const overdue = isOverdue(item.due_date, item.status);
                        const isDone = item.status === 'erledigt';
                        const isEditing = editingId === item.id;

                        if (isEditing) {
                            return (
                                <div key={item.id} className="card" style={{ borderColor: 'var(--color-primary)' }}>
                                    <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                                        <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} autoFocus />
                                        <textarea className="textarea" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={2} />
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                                            <select className="input" value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                                                <option value="niedrig">Niedrig</option>
                                                <option value="mittel">Mittel</option>
                                                <option value="hoch">Hoch</option>
                                                <option value="dringend">Dringend</option>
                                            </select>
                                            <input className="input" type="date" value={editDueDate} onChange={(e) => setEditDueDate(e.target.value)} />
                                        </div>
                                        <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                                            <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>Abbrechen</button>
                                            <button className="btn btn-primary btn-sm" onClick={saveEdit}>Speichern</button>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={item.id}
                                className="card"
                                style={{
                                    padding: 'var(--space-sm) var(--space-md)',
                                    opacity: isDone ? 0.6 : 1,
                                    borderLeft: `3px solid ${priorityColors[item.priority]}`,
                                    transition: 'all 150ms ease',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                                    {/* Status-Checkbox */}
                                    <button
                                        onClick={() => isDone ? setStatus(item, 'offen') : setStatus(item, 'erledigt')}
                                        style={{
                                            width: 28, height: 28, borderRadius: '50%',
                                            border: isDone ? '2px solid var(--color-success)' : '2px solid var(--color-border)',
                                            background: isDone ? 'var(--color-success)' : 'transparent',
                                            color: isDone ? '#fff' : 'transparent',
                                            cursor: 'pointer', flexShrink: 0,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            transition: 'all 150ms ease',
                                        }}
                                        title={isDone ? 'Wieder oeffnen' : 'Als erledigt markieren'}
                                    >
                                        {checkIcon}
                                    </button>

                                    {/* Inhalt */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            fontWeight: 600,
                                            textDecoration: isDone ? 'line-through' : 'none',
                                            color: isDone ? 'var(--color-text-muted)' : 'var(--color-text)',
                                        }}>
                                            {item.title}
                                        </div>
                                        {item.description && (
                                            <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 2 }}>
                                                {item.description}
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginTop: 4, flexWrap: 'wrap' }}>
                                            <span style={{
                                                fontSize: 'var(--font-size-xs)',
                                                padding: '1px 6px',
                                                borderRadius: 'var(--radius-sm)',
                                                background: `${priorityColors[item.priority]}20`,
                                                color: priorityColors[item.priority],
                                                fontWeight: 500,
                                            }}>
                                                {priorityLabels[item.priority]}
                                            </span>
                                            {!isDone && (
                                                <span className={`badge ${item.status === 'in_bearbeitung' ? 'badge-warning' : 'badge-info'}`} style={{ fontSize: 'var(--font-size-xs)' }}>
                                                    {statusLabels[item.status]}
                                                </span>
                                            )}
                                            {item.due_date && (
                                                <span style={{
                                                    fontSize: 'var(--font-size-xs)',
                                                    color: overdue ? 'var(--color-danger)' : 'var(--color-text-muted)',
                                                    fontWeight: overdue ? 600 : 400,
                                                    display: 'flex', alignItems: 'center', gap: 3,
                                                }}>
                                                    {clockIcon} {formatDate(item.due_date)}
                                                    {overdue && ' (ueberfaellig)'}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Aktionen */}
                                    <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                                        {/* Zeitanzeige */}
                                        {(item.total_seconds > 0 || item.timer_started_at) && (
                                            <span style={{
                                                fontSize: 'var(--font-size-xs)',
                                                fontFamily: 'monospace',
                                                color: item.timer_started_at ? 'var(--color-primary)' : 'var(--color-text-muted)',
                                                fontWeight: item.timer_started_at ? 600 : 400,
                                                marginRight: 4,
                                            }}>
                                                {formatTime(getElapsedSeconds(item))}
                                            </span>
                                        )}
                                        {!isDone && item.status === 'offen' && (
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={() => setStatus(item, 'in_bearbeitung')}
                                                style={{ padding: '4px 10px', fontSize: 'var(--font-size-xs)' }}
                                            >
                                                Starten
                                            </button>
                                        )}
                                        {!isDone && item.status === 'in_bearbeitung' && (
                                            <button
                                                className="btn btn-sm"
                                                onClick={() => setStatus(item, 'erledigt')}
                                                style={{
                                                    padding: '4px 10px',
                                                    fontSize: 'var(--font-size-xs)',
                                                    background: 'var(--color-success)',
                                                    color: '#fff',
                                                    border: 'none',
                                                }}
                                            >
                                                Abschliessen
                                            </button>
                                        )}
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => startEdit(item)}
                                            style={{ padding: '4px 6px' }}
                                            title="Bearbeiten"
                                        >
                                            {editIcon}
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => deleteTodo(item)}
                                            style={{ padding: '4px 6px', color: 'var(--color-danger)' }}
                                            title="Loeschen"
                                        >
                                            {trashIcon}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
