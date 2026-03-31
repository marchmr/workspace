import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';
import '../videoplattform.css';

const SETTING_KEY = 'videoplattform.public_subdomain';

function normalizeHost(value: string): string {
    return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

type ProvisionStep = {
    key: string;
    ok: boolean;
    message: string;
    details?: string;
};

type ProvisionStatus = {
    host: string;
    configFile: string;
    enabledFile: string;
    configExists: boolean;
    enabledExists: boolean;
    sslCertExists: boolean;
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
};

export default function VideoPlatformSettingsPage() {
    const toast = useToast();

    const [host, setHost] = useState('kunden.webdesign-hammer.de');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [checking, setChecking] = useState(false);
    const [provisioning, setProvisioning] = useState(false);
    const [status, setStatus] = useState<ProvisionStatus | null>(null);
    const [lastProvision, setLastProvision] = useState<ProvisionResponse | null>(null);

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
            })
            .catch(() => {
                // ignore
            })
            .finally(() => {
                if (active) setLoading(false);
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

            if (!res.ok) {
                const payload = await res.json().catch(() => ({}));
                throw new Error(payload?.error || 'Einstellung konnte nicht gespeichert werden');
            }

            setHost(normalized);
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
                    publicPath: '/kundenportal-videos',
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
                toast.error('Einrichtung unvollständig. Details siehe Protokoll.');
            }
            await checkProvisionStatus();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Automatische Einrichtung fehlgeschlagen');
        } finally {
            setProvisioning(false);
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
                <button className="btn btn-primary" type="submit" disabled={saving}>
                    {saving ? 'Speichere...' : 'Speichern'}
                </button>
            </form>

            <div className="vp-inline-form" style={{ marginTop: 'var(--space-sm)' }}>
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
                    <p className="text-muted">DNS: {status.dns.pointsToServer ? 'zeigt auf Server' : 'zeigt nicht auf Server'}</p>
                    <p className="text-muted">A: {status.dns.resolvedA.join(', ') || '—'}</p>
                    <p className="text-muted">AAAA: {status.dns.resolvedAAAA.join(', ') || '—'}</p>
                    <p className="text-muted">Nginx Config: {status.configExists ? 'vorhanden' : 'fehlt'}</p>
                    <p className="text-muted">Nginx Enabled: {status.enabledExists ? 'aktiv' : 'inaktiv'}</p>
                    <p className="text-muted">SSL: {status.sslCertExists ? 'aktiv' : 'nicht aktiv'}</p>
                    {status.dns.warning && <p className="text-muted">{status.dns.warning}</p>}
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
                    {lastProvision.manualCommands.length > 0 && (
                        <div style={{ marginTop: 'var(--space-sm)' }}>
                            <p className="text-muted">Manuelle Befehle:</p>
                            {lastProvision.manualCommands.map((cmd) => (
                                <code key={cmd} style={{ display: 'block', marginTop: 4 }}>{cmd}</code>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <p className="text-muted" style={{ marginTop: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' }}>
                Hinweis: DNS und Reverse-Proxy müssen ebenfalls auf diese Subdomain zeigen.
            </p>
        </div>
    );
}
