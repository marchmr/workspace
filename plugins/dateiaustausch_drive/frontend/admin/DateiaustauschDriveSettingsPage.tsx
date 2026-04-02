import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';

const PLUGIN_ID = 'dateiaustausch_drive';

const SETTING_KEYS = {
    provider: 'dateiaustausch_drive.provider',
    customerFolderPrefix: 'dateiaustausch_drive.customer_folder_prefix',
    maxUploadMb: 'dateiaustausch_drive.max_upload_mb',
    allowedExtensions: 'dateiaustausch_drive.allowed_extensions',
    googleClientEmail: 'dateiaustausch_drive.google.client_email',
    googlePrivateKey: 'dateiaustausch_drive.google.private_key',
    googleRootFolderId: 'dateiaustausch_drive.google.root_folder_id',
    googleSharedDriveId: 'dateiaustausch_drive.google.shared_drive_id',
    spTenantId: 'dateiaustausch_drive.sharepoint.tenant_id',
    spClientId: 'dateiaustausch_drive.sharepoint.client_id',
    spClientSecret: 'dateiaustausch_drive.sharepoint.client_secret',
    spSiteId: 'dateiaustausch_drive.sharepoint.site_id',
    spDriveId: 'dateiaustausch_drive.sharepoint.drive_id',
    spRootFolderId: 'dateiaustausch_drive.sharepoint.root_folder_id',
};

const EXTENSION_OPTIONS = [
    '.jpg', '.jpeg', '.png', '.webp',
    '.pdf', '.txt',
    '.doc', '.docx', '.xlsx', '.pptx',
    '.mp4', '.mov', '.webm',
    '.zip',
] as const;

type ConnectorStatus = {
    provider: 'google_drive' | 'sharepoint';
    configured: boolean;
    customerFolderPrefix: string;
    maxUploadMb: number;
    allowedExtensions: string[];
    google: {
        configured: boolean;
        hasClientEmail: boolean;
        hasPrivateKey: boolean;
        hasRootFolderId: boolean;
        sharedDriveId: string | null;
        rootFolderId: string | null;
    };
    sharepoint: {
        configured: boolean;
        hasTenantId: boolean;
        hasClientId: boolean;
        hasClientSecret: boolean;
        hasSiteId: boolean;
        hasDriveId: boolean;
        hasRootFolderId: boolean;
        siteId: string | null;
        driveId: string | null;
        rootFolderId: string | null;
    };
};

function tryExtractGoogleServiceAccount(jsonOrKey: string): { clientEmail: string; privateKey: string } | null {
    const raw = String(jsonOrKey || '').trim();
    if (!raw.startsWith('{')) return null;
    try {
        const parsed = JSON.parse(raw) as { client_email?: unknown; private_key?: unknown };
        const clientEmail = typeof parsed?.client_email === 'string' ? parsed.client_email.trim() : '';
        const privateKey = typeof parsed?.private_key === 'string' ? parsed.private_key : '';
        if (!clientEmail && !privateKey) return null;
        return { clientEmail, privateKey };
    } catch {
        return null;
    }
}

