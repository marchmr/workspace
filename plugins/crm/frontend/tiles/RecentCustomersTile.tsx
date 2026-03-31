import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@mike/hooks/usePluginNavigate';
import { apiFetch } from '@mike/context/AuthContext';

const arrowIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const companyIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/>
    </svg>
);

const personIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
);

interface RecentCustomer {
    id: number;
    customer_number: string;
    display_name: string;
    type: string;
    city: string | null;
    opened_at: string;
}

export default function RecentCustomersTile() {
    const navigate = useNavigate();
    const [recent, setRecent] = useState<RecentCustomer[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch('/api/plugins/crm/layout/recent')
            .then(async (res) => {
                if (res.ok) {
                    const data = await res.json();
                    setRecent(data.recent || []);
                }
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="text-muted" style={{ padding: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' }}>Laden...</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div
                onClick={() => navigate('/crm/customers')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-sm)', cursor: 'pointer' }}
            >
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Letzte Kunden</span>
                {arrowIcon}
            </div>

            {recent.length === 0 ? (
                <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)', textAlign: 'center', padding: 'var(--space-md)' }}>
                    Noch keine Kunden geöffnet
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflow: 'auto' }}>
                    {recent.slice(0, 8).map((c) => (
                        <div
                            key={c.id}
                            onClick={() => navigate(`/crm/customers/${c.id}`)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '4px 2px', cursor: 'pointer',
                                borderRadius: 'var(--radius-sm)',
                                transition: 'background 120ms ease', fontSize: 'var(--font-size-sm)',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                            <span style={{ display: 'flex', flexShrink: 0 }}>{c.type === 'company' ? companyIcon : personIcon}</span>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c.display_name}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>
                                {c.city || ''}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
