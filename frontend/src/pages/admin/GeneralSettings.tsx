import { useState, useEffect, Suspense, useMemo, FormEvent } from 'react';
import { apiFetch, useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ModalProvider';
import { pluginRegistry } from '../../pluginRegistry';

interface Setting {
    id: number;
    key: string;
    value_encrypted: string | null;
    category: string;
    plugin_id: string | null;
}

interface AccountingConnectorSettings {
    enabled: boolean;
    apiKeyHeaderName: string;
    apiKey: string;
    hmacSecret: string;
    timestampToleranceSec: number;
    nonceTtlSec: number;
    maxPayloadBytes: number;
    publicBaseUrl: string;
    allowedEventTypes: string[];
    endpointPath: string;
    endpointUrl: string;
    hasApiKey: boolean;
    hasHmacSecret: boolean;
}

const DEFAULT_CONNECTOR_SETTINGS: AccountingConnectorSettings = {
    enabled: true,
    apiKeyHeaderName: 'X-API-Key',
    apiKey: '',
    hmacSecret: '',
    timestampToleranceSec: 300,
    nonceTtlSec: 300,
    maxPayloadBytes: 1048576,
    publicBaseUrl: '',
    allowedEventTypes: [],
    endpointPath: '/api/accounting/events',
    endpointUrl: '/api/accounting/events',
    hasApiKey: false,
    hasHmacSecret: false,
};

export default function GeneralSettings() {
    const { user } = useAuth();
    const toast = useToast();
    const [settings, setSettings] = useState<Setting[]>([]);
    const [connector, setConnector] = useState<AccountingConnectorSettings>(DEFAULT_CONNECTOR_SETTINGS);
    const [connectorEventTypesInput, setConnectorEventTypesInput] = useState('');
    const [savingConnector, setSavingConnector] = useState(false);
    const [testingConnector, setTestingConnector] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        const [settingsRes, connectorRes] = await Promise.all([
            apiFetch('/api/admin/settings'),
            apiFetch('/api/admin/settings/accounting-connector'),
        ]);

        if (settingsRes.ok) {
            setSettings(await settingsRes.json());
        }

        if (connectorRes.ok) {
            const payload = await connectorRes.json() as AccountingConnectorSettings;
            setConnector(payload);
            setConnectorEventTypesInput((payload.allowedEventTypes || []).join(', '));
        }

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

    const saveAccountingConnector = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSavingConnector(true);
        try {
            const allowedEventTypes = connectorEventTypesInput
                .split(',')
                .map((entry) => entry.trim().toLowerCase())
                .filter(Boolean);

            const res = await apiFetch('/api/admin/settings/accounting-connector', {
                method: 'PUT',
                body: JSON.stringify({
                    enabled: connector.enabled,
                    apiKeyHeaderName: connector.apiKeyHeaderName,
                    apiKey: connector.apiKey,
                    hmacSecret: connector.hmacSecret,
                    timestampToleranceSec: connector.timestampToleranceSec,
                    nonceTtlSec: connector.nonceTtlSec,
                    maxPayloadBytes: connector.maxPayloadBytes,
                    publicBaseUrl: connector.publicBaseUrl,
                    allowedEventTypes,
                }),
            });

            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Speichern fehlgeschlagen');

            await loadSettings();
            toast.success('Accounting Connector gespeichert');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
        } finally {
            setSavingConnector(false);
        }
    };

    const testAccountingConnector = async () => {
        setTestingConnector(true);
        try {
            const res = await apiFetch('/api/admin/settings/accounting-connector/test', { method: 'POST' });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok || payload?.ok === false) {
                throw new Error(payload?.error || `Test fehlgeschlagen (HTTP ${res.status})`);
            }
            toast.success(`Connector-Test erfolgreich (${payload?.response?.status || 'processed'})`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Connector-Test fehlgeschlagen');
        } finally {
            setTestingConnector(false);
        }
    };

    const copyEndpoint = async () => {
        try {
            await navigator.clipboard.writeText(connector.endpointUrl || connector.endpointPath);
            toast.success('Connector URL kopiert');
        } catch {
            toast.error('Kopieren nicht möglich');
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Einstellungen</h1>
                <p className="page-subtitle">Systemeinstellungen und Plugin-Konfiguration</p>
            </div>

            <div className="card">
                <div className="card-title">Accounting API Connector (Core)</div>
                <p className="text-muted mt-sm">
                    Einrichtung für eingehende Events ({' '}
                    <code>Rechnungen, Angebote, Mahnungen, Gutschriften, Stornos</code> ).
                    Signaturprüfung, Replay-Schutz und Idempotenz übernimmt der Core automatisch.
                </p>

                <form onSubmit={saveAccountingConnector} style={{ marginTop: 'var(--space-md)' }}>
                    <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                            <input
                                type="checkbox"
                                checked={connector.enabled}
                                onChange={(e) => setConnector((prev) => ({ ...prev, enabled: e.target.checked }))}
                            />
                            Connector aktiv
                        </label>

                        <label className="label">Connector URL (für dein Buchhaltungsprogramm)</label>
                        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                            <input className="input" value={connector.endpointUrl} readOnly />
                            <button type="button" className="btn btn-secondary" onClick={copyEndpoint}>Kopieren</button>
                        </div>

                        <label className="label">Öffentliche Base URL (optional, muss https:// sein)</label>
                        <input
                            className="input"
                            value={connector.publicBaseUrl}
                            onChange={(e) => setConnector((prev) => ({ ...prev, publicBaseUrl: e.target.value }))}
                            placeholder="https://kundenportal.example.de"
                        />

                        <label className="label">API-Key Header Name</label>
                        <input
                            className="input"
                            value={connector.apiKeyHeaderName}
                            onChange={(e) => setConnector((prev) => ({ ...prev, apiKeyHeaderName: e.target.value }))}
                            placeholder="X-API-Key"
                        />

                        <label className="label">API-Key</label>
                        <input
                            className="input"
                            value={connector.apiKey}
                            onChange={(e) => setConnector((prev) => ({ ...prev, apiKey: e.target.value }))}
                            placeholder="Gemeinsamer API-Key"
                        />

                        <label className="label">Signatur-Secret (HMAC)</label>
                        <input
                            className="input"
                            value={connector.hmacSecret}
                            onChange={(e) => setConnector((prev) => ({ ...prev, hmacSecret: e.target.value }))}
                            placeholder="Gemeinsames HMAC-Secret"
                        />

                        <label className="label">Eventtypen erlauben (optional, kommasepariert)</label>
                        <input
                            className="input"
                            value={connectorEventTypesInput}
                            onChange={(e) => setConnectorEventTypesInput(e.target.value)}
                            placeholder="rechnung.created, angebot.created, mahnung.created"
                        />

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-sm)' }}>
                            <div>
                                <label className="label">Timestamp-Fenster (Sek.)</label>
                                <input
                                    className="input"
                                    type="number"
                                    min={30}
                                    max={3600}
                                    value={connector.timestampToleranceSec}
                                    onChange={(e) => setConnector((prev) => ({ ...prev, timestampToleranceSec: Number(e.target.value || 300) }))}
                                />
                            </div>
                            <div>
                                <label className="label">Nonce TTL (Sek.)</label>
                                <input
                                    className="input"
                                    type="number"
                                    min={30}
                                    max={3600}
                                    value={connector.nonceTtlSec}
                                    onChange={(e) => setConnector((prev) => ({ ...prev, nonceTtlSec: Number(e.target.value || 300) }))}
                                />
                            </div>
                            <div>
                                <label className="label">Max Payload (Bytes)</label>
                                <input
                                    className="input"
                                    type="number"
                                    min={1024}
                                    max={10485760}
                                    value={connector.maxPayloadBytes}
                                    onChange={(e) => setConnector((prev) => ({ ...prev, maxPayloadBytes: Number(e.target.value || 1048576) }))}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <button type="submit" className="btn btn-primary" disabled={savingConnector}>
                                {savingConnector ? 'Speichert...' : 'Connector speichern'}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={testAccountingConnector} disabled={testingConnector}>
                                {testingConnector ? 'Teste...' : 'Verbindung testen'}
                            </button>
                        </div>
                    </div>
                </form>
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
