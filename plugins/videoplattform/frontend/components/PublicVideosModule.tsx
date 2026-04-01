import { useState, useEffect } from 'react';

type PortalVideoLike = {
    id: number;
    title: string;
    description: string;
    category: string;
    sourceType: 'upload' | 'url';
    streamUrl: string;
    createdAt: string;
};

type Props = {
    sessionToken: string;
    formatDate: (value: string | null | undefined) => string;
};

function VideoEmptyIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M10 9.5v5l4-2.5-4-2.5z" fill="currentColor" />
        </svg>
    );
}

export default function PublicVideosModule(props: Props) {
    const { sessionToken, formatDate } = props;
    const [keyword, setKeyword] = useState('');
    const [videos, setVideos] = useState<PortalVideoLike[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        fetch(`/api/plugins/kundenportal/public/access/by-session?sessionToken=${encodeURIComponent(sessionToken)}`)
            .then(res => res.json())
            .then(data => {
                if (!mounted) return;
                setLoading(false);
                if (data.videos) {
                    setVideos(data.videos);
                } else if (data.error) {
                    setError(data.error);
                }
            })
            .catch(err => {
                if (!mounted) return;
                setLoading(false);
                setError(err.message);
            });
        return () => { mounted = false; };
    }, [sessionToken]);

    const filtered = videos.filter(v => 
        v.title.toLowerCase().includes(keyword.toLowerCase()) || 
        (v.description && v.description.toLowerCase().includes(keyword.toLowerCase())) ||
        (v.category && v.category.toLowerCase().includes(keyword.toLowerCase()))
    );

    if (loading) return <div className="kp-empty-state">Laden...</div>;
    if (error) return <div className="kp-empty-state" style={{color: 'var(--danger-color)'}}>Fehler: {error}</div>;

    return (
        <>
            <div className="kp-searchbar">
                <input
                    className="input"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="Suchen nach Titel, Beschreibung oder Kategorie"
                />
            </div>

            <div className="kp-video-grid">
                {filtered.length === 0 && (
                    <div className="kp-empty-state">
                        <div className="kp-empty-icon">
                            <VideoEmptyIcon />
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
                {filtered.map((video) => {
                    const baseUrl = String(video.streamUrl || '')
                        .replace('/api/plugins/videoplattform/public', '/api/plugins/kundenportal/public');
                    const separator = baseUrl.includes('?') ? '&' : '?';
                    const streamUrl = `${baseUrl}${separator}sessionToken=${encodeURIComponent(sessionToken)}`;
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
    );
}
