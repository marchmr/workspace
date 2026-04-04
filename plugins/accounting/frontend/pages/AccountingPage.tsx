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
    switch (status.toLowerCase()) {
        case 'finalized':
        case 'paid':
            return 'text-green-600';
        case 'open':
            return 'text-yellow-600';
        case 'overdue':
            return 'text-red-600';
        default:
            return 'text-gray-600';
    }
}

function DocumentTable({ documents, category }: { documents: AccountingDocument[], category: string }) {
    const filteredDocs = documents.filter(doc => doc.documentCategory === category);

    if (filteredDocs.length === 0) {
        return <p className="text-gray-500">Keine {category} gefunden.</p>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="min-w-full bg-white border border-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Nummer</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
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
                            <td className={`px-4 py-2 text-sm ${getStatusColor(doc.documentStatus)}`}>
                                {doc.documentStatus}
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
                                {doc.documentStatus === 'finalized' && (
                                    <button className="text-blue-600 hover:text-blue-800 underline">
                                        Download
                                    </button>
                                )}
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
                if (!docsResponse.ok) throw new Error(`Failed to load documents (${docsResponse.status})`);
                const docsData = await docsResponse.json();
                setDocuments(docsData.documents || []);

                // Kundendaten laden
                const customerResponse = await fetch(`${API_BASE}/customer?${qs}`);
                if (customerResponse.ok) {
                    const customerData = await customerResponse.json();
                    setCustomer(customerData.customer);
                }

            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error');
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
        <div className="max-w-6xl mx-auto p-4">
            {/* Kundendaten */}
            {customer && (
                <div className="bg-white shadow rounded-lg p-6 mb-6">
                    <h2 className="text-xl font-semibold mb-4">Kundendaten</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm text-gray-600">Name</p>
                            <p className="font-medium">{customer.name}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">Kundennummer</p>
                            <p className="font-medium">{customer.customerNumber}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">Adresse</p>
                            <p className="font-medium whitespace-pre-line">{customer.address}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">E-Mail</p>
                            <p className="font-medium">{customer.email || '-'}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Tabs für Dokumente */}
            <div className="bg-white shadow rounded-lg">
                <div className="border-b border-gray-200">
                    <nav className="flex">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                                    activeTab === tab.id
                                        ? 'border-blue-500 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                <div className="p-6">
                    <DocumentTable documents={documents} category={activeTab} />
                </div>
            </div>
        </div>
    );
}
