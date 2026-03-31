import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { pluginRegistry, type PluginNavItem } from '../pluginRegistry';

const svgProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const PinIcon = ({ pinned }: { pinned: boolean }) => (
    <svg {...svgProps} className={`regie-pin-icon ${pinned ? 'pinned' : ''}`}>
        <line x1="12" y1="17" x2="12" y2="22" />
        <path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1V2H8v4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24z" fill={pinned ? 'currentColor' : 'none'} />
    </svg>
);

const SearchIcon = (
    <svg {...svgProps} width={20} height={20}>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
);

export default function RegiePage() {
    const { user, updatePinnedTabs } = useAuth();
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [activeCategory, setActiveCategory] = useState('Alle');
    const [animatingTab, setAnimatingTab] = useState<string | null>(null);

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

    const categories = useMemo(() => {
        const categorySet = new Set<string>();
        for (const item of visibleItems) {
            if (item.group) categorySet.add(item.group);
        }
        return ['Alle', ...Array.from(categorySet).sort()];
    }, [visibleItems]);

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
    };

    const renderItemGrid = (items: PluginNavItem[]) => (
        <div className="regie-page-items">
            {items.map((item) => {
                const path = item.path.startsWith('/') ? item.path : `/${item.path}`;
                const isPinned = pinnedPaths.has(path);
                return (
                    <div key={path} className={`regie-page-item ${animatingTab === path ? 'pin-animate' : ''}`}>
                        <button className="regie-page-item-link" onClick={() => handleNavigate(item)}>
                            <span className="regie-page-item-icon" dangerouslySetInnerHTML={{ __html: item.icon }} />
                            <span className="regie-page-item-label">{item.label}</span>
                        </button>
                        <button
                            className={`regie-page-pin-btn ${isPinned ? 'pinned' : ''}`}
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
    );

    return (
        <div className="regie-page">
            <div className="regie-page-header">
                <h1 className="regie-page-title">Regie</h1>
                <p className="regie-page-subtitle">Alle verfügbaren Module und Erweiterungen</p>
            </div>

            <div className="regie-page-toolbar">
                <div className="regie-page-search">
                    <span className="regie-page-search-icon">{SearchIcon}</span>
                    <input
                        type="text"
                        className="regie-page-search-input"
                        placeholder="Module durchsuchen..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        autoFocus
                    />
                </div>
                <div className="regie-page-categories">
                    {categories.map((cat) => (
                        <button
                            key={cat}
                            className={`regie-page-category ${activeCategory === cat ? 'active' : ''}`}
                            onClick={() => setActiveCategory(cat)}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            <div className="regie-page-content">
                {filteredItems.length === 0 ? (
                    <div className="regie-page-empty">Keine Module gefunden</div>
                ) : (
                    <>
                        {groupedItems.ungrouped.length > 0 && (
                            <div className="regie-page-group">
                                {renderItemGrid(groupedItems.ungrouped)}
                            </div>
                        )}
                        {Array.from(groupedItems.groups.entries()).map(([groupName, items]) => (
                            <div key={groupName} className="regie-page-group">
                                <div className="regie-page-group-title">{groupName}</div>
                                {renderItemGrid(items)}
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}
