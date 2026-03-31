import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface ChangelogEntry {
    version: string;
    date: string;
    changes: string[];
    plugin?: string;
    pluginName?: string;
}

const TYPES: Record<string, { label: string; color: string }> = {
    neu:      { label: 'Neu',      color: '#16a34a' },
    fix:      { label: 'Fix',      color: '#d97706' },
    entfernt: { label: 'Entfernt', color: '#dc2626' },
};

const CATEGORIES: Record<string, { label: string; color: string }> = {
    security:  { label: 'Sicherheit', color: '#dc2626' },
    sicherheit:{ label: 'Sicherheit', color: '#dc2626' },
    ui:        { label: 'UI/UX',      color: '#8b5cf6' },
    auth:      { label: 'Auth',       color: '#0891b2' },
    docs:      { label: 'Docs',       color: '#16a34a' },
    plugin:    { label: 'Plugin',     color: '#d97706' },
    api:       { label: 'API',        color: '#2563eb' },
    admin:     { label: 'Admin',      color: '#7c3aed' },
    core:      { label: 'Core',       color: '#475569' },
    locking:   { label: 'Locking',    color: '#ca8a04' },
};

interface ParsedChange {
    type: string;
    category: string;
    catMeta: typeof CATEGORIES[string] | null;
    text: string;
}

function parseChange(raw: string): ParsedChange {
    let type = '';
    let remaining = raw;
    const typeMatch = remaining.match(/^\[(Neu|Fix|Entfernt)\]\s*/i);
    if (typeMatch) {
        type = typeMatch[1].toLowerCase();
        remaining = remaining.substring(typeMatch[0].length);
    }
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

export default function PublicChangelog() {
    const [entries, setEntries] = useState<ChangelogEntry[]>([]);
    const [version, setVersion] = useState('');
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        fetch('/api/changelog')
            .then(r => r.json())
            .then(data => {
                setEntries((data.entries || []).slice(0, 10));
                setVersion(data.version || '');
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const renderChanges = (changes: string[]) => {
        const parsed = changes.map(parseChange);
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

        return (
            <div style={{ marginTop: 12 }}>
                {['neu', 'fix', 'entfernt'].map(typeKey => {
                    const items = byType[typeKey];
                    if (!items) return null;
                    const t = TYPES[typeKey];

                    // Nach Kategorie gruppieren
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
                        <div key={typeKey} style={{ borderLeft: `3px solid ${t.color}`, paddingLeft: 14, marginBottom: 14 }}>
                            <div style={{ color: t.color, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                                {t.label} ({items.length})
                            </div>
                            {Object.entries(byCat).map(([catKey, group]) => (
                                <div key={catKey} style={{ marginBottom: 8 }}>
                                    <div style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                        fontSize: 10, fontWeight: 600, color: group.meta.color,
                                        background: `${group.meta.color}14`, padding: '2px 8px',
                                        borderRadius: 4, marginBottom: 4,
                                    }}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                                            <line x1="7" y1="7" x2="7.01" y2="7" />
                                        </svg>
                                        {group.meta.label}
                                    </div>
                                    <ul style={{ margin: 0, padding: '0 0 0 16px', listStyle: 'disc' }}>
                                        {group.items.map((text, j) => (
                                            <li key={j} style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, marginBottom: 2 }}>{text}</li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                            {uncategorized.length > 0 && (
                                <ul style={{ margin: 0, padding: '0 0 0 16px', listStyle: 'disc' }}>
                                    {uncategorized.map((text, j) => (
                                        <li key={j} style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>{text}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    );
                })}
                {untyped.length > 0 && (
                    <ul style={{ margin: 0, padding: '0 0 0 16px', listStyle: 'disc' }}>
                        {untyped.map((item, j) => (
                            <li key={j} style={{ fontSize: 13, color: '#334155', lineHeight: 1.6 }}>{item.text}</li>
                        ))}
                    </ul>
                )}
            </div>
        );
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(160deg, #f0f0ff 0%, #e8ecff 30%, #f5f3ff 60%, #eef2ff 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '40px 20px',
        }}>
            <div style={{ width: '100%', maxWidth: 800 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: '#1e293b', letterSpacing: '-0.02em' }}>
                            Changelog
                        </h1>
                        <p style={{ margin: '4px 0 0', fontSize: 14, color: '#64748b' }}>
                            Versionshistorie {version && <span style={{
                                display: 'inline-block',
                                background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                                color: 'white',
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '2px 10px',
                                borderRadius: 999,
                                marginLeft: 8,
                            }}>v{version}</span>}
                        </p>
                    </div>
                    <button
                        onClick={() => navigate('/login')}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            background: 'white',
                            border: '1px solid #e2e8f0',
                            color: '#475569',
                            fontSize: 13,
                            fontWeight: 500,
                            fontFamily: 'inherit',
                            padding: '8px 16px',
                            borderRadius: 10,
                            cursor: 'pointer',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                            transition: 'all 0.2s',
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
                        </svg>
                        Zum Login
                    </button>
                </div>

                {/* Loading */}
                {loading && (
                    <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Wird geladen...</div>
                )}

                {/* Entries */}
                {!loading && entries.map((entry, i) => (
                    <div key={`${entry.version}-${i}`} style={{
                        background: 'rgba(255,255,255,0.85)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(148,163,184,0.15)',
                        borderRadius: 16,
                        padding: '20px 24px',
                        marginBottom: 16,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>v{entry.version}</span>
                                {i === 0 && !entry.plugin && (
                                    <span style={{
                                        fontSize: 10,
                                        fontWeight: 600,
                                        background: 'linear-gradient(135deg, #6366f1, #818cf8)',
                                        color: 'white',
                                        padding: '2px 8px',
                                        borderRadius: 999,
                                    }}>Aktuell</span>
                                )}
                            </div>
                            <span style={{ fontSize: 12, color: '#94a3b8' }}>{formatDate(entry.date)}</span>
                        </div>
                        {renderChanges(entry.changes)}
                    </div>
                ))}
            </div>
        </div>
    );
}
