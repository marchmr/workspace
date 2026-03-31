import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ─── Types ───────────────────────────────────────────────────────

type ModalVariant = 'info' | 'success' | 'warning' | 'danger' | 'error';

interface ConfirmOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: ModalVariant;
}

interface AlertOptions {
    title: string;
    message: string;
    variant?: ModalVariant;
    buttonText?: string;
}

interface ToastItem {
    id: number;
    message: string;
    variant: ModalVariant;
    expiresAt: number;
}

interface ModalContextValue {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    alert: (options: AlertOptions) => Promise<void>;
}

interface ToastContextValue {
    success: (message: string) => void;
    error: (message: string) => void;
    warning: (message: string) => void;
    info: (message: string) => void;
}

// ─── Contexts ────────────────────────────────────────────────────

const ModalContext = createContext<ModalContextValue | null>(null);
const ToastContext = createContext<ToastContextValue | null>(null);

export function useModal(): ModalContextValue {
    const ctx = useContext(ModalContext);
    if (!ctx) throw new Error('useModal muss innerhalb von <ModalProvider> verwendet werden');
    return ctx;
}

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast muss innerhalb von <ModalProvider> verwendet werden');
    return ctx;
}

// ─── Variant helpers ─────────────────────────────────────────────

const variantColors: Record<ModalVariant, string> = {
    info: 'var(--color-primary, #3b82f6)',
    success: '#22c55e',
    warning: '#f59e0b',
    danger: '#ef4444',
    error: '#ef4444',
};

const variantIcons: Record<ModalVariant, string> = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    danger: '⚠️',
    error: '❌',
};

// ─── Confirm Modal Component ─────────────────────────────────────

function ConfirmModal({ options, onResolve }: {
    options: ConfirmOptions;
    onResolve: (result: boolean) => void;
}) {
    const variant = options.variant || 'info';
    const accentColor = variantColors[variant];
    const isDanger = variant === 'danger' || variant === 'error';

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onResolve(false);
            if (e.key === 'Enter') onResolve(true);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onResolve]);

    return (
        <div className="modal-overlay" onClick={() => onResolve(false)} style={{ zIndex: 10000 }}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
                <div className="modal-header" style={{ borderBottom: `2px solid ${accentColor}` }}>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{variantIcons[variant]}</span>
                        {options.title}
                    </h3>
                    <button className="modal-close" onClick={() => onResolve(false)}>×</button>
                </div>
                <div style={{ marginTop: 'var(--space-md)' }}>
                    <p style={{ margin: 0, whiteSpace: 'pre-line', lineHeight: 1.6 }}>{options.message}</p>
                </div>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={() => onResolve(false)}>
                        {options.cancelText || 'Abbrechen'}
                    </button>
                    <button
                        className={`btn ${isDanger ? 'btn-danger' : 'btn-primary'}`}
                        onClick={() => onResolve(true)}
                        autoFocus
                    >
                        {options.confirmText || 'OK'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Alert Modal Component ───────────────────────────────────────

function AlertModal({ options, onClose }: {
    options: AlertOptions;
    onClose: () => void;
}) {
    const variant = options.variant || 'info';
    const accentColor = variantColors[variant];

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' || e.key === 'Enter') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <div className="modal-overlay" onClick={onClose} style={{ zIndex: 10000 }}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
                <div className="modal-header" style={{ borderBottom: `2px solid ${accentColor}` }}>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{variantIcons[variant]}</span>
                        {options.title}
                    </h3>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>
                <div style={{ marginTop: 'var(--space-md)' }}>
                    <p style={{ margin: 0, whiteSpace: 'pre-line', lineHeight: 1.6 }}>{options.message}</p>
                </div>
                <div className="modal-actions">
                    <button className="btn btn-primary" onClick={onClose} autoFocus>
                        {options.buttonText || 'OK'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Toast Component ─────────────────────────────────────────────

const MAX_TOASTS = 5;

function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
    if (toasts.length === 0) return null;

    return createPortal(
        <div className="toast-container">
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={`toast-item toast-${toast.variant}`}
                    onClick={() => onDismiss(toast.id)}
                >
                    <span className="toast-icon">{variantIcons[toast.variant]}</span>
                    <span className="toast-message">{toast.message}</span>
                    <button className="toast-close" onClick={(e) => { e.stopPropagation(); onDismiss(toast.id); }}>×</button>
                </div>
            ))}
        </div>,
        document.body
    );
}

// ─── Provider ────────────────────────────────────────────────────

export function ModalProvider({ children }: { children: ReactNode }) {
    // Modal state
    const [confirmState, setConfirmState] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
    const [alertState, setAlertState] = useState<{ options: AlertOptions; resolve: () => void } | null>(null);

    // Toast state
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const toastIdRef = useRef(0);

    // Auto-dismiss toasts
    useEffect(() => {
        if (toasts.length === 0) return;
        const now = Date.now();
        const nearest = Math.min(...toasts.map((t) => t.expiresAt));
        const delay = Math.max(100, nearest - now);
        const timer = setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.expiresAt > Date.now()));
        }, delay);
        return () => clearTimeout(timer);
    }, [toasts]);

    const confirmFn = useCallback((options: ConfirmOptions): Promise<boolean> => {
        return new Promise((resolve) => {
            setConfirmState({ options, resolve });
        });
    }, []);

    const alertFn = useCallback((options: AlertOptions): Promise<void> => {
        return new Promise((resolve) => {
            setAlertState({ options, resolve });
        });
    }, []);

    const addToast = useCallback((message: string, variant: ModalVariant) => {
        const duration = (variant === 'error' || variant === 'warning' || variant === 'danger') ? 6000 : 4000;
        const id = ++toastIdRef.current;
        setToasts((prev) => {
            const next = [...prev, { id, message, variant, expiresAt: Date.now() + duration }];
            return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
        });
    }, []);

    const dismissToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const toastApi = useCallback(() => ({
        success: (msg: string) => addToast(msg, 'success'),
        error: (msg: string) => addToast(msg, 'error'),
        warning: (msg: string) => addToast(msg, 'warning'),
        info: (msg: string) => addToast(msg, 'info'),
    }), [addToast]);

    const handleConfirmResolve = useCallback((result: boolean) => {
        confirmState?.resolve(result);
        setConfirmState(null);
    }, [confirmState]);

    const handleAlertClose = useCallback(() => {
        alertState?.resolve();
        setAlertState(null);
    }, [alertState]);

    return (
        <ModalContext.Provider value={{ confirm: confirmFn, alert: alertFn }}>
            <ToastContext.Provider value={toastApi()}>
                {children}
                {confirmState && <ConfirmModal options={confirmState.options} onResolve={handleConfirmResolve} />}
                {alertState && <AlertModal options={alertState.options} onClose={handleAlertClose} />}
                <ToastContainer toasts={toasts} onDismiss={dismissToast} />
            </ToastContext.Provider>
        </ModalContext.Provider>
    );
}
