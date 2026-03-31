import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

type LoginStep = 'credentials' | 'mfa';

export function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [mfaCode, setMfaCode] = useState('');
    const [step, setStep] = useState<LoginStep>('credentials');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await login(
                username,
                password,
                step === 'mfa' ? { mfaCode } : undefined
            );

            if (result.mfaRequired) {
                setStep('mfa');
                setLoading(false);
                return;
            }

            navigate('/');
        } catch (err: any) {
            setError(err.message || 'Login fehlgeschlagen');
        } finally {
            setLoading(false);
        }
    };

    const lockIcon = (
        <svg className="login-input-icon" viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
        </svg>
    );

    const userIcon = (
        <svg className="login-input-icon" viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
        </svg>
    );

    const shieldIcon = (
        <svg className="login-input-icon" viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
    );

    const eyeIcon = (
        <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
            {showPassword ? (
                <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
            ) : (
                <>
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                </>
            )}
        </svg>
    );

    return (
        <div className="login-page">
            {/* ── Centered Split Card ── */}
            <div className="login-split-card">
                {/* Left: Hero / Welcome */}
                <div className="login-split-hero">
                    <img
                        src="/login-hero.png?v=3"
                        alt="MIKE WorkSpace"
                        className="login-hero-img"
                    />
                    <div className="login-hero-text">
                        <h1>Willkommen</h1>
                        <p>Ihr zentraler Arbeitsbereich für alle Geschäftsprozesse</p>
                    </div>
                    <button
                        className="login-changelog-link"
                        onClick={() => navigate('/releases')}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="10" />
                        </svg>
                        Changelog
                    </button>
                </div>

                {/* Right: Login Form */}
                <div className="login-split-form">
                    <div className="login-header">
                        <h1 className="login-title">
                            {step === 'mfa' ? 'Zwei-Faktor-Authentifizierung' : 'Anmelden'}
                        </h1>
                        <p className="login-subtitle">
                            {step === 'mfa' ? 'Code eingeben um fortzufahren' : 'Zugangsdaten eingeben'}
                        </p>
                    </div>

                    {error && (
                        <div className="login-error">
                            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" style={{ flexShrink: 0 }}>
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            <span>{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit}>
                        {step === 'credentials' ? (
                            <>
                                <div className="login-field">
                                    {userIcon}
                                    <input
                                        id="username"
                                        type="text"
                                        className="login-input"
                                        placeholder="Benutzername"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        autoComplete="username"
                                        autoFocus
                                        required
                                    />
                                </div>
                                <div className="login-field">
                                    {lockIcon}
                                    <input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        className="login-input"
                                        placeholder="Passwort"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        autoComplete="current-password"
                                        required
                                    />
                                    <button
                                        type="button"
                                        className="login-eye-btn"
                                        onClick={() => setShowPassword(!showPassword)}
                                        tabIndex={-1}
                                        aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                                    >
                                        {eyeIcon}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="login-field">
                                {shieldIcon}
                                <input
                                    id="mfaCode"
                                    type="text"
                                    className="login-input"
                                    placeholder="6-stelliger Code"
                                    value={mfaCode}
                                    onChange={(e) => setMfaCode(e.target.value.toUpperCase())}
                                    autoFocus
                                    required
                                />
                            </div>
                        )}

                        {step === 'mfa' && (
                            <p className="login-mfa-hint">
                                Authenticator-Code oder 8-stelliger Recovery-Code eingeben
                            </p>
                        )}

                        <button
                            type="submit"
                            className="login-btn"
                            disabled={loading}
                        >
                            {loading ? <span className="login-spinner" /> : null}
                            {loading ? 'Wird geprüft...' : step === 'credentials' ? 'Anmelden' : 'Verifizieren'}
                        </button>

                        {step === 'mfa' && (
                            <button
                                type="button"
                                className="login-back-btn"
                                onClick={() => { setStep('credentials'); setMfaCode(''); setError(''); }}
                            >
                                Zurück zur Anmeldung
                            </button>
                        )}
                    </form>

                    <div className="login-footer">
                        MIKE WorkSpace
                    </div>
                </div>
            </div>
        </div>
    );
}
