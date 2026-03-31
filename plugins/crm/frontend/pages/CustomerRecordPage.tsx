import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useNavigate, useParams } from '@mike/hooks/usePluginNavigate';
import { apiFetch } from '@mike/context/AuthContext';
import { useToast } from '@mike/components/ModalProvider';
import { TileGrid, type TileGridItem, type TileSizeClass } from '@mike/components/TileGrid';
import CustomerTicketsTile from '../tiles/CustomerTicketsTile';
import CustomerContactsTile from '../tiles/CustomerContactsTile';
import CustomerNotesTile from '../tiles/CustomerNotesTile';
import CustomerAddressesTile from '../tiles/CustomerAddressesTile';

/* ════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════ */

const backIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
);

const starIcon = (filled: boolean) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? 'var(--color-warning)' : 'none'} stroke={filled ? 'var(--color-warning)' : 'var(--color-text-muted)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
);

const checkIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const cancelIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

const trashIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
);

const lockClosedIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
);

const lockOpenIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 019.9-1" />
    </svg>
);

const resetIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
);

const hideIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    </svg>
);

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

interface Customer {
    id: number;
    customer_number: string;
    type: string;
    company_name: string | null;
    salutation: string | null;
    first_name: string | null;
    last_name: string | null;
    display_name: string;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    fax: string | null;
    website: string | null;
    street: string | null;
    zip: string | null;
    city: string | null;
    country: string | null;
    vat_id: string | null;
    industry: string | null;
    category: string | null;
    status: string;
    payment_terms: string | null;
    notes_internal: string | null;
    custom_fields: any;
    created_by: number | null;
    created_at: string;
    updated_at: string;
}

interface Activity {
    id: number;
    type: string;
    title: string;
    created_by_name: string;
    created_at: string;
    metadata: any;
}

interface TileLayout {
    x: number; y: number; w: number; h: number; visible: boolean;
}

type LayoutState = Record<string, TileLayout>;

interface TileDef {
    key: string;
    title: string;
    defaultW: number;
    defaultH: number;
    defaultVisible: boolean;
}

interface ContextMenuState {
    x: number;
    y: number;
    type: 'empty' | 'tile';
    tileKey?: string;
}

/* ════════════════════════════════════════════
   Inline-Edit Feld
   ════════════════════════════════════════════ */

function InlineField({
    label, value, field, type = 'text', onSave, options,
}: {
    label: string;
    value: string | null;
    field: string;
    type?: 'text' | 'select' | 'textarea';
    onSave: (field: string, value: string) => Promise<void>;
    options?: { value: string; label: string }[];
}) {
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState(value || '');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (editValue === (value || '')) { setEditing(false); return; }
        setSaving(true);
        await onSave(field, editValue);
        setSaving(false);
        setEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && type !== 'textarea') void save();
        if (e.key === 'Escape') { setEditValue(value || ''); setEditing(false); }
    };

    if (editing) {
        return (
            <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 2 }}>{label}</div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {type === 'select' ? (
                        <select className="input" value={editValue} onChange={(e) => setEditValue(e.target.value)} style={{ flex: 1, fontSize: 13, padding: '4px 6px' }} autoFocus>
                            {options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    ) : type === 'textarea' ? (
                        <textarea className="input" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={handleKeyDown}
                            style={{ flex: 1, fontSize: 13, padding: '4px 6px', minHeight: 60, resize: 'vertical' }} autoFocus />
                    ) : (
                        <input className="input" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={handleKeyDown}
                            style={{ flex: 1, fontSize: 13, padding: '4px 6px' }} autoFocus />
                    )}
                    <button onClick={save} disabled={saving} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-success)', display: 'flex', padding: 2 }}>{checkIcon}</button>
                    <button onClick={() => { setEditValue(value || ''); setEditing(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2 }}>{cancelIcon}</button>
                </div>
            </div>
        );
    }

    let display: React.ReactNode = value || <span className="text-muted">—</span>;
    if (field === 'email' && value) display = <a href={`mailto:${value}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{value}</a>;
    else if ((field === 'phone' || field === 'mobile' || field === 'fax') && value) display = <a href={`tel:${value}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{value}</a>;
    else if (field === 'website' && value) display = <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{value}</a>;

    return (
        <div
            style={{ marginBottom: 8, cursor: 'pointer', padding: '2px 4px', borderRadius: 'var(--radius-sm)', transition: 'background 120ms ease' }}
            onClick={() => { setEditValue(value || ''); setEditing(true); }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 1 }}>{label}</div>
            <div style={{ fontSize: 13 }}>{display}</div>
        </div>
    );
}

