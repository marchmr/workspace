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

interface ConnectorEventLogItem {
    id: number;
    eventId: string;
    eventType: string;
    status: string;
    duplicateCount: number;
    sourceIp: string | null;
    createdAt: string | null;
    processedAt: string | null;
    lastSeenAt: string | null;
    documentNumber: string | null;
    customerName: string | null;
}

interface ConnectorEventLogResponse {
    items: ConnectorEventLogItem[];
    summary: {
        total: number;
        totalDuplicates: number;
        processed24h: number;
    };
}

interface ExternalConnectionCheckResult {
    ok: boolean;
    reason: string;
    lookbackHours: number;
    checkedAt: string;
    message?: string;
    lastExternalEvent?: {
        eventId: string;
        eventType: string;
        createdAt: string | null;
        sourceIp: string | null;
    } | null;
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
    const [checkingExternalConnection, setCheckingExternalConnection] = useState(false);
    const [loadingConnectorEvents, setLoadingConnectorEvents] = useState(false);
    const [connectorEvents, setConnectorEvents] = useState<ConnectorEventLogItem[]>([]);
    const [connectorEventSummary, setConnectorEventSummary] = useState<ConnectorEventLogResponse['summary']>({
        total: 0,
        totalDuplicates: 0,
        processed24h: 0,
    });
    const [lastConnectorTestResult, setLastConnectorTestResult] = useState<{
        ok: boolean;
        statusCode: number;
        eventId: string;
        status: string;
    } | null>(null);
    const [lastExternalConnectionCheck, setLastExternalConnectionCheck] = useState<ExternalConnectionCheckResult | null>(null);
    const [loading, setLoading] = useState(true);

    const generateRandomSecret = (length: number): string => {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_';
        const bytes = new Uint8Array(length);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
    };

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const [settingsResult, connectorResult] = await Promise.allSettled([
                apiFetch('/api/admin/settings'),
                apiFetch('/api/admin/settings/accounting-connector'),
            ]);

            if (settingsResult.status === 'fulfilled' && settingsResult.value.ok) {
                setSettings(await settingsResult.value.json());
            }

            if (connectorResult.status === 'fulfilled' && connectorResult.value.ok) {
                const payload = await connectorResult.value.json() as AccountingConnectorSettings;
                setConnector(payload);
                setConnectorEventTypesInput((payload.allowedEventTypes || []).join(', '));
            }

