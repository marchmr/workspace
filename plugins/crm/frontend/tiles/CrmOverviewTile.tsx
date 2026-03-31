import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@mike/hooks/usePluginNavigate';
import { apiFetch } from '@mike/context/AuthContext';

const arrowIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

interface CrmStats {
    customers_total: number;
    customers_active: number;
    customers_new_month: number;
    tickets_open: number;
    tickets_due_soon: number;
}

export default function CrmOverviewTile() {
    const navigate = useNavigate();
    const [stats, setStats] = useState<CrmStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch('/api/plugins/crm/stats/')
            .then(async (res) => {
                if (res.ok) setStats(await res.json());
            })
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="text-muted" style={{ padding: 'var(--space-sm)', fontSize: 'var(--font-size-sm)' }}>Laden...</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div
                onClick={() => navigate('/crm')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-sm)', cursor: 'pointer' }}
            >
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>CRM Übersicht</span>
                {arrowIcon}
            </div>

            {stats ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)', flex: 1 }}>
                    {[
                        { label: 'Kunden', value: stats.customers_total, color: 'var(--color-primary)' },
                        { label: 'Neu (Monat)', value: stats.customers_new_month, color: '#22c55e' },
                        { label: 'Aktive', value: stats.customers_active, color: 'var(--color-text)' },
                        { label: 'Offene Tickets', value: stats.tickets_open, color: '#f59e0b' },
                    ].map((item) => (
                        <div key={item.label} style={{ textAlign: 'center', padding: '4px 0' }}>
                            <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: item.color }}>{item.value}</div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{item.label}</div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>Keine Daten</div>
            )}
        </div>
    );
}
