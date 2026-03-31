import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface Notification {
    id: number;
    title: string;
    message?: string;
    link?: string;
    type: 'info' | 'success' | 'warning' | 'error';
    is_read: boolean;
    created_at: string;
}

const BellIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
);

const typeColors: Record<string, string> = {
    info: 'var(--color-primary)',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
};

export function NotificationBell() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const { addToast } = useToast();

    const fetchNotifications = useCallback(async () => {
        try {
            const res = await apiFetch('/api/auth/notifications');
            if (res.ok) {
                const data = await res.json();
                setNotifications(data.notifications);
                setUnreadCount(data.unreadCount);
            }
        } catch { /* ignore */ }
    }, []);

    // Initial fetch
    useEffect(() => {
        if (user) fetchNotifications();
    }, [user, fetchNotifications]);

    // SSE connection
    useEffect(() => {
        if (!user) return;

        // Get auth cookie - SSE uses cookie auth
        const connectSSE = () => {
            const es = new EventSource('/api/auth/notifications/stream', { withCredentials: true });
            es.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'notification') {
                        setNotifications((prev) => [data.notification, ...prev].slice(0, 30));
                        setUnreadCount((prev) => prev + 1);

                        // Urgent notifications → Toast popup
                        if (data.toast?.urgent) {
                            addToast({
                                title: data.notification.title,
                                message: data.notification.message,
                                type: data.notification.type || 'info',
                                link: data.notification.link,
                                duration: data.toast.duration ?? 5000,
                            });
                        }
                    }
                } catch { /* ignore */ }
            };
            es.onerror = () => {
                es.close();
                // Reconnect after 5s
                setTimeout(connectSSE, 5000);
            };
            eventSourceRef.current = es;
        };

        connectSSE();

        return () => {
            eventSourceRef.current?.close();
            eventSourceRef.current = null;
        };
    }, [user]);

    // Close dropdown on outside click
    useEffect(() => {
        if (!open) return;
        const handleClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    const handleMarkRead = async (id: number) => {
        await apiFetch(`/api/auth/notifications/${id}/read`, { method: 'PUT' });
        setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
        setUnreadCount((prev) => Math.max(0, prev - 1));
    };

    const handleMarkAllRead = async () => {
        await apiFetch('/api/auth/notifications/read-all', { method: 'PUT' });
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
        setUnreadCount(0);
    };

    const handleClick = (notification: Notification) => {
        if (!notification.is_read) handleMarkRead(notification.id);
        if (notification.link && notification.link.startsWith('/')) {
            navigate(notification.link);
            setOpen(false);
        }
    };

    const formatTime = (dateStr: string) => {
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMin = Math.floor(diffMs / 60_000);
        if (diffMin < 1) return 'Gerade eben';
        if (diffMin < 60) return `Vor ${diffMin} Min`;
        const diffH = Math.floor(diffMin / 60);
        if (diffH < 24) return `Vor ${diffH} Std`;
        const diffD = Math.floor(diffH / 24);
        return `Vor ${diffD} Tag${diffD > 1 ? 'en' : ''}`;
    };

    return (
        <div className="notification-bell-wrapper" ref={dropdownRef}>
            <button
                className="notification-bell-btn"
                onClick={() => setOpen(!open)}
                aria-label="Benachrichtigungen"
                title="Benachrichtigungen"
            >
                {BellIcon}
                {unreadCount > 0 && (
                    <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
            </button>

            {open && (
                <div className="notification-dropdown">
                    <div className="notification-dropdown-header">
                        <span className="notification-dropdown-title">Benachrichtigungen</span>
                        {unreadCount > 0 && (
                            <button className="notification-mark-all" onClick={handleMarkAllRead}>
                                Alle gelesen
                            </button>
                        )}
                    </div>
                    <div className="notification-dropdown-list">
                        {notifications.length === 0 ? (
                            <div className="notification-empty">Keine Benachrichtigungen</div>
                        ) : (
                            notifications.map((n) => (
                                <div
                                    key={n.id}
                                    className={`notification-item ${!n.is_read ? 'unread' : ''}`}
                                    onClick={() => handleClick(n)}
                                >
                                    <div className="notification-item-dot" style={{ backgroundColor: !n.is_read ? typeColors[n.type] : 'transparent' }} />
                                    <div className="notification-item-content">
                                        <div className="notification-item-title">{n.title}</div>
                                        {n.message && <div className="notification-item-message">{n.message}</div>}
                                        <div className="notification-item-time">{formatTime(n.created_at)}</div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <div className="notification-dropdown-footer">
                        <button className="notification-view-all" onClick={() => { setOpen(false); navigate('/notifications'); }}>
                            Alle Benachrichtigungen anzeigen
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
