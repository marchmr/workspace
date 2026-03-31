import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from '@mike/hooks/usePluginNavigate';
import { apiFetch } from '@mike/context/AuthContext';

/* ════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════ */

const globeIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
);

const arrowIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

interface Quicklink {
    id: number;
    url: string;
    title: string;
    category: string;
    favicon_base64: string | null;
}

/* ════════════════════════════════════════════
   Tenant Quicklinks Tile
   viewMode: 'list' = vertikal | 'columns' = horizontal nebeneinander
   ════════════════════════════════════════════ */

export default function TenantQuicklinksTile({ viewMode = 'list' }: { viewMode?: string }) {
    const navigate = useNavigate();
    const [links, setLinks] = useState<Quicklink[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const res = await apiFetch('/api/plugins/quicklinks/tenant');
            if (res.ok) {
                const data = await res.json();
                setLinks(data.links || []);
            }
        } catch { /* */ }
        setLoading(false);
    }, []);

    useEffect(() => { void load(); }, [load]);

    if (loading) return <div className="text-muted" style={{ padding: 'var(--space-sm)' }}>Laden...</div>;

    // Nach Kategorie gruppieren
    const grouped = links.reduce<Record<string, Quicklink[]>>((acc, link) => {
        const cat = link.category || 'Allgemein';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(link);
        return acc;
    }, {});

    const categories = Object.keys(grouped).sort();

    const renderLinkItem = (link: Quicklink) => (
        <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 2px', textDecoration: 'none',
                color: 'var(--color-text)', fontSize: 'var(--font-size-sm)',
                borderRadius: 'var(--radius-sm)',
                transition: 'background 120ms ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
            {link.favicon_base64 ? (
                <img src={link.favicon_base64} alt="" width={16} height={16}
                    style={{ borderRadius: 2, flexShrink: 0 }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
            ) : (
                <span style={{ flexShrink: 0, display: 'flex' }}>{globeIcon}</span>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {link.title}
            </span>
        </a>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header */}
            <div
                onClick={() => navigate('/quicklinks')}
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 0 var(--space-sm) 0', marginBottom: 'var(--space-sm)',
                    cursor: 'pointer',
                }}
            >
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
                    Team-Links
                </span>
                {arrowIcon}
            </div>

            {links.length === 0 ? (
                <div className="text-muted"
                    style={{ textAlign: 'center', padding: 'var(--space-md)', fontSize: 'var(--font-size-sm)' }}>
                    Keine Team-Links vorhanden
                </div>
            ) : viewMode === 'columns' && categories.length > 1 ? (
                /* ── Spalten-Ansicht: Kategorien nebeneinander ── */
                <div style={{
                    display: 'flex', gap: 'var(--space-md)', flex: 1, overflow: 'auto',
                    flexWrap: 'wrap',
                }}>
                    {categories.map(cat => (
                        <div key={cat} style={{ flex: '1 1 0', minWidth: 100 }}>
                            <div style={{
                                fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)',
                                textTransform: 'uppercase', letterSpacing: '0.5px',
                                padding: '0 0 4px', marginBottom: 4,
                                borderBottom: '1px solid var(--color-border)',
                            }}>
                                {cat}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {grouped[cat].map(renderLinkItem)}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                /* ── Listen-Ansicht (default) ── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflow: 'auto' }}>
                    {categories.map(cat => (
                        <div key={cat}>
                            {categories.length > 1 && (
                                <div style={{
                                    fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)',
                                    textTransform: 'uppercase', letterSpacing: '0.5px',
                                    padding: '4px 0 2px', marginTop: 4,
                                }}>
                                    {cat}
                                </div>
                            )}
                            {grouped[cat].map(renderLinkItem)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
