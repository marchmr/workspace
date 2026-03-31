import { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '../../context/AuthContext';

/* ════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════ */

const SearchIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);

const ListIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
);

const CloseIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

interface AuditEntry {
    id: number;
    user_id: number | null;
    user_username: string | null;
    action: string;
    category: string;
    entity_type: string | null;
    entity_id: string | null;
    previous_state: any;
    new_state: any;
    ip_address: string | null;
    user_agent: string | null;
    plugin_id: string | null;
    tenant_id: number | null;
    tenant_name?: string | null;
    created_at: string;
}

interface ActionInfo {
    action: string;
    category: string;
    count: number;
}

/* ════════════════════════════════════════════
   Component
   ════════════════════════════════════════════ */

export default function AuditLog() {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [category, setCategory] = useState('');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [actionFilter, setActionFilter] = useState('');
    const [actionInput, setActionInput] = useState('');
    const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
    const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const actionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Action list for modal + autocomplete
    const [allActions, setAllActions] = useState<ActionInfo[]>([]);
    const [actionsLoaded, setActionsLoaded] = useState(false);
    const [showActionModal, setShowActionModal] = useState(false);
    const [actionModalSearch, setActionModalSearch] = useState('');

    // Autocomplete dropdown
    const [showSuggestions, setShowSuggestions] = useState(false);
    const actionInputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);

    // ──── Data Loading ────

    const loadEntries = useCallback(async () => {
        setLoading(true);
        const params = new URLSearchParams({ page: String(page), limit: '50' });
        if (category) params.set('category', category);
        if (search) params.set('search', search);
        if (actionFilter) params.set('action', actionFilter);

        const res = await apiFetch(`/api/admin/audit-log?${params}`);
        if (res.ok) {
            const data = await res.json();
            setEntries(data.entries);
            setTotal(data.total);
        }
        setLoading(false);
    }, [page, category, search, actionFilter]);

    useEffect(() => {
        void loadEntries();
    }, [loadEntries]);

    const loadActions = useCallback(async () => {
        if (actionsLoaded) return;
        try {
            const res = await apiFetch('/api/admin/audit-log/actions');
            if (res.ok) {
                const data = await res.json();
                setAllActions(data.actions || []);
                setActionsLoaded(true);
            }
        } catch { /* ignore */ }
    }, [actionsLoaded]);

    // ──── Handlers ────

    const handleSearchInput = (value: string) => {
        setSearchInput(value);
        if (searchTimeout.current) clearTimeout(searchTimeout.current);
        searchTimeout.current = setTimeout(() => {
            setSearch(value);
            setPage(1);
        }, 300);
    };

    const handleActionInput = (value: string) => {
        setActionInput(value);
        if (!actionsLoaded) loadActions();
        setShowSuggestions(value.length > 0);

        if (actionTimeout.current) clearTimeout(actionTimeout.current);
        actionTimeout.current = setTimeout(() => {
            setActionFilter(value);
            setPage(1);
        }, 400);
    };

    const selectAction = (action: string) => {
        setActionInput(action);
        setActionFilter(action);
        setShowSuggestions(false);
        setPage(1);
    };

    const clearActionFilter = () => {
        setActionInput('');
        setActionFilter('');
        setShowSuggestions(false);
        setPage(1);
    };

    const openActionModal = () => {
        loadActions();
        setActionModalSearch('');
        setShowActionModal(true);
    };

    // Click outside to close suggestions
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (
                suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
                actionInputRef.current && !actionInputRef.current.contains(e.target as Node)
            ) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // ──── Helpers ────

    const loadDetail = async (id: number) => {
        const res = await apiFetch(`/api/admin/audit-log/${id}`);
        if (res.ok) setSelectedEntry(await res.json());
    };

    const renderDiff = (previous: any, current: any) => {
        if (!previous && !current) return <span className="text-muted">Keine Daten</span>;

        const allKeys = new Set([
            ...Object.keys(previous || {}),
            ...Object.keys(current || {}),
        ]);

        return (
            <div className="diff-container">
                {Array.from(allKeys).map((key) => {
                    const prev = previous?.[key];
                    const curr = current?.[key];
                    const changed = JSON.stringify(prev) !== JSON.stringify(curr);
                    if (!changed) return null;

                    return (
                        <div key={key}>
                            {prev !== undefined && (
                                <div className="diff-row diff-removed">
                                    <span className="diff-key">{key}:</span>
                                    <span>- {JSON.stringify(prev)}</span>
                                </div>
                            )}
                            {curr !== undefined && (
                                <div className="diff-row diff-added">
                                    <span className="diff-key">{key}:</span>
                                    <span>+ {JSON.stringify(curr)}</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    const categoryColors: Record<string, string> = {
        auth: 'badge-info',
        admin: 'badge-warning',
        data: 'badge-success',
        plugin: 'badge-info',
        lock: 'badge-warning',
    };

    const totalPages = Math.ceil(total / 50);

    // Suggestions for autocomplete
    const suggestions = allActions
        .filter(a => a.action.toLowerCase().includes(actionInput.toLowerCase()))
        .slice(0, 10);

    // Filtered actions for modal
    const filteredModalActions = allActions.filter(a =>
        !actionModalSearch ||
        a.action.toLowerCase().includes(actionModalSearch.toLowerCase()) ||
        a.category.toLowerCase().includes(actionModalSearch.toLowerCase())
    );

    // Group by category for modal
    const groupedActions = filteredModalActions.reduce<Record<string, ActionInfo[]>>((acc, a) => {
        if (!acc[a.category]) acc[a.category] = [];
        acc[a.category].push(a);
        return acc;
    }, {});

    // ──── Render ────

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Audit-Log</h1>
                <p className="page-subtitle">{total} Einträge insgesamt</p>
            </div>

            <div className="card mb-md">
                <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* Suchfeld */}
                    <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
                        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', display: 'flex' }}>
                            {SearchIcon}
                        </span>
                        <input
                            className="form-input"
                            type="text"
                            placeholder="Benutzer, IP, Entität..."
                            value={searchInput}
                            onChange={(e) => handleSearchInput(e.target.value)}
                            style={{ paddingLeft: 34, width: '100%' }}
                        />
                        {searchInput && (
                            <button
                                onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
                                style={{
                                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: 'var(--color-text-muted)', fontSize: 16, lineHeight: 1,
                                }}
                                aria-label="Suche leeren"
                            >
                                x
                            </button>
                        )}
                    </div>

                    {/* Kategorie-Filter */}
                    <select
                        className="form-input"
                        style={{ width: 'auto', flex: '0 0 auto' }}
                        value={category}
                        onChange={(e) => { setCategory(e.target.value); setPage(1); }}
                    >
                        <option value="">Alle Kategorien</option>
                        <option value="auth">Auth</option>
                        <option value="admin">Admin</option>
                        <option value="data">Daten</option>
                        <option value="plugin">Plugin</option>
                        <option value="lock">Lock</option>
                    </select>

                    {/* Aktionsfilter mit Autocomplete */}
                    <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
                        <input
                            ref={actionInputRef}
                            className="form-input"
                            type="text"
                            placeholder="Nach Aktion filtern..."
                            value={actionInput}
                            onChange={(e) => handleActionInput(e.target.value)}
                            onFocus={() => {
                                if (!actionsLoaded) loadActions();
                                if (actionInput) setShowSuggestions(true);
                            }}
                            style={{ width: '100%', paddingRight: 64 }}
                        />

                        {/* Clear-Button */}
                        {actionInput && (
                            <button
                                onClick={clearActionFilter}
                                style={{
                                    position: 'absolute', right: 36, top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: 'var(--color-text-muted)', fontSize: 16, lineHeight: 1,
                                }}
                                aria-label="Aktionsfilter leeren"
                            >
                                x
                            </button>
                        )}

                        {/* Liste-Button */}
                        <button
                            onClick={openActionModal}
                            style={{
                                position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center',
                                padding: 4, borderRadius: 'var(--radius-sm)',
                            }}
                            title="Alle Aktionen anzeigen"
                            aria-label="Aktionsliste öffnen"
                        >
                            {ListIcon}
                        </button>

                        {/* Autocomplete Dropdown */}
                        {showSuggestions && suggestions.length > 0 && (
                            <div
                                ref={suggestionsRef}
                                style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    right: 0,
                                    zIndex: 100,
                                    marginTop: 4,
                                    background: 'var(--color-surface)',
                                    border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-md)',
                                    boxShadow: 'var(--shadow-lg)',
                                    maxHeight: 280,
                                    overflowY: 'auto',
                                }}
                            >
                                {suggestions.map((s) => (
                                    <button
                                        key={`${s.category}-${s.action}`}
                                        onClick={() => selectAction(s.action)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            width: '100%',
                                            padding: '8px 12px',
                                            background: 'none',
                                            border: 'none',
                                            borderBottom: '1px solid var(--color-border)',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            fontSize: 'var(--font-size-sm)',
                                            color: 'var(--color-text)',
                                            transition: 'background 0.15s',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface-hover)')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <code style={{ fontSize: 'var(--font-size-xs)', fontWeight: 500 }}>{s.action}</code>
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span className={`badge ${categoryColors[s.category] || 'badge-info'}`} style={{ fontSize: '10px' }}>{s.category}</span>
                                            <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{s.count}x</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Active filters */}
                    {(search || category || actionFilter) && (
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => { setSearchInput(''); setSearch(''); setCategory(''); clearActionFilter(); }}
                        >
                            Filter zurücksetzen
                        </button>
                    )}
                </div>
            </div>

            {/* Aktiver Aktionsfilter Badge */}
            {actionFilter && (
                <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 12px',
                    marginBottom: 'var(--space-md)',
                    background: 'hsla(210, 70%, 50%, 0.12)',
                    border: '1px solid hsla(210, 70%, 50%, 0.25)',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 'var(--font-size-sm)',
                    color: 'hsl(210, 70%, 50%)',
                    fontWeight: 500,
                }}>
                    Aktion: <code style={{ fontWeight: 700, fontSize: 'var(--font-size-xs)' }}>{actionFilter}</code>
                    <button
                        onClick={clearActionFilter}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'hsl(210, 70%, 50%)', fontSize: 14, lineHeight: 1,
                            marginLeft: 2, padding: 0,
                        }}
                        aria-label="Aktionsfilter entfernen"
                    >
                        x
                    </button>
                </div>
            )}

            <div className="card">
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Zeitpunkt</th>
                                <th>Benutzer</th>
                                <th>Kategorie</th>
                                <th>Aktion</th>
                                <th>Entität</th>
                                <th>Mandant</th>
                                <th>IP</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={8} className="text-center text-muted">Laden...</td></tr>
                            ) : entries.length === 0 ? (
                                <tr><td colSpan={8} className="text-center text-muted">
                                    {search || category || actionFilter ? 'Keine Einträge für diese Filter gefunden.' : 'Keine Einträge vorhanden.'}
                                </td></tr>
                            ) : entries.map((entry) => (
                                <tr key={entry.id}>
                                    <td className="text-muted">{new Date(entry.created_at).toLocaleString('de-DE')}</td>
                                    <td>{entry.user_username || 'System'}</td>
                                    <td><span className={`badge ${categoryColors[entry.category] || 'badge-info'}`}>{entry.category}</span></td>
                                    <td>
                                        <code
                                            style={{
                                                fontSize: 'var(--font-size-xs)',
                                                cursor: 'pointer',
                                                textDecoration: actionFilter === entry.action ? 'underline' : 'none',
                                            }}
                                            onClick={(e) => { e.stopPropagation(); selectAction(entry.action); }}
                                            title={`Nach "${entry.action}" filtern`}
                                        >
                                            {entry.action}
                                        </code>
                                    </td>
                                    <td className="text-muted">
                                        {entry.entity_type ? `${entry.entity_type} #${entry.entity_id}` : '-'}
                                    </td>
                                    <td className="text-muted">{entry.tenant_name || '-'}</td>
                                    <td className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>{entry.ip_address || '-'}</td>
                                    <td>
                                        <button className="btn btn-secondary btn-sm" onClick={() => loadDetail(entry.id)}>
                                            Detail
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {totalPages > 1 && (
                    <div className="flex-between mt-md">
                        <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                            Seite {page} von {totalPages}
                        </span>
                        <div className="flex gap-sm">
                            <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                                Zurück
                            </button>
                            <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                                Weiter
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ──── Detail Modal ──── */}
            {selectedEntry && (
                <div className="modal-overlay" onClick={() => setSelectedEntry(null)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Detail: {selectedEntry.action}</h2>
                            <button className="modal-close" onClick={() => setSelectedEntry(null)} aria-label="Schließen">x</button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', fontSize: 'var(--font-size-sm)' }}>
                            <div><strong>Benutzer:</strong> {selectedEntry.user_username || 'System'}</div>
                            <div><strong>IP:</strong> {selectedEntry.ip_address || '-'}</div>
                            <div><strong>Entität:</strong> {selectedEntry.entity_type ? `${selectedEntry.entity_type} #${selectedEntry.entity_id}` : '-'}</div>
                            <div><strong>Zeitpunkt:</strong> {new Date(selectedEntry.created_at).toLocaleString('de-DE')}</div>
                            <div><strong>Mandant:</strong> {selectedEntry.tenant_name || '-'}</div>
                            <div><strong>Kategorie:</strong> {selectedEntry.category}</div>
                        </div>

                        {(selectedEntry.previous_state || selectedEntry.new_state) && (
                            <div className="mt-md">
                                <strong style={{ fontSize: 'var(--font-size-sm)' }}>Änderungen:</strong>
                                <div className="mt-md">
                                    {renderDiff(selectedEntry.previous_state, selectedEntry.new_state)}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ──── Action Browser Modal ──── */}
            {showActionModal && (
                <div className="modal-overlay" onClick={() => setShowActionModal(false)}>
                    <div
                        className="modal-card"
                        onClick={(e) => e.stopPropagation()}
                        style={{ maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
                    >
                        <div className="modal-header">
                            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {ListIcon}
                                Aktionen-Übersicht
                                <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 400 }}>
                                    ({allActions.length} Aktionen)
                                </span>
                            </h2>
                            <button className="modal-close" onClick={() => setShowActionModal(false)} aria-label="Schließen">
                                {CloseIcon}
                            </button>
                        </div>

                        {/* Search in modal */}
                        <div style={{ position: 'relative', marginBottom: 'var(--space-md)' }}>
                            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', display: 'flex' }}>
                                {SearchIcon}
                            </span>
                            <input
                                className="form-input"
                                type="text"
                                placeholder="Aktionen durchsuchen..."
                                value={actionModalSearch}
                                onChange={(e) => setActionModalSearch(e.target.value)}
                                style={{ paddingLeft: 34, width: '100%' }}
                                autoFocus
                            />
                        </div>

                        {/* Grouped action list */}
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {Object.keys(groupedActions).length === 0 ? (
                                <div className="text-center text-muted" style={{ padding: 'var(--space-xl)' }}>
                                    Keine Aktionen gefunden.
                                </div>
                            ) : (
                                Object.entries(groupedActions)
                                    .sort(([a], [b]) => a.localeCompare(b))
                                    .map(([cat, actions]) => (
                                    <div key={cat} style={{ marginBottom: 'var(--space-md)' }}>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            padding: '6px 0',
                                            borderBottom: '1px solid var(--color-border)',
                                            marginBottom: 4,
                                        }}>
                                            <span className={`badge ${categoryColors[cat] || 'badge-info'}`}>{cat}</span>
                                            <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                                                {actions.length} Aktionen
                                            </span>
                                        </div>
                                        {actions.map((a) => (
                                            <button
                                                key={a.action}
                                                onClick={() => { selectAction(a.action); setShowActionModal(false); }}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    width: '100%',
                                                    padding: '8px 12px',
                                                    background: actionFilter === a.action ? 'hsla(210, 70%, 50%, 0.1)' : 'none',
                                                    border: 'none',
                                                    borderRadius: 'var(--radius-sm)',
                                                    cursor: 'pointer',
                                                    textAlign: 'left',
                                                    fontSize: 'var(--font-size-sm)',
                                                    color: 'var(--color-text)',
                                                    transition: 'background 0.15s',
                                                }}
                                                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface-hover)')}
                                                onMouseLeave={(e) => (e.currentTarget.style.background = actionFilter === a.action ? 'hsla(210, 70%, 50%, 0.1)' : 'none')}
                                            >
                                                <code style={{ fontSize: 'var(--font-size-xs)', fontWeight: 500 }}>{a.action}</code>
                                                <span className="text-muted" style={{
                                                    fontSize: 'var(--font-size-xs)',
                                                    background: 'var(--color-surface-hover)',
                                                    padding: '2px 8px',
                                                    borderRadius: 'var(--radius-full)',
                                                    fontWeight: 600,
                                                }}>
                                                    {a.count}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
