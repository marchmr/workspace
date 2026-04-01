import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { apiFetch, useAuth } from '../context/AuthContext';
import { pluginRegistry } from '../pluginRegistry';

interface SearchResult {
    title: string;
    description?: string;
    path: string;
    category: string;
    /** Vertrauenswuerdiges SVG-Icon (nur von lokalen Quick Actions, nie von User-Input) */
    trustedIcon?: string;
}

const SearchIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);

export function GlobalSearch() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const hasPermission = (permission?: string): boolean => {
        if (!permission) return true;
        if (!user) return false;
        return user.permissions.includes('*') || user.permissions.includes(permission);
    };

    const pluginSearchProviders = useMemo(
        () => pluginRegistry
            .filter((entry) => (!user?.activePlugins || user.activePlugins.includes(entry.id)) && entry.searchProvider && hasPermission(entry.searchProvider.permission))
            .map((entry) => ({ pluginId: entry.id, pluginName: entry.name, provider: entry.searchProvider! })),
        [user]
    );

    // SVG icon helpers (Feather-style, 16x16)
    const svgIcon = (d: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-2px;margin-right:6px;opacity:0.7">${d}</svg>`;
    const icons = {
        settings: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
        user: svgIcon('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
        users: svgIcon('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
        plus: svgIcon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
        shield: svgIcon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
        building: svgIcon('<rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><line x1="8" y1="6" x2="8" y2="6"/><line x1="12" y1="6" x2="12" y2="6"/><line x1="16" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10"/><line x1="12" y1="10" x2="12" y2="10"/><line x1="16" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="8" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="16" y1="14" x2="16" y2="14"/>'),
        refresh: svgIcon('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
        folder: svgIcon('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
        save: svgIcon('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
        fileText: svgIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
        link: svgIcon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
        home: svgIcon('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
        list: svgIcon('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
    };

    // Build Quick Actions: core + plugin
    const allQuickActions = useMemo(() => {
        const core = [
            // Navigation
            { id: 'core.admin', label: 'Administration öffnen', icon: icons.settings, keywords: ['admin', 'verwaltung', 'einstellungen'], permission: 'admin.access', execute: () => navigate('/admin') },
            { id: 'core.profile', label: 'Profil bearbeiten', icon: icons.user, keywords: ['profil', 'profile', 'konto', 'passwort', 'mfa'], execute: () => navigate('/profile') },
            { id: 'core.changelog', label: 'Changelog anzeigen', icon: icons.list, keywords: ['changelog', 'version', 'änderungen', 'news', 'updates'], execute: () => navigate('/changelog') },
            { id: 'core.dashboard', label: 'Dashboard', icon: icons.home, keywords: ['dashboard', 'startseite', 'home', 'übersicht'], execute: () => navigate('/') },

            // Admin-Bereiche
            { id: 'core.users', label: 'Benutzerverwaltung', icon: icons.users, keywords: ['benutzer', 'user', 'nutzer', 'konto', 'konten'], permission: 'users.view', execute: () => navigate('/admin/users') },
            { id: 'core.create-user', label: 'Neuen Benutzer anlegen', icon: icons.plus, keywords: ['benutzer', 'user', 'anlegen', 'erstellen', 'neu'], permission: 'users.create', execute: () => navigate('/admin/users?action=create') },
            { id: 'core.roles', label: 'Rollen & Rechte', icon: icons.shield, keywords: ['rollen', 'rechte', 'berechtigungen', 'permissions', 'role'], permission: 'roles.view', execute: () => navigate('/admin/roles') },
            { id: 'core.tenants', label: 'Mandantenverwaltung', icon: icons.building, keywords: ['mandant', 'tenant', 'firma', 'organisation'], permission: 'tenants.manage', execute: () => navigate('/admin/tenants') },
            { id: 'core.updates', label: 'Updates & Plugins', icon: icons.refresh, keywords: ['update', 'aktualisieren', 'plugin', 'erweiterung', 'version'], permission: 'updates.manage', execute: () => navigate('/admin/updates') },
            { id: 'core.documents', label: 'Dokumentenverwaltung', icon: icons.folder, keywords: ['dokument', 'datei', 'ordner', 'upload', 'dateien'], permission: 'documents.manage', execute: () => navigate('/admin/documents') },
            { id: 'core.backup', label: 'Backup & Restore', icon: icons.save, keywords: ['backup', 'sicherung', 'export', 'import', 'wiederherstellung'], permission: 'backup.export', execute: () => navigate('/admin/backup') },
            { id: 'core.settings', label: 'Einstellungen', icon: icons.settings, keywords: ['einstellungen', 'settings', 'konfiguration', 'email', 'smtp'], permission: 'settings.manage', execute: () => navigate('/admin/settings') },
            { id: 'core.audit', label: 'Audit-Log', icon: icons.fileText, keywords: ['audit', 'log', 'protokoll', 'historie', 'aktivitaet'], permission: 'audit.view', execute: () => navigate('/admin/audit') },
            { id: 'core.webhooks', label: 'Webhooks verwalten', icon: icons.link, keywords: ['webhook', 'hook', 'integration', 'event', 'api'], permission: 'webhooks.manage', execute: () => navigate('/admin/webhooks') },
        ];

        const pluginActions = pluginRegistry
            .filter((entry) => !user?.activePlugins || user.activePlugins.includes(entry.id))
            .flatMap((entry) => entry.quickActions || []);

        return [...core, ...pluginActions].filter((a) => hasPermission(a.permission));
    }, [user, navigate]);

    // Cmd+K / Ctrl+K shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setOpen(true);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Focus input when opening
    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 50);
        } else {
            setQuery('');
            setResults([]);
            setActiveIndex(0);
        }
    }, [open]);

    // Debounced search
    const performSearch = useCallback(async (q: string) => {
        if (q.length < 2) {
            setResults([]);
            return;
        }

        const allResults: SearchResult[] = [];
        const lowerQ = q.toLowerCase();

        // Quick Actions (filtered by query match)
        const matchedActions = allQuickActions.filter((a) => {
            if (a.label.toLowerCase().includes(lowerQ)) return true;
            if (a.keywords?.some((k) => k.toLowerCase().includes(lowerQ))) return true;
            return false;
        });
        for (const action of matchedActions) {
            allResults.push({
                title: action.label,
                trustedIcon: action.icon || undefined,
                description: 'Aktion ausführen',
                path: `__action__:${action.id}`,
                category: 'Aktionen',
            });
        }

        // Core search
        try {
            const res = await apiFetch(`/api/auth/search?q=${encodeURIComponent(q)}`);
            if (res.ok) {
                const coreResults: SearchResult[] = await res.json();
                allResults.push(...coreResults);
            }
        } catch { /* ignore */ }

        // Plugin search providers
        const pluginPromises = pluginSearchProviders.map(async ({ pluginName, provider }) => {
            try {
                const pluginResults = await provider.search(q);
                return pluginResults.map((r) => ({
                    title: r.title,
                    description: r.description,
                    path: r.path,
                    category: pluginName,
                }));
            } catch {
                return [];
            }
        });

        const pluginResultSets = await Promise.all(pluginPromises);
        for (const set of pluginResultSets) {
            allResults.push(...set);
        }

        setResults(allResults);
        setActiveIndex(0);
    }, [pluginSearchProviders, allQuickActions]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => performSearch(query), 300);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [query, performSearch]);

    const handleSelect = (result: SearchResult) => {
        setOpen(false);
        if (result.path.startsWith('__action__:')) {
            const actionId = result.path.replace('__action__:', '');
            const action = allQuickActions.find((a) => a.id === actionId);
            if (action) action.execute();
        } else if (
            result.path.startsWith('http://') ||
            result.path.startsWith('https://') ||
            result.path.startsWith('mailto:') ||
            result.path.startsWith('tel:')
        ) {
            window.open(result.path, '_blank', 'noopener,noreferrer');
        } else {
            navigate(result.path);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setOpen(false);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' && results[activeIndex]) {
            handleSelect(results[activeIndex]);
        }
    };

    // Group results by category
    const grouped = useMemo(() => {
        const map = new Map<string, SearchResult[]>();
        for (const r of results) {
            const group = map.get(r.category) || [];
            group.push(r);
            map.set(r.category, group);
        }
        return map;
    }, [results]);

    const isMac = navigator.platform.toUpperCase().includes('MAC');

    return (
        <>
            <button className="global-search-trigger" onClick={() => setOpen(true)}>
                <span className="global-search-trigger-icon">{SearchIcon}</span>
                <span className="global-search-trigger-text">Suche...</span>
                <kbd className="global-search-shortcut">{isMac ? '⌘K' : 'Ctrl+K'}</kbd>
            </button>

            {open && createPortal(
                <div className="global-search-overlay" onClick={() => setOpen(false)}>
                    <div className="global-search-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="global-search-input-wrapper">
                            <span className="global-search-input-icon">{SearchIcon}</span>
                            <input
                                ref={inputRef}
                                type="text"
                                className="global-search-input"
                                placeholder="Suchen..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                            />
                        </div>
                        <div className="global-search-results">
                            {query.length >= 2 && results.length === 0 && (
                                <div className="global-search-empty">
                                    Keine Ergebnisse für &bdquo;{query}&ldquo;
                                </div>
                            )}
                            {query.length < 2 && (
                                <div className="global-search-empty">
                                    Suchbegriff eingeben (min. 2 Zeichen)
                                </div>
                            )}
                            {(() => {
                                let flatIndex = 0;
                                return Array.from(grouped.entries()).map(([category, items]) => (
                                    <div key={category}>
                                        <div className="global-search-group-label">{category}</div>
                                        {items.map((item) => {
                                            const idx = flatIndex++;
                                            return (
                                                <div
                                                    key={`${item.path}-${idx}`}
                                                    className={`global-search-item ${idx === activeIndex ? 'active' : ''}`}
                                                    onClick={() => handleSelect(item)}
                                                    onMouseEnter={() => setActiveIndex(idx)}
                                                >
                                                    <span className="global-search-item-title">
                                                        {item.trustedIcon && (
                                                            <span dangerouslySetInnerHTML={{ __html: item.trustedIcon }} />
                                                        )}
                                                        {item.title}
                                                    </span>
                                                    {item.description && (
                                                        <span className="global-search-item-desc">{item.description}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ));
                            })()}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
