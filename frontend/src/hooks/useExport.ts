import { useState, useCallback } from 'react';
import { apiFetch } from '../context/AuthContext';

export function useExport() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const exportCSV = useCallback(async (url: string, filename: string = 'export.csv') => {
        setLoading(true);
        setError(null);
        try {
            const res = await apiFetch(url);
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Export fehlgeschlagen' }));
                throw new Error(err.error || 'Export fehlgeschlagen');
            }
            const blob = await res.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (err: any) {
            setError(err.message);
        }
        setLoading(false);
    }, []);

    return { exportCSV, loading, error };
}
