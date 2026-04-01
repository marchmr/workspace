import { FormEvent, useEffect, useMemo, useState } from 'react';
import '../../../videoplattform/frontend/videoplattform.css';
import '../kundenportal.css';

type PortalVideo = {
    id: number;
    title: string;
    description: string;
    category: string;
    sourceType: 'upload' | 'url';
    streamUrl: string;
    customerName: string | null;
    createdAt: string;
};

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
    tenantLogoUrl?: string | null;
    tenantName?: string | null;
    logoUrl?: string | null;
    videos: PortalVideo[];
};

type PortalFileItem = {
    id: number;
    folderPath: string;
    displayName: string;
    workflowStatus: 'pending' | 'clean' | 'rejected' | 'reviewed';
    currentVersionId: number | null;
    currentVersionNo: number | null;
    currentScanStatus: string | null;
    currentVersionCreatedAt: string | null;
    updatedAt: string | null;
};

const API_BASE = '/api/plugins/kundenportal/public';
const STORAGE_SESSION_KEY = 'kundenportal.session';
const STORAGE_EMAIL_KEY = 'kundenportal.email';

type PortalTab = 'videos' | 'files';
type PortalNavKey = 'videos' | 'files' | 'docs' | 'profile' | 'logout';

function formatDate(value: string | null | undefined): string {
    if (!value) return '-';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
}

