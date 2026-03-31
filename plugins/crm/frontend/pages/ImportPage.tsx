import { useState, useCallback } from 'react';
import { useNavigate } from '@mike/hooks/usePluginNavigate';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';

/* ════════════════════════════════════════════
   Icons
   ════════════════════════════════════════════ */

const uploadIcon = (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
);

const backIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
    </svg>
);

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

type Step = 'upload' | 'mapping' | 'preview' | 'result';

interface PreviewData {
    headers: string[];
    mapping: Record<string, string>;
    unmapped: string[];
    totalRows: number;
    preview: Record<string, string>[];
    availableFields: { value: string; label: string }[];
}

interface ImportResult {
    imported: number;
    skipped: number;
    errors: { row: number; reason: string }[];
    totalRows: number;
}

/* ════════════════════════════════════════════
   ImportPage
   ════════════════════════════════════════════ */

export default function ImportPage() {
    const navigate = useNavigate();
    const toast = useToast();

    const [step, setStep] = useState<Step>('upload');
    const [csvContent, setCsvContent] = useState('');
    const [delimiter, setDelimiter] = useState(';');
    const [fileName, setFileName] = useState('');
    const [loading, setLoading] = useState(false);
    const [previewData, setPreviewData] = useState<PreviewData | null>(null);
    const [mapping, setMapping] = useState<Record<string, string>>({});
    const [skipDuplicates, setSkipDuplicates] = useState(true);
    const [defaultType, setDefaultType] = useState('company');
    const [defaultStatus, setDefaultStatus] = useState('active');
    const [result, setResult] = useState<ImportResult | null>(null);

    // Datei lesen
    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setFileName(file.name);

        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;
            setCsvContent(text);
        };
        reader.readAsText(file, 'UTF-8');
    };

    // Vorschau laden
    const handlePreview = async () => {
        if (!csvContent.trim()) { toast.error('Keine CSV-Daten'); return; }
        setLoading(true);
        try {
            const res = await apiFetch('/api/plugins/crm/io/import/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ csv_content: csvContent, delimiter }),
            });
            if (res.ok) {
                const data = await res.json();
                setPreviewData(data);
                setMapping(data.mapping || {});
                setStep('mapping');
            } else {
                const err = await res.json();
                toast.error(err.error || 'CSV konnte nicht gelesen werden');
            }
        } catch { toast.error('Netzwerkfehler'); }
        setLoading(false);
    };

    // Import ausführen
    const handleImport = async () => {
        setLoading(true);
        try {
            const res = await apiFetch('/api/plugins/crm/io/import/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    csv_content: csvContent,
                    delimiter,
                    mapping,
                    skip_duplicates: skipDuplicates,
                    default_type: defaultType,
                    default_status: defaultStatus,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                setResult(data);
                setStep('result');
                toast.success(`${data.imported} Kunden importiert`);
            } else {
                const err = await res.json();
                toast.error(err.error || 'Import fehlgeschlagen');
            }
        } catch { toast.error('Netzwerkfehler'); }
        setLoading(false);
    };

    // Mapping ändern
    const updateMapping = (csvHeader: string, dbField: string) => {
        setMapping(prev => {
            const next = { ...prev };
            if (dbField === '') {
                delete next[csvHeader];
            } else {
                next[csvHeader] = dbField;
            }
            return next;
        });
    };

    const mappedCount = Object.keys(mapping).length;

    return (
        <div style={{ padding: 'var(--space-md)', maxWidth: 1000, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-lg)' }}>
                <button onClick={() => navigate('/crm/customers')} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {backIcon}
                </button>
                <div>
                    <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>CSV-Import</h1>
                    <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>Kunden aus CSV-Datei importieren</span>
                </div>
            </div>

            {/* Schritt-Indikator */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--space-lg)' }}>
                {(['upload', 'mapping', 'preview', 'result'] as Step[]).map((s, i) => (
                    <div key={s} style={{
                        flex: 1, height: 4, borderRadius: 2,
                        background: ['upload', 'mapping', 'preview', 'result'].indexOf(step) >= i ? 'var(--color-primary)' : 'var(--color-border)',
                        transition: 'background 200ms',
                    }} />
                ))}
            </div>

            {/* Step 1: Upload */}
            {step === 'upload' && (
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                    <div style={{
                        border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-xl)', textAlign: 'center', marginBottom: 'var(--space-md)',
                        transition: 'border-color 200ms',
                    }}>
                        <div style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-sm)' }}>{uploadIcon}</div>
                        <div style={{ fontWeight: 500, marginBottom: 4 }}>
                            {fileName ? fileName : 'CSV-Datei auswaehlen'}
                        </div>
                        <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-sm)' }}>
                            Unterstützt: .csv mit Semikolon oder Komma als Trennzeichen
                        </div>
                        <input type="file" accept=".csv,.txt" onChange={handleFile}
                            style={{ display: 'block', margin: '0 auto', fontSize: 'var(--font-size-sm)' }} />
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                        <div>
                            <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Trennzeichen</label>
                            <select className="input" value={delimiter} onChange={(e) => setDelimiter(e.target.value)}
                                style={{ display: 'block', marginTop: 4, width: 120 }}>
                                <option value=";">Semikolon (;)</option>
                                <option value=",">Komma (,)</option>
                                <option value="\t">Tab</option>
                            </select>
                        </div>
                    </div>

                    {csvContent && (
                        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-sm)' }}>
                            Dateigroesse: {(csvContent.length / 1024).toFixed(1)} KB
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="btn btn-primary" onClick={handlePreview} disabled={loading || !csvContent}>
                            {loading ? 'Analysiere...' : 'Weiter zur Feldzuordnung'}
                        </button>
                    </div>
                </div>
            )}

            {/* Step 2: Mapping */}
            {step === 'mapping' && previewData && (
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                    <div style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>
                        Feldzuordnung ({mappedCount} von {previewData.headers.length} Spalten zugeordnet)
                    </div>
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-md)' }}>
                        {previewData.totalRows} Zeilen erkannt. Ordne die CSV-Spalten den CRM-Feldern zu.
                    </div>

                    <div style={{ maxHeight: 400, overflow: 'auto', marginBottom: 'var(--space-md)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>CSV-Spalte</th>
                                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>CRM-Feld</th>
                                    <th style={{ padding: '6px 8px', textAlign: 'left' }}>Beispiel</th>
                                </tr>
                            </thead>
                            <tbody>
                                {previewData.headers.map((h) => (
                                    <tr key={h} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '6px 8px', fontWeight: 500 }}>{h}</td>
                                        <td style={{ padding: '6px 8px' }}>
                                            <select className="input" value={mapping[h] || ''}
                                                onChange={(e) => updateMapping(h, e.target.value)}
                                                style={{ fontSize: 12, padding: '3px 6px', minWidth: 150 }}>
                                                <option value="">— Nicht importieren —</option>
                                                {previewData.availableFields.map(f => (
                                                    <option key={f.value} value={f.value}>{f.label}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td style={{ padding: '6px 8px', color: 'var(--color-text-muted)', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {previewData.preview[0]?.[h] || '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Einstellungen */}
                    <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', marginBottom: 'var(--space-md)', padding: 'var(--space-sm)', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
                            Duplikate überspringen (per E-Mail)
                        </label>
                        <div style={{ fontSize: 'var(--font-size-sm)' }}>
                            <span style={{ fontWeight: 500 }}>Standard-Typ:</span>
                            <select className="input" value={defaultType} onChange={(e) => setDefaultType(e.target.value)}
                                style={{ marginLeft: 6, fontSize: 12, padding: '2px 4px' }}>
                                <option value="company">Firma</option>
                                <option value="person">Person</option>
                            </select>
                        </div>
                        <div style={{ fontSize: 'var(--font-size-sm)' }}>
                            <span style={{ fontWeight: 500 }}>Standard-Status:</span>
                            <select className="input" value={defaultStatus} onChange={(e) => setDefaultStatus(e.target.value)}
                                style={{ marginLeft: 6, fontSize: 12, padding: '2px 4px' }}>
                                <option value="active">Aktiv</option>
                                <option value="prospect">Interessent</option>
                                <option value="inactive">Inaktiv</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <button className="btn btn-secondary" onClick={() => setStep('upload')}>Zurück</button>
                        <button className="btn btn-primary" onClick={() => setStep('preview')} disabled={mappedCount === 0}>
                            Vorschau anzeigen
                        </button>
                    </div>
                </div>
            )}

            {/* Step 3: Preview */}
            {step === 'preview' && previewData && (
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                    <div style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>
                        Import-Vorschau (erste 10 von {previewData.totalRows} Zeilen)
                    </div>

                    <div style={{ overflow: 'auto', maxHeight: 400, marginBottom: 'var(--space-md)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                                    <th style={{ padding: '4px 6px', textAlign: 'left' }}>#</th>
                                    {Object.entries(mapping).map(([csv, db]) => (
                                        <th key={csv} style={{ padding: '4px 6px', textAlign: 'left' }}>
                                            <div style={{ fontSize: 10, color: 'var(--color-primary)' }}>{db}</div>
                                            <div style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>{csv}</div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {previewData.preview.map((row, i) => (
                                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={{ padding: '4px 6px', color: 'var(--color-text-muted)' }}>{i + 1}</td>
                                        {Object.keys(mapping).map(csv => (
                                            <td key={csv} style={{ padding: '4px 6px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {row[csv] || '—'}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ padding: 'var(--space-sm)', background: 'rgba(var(--color-primary-rgb, 99,102,241), 0.06)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-md)', fontSize: 'var(--font-size-sm)' }}>
                        <strong>{previewData.totalRows}</strong> Zeilen werden importiert mit <strong>{mappedCount}</strong> Feldern.
                        {skipDuplicates && ' Duplikate (gleiche E-Mail) werden übersprungen.'}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <button className="btn btn-secondary" onClick={() => setStep('mapping')}>Zurück</button>
                        <button className="btn btn-primary" onClick={handleImport} disabled={loading}>
                            {loading ? 'Importiere...' : `${previewData.totalRows} Kunden importieren`}
                        </button>
                    </div>
                </div>
            )}

            {/* Step 4: Result */}
            {step === 'result' && result && (
                <div className="card" style={{ padding: 'var(--space-lg)' }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-md)', color: result.imported > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        Import abgeschlossen
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                        <div style={{ padding: 'var(--space-md)', background: 'rgba(34,197,94,0.08)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-success)' }}>{result.imported}</div>
                            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Importiert</div>
                        </div>
                        <div style={{ padding: 'var(--space-md)', background: 'rgba(234,179,8,0.08)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-warning)' }}>{result.skipped}</div>
                            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Übersprungen</div>
                        </div>
                        <div style={{ padding: 'var(--space-md)', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                            <div style={{ fontSize: 28, fontWeight: 700 }}>{result.totalRows}</div>
                            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Gesamt</div>
                        </div>
                    </div>

                    {result.errors.length > 0 && (
                        <div style={{ marginBottom: 'var(--space-md)' }}>
                            <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)', marginBottom: 4, color: 'var(--color-danger)' }}>
                                Fehler ({result.errors.length})
                            </div>
                            <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 11, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-sm)' }}>
                                {result.errors.map((e, i) => (
                                    <div key={i} style={{ padding: '2px 0' }}>
                                        <span style={{ color: 'var(--color-text-muted)' }}>Zeile {e.row}:</span> {e.reason}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary" onClick={() => { setStep('upload'); setCsvContent(''); setFileName(''); setResult(null); }}>
                            Weiteren Import
                        </button>
                        <button className="btn btn-primary" onClick={() => navigate('/crm/customers')}>
                            Zur Kundenliste
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
