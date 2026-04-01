import { lazy } from 'react';
import type {
    PluginDashboardTile,
    PluginExtensionTile,
    PluginNavItem,
    PluginPortalTab,
    PluginQuickAction,
    PluginRoute,
    PluginSearchProvider,
    PluginSettingsPanel,
} from '@mike/pluginRegistry';

const DateiaustauschPage = lazy(() => import('./pages/DateiaustauschPage'));
const PublicFileExchangeModule = lazy(() => import('./components/PublicFileExchangeModule'));

const icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>`;
const filesIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;

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
export const portalTabs: PluginPortalTab[] = [
    {
        id: 'dateiaustausch',
        label: 'Dateiaustausch',
        icon: filesIcon,
        component: PublicFileExchangeModule,
        order: 20,
    }
];
