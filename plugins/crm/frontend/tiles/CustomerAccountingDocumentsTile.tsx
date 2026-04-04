import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@mike/context/AuthContext';

interface AccountingDocumentItem {
    recordKey: string;
    category: string;
    documentId: string;
    documentNumber: string;
    documentStatus: string;
    paymentStatus: string;
    amountTotal: number;
    amountPaid: number;
    amountOpen: number;
    currency: string;
    documentDate: string | null;
    dueDate: string | null;
    paidAt: string | null;
    hasPdf: boolean;
    updatedAt: string | null;
}

const categoryLabels: Record<string, string> = {
    rechnung: 'Rechnung',
    angebot: 'Angebot',
    mahnung: 'Mahnung',
    gutschrift: 'Gutschrift',
    storno: 'Storno',
};

function formatDate(value: string | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('de-DE');
}

function formatCurrency(amount: number, currency: string): string {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: currency || 'EUR',
    }).format(amount || 0);
}

function displayStatus(item: AccountingDocumentItem): string {
    const raw = String(item.paymentStatus || item.documentStatus || '').trim().toLowerCase();
    if (!raw) return '—';
    if (raw === 'paid') return 'bezahlt';
    if (raw === 'finalized') return 'gebucht';
    if (raw === 'open') return 'offen';
    if (raw === 'overdue') return 'überfällig';
    if (raw === 'partially_paid' || raw === 'partial') return 'teilbezahlt';
    return raw;
}

export default function CustomerAccountingDocumentsTile({
    customerId,
    category,
    title,
}: {
    customerId: number;
    category: 'rechnung' | 'angebot' | 'gutschrift' | 'mahnung' | 'storno';
    title: string;
}) {
    const [items, setItems] = useState<AccountingDocumentItem[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const res = await apiFetch(`/api/plugins/crm/customers/${customerId}/accounting-documents?category=${encodeURIComponent(category)}`);
            if (res.ok) {
                const data = await res.json();
                setItems(data.items || []);
            } else {
                setItems([]);
            }
        } catch {
            setItems([]);
        }
        setLoading(false);
    }, [category, customerId]);

    useEffect(() => {
        void load();
    }, [load]);

    const sorted = [...items].sort((a, b) => {
        const ad = new Date(a.documentDate || a.updatedAt || 0).getTime();
        const bd = new Date(b.documentDate || b.updatedAt || 0).getTime();
        return bd - ad;
    });

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{title} ({items.length})</span>
                <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => void load()}
                    style={{ fontSize: 11 }}
                >
                    Aktualisieren
                </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                {loading ? (
                    <div className="text-muted" style={{ padding: 12, textAlign: 'center', fontSize: 12 }}>Laden...</div>
                ) : sorted.length === 0 ? (
                    <div className="text-muted" style={{ padding: 12, textAlign: 'center', fontSize: 12 }}>Keine {title.toLowerCase()} für diesen Kunden gefunden</div>
                ) : sorted.map((item) => (
                    <div key={item.recordKey} style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                            <div style={{ fontWeight: 600 }}>{item.documentNumber || item.documentId}</div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{categoryLabels[item.category] || item.category}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap', fontSize: 11, color: 'var(--color-text-muted)' }}>
                            <span>Status: {displayStatus(item)}</span>
                            <span>Datum: {formatDate(item.documentDate)}</span>
                            <span>Bezahlt am: {formatDate(item.paidAt)}</span>
                            <span>Betrag: {formatCurrency(item.amountTotal, item.currency)}</span>
                            <span>Offen: {formatCurrency(item.amountOpen, item.currency)}</span>
                        </div>
                        {item.hasPdf ? (
                            <div style={{ marginTop: 6 }}>
                                <a
                                    className="btn btn-secondary btn-sm"
                                    href={`/api/plugins/crm/customers/${customerId}/accounting-documents/${encodeURIComponent(item.recordKey)}/pdf`}
                                >
                                    PDF herunterladen
                                </a>
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>
        </div>
    );
}
