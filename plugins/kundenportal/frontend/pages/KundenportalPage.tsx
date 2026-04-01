import { FormEvent, useEffect, useMemo, useState, Suspense } from 'react';
import { pluginRegistry } from '../../../../frontend/src/pluginRegistry';
import '../kundenportal.css';

type SessionAccessResponse = {
    sessionToken: string;
    expiresAt: string;
    customerId: number;
    customerName: string | null;
    customerProfile?: {
        displayName?: string | null;
        companyName?: string | null;
        firstName?: string | null;
        lastName?: string | null;
    } | null;
    tenantName: string | null;
    tenantLogoUrl: string | null;
    logoUrl: string | null;
    activePlugins?: string[];
};

const API_BASE = '/api/plugins/kundenportal/public';
const STORAGE_SESSION_KEY = 'kundenportal.session';
const STORAGE_EMAIL_KEY = 'kundenportal.email';

function formatDate(value: string | null | undefined): string {
    if (!value) return '-';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
}

function DynamicNavIcon({ iconHtml }: { iconHtml: string }) {
    if (!iconHtml) {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
        );
    }
    return <span dangerouslySetInnerHTML={{ __html: iconHtml }} />;
}

function LogoutIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M14 8l5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 12h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
}

function HamburgerIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

export default function KundenportalPage() {
    const [access, setAccess] = useState<SessionAccessResponse | null>(null);

    const portalTabs = useMemo(() => 
        pluginRegistry
            .filter((p: any) => !access?.activePlugins || access.activePlugins.includes(p.id))
            .flatMap((p: any) => p.portalTabs || []), 
    [access?.activePlugins]);
    
    const [activeTab, setActiveTab] = useState<string>(portalTabs[0]?.id || '');
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [email, setEmail] = useState(localStorage.getItem(STORAGE_EMAIL_KEY) || '');
    const [code, setCode] = useState('');
    const [codeRequested, setCodeRequested] = useState(false);
    const [expectedHost, setExpectedHost] = useState('');
    const [portalBrand, setPortalBrand] = useState('Kundenportal');
    const [portalLogoUrl, setPortalLogoUrl] = useState<string | null>(null);
    const [tenantLogoUrl, setTenantLogoUrl] = useState<string | null>(null);
    const [portalLogoHeight, setPortalLogoHeight] = useState(52);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (portalTabs.length > 0 && (!activeTab || !portalTabs.find(t => t.id === activeTab))) {
            setActiveTab(portalTabs[0].id);
        }
    }, [activeTab, portalTabs]);

    useEffect(() => {
        let active = true;
        const existingSession = localStorage.getItem(STORAGE_SESSION_KEY) || '';

        fetch(`${API_BASE}/config`)
            .then((res) => res.json())
            .then(async (data) => {
                if (!active) return;
                if (typeof data.expectedHost === 'string') setExpectedHost(data.expectedHost);
                if (typeof data.brand === 'string' && data.brand) setPortalBrand(data.brand);
                if (typeof data.tenantLogoUrl === 'string' && data.tenantLogoUrl) setTenantLogoUrl(`${data.tenantLogoUrl}${data.tenantLogoUrl.includes('?') ? '&' : '?'}v=${Date.now()}`);
                if (typeof data.logoUrl === 'string' && data.logoUrl) setPortalLogoUrl(`${data.logoUrl}${data.logoUrl.includes('?') ? '&' : '?'}v=${Date.now()}`);
                const logoHeight = Number(data?.logoHeight);
                if (Number.isFinite(logoHeight)) setPortalLogoHeight(Math.max(24, Math.min(180, Math.round(logoHeight))));

                if (existingSession) {
                    const restoreRes = await fetch(`${API_BASE}/access/by-session?sessionToken=${encodeURIComponent(existingSession)}`);
                    const payload = await restoreRes.json().catch(() => ({}));
                    if (restoreRes.ok) {
                        setAccess(payload as SessionAccessResponse);
                        const tenantLogo = typeof payload?.tenantLogoUrl === 'string' ? payload.tenantLogoUrl : '';
                        const customLogo = typeof payload?.logoUrl === 'string' ? payload.logoUrl : '';
                        
                        if (tenantLogo) setTenantLogoUrl(`${tenantLogo}${tenantLogo.includes('?') ? '&' : '?'}v=${Date.now()}`);
                        else if (customLogo) setTenantLogoUrl(`${customLogo}${customLogo.includes('?') ? '&' : '?'}v=${Date.now()}`);

                        if (customLogo) setPortalLogoUrl(`${customLogo}${customLogo.includes('?') ? '&' : '?'}v=${Date.now()}`);
                        else if (tenantLogo) setPortalLogoUrl(`${tenantLogo}${tenantLogo.includes('?') ? '&' : '?'}v=${Date.now()}`);
                    } else {
                        localStorage.removeItem(STORAGE_SESSION_KEY);
                    }
                }
            })
            .catch(() => undefined);

        return () => {
            active = false;
        };
    }, []);

    const customerHeader = useMemo(() => {
        if (!access) return { displayName: 'Ihre Firma', companyName: null as string | null, contactName: null as string | null };

        const profile = access.customerProfile || {};
        const companyName = String(profile.companyName || '').trim() || null;
        const firstName = String(profile.firstName || '').trim();
        const lastName = String(profile.lastName || '').trim();
        const contactName = `${firstName} ${lastName}`.trim() || null;
        const displayName = String(profile.displayName || access.customerName || companyName || contactName || 'Ihre Firma').trim();
        const companySameAsDisplay = !!companyName
            && companyName.localeCompare(displayName, 'de', { sensitivity: 'base' }) === 0;

        return {
            displayName,
            companyName: companySameAsDisplay ? null : companyName,
            contactName,
        };
    }, [access]);

    useEffect(() => {
        const originalTitle = document.title;
        const originalHref = (document.querySelector('link[rel="icon"]') as HTMLLinkElement)?.href;
        
        const currentTenantName = access?.tenantName || portalBrand || 'Kundenportal';
        document.title = `Kundenportal - ${currentTenantName}`;
        
        let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
        }
        const faviconUrl = tenantLogoUrl || portalLogoUrl || '/favicon.ico';
        link.href = faviconUrl;

        if (!mobileNavOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.title = originalTitle;
            if (originalHref) link.href = originalHref;
            document.body.style.overflow = previousOverflow;
        };
    }, [mobileNavOpen, access?.tenantName, portalBrand, portalLogoUrl, tenantLogoUrl]);

    async function requestCode(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail || !normalizedEmail.includes('@')) return;

        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/auth/request-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: normalizedEmail }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Code konnte nicht versendet werden.');
            localStorage.setItem(STORAGE_EMAIL_KEY, normalizedEmail);
            setEmail(normalizedEmail);
            setCodeRequested(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Code konnte nicht versendet werden.');
        } finally {
            setLoading(false);
        }
    }

    async function verifyCode(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const normalizedEmail = email.trim().toLowerCase();
        const normalizedCode = code.trim();
        if (!normalizedEmail || !normalizedCode) return;

        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/auth/verify-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: normalizedEmail, code: normalizedCode }),
            });

            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Code ungültig oder abgelaufen.');

            const sessionPayload = payload as SessionAccessResponse;
            localStorage.setItem(STORAGE_SESSION_KEY, sessionPayload.sessionToken);
            localStorage.setItem(STORAGE_EMAIL_KEY, normalizedEmail);
            setAccess(sessionPayload);

            const tenantLogo = typeof payload?.tenantLogoUrl === 'string' ? payload.tenantLogoUrl : '';
            const customLogo = typeof payload?.logoUrl === 'string' ? payload.logoUrl : '';
            
            if (tenantLogo) setTenantLogoUrl(`${tenantLogo}${tenantLogo.includes('?') ? '&' : '?'}v=${Date.now()}`);
            else if (customLogo) setTenantLogoUrl(`${customLogo}${customLogo.includes('?') ? '&' : '?'}v=${Date.now()}`);

            if (customLogo) setPortalLogoUrl(`${customLogo}${customLogo.includes('?') ? '&' : '?'}v=${Date.now()}`);
            else if (tenantLogo) setPortalLogoUrl(`${tenantLogo}${tenantLogo.includes('?') ? '&' : '?'}v=${Date.now()}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Code ungültig oder abgelaufen.');
            setAccess(null);
        } finally {
            setLoading(false);
        }
    }

    async function resetAccess() {
        const token = localStorage.getItem(STORAGE_SESSION_KEY) || '';
        localStorage.removeItem(STORAGE_SESSION_KEY);
        if (token) {
            await fetch(`${API_BASE}/auth/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionToken: token }),
            }).catch(() => undefined);
        }
        setAccess(null);
        setCode('');
        setCodeRequested(false);
        setError(null);
        setActiveTab(portalTabs[0]?.id || '');
        setMobileNavOpen(false);
    }

    const activeTabConfig = portalTabs.find(t => t.id === activeTab);
    const ActiveComponent = activeTabConfig?.component;

    return (
        <div className="vp-public-page kp-page">
            <div className={`vp-public-shell${access ? '' : ' vp-public-shell-login'}`}>
                {!access ? (
                    <section className="card vp-access-card">
                        <div className="vp-access-head">
                            <div className="vp-portal-brand">
                                {portalLogoUrl ? (
                                    <img src={portalLogoUrl} alt={`${portalBrand} Logo`} style={{ maxHeight: `${portalLogoHeight}px` }} />
                                ) : (
                                    <div className="vp-portal-brand-fallback">{portalBrand}</div>
                                )}
                            </div>
                        </div>

                        <p className="vp-login-kicker">Kundenportal</p>
                        <h1 className="page-title vp-access-title">Login - {portalBrand}</h1>
                        <p className="text-muted vp-access-subtitle">
                            Melden Sie sich mit Ihrer E-Mail an. Wir senden Ihnen einen Code per Mail.
                        </p>

                        {expectedHost && expectedHost !== window.location.hostname && (
                            <div className="vp-warning">
                                Dieses Portal ist nur über <strong>{expectedHost}</strong> erreichbar.
                            </div>
                        )}

                        {!codeRequested ? (
                            <form onSubmit={requestCode} className="vp-stack vp-access-form">
                                <label className="vp-label" htmlFor="kp-email-input">E-Mail</label>
                                <input id="kp-email-input" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@firma.de" required />
                                <button className="btn btn-primary vp-access-submit" type="submit" disabled={loading}>{loading ? 'Sende Code...' : 'Code anfordern'}</button>
                            </form>
                        ) : (
                            <form onSubmit={verifyCode} className="vp-stack vp-access-form">
                                <label className="vp-label" htmlFor="kp-code-input">6-stelliger Code</label>
                                <input id="kp-code-input" className="input vp-input-center vp-code-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" required />
                                <button className="btn btn-primary vp-access-submit" type="submit" disabled={loading}>{loading ? 'Prüfe Code...' : 'Anmelden'}</button>
                                <button className="btn btn-secondary" type="button" onClick={() => { setCodeRequested(false); setCode(''); setError(null); }}>E-Mail ändern</button>
                            </form>
                        )}

                        {error && <p className="text-danger vp-access-error">{error}</p>}
                    </section>
                ) : (
                    <section className={`kp-portal ${mobileNavOpen ? 'is-mobile-nav-open' : ''}`}>
                        <div className="kp-mobile-topbar card">
                            <button
                                className="btn btn-secondary kp-menu-btn"
                                type="button"
                                aria-expanded={mobileNavOpen}
                                aria-controls="kp-mobile-drawer"
                                onClick={() => setMobileNavOpen((prev) => !prev)}
                            >
                                <span className="kp-menu-icon"><HamburgerIcon /></span>
                                <span>{mobileNavOpen ? 'Schließen' : 'Menü'}</span>
                            </button>
                            <div className="kp-mobile-brand">
                                <strong>{portalBrand}</strong>
                                <span className="text-muted">Kundenportal</span>
                            </div>
                        </div>
                        <button
                            className={`kp-drawer-backdrop ${mobileNavOpen ? 'is-visible' : ''}`}
                            type="button"
                            aria-label="Menü schließen"
                            onClick={() => setMobileNavOpen(false)}
                        />

                        <div className={`kp-portal-layout ${mobileNavOpen ? 'kp-nav-open' : ''}`}>
                            <aside id="kp-mobile-drawer" className="kp-sidebar card">
                                <div className="kp-sidebar-brand">
                                    {portalLogoUrl ? (
                                        <img src={portalLogoUrl} alt={`${portalBrand} Logo`} style={{ maxHeight: `${portalLogoHeight}px` }} />
                                    ) : (
                                        <div className="kp-sidebar-brand-fallback">{portalBrand}</div>
                                    )}
                                </div>

                                <div className="kp-sidebar-customer">
                                    <p className="kp-sidebar-name">{customerHeader.displayName}</p>
                                    {customerHeader.companyName && <p className="text-muted">Firma: {customerHeader.companyName}</p>}
                                    {customerHeader.contactName && <p className="text-muted">Ansprechpartner: {customerHeader.contactName}</p>}
                                </div>

                                <nav className="kp-nav">
                                    {portalTabs.length > 0 && (
                                        <p className="kp-nav-section">Module</p>
                                    )}
                                    {portalTabs.map((tab) => (
                                        <button
                                            key={tab.id}
                                            className={`btn kp-nav-btn ${activeTab === tab.id ? 'btn-primary is-active' : 'btn-secondary'}`}
                                            type="button"
                                            onClick={() => { setActiveTab(tab.id); setMobileNavOpen(false); }}
                                        >
                                            <span className="kp-nav-icon"><DynamicNavIcon iconHtml={tab.icon || ''} /></span>
                                            {tab.label}
                                        </button>
                                    ))}

                                    <p className="kp-nav-section" style={{ marginTop: 'auto' }}>Konto</p>
                                    <button
                                        className="btn kp-nav-btn kp-nav-btn-logout btn-secondary"
                                        type="button"
                                        onClick={resetAccess}
                                    >
                                        <span className="kp-nav-icon"><LogoutIcon /></span>
                                        Abmelden
                                    </button>
                                </nav>
                                <div className="kp-sidebar-meta">
                                    <p className="text-muted" style={{ margin: 0 }}>Freigeschaltet bis: {formatDate(access.expiresAt)}</p>
                                </div>
                            </aside>

                            <main className="kp-main card">
                                <header className="kp-main-header">
                                    <div>
                                        <h1 className="page-title">{activeTabConfig?.label || 'Kundenportal'}</h1>
                                    </div>
                                </header>

                                {ActiveComponent ? (
                                    <Suspense fallback={<div style={{ padding: 20 }}>Lade Modul...</div>}>
                                        <ActiveComponent sessionToken={access.sessionToken} formatDate={formatDate} />
                                    </Suspense>
                                ) : (
                                    <div style={{ padding: 20 }} className="text-muted">
                                        Willkommen im Kundenportal. Wählen Sie einen Bereich aus dem Menü.
                                    </div>
                                )}
                            </main>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
