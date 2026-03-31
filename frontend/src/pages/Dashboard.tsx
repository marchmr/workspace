import { Suspense, useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, useAuth } from '../context/AuthContext';
import { pluginRegistry, type PluginDashboardTile } from '../pluginRegistry';
import { TileGrid, type TileGridItem, type TileSizeClass } from '../components/TileGrid';

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

interface TileLayout {
    x: number;
    y: number;
    w: number;
    h: number;
    visible: boolean;
    viewMode?: string;
}

type DashboardLayoutState = Record<string, TileLayout>;

interface DashboardTileDefinition {
    key: string;
    title: string;
    description?: string;
    permission?: string;
    defaultW: number;
    defaultH: number;
    defaultVisible: boolean;
    viewModes?: Array<{ id: string; label: string }>;
    defaultViewMode?: string;
    render?: (sizeClass: TileSizeClass) => ReactNode;
    component?: PluginDashboardTile['component'];
}

const GRID_COLUMNS = 48;
const DEFAULT_W = 12;
const DEFAULT_H = 8;

/* ════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════ */

function legacySizeToGrid(size?: string): { w: number; h: number } {
    if (size === 'small') return { w: 12, h: 8 };
    if (size === 'large') return { w: 48, h: 8 };
    return { w: 24, h: 8 };
}

function normalizeLayoutResponse(tiles: unknown): DashboardLayoutState {
    if (!tiles || typeof tiles !== 'object' || Array.isArray(tiles)) return {};
    const normalized: DashboardLayoutState = {};
    for (const [key, raw] of Object.entries(tiles as Record<string, any>)) {
        if (!raw || typeof raw !== 'object') continue;
        normalized[key] = {
            x: typeof raw.x === 'number' ? raw.x : 0,
            y: typeof raw.y === 'number' ? raw.y : 0,
            w: typeof raw.w === 'number' ? raw.w : DEFAULT_W,
            h: typeof raw.h === 'number' ? raw.h : DEFAULT_H,
            visible: raw.visible !== false,
            viewMode: typeof raw.viewMode === 'string' ? raw.viewMode : undefined,
        };
    }
    return normalized;
}

function resolveTileLayout(tile: DashboardTileDefinition, layout: DashboardLayoutState): TileLayout {
    const stored = layout[tile.key];
    if (stored) return stored;
    const fallbackMode = tile.defaultViewMode || tile.viewModes?.[0]?.id;
    return { x: 0, y: 0, w: tile.defaultW, h: tile.defaultH, visible: tile.defaultVisible, viewMode: fallbackMode };
}

/** Assign default positions (auto-flow) for tiles without a stored layout */
function assignDefaultPositions(tiles: DashboardTileDefinition[], layout: DashboardLayoutState): DashboardLayoutState {
    const result: DashboardLayoutState = { ...layout };
    let cursorX = 0;
    let cursorY = 0;
    let rowMaxH = 0;

    // First, track occupied space from stored tiles
    const occupiedTiles = tiles
        .filter(t => result[t.key])
        .map(t => result[t.key]);

    for (const tile of tiles) {
        if (result[tile.key]) continue; // Already positioned
        // Find free position
        let placed = false;
        for (let y = 0; y < 200 && !placed; y++) {
            for (let x = 0; x <= GRID_COLUMNS - tile.defaultW; x++) {
                const candidate = { x, y, w: tile.defaultW, h: tile.defaultH };
                const hasOverlap = occupiedTiles.some(
                    o => o.x < candidate.x + candidate.w && o.x + o.w > candidate.x &&
                         o.y < candidate.y + candidate.h && o.y + o.h > candidate.y
                );
                if (!hasOverlap) {
                    result[tile.key] = { ...candidate, visible: tile.defaultVisible };
                    if (tile.defaultViewMode || tile.viewModes?.[0]?.id) {
                        result[tile.key].viewMode = tile.defaultViewMode || tile.viewModes?.[0]?.id;
                    }
                    occupiedTiles.push(result[tile.key]);
                    placed = true;
                    break;
                }
            }
        }
        if (!placed) {
            result[tile.key] = {
                x: 0,
                y: cursorY,
                w: tile.defaultW,
                h: tile.defaultH,
                visible: tile.defaultVisible,
                viewMode: tile.defaultViewMode || tile.viewModes?.[0]?.id,
            };
            cursorY += tile.defaultH;
        }
    }

    return result;
}

