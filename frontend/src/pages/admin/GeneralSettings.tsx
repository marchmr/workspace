import { useState, useEffect, Suspense, useMemo } from 'react';
import { apiFetch, useAuth } from '../../context/AuthContext';
import { pluginRegistry } from '../../pluginRegistry';

interface Setting {
    id: number;
    key: string;
    value_encrypted: string | null;
    category: string;
    plugin_id: string | null;
}

export default function GeneralSettings() {
    const { user } = useAuth();
    const [settings, setSettings] = useState<Setting[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        const res = await apiFetch('/api/admin/settings');
        if (res.ok) setSettings(await res.json());
        setLoading(false);
    };

    const hasPermission = (permission?: string): boolean => {
        if (!permission) return true;
        if (!user) return false;
        return user.permissions.includes('*') || user.permissions.includes(permission);
    };

    const pluginsWithSettings = useMemo(
        () => pluginRegistry.filter(
            (entry) => entry.settingsPanel && hasPermission(entry.settingsPanel.permission)
        ),
        [user]
    );

    if (loading) return <div className="text-muted">Laden...</div>;

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Einstellungen</h1>
                <p className="page-subtitle">Systemeinstellungen und Plugin-Konfiguration</p>
            </div>

            {settings.filter((s) => !s.key.startsWith('update.') && !s.key.startsWith('system.')).length > 0 && (
                <div className="card">
                    <div className="card-title">Systemeinstellungen</div>
                    <div className="table-container mt-md">
                        <table>
                            <thead>
                                <tr>
                                    <th>Schlüssel</th>
                                    <th>Kategorie</th>
                                    <th>Plugin</th>
                                    <th>Wert</th>
                                </tr>
                            </thead>
                            <tbody>
                                {settings
                                    .filter((s) => !s.key.startsWith('update.') && !s.key.startsWith('system.'))
                                    .map((setting) => (
                                    <tr key={setting.id}>
                                        <td><code>{setting.key}</code></td>
                                        <td><span className="badge badge-info">{setting.category}</span></td>
                                        <td className="text-muted">{setting.plugin_id || 'Core'}</td>
                                        <td className="text-muted">***verschlüsselt***</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {pluginsWithSettings.map((entry) => {
                const SettingsComponent = entry.settingsPanel!.component;
                return (
                    <div key={`settings-${entry.id}`} className="card" style={{ marginTop: 'var(--space-lg)' }}>
                        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                            <span className="badge badge-info">Plugin</span>
                            {entry.name}
                        </div>
                        <div style={{ marginTop: 'var(--space-md)' }}>
                            <Suspense fallback={<div className="text-muted">Plugin-Einstellungen werden geladen...</div>}>
                                <SettingsComponent />
                            </Suspense>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
