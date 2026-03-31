import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, apiFetch } from '../context/AuthContext';
import { usePermission } from '../hooks/usePermission';

const svgProps = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const Icons = {
    settings: <svg {...svgProps}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>,
    help: <svg {...svgProps}><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
    admin: <svg {...svgProps}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
    changelog: <svg {...svgProps}><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="10" /></svg>,
    logout: <svg {...svgProps}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>,
    close: <svg {...svgProps} width={20} height={20}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
};

interface Notification {
    id: number;
    title: string;
    message?: string;
    type: 'info' | 'success' | 'warning' | 'error';
    is_read: boolean;
    created_at: string;
}

const typeColors: Record<string, string> = {
    info: 'var(--color-primary)',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
};

interface ProfileSliderProps {
    open: boolean;
    onClose: () => void;
}

export function ProfileSlider({ open, onClose }: ProfileSliderProps) {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const canAdmin = usePermission('admin.access');
    const sliderRef = useRef<HTMLDivElement>(null);
    const [recentNotifications, setRecentNotifications] = useState<Notification[]>([]);
    const [appVersion, setAppVersion] = useState<string>('');

    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    const displayName = fullName || user?.displayName || user?.username || '';
    const avatarSrc = user?.avatarUrl
        ? `${user.avatarUrl}${user.avatarUpdatedAt ? `${user.avatarUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(user.avatarUpdatedAt)}` : ''}`
        : null;
    const email = user?.email || '';

    // Fetch recent unread notifications + app version
    useEffect(() => {
        if (!open) return;
        (async () => {
            try {
                const res = await apiFetch('/api/auth/notifications?limit=3');
                if (res.ok) {
                    const data = await res.json();
                    setRecentNotifications(
                        (data.notifications || []).filter((n: Notification) => !n.is_read).slice(0, 3)
                    );
                }
            } catch { /* ignore */ }
        })();
        // Version nur einmal laden
        if (!appVersion) {
            (async () => {
                try {
                    const res = await fetch('/api/health');
                    if (res.ok) {
                        const data = await res.json();
                        if (data.version) setAppVersion(data.version);
                    }
                } catch { /* ignore */ }
            })();
        }
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handleKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeydown);
        return () => document.removeEventListener('keydown', handleKeydown);
    }, [open, onClose]);

    const handleNavigation = useCallback((path: string) => {
        navigate(path);
        onClose();
    }, [navigate, onClose]);

    const handleLogout = async () => {
        await logout();
        navigate('/login');
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
        <>
            <div className={`profile-slider-overlay ${open ? 'open' : ''}`} onClick={onClose} />
            <aside className={`profile-slider ${open ? 'open' : ''}`} ref={sliderRef}>
                <div className="profile-slider-header">
                    <button className="profile-slider-close" onClick={onClose} aria-label="Schliessen">
                        {Icons.close}
                    </button>
                    <div className="profile-slider-user">
                        <div className="profile-slider-avatar">
                            {avatarSrc ? (
                                <img src={avatarSrc} alt="Avatar" className="profile-slider-avatar-img" />
                            ) : (
                                <span>{user?.username?.charAt(0).toUpperCase()}</span>
                            )}
                        </div>
                        <div className="profile-slider-user-info">
                            <div className="profile-slider-name">{displayName}</div>
                            <div className="profile-slider-email">{email}</div>
                        </div>
                    </div>
                </div>

                <div className="profile-slider-divider" />

                <nav className="profile-slider-nav">
                    <button className="profile-slider-nav-item" onClick={() => handleNavigation('/profile')}>
                        <span className="profile-slider-nav-icon">{Icons.settings}</span>
                        Einstellungen
                    </button>
                    <button className="profile-slider-nav-item" onClick={() => handleNavigation('/helpcenter')}>
                        <span className="profile-slider-nav-icon">{Icons.help}</span>
                        Helpcenter
                    </button>
                    {canAdmin && (
                        <button className="profile-slider-nav-item" onClick={() => handleNavigation('/admin')}>
                            <span className="profile-slider-nav-icon">{Icons.admin}</span>
                            Administration
                        </button>
                    )}
                    <button className="profile-slider-nav-item" onClick={() => handleNavigation('/changelog')}>
                        <span className="profile-slider-nav-icon">{Icons.changelog}</span>
                        Changelog
                    </button>
                </nav>

                {recentNotifications.length > 0 && (
                    <>
                        <div className="profile-slider-divider" />
                        <div className="profile-slider-section-title">
                            Benachrichtigungen ({recentNotifications.length})
                        </div>
                        <div className="profile-slider-notifications">
                            {recentNotifications.map((n) => (
                                <div key={n.id} className="profile-slider-notification">
                                    <div className="profile-slider-notification-dot" style={{ backgroundColor: typeColors[n.type] }} />
                                    <div className="profile-slider-notification-content">
                                        <div className="profile-slider-notification-title">{n.title}</div>
                                        <div className="profile-slider-notification-time">{formatTime(n.created_at)}</div>
                                    </div>
                                </div>
                            ))}
                            <button
                                className="profile-slider-view-all"
                                onClick={() => handleNavigation('/notifications')}
                            >
                                Alle anzeigen
                            </button>
                        </div>
                    </>
                )}

                <div className="profile-slider-footer">
                    <div className="profile-slider-version">{appVersion ? `v${appVersion}` : ''}</div>
                    <button className="profile-slider-logout" onClick={handleLogout}>
                        <span className="profile-slider-nav-icon">{Icons.logout}</span>
                        Abmelden
                    </button>
                </div>
            </aside>
        </>
    );
}
