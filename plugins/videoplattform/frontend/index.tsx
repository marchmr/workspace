import { lazy } from 'react';
import type {
    PluginDashboardTile,
    PluginExtensionTile,
    PluginNavItem,
    PluginQuickAction,
    PluginRoute,
    PluginSearchProvider,
    PluginSettingsPanel,
} from '@mike/pluginRegistry';

const VideoPlatformAdminPage = lazy(() => import('./pages/VideoPlatformAdminPage'));
const VideoPlatformPortalPage = lazy(() => import('./pages/VideoPlatformPortalPage'));
const VideoPlatformSettingsPage = lazy(() => import('./admin/VideoPlatformSettingsPage'));

const icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><polygon points="10 9 16 12 10 15 10 9"/></svg>`;

export const routes: PluginRoute[] = [
    {
        path: '/videoplattform',
        component: VideoPlatformAdminPage,
        permission: 'videoplattform.view',
    },
    {
        path: '/kundenportal-videos',
        component: VideoPlatformPortalPage,
        public: true,
    },
];

export const navItems: PluginNavItem[] = [
    {
        label: 'Videoplattform',
        icon,
        path: '/videoplattform',
        permission: 'videoplattform.view',
        order: 35,
    },
];

export const dashboardTiles: PluginDashboardTile[] = [];
export const extensionTiles: PluginExtensionTile[] = [];
export const settingsPanel: PluginSettingsPanel = {
    component: VideoPlatformSettingsPage,
    permission: 'settings.manage',
};
export const searchProvider: PluginSearchProvider | undefined = undefined;
export const quickActions: PluginQuickAction[] = [];
