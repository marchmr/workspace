import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useMemo, type MouseEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../hooks/usePermission';
import { pluginRegistry, type PluginNavItem } from '../pluginRegistry';

const svgProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const Icons = {
    dashboard: <svg {...svgProps}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>,
    users: <svg {...svgProps}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>,
    roles: <svg {...svgProps}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>,
    security: <svg {...svgProps}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
    plugins: <svg {...svgProps}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
    backup: <svg {...svgProps}><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>,
    updates: <svg {...svgProps}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>,
    settings: <svg {...svgProps}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>,
    audit: <svg {...svgProps}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>,
    database: <svg {...svgProps}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>,
    external: <svg {...svgProps} width={12} height={12}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>,
    changelog: <svg {...svgProps}><path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="10" /></svg>,
    logout: <svg {...svgProps}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>,
    chevron: <svg {...svgProps} width={14} height={14}><polyline points="6 9 12 15 18 9" /></svg>,
};

interface NavGroup {
    name: string;
    icon?: string;
    order: number;
    items: PluginNavItem[];
}

function loadOpenGroups(): Set<string> {
    try {
        const stored = localStorage.getItem('mike_sidebar_groups');
        return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
        return new Set();
    }
}

function saveOpenGroups(groups: Set<string>) {
    try {
        localStorage.setItem('mike_sidebar_groups', JSON.stringify([...groups]));
    } catch { /* ignore */ }
}

