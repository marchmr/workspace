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
    videos: PortalVideoLike[];
    keyword: string;
    onKeywordChange: (value: string) => void;
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
    const { videos, keyword, onKeywordChange, sessionToken, formatDate } = props;

    return (
        <>
            <div className="kp-searchbar">
                <input
                    className="input"
                    value={keyword}
                    onChange={(event) => onKeywordChange(event.target.value)}
                    placeholder="Suchen nach Titel, Beschreibung oder Kategorie"
                />
            </div>

            <div className="kp-video-grid">
                {videos.length === 0 && (
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
                            <button className="btn btn-secondary" type="button" onClick={() => onKeywordChange('')}>
                                Suche zurücksetzen
                            </button>
                        ) : null}
                    </div>
                )}
                {videos.map((video) => {
                    const streamUrl = `${video.streamUrl}?sessionToken=${encodeURIComponent(sessionToken)}`;
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
