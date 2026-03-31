import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../context/AuthContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { useToast } from '../../context/ToastContext';

/* ════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════ */

const LockSvg = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
);

const UnlockSvg = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 019.9-1" />
    </svg>
);

const RefreshSvg = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
);

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

interface LockEntry {
    entityType: string;
    entityId: string;
    userId: number;
    username: string;
    displayName: string;
    acquiredAt: string;
    lastHeartbeat: string;
    tenantId: number;
}

/* ════════════════════════════════════════════
   Component
   ════════════════════════════════════════════ */

export default function LockManagement() {
    const [locks, setLocks] = useState<LockEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [releasing, setReleasing] = useState<string | null>(null);
    const { on } = useWebSocket();
    const { addToast } = useToast();

    const fetchLocks = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/api/locks/all');
            if (res.ok) {
                const data = await res.json();
                setLocks(data.locks || []);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchLocks();
    }, [fetchLocks]);

    // Live updates via WebSocket
    useEffect(() => {
        const unsub1 = on('lock.acquired', () => fetchLocks());
        const unsub2 = on('lock.released', () => fetchLocks());
        const unsub3 = on('lock.expired', () => fetchLocks());
        return () => { unsub1(); unsub2(); unsub3(); };
    }, [on, fetchLocks]);

    const handleForceRelease = async (lock: LockEntry) => {
        const key = `${lock.entityType}:${lock.entityId}`;
        setReleasing(key);
        try {
            const res = await apiFetch(`/api/locks/${encodeURIComponent(lock.entityType)}/${encodeURIComponent(lock.entityId)}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                addToast({ title: 'Sperre aufgehoben', type: 'success', duration: 3000 });
                fetchLocks();
            }
        } catch { /* ignore */ }
        setReleasing(null);
    };

    const formatTime = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    const getTimeSince = (dateStr: string) => {
        const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
        if (seconds < 60) return `vor ${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `vor ${minutes}m`;
        return `vor ${Math.floor(minutes / 60)}h`;
    };

    return (
        <div>
            <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-lg)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                    <span style={{ color: 'hsl(45, 80%, 45%)' }}>{LockSvg}</span>
                    <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, margin: 0 }}>
                        Aktive Sperren
                    </h1>
                    {locks.length > 0 && (
                        <span className="badge" style={{
                            background: 'hsla(45, 100%, 51%, 0.15)',
                            color: 'hsl(45, 80%, 40%)',
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: 'var(--font-size-xs)',
                            fontWeight: 700,
                        }}>
                            {locks.length}
                        </span>
                    )}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={fetchLocks} disabled={loading}>
                    {RefreshSvg}
                    <span style={{ marginLeft: 4 }}>Aktualisieren</span>
                </button>
            </div>

            {loading ? (
                <div className="text-muted text-center" style={{ padding: 'var(--space-2xl)' }}>Laden...</div>
            ) : locks.length === 0 ? (
                <div className="card" style={{ padding: 'var(--space-2xl)', textAlign: 'center' }}>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-sm)' }}>
                        {UnlockSvg}
                    </div>
                    <p className="text-muted">Keine aktiven Sperren vorhanden.</p>
                </div>
            ) : (
                <div className="card">
                    <div className="table-wrapper">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Entitätstyp</th>
                                    <th>ID</th>
                                    <th>Gesperrt von</th>
                                    <th>Seit</th>
                                    <th>Letzter Heartbeat</th>
                                    <th style={{ width: '120px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {locks.map((lock) => {
                                    const key = `${lock.entityType}:${lock.entityId}`;
                                    return (
                                        <tr key={key} className="lock-row">
                                            <td>
                                                <span style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 6,
                                                    padding: '2px 10px',
                                                    borderRadius: 'var(--radius-full)',
                                                    background: 'var(--color-surface-hover)',
                                                    fontSize: 'var(--font-size-sm)',
                                                    fontWeight: 600,
                                                }}>
                                                    {lock.entityType}
                                                </span>
                                            </td>
                                            <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                                #{lock.entityId}
                                            </td>
                                            <td>
                                                <span style={{ fontWeight: 500 }}>
                                                    {lock.displayName || lock.username}
                                                </span>
                                            </td>
                                            <td>{formatTime(lock.acquiredAt)}</td>
                                            <td>
                                                <span style={{ color: 'var(--color-text-muted)' }}>
                                                    {getTimeSince(lock.lastHeartbeat)}
                                                </span>
                                            </td>
                                            <td>
                                                <button
                                                    className="btn btn-danger btn-sm"
                                                    onClick={() => handleForceRelease(lock)}
                                                    disabled={releasing === key}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                                                >
                                                    {UnlockSvg}
                                                    {releasing === key ? 'Wird aufgehoben...' : 'Aufheben'}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