export function Sidebar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const canAdmin = usePermission('admin.access');
    const [openGroups, setOpenGroups] = useState<Set<string>>(loadOpenGroups);
    const activeTenant = user?.tenants?.find((tenant) => tenant.id === user.currentTenantId) || user?.tenants?.[0];
    const tenantLogoSrc = activeTenant?.logoUrl
        ? `${activeTenant.logoUrl}${activeTenant.logoUpdatedAt ? `${activeTenant.logoUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(activeTenant.logoUpdatedAt)}` : ''}`
        : null;
    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    const displayName = fullName || user?.displayName || user?.username || '';
    const avatarSrc = user?.avatarUrl
        ? `${user.avatarUrl}${user.avatarUpdatedAt ? `${user.avatarUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(user.avatarUpdatedAt)}` : ''}`
        : null;

    const pluginNavItems = useMemo(() =>
        pluginRegistry
            .flatMap((entry) => entry.navItems)
            .slice()
            .sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label)),
        []
    );

    const handleLogout = async (event?: MouseEvent<HTMLButtonElement>) => {
        event?.preventDefault();
        event?.stopPropagation();
        await logout();
        navigate('/login');
    };

    const hasPermission = (permission?: string): boolean => {
        if (!permission) return true;
        if (!user) return false;
        return user.permissions.includes('*') || user.permissions.includes(permission);
    };

    const toggleGroup = (groupName: string) => {
        setOpenGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupName)) next.delete(groupName);
            else next.add(groupName);
            saveOpenGroups(next);
            return next;
        });
    };

    // Build groups + ungrouped items
    const { groups, ungroupedItems } = useMemo(() => {
        const visible = pluginNavItems.filter((item) => hasPermission(item.permission));
        const groupMap = new Map<string, NavGroup>();
        const ungrouped: PluginNavItem[] = [];

        for (const item of visible) {
            if (item.group) {
                let group = groupMap.get(item.group);
                if (!group) {
                    group = {
                        name: item.group,
                        icon: item.groupIcon,
                        order: item.groupOrder ?? item.order,
                        items: [],
                    };
                    groupMap.set(item.group, group);
                }
                if (item.groupIcon && !group.icon) group.icon = item.groupIcon;
                group.items.push(item);
            } else {
                ungrouped.push(item);
            }
        }

        return {
            groups: Array.from(groupMap.values()).sort((a, b) => a.order - b.order),
            ungroupedItems: ungrouped,
        };
    }, [pluginNavItems, user]);

    // Auto-expand group if current path matches a child
    const isGroupActive = (group: NavGroup): boolean =>
        group.items.some((item) => {
            const p = item.path.startsWith('/') ? item.path : `/${item.path}`;
            return location.pathname === p || location.pathname.startsWith(p + '/');
        });

    // Merge groups + ungrouped into a sorted render list
    type RenderEntry = { type: 'item'; item: PluginNavItem } | { type: 'group'; group: NavGroup };
    const renderList = useMemo<RenderEntry[]>(() => {
        const list: RenderEntry[] = [];
        for (const item of ungroupedItems) list.push({ type: 'item', item });
        for (const group of groups) list.push({ type: 'group', group });
        list.sort((a, b) => {
            const orderA = a.type === 'item' ? a.item.order : a.group.order;
            const orderB = b.type === 'item' ? b.item.order : b.group.order;
            return orderA - orderB;
        });
        return list;
    }, [ungroupedItems, groups]);

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="sidebar-brand">
                    <div className="sidebar-brand-mark" aria-hidden="true">
                        {tenantLogoSrc ? (
                            <img src={tenantLogoSrc} alt="" className="sidebar-brand-logo" />
                        ) : (
                            <span>M</span>
                        )}
                    </div>
                    <div className="sidebar-brand-text">
                        <h1>MIKE</h1>
                        <div className="version">WorkSpace</div>
                    </div>
                </div>
            </div>

            <nav className="sidebar-nav">
                <div className="sidebar-section">Navigation</div>
                <NavLink to="/" className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}>
                    <span className="icon">{Icons.dashboard}</span>
                    Dashboard
                </NavLink>

                {renderList.map((entry) => {
                    if (entry.type === 'item') {
                        const path = entry.item.path.startsWith('/') ? entry.item.path : `/${entry.item.path}`;
                        return (
                            <NavLink key={`plugin-nav-${path}`} to={path} className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}>
                                <span className="icon">{entry.item.icon}</span>
                                {entry.item.label}
                            </NavLink>
                        );
                    }

                    const { group } = entry;
                    const expanded = openGroups.has(group.name) || isGroupActive(group);
                    return (
                        <div key={`nav-group-${group.name}`} className="sidebar-group">
                            <button
                                className={`sidebar-item sidebar-group-toggle ${isGroupActive(group) ? 'group-active' : ''}`}
                                onClick={() => toggleGroup(group.name)}
                            >
                                {group.icon && <span className="icon">{group.icon}</span>}
                                <span className="sidebar-group-label">{group.name}</span>
                                <span className={`sidebar-group-chevron ${expanded ? 'expanded' : ''}`}>{Icons.chevron}</span>
                            </button>
                            {expanded && (
                                <div className="sidebar-group-children">
                                    {group.items.map((item) => {
                                        const path = item.path.startsWith('/') ? item.path : `/${item.path}`;
                                        return (
                                            <NavLink key={`plugin-nav-${path}`} to={path} className={({ isActive }) => `sidebar-item sidebar-child-item ${isActive ? 'active' : ''}`}>
                                                <span className="icon">{item.icon}</span>
                                                {item.label}
                                            </NavLink>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}

            </nav>

            {canAdmin && (
                <div className="sidebar-quick-links">
                    <div className="sidebar-section">Schnellzugriff</div>
                    <NavLink to="/admin" className={({ isActive }) => `sidebar-item sidebar-muted-link ${isActive ? 'active' : ''}`}>
                        <span className="icon">{Icons.settings}</span>
                        Administration
                    </NavLink>
                    <NavLink to="/changelog" className={({ isActive }) => `sidebar-item sidebar-muted-link ${isActive ? 'active' : ''}`}>
                        <span className="icon">{Icons.changelog}</span>
                        Changelog
                    </NavLink>
                </div>
            )}

            <div className="sidebar-footer">
                <NavLink to="/profile" className={({ isActive }) => `sidebar-user-link ${isActive ? 'active' : ''}`}>
                    <div className="sidebar-user-panel">
                        <div className="avatar">
                            {avatarSrc ? (
                                <img src={avatarSrc} alt="Avatar" className="sidebar-avatar-image" />
                            ) : (
                                user?.username?.charAt(0).toUpperCase()
                            )}
                        </div>
                        <div className="sidebar-user-meta">
                            <div className="sidebar-username">{displayName}</div>
                        </div>
                        <button onClick={handleLogout} className="sidebar-logout-btn" aria-label="Abmelden" title="Abmelden">
                            <span className="icon">{Icons.logout}</span>
                        </button>
                    </div>
                </NavLink>
            </div>
        </aside>
    );
}
