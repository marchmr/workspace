import { useState } from 'react';
import { useNavigate } from '@mike/hooks/usePluginNavigate';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';

/* ════════════════════════════════════════════
   Icons
   ════════════════════════════════════════════ */

const backIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
    </svg>
);

const csvIcon = (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>
    </svg>
);

const pdfIcon = (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h2"/><path d="M9 17h6"/>
    </svg>
);

const downloadIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
);

/* ════════════════════════════════════════════
   ExportPage
   ════════════════════════════════════════════ */

export default function ExportPage() {
    const navigate = useNavigate();
    const toast = useToast();

    const [statusFilter, setStatusFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [exporting, setExporting] = useState('');

    const buildParams = () => {
        const params = new URLSearchParams();
        if (statusFilter) params.set('status', statusFilter);
        if (typeFilter) params.set('type', typeFilter);
        if (categoryFilter) params.set('category', categoryFilter);
        return params.toString();
    };

    const handleExport = async (type: 'csv' | 'pdf-list') => {
        setExporting(type);
        try {
            const params = buildParams();
            const url = `/api/plugins/crm/io/export/${type}${params ? '?' + params : ''}`;
            const res = await apiFetch(url);

            if (!res.ok) {
                toast.error('Export fehlgeschlagen');
                setExporting('');
                return;
            }

            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);

            const contentDisposition = res.headers.get('Content-Disposition') || '';
            const fileMatch = contentDisposition.match(/filename="?([^"]+)"?/);
            a.download = fileMatch?.[1] || (type === 'csv' ? 'kunden_export.csv' : 'kundenliste.pdf');

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            toast.success('Export heruntergeladen');
        } catch { toast.error('Netzwerkfehler'); }
        setExporting('');
    };

    return (
        <div style={{ padding: 'var(--space-md)', maxWidth: 800, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
                <button onClick={() => navigate('/crm/customers')} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {backIcon}
                </button>
                <div>
                    <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Export</h1>
                    <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>Kunden als CSV oder PDF exportieren</span>
                </div>
            </div>

            {/* Filter */}
            <div className="card" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <div style={{ fontWeight: 600, marginBottom: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' }}>Filter (optional)</div>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <div>
                        <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 2 }}>Status</label>
                        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 140 }}>
                            <option value="">Alle</option>
                            <option value="active">Aktiv</option>
                            <option value="inactive">Inaktiv</option>
                            <option value="prospect">Interessent</option>
                        </select>
                    </div>
                    <div>
                        <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 2 }}>Typ</label>
                        <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: 120 }}>
                            <option value="">Alle</option>
                            <option value="company">Firma</option>
                            <option value="person">Person</option>
                        </select>
                    </div>
                    <div>
                        <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 2 }}>Kategorie</label>
                        <input className="input" placeholder="z.B. Premium" value={categoryFilter}
                            onChange={(e) => setCategoryFilter(e.target.value)} style={{ width: 140 }} />
                    </div>
                </div>
            </div>

            {/* Export-Karten */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                {/* CSV Export */}
                <div className="card" style={{
                    padding: 'var(--space-lg)', textAlign: 'center', cursor: 'pointer',
                    transition: 'transform 150ms, box-shadow 150ms',
                    border: '2px solid transparent',
                }}
                    onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'none'; }}
                    onClick={() => !exporting && handleExport('csv')}
                >
                    <div style={{ color: 'var(--color-primary)', marginBottom: 'var(--space-sm)', display: 'flex', justifyContent: 'center' }}>{csvIcon}</div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>CSV-Export</div>
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-md)' }}>
                        Alle Kunden als CSV-Datei mit Semikolon-Trennung. Kompatibel mit Excel, LibreOffice und Google Sheets.
                    </div>
                    <button className="btn btn-primary btn-sm" disabled={!!exporting}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {downloadIcon} {exporting === 'csv' ? 'Exportiere...' : 'CSV herunterladen'}
                    </button>
                </div>

                {/* PDF Kundenliste */}
                <div className="card" style={{
                    padding: 'var(--space-lg)', textAlign: 'center', cursor: 'pointer',
                    transition: 'transform 150ms, box-shadow 150ms',
                    border: '2px solid transparent',
                }}
                    onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--color-danger)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'none'; }}
                    onClick={() => !exporting && handleExport('pdf-list')}
                >
                    <div style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-sm)', display: 'flex', justifyContent: 'center' }}>{pdfIcon}</div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>PDF-Kundenliste</div>
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-md)' }}>
                        Übersichtliche Tabelle aller Kunden im Querformat. Ideal für Druck oder Archivierung.
                    </div>
                    <button className="btn btn-sm" disabled={!!exporting}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--color-danger)', color: 'white' }}>
                        {downloadIcon} {exporting === 'pdf-list' ? 'Exportiere...' : 'PDF herunterladen'}
                    </button>
                </div>
            </div>

            {/* Info */}
            <div style={{ marginTop: 'var(--space-lg)', padding: 'var(--space-md)', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                <strong>Tipp:</strong> Einzelne Kundenakten können direkt aus der Kundenakte als PDF exportiert werden (inkl. Kontakte, Tickets und Notizen).
            </div>
        </div>
    );
}
