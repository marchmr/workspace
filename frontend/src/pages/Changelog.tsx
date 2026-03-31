import { useEffect, useState } from 'react';
import { apiFetch } from '../context/AuthContext';

interface ChangelogEntry {
    version: string;
    date: string;
    changes: string[];
    plugin?: string;
    pluginName?: string;
}

/* ── Typ (Übergeordnet) ── */
const TYPES: Record<string, { label: string; color: string; bg: string }> = {
    neu:      { label: 'Neu',      color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
    fix:      { label: 'Fix',      color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
    entfernt: { label: 'Entfernt', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
};

/* ── Kategorie → Farbe + Label ── */
const CATEGORIES: Record<string, { label: string; color: string; bg: string }> = {
    security:  { label: 'Sicherheit', color: '#dc2626', bg: 'rgba(220,38,38,0.10)' },
    sicherheit:{ label: 'Sicherheit', color: '#dc2626', bg: 'rgba(220,38,38,0.10)' },
    ui:        { label: 'UI/UX',      color: '#8b5cf6', bg: 'rgba(139,92,246,0.10)' },
    auth:      { label: 'Auth',       color: '#0891b2', bg: 'rgba(8,145,178,0.10)' },
    docs:      { label: 'Docs',       color: '#16a34a', bg: 'rgba(22,163,74,0.10)' },
    plugin:    { label: 'Plugin',     color: '#d97706', bg: 'rgba(217,119,6,0.10)' },
    api:       { label: 'API',        color: '#2563eb', bg: 'rgba(37,99,235,0.10)' },
    admin:     { label: 'Admin',      color: '#7c3aed', bg: 'rgba(124,58,237,0.10)' },
    core:      { label: 'Core',       color: '#475569', bg: 'rgba(71,85,105,0.10)' },
    locking:   { label: 'Locking',    color: '#ca8a04', bg: 'rgba(202,138,4,0.10)' },
};

interface ParsedChange {
    type: string;       // neu | fix | entfernt | ''
    category: string;   // security | ui | ... | ''
    catMeta: typeof CATEGORIES[string] | null;
    text: string;
}

function parseChange(raw: string): ParsedChange {
    let type = '';
    let remaining = raw;

    // Prüfe ob [Neu], [Fix], [Entfernt] am Anfang steht
    const typeMatch = remaining.match(/^\[(Neu|Fix|Entfernt)\]\s*/i);
    if (typeMatch) {
        type = typeMatch[1].toLowerCase();
        remaining = remaining.substring(typeMatch[0].length);
    }

    // Prüfe Kategorie-Prefix (z.B. "Security: ...")
    let category = '';
    let catMeta: typeof CATEGORIES[string] | null = null;
    const colonIdx = remaining.indexOf(':');
    if (colonIdx > 0 && colonIdx < 20) {
        const prefix = remaining.substring(0, colonIdx).toLowerCase().trim().replace(/[- ]/g, '');
        const match = CATEGORIES[prefix];
        if (match) {
            category = prefix;
            catMeta = match;
            remaining = remaining.substring(colonIdx + 1).trim();
        }
    }

    return { type, category, catMeta, text: remaining };
}

function formatDate(dateStr: string): string {
    try {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

/* ── SVGs ── */
const TagIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
);

const CalendarIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         style={{ transition: 'transform var(--transition-fast)', transform: open ? 'rotate(90deg)' : 'rotate(0)' }}>
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const PlusIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

const WrenchIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
    </svg>
);

const TrashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
);

const TYPE_ICONS: Record<string, React.ReactNode> = {
    neu: <PlusIcon />,
    fix: <WrenchIcon />,
    entfernt: <TrashIcon />,
};

export default function Changelog() {
    const [entries, setEntries] = useState<ChangelogEntry[]>([]);
    const [currentVersion, setCurrentVersion] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    useEffect(() => {
        (async () => {
            try {
                const res = await apiFetch('/api/changelog');
                if (res.ok) {
                    const data = await res.json();
                    setEntries(data.entries || []);
                    setCurrentVersion(data.version || '');
                    const autoCollapse = new Set<string>();
                    (data.entries || []).forEach((e: ChangelogEntry, i: number) => {
                        if (i >= 5) {
                            const key = e.plugin ? `${e.plugin}-${e.version}` : e.version;
                            autoCollapse.add(key);
                        }
                    });
                    setCollapsed(autoCollapse);
                }
            } catch { /* Fallback: leere Liste */ }
            setLoading(false);
        })();
    }, []);

    const toggleCollapse = (version: string) => {
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(version)) next.delete(version);
            else next.add(version);
            return next;
        });
    };

    const isCurrent = (version: string) => version === currentVersion;

    /* ── Render einer Änderungsliste nach Typ+Kategorie ── */
    const renderChanges = (changes: string[]) => {
        const parsed = changes.map(parseChange);

        // Gruppiere nach Typ
        const byType: Record<string, ParsedChange[]> = {};
        const untyped: ParsedChange[] = [];

        parsed.forEach(p => {
            if (p.type && TYPES[p.type]) {
                if (!byType[p.type]) byType[p.type] = [];
                byType[p.type].push(p);
            } else {
                untyped.push(p);
            }
        });

        const typeOrder = ['neu', 'fix', 'entfernt'];
        const hasTypes = Object.keys(byType).length > 0;

        return (
            <div className="changelog-card-body">
                {/* Typisierte Änderungen */}
                {typeOrder.map(typeKey => {
                    const items = byType[typeKey];
                    if (!items || items.length === 0) return null;
                    const typeMeta = TYPES[typeKey];

                    // Innerhalb des Typs nach Kategorie gruppieren
                    const byCat: Record<string, { meta: typeof CATEGORIES[string]; items: string[] }> = {};
                    const uncategorized: string[] = [];

                    items.forEach(item => {
                        if (item.catMeta) {
                            if (!byCat[item.category]) byCat[item.category] = { meta: item.catMeta, items: [] };
                            byCat[item.category].items.push(item.text);
                        } else {
                            uncategorized.push(item.text);
                        }
                    });

                    return (
                        <div key={typeKey} className="changelog-type-section" style={{ borderLeft: `3px solid ${typeMeta.color}`, paddingLeft: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                color: typeMeta.color, fontWeight: 700,
                                fontSize: 'var(--font-size-sm)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                marginBottom: 'var(--space-sm)',
                            }}>
                                {TYPE_ICONS[typeKey]}
                                {typeMeta.label}
                                <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 'var(--font-size-xs)' }}>
                                    ({items.length})
                                </span>
                            </div>

                            {/* Kategorie-Gruppen innerhalb des Typs */}
                            {Object.entries(byCat).map(([catKey, group]) => (
                                <div key={catKey} className="changelog-group">
                                    <div className="changelog-group-label" style={{ color: group.meta.color, backgroundColor: group.meta.bg }}>
                                        <TagIcon /> {group.meta.label}
                                    </div>
                                    <ul className="changelog-list">
                                        {group.items.map((item, j) => (
                                            <li key={j}>{item}</li>
                                        ))}
                                    </ul>
                                </div>
                            ))}

                            {/* Unkategorisierte innerhalb des Typs */}
                            {uncategorized.length > 0 && (
                                <ul className="changelog-list">
                                    {uncategorized.map((item, j) => (
                                        <li key={j}>{item}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    );
                })}

                {/* Untypisierte Änderungen (Legacy-Format / Rückwärtskompatibel) */}
                {untyped.length > 0 && (
                    <div>
                        {(() => {
                            const grouped: Record<string, { meta: typeof CATEGORIES[string]; items: string[] }> = {};
                            const plain: string[] = [];
                            untyped.forEach(p => {
                                if (p.catMeta) {
                                    if (!grouped[p.category]) grouped[p.category] = { meta: p.catMeta, items: [] };
                                    grouped[p.category].items.push(p.text);
                                } else {
                                    plain.push(p.text);
                                }
                            });
                            return (
                                <>
                                    {Object.entries(grouped).map(([key, group]) => (
                                        <div key={key} className="changelog-group">
                                            <div className="changelog-group-label" style={{ color: group.meta.color, backgroundColor: group.meta.bg }}>
                                                <TagIcon /> {group.meta.label}
                                            </div>
                                            <ul className="changelog-list">
                                                {group.items.map((item, j) => (
                                                    <li key={j}>{item}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                    {plain.length > 0 && (
                                        <ul className="changelog-list">
                                            {plain.map((item, j) => (
                                                <li key={j}>{item}</li>
                                            ))}
                                        </ul>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                )}

                {/* Fallback wenn gar kein hasTypes und kein untyped */}
                {!hasTypes && untyped.length === 0 && (
                    <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>Keine Änderungen.</p>
                )}
            </div>
        );
    };

    return (
        <div className="changelog-page">
            {/* ── Header ── */}
            <div className="changelog-header">
                <div className="changelog-header-icon">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 8v4l3 3" />
                        <circle cx="12" cy="12" r="10" />
                    </svg>
                </div>
                <h1 className="changelog-title">Changelog</h1>
                <p className="changelog-subtitle">
                    Versionshistorie und Änderungen
                    {currentVersion && (
                        <span className="changelog-current-badge">v{currentVersion}</span>
                    )}
                </p>
            </div>

            {/* ── Loading ── */}
            {loading && (
                <div className="changelog-container">
                    <div className="changelog-loading">
                        <div className="changelog-loading-pulse" />
                        <div className="changelog-loading-pulse" style={{ width: '60%', animationDelay: '0.15s' }} />
                        <div className="changelog-loading-pulse" style={{ width: '80%', animationDelay: '0.3s' }} />
                    </div>
                </div>
            )}

            {/* ── Timeline ── */}
            {!loading && entries.length > 0 && (
                <div className="changelog-container">
                    <div className="changelog-timeline">
                        {entries.map((entry, i) => {
                            const entryKey = entry.plugin ? `${entry.plugin}-${entry.version}` : entry.version;
                            const isOpen = !collapsed.has(entryKey);
                            const current = isCurrent(entry.version) && i === 0 && !entry.plugin;

                            return (
                                <div key={entryKey} className={`changelog-entry ${current ? 'changelog-entry--current' : ''} ${entry.plugin ? 'changelog-entry--plugin' : ''}`}>
                                    <div className={`changelog-dot ${current ? 'changelog-dot--current' : ''} ${entry.plugin ? 'changelog-dot--plugin' : ''}`}>
                                        {current && <div className="changelog-dot-pulse" />}
                                    </div>

                                    <div className={`changelog-card ${entry.plugin ? 'changelog-card--plugin' : ''}`}>
                                        <button
                                            className="changelog-card-header"
                                            onClick={() => toggleCollapse(entryKey)}
                                            aria-expanded={isOpen}
                                        >
                                            <div className="changelog-card-title-row">
                                                {entry.plugin && (
                                                    <span className="changelog-badge-plugin">
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                                                            <rect x="9" y="9" width="6" height="6" />
                                                        </svg>
                                                        {entry.pluginName || entry.plugin}
                                                    </span>
                                                )}
                                                <span className="changelog-version">v{entry.version}</span>
                                                {current && (
                                                    <span className="changelog-badge-current">Aktuell</span>
                                                )}
                                                {entry.version.endsWith('.0') && !current && !entry.plugin && (
                                                    <span className="changelog-badge-major">Major</span>
                                                )}
                                            </div>
                                            <div className="changelog-card-meta">
                                                <span className="changelog-date">
                                                    <CalendarIcon /> {formatDate(entry.date)}
                                                </span>
                                                <span className="changelog-count">
                                                    {entry.changes.length} Änderung{entry.changes.length !== 1 ? 'en' : ''}
                                                </span>
                                                <ChevronIcon open={isOpen} />
                                            </div>
                                        </button>

                                        {isOpen && renderChanges(entry.changes)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {!loading && entries.length === 0 && (
                <div className="changelog-container">
                    <div className="changelog-empty">
                        Keine Changelog-Einträge verfügbar.
                    </div>
                </div>
            )}
        </div>
    );
}
