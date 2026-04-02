import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';

const PLUGIN_ID = 'dateiaustausch_drive';

const SETTING_KEYS = {
    provider: 'dateiaustausch_drive.provider',
    customerFolderPrefix: 'dateiaustausch_drive.customer_folder_prefix',
    maxUploadMb: 'dateiaustausch_drive.max_upload_mb',
    customerQuotaMb: 'dateiaustausch_drive.customer_quota_mb',
    allowedExtensions: 'dateiaustausch_drive.allowed_extensions',
    googleClientEmail: 'dateiaustausch_drive.google.client_email',
    googlePrivateKey: 'dateiaustausch_drive.google.private_key',
    googleRootFolderId: 'dateiaustausch_drive.google.root_folder_id',
    googleSharedDriveId: 'dateiaustausch_drive.google.shared_drive_id',
    googleAuthMode: 'dateiaustausch_drive.google.auth_mode',
    googleOAuthClientId: 'dateiaustausch_drive.google.oauth_client_id',
    googleOAuthClientSecret: 'dateiaustausch_drive.google.oauth_client_secret',
    googleOAuthRefreshToken: 'dateiaustausch_drive.google.oauth_refresh_token',
    spTenantId: 'dateiaustausch_drive.sharepoint.tenant_id',
    spClientId: 'dateiaustausch_drive.sharepoint.client_id',
    spClientSecret: 'dateiaustausch_drive.sharepoint.client_secret',
    spSiteId: 'dateiaustausch_drive.sharepoint.site_id',
    spDriveId: 'dateiaustausch_drive.sharepoint.drive_id',
    spRootFolderId: 'dateiaustausch_drive.sharepoint.root_folder_id',
};

const EXTENSION_OPTIONS = [
    '.jpg', '.jpeg', '.png', '.webp',
    '.pdf', '.txt', '.csv',
    '.doc', '.docx', '.xlsx', '.pptx',
    '.ai', '.svg', '.psd',
    '.mp4', '.mov', '.webm',
    '.zip',
] as const;

