import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@mike/hooks/usePluginNavigate';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';

/* ════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════ */

const searchIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);

const starIcon = (filled: boolean) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'var(--color-warning)' : 'none'} stroke={filled ? 'var(--color-warning)' : 'var(--color-text-muted)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
);

const companyIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/>
    </svg>
);

const personIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
);

const arrowRightIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const plusIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

interface CustomerPreview {
    id: number;
    customer_number: string;
    display_name: string;
    company_name: string | null;
    first_name: string | null;
    last_name: string | null;
    city: string | null;
    type: string;
    status: string;
    phone?: string;
}

interface CrmStats {
    customers_total: number;
    customers_active: number;
    customers_new_month: number;
    tickets_open: number;
    tickets_due_soon: number;
}

/* ════════════════════════════════════════════
   CRM Einstiegsseite
   ════════════════════════════════════════════ */

export default function CrmHomePage() {
    const navigate = useNavigate();
    const toast = useToast();
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<CustomerPreview[]>([]);
    const [searching, setSearching] = useState(false);
    const [favorites, setFavorites] = useState<CustomerPreview[]>([]);
    const [recent, setRecent] = useState<CustomerPreview[]>([]);
    const [stats, setStats] = useState<CrmStats | null>(null);
    const [loading, setLoading] = useState(true);

    const loadData = useCallback(async () => {
        try {
            const [favRes, recentRes, statsRes] = await Promise.all([
                apiFetch('/api/plugins/crm/layout/favorites'),
                apiFetch('/api/plugins/crm/layout/recent'),
                apiFetch('/api/plugins/crm/stats/'),
            ]);

            if (favRes.ok) {
                const d = await favRes.json();
                setFavorites(d.favorites || []);
            }
            if (recentRes.ok) {
                const d = await recentRes.json();
                setRecent(d.recent || []);
            }
            if (statsRes.ok) {
                setStats(await statsRes.json());
            }
        } catch { /* */ }
        setLoading(false);
    }, []);

    useEffect(() => { void loadData(); }, [loadData]);

    // Live-Suche mit Debounce
    useEffect(() => {
        if (searchQuery.length < 2) {
            setSearchResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setSearching(true);
            try {
                const res = await apiFetch(`/api/plugins/crm/customers/search?q=${encodeURIComponent(searchQuery)}`);
                if (res.ok) {
                    const data = await res.json();
                    setSearchResults(data.results || []);
                }
            } catch { /* */ }
            setSearching(false);
        }, 300);

        return () => clearTimeout(timer);
    }, [searchQuery]);

    const openCustomer = (id: number) => {
        navigate(`/crm/customers/${id}`);
    };

    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && searchResults.length > 0) {
            openCustomer(searchResults[0].id);
        }
    };

    const statusBadge = (status: string) => {
        const colors: Record<string, { bg: string; text: string; label: string }> = {
            active: { bg: 'var(--color-success-bg, rgba(34,197,94,0.1))', text: 'var(--color-success, #22c55e)', label: 'Aktiv' },
            inactive: { bg: 'var(--color-danger-bg, rgba(239,68,68,0.1))', text: 'var(--color-danger, #ef4444)', label: 'Inaktiv' },
            prospect: { bg: 'var(--color-warning-bg, rgba(234,179,8,0.1))', text: 'var(--color-warning, #eab308)', label: 'Interessent' },
        };
        const c = colors[status] || colors.active;
        return (
            <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: c.bg, color: c.text, fontWeight: 600 }}>
                {c.label}
            </span>
        );
    };

    if (loading) return <div className="text-muted" style={{ padding: 'var(--space-lg)' }}>Laden...</div>;

    return (
        <div>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 className="page-title">CRM</h1>
                    <p className="page-subtitle">Kundenverwaltung und Ticketsystem</p>
                </div>
                <button className="btn btn-primary" onClick={() => navigate('/crm/customers?new=1')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {plusIcon} Neuer Kunde
                </button>
            </div>

            {/* Suchfeld */}
            <div style={{ position: 'relative', marginBottom: 'var(--space-lg)' }}>
                <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>{searchIcon}</span>
                    <input
                        className="input"
                        placeholder="Kunden suchen... (Name, Nr., Telefon, E-Mail)"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        style={{ paddingLeft: 40, fontSize: 'var(--font-size-base)' }}
                        autoFocus
                    />
                </div>

                {/* Suchergebnisse Dropdown */}
                {searchQuery.length >= 2 && (
                    <div className="card" style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                        marginTop: 4, padding: 0, maxHeight: 300, overflow: 'auto',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                    }}>
                        {searching ? (
                            <div className="text-muted" style={{ padding: 'var(--space-md)', textAlign: 'center' }}>Suche...</div>
                        ) : searchResults.length === 0 ? (
                            <div className="text-muted" style={{ padding: 'var(--space-md)', textAlign: 'center' }}>Keine Treffer</div>
                        ) : (
                            searchResults.map((r, idx) => (
                                <div
                                    key={r.id}
                                    onClick={() => openCustomer(r.id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
                                        padding: 'var(--space-sm) var(--space-md)',
                                        cursor: 'pointer', transition: 'background 120ms ease',
                                        borderBottom: idx < searchResults.length - 1 ? '1px solid var(--color-border)' : 'none',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                >
                                    <span style={{ display: 'flex', flexShrink: 0 }}>{r.type === 'company' ? companyIcon : personIcon}</span>
                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {r.display_name}
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                                            {r.customer_number} {r.city ? `— ${r.city}` : ''} {r.phone ? `— ${r.phone}` : ''}
                                        </div>
                                    </div>
                                    {statusBadge(r.status)}
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Favoriten + Letzte Treffer */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
                {/* Favoriten */}
                <div className="card" style={{ padding: 'var(--space-md)' }}>
                    <div style={{ fontWeight: 600, marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {starIcon(true)} Favoriten
                    </div>
                    {favorites.length === 0 ? (
                        <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)', padding: 'var(--space-sm) 0' }}>
                            Noch keine Favoriten markiert
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {favorites.slice(0, 8).map((c) => (
                                <div
                                    key={c.id}
                                    onClick={() => openCustomer(c.id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
                                        padding: '4px 6px', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
                                        transition: 'background 120ms ease', fontSize: 'var(--font-size-sm)',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                >
                                    <span style={{ display: 'flex', flexShrink: 0 }}>{starIcon(true)}</span>
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {c.display_name}
                                    </span>
                                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{c.customer_number}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Letzte Treffer */}
                <div className="card" style={{ padding: 'var(--space-md)' }}>
                    <div style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>Letzte Treffer</div>
                    {recent.length === 0 ? (
                        <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)', padding: 'var(--space-sm) 0' }}>
                            Noch keine Kunden geöffnet
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {recent.slice(0, 8).map((c) => (
                                <div
                                    key={c.id}
                                    onClick={() => openCustomer(c.id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
                                        padding: '4px 6px', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
                                        transition: 'background 120ms ease', fontSize: 'var(--font-size-sm)',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                >
                                    <span style={{ display: 'flex', flexShrink: 0 }}>{c.type === 'company' ? companyIcon : personIcon}</span>
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {c.display_name}
                                    </span>
                                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{c.customer_number}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Statistiken */}
            {stats && (
                <div className="card" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
                    <div style={{ fontWeight: 600, marginBottom: 'var(--space-sm)' }}>Statistiken</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--space-md)' }}>
                        {[
                            { label: 'Kunden gesamt', value: stats.customers_total },
                            { label: 'Neukunden (Monat)', value: stats.customers_new_month },
                            { label: 'Aktive', value: stats.customers_active },
                            { label: 'Offene Tickets', value: stats.tickets_open },
                            { label: 'Fällige Aufgaben', value: stats.tickets_due_soon },
                        ].map((item) => (
                            <div key={item.label} style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, color: 'var(--color-primary)' }}>{item.value}</div>
                                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>{item.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Quick-Links */}
            <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                <button
                    className="btn btn-secondary"
                    onClick={() => navigate('/crm/customers')}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                    Alle Kunden anzeigen {arrowRightIcon}
                </button>
            </div>
        </div>
    );
}
