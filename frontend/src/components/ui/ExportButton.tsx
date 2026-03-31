import { useState } from 'react';
import { apiFetch } from '../../context/AuthContext';

interface ExportButtonProps {
    url: string;
    filename?: string;
    label?: string;
    className?: string;
    disabled?: boolean;
}

export default function ExportButton({
    url,
    filename = 'export.csv',
    label = 'CSV Export',
    className = 'btn btn-sm',
    disabled = false,
}: ExportButtonProps) {
    const [loading, setLoading] = useState(false);

    const handleExport = async () => {
        setLoading(true);
        try {
            const res = await apiFetch(url);
            if (!res.ok) throw new Error('Export fehlgeschlagen');
            const blob = await res.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (err) {
            console.error('Export-Fehler:', err);
        }
        setLoading(false);
    };

    return (
        <button className={className} onClick={handleExport} disabled={disabled || loading}>
            {loading ? 'Exportiere...' : label}
        </button>
    );
}
