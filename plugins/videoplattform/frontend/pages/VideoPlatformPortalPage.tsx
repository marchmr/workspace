import { FormEvent, useEffect, useMemo, useState } from 'react';
import '../videoplattform.css';

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

type AccessResponse = {
    code: string;
    scope: 'video' | 'customer';
    customerId: number | null;
    customerName: string | null;
    tenantLogoUrl?: string | null;
    logoUrl?: string | null;
    videos: PortalVideo[];
};

const STORAGE_KEY = 'videoplattform.customer_code';

function formatDate(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

export default function VideoPlatformPortalPage() {
    const [code, setCode] = useState(localStorage.getItem(STORAGE_KEY) || '');
    const [access, setAccess] = useState<AccessResponse | null>(null);
    const [expectedHost, setExpectedHost] = useState('');
    const [keyword, setKeyword] = useState('');
    const [portalLogoUrl, setPortalLogoUrl] = useState<string | null>(null);
    const [portalLogoHeight, setPortalLogoHeight] = useState(52);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        fetch('/api/plugins/videoplattform/public/config')
            .then((res) => res.json())
            .then((data) => {
                if (!active) return;
                if (typeof data.expectedHost === 'string') {
                    setExpectedHost(data.expectedHost);
                }
                if (typeof data.logoUrl === 'string' && data.logoUrl) {
                    setPortalLogoUrl(`${data.logoUrl}${data.logoUrl.includes('?') ? '&' : '?'}v=${Date.now()}`);
                }
                const logoHeight = Number(data?.logoHeight);
                if (Number.isFinite(logoHeight)) {
                    setPortalLogoHeight(Math.max(24, Math.min(180, Math.round(logoHeight))));
                }
            })
            .catch(() => {
                // ignore
            });

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

    async function onSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const normalizedCode = code.trim().toUpperCase();
        if (!normalizedCode) return;

        setLoading(true);
        setError(null);

        try {
            const res = await fetch('/api/plugins/videoplattform/public/access/by-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: normalizedCode }),
            });

            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload?.error || 'Code ungültig oder abgelaufen');
            }

            localStorage.setItem(STORAGE_KEY, payload.code);
            setCode(payload.code);
            setAccess(payload as AccessResponse);
            const tenantLogo = typeof payload?.tenantLogoUrl === 'string' ? payload.tenantLogoUrl : '';
            const fallbackLogo = typeof payload?.logoUrl === 'string' ? payload.logoUrl : '';
            if (tenantLogo) {
                setPortalLogoUrl(`${tenantLogo}${tenantLogo.includes('?') ? '&' : '?'}v=${Date.now()}`);
            } else if (fallbackLogo) {
                setPortalLogoUrl(`${fallbackLogo}${fallbackLogo.includes('?') ? '&' : '?'}v=${Date.now()}`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Code ungültig oder abgelaufen');
            setAccess(null);
        } finally {
            setLoading(false);
        }
    }

    function resetAccess() {
        setAccess(null);
        setKeyword('');
        setError(null);
    }

    return (
        <div className="vp-public-page">
            <div className="vp-public-shell">
                {!access ? (
                    <section className="card vp-access-card">
                        <div className="vp-portal-brand">
                            {portalLogoUrl ? (
                                <img src={portalLogoUrl} alt="Kundenportal Logo" style={{ maxHeight: `${portalLogoHeight}px` }} />
                            ) : (
                                <div className="vp-portal-brand-fallback">Kundenportal</div>
                            )}
                        </div>
                        <h1 className="page-title" style={{ marginBottom: 'var(--space-sm)' }}>Videofreigabe</h1>
                        <p className="text-muted" style={{ marginBottom: 'var(--space-md)' }}>
                            Bitte Freigabecode eingeben, um Ihre Videos zu öffnen.
                        </p>

                        {expectedHost && expectedHost !== window.location.hostname && (
                            <div className="vp-warning">
                                Dieses Portal ist nur über <strong>{expectedHost}</strong> erreichbar.
                            </div>
                        )}

                        <form onSubmit={onSubmit} className="vp-stack">
                            <label className="vp-label" htmlFor="vp-code-input">Freigabecode</label>
                            <input
                                id="vp-code-input"
                                className="input vp-input-center"
                                value={code}
                                onChange={(e) => setCode(e.target.value.toUpperCase())}
                                placeholder="VID-XXXXXXXX"
                                required
                            />
                            <button className="btn btn-primary" type="submit" disabled={loading}>
                                {loading ? 'Prüfe Code...' : 'Videos öffnen'}
                            </button>
                        </form>

                        {error && <p className="text-danger" style={{ marginTop: 'var(--space-sm)' }}>{error}</p>}
                    </section>
                ) : (
                    <section className="card vp-panel vp-portal-panel">
                        <div className="vp-head-row">
                            <div>
                                <h1 className="page-title">Ihre Videos</h1>
                                <p className="text-muted">{access.customerName || 'Freigabe'}</p>
                            </div>
                            <button className="btn btn-secondary" onClick={resetAccess}>Zurück</button>
                        </div>

                        {access.scope === 'customer' && (
                            <div className="vp-toolbar" style={{ marginTop: 'var(--space-md)' }}>
                                <input
                                    className="input"
                                    value={keyword}
                                    onChange={(e) => setKeyword(e.target.value)}
                                    placeholder="Suchen nach Titel, Beschreibung oder Kategorie"
                                />
                            </div>
                        )}

                        <div className="vp-video-grid" style={{ marginTop: 'var(--space-md)' }}>
                            {visibleVideos.length === 0 && (
                                <div className="vp-empty">Keine Videos gefunden.</div>
                            )}

                            {visibleVideos.map((video) => {
                                const streamUrl = `${video.streamUrl}?code=${encodeURIComponent(access.code)}`;

                                return (
                                    <article key={video.id} className="vp-video-card">
                                        <div className="vp-video-preview">
                                            {video.sourceType === 'upload' ? (
                                                <video controls playsInline controlsList="nodownload" src={streamUrl} />
                                            ) : (
                                                <a className="btn btn-primary" href={streamUrl} target="_blank" rel="noreferrer">
                                                    Externes Video öffnen
                                                </a>
                                            )}
                                        </div>

                                        <div className="vp-video-body">
                                            <h3>{video.title}</h3>
                                            <p className="text-muted">{video.category} • {formatDate(video.createdAt)}</p>
                                            {video.description ? <p>{video.description}</p> : null}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
