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

const AccountingPage = lazy(() => import('./pages/AccountingPage'));

const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>`;

export const routes: PluginRoute[] = [];

export const navItems: PluginNavItem[] = [];

export const portalTabs: PluginPortalTab[] = [
    {
        id: 'accounting',
        label: 'Rechnungen & Dokumente',
        icon,
        component: AccountingPage,
        order: 20,
    },
];

export const dashboardTiles: PluginDashboardTile[] = [];
export const extensionTiles: PluginExtensionTile[] = [];

export const settingsPanel: PluginSettingsPanel | undefined = undefined;
export const searchProvider: PluginSearchProvider | undefined = undefined;
export const quickActions: PluginQuickAction[] = [];