function NavIcon({ nav }: { nav: PortalNavKey }) {
    if (nav === 'files') {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 7a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
        );
    }
    if (nav === 'docs') {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M14 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
        );
    }
    if (nav === 'profile') {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M4 21c1.2-3.3 4.1-5 8-5s6.8 1.7 8 5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
        );
    }
    if (nav === 'logout') {
        return (
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M14 8l5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 12h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
        );
    }
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M10 9.5v5l4-2.5-4-2.5z" fill="currentColor" />
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
    const [activeTab, setActiveTab] = useState<PortalTab>('videos');
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [email, setEmail] = useState(localStorage.getItem(STORAGE_EMAIL_KEY) || '');
    const [code, setCode] = useState('');
    const [codeRequested, setCodeRequested] = useState(false);
    const [access, setAccess] = useState<SessionAccessResponse | null>(null);
    const [expectedHost, setExpectedHost] = useState('');
    const [portalBrand, setPortalBrand] = useState('Kundenportal');
    const [keyword, setKeyword] = useState('');
    const [portalLogoUrl, setPortalLogoUrl] = useState<string | null>(null);
    const [tenantLogoUrl, setTenantLogoUrl] = useState<string | null>(null);
    const [portalLogoHeight, setPortalLogoHeight] = useState(52);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [files, setFiles] = useState<PortalFileItem[]>([]);
    const [filesLoading, setFilesLoading] = useState(false);
    const [filesError, setFilesError] = useState<string | null>(null);
    const [uploadFolderPath, setUploadFolderPath] = useState('');
    const [uploadComment, setUploadComment] = useState('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

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

    const visibleVideos = useMemo(() => {
        if (!access) return [];
        const normalized = keyword.trim().toLowerCase();
        if (!normalized) return access.videos;
        return access.videos.filter((video) => {
            const haystack = `${video.title} ${video.description} ${video.category} ${video.customerName || ''}`.toLowerCase();
            return haystack.includes(normalized);
        });
    }, [access, keyword]);

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

    async function loadFiles(sessionToken: string) {
        setFilesLoading(true);
        setFilesError(null);
        try {
            const res = await fetch(`/api/plugins/dateiaustausch/public/files?sessionToken=${encodeURIComponent(sessionToken)}`);
            const payload = await res.json().catch(() => ([]));
            if (!res.ok) throw new Error((payload as any)?.error || 'Dateien konnten nicht geladen werden.');
            setFiles(Array.isArray(payload) ? (payload as PortalFileItem[]) : []);
        } catch (err) {
            setFilesError(err instanceof Error ? err.message : 'Dateien konnten nicht geladen werden.');
            setFiles([]);
        } finally {
            setFilesLoading(false);
        }
    }

    useEffect(() => {
        if (!access?.sessionToken) {
            setFiles([]);
            return;
        }
        if (activeTab !== 'files') return;
        loadFiles(access.sessionToken).catch(() => undefined);
    }, [activeTab, access?.sessionToken]);

    // Dynamic title and favicon
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

    async function uploadFile(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!access?.sessionToken) return;
        if (!selectedFile) {
            setFilesError('Bitte wählen Sie zuerst eine Datei aus.');
            return;
        }

        setFilesLoading(true);
        setFilesError(null);
        try {
            const formData = new FormData();
            formData.append('sessionToken', access.sessionToken);
            if (uploadFolderPath.trim()) formData.append('folderPath', uploadFolderPath.trim());
            if (uploadComment.trim()) formData.append('comment', uploadComment.trim());
            formData.append('file', selectedFile);

            const res = await fetch(`/api/plugins/dateiaustausch/public/files/upload?sessionToken=${encodeURIComponent(access.sessionToken)}`, {
                method: 'POST',
                headers: {
                    'x-public-session-token': access.sessionToken,
                },
                body: formData,
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Upload fehlgeschlagen.');

            setSelectedFile(null);
            setUploadComment('');
            await loadFiles(access.sessionToken);
        } catch (err) {
            setFilesError(err instanceof Error ? err.message : 'Upload fehlgeschlagen.');
        } finally {
            setFilesLoading(false);
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
        setKeyword('');
        setCode('');
        setCodeRequested(false);
        setError(null);
        setFiles([]);
        setFilesError(null);
        setSelectedFile(null);
        setActiveTab('videos');
        setMobileNavOpen(false);
    }

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
                                    <p className="kp-nav-section">Aktiv</p>
                                    <button
                                        className={`btn kp-nav-btn ${activeTab === 'videos' ? 'btn-primary is-active' : 'btn-secondary'}`}
                                        type="button"
                                        onClick={() => { setActiveTab('videos'); setMobileNavOpen(false); }}
                                    >
                                        <span className="kp-nav-icon"><NavIcon nav="videos" /></span>
                                        Videos
                                    </button>
                                    <button
                                        className={`btn kp-nav-btn ${activeTab === 'files' ? 'btn-primary is-active' : 'btn-secondary'}`}
                                        type="button"
                                        onClick={() => { setActiveTab('files'); setMobileNavOpen(false); }}
                                    >
                                        <span className="kp-nav-icon"><NavIcon nav="files" /></span>
                                        Dateiaustausch
                                    </button>

                                    <p className="kp-nav-section" style={{ marginTop: '4px' }}>Demnächst</p>
                                    <button className="btn kp-nav-btn is-disabled" type="button" disabled>
                                        <span className="kp-nav-icon"><NavIcon nav="docs" /></span>
                                        Dokumente
                                        <span className="kp-nav-badge">Coming soon</span>
                                    </button>
                                    <button className="btn kp-nav-btn is-disabled" type="button" disabled>
                                        <span className="kp-nav-icon"><NavIcon nav="profile" /></span>
                                        Profil
                                        <span className="kp-nav-badge">Coming soon</span>
                                    </button>
                                    <p className="kp-nav-section">Konto</p>
                                    <button
                                        className="btn kp-nav-btn kp-nav-btn-logout btn-secondary"
                                        type="button"
                                        onClick={resetAccess}
                                    >
                                        <span className="kp-nav-icon"><NavIcon nav="logout" /></span>
                                        Abmelden
                                    </button>
                                </nav>

                                <div className="kp-sidebar-meta">
                                    <p className="text-muted">Freigeschaltet bis: {formatDate(access.expiresAt)}</p>
                                    <p className="text-muted">Videos: {access.videos.length}</p>
                                </div>
                            </aside>

                            <main className="kp-main card">
                                <header className="kp-main-header">
                                    <div>
                                        <h1 className="page-title">{activeTab === 'videos' ? 'Videos' : 'Dateiaustausch'}</h1>
                                        <p className="text-muted">
                                            {activeTab === 'videos' ? `${visibleVideos.length} von ${access.videos.length} Videos` : 'Sicherer Dateiaustausch mit Versionierung'}
                                        </p>
                                    </div>
                                </header>

                                {activeTab === 'videos' && (
                                    <>
                                        <div className="kp-searchbar">
                                            <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Suchen nach Titel, Beschreibung oder Kategorie" />
                                        </div>

                                        <div className="kp-video-grid">
                                            {visibleVideos.length === 0 && (
                                                <div className="kp-empty-state">
                                                    <div className="kp-empty-icon">
                                                        <NavIcon nav="videos" />
                                                    </div>
                                                    <h3>Keine Videos gefunden</h3>
                                                    <p className="text-muted">
                                                        {keyword.trim()
                                                            ? 'Versuchen Sie einen anderen Suchbegriff oder löschen Sie den Filter.'
                                                            : 'Sobald neue Videos freigegeben sind, erscheinen sie hier automatisch.'}
                                                    </p>
                                                    {keyword.trim() ? (
                                                        <button className="btn btn-secondary" type="button" onClick={() => setKeyword('')}>
                                                            Suche zurücksetzen
                                                        </button>
                                                    ) : null}
                                                </div>
                                            )}
                                            {visibleVideos.map((video) => {
                                                const streamUrl = `${video.streamUrl}?sessionToken=${encodeURIComponent(access.sessionToken)}`;
                                                return (
                                                    <article key={video.id} className="kp-video-card">
                                                        <div className="kp-video-preview">
                                                            {video.sourceType === 'upload' ? (
                                                                <video className="kp-video-player" controls playsInline controlsList="nodownload" src={streamUrl} />
                                                            ) : (
                                                                <a className="btn btn-primary" href={streamUrl} target="_blank" rel="noreferrer">Externes Video öffnen</a>
                                                            )}
                                                        </div>
                                                        <div className="kp-video-body">
                                                            <h3>{video.title}</h3>
                                                            <p className="text-muted">{video.category} • {formatDate(video.createdAt)}</p>
                                                            {video.description ? <p>{video.description}</p> : null}
                                                        </div>
                                                    </article>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}

                                {activeTab === 'files' && (
                                    <div className="kp-coming-soon">
                                        <h3>Dateiaustausch</h3>
                                        <p className="text-muted" style={{ marginTop: 0 }}>Uploads landen in Quarantäne und werden vor Freigabe geprüft.</p>

                                        <form onSubmit={uploadFile} className="vp-stack" style={{ marginTop: 12 }}>
                                            <input
                                                className="input"
                                                type="file"
                                                onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                                                accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.pdf,.doc,.docx,.xlsx,.pptx,.txt,.zip"
                                                required
                                            />
                                            <input
                                                className="input"
                                                value={uploadFolderPath}
                                                onChange={(event) => setUploadFolderPath(event.target.value)}
                                                placeholder="Ordnerpfad (optional), z. B. Fotos/April"
                                            />
                                            <textarea
                                                className="input"
                                                rows={3}
                                                value={uploadComment}
                                                onChange={(event) => setUploadComment(event.target.value)}
                                                placeholder="Kommentar zur Datei (optional)"
                                            />
                                            <button className="btn btn-primary" type="submit" disabled={filesLoading}>
                                                {filesLoading ? 'Lade hoch...' : 'Datei sicher hochladen'}
                                            </button>
                                        </form>

                                        {filesError && <p className="text-danger" style={{ marginTop: 10 }}>{filesError}</p>}

                                        <div style={{ marginTop: 14, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr style={{ textAlign: 'left', background: 'var(--panel-muted)' }}>
                                                        <th style={{ padding: '10px 12px' }}>Datei</th>
                                                        <th style={{ padding: '10px 12px' }}>Ordner</th>
                                                        <th style={{ padding: '10px 12px' }}>Status</th>
                                                        <th style={{ padding: '10px 12px' }}>Version</th>
                                                        <th style={{ padding: '10px 12px' }}>Aktualisiert</th>
                                                        <th style={{ padding: '10px 12px' }}>Download</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {files.map((entry) => (
                                                        <tr key={entry.id} style={{ borderTop: '1px solid var(--line)' }}>
                                                            <td style={{ padding: '10px 12px' }}>{entry.displayName}</td>
                                                            <td style={{ padding: '10px 12px' }}>{entry.folderPath || 'Root'}</td>
                                                            <td style={{ padding: '10px 12px' }}>{entry.workflowStatus}</td>
                                                            <td style={{ padding: '10px 12px' }}>V{entry.currentVersionNo || 0}</td>
                                                            <td style={{ padding: '10px 12px' }}>{formatDate(entry.updatedAt)}</td>
                                                            <td style={{ padding: '10px 12px' }}>
                                                                {entry.currentVersionId && (entry.workflowStatus === 'clean' || entry.workflowStatus === 'reviewed') ? (
                                                                    <a
                                                                        href={`/api/plugins/dateiaustausch/public/files/${entry.id}/versions/${entry.currentVersionId}/download?sessionToken=${encodeURIComponent(access.sessionToken)}`}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                    >
                                                                        Laden
                                                                    </a>
                                                                ) : <span className="text-muted">Gesperrt</span>}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {!filesLoading && files.length === 0 && (
                                                        <tr>
                                                            <td colSpan={6} style={{ padding: '12px' }} className="text-muted">
                                                                Noch keine Dateien vorhanden.
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
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
