import { FormEvent, useEffect, useMemo, useState } from 'react';

type ItemRow = {
    id: number;
    customerId: number;
    customerName: string | null;
    folderPath: string;
    displayName: string;
    workflowStatus: 'pending' | 'clean' | 'rejected' | 'reviewed';
    updatedAt: string | null;
    currentVersionId: number | null;
    currentVersionNo: number | null;
    currentScanStatus: string | null;
    currentScanSignature: string | null;
};

function statusLabel(value: ItemRow['workflowStatus'] | string): string {
    if (value === 'pending') return 'In Prüfung';
    if (value === 'clean') return 'Freigegeben';
    if (value === 'reviewed') return 'Geprüft';
    if (value === 'rejected') return 'Gesperrt';
    if (value === 'infected') return 'Malware erkannt';
    if (value === 'error') return 'Scan-Fehler';
    if (value === 'skipped') return 'Scan übersprungen';
    return value;
}

type ItemDetails = {
    id: number;
    customerId: number;
    displayName: string;
    folderPath: string;
    workflowStatus: 'pending' | 'clean' | 'rejected' | 'reviewed';
    comments: Array<{
        id: number;
        authorType: string;
        authorDisplay: string | null;
        message: string;
        createdAt: string | null;
    }>;
    versions: Array<{
        id: number;
        versionNo: number;
        createdAt: string | null;
        scanStatus: string;
    }>;
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

export default function DateiaustauschPage() {
    const [rows, setRows] = useState<ItemRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [details, setDetails] = useState<ItemDetails | null>(null);
    const [comment, setComment] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    async function loadRows() {
        setLoading(true);
        setError(null);
        try {
            const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
            const res = await fetch(`/api/plugins/dateiaustausch/items${query}`);
            const payload = await res.json().catch(() => ([]));
            if (!res.ok) throw new Error(payload?.error || 'Dateien konnten nicht geladen werden.');
            setRows(Array.isArray(payload) ? payload : []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Dateien konnten nicht geladen werden.');
        } finally {
            setLoading(false);
        }
    }

    async function loadDetails(itemId: number) {
        try {
            const res = await fetch(`/api/plugins/dateiaustausch/items/${itemId}`);
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Details konnten nicht geladen werden.');
            setDetails(payload as ItemDetails);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Details konnten nicht geladen werden.');
            setDetails(null);
        }
    }

    useEffect(() => {
        loadRows().catch(() => undefined);
    }, [statusFilter]);

    useEffect(() => {
        if (!selectedId) {
            setDetails(null);
            return;
        }
        loadDetails(selectedId).catch(() => undefined);
    }, [selectedId]);

    const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);

    async function updateStatus(itemId: number, status: ItemRow['workflowStatus']) {
        try {
            const res = await fetch(`/api/plugins/dateiaustausch/items/${itemId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Status konnte nicht aktualisiert werden.');
            await loadRows();
            if (selectedId === itemId) await loadDetails(itemId);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Status konnte nicht aktualisiert werden.');
        }
    }

    async function submitComment(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!selectedId || !comment.trim()) return;
        try {
            const res = await fetch(`/api/plugins/dateiaustausch/items/${selectedId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: comment.trim() }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || 'Kommentar konnte nicht gespeichert werden.');
            setComment('');
            await loadDetails(selectedId);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Kommentar konnte nicht gespeichert werden.');
        }
    }

    return (
        <div className="page-shell">
            <section className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                        <h1 className="page-title" style={{ marginBottom: 6 }}>Dateiaustausch</h1>
                        <p className="text-muted" style={{ margin: 0 }}>Sicherer Dateiaustausch mit Malware-Schutz, Versionierung und Kommentaren.</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select className="input" style={{ width: 180 }} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                            <option value="">Alle Stati</option>
                            <option value="pending">In Prüfung</option>
                            <option value="clean">Freigegeben</option>
                            <option value="reviewed">Geprüft</option>
                            <option value="rejected">Gesperrt</option>
                        </select>
                        <button className="btn btn-secondary" type="button" onClick={() => loadRows()}>Aktualisieren</button>
                    </div>
                </div>

                {error && <p className="text-danger" style={{ marginTop: 10 }}>{error}</p>}

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.1fr) minmax(320px, 1fr)', gap: 16, marginTop: 16 }}>
                    <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', background: 'var(--panel-muted)' }}>
                                    <th style={{ padding: '10px 12px' }}>Datei</th>
                                    <th style={{ padding: '10px 12px' }}>Kunde</th>
                                    <th style={{ padding: '10px 12px' }}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.id} style={{ borderTop: '1px solid var(--line)', cursor: 'pointer', background: row.id === selectedId ? 'rgba(45, 102, 228, 0.08)' : 'transparent' }} onClick={() => setSelectedId(row.id)}>
                                        <td style={{ padding: '10px 12px' }}>
                                            <strong>{row.displayName}</strong>
                                            <div className="text-muted" style={{ fontSize: 12 }}>{row.folderPath || 'Root'} • V{row.currentVersionNo || 0}</div>
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>{row.customerName || `#${row.customerId}`}</td>
                                        <td style={{ padding: '10px 12px' }}>{statusLabel(row.workflowStatus)}</td>
                                    </tr>
                                ))}
                                {!loading && rows.length === 0 && (
                                    <tr><td colSpan={3} style={{ padding: 18 }} className="text-muted">Keine Dateien gefunden.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
                        {!selectedRow || !details ? (
                            <p className="text-muted" style={{ margin: 0 }}>Datei links auswählen für Details.</p>
                        ) : (
                            <>
                                <h3 style={{ marginTop: 0 }}>{details.displayName}</h3>
                                <p className="text-muted" style={{ marginTop: 0 }}>Ordner: {details.folderPath || 'Root'}</p>
                                <p className="text-muted">Aktualisiert: {formatDate(selectedRow.updatedAt)}</p>

                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                                    <button className="btn btn-secondary" type="button" onClick={() => updateStatus(details.id, 'pending')}>In Prüfung</button>
                                    <button className="btn btn-secondary" type="button" onClick={() => updateStatus(details.id, 'clean')}>Freigeben</button>
                                    <button className="btn btn-secondary" type="button" onClick={() => updateStatus(details.id, 'reviewed')}>Geprüft</button>
                                    <button className="btn btn-danger" type="button" onClick={() => updateStatus(details.id, 'rejected')}>Sperren</button>
                                </div>

                                <h4 style={{ marginBottom: 8 }}>Versionen</h4>
                                <ul style={{ marginTop: 0, paddingLeft: 16 }}>
                                    {details.versions.map((version) => (
                                        <li key={version.id}>
                                            V{version.versionNo} • {statusLabel(version.scanStatus)} • {formatDate(version.createdAt)} • <a href={`/api/plugins/dateiaustausch/items/${details.id}/versions/${version.id}/download`} target="_blank" rel="noreferrer">Download</a>
                                        </li>
                                    ))}
                                </ul>

                                <h4 style={{ marginBottom: 8 }}>Kommentare</h4>
                                <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                                    {details.comments.length === 0 ? (
                                        <p className="text-muted" style={{ margin: 0 }}>Noch keine Kommentare.</p>
                                    ) : details.comments.map((entry) => (
                                        <div key={entry.id} style={{ marginBottom: 8 }}>
                                            <strong>{entry.authorDisplay || entry.authorType}</strong>
                                            <span className="text-muted" style={{ marginLeft: 8, fontSize: 12 }}>{formatDate(entry.createdAt)}</span>
                                            <p style={{ margin: '4px 0 0 0' }}>{entry.message}</p>
                                        </div>
                                    ))}
                                </div>

                                <form onSubmit={submitComment} className="vp-stack">
                                    <textarea className="input" value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="Kommentar für den Kunden" />
                                    <button className="btn btn-primary" type="submit">Kommentar speichern</button>
                                </form>
                            </>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}
