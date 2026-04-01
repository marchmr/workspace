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

const KundenportalPage = lazy(() => import('./pages/KundenportalPage'));
const KundenportalSettingsPage = lazy(() => import('./admin/KundenportalSettingsPage'));

export const routes: PluginRoute[] = [
    {
        path: '/kundenportal',
        component: KundenportalPage,
        public: true,
    },
    {
        path: '/kundenportal-videos',
        component: KundenportalPage,
        public: true,
    },
];

export const navItems: PluginNavItem[] = [];
export const dashboardTiles: PluginDashboardTile[] = [];
export const extensionTiles: PluginExtensionTile[] = [];

export const settingsPanel: PluginSettingsPanel = {
    component: KundenportalSettingsPage,
    permission: 'settings.manage',
};

export const searchProvider: PluginSearchProvider | undefined = undefined;
export const quickActions: PluginQuickAction[] = [];