/* ════════════════════════════════════════════
   Context Menu
   ════════════════════════════════════════════ */

function RecordContextMenu({ state, tileDefs, layout, onToggleVisibility, onResetTile, onResetAll, onClose }: {
    state: ContextMenuState;
    tileDefs: TileDef[];
    layout: LayoutState;
    onToggleVisibility: (key: string) => void;
    onResetTile: (key: string) => void;
    onResetAll: () => void;
    onClose: () => void;
}) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = menuRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 8}px`;
        if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 8}px`;
    }, [state]);

    if (state.type === 'tile' && state.tileKey) {
        const tile = tileDefs.find(t => t.key === state.tileKey);
        if (!tile) return null;
        return (
            <>
                <div className="tile-grid-context-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
                <div ref={menuRef} className="tile-grid-context-menu" style={{ left: state.x, top: state.y }}>
                    <div className="tile-grid-context-menu-title">{tile.title}</div>
                    <button className="tile-grid-context-menu-item" onClick={() => { onResetTile(tile.key); onClose(); }}>
                        {resetIcon} Groesse zuruecksetzen
                    </button>
                    <button className="tile-grid-context-menu-item tile-grid-context-menu-item--danger" onClick={() => { onToggleVisibility(tile.key); onClose(); }}>
                        {hideIcon} Ausblenden
                    </button>
                </div>
            </>
        );
    }

    return (
        <>
            <div className="tile-grid-context-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
            <div ref={menuRef} className="tile-grid-context-menu" style={{ left: state.x, top: state.y }}>
                <div className="tile-grid-context-menu-title">Kacheln verwalten</div>
                {tileDefs.map(tile => {
                    const isVisible = layout[tile.key]?.visible !== false;
                    return (
                        <button key={tile.key} className="tile-grid-context-menu-item" onClick={() => onToggleVisibility(tile.key)}>
                            <div className={`tile-grid-context-menu-check ${isVisible ? 'tile-grid-context-menu-check--active' : ''}`}>
                                {isVisible && (
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                )}
                            </div>
                            <span>{tile.title}</span>
                        </button>
                    );
                })}
                <div className="tile-grid-context-menu-divider" />
                <button className="tile-grid-context-menu-item" onClick={() => { onResetAll(); onClose(); }}>
                    {resetIcon} Standard-Layout wiederherstellen
                </button>
            </div>
        </>
    );
}

/* ════════════════════════════════════════════
   Kundenakte
   ════════════════════════════════════════════ */

const GRID_COLUMNS = 48;

const TILE_DEFS: TileDef[] = [
    { key: 'crm.activity-timeline', title: 'Aktivitaeten', defaultW: 24, defaultH: 12, defaultVisible: true },
    { key: 'crm.customer-tickets', title: 'Tickets', defaultW: 24, defaultH: 12, defaultVisible: true },
    { key: 'crm.customer-contacts', title: 'Ansprechpartner', defaultW: 24, defaultH: 10, defaultVisible: true },
    { key: 'crm.customer-addresses', title: 'Adressen', defaultW: 24, defaultH: 10, defaultVisible: true },
    { key: 'crm.customer-notes', title: 'Notizen', defaultW: 24, defaultH: 10, defaultVisible: true },
];

