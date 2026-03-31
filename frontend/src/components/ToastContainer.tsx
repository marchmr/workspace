import { useState, useEffect, useRef, useCallback, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast, type ToastItem } from '../context/ToastContext';

/* ════════════════════════════════════════════
   Icons (SVG)
   ════════════════════════════════════════════ */

const CloseIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

const typeIcons: Record<string, ReactElement> = {
    info: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
    ),
    success: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
    ),
    warning: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    ),
    error: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
    ),
};

/* ════════════════════════════════════════════
   Single Toast
   ════════════════════════════════════════════ */

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
    const navigate = useNavigate();
    const [hovered, setHovered] = useState(false);
    const [progress, setProgress] = useState(100);
    const [exiting, setExiting] = useState(false);
    const animRef = useRef<number | null>(null);
    const startRef = useRef(Date.now());
    const remainingRef = useRef(toast.duration);

    const handleDismiss = useCallback(() => {
        setExiting(true);
        setTimeout(onDismiss, 250);
    }, [onDismiss]);

    // Progress bar animation
    useEffect(() => {
        if (toast.duration <= 0) return;

        const tick = () => {
            if (hovered) {
                startRef.current = Date.now();
                animRef.current = requestAnimationFrame(tick);
                return;
            }
            const elapsed = Date.now() - startRef.current;
            const remaining = remainingRef.current - elapsed;
            if (remaining <= 0) {
                handleDismiss();
                return;
            }
            setProgress((remaining / toast.duration) * 100);
            animRef.current = requestAnimationFrame(tick);
        };

        startRef.current = Date.now();
        animRef.current = requestAnimationFrame(tick);

        return () => {
            if (animRef.current) cancelAnimationFrame(animRef.current);
        };
    }, [toast.duration, hovered, handleDismiss]);

    // Pause timer on hover
    useEffect(() => {
        if (hovered) {
            const elapsed = Date.now() - startRef.current;
            remainingRef.current = Math.max(0, remainingRef.current - elapsed);
        } else {
            startRef.current = Date.now();
        }
    }, [hovered]);

    const handleClick = () => {
        if (toast.link && toast.link.startsWith('/')) {
            navigate(toast.link);
            handleDismiss();
        }
    };

    return (
        <div
            className={`toast-card toast-${toast.type} ${exiting ? 'toast-exit' : 'toast-enter'}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={toast.link ? handleClick : undefined}
            style={{ cursor: toast.link ? 'pointer' : 'default' }}
            role="alert"
        >
            <div className="toast-icon">{typeIcons[toast.type] || typeIcons.info}</div>
            <div className="toast-content">
                <div className="toast-title">{toast.title}</div>
                {toast.message && <div className="toast-message">{toast.message}</div>}
            </div>
            <button className="toast-close" onClick={(e) => { e.stopPropagation(); handleDismiss(); }} aria-label="Schliessen">
                {CloseIcon}
            </button>
            {toast.duration > 0 && (
                <div className="toast-progress-track">
                    <div className="toast-progress-bar" style={{ width: `${progress}%` }} />
                </div>
            )}
        </div>
    );
}

/* ════════════════════════════════════════════
   Toast Container
   ════════════════════════════════════════════ */

export default function ToastContainer() {
    const { toasts, dismissToast } = useToast();

    if (toasts.length === 0) return null;

    return (
        <div className="toast-container" aria-live="polite">
            {toasts.map(toast => (
                <ToastCard
                    key={toast.id}
                    toast={toast}
                    onDismiss={() => dismissToast(toast.id)}
                />
            ))}
        </div>
    );
}