            await loadConnectorEvents();
            await checkExternalConnection(true);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Einstellungen konnten nicht vollständig geladen werden');
        } finally {
            setLoading(false);
        }
    };

    const loadConnectorEvents = async () => {
        setLoadingConnectorEvents(true);
        try {
            const res = await apiFetch('/api/admin/settings/accounting-connector/events?limit=25');
            if (!res.ok) return;
            const payload = await res.json() as ConnectorEventLogResponse;
            setConnectorEvents(Array.isArray(payload.items) ? payload.items : []);
            if (payload.summary) {
                setConnectorEventSummary({
                    total: Number(payload.summary.total || 0),
                    totalDuplicates: Number(payload.summary.totalDuplicates || 0),
                    processed24h: Number(payload.summary.processed24h || 0),
                });
            }
        } finally {
            setLoadingConnectorEvents(false);
        }
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
            setLastConnectorTestResult({
                ok: true,
                statusCode: Number(payload?.statusCode || res.status),
                eventId: String(payload?.eventId || ''),
                status: String(payload?.response?.status || 'processed'),
            });
            await loadConnectorEvents();
            toast.success(`Selbsttest erfolgreich (${payload?.response?.status || 'processed'})`);
        } catch (err) {
            setLastConnectorTestResult({
                ok: false,
                statusCode: 500,
                eventId: '',
                status: 'failed',
            });
            toast.error(err instanceof Error ? err.message : 'Selbsttest fehlgeschlagen');
        } finally {
            setTestingConnector(false);
        }
    };

    const checkExternalConnection = async (silent = false) => {
        setCheckingExternalConnection(true);
        try {
            const res = await apiFetch('/api/admin/settings/accounting-connector/external-check', { method: 'POST' });
            const payload = await res.json().catch(() => ({})) as ExternalConnectionCheckResult;
            if (!res.ok) {
                throw new Error((payload as any)?.error || `Prüfung fehlgeschlagen (HTTP ${res.status})`);
            }
            setLastExternalConnectionCheck(payload);
            if (!silent) {
                if (payload.ok) {
                    toast.success('Externe Verbindung bestätigt');
                } else {
                    toast.error(payload.message || 'Externe Verbindung noch nicht bestätigt');
                }
            }
        } catch (err) {
            if (!silent) {
                toast.error(err instanceof Error ? err.message : 'Externe Verbindungsprüfung fehlgeschlagen');
            }
        } finally {
            setCheckingExternalConnection(false);
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

    const generateApiKey = () => {
        setConnector((prev) => ({ ...prev, apiKey: generateRandomSecret(32) }));
        toast.success('API-Key generiert');
    };

    const generateHmacSecret = () => {
        setConnector((prev) => ({ ...prev, hmacSecret: generateRandomSecret(64) }));
        toast.success('HMAC-Secret generiert');
    };

    const generateBothSecrets = () => {
        setConnector((prev) => ({
            ...prev,
            apiKey: generateRandomSecret(32),
            hmacSecret: generateRandomSecret(64),
        }));
        toast.success('API-Key und HMAC-Secret generiert');
    };

    const connectorChecks = [
        { label: 'Connector aktiv', ok: connector.enabled },
        { label: 'API-Key gesetzt', ok: connector.apiKey.trim().length > 0 },
        { label: 'HMAC Secret gesetzt', ok: connector.hmacSecret.trim().length > 0 },
        { label: 'API-Key Header Name gültig', ok: /^[A-Za-z0-9-]{1,100}$/.test(connector.apiKeyHeaderName.trim()) },
        { label: 'HTTPS Connector URL', ok: connector.endpointUrl.startsWith('https://') || connector.endpointUrl.startsWith('/api/') },
    ];
    const connectorReady = connectorChecks.every((item) => item.ok);

    const formatDateTime = (value: string | null): string => {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString('de-DE');
    };

    if (loading) return <div className="text-muted">Laden...</div>;

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
                <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <span className={`badge ${connectorReady ? 'badge-success' : 'badge-warning'}`}>
                        {connectorReady ? 'Konfiguration vollständig' : 'Konfiguration unvollständig'}
                    </span>
                    {lastConnectorTestResult && (
                        <span className={`badge ${lastConnectorTestResult.ok ? 'badge-success' : 'badge-danger'}`}>
                            Letzter Selbsttest: {lastConnectorTestResult.ok ? 'OK' : 'Fehlgeschlagen'}
                        </span>
                    )}
                </div>
                <div style={{ display: 'grid', gap: 'var(--space-xs)', marginTop: 'var(--space-sm)' }}>
                    {connectorChecks.map((check) => (
                        <div key={check.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                            <span className={`badge ${check.ok ? 'badge-success' : 'badge-warning'}`}>{check.ok ? 'OK' : 'Fehlt'}</span>
                            <span>{check.label}</span>
                        </div>
                    ))}
                </div>

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

                        <label className="label">Öffentliche Base URL dieser Core-Instanz (optional, muss https:// sein)</label>
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
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <input
                                className="input"
                                value={connector.apiKey}
                                onChange={(e) => setConnector((prev) => ({ ...prev, apiKey: e.target.value }))}
                                placeholder="Gemeinsamer API-Key"
                                style={{ flex: '1 1 320px' }}
                            />
                            <button type="button" className="btn btn-secondary" onClick={generateApiKey}>
                                API-Key generieren
                            </button>
                        </div>

                        <label className="label">Signatur-Secret (HMAC)</label>
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <input
                                className="input"
                                value={connector.hmacSecret}
                                onChange={(e) => setConnector((prev) => ({ ...prev, hmacSecret: e.target.value }))}
                                placeholder="Gemeinsames HMAC-Secret"
                                style={{ flex: '1 1 320px' }}
                            />
                            <button type="button" className="btn btn-secondary" onClick={generateHmacSecret}>
                                HMAC-Secret generieren
                            </button>
                        </div>
                        <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                            Wenn du willst, kannst du beide Felder automatisch neu erzeugen.
                        </div>

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
                                {testingConnector ? 'Teste...' : 'Selbsttest ausführen'}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={loadConnectorEvents} disabled={loadingConnectorEvents}>
                                {loadingConnectorEvents ? 'Lädt...' : 'Events aktualisieren'}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={() => checkExternalConnection()} disabled={checkingExternalConnection}>
                                {checkingExternalConnection ? 'Prüfe...' : 'Externe Verbindung prüfen'}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={generateBothSecrets}>
                                API-Key + HMAC neu generieren
                            </button>
                        </div>
                        <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                            Hinweis: Der Selbsttest prüft nur deinen Core-Endpunkt lokal. Die echte Verbindung zum Buchhaltungsprogramm ist erst aktiv, wenn dort URL + Keys eingetragen sind.
                        </div>
                        {lastExternalConnectionCheck && (
                            <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                                Externe Prüfung: {lastExternalConnectionCheck.ok ? 'Verbunden' : 'Nicht bestätigt'} ({lastExternalConnectionCheck.message || lastExternalConnectionCheck.reason})
                                {lastExternalConnectionCheck.lastExternalEvent?.createdAt
                                    ? ` · Letztes externes Event: ${formatDateTime(lastExternalConnectionCheck.lastExternalEvent.createdAt)}`
                                    : ''}
                            </div>
                        )}
                    </div>
                </form>
            </div>

            <div className="card" style={{ marginTop: 'var(--space-lg)' }}>
                <div className="card-title">Connector Event-Übersicht</div>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <span className="badge badge-info">Gesamt: {connectorEventSummary.total}</span>
                    <span className="badge badge-warning">Duplikate: {connectorEventSummary.totalDuplicates}</span>
                    <span className="badge badge-success">Letzte 24h: {connectorEventSummary.processed24h}</span>
                </div>
                <div className="table-container mt-md">
                    <table>
                        <thead>
                            <tr>
                                <th>Zeit</th>
                                <th>Event</th>
                                <th>Typ</th>
                                <th>Dokument/Kunde</th>
                                <th>Status</th>
                                <th>Quelle</th>
                            </tr>
                        </thead>
                        <tbody>
                            {connectorEvents.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="text-muted">
                                        {loadingConnectorEvents ? 'Events werden geladen...' : 'Noch keine Connector-Events vorhanden.'}
                                    </td>
                                </tr>
                            )}
                            {connectorEvents.map((item) => (
                                <tr key={item.id}>
                                    <td>{formatDateTime(item.createdAt)}</td>
                                    <td><code>{item.eventId}</code></td>
                                    <td><code>{item.eventType}</code></td>
                                    <td>
                                        <div>{item.documentNumber || '-'}</div>
                                        <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{item.customerName || '-'}</div>
                                    </td>
                                    <td>
                                        <span className={`badge ${item.status === 'processed' ? 'badge-success' : 'badge-warning'}`}>
                                            {item.status}
                                        </span>
                                        {item.duplicateCount > 0 && (
                                            <span className="text-muted" style={{ marginLeft: 'var(--space-xs)' }}>
                                                +{item.duplicateCount} Duplikat(e)
                                            </span>
                                        )}
                                    </td>
                                    <td className="text-muted">{item.sourceIp || '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
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
