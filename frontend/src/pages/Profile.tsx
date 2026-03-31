import { useEffect, useMemo, useState, useRef } from 'react';
import { apiFetch, useAuth } from '../context/AuthContext';

interface ProfileData {
    id: number;
    username: string;
    displayName?: string | null;
    email: string;
    roles?: string[];
    mfaEnabled?: boolean;
    avatarUrl?: string | null;
    avatarUpdatedAt?: string | null;
    createdAt?: string | null;
}

interface MfaSetupData {
    qrCode: string;
    secret: string;
    recoveryCodes: string[];
}

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.json() as { error?: string };
        if (data?.error) return data.error;
    } catch {
        // no-op
    }
    return fallback;
}

export default function Profile() {
    const { user, refreshUser } = useAuth();
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [loadingProfile, setLoadingProfile] = useState(true);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [mfaModalOpen, setMfaModalOpen] = useState(false);

    const loadProfile = async () => {
        setLoadingProfile(true);
        try {
            const res = await apiFetch('/api/auth/profile');
            if (!res.ok) {
                setError(await getErrorMessage(res, 'Profil konnte nicht geladen werden'));
                return;
            }
            const data = await res.json() as ProfileData;
            setProfile(data);
        } finally {
            setLoadingProfile(false);
        }
    };

    useEffect(() => { void loadProfile(); }, []);

    const avatarSrc = useMemo(() => {
        if (!profile?.avatarUrl) return null;
        if (!profile.avatarUpdatedAt) return profile.avatarUrl;
        return `${profile.avatarUrl}${profile.avatarUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(profile.avatarUpdatedAt)}`;
    }, [profile]);

    const uploadAvatar = async () => {
        if (!selectedFile) return;
        setError('');
        setSuccess('');
        setUploadingAvatar(true);
        try {
            const form = new FormData();
            form.append('avatar', selectedFile);
            const res = await apiFetch('/api/auth/avatar', { method: 'POST', body: form });
            if (!res.ok) {
                setError(await getErrorMessage(res, 'Avatar konnte nicht hochgeladen werden'));
                return;
            }
            await refreshUser();
            await loadProfile();
            setSelectedFile(null);
            setSuccess('Avatar wurde aktualisiert.');
        } finally {
            setUploadingAvatar(false);
        }
    };

    const displayName = profile?.displayName || profile?.username || user?.username || 'Benutzer';
    const initials = displayName.charAt(0).toUpperCase();

    const handleMfaClose = () => {
        setMfaModalOpen(false);
        void loadProfile();
        void refreshUser();
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Profil</h1>
                <p className="page-subtitle">Eigene Profilinformationen und Sicherheit</p>
            </div>

            {(error || success) && (
                <div className="card mb-md">
                    {error && <div className="text-danger"><strong>Fehler:</strong> {error}</div>}
                    {!error && success && <div className="text-success"><strong>Erfolg:</strong> {success}</div>}
                </div>
            )}

            <div className="card mb-md">
                <div className="card-title">Avatar</div>
                <div className="mt-md" style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="profile-avatar">
                        {avatarSrc ? (
                            <img src={avatarSrc} alt="Profilbild" className="profile-avatar-image" />
                        ) : (
                            <span>{initials}</span>
                        )}
                    </div>
                    <div style={{ minWidth: 280 }}>
                        <input
                            type="file"
                            className="form-input"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                        />
                        <button className="btn btn-primary mt-md" onClick={uploadAvatar} disabled={!selectedFile || uploadingAvatar}>
                            {uploadingAvatar ? 'Lade hoch...' : 'Avatar hochladen'}
                        </button>
                        <p className="text-muted mt-md" style={{ fontSize: 'var(--font-size-xs)' }}>
                            Erlaubt: JPG, PNG, WEBP, GIF bis 5 MB.
                        </p>
                    </div>
                </div>
            </div>

            <div className="card mb-md">
                <div className="card-title">Profilinformationen</div>
                {loadingProfile ? (
                    <p className="text-muted mt-md">Lade Profil...</p>
                ) : (
                    <div className="mt-md" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-md)' }}>
                        <div>
                            <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>Benutzername</div>
                            <strong>{profile?.username || '-'}</strong>
                        </div>
                        <div>
                            <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>E-Mail</div>
                            <strong>{profile?.email || '-'}</strong>
                        </div>
                        <div>
                            <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>Rollen</div>
                            <strong>{profile?.roles?.length ? profile.roles.join(', ') : '-'}</strong>
                        </div>
                    </div>
                )}
            </div>

            <PasswordChangeCard />

            {/* MFA Card – nur Button */}
            <div className="card mb-md">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <div className="card-title" style={{ marginBottom: 4 }}>Multi-Faktor-Authentifizierung</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                            {profile?.mfaEnabled
                                ? <span className="badge badge-success">Aktiv</span>
                                : <span className="badge badge-warning">Nicht aktiv</span>}
                            <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                                {profile?.mfaEnabled
                                    ? 'Dein Account ist mit einem Authenticator geschützt.'
                                    : 'Erhöhe die Sicherheit deines Accounts mit MFA.'}
                            </span>
                        </div>
                    </div>
                    <button className="btn btn-primary" onClick={() => setMfaModalOpen(true)}>
                        MFA verwalten
                    </button>
                </div>
            </div>

            {mfaModalOpen && (
                <MfaModal
                    mfaEnabled={profile?.mfaEnabled || false}
                    onClose={handleMfaClose}
                />
            )}
        </div>
    );
}

