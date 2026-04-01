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

const DateiaustauschPage = lazy(() => import('./pages/DateiaustauschPage'));

const icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>`;

export const routes: PluginRoute[] = [
    {
        path: '/dateiaustausch',
        component: DateiaustauschPage,
        permission: 'dateiaustausch.view',
    },
];

export const navItems: PluginNavItem[] = [
    {
        label: 'Dateiaustausch',
        icon,
        path: '/dateiaustausch',
        permission: 'dateiaustausch.view',
        order: 36,
        group: 'Kundenportale',
    },
];

export const dashboardTiles: PluginDashboardTile[] = [];
export const extensionTiles: PluginExtensionTile[] = [];
export const settingsPanel: PluginSettingsPanel | undefined = undefined;
export const searchProvider: PluginSearchProvider | undefined = undefined;
export const quickActions: PluginQuickAction[] = [];
