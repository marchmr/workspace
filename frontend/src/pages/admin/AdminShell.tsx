import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const svgProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

interface AdminNavEntry {
    label: string;
    permission: string;
    path: string;
    icon: React.ReactNode;
    href?: string;
    external?: boolean;
}

const adminNavEntries: AdminNavEntry[] = [
    {
        label: 'Benutzer', path: '/admin/users', permission: 'users.view',
        icon: <svg {...svgProps}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
    },
    {
        label: 'Rollen', path: '/admin/roles', permission: 'roles.view',
        icon: <svg {...svgProps}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
    },
    {
        label: 'Mandanten', path: '/admin/tenants', permission: 'tenants.manage',
        icon: <svg {...svgProps}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
    },
    {
        label: 'Updates & Plugins', path: '/admin/updates', permission: 'updates.manage',
        icon: <svg {...svgProps}><polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" /><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" /></svg>
    },
    {
        label: 'Dokumente', path: '/admin/documents', permission: 'documents.manage',
        icon: <svg {...svgProps}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
    },
    {
        label: 'Backup', path: '/admin/backup', permission: 'backup.export',
        icon: <svg {...svgProps}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
    },
    {
        label: 'Einstellungen', path: '/admin/settings', permission: 'settings.manage',
        icon: <svg {...svgProps}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
    },
    {
        label: 'E-Mail-Konten', path: '/admin/email', permission: 'settings.manage',
        icon: <svg {...svgProps}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
    },
    {
        label: 'Audit-Log', path: '/admin/audit', permission: 'audit.view',
        icon: <svg {...svgProps}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
    },
    {
        label: 'Webhooks', path: '/admin/webhooks', permission: 'webhooks.manage',
        icon: <svg {...svgProps}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
    },
    {
        label: 'Sitzungen', path: '/admin/sessions', permission: 'users.manage',
        icon: <svg {...svgProps}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
    },
    {
        label: 'Aktive Sperren', path: '/admin/locks', permission: 'locks.manage',
        icon: <svg {...svgProps}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
    },
    {
        label: 'phpMyAdmin', path: '/phpmyadmin/', permission: 'admin.access', external: true,
        icon: <svg {...svgProps}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
    },
];

export default function AdminShell() {
    const { user } = useAuth();
    const location = useLocation();

    const hasPermission = (permission: string) => {
        if (!user) return false;
        if (user.permissions.includes('*')) return true;
        return user.permissions.includes(permission);
    };

    const visibleEntries = adminNavEntries.filter((entry) => hasPermission(entry.permission));

    // Determine if we're on the admin index (no sub-page selected)
    const isAdminIndex = location.pathname === '/admin' || location.pathname === '/admin/';

    return (
        <div className="admin-layout">
            <aside className="admin-sidebar">
                <div className="admin-sidebar-header">
                    <h2 className="admin-sidebar-title">Administration</h2>
                </div>
                <nav className="admin-sidebar-nav">
                    {visibleEntries.map((entry) =>
                        entry.external ? (
                            <a
                                key={entry.path}
                                href={entry.path}
                                target="_blank"
                                rel="noreferrer"
                                className="admin-sidebar-link"
                            >
                                <span className="admin-sidebar-link-icon">{entry.icon}</span>
                                <span className="admin-sidebar-link-label">{entry.label}</span>
                                <svg className="admin-sidebar-external" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                                </svg>
                            </a>
                        ) : (
                            <NavLink
                                key={entry.path}
                                to={entry.path}
                                className={({ isActive }) => `admin-sidebar-link ${isActive ? 'active' : ''}`}
                            >
                                <span className="admin-sidebar-link-icon">{entry.icon}</span>
                                <span className="admin-sidebar-link-label">{entry.label}</span>
                            </NavLink>
                        )
                    )}
                </nav>
            </aside>
            <main className="admin-content">
                {isAdminIndex ? (
                    <div className="admin-welcome">
                        <div className="admin-welcome-icon">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                            </svg>
                        </div>
                        <h2>Administrationsbereich</h2>
                        <p className="text-muted">Wähle links einen Bereich aus, um die Verwaltung zu starten.</p>
                    </div>
                ) : (
                    <Outlet />
                )}
            </main>
        </div>
    );
}
