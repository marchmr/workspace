import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

export interface ToastItem {
    id: string;
    title: string;
    message?: string;
    type: 'info' | 'success' | 'warning' | 'error';
    link?: string;
    duration: number;       // 0 = manuell schliessen
    createdAt: number;
}

interface ToastContextType {
    toasts: ToastItem[];
    addToast: (options: {
        title: string;
        message?: string;
        type?: 'info' | 'success' | 'warning' | 'error';
        link?: string;
        duration?: number;
    }) => void;
    dismissToast: (id: string) => void;
}

const MAX_TOASTS = 4;
let toastCounter = 0;

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast muss innerhalb von ToastProvider verwendet werden');
    return ctx;
}

/* ════════════════════════════════════════════
   Provider
   ════════════════════════════════════════════ */

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
        const timer = timersRef.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(id);
        }
    }, []);

    const addToast = useCallback((options: {
        title: string;
        message?: string;
        type?: 'info' | 'success' | 'warning' | 'error';
        link?: string;
        duration?: number;
    }) => {
        const id = `toast-${++toastCounter}-${Date.now()}`;
        const duration = options.duration ?? 5000;

        const toast: ToastItem = {
            id,
            title: options.title,
            message: options.message,
            type: options.type || 'info',
            link: options.link,
            duration,
            createdAt: Date.now(),
        };

        setToasts(prev => {
            const next = [toast, ...prev];
            // Enforce max, dismiss oldest
            if (next.length > MAX_TOASTS) {
                const removed = next.splice(MAX_TOASTS);
                for (const r of removed) {
                    const timer = timersRef.current.get(r.id);
                    if (timer) {
                        clearTimeout(timer);
                        timersRef.current.delete(r.id);
                    }
                }
            }
            return next;
        });

        if (duration > 0) {
            const timer = setTimeout(() => {
                dismissToast(id);
            }, duration);
            timersRef.current.set(id, timer);
        }
    }, [dismissToast]);

    return (
        <ToastContext.Provider value={{ toasts, addToast, dismissToast }}>
            {children}
        </ToastContext.Provider>
    );
}
