import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../hooks/usePermission';
import { pluginRegistry, type PluginNavItem } from '../pluginRegistry';

const svgProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const PinIcon = ({ pinned }: { pinned: boolean }) => (
    <svg {...svgProps} className={`regie-pin-icon ${pinned ? 'pinned' : ''}`}>
        {pinned ? (
            <>
                <line x1="12" y1="17" x2="12" y2="22" />
                <path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1V2H8v4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24z" fill="currentColor" />
            </>
        ) : (
            <>
                <line x1="12" y1="17" x2="12" y2="22" />
                <path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1V2H8v4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24z" />
            </>
        )}
    </svg>
);

const SearchIcon = (
    <svg {...svgProps}>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);

const CloseIcon = (
    <svg {...svgProps} width={20} height={20}>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

interface RegieMenuProps {
    open: boolean;
    onClose: () => void;
}

export function RegieMenu({ open, onClose }: RegieMenuProps) {
    const { user, updatePinnedTabs } = useAuth();
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [activeCategory, setActiveCategory] = useState('Alle');
    const [animatingTab, setAnimatingTab] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const hasPermission = useCallback((permission?: string): boolean => {
        if (!permission) return true;
        if (!user) return false;
        return user.permissions.includes('*') || user.permissions.includes(permission);
    }, [user]);

    const pluginNavItems = useMemo(() =>
        pluginRegistry
            .flatMap((entry) => entry.navItems)
            .slice()
            .sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label)),
        []
    );

    const visibleItems = useMemo(() =>
        pluginNavItems.filter((item) => hasPermission(item.permission)),
        [pluginNavItems, hasPermission]
    );

    // Build categories from groups
    const categories = useMemo(() => {
        const categorySet = new Set<string>();
        for (const item of visibleItems) {
            if (item.group) categorySet.add(item.group);
        }
        return ['Alle', ...Array.from(categorySet).sort()];
    }, [visibleItems]);

    // Filter items
    const filteredItems = useMemo(() => {
        let items = visibleItems;
        if (activeCategory !== 'Alle') {
            items = items.filter((item) => item.group === activeCategory);
        }
        if (searchTerm.trim()) {
            const term = searchTerm.trim().toLowerCase();
            items = items.filter((item) =>
                item.label.toLowerCase().includes(term) ||
                (item.group && item.group.toLowerCase().includes(term))
            );
        }
        return items;
    }, [visibleItems, activeCategory, searchTerm]);

    // Group filtered items by group
    const groupedItems = useMemo(() => {
        const groups = new Map<string, PluginNavItem[]>();
        const ungrouped: PluginNavItem[] = [];
        for (const item of filteredItems) {
            if (item.group) {
                const existing = groups.get(item.group) || [];
                existing.push(item);
                groups.set(item.group, existing);
            } else {
                ungrouped.push(item);
            }
        }
        return { groups, ungrouped };
    }, [filteredItems]);

    const pinnedPaths = useMemo(() => new Set(user?.pinnedTabs || []), [user?.pinnedTabs]);

    const togglePin = async (item: PluginNavItem) => {
        const path = item.path.startsWith('/') ? item.path : `/${item.path}`;
        const current = user?.pinnedTabs || [];
        let newTabs: string[];
        if (pinnedPaths.has(path)) {
            newTabs = current.filter((p) => p !== path);
        } else {
            newTabs = [...current, path];
        }
        setAnimatingTab(path);
        setTimeout(() => setAnimatingTab(null), 400);
        try {
            await updatePinnedTabs(newTabs);
        } catch { /* toast handled elsewhere */ }
    };

    const handleNavigate = (item: PluginNavItem) => {
        const path = item.path.startsWith('/') ? item.path : `/${item.path}`;
        navigate(path);
        onClose();
    };

    // Focus search on open
    useEffect(() => {
        if (open) {
            setSearchTerm('');
            setActiveCategory('Alle');
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    }, [open]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const handleKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeydown);
        return () => document.removeEventListener('keydown', handleKeydown);
    }, [open, onClose]);

    // Close on click outside
    useEffect(() => {
        if (!open) return;
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        // Defer to avoid closing on the click that opened the menu
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClick);
        }, 50);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClick);
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className={`regie-menu ${open ? 'regie-menu-open' : ''}`} ref={menuRef}>
            <div className="regie-menu-inner">
                <div className="regie-menu-sidebar">
                    <div className="regie-menu-sidebar-title">Kategorien</div>
                    {categories.map((cat) => (
                        <button
                            key={cat}
                            className={`regie-menu-category ${activeCategory === cat ? 'active' : ''}`}
                            onClick={() => setActiveCategory(cat)}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
                <div className="regie-menu-content">
                    <div className="regie-menu-header">
                        <div className="regie-menu-search">
                            <span className="regie-menu-search-icon">{SearchIcon}</span>
                            <input
                                ref={searchInputRef}
                                type="text"
                                className="regie-menu-search-input"
                                placeholder="Module durchsuchen..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <button className="regie-menu-close" onClick={onClose} aria-label="Schliessen">
                            {CloseIcon}
                        </button>
                    </div>
                    <div className="regie-menu-grid-area">
                        {filteredItems.length === 0 ? (
                            <div className="regie-menu-empty">Keine Module gefunden</div>
                        ) : (
                            <>
                                {groupedItems.ungrouped.length > 0 && (
                                    <div className="regie-menu-group">
                                        <div className="regie-menu-items">
                                            {groupedItems.ungrouped.map((item) => {
                                                const path = item.path.startsWith('/') ? item.path : `/${item.path}`;
                                                const isPinned = pinnedPaths.has(path);
                                                return (
                                                    <div key={path} className={`regie-menu-item ${animatingTab === path ? 'pin-animate' : ''}`}>
                                                        <button className="regie-menu-item-link" onClick={() => handleNavigate(item)}>
                                                            <span className="regie-menu-item-icon" dangerouslySetInnerHTML={{ __html: item.icon }} />
                                                            <span className="regie-menu-item-label">{item.label}</span>
                                                        </button>
                                                        <button
                                                            className={`regie-menu-pin-btn ${isPinned ? 'pinned' : ''}`}
                                                            onClick={() => togglePin(item)}
                                                            title={isPinned ? 'Aus TopBar entfernen' : 'An TopBar anheften'}
                                                            aria-label={isPinned ? 'Entpinnen' : 'Anpinnen'}
                                                        >
                                                            <PinIcon pinned={isPinned} />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {Array.from(groupedItems.groups.entries()).map(([groupName, items]) => (
                                    <div key={groupName} className="regie-menu-group">
                                        <div className="regie-menu-group-title">{groupName}</div>
                                        <div className="regie-menu-items">
                                            {items.map((item) => {
                                                const path = item.path.startsWith('/') ? item.path : `/${item.path}`;
                                                const isPinned = pinnedPaths.has(path);
                                                return (
                                                    <div key={path} className={`regie-menu-item ${animatingTab === path ? 'pin-animate' : ''}`}>
                                                        <button className="regie-menu-item-link" onClick={() => handleNavigate(item)}>
                                                            <span className="regie-menu-item-icon" dangerouslySetInnerHTML={{ __html: item.icon }} />
                                                            <span className="regie-menu-item-label">{item.label}</span>
                                                        </button>
                                                        <button
                                                            className={`regie-menu-pin-btn ${isPinned ? 'pinned' : ''}`}
                                                            onClick={() => togglePin(item)}
                                                            title={isPinned ? 'Aus TopBar entfernen' : 'An TopBar anheften'}
                                                            aria-label={isPinned ? 'Entpinnen' : 'Anpinnen'}
                                                        >
                                                            <PinIcon pinned={isPinned} />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