/* ════════════════════════════════════════════
   System Status Tile
   ════════════════════════════════════════════ */

function SystemStatusTile() {
    const navigate = useNavigate();
    const [version, setVersion] = useState<string>('');
    const [status, setStatus] = useState<'ok' | 'error' | 'loading'>('loading');

    useEffect(() => {
        let active = true;
        apiFetch('/api/health').then(async (res) => {
            if (!active) return;
            if (res.ok) {
                const data = await res.json();
                setVersion(data.version || '');
                setStatus(data.status === 'ok' ? 'ok' : 'error');
            } else {
                setStatus('error');
            }
        }).catch(() => { if (active) setStatus('error'); });
        return () => { active = false; };
    }, []);

    return (
        <div>
            <div className="dashboard-tile-header">
                <div>
                    <div className="card-title">Systemstatus</div>
                    <p className="dashboard-tile-subtitle">Core-Dienststatus</p>
                </div>
            </div>
            <div className="dashboard-tile-body" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                {status === 'loading' && <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>Wird geprüft...</span>}
                {status === 'ok' && <span className="badge badge-success">Online</span>}
                {status === 'error' && <span className="badge badge-danger">Fehler</span>}
                {version && (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                        v{version}
                    </span>
                )}
            </div>
            <div style={{ marginTop: 'var(--space-sm)', paddingTop: 'var(--space-sm)', borderTop: '1px solid var(--color-border)' }}>
                <button
                    className="btn btn-ghost"
                    style={{ fontSize: 'var(--font-size-xs)', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    onClick={() => navigate('/changelog')}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="10" />
                    </svg>
                    Changelog
                </button>
            </div>
        </div>
    );
}

/* ════════════════════════════════════════════
   Notification Tile
   ════════════════════════════════════════════ */

function NotificationTileContent({ sizeClass }: { sizeClass: TileSizeClass }) {
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState<{ id: number; title: string; type: string; link?: string; is_read: boolean; created_at: string }[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        apiFetch('/api/auth/notifications').then(async (res) => {
            if (res.ok) {
                const data = await res.json();
                setNotifications(data.notifications?.slice(0, 5) || []);
                setUnreadCount(data.unreadCount || 0);
            }
        }).catch(() => { });
    }, []);

    const typeColor: Record<string, string> = { info: 'var(--color-primary)', success: '#22c55e', warning: '#f59e0b', error: '#ef4444' };

    const timeAgo = (d: string) => {
        const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
        if (mins < 1) return 'gerade eben';
        if (mins < 60) return `vor ${mins}m`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `vor ${hrs}h`;
        return `vor ${Math.floor(hrs / 24)}d`;
    };

    if (sizeClass === 'compact') {
        return (
            <div>
                <div className="card-title">Benachrichtigungen</div>
                {unreadCount > 0 && (
                    <span className="badge badge-primary" style={{ marginTop: 'var(--space-xs)' }}>{unreadCount} ungelesen</span>
                )}
                {unreadCount === 0 && (
                    <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-xs)' }}>Keine neuen</p>
                )}
            </div>
        );
    }

    return (
        <div>
            <div className="dashboard-tile-header">
                <div>
                    <div className="card-title">Benachrichtigungen</div>
                </div>
            </div>
            {unreadCount > 0 && (
                <div style={{ marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                    <span className="badge badge-primary">{unreadCount} ungelesen</span>
                </div>
            )}
            {notifications.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>Keine Benachrichtigungen</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {notifications.map((n) => (
                        <div
                            key={n.id}
                            onClick={() => n.link?.startsWith('/') && navigate(n.link)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '4px 0', cursor: n.link ? 'pointer' : 'default',
                                opacity: n.is_read ? 0.6 : 1,
                            }}
                        >
                            <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, backgroundColor: n.is_read ? 'transparent' : (typeColor[n.type] || 'var(--color-primary)') }} />
                            <span style={{ fontSize: 'var(--font-size-sm)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: n.is_read ? 400 : 600 }}>{n.title}</span>
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', flexShrink: 0 }}>{timeAgo(n.created_at)}</span>
                        </div>
                    ))}
                </div>
            )}
            <button
                onClick={() => navigate('/notifications')}
                style={{ marginTop: 'var(--space-sm)', background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 'var(--font-size-xs)', cursor: 'pointer', padding: 0 }}
            >
                Alle Benachrichtigungen →
            </button>
        </div>
    );
}