function assignDefaultPositions(defs: TileDef[], existing: LayoutState): LayoutState {
    const result: LayoutState = { ...existing };
    const occupied = defs.filter(t => result[t.key]).map(t => result[t.key]);
    for (const tile of defs) {
        if (result[tile.key]) continue;
        let placed = false;
        for (let y = 0; y < 200 && !placed; y++) {
            for (let x = 0; x <= GRID_COLUMNS - tile.defaultW; x++) {
                const cand = { x, y, w: tile.defaultW, h: tile.defaultH };
                const overlap = occupied.some(o => o.x < cand.x + cand.w && o.x + o.w > cand.x && o.y < cand.y + cand.h && o.y + o.h > cand.y);
                if (!overlap) {
                    result[tile.key] = { ...cand, visible: tile.defaultVisible };
                    occupied.push(result[tile.key]);
                    placed = true;
                    break;
                }
            }
        }
        if (!placed) {
            const maxY = occupied.reduce((m, o) => Math.max(m, o.y + o.h), 0);
            result[tile.key] = { x: 0, y: maxY, w: tile.defaultW, h: tile.defaultH, visible: tile.defaultVisible };
            occupied.push(result[tile.key]);
        }
    }
    return result;
}

export default function CustomerRecordPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const toast = useToast();

    const [customer, setCustomer] = useState<Customer | null>(null);
    const [loading, setLoading] = useState(true);
    const [isFavorite, setIsFavorite] = useState(false);
    const [activities, setActivities] = useState<Activity[]>([]);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Kachel-Layout (DB-persisted)
    const [layout, setLayout] = useState<LayoutState>({});
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const layoutInitialized = useRef(false);

    // Lock (localStorage)
    const [locked, setLocked] = useState(() => {
        const stored = localStorage.getItem('crm-record-locked');
        return stored !== null ? stored === 'true' : true;
    });

    // Context Menu
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

    /* ── Load Data ── */
    const loadCustomer = useCallback(async () => {
        if (!id) return;
        try {
            const [custRes, favRes, actRes] = await Promise.all([
                apiFetch(`/api/plugins/crm/customers/${id}`),
                apiFetch('/api/plugins/crm/layout/favorites'),
                apiFetch(`/api/plugins/crm/layout/activities/${id}?limit=20`),
            ]);
            if (custRes.ok) { setCustomer(await custRes.json()); }
            else { toast.error('Kunde nicht gefunden'); navigate('/crm/customers'); return; }
            if (favRes.ok) { const d = await favRes.json(); setIsFavorite(new Set((d.favorites || []).map((f: any) => f.id)).has(Number(id))); }
            if (actRes.ok) { const d = await actRes.json(); setActivities(d.activities || []); }

            const layoutRes = await apiFetch('/api/plugins/crm/layout/');
            if (layoutRes.ok) {
                const ld = await layoutRes.json();
                if (ld.layout && typeof ld.layout === 'object') setLayout(ld.layout);
            }
            void apiFetch(`/api/plugins/crm/layout/recent/${id}`, { method: 'POST' });
        } catch { /* */ }
        setLoading(false);
    }, [id]);

    useEffect(() => { void loadCustomer(); }, [loadCustomer]);

    /* ── Layout Persistence ── */
    const saveLayout = useCallback(async (newLayout: LayoutState) => {
        try {
            await apiFetch('/api/plugins/crm/layout/', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ layout: newLayout }),
            });
        } catch { /* */ }
    }, []);

    const debouncedSave = useCallback((newLayout: LayoutState) => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => saveLayout(newLayout), 500);
    }, [saveLayout]);

    useEffect(() => () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); }, []);

    // Auto-assign positions once
    useEffect(() => {
        if (loading || layoutInitialized.current) return;
        const full = assignDefaultPositions(TILE_DEFS, layout);
        const hasNew = Object.keys(full).some(k => !(k in layout));
        if (hasNew || Object.keys(layout).length === 0) { setLayout(full); saveLayout(full); }
        layoutInitialized.current = true;
    }, [loading, layout]);

    /* ── Inline-Edit ── */
    const handleFieldSave = async (field: string, value: string) => {
        try {
            const res = await apiFetch(`/api/plugins/crm/customers/${id}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [field]: value }),
            });
            if (res.ok) { setCustomer(await res.json()); toast.success('Gespeichert'); }
            else { const err = await res.json(); toast.error(err.error || 'Fehler'); }
        } catch { toast.error('Netzwerkfehler'); }
    };

    const toggleFavorite = async () => {
        try { await apiFetch(`/api/plugins/crm/layout/favorites/${id}`, { method: isFavorite ? 'DELETE' : 'POST' }); setIsFavorite(!isFavorite); }
        catch { /* */ }
    };

    const handleDelete = async () => {
        try {
            const res = await apiFetch(`/api/plugins/crm/customers/${id}`, { method: 'DELETE' });
            if (res.ok) { toast.success('Kunde geloescht'); navigate('/crm/customers'); }
        } catch { toast.error('Fehler'); }
    };

    /* ── TileGrid Handlers ── */
    const handleGridChange = useCallback((items: TileGridItem[]) => {
        setLayout(prev => {
            const next = { ...prev };
            for (const item of items) next[item.id] = { x: item.x, y: item.y, w: item.w, h: item.h, visible: item.visible !== false };
            debouncedSave(next);
            return next;
        });
    }, [debouncedSave]);

    const toggleVisibility = useCallback((key: string) => {
        setLayout(prev => {
            const tile = TILE_DEFS.find(t => t.key === key);
            if (!tile) return prev;
            const cur = prev[key] || { x: 0, y: 0, w: tile.defaultW, h: tile.defaultH, visible: tile.defaultVisible };
            const wasHidden = cur.visible === false;
            if (wasHidden) {
                let maxBottom = 0;
                for (const [k, l] of Object.entries(prev)) { if (k !== key && l.visible !== false) maxBottom = Math.max(maxBottom, l.y + l.h); }
                const next = { ...prev, [key]: { ...cur, visible: true, x: 0, y: maxBottom } };
                debouncedSave(next);
                return next;
            }
            const next = { ...prev, [key]: { ...cur, visible: false } };
            debouncedSave(next);
            return next;
        });
    }, [debouncedSave]);

    const resetTile = useCallback((key: string) => {
        setLayout(prev => {
            const tile = TILE_DEFS.find(t => t.key === key);
            if (!tile || !prev[key]) return prev;
            const next = { ...prev, [key]: { ...prev[key], w: tile.defaultW, h: tile.defaultH } };
            debouncedSave(next);
            return next;
        });
    }, [debouncedSave]);

    const resetAll = useCallback(() => {
        const fresh = assignDefaultPositions(TILE_DEFS, {});
        setLayout(fresh);
        debouncedSave(fresh);
        layoutInitialized.current = true;
    }, [debouncedSave]);

    /* ── Grid Items ── */
    const gridItems = useMemo(() => TILE_DEFS.map((def, idx) => {
        const s = layout[def.key];
        return {
            id: def.key,
            x: s?.x ?? (idx % 2 === 0 ? 0 : 24),
            y: s?.y ?? Math.floor(idx / 2) * def.defaultH,
            w: s?.w ?? def.defaultW,
            h: s?.h ?? def.defaultH,
            visible: s?.visible ?? def.defaultVisible,
            minW: 12, minH: 6, maxW: GRID_COLUMNS,
        };
    }), [layout]);

    /* ── Render Tiles ── */
    const renderTile = useCallback((item: TileGridItem, sizeClass: TileSizeClass) => {
        const def = TILE_DEFS.find(d => d.key === item.id);
        if (!def) return null;

        const handleCtx = (e: React.MouseEvent) => {
            if (locked) return;
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, type: 'tile', tileKey: item.id });
        };

        let content = null;
        if (def.key === 'crm.activity-timeline') {
            content = (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-sm)' }}>Aktivitaeten</div>
                    <div style={{ flex: 1, overflow: 'auto' }}>
                        {activities.length === 0 ? (
                            <div className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>Noch keine Aktivitaeten</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {activities.map(a => (
                                    <div key={a.id} style={{ display: 'flex', gap: 8, fontSize: 'var(--font-size-sm)' }}>
                                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', flexShrink: 0, marginTop: 5 }} />
                                        <div>
                                            <div style={{ fontWeight: 500 }}>{a.title}</div>
                                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                                {new Date(a.created_at).toLocaleDateString('de-DE')} — {a.created_by_name}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            );
        } else if (def.key === 'crm.customer-tickets' && customer) content = <CustomerTicketsTile customerId={customer.id} />;
        else if (def.key === 'crm.customer-contacts' && customer) content = <CustomerContactsTile customerId={customer.id} />;
        else if (def.key === 'crm.customer-addresses' && customer) content = <CustomerAddressesTile customerId={customer.id} />;
        else if (def.key === 'crm.customer-notes' && customer) content = <CustomerNotesTile customerId={customer.id} />;

        return <div onContextMenu={handleCtx} style={{ height: '100%' }}>{content}</div>;
    }, [activities, customer, locked]);

    const handleEmptyCtx = useCallback((pos: { x: number; y: number }) => {
        if (locked) return;
        setContextMenu({ x: pos.x, y: pos.y, type: 'empty' });
    }, [locked]);

    /* ── Render ── */
    const statusColors: Record<string, { bg: string; text: string; label: string }> = {
        active: { bg: 'rgba(34,197,94,0.1)', text: '#22c55e', label: 'Aktiv' },
        inactive: { bg: 'rgba(239,68,68,0.1)', text: '#ef4444', label: 'Inaktiv' },
        prospect: { bg: 'rgba(234,179,8,0.1)', text: '#eab308', label: 'Interessent' },
    };

    if (loading || !customer) return <div className="text-muted" style={{ padding: 'var(--space-lg)' }}>Laden...</div>;

    const sc = statusColors[customer.status] || statusColors.active;

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
                <button onClick={() => navigate('/crm/customers')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--color-text-muted)' }}>{backIcon}</button>
                <button onClick={toggleFavorite} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>{starIcon(isFavorite)}</button>
                <div style={{ flex: 1 }}>
                    <h1 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, margin: 0, lineHeight: 1.3 }}>{customer.display_name}</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                        <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{customer.customer_number}</span>
                        <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: sc.bg, color: sc.text, fontWeight: 600 }}>{sc.label}</span>
                        <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-subtle)', fontWeight: 500 }}>{customer.type === 'company' ? 'Firma' : 'Person'}</span>
                    </div>
                </div>

                {/* Lock Toggle */}
                <button
                    onClick={() => setLocked(prev => { const n = !prev; localStorage.setItem('crm-record-locked', String(n)); return n; })}
                    className="btn btn-ghost"
                    title={locked ? 'Layout entsperren' : 'Layout sperren'}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        fontSize: 'var(--font-size-xs)', padding: '6px 10px',
                        color: locked ? 'var(--color-text-muted)' : 'var(--color-primary)',
                        borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
                        background: locked ? 'transparent' : 'var(--color-primary-light, rgba(37,99,235,0.08))',
                        transition: 'all 0.2s ease',
                    }}
                >{locked ? lockClosedIcon : lockOpenIcon}</button>

                {/* PDF */}
                <button
                    className="btn btn-secondary"
                    onClick={async () => {
                        try {
                            const res = await apiFetch(`/api/plugins/crm/io/export/pdf/${id}`);
                            if (res.ok) {
                                const blob = await res.blob();
                                const a = document.createElement('a');
                                a.href = URL.createObjectURL(blob);
                                a.download = `Kundenakte_${customer.customer_number}.pdf`;
                                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                URL.revokeObjectURL(a.href);
                                toast.success('PDF heruntergeladen');
                            }
                        } catch { toast.error('PDF-Export fehlgeschlagen'); }
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    PDF
                </button>

                {/* Delete */}
                <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(true)} style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {trashIcon} Loeschen
                </button>
            </div>

            {/* Main: TileGrid + Sidebar */}
            <div style={{ display: 'flex', gap: 'var(--space-lg)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <TileGrid items={gridItems} columns={GRID_COLUMNS} locked={locked} onChange={handleGridChange} renderTile={renderTile} onEmptyContextMenu={handleEmptyCtx} />
                </div>
                <div style={{ width: 320, flexShrink: 0, position: 'sticky', top: 'var(--space-md)', alignSelf: 'flex-start', maxHeight: 'calc(100vh - 120px)', overflow: 'auto' }}>
                    <div className="card" style={{ padding: 'var(--space-md)' }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-sm)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-sm)' }}>Stammdaten</div>
                        {customer.type === 'company' && <InlineField label="Firmenname" value={customer.company_name} field="company_name" onSave={handleFieldSave} />}
                        <InlineField label="E-Mail (Zentrale)" value={customer.email} field="email" onSave={handleFieldSave} />
                        <InlineField label="Telefon (Zentrale)" value={customer.phone} field="phone" onSave={handleFieldSave} />
                        <InlineField label="Webseite" value={customer.website} field="website" onSave={handleFieldSave} />
                        <div style={{ borderTop: '1px solid var(--color-border)', margin: '8px 0', opacity: 0.5 }} />
                        <InlineField label="Strasse" value={customer.street} field="street" onSave={handleFieldSave} />
                        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 4 }}>
                            <InlineField label="PLZ" value={customer.zip} field="zip" onSave={handleFieldSave} />
                            <InlineField label="Ort" value={customer.city} field="city" onSave={handleFieldSave} />
                        </div>
                        <InlineField label="Land" value={customer.country} field="country" onSave={handleFieldSave} />
                        <div style={{ borderTop: '1px solid var(--color-border)', margin: '8px 0', opacity: 0.5 }} />
                        <InlineField label="USt-IdNr." value={customer.vat_id} field="vat_id" onSave={handleFieldSave} />
                        <InlineField label="Branche" value={customer.industry} field="industry" onSave={handleFieldSave} />
                        <InlineField label="Kategorie" value={customer.category} field="category" onSave={handleFieldSave} />
                        <InlineField label="Status" value={customer.status} field="status" type="select" onSave={handleFieldSave} options={[{ value: 'active', label: 'Aktiv' }, { value: 'inactive', label: 'Inaktiv' }, { value: 'prospect', label: 'Interessent' }]} />
                        <InlineField label="Zahlungsbedingungen" value={customer.payment_terms} field="payment_terms" onSave={handleFieldSave} />
                        <InlineField label="Interne Notizen" value={customer.notes_internal} field="notes_internal" type="textarea" onSave={handleFieldSave} />
                        <div style={{ borderTop: '1px solid var(--color-border)', margin: '8px 0', opacity: 0.5 }} />
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Erstellt: {new Date(customer.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Aktualisiert: {new Date(customer.updated_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                </div>
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <RecordContextMenu state={contextMenu} tileDefs={TILE_DEFS} layout={layout}
                    onToggleVisibility={toggleVisibility} onResetTile={resetTile} onResetAll={resetAll} onClose={() => setContextMenu(null)} />
            )}

            {/* Delete Confirm */}
            {showDeleteConfirm && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowDeleteConfirm(false)}>
                    <div className="card" style={{ padding: 'var(--space-lg)', maxWidth: 450, width: '100%' }} onClick={(e) => e.stopPropagation()}>
                        <h3 style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-sm)' }}>Unwiderruflich loeschen</h3>
                        <p style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-md)' }}>
                            Soll der Kunde <strong>{customer.display_name}</strong> ({customer.customer_number}) wirklich unwiderruflich geloescht werden?
                            Alle zugehoerigen Daten (Tickets, Kontakte, Notizen) werden ebenfalls geloescht.
                        </p>
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Abbrechen</button>
                            <button className="btn" style={{ background: 'var(--color-danger)', color: 'white' }} onClick={handleDelete}>Unwiderruflich loeschen</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