export default function DateiaustauschDriveSettingsPage() {
    const toast = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    const [provider, setProvider] = useState<'google_drive' | 'sharepoint'>('google_drive');
    const [googleClientEmail, setGoogleClientEmail] = useState('');
    const [googlePrivateKey, setGooglePrivateKey] = useState('');
    const [googlePrivateKeyStored, setGooglePrivateKeyStored] = useState(false);
    const [googleRootFolderId, setGoogleRootFolderId] = useState('');
    const [googleSharedDriveId, setGoogleSharedDriveId] = useState('');
    const [spTenantId, setSpTenantId] = useState('');
    const [spClientId, setSpClientId] = useState('');
    const [spClientSecret, setSpClientSecret] = useState('');
    const [spSiteId, setSpSiteId] = useState('');
    const [spDriveId, setSpDriveId] = useState('');
    const [spRootFolderId, setSpRootFolderId] = useState('');
    const [customerFolderPrefix, setCustomerFolderPrefix] = useState('KD');
    const [maxUploadMb, setMaxUploadMb] = useState('1024');
    const [allowedExtensions, setAllowedExtensions] = useState<string[]>([...EXTENSION_OPTIONS]);
    const [status, setStatus] = useState<ConnectorStatus | null>(null);

    useEffect(() => {
        let active = true;
        Promise.all([
            apiFetch(`/api/admin/settings/plugin/${PLUGIN_ID}`).then(async (res) => (res.ok ? res.json() : {})).catch(() => ({})),
            apiFetch('/api/plugins/dateiaustausch_drive/admin/connector/status').then(async (res) => (res.ok ? res.json() : null)).catch(() => null),
        ])
            .then(([settingsPayload, statusPayload]) => {
                if (!active) return;
                const settings = (settingsPayload || {}) as Record<string, string>;
                setProvider((settings[SETTING_KEYS.provider] as 'google_drive' | 'sharepoint') || 'google_drive');
                setGoogleClientEmail(String(settings[SETTING_KEYS.googleClientEmail] || ''));
                // Secret niemals automatisch im Klartext zurück ins Formular schreiben.
                setGooglePrivateKey('');
                setGoogleRootFolderId(String(settings[SETTING_KEYS.googleRootFolderId] || ''));
                setGoogleSharedDriveId(String(settings[SETTING_KEYS.googleSharedDriveId] || ''));
                setSpTenantId(String(settings[SETTING_KEYS.spTenantId] || ''));
                setSpClientId(String(settings[SETTING_KEYS.spClientId] || ''));
                setSpClientSecret(String(settings[SETTING_KEYS.spClientSecret] || ''));
                setSpSiteId(String(settings[SETTING_KEYS.spSiteId] || ''));
                setSpDriveId(String(settings[SETTING_KEYS.spDriveId] || ''));
                setSpRootFolderId(String(settings[SETTING_KEYS.spRootFolderId] || ''));
                setCustomerFolderPrefix(String(settings[SETTING_KEYS.customerFolderPrefix] || 'KD'));
                setMaxUploadMb(String(settings[SETTING_KEYS.maxUploadMb] || '1024'));
                const storedExtensions = String(settings[SETTING_KEYS.allowedExtensions] || '')
                    .split(',')
                    .map((entry) => entry.trim().toLowerCase())
                    .filter(Boolean);
                setAllowedExtensions(storedExtensions.length ? storedExtensions : [...EXTENSION_OPTIONS]);
                if (statusPayload) {
                    const typed = statusPayload as ConnectorStatus;
                    setStatus(typed);
                    setGooglePrivateKeyStored(Boolean(typed.google?.hasPrivateKey));
                }
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    async function saveSetting(key: string, value: string): Promise<void> {
        const res = await apiFetch(`/api/admin/settings/plugin/${PLUGIN_ID}`, {
            method: 'PUT',
            body: JSON.stringify({ key, value }),
        });
        if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            throw new Error(payload?.error || `Setting ${key} konnte nicht gespeichert werden.`);
        }
    }

    async function onSave(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const extractedGoogle = tryExtractGoogleServiceAccount(googlePrivateKey);
        const effectiveGoogleEmail = (googleClientEmail || extractedGoogle?.clientEmail || '').trim();
        const effectiveGoogleKey = (extractedGoogle?.privateKey || googlePrivateKey || '').trim();

        if (provider === 'google_drive') {
            if (!effectiveGoogleEmail) {
                toast.error('Google Client E-Mail fehlt.');
                return;
            }
            if (!effectiveGoogleKey && !googlePrivateKeyStored) {
                toast.error('Google Private Key fehlt.');
                return;
            }
            if (!googleRootFolderId.trim()) {
                toast.error('Google Root Folder ID fehlt.');
                return;
            }
        } else {
            if (!spTenantId.trim()) {
                toast.error('SharePoint Tenant ID fehlt.');
                return;
            }
            if (!spClientId.trim()) {
                toast.error('SharePoint Client ID fehlt.');
                return;
            }
            if (!spClientSecret.trim()) {
                toast.error('SharePoint Client Secret fehlt.');
                return;
            }
            if (!spSiteId.trim()) {
                toast.error('SharePoint Site ID fehlt.');
                return;
            }
            if (!spDriveId.trim()) {
                toast.error('SharePoint Drive ID fehlt.');
                return;
            }
            if (!spRootFolderId.trim()) {
                toast.error('SharePoint Root Folder ID fehlt.');
                return;
            }
        }
        const parsedUploadMb = Number.parseInt(maxUploadMb, 10);
        if (!Number.isFinite(parsedUploadMb) || parsedUploadMb < 1 || parsedUploadMb > 1024) {
            toast.error('Max Upload muss zwischen 1 und 1024 MB liegen.');
            return;
        }
        if (allowedExtensions.length === 0) {
            toast.error('Bitte mindestens eine Dateiendung erlauben.');
            return;
        }

        setSaving(true);
        try {
            const saveTasks: Promise<void>[] = [
                saveSetting(SETTING_KEYS.provider, provider),
                saveSetting(SETTING_KEYS.customerFolderPrefix, (customerFolderPrefix || 'KD').trim()),
                saveSetting(SETTING_KEYS.maxUploadMb, String(parsedUploadMb)),
                saveSetting(SETTING_KEYS.allowedExtensions, allowedExtensions.join(',')),
                saveSetting(SETTING_KEYS.googleClientEmail, effectiveGoogleEmail),
                saveSetting(SETTING_KEYS.googleRootFolderId, googleRootFolderId.trim()),
                saveSetting(SETTING_KEYS.googleSharedDriveId, googleSharedDriveId.trim()),
                saveSetting(SETTING_KEYS.spTenantId, spTenantId.trim()),
                saveSetting(SETTING_KEYS.spClientId, spClientId.trim()),
                saveSetting(SETTING_KEYS.spClientSecret, spClientSecret.trim()),
                saveSetting(SETTING_KEYS.spSiteId, spSiteId.trim()),
                saveSetting(SETTING_KEYS.spDriveId, spDriveId.trim()),
                saveSetting(SETTING_KEYS.spRootFolderId, spRootFolderId.trim()),
            ];

            if (effectiveGoogleKey) {
                saveTasks.push(saveSetting(SETTING_KEYS.googlePrivateKey, effectiveGoogleKey));
            }

            await Promise.all(saveTasks);
            toast.success('Connector-Einstellungen gespeichert.');
            if (effectiveGoogleKey) {
                setGooglePrivateKey('');
            }

            const statusRes = await apiFetch('/api/plugins/dateiaustausch_drive/admin/connector/status');
            const payload = await statusRes.json().catch(() => null);
            if (statusRes.ok && payload) {
                const typed = payload as ConnectorStatus;
                setStatus(typed);
                setGooglePrivateKeyStored(Boolean(typed.google?.hasPrivateKey));
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
        } finally {
            setSaving(false);
        }
    }

    function toggleExtension(extension: string) {
        setAllowedExtensions((prev) => {
            if (prev.includes(extension)) return prev.filter((item) => item !== extension);
            return [...prev, extension];
        });
    }

    async function onTest() {
        setTesting(true);
        try {
            const res = await apiFetch('/api/plugins/dateiaustausch_drive/admin/connector/test', { method: 'POST' });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Verbindungstest fehlgeschlagen.');
            toast.success(`Connector erfolgreich getestet (${provider === 'sharepoint' ? 'SharePoint' : 'Google Drive'}).`);
            if (payload?.status) setStatus(payload.status as ConnectorStatus);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Verbindungstest fehlgeschlagen.');
        } finally {
            setTesting(false);
        }
    }

    if (loading) {
        return <div className="card"><p className="text-muted">Lade Einstellungen...</p></div>;
    }

    return (
        <div className="card dtxd-stack">
            <div>
                <h2 className="section-title">Dateiaustausch Drive</h2>
                <p className="text-muted">
                    Cloud-Connector für Google Drive oder SharePoint. Diese Variante hält große Kundendateien vom eigenen Server fern.
                </p>
            </div>

            {status ? (
                <div className="card">
                    <span className={`badge ${status.configured ? 'badge-success' : 'badge-warning'}`}>
                        {status.configured ? 'Connector konfiguriert' : 'Connector unvollständig'}
                    </span>
                    <p className="dtxd-muted" style={{ marginTop: 8 }}>
                        Provider: {status.provider === 'sharepoint' ? 'SharePoint' : 'Google Drive'} · Prefix: {status.customerFolderPrefix}
                    </p>
                    <p className="dtxd-muted" style={{ marginTop: 6 }}>
                        Max Upload: {status.maxUploadMb} MB · Erlaubte Typen: {status.allowedExtensions.join(', ')}
                    </p>
                </div>
            ) : null}

            <form className="dtxd-stack" onSubmit={onSave}>
                <div className="dtxd-grid">
                    <label className="field">
                        <span className="label">Provider</span>
                        <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as 'google_drive' | 'sharepoint')}>
                            <option value="google_drive">Google Drive</option>
                            <option value="sharepoint">SharePoint</option>
                        </select>
                    </label>
                    <label className="field">
                        <span className="label">Kundenordner Prefix</span>
                        <input className="input" value={customerFolderPrefix} onChange={(e) => setCustomerFolderPrefix(e.target.value)} placeholder="KD" />
                    </label>
                    <label className="field">
                        <span className="label">Max Upload pro Datei (MB)</span>
                        <input className="input" type="number" min={1} max={1024} value={maxUploadMb} onChange={(e) => setMaxUploadMb(e.target.value)} placeholder="1024" />
                    </label>
                </div>

                <div className="field">
                    <span className="label">Erlaubte Dateiendungen</span>
                    <div className="dtxd-toolbar">
                        {EXTENSION_OPTIONS.map((extension) => {
                            const checked = allowedExtensions.includes(extension);
                            return (
                                <label key={extension} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleExtension(extension)}
                                    />
                                    <span>{extension}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>

                {provider === 'google_drive' ? (
                    <div className="dtxd-grid">
                        <label className="field">
                            <span className="label">Google Client E-Mail</span>
                            <input className="input" value={googleClientEmail} onChange={(e) => setGoogleClientEmail(e.target.value)} placeholder="service-account@projekt.iam.gserviceaccount.com" />
                        </label>
                        <label className="field">
                            <span className="label">Google Root Folder ID</span>
                            <input className="input" value={googleRootFolderId} onChange={(e) => setGoogleRootFolderId(e.target.value)} placeholder="Drive Folder ID" />
                        </label>
                        <label className="field">
                            <span className="label">Google Shared Drive ID (optional)</span>
                            <input className="input" value={googleSharedDriveId} onChange={(e) => setGoogleSharedDriveId(e.target.value)} placeholder="Optional: Shared Drive ID" />
                        </label>
                    </div>
                ) : (
                    <div className="dtxd-grid">
                        <label className="field">
                            <span className="label">SharePoint Tenant ID</span>
                            <input className="input" value={spTenantId} onChange={(e) => setSpTenantId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                        </label>
                        <label className="field">
                            <span className="label">SharePoint Client ID</span>
                            <input className="input" value={spClientId} onChange={(e) => setSpClientId(e.target.value)} placeholder="App Registration Client ID" />
                        </label>
                        <label className="field">
                            <span className="label">SharePoint Site ID</span>
                            <input className="input" value={spSiteId} onChange={(e) => setSpSiteId(e.target.value)} placeholder="Site ID (Graph)" />
                        </label>
                        <label className="field">
                            <span className="label">SharePoint Drive ID</span>
                            <input className="input" value={spDriveId} onChange={(e) => setSpDriveId(e.target.value)} placeholder="Drive ID (Dokumentenbibliothek)" />
                        </label>
                        <label className="field">
                            <span className="label">SharePoint Root Folder ID</span>
                            <input className="input" value={spRootFolderId} onChange={(e) => setSpRootFolderId(e.target.value)} placeholder="Root Folder Item ID" />
                        </label>
                        <label className="field">
                            <span className="label">SharePoint Client Secret</span>
                            <input className="input" type="password" value={spClientSecret} onChange={(e) => setSpClientSecret(e.target.value)} placeholder="Client Secret" />
                        </label>
                    </div>
                )}

                {provider === 'google_drive' ? (
                    <label className="field">
                        <span className="label">Google Private Key oder komplette Service-Account JSON</span>
                        <textarea
                            className="input"
                            rows={8}
                            value={googlePrivateKey}
                            onChange={(e) => setGooglePrivateKey(e.target.value)}
                            placeholder={'Option A: -----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\n\nOption B: komplette JSON-Datei einfügen'}
                        />
                        <span className="text-muted" style={{ marginTop: 6, display: 'block' }}>
                            {googlePrivateKeyStored
                                ? 'Private Key ist gespeichert und wird aus Sicherheitsgründen nicht angezeigt. Nur zum Ersetzen hier neu einfügen.'
                                : 'Noch kein Private Key gespeichert.'}
                        </span>
                    </label>
                ) : null}

                <div className="dtxd-grid">
                    <label className="field">
                        <span className="label">Aktiver Provider</span>
                        <input className="input" disabled value={provider === 'sharepoint' ? 'SharePoint' : 'Google Drive'} />
                    </label>
                    <label className="field">
                        <span className="label">Status</span>
                        <input className="input" disabled value={status?.configured ? 'Konfiguriert' : 'Unvollständig'} />
                    </label>
                </div>

                <div className="dtxd-toolbar">
                    <button className="btn btn-primary" type="submit" disabled={saving}>
                        {saving ? 'Speichert...' : 'Einstellungen speichern'}
                    </button>
                    <button className="btn btn-secondary" type="button" onClick={onTest} disabled={testing}>
                        {testing ? 'Teste...' : 'Verbindung testen'}
                    </button>
                </div>
            </form>
        </div>
    );
}