/* ────────────────────────────────────────────────────────
   MFA Modal – Step-by-Step Wizard
   ──────────────────────────────────────────────────────── */

type MfaStep = 'start' | 'scan' | 'verify' | 'done' | 'disable';

function MfaModal({ mfaEnabled, onClose }: { mfaEnabled: boolean; onClose: () => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [step, setStep] = useState<MfaStep>(mfaEnabled ? 'disable' : 'start');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [setupData, setSetupData] = useState<MfaSetupData | null>(null);
    const [verifyCode, setVerifyCode] = useState('');
    const [secretCopied, setSecretCopied] = useState(false);
    const [disablePassword, setDisablePassword] = useState('');

    useEffect(() => {
        dialogRef.current?.showModal();
    }, []);

    const close = () => {
        dialogRef.current?.close();
        onClose();
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === dialogRef.current) close();
    };

    const startSetup = async () => {
        setError('');
        setLoading(true);
        try {
            const res = await apiFetch('/api/auth/mfa/setup', { method: 'POST' });
            if (!res.ok) {
                setError(await getErr(res, 'MFA-Setup konnte nicht gestartet werden'));
                return;
            }
            const data = await res.json() as MfaSetupData;
            setSetupData(data);
            setStep('scan');
        } finally {
            setLoading(false);
        }
    };

    const verifySetup = async () => {
        if (!verifyCode.trim() || verifyCode.length < 6) {
            setError('Bitte einen gültigen 6-stelligen Code eingeben.');
            return;
        }
        setError('');
        setLoading(true);
        try {
            const res = await apiFetch('/api/auth/mfa/verify', {
                method: 'POST',
                body: JSON.stringify({ code: verifyCode }),
            });
            if (!res.ok) {
                setError(await getErr(res, 'Code ungültig. Bitte erneut versuchen.'));
                return;
            }
            setStep('done');
        } finally {
            setLoading(false);
        }
    };

    const disableMfa = async () => {
        if (!disablePassword) {
            setError('Bitte Passwort eingeben.');
            return;
        }
        setError('');
        setLoading(true);
        try {
            const res = await apiFetch('/api/auth/mfa/disable', {
                method: 'POST',
                body: JSON.stringify({ password: disablePassword }),
            });
            if (!res.ok) {
                setError(await getErr(res, 'Passwort ungültig.'));
                return;
            }
            close();
        } finally {
            setLoading(false);
        }
    };

    const downloadBackupPdf = () => {
        if (!setupData?.recoveryCodes) return;
        const codes = setupData.recoveryCodes;
        const now = new Date().toLocaleString('de-DE');

        // Build PDF-style HTML and print to PDF
        const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>MFA Recovery Codes</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', sans-serif; padding: 60px; color: #1a1a2e; background: #fff; }
  .header { text-align: center; margin-bottom: 40px; padding-bottom: 24px; border-bottom: 2px solid #e2e8f0; }
  .header h1 { font-size: 24px; color: #1a1a2e; margin-bottom: 8px; }
  .header p { color: #64748b; font-size: 14px; }
  .shield { font-size: 48px; margin-bottom: 16px; }
  .warning { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin-bottom: 32px; font-size: 13px; color: #92400e; }
  .warning strong { display: block; margin-bottom: 4px; }
  .codes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 32px; }
  .code { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; text-align: center; font-family: 'Courier New', monospace; font-size: 16px; font-weight: 600; letter-spacing: 2px; color: #1e293b; }
  .footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 40px; padding-top: 24px; border-top: 1px solid #e2e8f0; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 24px; font-size: 12px; color: #64748b; }
</style>
</head>
<body>
  <div class="header">
    <div class="shield">🛡️</div>
    <h1>MFA Recovery Codes</h1>
    <p>MIKE WorkSpace – Backup-Codes für Zwei-Faktor-Authentifizierung</p>
  </div>
  <div class="meta">
    <span>Erstellt am: ${now}</span>
    <span>Anzahl Codes: ${codes.length}</span>
  </div>
  <div class="warning">
    <strong>⚠ Wichtig – Sicher aufbewahren!</strong>
    Diese Codes können jeweils nur einmal verwendet werden, um sich anzumelden, falls der Authenticator nicht verfügbar ist.
    Bewahre dieses Dokument an einem sicheren Ort auf (z.B. Tresor oder Passwortmanager).
  </div>
  <div class="codes">
    ${codes.map((c) => `<div class="code">${c}</div>`).join('\n    ')}
  </div>
  <div class="footer">
    <p>MIKE WorkSpace &middot; Dieses Dokument ist vertraulich.</p>
    <p style="margin-top: 4px;">Nach Verwendung eines Codes wird dieser automatisch ungültig.</p>
  </div>
</body>
</html>`;

        const printWindow = window.open('', '_blank');
        if (!printWindow) return;
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => {
            printWindow.print();
        }, 400);
    };

    const overlayStyle: React.CSSProperties = {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        border: 'none', padding: 0, width: '100vw', height: '100vh', maxWidth: '100vw', maxHeight: '100vh',
    };

    const modalStyle: React.CSSProperties = {
        background: 'var(--color-bg-primary, #fff)', borderRadius: 12, padding: '32px',
        width: '100%', maxWidth: step === 'scan' ? 580 : 460,
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)', position: 'relative',
        maxHeight: '90vh', overflowY: 'auto',
    };

    const stepIndicator = (current: number, total: number) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 24 }}>
            {Array.from({ length: total }, (_, i) => (
                <div key={i} style={{
                    width: i <= current ? 32 : 24, height: 4, borderRadius: 2,
                    background: i <= current ? 'var(--color-primary, #3b82f6)' : 'var(--color-border, #e2e8f0)',
                    transition: 'all 0.3s ease',
                }} />
            ))}
        </div>
    );

    return (
        <dialog ref={dialogRef} style={overlayStyle} onClick={handleBackdropClick}>
            <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
                {/* Close button */}
                <button onClick={close} style={{
                    position: 'absolute', top: 12, right: 16, background: 'none', border: 'none',
                    fontSize: 20, cursor: 'pointer', color: 'var(--color-text-secondary)', padding: 4,
                }}>✕</button>

                {/* ── Step: Start ── */}
                {step === 'start' && (
                    <div style={{ textAlign: 'center' }}>
                        {stepIndicator(0, 3)}
                        <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
                        <h2 style={{ marginBottom: 8 }}>MFA einrichten</h2>
                        <p className="text-muted" style={{ marginBottom: 24, fontSize: '0.9rem' }}>
                            Schütze deinen Account mit einem Authenticator (z.B. Google Authenticator, Authy).
                        </p>
                        {error && <div className="text-danger mb-md" style={{ fontSize: '0.85rem' }}>{error}</div>}
                        <button className="btn btn-primary" onClick={startSetup} disabled={loading} style={{ minWidth: 200 }}>
                            {loading ? 'Starte Setup...' : 'Setup starten'}
                        </button>
                    </div>
                )}

                {/* ── Step: Scan QR ── */}
                {step === 'scan' && setupData && (
                    <div>
                        {stepIndicator(1, 3)}
                        <h2 style={{ textAlign: 'center', marginBottom: 4 }}>QR-Code scannen</h2>
                        <p className="text-muted" style={{ textAlign: 'center', marginBottom: 20, fontSize: '0.85rem' }}>
                            Scanne den QR-Code mit deiner Authenticator-App.
                        </p>
                        <div style={{ textAlign: 'center', marginBottom: 16 }}>
                            <div style={{
                                display: 'inline-block', padding: 16, background: '#fff',
                                borderRadius: 12, border: '1px solid var(--color-border)',
                            }}>
                                <img src={setupData.qrCode} alt="MFA QR-Code" style={{ width: 200, height: 200 }} />
                            </div>
                        </div>

                        {/* Secret zum Kopieren */}
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 8, marginBottom: 20,
                        }}>
                            <span className="text-muted" style={{ fontSize: '0.8rem' }}>Secret:</span>
                            <code style={{
                                fontSize: '0.8rem', padding: '4px 8px',
                                background: 'var(--color-bg-secondary)', borderRadius: 4,
                                border: '1px solid var(--color-border)', letterSpacing: '0.1em',
                                userSelect: 'all',
                            }}>
                                {setupData.secret}
                            </code>
                            <button
                                className="btn btn-ghost btn-sm"
                                style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                                onClick={() => {
                                    void navigator.clipboard.writeText(setupData.secret);
                                    setSecretCopied(true);
                                    setTimeout(() => setSecretCopied(false), 2000);
                                }}
                            >
                                {secretCopied ? '✓ Kopiert' : '📋 Kopieren'}
                            </button>
                        </div>

                        {error && <div className="text-danger mb-md" style={{ fontSize: '0.85rem' }}>{error}</div>}

                        <label className="form-label" style={{ fontWeight: 600 }}>Authenticator-Code bestätigen</label>
                        <input
                            className="form-input"
                            value={verifyCode}
                            onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            maxLength={6}
                            autoFocus
                            style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.3em', fontWeight: 600 }}
                            onKeyDown={(e) => { if (e.key === 'Enter') void verifySetup(); }}
                        />
                        <button
                            className="btn btn-primary mt-md"
                            onClick={verifySetup}
                            disabled={loading || verifyCode.length < 6}
                            style={{ width: '100%' }}
                        >
                            {loading ? 'Prüfe...' : 'Code bestätigen & MFA aktivieren'}
                        </button>
                    </div>
                )}

                {/* ── Step: Done – Show Recovery Codes ── */}
                {step === 'done' && setupData && (
                    <div>
                        {stepIndicator(2, 3)}
                        <div style={{ textAlign: 'center', marginBottom: 16 }}>
                            <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
                            <h2 style={{ marginBottom: 4 }}>MFA aktiviert!</h2>
                            <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                                Dein Account ist jetzt mit Zwei-Faktor-Authentifizierung geschützt.
                            </p>
                        </div>

                        <div style={{
                            background: 'var(--color-bg-secondary, #f8fafc)', borderRadius: 8,
                            padding: 16, marginBottom: 16, border: '1px solid var(--color-border)',
                        }}>
                            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.9rem' }}>
                                🔑 Recovery-Codes
                            </div>
                            <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 12 }}>
                                Bewahre diese Codes sicher auf. Jeder Code kann nur einmal verwendet werden.
                            </p>
                            <div style={{
                                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                                gap: 8,
                            }}>
                                {setupData.recoveryCodes.map((code) => (
                                    <div key={code} style={{
                                        background: 'var(--color-bg-primary, #fff)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 6, padding: '8px 4px', textAlign: 'center',
                                        fontFamily: 'monospace', fontWeight: 600, fontSize: '0.85rem',
                                        letterSpacing: '0.1em',
                                    }}>
                                        {code}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-primary" onClick={downloadBackupPdf} style={{ flex: 1 }}>
                                📄 Codes als PDF speichern
                            </button>
                            <button className="btn btn-ghost" onClick={close} style={{ flex: 1 }}>
                                Fertig
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Step: Disable ── */}
                {step === 'disable' && (
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>🔓</div>
                        <h2 style={{ marginBottom: 8 }}>MFA deaktivieren</h2>
                        <p className="text-muted" style={{ marginBottom: 24, fontSize: '0.9rem' }}>
                            Bestätige mit deinem Passwort, um MFA zu deaktivieren.
                        </p>
                        {error && <div className="text-danger mb-md" style={{ fontSize: '0.85rem' }}>{error}</div>}
                        <input
                            className="form-input"
                            type="password"
                            value={disablePassword}
                            onChange={(e) => setDisablePassword(e.target.value)}
                            placeholder="Passwort eingeben"
                            autoComplete="current-password"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter') void disableMfa(); }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                            <button className="btn btn-danger" onClick={disableMfa} disabled={loading} style={{ flex: 1 }}>
                                {loading ? 'Deaktiviere...' : 'MFA deaktivieren'}
                            </button>
                            <button className="btn btn-ghost" onClick={close} style={{ flex: 1 }}>
                                Abbrechen
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </dialog>
    );
}

function PasswordChangeCard() {
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleSubmit = async () => {
        setError('');
        setSuccess('');

        if (!currentPw || !newPw || !confirmPw) {
            setError('Alle Felder müssen ausgefüllt werden.');
            return;
        }
        if (newPw !== confirmPw) {
            setError('Neues Passwort und Bestätigung stimmen nicht überein.');
            return;
        }

        setLoading(true);
        try {
            const res = await apiFetch('/api/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
            });
            if (!res.ok) {
                const data = await res.json() as { error?: string };
                setError(data?.error || 'Passwort konnte nicht geändert werden.');
                return;
            }
            setSuccess('Passwort wurde erfolgreich geändert.');
            setCurrentPw('');
            setNewPw('');
            setConfirmPw('');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="card mb-md">
            <div className="card-title">Passwort ändern</div>
            <div className="mt-md" style={{ maxWidth: 400 }}>
                {error && <div className="text-danger mb-md" style={{ fontSize: '0.85rem' }}>{error}</div>}
                {success && <div className="text-success mb-md" style={{ fontSize: '0.85rem' }}>{success}</div>}

                <div className="mb-md">
                    <label className="form-label" htmlFor="pw-current">Aktuelles Passwort</label>
                    <input
                        id="pw-current"
                        className="form-input"
                        type="password"
                        value={currentPw}
                        onChange={(e) => setCurrentPw(e.target.value)}
                        autoComplete="current-password"
                    />
                </div>
                <div className="mb-md">
                    <label className="form-label" htmlFor="pw-new">Neues Passwort</label>
                    <input
                        id="pw-new"
                        className="form-input"
                        type="password"
                        value={newPw}
                        onChange={(e) => setNewPw(e.target.value)}
                        autoComplete="new-password"
                    />
                    <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                        Mind. 10 Zeichen, Groß-/Kleinbuchstaben, Zahl und Sonderzeichen
                    </p>
                </div>
                <div className="mb-md">
                    <label className="form-label" htmlFor="pw-confirm">Neues Passwort bestätigen</label>
                    <input
                        id="pw-confirm"
                        className="form-input"
                        type="password"
                        value={confirmPw}
                        onChange={(e) => setConfirmPw(e.target.value)}
                        autoComplete="new-password"
                        onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
                    />
                </div>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
                    {loading ? 'Speichere...' : 'Passwort ändern'}
                </button>
            </div>
        </div>
    );
}

async function getErr(res: Response, fallback: string): Promise<string> {
    try {
        const d = await res.json() as { error?: string };
        if (d?.error) return d.error;
    } catch { /* */ }
    return fallback;
}