/* ════════════════════════════════════════════
   Context Menu
   ════════════════════════════════════════════ */

interface ContextMenuState {
    x: number;
    y: number;
    type: 'empty' | 'tile';
    tileKey?: string;
}

function ContextMenu({
    state,
    allTiles,
    layout,
    onToggleVisibility,
    onResetTile,
    onSetTileViewMode,
    onResetAll,
    onClose,
}: {
    state: ContextMenuState;
    allTiles: DashboardTileDefinition[];
    layout: DashboardLayoutState;
    onToggleVisibility: (key: string) => void;
    onResetTile: (key: string) => void;
    onSetTileViewMode: (key: string, viewMode: string) => void;
    onResetAll: () => void;
    onClose: () => void;
}) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = menuRef.current;
        if (!el) return;
        // Ensure menu stays within viewport
        const rect = el.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            el.style.left = `${window.innerWidth - rect.width - 8}px`;
        }
        if (rect.bottom > window.innerHeight) {
            el.style.top = `${window.innerHeight - rect.height - 8}px`;
        }
    }, [state]);

    if (state.type === 'tile' && state.tileKey) {
        const tile = allTiles.find(t => t.key === state.tileKey);
        if (!tile) return null;

        return (
            <>
                <div className="tile-grid-context-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
                <div ref={menuRef} className="tile-grid-context-menu" style={{ left: state.x, top: state.y }}>
                    <div className="tile-grid-context-menu-title">{tile.title}</div>
                    {tile.viewModes && tile.viewModes.length > 0 && (
                        <>
                            <div className="tile-grid-context-menu-divider" />
                            <div
                                style={{
                                    fontSize: 'var(--font-size-xs)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.6px',
                                    color: 'var(--color-text-muted)',
                                    padding: '4px 4px 6px 4px',
                                    fontWeight: 600,
                                }}
                            >
                                Ansicht
                            </div>
                            {tile.viewModes.map((mode) => {
                                const currentMode = layout[tile.key]?.viewMode || tile.defaultViewMode || tile.viewModes?.[0]?.id;
                                const isActive = currentMode === mode.id;
                                return (
                                    <button
                                        key={`${tile.key}.mode.${mode.id}`}
                                        className="tile-grid-context-menu-item"
                                        onClick={() => { onSetTileViewMode(tile.key, mode.id); onClose(); }}
                                    >
                                        <div className={`tile-grid-context-menu-check ${isActive ? 'tile-grid-context-menu-check--active' : ''}`}>
                                            {isActive && (
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                            )}
                                        </div>
                                        <span>{mode.label}</span>
                                    </button>
                                );
                            })}
                            <div className="tile-grid-context-menu-divider" />
                        </>
                    )}
                    <button className="tile-grid-context-menu-item" onClick={() => { onResetTile(tile.key); onClose(); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1 4 1 10 7 10" />
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                        Größe zurücksetzen
                    </button>
                    <button className="tile-grid-context-menu-item tile-grid-context-menu-item--danger" onClick={() => { onToggleVisibility(tile.key); onClose(); }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="1" y1="1" x2="23" y2="23" />
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        </svg>
                        Ausblenden
                    </button>
                </div>
            </>
        );
    }

    // Empty space context menu — tile management
    return (
        <>
            <div className="tile-grid-context-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
            <div ref={menuRef} className="tile-grid-context-menu" style={{ left: state.x, top: state.y }}>
                <div className="tile-grid-context-menu-title">Kacheln verwalten</div>
                {allTiles.map(tile => {
                    const tileLayout = layout[tile.key];
                    const isVisible = tileLayout?.visible !== false;
                    return (
                        <button
                            key={tile.key}
                            className="tile-grid-context-menu-item"
                            onClick={() => onToggleVisibility(tile.key)}
                        >
                            <div className={`tile-grid-context-menu-check ${isVisible ? 'tile-grid-context-menu-check--active' : ''}`}>
                                {isVisible && (
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                )}
                            </div>
                            <span>{tile.title}</span>
                            {tile.description && (
                                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                                    {tile.key.startsWith('plugin.') ? 'Plugin' : ''}
                                </span>
                            )}
                        </button>
                    );
                })}
                <div className="tile-grid-context-menu-divider" />
                <button className="tile-grid-context-menu-item" onClick={() => { onResetAll(); onClose(); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1 4 1 10 7 10" />
                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                    Standard-Layout wiederherstellen
                </button>
            </div>
        </>
    );
}

/* ════════════════════════════════════════════
   Dashboard
   ════════════════════════════════════════════ */

export function Dashboard() {
    const { user } = useAuth();
    const [layout, setLayout] = useState<DashboardLayoutState>({});
    const [loadingLayout, setLoadingLayout] = useState(true);
    const [error, setError] = useState('');
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    const welcomeName = fullName || user?.displayName || user?.username || 'Benutzer';

    const greeting = useMemo(() => {
        const greetings = [
            { lang: 'Deutsch', text: 'Willkommen zurück' },
            { lang: 'English', text: 'Welcome back' },
            { lang: 'Espanol', text: 'Bienvenido de nuevo' },
            { lang: 'Francais', text: 'Bon retour' },
            { lang: 'Italiano', text: 'Bentornato' },
            { lang: 'Portugues', text: 'Bem-vindo de volta' },
            { lang: 'Nederlands', text: 'Welkom terug' },
            { lang: 'Polski', text: 'Witaj ponownie' },
            { lang: '\u0420\u0443\u0441\u0441\u043A\u0438\u0439', text: '\u0421 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0435\u043D\u0438\u0435\u043C' },
        ];
        return greetings[Math.floor(Math.random() * greetings.length)];
    }, []);

    /* ── Tile Definitions ── */

    const coreTiles = useMemo<DashboardTileDefinition[]>(() => ([
        {
            key: 'core.system-status',
            title: 'Systemstatus',
            description: 'Core-Dienststatus',
            defaultW: 12,
            defaultH: 8,
            defaultVisible: true,
            render: () => <SystemStatusTile />,
        },
        {
            key: 'core.plugins',
            title: 'Aktive Plugins',
            description: 'Geladene Frontend-Module',
            defaultW: 12,
            defaultH: 8,
            defaultVisible: true,
            render: (sizeClass) => (
                <div>
                    <div className="dashboard-tile-header">
                        <div>
                            <div className="card-title">Aktive Plugins</div>
                            <p className="dashboard-tile-subtitle">Geladene Frontend-Module</p>
                        </div>
                    </div>
                    <div className="dashboard-tile-body">
                        <p className="text-muted">{pluginRegistry.length} aktive Plugin-Module</p>
                    </div>
                </div>
            ),
        },
        {
            key: 'core.current-user',
            title: 'Benutzer',
            description: 'Aktuelle Anmeldung',
            defaultW: 12,
            defaultH: 8,
            defaultVisible: true,
            render: (sizeClass) => (
                <div>
                    <div className="dashboard-tile-header">
                        <div>
                            <div className="card-title">Benutzer</div>
                            <p className="dashboard-tile-subtitle">Aktuelle Anmeldung</p>
                        </div>
                    </div>
                    <div className="dashboard-tile-body">
                        <p className="text-muted">Eingeloggt als <strong>{welcomeName}</strong></p>
                    </div>
                </div>
            ),
        },
        {
            key: 'core.notifications',
            title: 'Benachrichtigungen',
            defaultW: 12,
            defaultH: 8,
            defaultVisible: true,
            render: (sizeClass) => <NotificationTileContent sizeClass={sizeClass} />,
        },
    ]), [welcomeName]);

    const pluginTiles = useMemo<DashboardTileDefinition[]>(
        () => pluginRegistry.flatMap((entry, entryIndex) =>
            entry.dashboardTiles.map((tile, tileIndex) => {
                // Resolve dimensions: prefer new format, fallback to legacy
                let w = tile.defaultWidth || DEFAULT_W;
                let h = tile.defaultHeight || DEFAULT_H;
                if (!tile.defaultWidth && !tile.defaultHeight && tile.defaultSize) {
                    const legacy = legacySizeToGrid(tile.defaultSize);
                    w = legacy.w;
                    h = legacy.h;
                }
                return {
                    key: `plugin.${entry.id}.${tile.id}`,
                    title: tile.title,
                    description: tile.description || `Kachel aus Plugin "${entry.name}"`,
                    permission: tile.permission,
                    defaultW: w,
                    defaultH: h,
                    defaultVisible: tile.defaultVisible !== false,
                    viewModes: tile.viewModes,
                    defaultViewMode: tile.defaultViewMode,
                    component: tile.component,
                };
            })
        ),
        []
    );

    const hasPermission = (permission?: string): boolean => {
        if (!permission) return true;
        if (!user) return false;
        return user.permissions.includes('*') || user.permissions.includes(permission);
    };

    const allTiles = useMemo(
        () => [...coreTiles, ...pluginTiles].filter((tile) => hasPermission(tile.permission)),
        [coreTiles, pluginTiles, user]
    );

    /* ── Load Layout ── */

    const layoutInitialized = useRef(false);

    useEffect(() => {
        let active = true;
        async function loadLayout() {
            setLoadingLayout(true);
            try {
                const res = await apiFetch('/api/auth/dashboard-layout');
                if (!active) return;
                if (!res.ok) {
                    setError('Dashboard-Einstellungen konnten nicht geladen werden.');
                    setLayout({});
                    return;
                }
                const data = await res.json() as { tiles?: unknown };
                const loaded = normalizeLayoutResponse(data.tiles);
                setLayout(loaded);
                setError('');
            } catch {
                if (!active) return;
                setError('Dashboard-Einstellungen konnten nicht geladen werden.');
                setLayout({});
            } finally {
                if (active) setLoadingLayout(false);
            }
        }
        layoutInitialized.current = false;
        void loadLayout();
        return () => { active = false; };
    }, [user?.id]);

    // Once layout loaded AND tiles known, fill in any missing positions ONCE and save
    useEffect(() => {
        if (loadingLayout || layoutInitialized.current) return;

        const full = assignDefaultPositions(allTiles, layout);
        // Check if assignDefaultPositions actually added new keys
        const hasNewKeys = Object.keys(full).some(k => !(k in layout));
        if (hasNewKeys || Object.keys(layout).length === 0) {
            setLayout(full);
            // Save full layout so next load is complete
            saveLayout(full);
        }
        layoutInitialized.current = true;
    }, [loadingLayout, allTiles, layout]);

    /* ── Auto-Save ── */

    const saveLayout = useCallback(async (newLayout: DashboardLayoutState) => {
        try {
            await apiFetch('/api/auth/dashboard-layout', {
                method: 'PUT',
                body: JSON.stringify({ tiles: newLayout }),
            });
        } catch {
            // Silent fail — will retry on next change
        }
    }, []);

    const debouncedSave = useCallback((newLayout: DashboardLayoutState) => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            saveLayout(newLayout);
        }, 500);
    }, [saveLayout]);

    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, []);

    /* ── TileGrid onChange ── */

    const handleGridChange = useCallback((gridItems: TileGridItem[]) => {
        setLayout(prev => {
            const next = { ...prev };
            for (const item of gridItems) {
                next[item.id] = {
                    x: item.x,
                    y: item.y,
                    w: item.w,
                    h: item.h,
                    visible: item.visible !== false,
                    viewMode: prev[item.id]?.viewMode,
                };
            }
            debouncedSave(next);
            return next;
        });
    }, [debouncedSave]);

    /* ── Visibility Toggle ── */

    const toggleVisibility = useCallback((key: string) => {
        setLayout(prev => {
            const tile = allTiles.find(t => t.key === key);
            if (!tile) return prev;
            const current = prev[key] || { x: 0, y: 0, w: tile.defaultW, h: tile.defaultH, visible: tile.defaultVisible };
            const wasHidden = current.visible === false;
            const nowVisible = !current.visible;

            if (wasHidden && nowVisible) {
                // Place re-enabled tile at bottom-left, after all visible tiles
                let maxBottom = 0;
                for (const [k, l] of Object.entries(prev)) {
                    if (k !== key && l.visible !== false) {
                        maxBottom = Math.max(maxBottom, l.y + l.h);
                    }
                }
                const next = { ...prev, [key]: { ...current, visible: true, x: 0, y: maxBottom } };
                debouncedSave(next);
                return next;
            } else {
                const next = { ...prev, [key]: { ...current, visible: nowVisible } };
                debouncedSave(next);
                return next;
            }
        });
    }, [allTiles, debouncedSave]);

    /* ── View Mode Toggle ── */

    const setTileViewMode = useCallback((key: string, viewMode: string) => {
        setLayout((prev) => {
            const tile = allTiles.find((t) => t.key === key);
            if (!tile) return prev;
            if (!tile.viewModes?.some((mode) => mode.id === viewMode)) return prev;

            const base = resolveTileLayout(tile, prev);
            const next = { ...prev, [key]: { ...base, viewMode } };
            debouncedSave(next);
            return next;
        });
    }, [allTiles, debouncedSave]);

    /* ── Reset Tile ── */

    const resetTile = useCallback((key: string) => {
        setLayout(prev => {
            const tile = allTiles.find(t => t.key === key);
            if (!tile) return prev;
            const current = prev[key];
            if (!current) return prev;
            const next = { ...prev, [key]: { ...current, w: tile.defaultW, h: tile.defaultH } };
            debouncedSave(next);
            return next;
        });
    }, [allTiles, debouncedSave]);

    /* ── Reset All ── */

    const resetAll = useCallback(() => {
        const fresh = assignDefaultPositions(allTiles, {});
        setLayout(fresh);
        debouncedSave(fresh);
        layoutInitialized.current = true;
    }, [allTiles, debouncedSave]);

    /* ── Build Grid Items ── */

    const gridItems = useMemo<TileGridItem[]>(() => {
        return allTiles.map(tile => {
            const l = layout[tile.key] || { x: 0, y: 0, w: tile.defaultW, h: tile.defaultH, visible: tile.defaultVisible };
            return {
                id: tile.key,
                x: l.x,
                y: l.y,
                w: l.w,
                h: l.h,
                visible: l.visible,
                minW: 9,
                minH: 6,
                maxW: GRID_COLUMNS,
            };
        });
    }, [allTiles, layout]);

    const tileByKey = useMemo(
        () => new Map(allTiles.map(t => [t.key, t])),
        [allTiles]
    );

    /* ── Render Tile ── */

    const renderTile = useCallback((item: TileGridItem, sizeClass: TileSizeClass): ReactNode => {
        const tile = tileByKey.get(item.id);
        if (!tile) return null;

        const handleContextMenu = (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, type: 'tile', tileKey: item.id });
        };

        return (
            <div onContextMenu={handleContextMenu} style={{ height: '100%' }}>
                {tile.component ? (
                    <Suspense fallback={<div className="text-muted">Kachel wird geladen...</div>}>
                        <tile.component viewMode={layout[item.id]?.viewMode || tile.defaultViewMode || tile.viewModes?.[0]?.id} />
                    </Suspense>
                ) : (
                    tile.render?.(sizeClass)
                )}
            </div>
        );
    }, [tileByKey, layout]);

    /* ── Empty Area Context Menu ── */

    const handleEmptyContextMenu = useCallback((pos: { x: number; y: number }) => {
        setContextMenu({ x: pos.x, y: pos.y, type: 'empty' });
    }, []);

    if (loadingLayout) {
        return <div className="text-muted">Dashboard wird geladen...</div>;
    }

    return (
        <div>
            <div className="page-header dashboard-page-header">
                <div>
                    <h1 className="dashboard-greeting">{greeting.text}, {welcomeName}!</h1>
                </div>
            </div>

            {error && (
                <div className="modal-alert" style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)', marginBottom: 'var(--space-md)' }}>
                    {error}
                </div>
            )}

            <TileGrid
                items={gridItems}
                columns={GRID_COLUMNS}
                onChange={handleGridChange}
                renderTile={renderTile}
                onEmptyContextMenu={handleEmptyContextMenu}
            />

            {contextMenu && (
                <ContextMenu
                    state={contextMenu}
                    allTiles={allTiles}
                    layout={layout}
                    onToggleVisibility={toggleVisibility}
                    onResetTile={resetTile}
                    onSetTileViewMode={setTileViewMode}
                    onResetAll={resetAll}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}
