import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';
import '../videoplattform.css';

const SETTING_KEY = 'videoplattform.public_subdomain';
const LOGO_HEIGHT_KEY = 'videoplattform.public_logo_height';

function normalizeHost(value: string): string {
    return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

type ProvisionStep = {
    key: string;
    ok: boolean;
    message: string;
    details?: string;
};

type Guidance = {
    errorCode: string;
    title: string;
    why: string;
    nextSteps: string[];
    commands: string[];
};

type ProvisionStatus = {
    host: string;
    configFile: string;
    enabledFile: string;
    configExists: boolean;
    enabledExists: boolean;
    sslCertExists: boolean;
    domainLinked: boolean;
    domainLinkedReason: string;
    dns: {
        expectedServerIps: string[];
        resolvedA: string[];
        resolvedAAAA: string[];
        pointsToServer: boolean;
        warning?: string;
    };
};

type ProvisionResponse = {
    ok: boolean;
    host: string;
    sslCertExists: boolean;
    steps: ProvisionStep[];
    manualCommands: string[];
    failedStep?: string | null;
    guidance?: Guidance | null;
};

type PreflightResponse = {
    host: string;
    ok: boolean;
    checks: ProvisionStep[];
    guidance: Guidance[];
};

export default function VideoPlatformSettingsPage() {
    const toast = useToast();

    const [host, setHost] = useState('kunden.webdesign-hammer.de');
    const [logoHeight, setLogoHeight] = useState('52');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [checking, setChecking] = useState(false);
    const [provisioning, setProvisioning] = useState(false);
    const [preflighting, setPreflighting] = useState(false);
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [logoLoading, setLogoLoading] = useState(false);
    const [logoUploading, setLogoUploading] = useState(false);
    const [status, setStatus] = useState<ProvisionStatus | null>(null);
    const [lastProvision, setLastProvision] = useState<ProvisionResponse | null>(null);
    const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
    const failedProvisionStep = lastProvision?.steps.find((step) => !step.ok) || null;

    useEffect(() => {
        let active = true;

        apiFetch('/api/admin/settings/plugin/videoplattform')
            .then(async (res) => {
                if (!res.ok) return;
                const payload = await res.json();
                if (!active) return;
                const value = typeof payload?.[SETTING_KEY] === 'string' ? payload[SETTING_KEY] : '';
                if (value.trim()) {
                    setHost(normalizeHost(value));
                }
                const logoHeightValue = typeof payload?.[LOGO_HEIGHT_KEY] === 'string' ? payload[LOGO_HEIGHT_KEY].trim() : '';
                if (logoHeightValue) setLogoHeight(logoHeightValue);
            })
            .catch(() => {
                // ignore
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        setLogoLoading(true);
        apiFetch('/api/plugins/videoplattform/admin/branding/logo')
            .then(async (res) => {
                if (!active || !res.ok) return;
                const payload = await res.json().catch(() => ({}));
                setLogoUrl(typeof payload?.url === 'string' ? `${payload.url}${payload.url.includes('?') ? '&' : '?'}v=${Date.now()}` : null);
            })
            .catch(() => {
                // ignore
            })
            .finally(() => {
                if (active) setLogoLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    async function onSave(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const normalized = normalizeHost(host);
        if (!normalized) {
            toast.error('Bitte eine gültige Subdomain eintragen');
            return;
        }

        setSaving(true);
        try {
            const res = await apiFetch('/api/admin/settings/plugin/videoplattform', {
                method: 'PUT',
                body: JSON.stringify({ key: SETTING_KEY, value: normalized }),
            });
            const parsedHeight = Number(logoHeight);
            const safeHeight = Number.isFinite(parsedHeight) ? String(Math.max(24, Math.min(180, Math.round(parsedHeight)))) : '52';
            const logoHeightRes = await apiFetch('/api/admin/settings/plugin/videoplattform', {
                method: 'PUT',
                body: JSON.stringify({ key: LOGO_HEIGHT_KEY, value: safeHeight }),
            });

            if (!res.ok || !logoHeightRes.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload?.error || 'Einstellung konnte nicht gespeichert werden');
            }

            setHost(normalized);
            setLogoHeight(safeHeight);
            toast.success('Subdomain gespeichert');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Einstellung konnte nicht gespeichert werden');
        } finally {
            setSaving(false);
        }
    }

    async function checkProvisionStatus() {
        const normalized = normalizeHost(host);
        if (!normalized) {
            toast.error('Bitte eine gültige Subdomain eintragen');
            return;
        }

        setChecking(true);
        try {
            const res = await apiFetch(`/api/admin/subdomain-provisioning/videoplattform/status?host=${encodeURIComponent(normalized)}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Statusprüfung fehlgeschlagen');
            setStatus(payload as ProvisionStatus);
            toast.success('Status aktualisiert');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Statusprüfung fehlgeschlagen');
        } finally {
            setChecking(false);
        }
    }

    async function runPreflight() {
        const normalized = normalizeHost(host);
        if (!normalized) {
            toast.error('Bitte eine gültige Subdomain eintragen');
            return;
        }

        setPreflighting(true);
        try {
            const res = await apiFetch(`/api/admin/subdomain-provisioning/videoplattform/preflight?host=${encodeURIComponent(normalized)}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Preflight fehlgeschlagen');

            setPreflight(payload as PreflightResponse);
            if (payload?.ok) {
                toast.success('Preflight erfolgreich');
            } else {
                toast.error('Preflight hat Probleme gefunden');
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Preflight fehlgeschlagen');
        } finally {
            setPreflighting(false);
        }
    }

    async function runProvisioning() {
        const normalized = normalizeHost(host);
        if (!normalized) {
            toast.error('Bitte eine gültige Subdomain eintragen');
            return;
        }

        setProvisioning(true);
        try {
            const res = await apiFetch('/api/admin/subdomain-provisioning/videoplattform/provision', {
                method: 'POST',
                body: JSON.stringify({
                    host: normalized,
                    publicPath: '/',
                }),
            });

            const payload = await res.json().catch(() => ({}));
            if (!res.ok && !payload?.steps) {
                throw new Error(payload?.error || 'Automatische Einrichtung fehlgeschlagen');
            }

            setLastProvision(payload as ProvisionResponse);
            if (payload?.ok) {
                toast.success('Subdomain erfolgreich eingerichtet');
            } else {
                toast.error('Einrichtung unvollständig. Details siehe Assistent.');
            }
            await checkProvisionStatus();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Automatische Einrichtung fehlgeschlagen');
        } finally {
            setProvisioning(false);
        }
    }

    async function copyCommand(command: string) {
        try {
            await navigator.clipboard.writeText(command);
            toast.success('Befehl kopiert');
        } catch {
            toast.error('Kopieren nicht möglich');
        }
    }

    async function uploadPortalLogo(file: File | null) {
        if (!file) return;
        setLogoUploading(true);
        try {
            const data = new FormData();
            data.append('file', file);
            const res = await apiFetch('/api/plugins/videoplattform/admin/branding/logo', {
                method: 'POST',
                body: data,
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Logo konnte nicht hochgeladen werden');
            setLogoUrl(typeof payload?.url === 'string' ? payload.url : `/api/plugins/videoplattform/public/logo?v=${Date.now()}`);
            toast.success('Portal-Logo gespeichert');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Logo konnte nicht hochgeladen werden');
        } finally {
            setLogoUploading(false);
        }
    }

    async function removePortalLogo() {
        setLogoUploading(true);
        try {
            const res = await apiFetch('/api/plugins/videoplattform/admin/branding/logo', { method: 'DELETE' });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Logo konnte nicht entfernt werden');
            setLogoUrl(null);
            toast.success('Portal-Logo entfernt');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Logo konnte nicht entfernt werden');
        } finally {
            setLogoUploading(false);
        }
    }

    if (loading) {
        return <p className="text-muted">Einstellungen werden geladen...</p>;
    }

    return (
        <div className="vp-settings">
            <h3 style={{ marginBottom: 'var(--space-xs)' }}>Kundenportal Subdomain</h3>
            <p className="text-muted" style={{ marginBottom: 'var(--space-md)' }}>
                Diese globale Subdomain gilt für alle Kunden. Das öffentliche Video-Frontend ist nur über diesen Host erreichbar.
            </p>

            <form onSubmit={onSave} className="vp-inline-form">
                <input
                    className="input"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="kunden.webdesign-hammer.de"
                />
                <input
                    className="input"
                    type="number"
                    min={24}
                    max={180}
                    value={logoHeight}
                    onChange={(e) => setLogoHeight(e.target.value)}
                    placeholder="Logo-Höhe (px)"
                />
                <button className="btn btn-primary" type="submit" disabled={saving}>
                    {saving ? 'Speichere...' : 'Speichern'}
                </button>
            </form>

            <div className="vp-provision-box">
                <strong>Kundenportal Logo</strong>
                <p className="text-muted">
                    Reihenfolge im Portal: 1. Tenant-Logo (falls vorhanden), 2. dieses Fallback-Logo.
                </p>
                <div className="vp-logo-row">
                    <div className="vp-logo-preview">
                        {logoLoading ? (
                            <span className="text-muted">Lade Logo...</span>
                        ) : logoUrl ? (
                            <img src={logoUrl} alt="Portal-Logo" />
                        ) : (
                            <span className="text-muted">Kein Fallback-Logo</span>
                        )}
                    </div>
                    <div className="vp-logo-actions">
                        <label className="btn btn-secondary" style={{ cursor: logoUploading ? 'not-allowed' : 'pointer' }}>
                            {logoUploading ? 'Lädt...' : 'Logo hochladen'}
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                                style={{ display: 'none' }}
                                disabled={logoUploading}
                                onChange={(e) => {
                                    void uploadPortalLogo(e.target.files?.[0] || null);
                                    e.currentTarget.value = '';
                                }}
                            />
                        </label>
                        <button className="btn btn-danger" type="button" onClick={removePortalLogo} disabled={logoUploading || !logoUrl}>
                            Logo entfernen
                        </button>
                    </div>
                </div>
            </div>

            <div className="vp-action-row" style={{ marginTop: 'var(--space-sm)' }}>
                <button className="btn btn-secondary" type="button" onClick={runPreflight} disabled={preflighting}>
                    {preflighting ? 'Prüfe Umgebung...' : 'System-Preflight'}
                </button>
                <button className="btn btn-secondary" type="button" onClick={checkProvisionStatus} disabled={checking}>
                    {checking ? 'Prüfe...' : 'DNS/Nginx/SSL prüfen'}
                </button>
                <button className="btn btn-primary" type="button" onClick={runProvisioning} disabled={provisioning}>
                    {provisioning ? 'Richte ein...' : 'Automatisch einrichten'}
                </button>
            </div>

            {status && (
                <div className="vp-provision-box">
                    <strong>Status für {status.host}</strong>
                    <p className="text-muted">Domain verknüpft: {status.domainLinked ? 'ja' : 'nein'}</p>
                    <p className="text-muted">{status.domainLinkedReason}</p>
                    <p className="text-muted">DNS: {status.dns.pointsToServer ? 'zeigt auf Server' : 'zeigt nicht auf Server'}</p>
                    <p className="text-muted">A: {status.dns.resolvedA.join(', ') || '—'}</p>
                    <p className="text-muted">AAAA: {status.dns.resolvedAAAA.join(', ') || '—'}</p>
                    <p className="text-muted">Nginx Config: {status.configExists ? 'vorhanden' : 'fehlt'}</p>
                    <p className="text-muted">Nginx Enabled: {status.enabledExists ? 'aktiv' : 'inaktiv'}</p>
                    <p className="text-muted">SSL: {status.sslCertExists ? 'aktiv' : 'nicht aktiv'}</p>
                    {status.dns.warning && <p className="text-muted">{status.dns.warning}</p>}
                </div>
            )}

            {preflight && (
                <div className="vp-provision-box">
                    <strong>Preflight: {preflight.ok ? 'Bereit' : 'Handlungsbedarf'}</strong>
                    <div className="vp-code-list" style={{ marginTop: 'var(--space-xs)' }}>
                        {preflight.checks.map((step) => (
                            <div key={`pre-${step.key}`} className="vp-code-row">
                                <span className={`badge ${step.ok ? 'badge-success' : 'badge-danger'}`}>
                                    {step.ok ? 'OK' : 'Fehler'}
                                </span>
                                <span>{step.message}</span>
                                {step.details ? <code>{step.details}</code> : null}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {lastProvision && (
                <div className="vp-provision-box">
                    <strong>Letzte Provisionierung: {lastProvision.ok ? 'Erfolgreich' : 'Fehlerhaft'}</strong>
                    <div className="vp-code-list" style={{ marginTop: 'var(--space-xs)' }}>
                        {lastProvision.steps.map((step) => (
                            <div key={step.key} className="vp-code-row">
                                <span className={`badge ${step.ok ? 'badge-success' : 'badge-danger'}`}>
                                    {step.ok ? 'OK' : 'Fehler'}
                                </span>
                                <span>{step.message}</span>
                                {step.details ? <code>{step.details}</code> : null}
                            </div>
                        ))}
                    </div>

                    {failedProvisionStep?.details && (
                        <div style={{ marginTop: 'var(--space-sm)' }}>
                            <strong>Genauer Fehler</strong>
                            <pre style={{ marginTop: 'var(--space-xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {failedProvisionStep.details}
                            </pre>
                        </div>
                    )}

                    {lastProvision.guidance && (
                        <div className="vp-guidance" style={{ marginTop: 'var(--space-sm)' }}>
                            <strong>Automatische Hilfestellung ({lastProvision.guidance.errorCode})</strong>
                            <p>{lastProvision.guidance.title}</p>
                            <p className="text-muted">{lastProvision.guidance.why}</p>
                            <div className="vp-guidance-list">
                                {lastProvision.guidance.nextSteps.map((item, index) => (
                                    <p key={`step-${index}`}><strong>{index + 1}.</strong> {item}</p>
                                ))}
                            </div>
                        </div>
                    )}

                    {lastProvision.manualCommands.length > 0 && (
                        <div style={{ marginTop: 'var(--space-sm)' }}>
                            <p className="text-muted">Terminal-Befehle für diesen Fehlerfall:</p>
                            {lastProvision.manualCommands.map((cmd) => (
                                <div key={cmd} className="vp-command-row">
                                    <code>{cmd}</code>
                                    <button className="btn btn-secondary" type="button" onClick={() => copyCommand(cmd)}>Kopieren</button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <p className="text-muted" style={{ marginTop: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' }}>
                Hinweis: Der Assistent zeigt bei Fehlern jetzt konkrete nächste Schritte und passende Terminal-Befehle an.
            </p>
        </div>
    );
}
