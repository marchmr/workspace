import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../context/AuthContext';

interface Notification {
    id: number;
    title: string;
    message?: string;
    link?: string;
    type: 'info' | 'success' | 'warning' | 'error';
    is_read: boolean;
    created_at: string;
}

const typeLabels: Record<string, { label: string; color: string }> = {
    info: { label: 'Info', color: 'var(--color-primary)' },
    success: { label: 'Erfolg', color: '#22c55e' },
    warning: { label: 'Warnung', color: '#f59e0b' },
    error: { label: 'Fehler', color: '#ef4444' },
};

export default function NotificationHistory() {
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchNotifications = useCallback(async () => {
        try {
            const res = await apiFetch('/api/auth/notifications');
            if (res.ok) {
                const data = await res.json();
                setNotifications(data.notifications);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

    const handleMarkRead = async (id: number) => {
        await apiFetch(`/api/auth/notifications/${id}/read`, { method: 'PUT' });
        setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
    };

    const handleMarkAllRead = async () => {
        await apiFetch('/api/auth/notifications/read-all', { method: 'PUT' });
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    const unreadCount = notifications.filter((n) => !n.is_read).length;

    return (
        <div className="admin-page">
            <div className="admin-page-header">
                <h2>Benachrichtigungen</h2>
                <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
                    {unreadCount > 0 && (
                        <button className="btn btn-secondary" onClick={handleMarkAllRead}>
                            Alle als gelesen markieren ({unreadCount})
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <p style={{ padding: 'var(--space-lg)', color: 'var(--color-text-muted)' }}>Lade...</p>
            ) : notifications.length === 0 ? (
                <p style={{ padding: 'var(--space-lg)', color: 'var(--color-text-muted)' }}>Keine Benachrichtigungen vorhanden.</p>
            ) : (
                <div className="card" style={{ overflow: 'hidden' }}>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th style={{ width: '30px' }}></th>
                                <th>Titel</th>
                                <th>Nachricht</th>
                                <th>Typ</th>
                                <th>Datum</th>
                                <th style={{ width: '120px' }}>Aktionen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {notifications.map((n) => (
                                <tr key={n.id} style={{ opacity: n.is_read ? 0.6 : 1 }}>
                                    <td>
                                        <div style={{
                                            width: 8, height: 8, borderRadius: '50%',
                                            backgroundColor: n.is_read ? 'transparent' : (typeLabels[n.type]?.color || 'var(--color-primary)'),
                                        }} />
                                    </td>
                                    <td style={{ fontWeight: n.is_read ? 400 : 600 }}>{n.title}</td>
                                    <td style={{ color: 'var(--color-text-muted)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {n.message || '–'}
                                    </td>
                                    <td>
                                        <span style={{
                                            fontSize: 'var(--font-size-xs)',
                                            padding: '2px 8px',
                                            borderRadius: 'var(--radius-sm)',
                                            backgroundColor: `${typeLabels[n.type]?.color || 'var(--color-primary)'}20`,
                                            color: typeLabels[n.type]?.color || 'var(--color-primary)',
                                        }}>
                                            {typeLabels[n.type]?.label || n.type}
                                        </span>
                                    </td>
                                    <td style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                                        {formatDate(n.created_at)}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                                            {n.link && n.link.startsWith('/') && (
                                                <button className="btn btn-sm btn-primary" onClick={() => navigate(n.link!)}>
                                                    Öffnen
                                                </button>
                                            )}
                                            {!n.is_read && (
                                                <button className="btn btn-sm btn-secondary" onClick={() => handleMarkRead(n.id)}>
                                                    ✓
                                                </button>
                                            )}
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
