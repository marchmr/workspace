import { useState } from 'react';
import { apiFetch, useAuth } from '../../context/AuthContext';

interface MfaSetupData {
    qrCode: string;
    recoveryCodes: string[];
}

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.json() as { error?: string };
        if (data?.error) return data.error;
    } catch {
        // Antwort war kein JSON.
    }
    return fallback;
}

export default function SecuritySettings() {
    const { user, refreshUser } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [setupData, setSetupData] = useState<MfaSetupData | null>(null);
    const [verifyCode, setVerifyCode] = useState('');
    const [disablePassword, setDisablePassword] = useState('');

    const startMfaSetup = async () => {
        setError('');
        setSuccess('');
        setLoading(true);

        try {
            const res = await apiFetch('/api/auth/mfa/setup', { method: 'POST' });
            if (!res.ok) {
                setError(await getErrorMessage(res, 'MFA-Setup konnte nicht gestartet werden'));
                return;
            }

            const data = await res.json() as MfaSetupData;
            setSetupData(data);
            setSuccess('MFA-Setup gestartet. QR-Code scannen und Code bestätigen.');
        } finally {
            setLoading(false);
        }
    };

    const verifyMfaSetup = async () => {
        if (!verifyCode.trim()) {
            setError('Bitte einen gültigen MFA-Code eingeben.');
            return;
        }

        setError('');
        setSuccess('');
        setLoading(true);

        try {
            const res = await apiFetch('/api/auth/mfa/verify', {
                method: 'POST',
                body: JSON.stringify({ code: verifyCode }),
            });

            if (!res.ok) {
                setError(await getErrorMessage(res, 'MFA-Verifizierung fehlgeschlagen'));
                return;
            }

            await refreshUser();
            setSetupData(null);
            setVerifyCode('');
            setSuccess('MFA wurde erfolgreich aktiviert.');
        } finally {
            setLoading(false);
        }
    };

    const disableMfa = async () => {
        if (!disablePassword) {
            setError('Bitte Passwort eingeben, um MFA zu deaktivieren.');
            return;
        }

        setError('');
        setSuccess('');
        setLoading(true);

        try {
            const res = await apiFetch('/api/auth/mfa/disable', {
                method: 'POST',
                body: JSON.stringify({ password: disablePassword }),
            });

            if (!res.ok) {
                setError(await getErrorMessage(res, 'MFA konnte nicht deaktiviert werden'));
                return;
            }

            await refreshUser();
            setDisablePassword('');
            setSetupData(null);
            setVerifyCode('');
            setSuccess('MFA wurde deaktiviert.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Sicherheit</h1>
                <p className="page-subtitle">Multi-Faktor-Authentifizierung für den eigenen Account</p>
            </div>

            <div className="card mb-md">
                <div className="card-title">MFA-Status</div>
                <p className="mt-md">
                    {user?.mfaEnabled
                        ? <span className="badge badge-success">Aktiv</span>
                        : <span className="badge badge-warning">Nicht aktiv</span>}
                </p>
            </div>

            {error && (
                <div className="card mb-md">
                    <div className="text-danger"><strong>Fehler:</strong> {error}</div>
                </div>
            )}
            {success && (
                <div className="card mb-md">
                    <div className="text-success"><strong>Erfolg:</strong> {success}</div>
                </div>
            )}

            {!user?.mfaEnabled && (
                <div className="card mb-md">
                    <div className="card-title">MFA aktivieren</div>
                    <p className="text-muted mt-md" style={{ fontSize: 'var(--font-size-sm)' }}>
                        Nach dem Start wird ein QR-Code angezeigt. Diesen mit einer Authenticator-App scannen und den 6-stelligen Code bestätigen.
                    </p>
                    <button className="btn btn-primary mt-lg" onClick={startMfaSetup} disabled={loading}>
                        {loading ? 'Starte...' : 'MFA-Setup starten'}
                    </button>
                </div>
            )}

            {setupData && (
                <div className="card mb-md">
                    <div className="card-title">MFA-Einrichtung</div>
                    <div className="mt-md" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)' }}>
                        <div>
                            <strong>QR-Code</strong>
                            <div className="mt-md">
                                <img src={setupData.qrCode} alt="MFA QR-Code" style={{ width: 220, maxWidth: '100%' }} />
                            </div>
                        </div>
                        <div>
                            <strong>Recovery-Codes</strong>
                            <p className="text-muted mt-md" style={{ fontSize: 'var(--font-size-xs)' }}>
                                Diese Codes sicher aufbewahren. Jeder Code ist nur einmal nutzbar.
                            </p>
                            <div className="mt-md" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {setupData.recoveryCodes.map((code) => (
                                    <span key={code} className="badge badge-info">{code}</span>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="mt-lg" style={{ maxWidth: 340 }}>
                        <label className="form-label" htmlFor="verifyCode">Authenticator-Code bestätigen</label>
                        <input
                            id="verifyCode"
                            className="form-input"
                            value={verifyCode}
                            onChange={(e) => setVerifyCode(e.target.value)}
                            placeholder="6-stelliger Code"
                            maxLength={6}
                        />
                        <button className="btn btn-primary mt-md" onClick={verifyMfaSetup} disabled={loading}>
                            {loading ? 'Prüfe...' : 'MFA aktivieren'}
                        </button>
                    </div>
                </div>
            )}

            {user?.mfaEnabled && (
                <div className="card">
                    <div className="card-title">MFA deaktivieren</div>
                    <p className="text-muted mt-md" style={{ fontSize: 'var(--font-size-sm)' }}>
                        Zur Deaktivierung ist das aktuelle Passwort erforderlich.
                    </p>
                    <div className="mt-md" style={{ maxWidth: 340 }}>
                        <label className="form-label" htmlFor="disablePassword">Passwort</label>
                        <input
                            id="disablePassword"
                            className="form-input"
                            type="password"
                            value={disablePassword}
                            onChange={(e) => setDisablePassword(e.target.value)}
                            autoComplete="current-password"
                        />
                        <button className="btn btn-danger mt-md" onClick={disableMfa} disabled={loading}>
                            {loading ? 'Deaktiviere...' : 'MFA deaktivieren'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
