import { useEffect, useState } from 'react';
import '../../../kundenportal/frontend/kundenportal.css'; // Stil vom Kundenportal uebernehmen

interface AccountingDocument {
    id: string;
    eventId: string;
    documentCategory: string;
    documentId: string;
    documentNumber: string;
    documentStatus: string;
    amountTotal: number;
    currency: string;
    paymentStatus: string;
    amountPaid: number;
    amountOpen: number;
    documentDate: string;
    dueDate: string | null;
    paidAt: string | null;
    finalizedAt: string | null;
    createdAt: string;
    hasPdf?: boolean;
}

interface CustomerData {
    id: number;
    name: string;
    customerNumber: string;
    address: string;
    kind: string;
    contactPerson: string | null;
    email: string | null;
}

const API_BASE = '/api/plugins/accounting';
interface AccountingPageProps {
    sessionToken?: string;
}

function formatCurrency(amount: number, currency: string): string {
    return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: currency || 'EUR',
    }).format(amount);
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    return new Intl.DateTimeFormat('de-DE').format(new Date(dateStr));
}

function getStatusColor(status: string): string {
    const normalized = status.toLowerCase();
    switch (normalized) {
        case 'finalized':
        case 'gebucht':
        case 'paid':
        case 'bezahlt':
            return 'text-green-600';
        case 'open':
        case 'offen':
        case 'teilbezahlt':
            return 'text-yellow-600';
        case 'overdue':
        case 'überfällig':
            return 'text-red-600';
        default:
            return 'text-gray-600';
    }
}

function displayPaymentStatus(doc: AccountingDocument): string {
    const raw = String(doc.paymentStatus || doc.documentStatus || '').trim().toLowerCase();
    if (!raw) return '-';

    if (raw === 'finalized') return 'gebucht';
    if (raw === 'paid') return 'bezahlt';
    if (raw === 'partially_paid' || raw === 'partial' || raw === 'partly_paid') return 'teilbezahlt';
    if (raw === 'open') return 'offen';
    if (raw === 'overdue') return 'überfällig';
    if (raw === 'cancelled') return 'storniert';
    if (raw === 'draft') return 'entwurf';
    if (raw === 'sent') return 'versendet';

    if (doc.amountOpen > 0 && doc.amountPaid > 0) {
        return 'teilbezahlt';
    }
    if (doc.amountOpen <= 0 && doc.amountPaid > 0) {
        return 'bezahlt';
    }

    return raw;
}

function DocumentTable({ documents, category, sessionToken }: { documents: AccountingDocument[], category: string, sessionToken?: string }) {
    const filteredDocs = documents.filter(doc => doc.documentCategory === category);

    if (filteredDocs.length === 0) {
        return <p className="text-gray-500">Keine Dokumente in dieser Kategorie gefunden.</p>;
    }

    return (
        <div className="table-container">
            <table className="min-w-full bg-white border border-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Nummer</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Bezahlt am</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Betrag</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Bezahlt</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Offen</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">PDF</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {filteredDocs.map((doc) => (
                        <tr key={doc.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-sm text-gray-900">{doc.documentNumber}</td>
                            <td className="px-4 py-2 text-sm text-gray-900">{formatDate(doc.documentDate)}</td>
                            <td className={`px-4 py-2 text-sm ${getStatusColor(displayPaymentStatus(doc))}`}>
                                {displayPaymentStatus(doc)}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-900">
                                {formatDate(doc.paidAt)}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-900">
                                {formatCurrency(doc.amountTotal, doc.currency)}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-900">
                                {formatCurrency(doc.amountPaid, doc.currency)}
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-900">
                                {formatCurrency(doc.amountOpen, doc.currency)}
                            </td>
                            <td className="px-4 py-2 text-sm">
                                {doc.hasPdf && sessionToken ? (
                                    <a
                                        className="btn btn-secondary btn-sm"
                                        href={`${API_BASE}/documents/${encodeURIComponent(doc.id)}/pdf?sessionToken=${encodeURIComponent(sessionToken)}`}
                                    >
                                        Herunterladen
                                    </a>
                                ) : null}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function AccountingPage({ sessionToken }: AccountingPageProps) {
    const [documents, setDocuments] = useState<AccountingDocument[]>([]);
    const [customer, setCustomer] = useState<CustomerData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState('rechnung');

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                setError(null);

                if (!sessionToken) {
                    setDocuments([]);
                    setCustomer(null);
                    setError('Session-Token fehlt');
                    return;
                }

                const qs = `sessionToken=${encodeURIComponent(sessionToken)}`;

                // Dokumente laden
                const docsResponse = await fetch(`${API_BASE}/documents?${qs}`);
                if (!docsResponse.ok) throw new Error(`Dokumente konnten nicht geladen werden (${docsResponse.status})`);
                const docsData = await docsResponse.json();
                setDocuments(docsData.documents || []);

                // Kundendaten laden
                const customerResponse = await fetch(`${API_BASE}/customer?${qs}`);
                if (customerResponse.ok) {
                    const customerData = await customerResponse.json();
                    setCustomer(customerData.customer);
                }

            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [sessionToken]);

    if (loading) {
        return <div className="p-4">Laden...</div>;
    }

    if (error) {
        return <div className="p-4 text-red-600">Fehler: {error}</div>;
    }

    const tabs = [
        { id: 'rechnung', label: 'Rechnungen' },
        { id: 'angebot', label: 'Angebote' },
        { id: 'gutschrift', label: 'Gutschriften' },
        { id: 'storno', label: 'Stornos' },
        { id: 'mahnung', label: 'Mahnungen' },
    ];

    return (
        <div className="kp-page">
        <div className="max-w-6xl mx-auto p-4">
            {/* Kundendaten */}
            {customer && (
                <div className="bg-white shadow rounded-lg p-6 mb-6">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <h2 className="text-xl font-semibold">Kundendaten</h2>
                        <span className="text-xs text-gray-500" style={{ padding: '4px 10px', border: '1px solid #e5e7eb', borderRadius: 999 }}>
                            {customer.kind === 'person' ? 'Person' : 'Firma'}
                        </span>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-2 text-sm">
                            <div className="text-gray-500">Name</div>
                            <div className="font-medium text-gray-900">{customer.name || '-'}</div>

                            <div className="text-gray-500">Kundennummer</div>
                            <div className="font-medium text-gray-900">{customer.customerNumber || '-'}</div>

                            <div className="text-gray-500">E-Mail</div>
                            <div className="font-medium text-gray-900 break-all">{customer.email || '-'}</div>

                            <div className="text-gray-500">Ansprechperson</div>
                            <div className="font-medium text-gray-900">{customer.contactPerson || '-'}</div>

                            <div className="text-gray-500 md:col-span-2" style={{ marginTop: 6 }}>Adresse</div>
                            <div className="font-medium text-gray-900 md:col-span-2 whitespace-pre-line">
                                {customer.address || '-'}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Tabs für Dokumente */}
            <div className="bg-white shadow rounded-lg">
                <div className="border-b border-gray-200">
                    <nav className="flex" style={{ gap: 'var(--space-xs)', padding: 'var(--space-sm)' }}>
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-secondary'}`}
                                style={{ minWidth: 132 }}
                                type="button"
                            >
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                <div className="p-6">
                    <DocumentTable documents={documents} category={activeTab} sessionToken={sessionToken} />
                </div>
            </div>
        </div>
        </div>
    );
}
