import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface AdminEntry {
    label: string;
    permission: string;
    description: string;
    path?: string;
    href?: string;
    external?: boolean;
}

const adminEntries: AdminEntry[] = [
    { label: 'Benutzer', path: '/admin/users', permission: 'users.view', description: 'Benutzerkonten verwalten' },
    { label: 'Rollen', path: '/admin/roles', permission: 'roles.view', description: 'Rollen und Rechte verwalten' },
    { label: 'Mandanten', path: '/admin/tenants', permission: 'tenants.manage', description: 'Mandanten anlegen und verwalten' },
    { label: 'Updates & Plugins', path: '/admin/updates', permission: 'updates.manage', description: 'Updates prüfen, Plugins installieren und verwalten' },
    { label: 'Dokumentenverwaltung', path: '/admin/documents', permission: 'documents.manage', description: 'Angebundene Ordner anzeigen und externe Verzeichnisse vorbereiten' },
    { label: 'Backup', path: '/admin/backup', permission: 'backup.export', description: 'Sicherungen exportieren oder importieren' },
    { label: 'Einstellungen', path: '/admin/settings', permission: 'settings.manage', description: 'Systemeinstellungen bearbeiten' },
    { label: 'Audit-Log', path: '/admin/audit', permission: 'audit.view', description: 'Systemaktionen nachverfolgen' },
    { label: 'Webhooks', path: '/admin/webhooks', permission: 'webhooks.manage', description: 'Event-Webhooks erstellen und verwalten' },
    { label: 'Aktive Sitzungen', path: '/admin/sessions', permission: 'users.manage', description: 'Aktive Benutzer-Sessions einsehen und widerrufen' },
    { label: 'Aktive Sperren', path: '/admin/locks', permission: 'locks.manage', description: 'Aktive Entity-Locks einsehen und aufheben' },
    { label: 'phpMyAdmin', href: '/phpmyadmin/', external: true, permission: 'admin.access', description: 'Datenbank in phpMyAdmin öffnen' },
];

export default function AdminHome() {
    const { user } = useAuth();
    const hasPermission = (permission: string) => {
        if (!user) return false;
        if (user.permissions.includes('*')) return true;
        return user.permissions.includes(permission);
    };

    const visibleEntries = adminEntries.filter((entry) => hasPermission(entry.permission));

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Administration</h1>
                <p className="page-subtitle">Bereich für administrative Einstellungen</p>
            </div>

            {visibleEntries.length === 0 ? (
                <div className="card">
                    <p className="text-muted">Keine administrativen Bereiche für diesen Benutzer freigeschaltet.</p>
                </div>
            ) : (
                <div className="admin-home-grid">
                    {visibleEntries.map((entry) => (
                        entry.external ? (
                            <a
                                key={entry.href}
                                href={entry.href}
                                target="_blank"
                                rel="noreferrer"
                                className="card admin-home-tile"
                            >
                                <div className="card-title admin-home-tile-title">{entry.label}</div>
                                <p className="text-muted mt-md admin-home-tile-description">{entry.description}</p>
                            </a>
                        ) : (
                            <Link
                                key={entry.path}
                                to={entry.path || '/admin'}
                                className="card admin-home-tile"
                            >
                                <div className="card-title admin-home-tile-title">{entry.label}</div>
                                <p className="text-muted mt-md admin-home-tile-description">{entry.description}</p>
                            </Link>
                        )
                    ))}
                </div>
            )}
        </div>
    );
}
