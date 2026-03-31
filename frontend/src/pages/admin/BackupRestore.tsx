import { useState } from 'react';
import { apiFetch } from '../../context/AuthContext';
import { useModal } from '../../components/ModalProvider';

export default function BackupRestore() {
    const modal = useModal();
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<{ tablesImported?: string[]; totalRows?: number; error?: string } | null>(null);

    const handleExport = async () => {
        setExporting(true);
        setResult(null);

        try {
            const res = await apiFetch('/api/admin/backup/export', { method: 'POST' });
            if (!res.ok) {
                let message = 'Export fehlgeschlagen';
                try {
                    const data = await res.json();
                    if (typeof data?.error === 'string' && data.error.trim()) {
                        message = data.error;
                    }
                } catch {
                    // Ignorieren und Default-Meldung verwenden.
                }
                throw new Error(message);
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mike-backup-${new Date().toISOString().slice(0, 10)}.zip`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err: any) {
            setResult({ error: err.message });
        } finally {
            setExporting(false);
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!await modal.confirm({ title: 'Backup wiederherstellen', message: 'ACHTUNG: Alle bestehenden Daten werden überschrieben! Fortfahren?', confirmText: 'Wiederherstellen', variant: 'danger' })) {
            e.target.value = '';
            return;
        }

        setImporting(true);
        setResult(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await apiFetch('/api/admin/backup/import', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Import fehlgeschlagen');
            setResult(data);
        } catch (err: any) {
            setResult({ error: err.message });
        } finally {
            setImporting(false);
            e.target.value = '';
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Backup & Restore</h1>
                <p className="page-subtitle">Datenbank und Dateien sichern oder wiederherstellen</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)' }}>
                {/* Export */}
                <div className="card">
                    <div className="card-title">Backup erstellen</div>
                    <p className="text-muted mt-md" style={{ fontSize: 'var(--font-size-sm)' }}>
                        Exportiert die komplette Datenbank und alle Uploads/Dokumente in eine ZIP-Datei.
                    </p>
                    <button
                        className="btn btn-primary mt-lg"
                        onClick={handleExport}
                        disabled={exporting}
                    >
                        {exporting ? 'Backup wird erstellt...' : 'Backup herunterladen'}
                    </button>
                </div>

                {/* Import */}
                <div className="card">
                    <div className="card-title">Backup wiederherstellen</div>
                    <p className="text-muted mt-md" style={{ fontSize: 'var(--font-size-sm)' }}>
                        Importiert ein zuvor erstelltes Voll-Backup. Alle bestehenden Daten und Dateien werden überschrieben.
                    </p>
                    <label className="btn btn-secondary mt-lg" style={{ cursor: 'pointer' }}>
                        {importing ? 'Importiere...' : 'ZIP-Datei auswählen'}
                        <input
                            type="file"
                            accept=".zip"
                            onChange={handleImport}
                            disabled={importing}
                            style={{ display: 'none' }}
                        />
                    </label>
                </div>
            </div>

            {/* Result */}
            {result && (
                <div className={`card mt-lg ${result.error ? '' : ''}`}>
                    {result.error ? (
                        <div className="text-danger"><strong>Fehler:</strong> {result.error}</div>
                    ) : (
                        <div>
                            <div className="text-success" style={{ fontWeight: 600 }}>Import erfolgreich</div>
                            <p className="text-muted mt-md" style={{ fontSize: 'var(--font-size-sm)' }}>
                                {result.totalRows} Datensätze in {result.tablesImported?.length} Tabellen importiert.
                            </p>
                            <div className="mt-md" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {result.tablesImported?.map((t) => (
                                    <span key={t} className="badge badge-info">{t}</span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
