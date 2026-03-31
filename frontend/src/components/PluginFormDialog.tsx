import type { ReactNode } from 'react';

interface PluginFormDialogProps {
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
    maxWidth?: number;
}

export default function PluginFormDialog({
    title,
    onClose,
    children,
    footer,
    maxWidth = 860,
}: PluginFormDialogProps) {
    return (
        <div className="modal-overlay plugin-form-overlay" onClick={onClose}>
            <div
                className="modal-card plugin-form-dialog"
                style={{ maxWidth }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="plugin-form-header">
                    <h2>{title}</h2>
                    <button className="modal-close" onClick={onClose} aria-label="Schließen">×</button>
                </div>

                <div className="plugin-form-body">
                    {children}
                </div>

                {footer && (
                    <div className="plugin-form-footer">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}
