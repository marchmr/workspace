import { useEffect, useState } from 'react';

type ItemRow = {
    id: number;
    customerId: number;
    customerName: string | null;
    folderPath: string;
    displayName: string;
    workflowStatus: 'pending' | 'clean' | 'rejected' | 'reviewed';
    updatedAt: string | null;
    currentVersionId: number | null;
};

function formatDate(value: string | null): string {
    if (!value) return '-';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function statusLabel(value: ItemRow['workflowStatus']): string {
    if (value === 'clean' || value === 'reviewed') return 'Verfügbar';
    if (value === 'rejected') return 'Blockiert';
    return 'Wird geprüft';
}

export default function DateiaustauschPage() {
    const [rows, setRows] = useState<ItemRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    async function loadRows() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/plugins/dateiaustausch/items');
            const payload = await res.json().catch(() => ([]));
            if (!res.ok) throw new Error(payload?.error || 'Dateien konnten nicht geladen werden.');
            setRows(Array.isArray(payload) ? payload : []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Dateien konnten nicht geladen werden.');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadRows().catch(() => undefined);
    }, []);

    const visibleRows = rows.filter((row) => {
        const query = search.trim().toLowerCase();
        if (!query) return true;
        return `${row.displayName} ${row.folderPath} ${row.customerName || ''}`.toLowerCase().includes(query);
    });

    return (
        <div className="page-shell">
            <section className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                        <h1 className="page-title" style={{ marginBottom: 6 }}>Dateiaustausch</h1>
                        <p className="text-muted" style={{ margin: 0 }}>Sichere Cloud-Ablage mit Ordnerstruktur und Malware-Prüfung.</p>
                    </div>
                    <button className="btn btn-secondary" type="button" onClick={() => loadRows()} disabled={loading}>
                        Aktualisieren
                    </button>
                </div>

                <div style={{ marginTop: 12 }}>
                    <input
                        className="input"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Dateien, Ordner oder Kunde durchsuchen"
                    />
                </div>

                {error && <p className="text-danger" style={{ marginTop: 10 }}>{error}</p>}

                <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', marginTop: 14 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', background: 'var(--panel-muted)' }}>
                                <th style={{ padding: '10px 12px' }}>Datei</th>
                                <th style={{ padding: '10px 12px' }}>Ordner</th>
                                <th style={{ padding: '10px 12px' }}>Kunde</th>
                                <th style={{ padding: '10px 12px' }}>Status</th>
                                <th style={{ padding: '10px 12px' }}>Aktualisiert</th>
                                <th style={{ padding: '10px 12px' }}>Download</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleRows.map((row) => (
                                <tr key={row.id} style={{ borderTop: '1px solid var(--line)' }}>
                                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{row.displayName}</td>
                                    <td style={{ padding: '10px 12px' }}>{row.folderPath || 'Root'}</td>
                                    <td style={{ padding: '10px 12px' }}>{row.customerName || `#${row.customerId}`}</td>
                                    <td style={{ padding: '10px 12px' }}>{statusLabel(row.workflowStatus)}</td>
                                    <td style={{ padding: '10px 12px' }}>{formatDate(row.updatedAt)}</td>
                                    <td style={{ padding: '10px 12px' }}>
                                        {row.currentVersionId ? (
                                            <a href={`/api/plugins/dateiaustausch/items/${row.id}/versions/${row.currentVersionId}/download`} target="_blank" rel="noreferrer">
                                                Download
                                            </a>
                                        ) : (
                                            <span className="text-muted">-</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {!loading && visibleRows.length === 0 && (
                                <tr>
                                    <td colSpan={6} style={{ padding: 16 }} className="text-muted">Keine Dateien gefunden.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
