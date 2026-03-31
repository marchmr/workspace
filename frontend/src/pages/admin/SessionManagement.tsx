import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, useAuth } from '../../context/AuthContext';

interface Session {
    id: number;
    userId: number;
    username: string;
    displayName: string;
    userAgent: string;
    ipAddress: string;
    createdAt: string;
    expiresAt: string;
}

export default function SessionManagement() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    const loadSessions = useCallback(async () => {
        setLoading(true);
        const res = await apiFetch('/api/admin/sessions');
        if (res.ok) setSessions(await res.json());
        setLoading(false);
    }, []);

    useEffect(() => { void loadSessions(); }, [loadSessions]);

    const toggleExpand = (userId: number) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(userId)) next.delete(userId);
            else next.add(userId);
            return next;
        });
    };

    const forceLogoutIfSelf = async (revokedUserId: number) => {
        if (user && user.id === revokedUserId) {
            await logout();
            navigate('/login');
        }
    };

    const revokeSession = async (id: number, sessionUserId: number) => {
        if (!confirm('Sitzung wirklich widerrufen?')) return;
        const res = await apiFetch(`/api/admin/sessions/${id}/revoke`, { method: 'POST' });
        if (res.ok) {
            await forceLogoutIfSelf(sessionUserId);
            void loadSessions();
        }
    };

    const revokeAllForUser = async (e: React.MouseEvent, userId: number, username: string) => {
        e.stopPropagation();
        if (!confirm(`Alle Sitzungen von "${username}" widerrufen?`)) return;
        const res = await apiFetch(`/api/admin/sessions/revoke-all/${userId}`, { method: 'POST' });
        if (res.ok) {
            await forceLogoutIfSelf(userId);
            void loadSessions();
        }
    };

    const parseUA = (ua: string): string => {
        if (!ua || ua === 'Unbekannt') return '–';
        if (ua.includes('Firefox')) return 'Firefox';
        if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
        if (ua.includes('Edg')) return 'Edge';
        if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
        return ua.substring(0, 30);
    };

    const formatDate = (d: string) => new Date(d).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    const grouped = sessions.reduce((acc, s) => {
        if (!acc[s.userId]) acc[s.userId] = { username: s.username, displayName: s.displayName, sessions: [] };
        acc[s.userId].sessions.push(s);
        return acc;
    }, {} as Record<number, { username: string; displayName: string; sessions: Session[] }>);

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Aktive Sitzungen</h1>
                <p className="page-subtitle">
                    {sessions.length} aktive Sitzung{sessions.length !== 1 ? 'en' : ''} · {Object.keys(grouped).length} Benutzer
                </p>
            </div>

            {loading ? (
                <div className="card"><p className="text-muted">Laden...</p></div>
            ) : sessions.length === 0 ? (
                <div className="card"><p className="text-muted">Keine aktiven Sitzungen gefunden.</p></div>
            ) : (
                Object.entries(grouped).map(([userId, group]) => {
                    const uid = Number(userId);
                    const isOpen = expanded.has(uid);
                    const latestSession = group.sessions[0];
                    const latestBrowser = parseUA(latestSession?.userAgent);
                    const latestIp = latestSession?.ipAddress || '–';

                    return (
                        <div key={userId} className="card mb-md" style={{ overflow: 'hidden' }}>
                            {/* Header – klickbar */}
                            <div
                                onClick={() => toggleExpand(uid)}
                                style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    cursor: 'pointer', userSelect: 'none', padding: '0',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                        width: 36, height: 36, borderRadius: 'var(--radius-full)',
                                        background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                                        fontWeight: 600, fontSize: '0.875rem', flexShrink: 0,
                                    }}>
                                        {(group.displayName || group.username).charAt(0).toUpperCase()}
                                    </span>
                                    <div>
                                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                            {group.displayName || group.username}
                                        </div>
                                        <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                                            @{group.username} · {group.sessions.length} Sitzung{group.sessions.length !== 1 ? 'en' : ''}
                                            {latestIp !== '–' && ` · ${latestIp}`}
                                            {latestBrowser !== '–' && ` · ${latestBrowser}`}
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                    {group.sessions.length > 1 && (
                                        <button
                                            className="btn btn-danger btn-sm"
                                            onClick={(e) => revokeAllForUser(e, uid, group.username)}
                                        >
                                            Alle abmelden
                                        </button>
                                    )}
                                    <span style={{
                                        transition: 'transform 0.2s ease',
                                        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                        fontSize: '0.8rem', color: 'var(--color-text-secondary)',
                                    }}>
                                        ▼
                                    </span>
                                </div>
                            </div>

                            {/* Details – ausgeklappt */}
                            {isOpen && (
                                <div style={{
                                    marginTop: 16,
                                    borderTop: '1px solid var(--color-border)',
                                    paddingTop: 16,
                                    display: 'flex', flexDirection: 'column', gap: 10,
                                }}>
                                    {group.sessions.map((s) => (
                                        <div key={s.id} style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            padding: '12px 16px',
                                            borderRadius: 8,
                                            background: 'var(--color-bg-secondary)',
                                            borderLeft: '3px solid var(--color-primary)',
                                        }}>
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'minmax(140px, 1fr) minmax(90px, 1fr) minmax(160px, 1fr) minmax(160px, 1fr)',
                                                gap: 24, fontSize: '0.85rem', alignItems: 'start', flex: 1,
                                            }}>
                                                <div>
                                                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', marginBottom: 4 }}>IP-Adresse</div>
                                                    <code style={{ fontSize: '0.85rem' }}>{s.ipAddress || '–'}</code>
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', marginBottom: 4 }}>Browser</div>
                                                    <span>{parseUA(s.userAgent)}</span>
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', marginBottom: 4 }}>Anmeldung</div>
                                                    <span>{formatDate(s.createdAt)}</span>
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', marginBottom: 4 }}>Gültig bis</div>
                                                    <span>{formatDate(s.expiresAt)}</span>
                                                </div>
                                            </div>
                                            <button
                                                className="btn btn-danger btn-sm"
                                                onClick={() => revokeSession(s.id, s.userId)}
                                                style={{ flexShrink: 0, marginLeft: 24 }}
                                            >
                                                Abmelden
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })
            )}
        </div>
    );
}
