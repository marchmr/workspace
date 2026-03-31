import type { LockInfo } from '../../hooks/useEntityLock';

/* ════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════ */

const LockSvg = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
);

/* ════════════════════════════════════════════
   LockBanner — Fuer Detail-Ansichten
   ════════════════════════════════════════════ */

interface LockBannerProps {
    lock: LockInfo;
    onRequestAccess?: () => void;
    requesting?: boolean;
}

export function LockBanner({ lock, onRequestAccess, requesting }: LockBannerProps) {
    const name = lock.displayName || lock.username || 'Unbekannt';

    return (
        <div className="lock-banner" role="alert">
            <span className="lock-banner-icon">{LockSvg}</span>
            <span className="lock-banner-text">
                Dieser Eintrag wird gerade von <strong>{name}</strong> bearbeitet. Änderungen sind nicht möglich.
            </span>
            {onRequestAccess && (
                <span className="lock-banner-action">
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={onRequestAccess}
                        disabled={requesting}
                    >
                        {requesting ? 'Gesendet' : 'Zugriff anfragen'}
                    </button>
                </span>
            )}
        </div>
    );
}
