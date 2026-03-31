import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';
import { ProfileSlider } from './ProfileSlider';
import { useToast } from './ModalProvider';
import { pluginRegistry, type PluginNavItem } from '../pluginRegistry';

const svgProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const HomeIcon = (
    <svg {...svgProps}>
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
);

const RegieIcon = (
    <svg {...svgProps}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
);

const MenuIcon = (
    <svg {...svgProps} width={22} height={22}>
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
);

const CloseMenuIcon = (
    <svg {...svgProps} width={22} height={22}>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

export function TopBar() {
    const { user, switchTenant } = useAuth();
    const navigate = useNavigate();
    const toast = useToast();
    const [profileOpen, setProfileOpen] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);
    const tenantDropdownRef = useRef<HTMLDivElement>(null);

    // Close tenant dropdown on click outside
    useEffect(() => {
        if (!tenantDropdownOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (tenantDropdownRef.current && !tenantDropdownRef.current.contains(e.target as Node)) {
                setTenantDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [tenantDropdownOpen]);

    const activeTenant = user?.tenants?.find((t) => t.id === user.currentTenantId) || user?.tenants?.[0];
    const tenantLogoSrc = activeTenant?.logoUrl
        ? `${activeTenant.logoUrl}${activeTenant.logoUpdatedAt ? `${activeTenant.logoUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(activeTenant.logoUpdatedAt)}` : ''}`
        : null;

    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    const displayName = fullName || user?.displayName || user?.username || '';
    const avatarSrc = user?.avatarUrl
        ? `${user.avatarUrl}${user.avatarUpdatedAt ? `${user.avatarUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(user.avatarUpdatedAt)}` : ''}`
        : null;

    const hasPermission = useCallback((permission?: string): boolean => {
        if (!permission) return true;
        if (!user) return false;
        return user.permissions.includes('*') || user.permissions.includes(permission);
    }, [user]);

    // Resolve pinned tabs to their nav items
    const pinnedNavItems = useMemo(() => {
        const pinnedPaths = user?.pinnedTabs || [];
        if (pinnedPaths.length === 0) return [];

        const allNavItems: PluginNavItem[] = pluginRegistry
            .flatMap((entry) => entry.navItems);

        const pathMap = new Map<string, PluginNavItem>();
        for (const item of allNavItems) {
            const p = item.path.startsWith('/') ? item.path : `/${item.path}`;
            pathMap.set(p, item);
        }

        return pinnedPaths
            .map((path) => pathMap.get(path))
            .filter((item): item is PluginNavItem => !!item && hasPermission(item.permission));
    }, [user?.pinnedTabs, hasPermission]);

    const handleTenantChange = async (tenantId: number) => {
        try {
            await switchTenant(tenantId);
            navigate('/');
        } catch (error) {
            console.error(error);
            toast.error('Mandantenwechsel fehlgeschlagen');
        }
    };

    return (
        <>
            <header className="topbar">
                {/* Left: Brand + Main Nav */}
                <div className="topbar-left">
                    <button className="topbar-brand" onClick={() => navigate('/')} title="Dashboard">
                        <div className="topbar-brand-mark" aria-hidden="true">
                            {tenantLogoSrc ? (
                                <img src={tenantLogoSrc} alt="" className="topbar-brand-logo" />
                            ) : (
                                <span>M</span>
                            )}
                        </div>
                    </button>

                    <nav className="topbar-nav">
                        <NavLink to="/" end className={({ isActive }) => `topbar-nav-item ${isActive ? 'active' : ''}`}>
                            <span className="topbar-nav-item-icon">{HomeIcon}</span>
                            <span className="topbar-nav-item-label">HOME</span>
                        </NavLink>

                        <NavLink to="/regie" className={({ isActive }) => `topbar-nav-item ${isActive ? 'active' : ''}`}>
                            <span className="topbar-nav-item-icon">{RegieIcon}</span>
                            <span className="topbar-nav-item-label">REGIE</span>
                        </NavLink>

                        {/* Pinned QuickAction Tabs */}
                        {pinnedNavItems.map((item) => {
                            const path = item.path.startsWith('/') ? item.path : `/${item.path}`;
                            return (
                                <NavLink
                                    key={`pinned-${path}`}
                                    to={path}
                                    className={({ isActive }) => `topbar-nav-item pinned-tab ${isActive ? 'active' : ''}`}
                                >
                                    <span className="topbar-nav-item-icon" dangerouslySetInnerHTML={{ __html: item.icon }} />
                                    <span className="topbar-nav-item-label">{item.label.toUpperCase()}</span>
                                </NavLink>
                            );
                        })}
                    </nav>
                </div>

                {/* Right: Search + Capsule(Bell + Tenant + Profile) */}
                <div className="topbar-right">
                    <div className="topbar-search-compact">
                        <GlobalSearch />
                    </div>
                    <div className="topbar-capsule">
                        <NotificationBell />
                        <span className="topbar-capsule-divider" />
                        <div className="topbar-tenant-dropdown" ref={tenantDropdownRef}>
                            <button
                                className="topbar-tenant-trigger"
                                onClick={() => setTenantDropdownOpen(!tenantDropdownOpen)}
                                title="Mandant wechseln"
                            >
                                <span className="topbar-tenant-name">
                                    {activeTenant?.name || 'Mandant'}
                                </span>
                                <svg className={`topbar-tenant-chevron ${tenantDropdownOpen ? 'open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="6 9 12 15 18 9" />
                                </svg>
                            </button>
                            {tenantDropdownOpen && (
                                <div className="topbar-tenant-menu">
                                    {(user?.tenants || []).map((tenant) => (
                                        <button
                                            key={tenant.id}
                                            className={`topbar-tenant-option ${tenant.id === user?.currentTenantId ? 'active' : ''}`}
                                            onClick={() => {
                                                handleTenantChange(tenant.id);
                                                setTenantDropdownOpen(false);
                                            }}
                                        >
                                            {tenant.id === user?.currentTenantId && (
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                            )}
                                            <span>{tenant.name}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <span className="topbar-capsule-divider" />
                        <button
                            className="topbar-profile-trigger"
                            onClick={() => setProfileOpen(!profileOpen)}
                            title="Profil"
                            aria-label="Profil oeffnen"
                        >
                            <div className="topbar-profile-avatar">
                                {avatarSrc ? (
                                    <img src={avatarSrc} alt="Avatar" className="topbar-profile-avatar-img" />
                                ) : (
                                    <span>{user?.username?.charAt(0).toUpperCase()}</span>
                                )}
                            </div>
                            <span className="topbar-profile-name">{displayName}</span>
                        </button>
                    </div>
                </div>

                {/* Mobile Hamburger */}
                <button
                    className="topbar-mobile-toggle"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    aria-label="Menu"
                >
                    {mobileMenuOpen ? CloseMenuIcon : MenuIcon}
                </button>
            </header>

            {/* Mobile Nav Drawer */}
            {mobileMenuOpen && (
                <div className="topbar-mobile-drawer">
                    <NavLink to="/" end className="topbar-mobile-item" onClick={() => setMobileMenuOpen(false)}>
                        <span className="topbar-nav-item-icon">{HomeIcon}</span>
                        HOME
                    </NavLink>
                    <NavLink to="/regie" className="topbar-mobile-item" onClick={() => setMobileMenuOpen(false)}>
                        <span className="topbar-nav-item-icon">{RegieIcon}</span>
                        REGIE
                    </NavLink>
                    {pinnedNavItems.map((item) => {
                        const path = item.path.startsWith('/') ? item.path : `/${item.path}`;
                        return (
                            <NavLink key={`mobile-${path}`} to={path} className="topbar-mobile-item" onClick={() => setMobileMenuOpen(false)}>
                                <span className="topbar-nav-item-icon" dangerouslySetInnerHTML={{ __html: item.icon }} />
                                {item.label}
                            </NavLink>
                        );
                    })}
                </div>
            )}

            {/* ProfileSlider */}
            <ProfileSlider open={profileOpen} onClose={() => setProfileOpen(false)} />
        </>
    );
}
