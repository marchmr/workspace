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

const DateiaustauschDrivePage = lazy(() => import('./pages/DateiaustauschDrivePage'));
const DateiaustauschDriveSettingsPage = lazy(() => import('./admin/DateiaustauschDriveSettingsPage'));
const PublicGoogleDriveModule = lazy(() => import('./components/PublicGoogleDriveModule'));
import './dateiaustausch-drive.css';

const icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>`;
const cloudIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0-.9-8.91A6 6 0 0 0 5 11a4 4 0 0 0 .5 8z"/></svg>`;

export const routes: PluginRoute[] = [
    {
        path: '/dateiaustausch-drive',
        component: DateiaustauschDrivePage,
        permission: 'dateiaustausch_drive.view',
    },
];

export const navItems: PluginNavItem[] = [
    {
        label: 'Dateiaustausch',
        icon,
        path: '/dateiaustausch-drive',
        permission: 'dateiaustausch_drive.view',
        order: 37,
        group: 'Kundenportale',
    },
];

export const dashboardTiles: PluginDashboardTile[] = [];
export const extensionTiles: PluginExtensionTile[] = [];

export const settingsPanel: PluginSettingsPanel = {
    component: DateiaustauschDriveSettingsPage,
    permission: 'settings.manage',
};

export const searchProvider: PluginSearchProvider | undefined = undefined;
export const quickActions: PluginQuickAction[] = [];

export const portalTabs: PluginPortalTab[] = [
    {
        id: 'dateiaustausch-drive',
        label: 'Dateiaustausch',
        icon: cloudIcon,
        component: PublicGoogleDriveModule,
        order: 21,
    },
];
