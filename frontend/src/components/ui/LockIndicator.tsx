import type { LockInfo } from '../../hooks/useEntityLock';

/* ════════════════════════════════════════════
   Avatar Color from Username
   ════════════════════════════════════════════ */

function hashColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 55%, 45%)`;
}

/* ════════════════════════════════════════════
   Lock SVG Icon
   ════════════════════════════════════════════ */

const LockSvg = (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
);

/* ════════════════════════════════════════════
   LockIndicator — Inline fuer Tabellen/Karten
   ════════════════════════════════════════════ */

interface LockIndicatorProps {
    lock: LockInfo;
}

export function LockIndicator({ lock }: LockIndicatorProps) {
    const initial = (lock.displayName || lock.username || '?').charAt(0).toUpperCase();
    const bgColor = hashColor(lock.username || '');
    const since = new Date(lock.acquiredAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    return (
        <span className="lock-indicator" title={`Wird bearbeitet von ${lock.displayName || lock.username} seit ${since}`}>
            <span className="lock-avatar" style={{ background: bgColor }}>
                {initial}
                <span className="lock-avatar-badge">
                    {LockSvg}
                </span>
            </span>
        </span>
    );
}
