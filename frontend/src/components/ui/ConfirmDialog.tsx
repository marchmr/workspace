import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'default';
    loading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = 'Bestätigen',
    cancelLabel = 'Abbrechen',
    variant = 'default',
    loading = false,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    // ESC-Taste schließt den Dialog
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && open) onCancel();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onCancel]);

    if (!open) return null;

    const btnClass = variant === 'danger' ? 'btn-danger' : variant === 'warning' ? 'btn-warning' : 'btn-primary';

    return (
        <dialog ref={dialogRef} className="confirm-dialog-backdrop" onClick={(e) => {
            if (e.target === dialogRef.current) onCancel();
        }}>
            <div className="confirm-dialog">
                <div className="confirm-dialog-title">{title}</div>
                {message && <p className="confirm-dialog-message">{message}</p>}
                <div className="confirm-dialog-actions">
                    <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
                        {cancelLabel}
                    </button>
                    <button className={`btn ${btnClass}`} onClick={onConfirm} disabled={loading}>
                        {loading ? 'Bitte warten...' : confirmLabel}
                    </button>
                </div>
            </div>
        </dialog>
    );
}