type ConnectorStatus = {
    provider: 'google_drive' | 'sharepoint';
    configured: boolean;
    customerFolderPrefix: string;
    maxUploadMb: number;
    customerQuotaMb: number;
    allowedExtensions: string[];
    google: {
        configured: boolean;
        authMode: 'service_account' | 'oauth_refresh';
        hasClientEmail: boolean;
        hasPrivateKey: boolean;
        hasRootFolderId: boolean;
        sharedDriveId: string | null;
        rootFolderId: string | null;
        hasOAuthClientId: boolean;
        hasOAuthClientSecret: boolean;
        hasOAuthRefreshToken: boolean;
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
    const [googleAuthMode, setGoogleAuthMode] = useState<'service_account' | 'oauth_refresh'>('service_account');
    const [googlePrivateKey, setGooglePrivateKey] = useState('');
    const [googlePrivateKeyStored, setGooglePrivateKeyStored] = useState(false);
    const [googleRootFolderId, setGoogleRootFolderId] = useState('');
    const [googleSharedDriveId, setGoogleSharedDriveId] = useState('');
    const [googleOAuthClientId, setGoogleOAuthClientId] = useState('');
    const [googleOAuthClientSecret, setGoogleOAuthClientSecret] = useState('');
    const [googleOAuthRefreshToken, setGoogleOAuthRefreshToken] = useState('');
    const [googleOAuthClientSecretStored, setGoogleOAuthClientSecretStored] = useState(false);
    const [googleOAuthRefreshTokenStored, setGoogleOAuthRefreshTokenStored] = useState(false);
    const [spTenantId, setSpTenantId] = useState('');
    const [spClientId, setSpClientId] = useState('');
    const [spClientSecret, setSpClientSecret] = useState('');
    const [spSiteId, setSpSiteId] = useState('');
    const [spDriveId, setSpDriveId] = useState('');
    const [spRootFolderId, setSpRootFolderId] = useState('');
    const [customerFolderPrefix, setCustomerFolderPrefix] = useState('KD');
    const [maxUploadMb, setMaxUploadMb] = useState('1024');
    const [customerQuotaMb, setCustomerQuotaMb] = useState('0');
    const [allowedExtensions, setAllowedExtensions] = useState<string[]>([...EXTENSION_OPTIONS]);
    const [status, setStatus] = useState<ConnectorStatus | null>(null);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState(1);
    const [showAdvanced, setShowAdvanced] = useState(false);

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
                setGoogleAuthMode((settings[SETTING_KEYS.googleAuthMode] as 'service_account' | 'oauth_refresh') || 'service_account');
                setGoogleClientEmail(String(settings[SETTING_KEYS.googleClientEmail] || ''));
                // Secret niemals automatisch im Klartext zurück ins Formular schreiben.
                setGooglePrivateKey('');
                setGoogleRootFolderId(String(settings[SETTING_KEYS.googleRootFolderId] || ''));
                setGoogleSharedDriveId(String(settings[SETTING_KEYS.googleSharedDriveId] || ''));
                setGoogleOAuthClientId(String(settings[SETTING_KEYS.googleOAuthClientId] || ''));
                setGoogleOAuthClientSecret('');
                setGoogleOAuthRefreshToken('');
                setSpTenantId(String(settings[SETTING_KEYS.spTenantId] || ''));
                setSpClientId(String(settings[SETTING_KEYS.spClientId] || ''));
                setSpClientSecret(String(settings[SETTING_KEYS.spClientSecret] || ''));
                setSpSiteId(String(settings[SETTING_KEYS.spSiteId] || ''));
                setSpDriveId(String(settings[SETTING_KEYS.spDriveId] || ''));
                setSpRootFolderId(String(settings[SETTING_KEYS.spRootFolderId] || ''));
                setCustomerFolderPrefix(String(settings[SETTING_KEYS.customerFolderPrefix] || 'KD'));
                setMaxUploadMb(String(settings[SETTING_KEYS.maxUploadMb] || '1024'));
                setCustomerQuotaMb(String(settings[SETTING_KEYS.customerQuotaMb] || '0'));
                const storedExtensions = String(settings[SETTING_KEYS.allowedExtensions] || '')
                    .split(',')
                    .map((entry) => entry.trim().toLowerCase())
                    .filter(Boolean);
                setAllowedExtensions(storedExtensions.length ? storedExtensions : [...EXTENSION_OPTIONS]);
                if (statusPayload) {
                    const typed = statusPayload as ConnectorStatus;
                    setStatus(typed);
                    setGoogleAuthMode(typed.google?.authMode || 'service_account');
                    setGooglePrivateKeyStored(Boolean(typed.google?.hasPrivateKey));
                    setGoogleOAuthClientSecretStored(Boolean(typed.google?.hasOAuthClientSecret));
                    setGoogleOAuthRefreshTokenStored(Boolean(typed.google?.hasOAuthRefreshToken));
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

    function validateForSave(): string | null {
        const extractedGoogle = tryExtractGoogleServiceAccount(googlePrivateKey);
        const effectiveGoogleEmail = (googleClientEmail || extractedGoogle?.clientEmail || '').trim();
        const effectiveGoogleKey = (extractedGoogle?.privateKey || googlePrivateKey || '').trim();

        if (provider === 'google_drive') {
            if (googleAuthMode === 'oauth_refresh') {
                if (!googleOAuthClientId.trim()) {
                    return 'Google OAuth Client ID fehlt.';
                }
                if (!googleOAuthClientSecret.trim() && !googleOAuthClientSecretStored) {
                    return 'Google OAuth Client Secret fehlt.';
                }
                if (!googleOAuthRefreshToken.trim() && !googleOAuthRefreshTokenStored) {
                    return 'Google OAuth Refresh Token fehlt.';
                }
            } else {
                if (!effectiveGoogleEmail) {
                    return 'Google Client E-Mail fehlt.';
                }
                if (!effectiveGoogleKey && !googlePrivateKeyStored) {
                    return 'Google Private Key fehlt.';
                }
            }
            if (!googleRootFolderId.trim()) {
                return 'Google Root Folder ID fehlt.';
            }
        } else {
            if (!spTenantId.trim()) {
                return 'SharePoint Tenant ID fehlt.';
            }
            if (!spClientId.trim()) {
                return 'SharePoint Client ID fehlt.';
            }
            if (!spClientSecret.trim()) {
                return 'SharePoint Client Secret fehlt.';
            }
            if (!spSiteId.trim()) {
                return 'SharePoint Site ID fehlt.';
            }
            if (!spDriveId.trim()) {
                return 'SharePoint Drive ID fehlt.';
            }
            if (!spRootFolderId.trim()) {
                return 'SharePoint Root Folder ID fehlt.';
            }
        }
        const parsedUploadMb = Number.parseInt(maxUploadMb, 10);
        if (!Number.isFinite(parsedUploadMb) || parsedUploadMb < 1 || parsedUploadMb > 1024) {
            return 'Max Upload muss zwischen 1 und 1024 MB liegen.';
        }
        if (allowedExtensions.length === 0) {
            return 'Bitte mindestens eine Dateiendung erlauben.';
        }
        return null;
    }

    async function persistSettings(showSuccessToast = true): Promise<boolean> {
        const validationError = validateForSave();
        if (validationError) {
            toast.error(validationError);
            return false;
        }

        const extractedGoogle = tryExtractGoogleServiceAccount(googlePrivateKey);
        const effectiveGoogleEmail = (googleClientEmail || extractedGoogle?.clientEmail || '').trim();
        const effectiveGoogleKey = (extractedGoogle?.privateKey || googlePrivateKey || '').trim();
        const parsedUploadMb = Number.parseInt(maxUploadMb, 10);

        setSaving(true);
        try {
            const saveTasks: Promise<void>[] = [
                saveSetting(SETTING_KEYS.provider, provider),
                saveSetting(SETTING_KEYS.googleAuthMode, googleAuthMode),
                saveSetting(SETTING_KEYS.customerFolderPrefix, (customerFolderPrefix || 'KD').trim()),
                saveSetting(SETTING_KEYS.maxUploadMb, String(parsedUploadMb)),
                saveSetting(SETTING_KEYS.customerQuotaMb, String(Number.parseInt(customerQuotaMb, 10) || 0)),
                saveSetting(SETTING_KEYS.allowedExtensions, allowedExtensions.join(',')),
                saveSetting(SETTING_KEYS.googleClientEmail, effectiveGoogleEmail),
                saveSetting(SETTING_KEYS.googleRootFolderId, googleRootFolderId.trim()),
                saveSetting(SETTING_KEYS.googleSharedDriveId, googleSharedDriveId.trim()),
                saveSetting(SETTING_KEYS.googleOAuthClientId, googleOAuthClientId.trim()),
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
            if (googleOAuthClientSecret.trim()) {
                saveTasks.push(saveSetting(SETTING_KEYS.googleOAuthClientSecret, googleOAuthClientSecret.trim()));
            }
            if (googleOAuthRefreshToken.trim()) {
                saveTasks.push(saveSetting(SETTING_KEYS.googleOAuthRefreshToken, googleOAuthRefreshToken.trim()));
            }

            await Promise.all(saveTasks);
            if (showSuccessToast) toast.success('Connector-Einstellungen gespeichert.');
            if (effectiveGoogleKey) {
                setGooglePrivateKey('');
            }
            if (googleOAuthClientSecret.trim()) {
                setGoogleOAuthClientSecret('');
            }
            if (googleOAuthRefreshToken.trim()) {
                setGoogleOAuthRefreshToken('');
            }

            const statusRes = await apiFetch('/api/plugins/dateiaustausch_drive/admin/connector/status');
            const payload = await statusRes.json().catch(() => null);
            if (statusRes.ok && payload) {
                const typed = payload as ConnectorStatus;
                setStatus(typed);
                setGoogleAuthMode(typed.google?.authMode || 'service_account');
                setGooglePrivateKeyStored(Boolean(typed.google?.hasPrivateKey));
                setGoogleOAuthClientSecretStored(Boolean(typed.google?.hasOAuthClientSecret));
                setGoogleOAuthRefreshTokenStored(Boolean(typed.google?.hasOAuthRefreshToken));
            }
            return true;
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
            return false;
        } finally {
            setSaving(false);
        }
    }

    async function onSave(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        await persistSettings(true);
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

    function openWizard() {
        setWizardStep(1);
        setWizardOpen(true);
    }

    function nextWizardStep() {
        if (wizardStep === 1) {
            const parsedUploadMb = Number.parseInt(maxUploadMb, 10);
            if (!Number.isFinite(parsedUploadMb) || parsedUploadMb < 1 || parsedUploadMb > 1024) {
                toast.error('Max Upload muss zwischen 1 und 1024 MB liegen.');
                return;
            }
            if (allowedExtensions.length === 0) {
                toast.error('Bitte mindestens eine Dateiendung erlauben.');
                return;
            }
        }
        if (wizardStep === 2) {
            const validationError = validateForSave();
            if (validationError) {
                toast.error(validationError);
                return;
            }
        }
        setWizardStep((prev) => Math.min(3, prev + 1));
    }

    if (loading) {
        return <div className="card"><p className="text-muted">Lade Einstellungen...</p></div>;
    }

    return (
        <div className="card dtxd-stack">
            <div>
                <h2 className="section-title">Dateiaustausch</h2>
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
                        Max Upload: {status.maxUploadMb} MB · Kundenordner-Limit: {status.customerQuotaMb ? `${status.customerQuotaMb} MB` : 'Unbegrenzt'} · Erlaubte Typen: {status.allowedExtensions.join(', ')}
                    </p>
                    <p className="dtxd-muted" style={{ marginTop: 6 }}>
                        Es ist immer nur ein Provider aktiv. Aktuell aktiv: <strong>{status.provider === 'sharepoint' ? 'SharePoint' : 'Google Drive'}</strong>.
                    </p>
                </div>
            ) : null}

            <div className="card dtxd-setup-card">
                <div>
                    <h3 style={{ marginBottom: 6 }}>Setup-Assistent</h3>
                    <p className="text-muted" style={{ margin: 0 }}>
                        Geführte Einrichtung in 3 Schritten: Basis, Cloud-Anbindung, Abschluss.
                    </p>
                </div>
                <div className="dtxd-toolbar">
                    <button className="btn btn-primary" type="button" onClick={openWizard}>Assistent starten</button>
                    <button className="btn btn-secondary" type="button" onClick={() => setShowAdvanced((prev) => !prev)}>
                        {showAdvanced ? 'Erweiterte Felder ausblenden' : 'Erweiterte Felder anzeigen'}
                    </button>
                </div>
            </div>

            {showAdvanced ? <form className="dtxd-stack" onSubmit={onSave}>
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
                    <label className="field">
                        <span className="label">Speicherlimit pro Kunde (MB)</span>
                        <input className="input" type="number" min={0} max={102400} value={customerQuotaMb} onChange={(e) => setCustomerQuotaMb(e.target.value)} placeholder="0 = unbegrenzt" />
                        <span className="text-muted" style={{ marginTop: 4, display: 'block', fontSize: 12 }}>0 = kein Limit</span>
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
                            <span className="label">Google Auth Modus</span>
                            <select className="input" value={googleAuthMode} onChange={(e) => setGoogleAuthMode(e.target.value as 'service_account' | 'oauth_refresh')}>
                                <option value="oauth_refresh">Persönliches Drive (OAuth Refresh Token)</option>
                                <option value="service_account">Google Workspace (Service Account + Shared Drive)</option>
                            </select>
                        </label>
                        <label className="field">
                            <span className="label">Google Root Folder ID</span>
                            <input className="input" value={googleRootFolderId} onChange={(e) => setGoogleRootFolderId(e.target.value)} placeholder="Drive Folder ID" />
                        </label>
                        <label className="field">
                            <span className="label">Google Shared Drive ID (optional)</span>
                            <input className="input" value={googleSharedDriveId} onChange={(e) => setGoogleSharedDriveId(e.target.value)} placeholder="Optional: Shared Drive ID" />
                        </label>
                        <label className="field">
                            <span className="label">Google Client E-Mail (nur Service Account)</span>
                            <input
                                className="input"
                                value={googleClientEmail}
                                onChange={(e) => setGoogleClientEmail(e.target.value)}
                                placeholder="service-account@projekt.iam.gserviceaccount.com"
                                disabled={googleAuthMode !== 'service_account'}
                            />
                        </label>
                        {googleAuthMode === 'oauth_refresh' ? (
                            <label className="field">
                                <span className="label">Google OAuth Client ID</span>
                                <input className="input" value={googleOAuthClientId} onChange={(e) => setGoogleOAuthClientId(e.target.value)} placeholder="xxxxxxxx.apps.googleusercontent.com" />
                            </label>
                        ) : null}
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

                {provider === 'google_drive' && googleAuthMode === 'service_account' ? (
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

                {provider === 'google_drive' && googleAuthMode === 'oauth_refresh' ? (
                    <>
                        <label className="field">
                            <span className="label">Google OAuth Client Secret</span>
                            <input
                                className="input"
                                type="password"
                                value={googleOAuthClientSecret}
                                onChange={(e) => setGoogleOAuthClientSecret(e.target.value)}
                                placeholder="Nur eintragen, wenn neu setzen/ändern"
                            />
                            <span className="text-muted" style={{ marginTop: 6, display: 'block' }}>
                                {googleOAuthClientSecretStored
                                    ? 'Client Secret ist gespeichert und wird aus Sicherheitsgründen nicht angezeigt.'
                                    : 'Noch kein OAuth Client Secret gespeichert.'}
                            </span>
                        </label>
                        <label className="field">
                            <span className="label">Google OAuth Refresh Token</span>
                            <textarea
                                className="input"
                                rows={5}
                                value={googleOAuthRefreshToken}
                                onChange={(e) => setGoogleOAuthRefreshToken(e.target.value)}
                                placeholder="Nur eintragen, wenn neu setzen/ändern"
                            />
                            <span className="text-muted" style={{ marginTop: 6, display: 'block' }}>
                                {googleOAuthRefreshTokenStored
                                    ? 'Refresh Token ist gespeichert und wird aus Sicherheitsgründen nicht angezeigt.'
                                    : 'Noch kein OAuth Refresh Token gespeichert.'}
                            </span>
                        </label>
                    </>
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
            </form> : null}

            {wizardOpen ? (
                <div className="modal-overlay" onClick={() => !saving && setWizardOpen(false)}>
                    <div className="modal-card dtxd-wizard-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Dateiaustausch einrichten</h3>
                            <button className="modal-close" onClick={() => setWizardOpen(false)} disabled={saving}>×</button>
                        </div>

                        <div className="dtxd-wizard-steps">
                            <span className={`dtxd-wizard-step ${wizardStep >= 1 ? 'is-active' : ''}`}>1. Basis</span>
                            <span className={`dtxd-wizard-step ${wizardStep >= 2 ? 'is-active' : ''}`}>2. Verbindung</span>
                            <span className={`dtxd-wizard-step ${wizardStep >= 3 ? 'is-active' : ''}`}>3. Abschluss</span>
                        </div>

                        {wizardStep === 1 ? (
                            <div className="dtxd-stack">
                                <p className="text-muted">Wähle Provider und Upload-Regeln.</p>
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
                                        <input className="input" type="number" min={1} max={1024} value={maxUploadMb} onChange={(e) => setMaxUploadMb(e.target.value)} />
                                    </label>
                                    <label className="field">
                                        <span className="label">Speicherlimit pro Kunde (MB)</span>
                                        <input className="input" type="number" min={0} max={102400} value={customerQuotaMb} onChange={(e) => setCustomerQuotaMb(e.target.value)} placeholder="0 = unbegrenzt" />
                                        <span className="text-muted" style={{ marginTop: 4, display: 'block', fontSize: 12 }}>0 = kein Limit</span>
                                    </label>
                                </div>
                                <div className="field">
                                    <span className="label">Erlaubte Dateiendungen</span>
                                    <div className="dtxd-toolbar">
                                        {EXTENSION_OPTIONS.map((extension) => {
                                            const checked = allowedExtensions.includes(extension);
                                            return (
                                                <label key={extension} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                    <input type="checkbox" checked={checked} onChange={() => toggleExtension(extension)} />
                                                    <span>{extension}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {wizardStep === 2 ? (
                            <div className="dtxd-stack">
                                <p className="text-muted">Trage deine Zugangsdaten für den gewählten Provider ein.</p>
                                {provider === 'google_drive' ? (
                                    <>
                                        <div className="dtxd-grid">
                                            <label className="field">
                                                <span className="label">Google Auth Modus</span>
                                                <select className="input" value={googleAuthMode} onChange={(e) => setGoogleAuthMode(e.target.value as 'service_account' | 'oauth_refresh')}>
                                                    <option value="oauth_refresh">Persönliches Drive (OAuth Refresh Token)</option>
                                                    <option value="service_account">Google Workspace (Service Account + Shared Drive)</option>
                                                </select>
                                            </label>
                                            <label className="field">
                                                <span className="label">Google Root Folder ID</span>
                                                <input className="input" value={googleRootFolderId} onChange={(e) => setGoogleRootFolderId(e.target.value)} />
                                            </label>
                                            <label className="field">
                                                <span className="label">Google Shared Drive ID (optional)</span>
                                                <input className="input" value={googleSharedDriveId} onChange={(e) => setGoogleSharedDriveId(e.target.value)} />
                                            </label>
                                        </div>

                                        {googleAuthMode === 'oauth_refresh' ? (
                                            <div className="dtxd-grid">
                                                <label className="field">
                                                    <span className="label">Google OAuth Client ID</span>
                                                    <input className="input" value={googleOAuthClientId} onChange={(e) => setGoogleOAuthClientId(e.target.value)} />
                                                </label>
                                                <label className="field">
                                                    <span className="label">Google OAuth Client Secret</span>
                                                    <input className="input" type="password" value={googleOAuthClientSecret} onChange={(e) => setGoogleOAuthClientSecret(e.target.value)} placeholder={googleOAuthClientSecretStored ? 'Bereits gespeichert' : ''} />
                                                </label>
                                                <label className="field">
                                                    <span className="label">Google OAuth Refresh Token</span>
                                                    <textarea className="input" rows={3} value={googleOAuthRefreshToken} onChange={(e) => setGoogleOAuthRefreshToken(e.target.value)} placeholder={googleOAuthRefreshTokenStored ? 'Bereits gespeichert' : ''} />
                                                </label>
                                            </div>
                                        ) : (
                                            <div className="dtxd-grid">
                                                <label className="field">
                                                    <span className="label">Google Client E-Mail</span>
                                                    <input className="input" value={googleClientEmail} onChange={(e) => setGoogleClientEmail(e.target.value)} />
                                                </label>
                                                <label className="field">
                                                    <span className="label">Google Private Key / Service-Account JSON</span>
                                                    <textarea className="input" rows={5} value={googlePrivateKey} onChange={(e) => setGooglePrivateKey(e.target.value)} placeholder={googlePrivateKeyStored ? 'Bereits gespeichert' : ''} />
                                                </label>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="dtxd-grid">
                                        <label className="field">
                                            <span className="label">SharePoint Tenant ID</span>
                                            <input className="input" value={spTenantId} onChange={(e) => setSpTenantId(e.target.value)} />
                                        </label>
                                        <label className="field">
                                            <span className="label">SharePoint Client ID</span>
                                            <input className="input" value={spClientId} onChange={(e) => setSpClientId(e.target.value)} />
                                        </label>
                                        <label className="field">
                                            <span className="label">SharePoint Client Secret</span>
                                            <input className="input" type="password" value={spClientSecret} onChange={(e) => setSpClientSecret(e.target.value)} />
                                        </label>
                                        <label className="field">
                                            <span className="label">SharePoint Site ID</span>
                                            <input className="input" value={spSiteId} onChange={(e) => setSpSiteId(e.target.value)} />
                                        </label>
                                        <label className="field">
                                            <span className="label">SharePoint Drive ID</span>
                                            <input className="input" value={spDriveId} onChange={(e) => setSpDriveId(e.target.value)} />
                                        </label>
                                        <label className="field">
                                            <span className="label">SharePoint Root Folder ID</span>
                                            <input className="input" value={spRootFolderId} onChange={(e) => setSpRootFolderId(e.target.value)} />
                                        </label>
                                    </div>
                                )}
                            </div>
                        ) : null}

                        {wizardStep === 3 ? (
                            <div className="dtxd-stack">
                                <p className="text-muted">
                                    Prüfe die Zusammenfassung und speichere. Danach kannst du direkt die Verbindung testen.
                                </p>
                                <div className="card">
                                    <p style={{ margin: 0 }}>
                                        <strong>Provider:</strong> {provider === 'sharepoint' ? 'SharePoint' : 'Google Drive'}<br />
                                        <strong>Prefix:</strong> {customerFolderPrefix || 'KD'}<br />
                                        <strong>Max Upload:</strong> {maxUploadMb} MB<br />
                                        <strong>Kundenordner-Limit:</strong> {Number(customerQuotaMb) > 0 ? `${customerQuotaMb} MB` : 'Unbegrenzt'}<br />
                                        <strong>Erlaubte Typen:</strong> {allowedExtensions.join(', ')}
                                    </p>
                                </div>
                            </div>
                        ) : null}

                        <div className="modal-actions">
                            <button className="btn btn-secondary" type="button" onClick={() => setWizardOpen(false)} disabled={saving}>Abbrechen</button>
                            {wizardStep > 1 ? (
                                <button className="btn btn-secondary" type="button" onClick={() => setWizardStep((s) => Math.max(1, s - 1))}>Zurück</button>
                            ) : null}
                            {wizardStep < 3 ? (
                                <button className="btn btn-primary" type="button" onClick={nextWizardStep}>Weiter</button>
                            ) : (
                                <>
                                    <button
                                        className="btn btn-secondary"
                                        type="button"
                                        onClick={onTest}
                                        disabled={testing || saving}
                                    >
                                        {testing ? 'Teste...' : 'Verbindung testen'}
                                    </button>
                                    <button
                                        className="btn btn-primary"
                                        type="button"
                                        onClick={async () => {
                                            const ok = await persistSettings(true);
                                            if (ok) setWizardOpen(false);
                                        }}
                                        disabled={saving}
                                    >
                                        {saving ? 'Speichert...' : 'Jetzt speichern'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
