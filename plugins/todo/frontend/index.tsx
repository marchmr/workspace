import { lazy } from 'react';
import type {
    PluginRoute,
    PluginNavItem,
    PluginDashboardTile,
    PluginExtensionTile,
    PluginSettingsPanel,
    PluginSearchProvider,
    PluginQuickAction,
} from '@mike/pluginRegistry';

const TodoPage = lazy(() => import('./pages/TodoPage'));

// Dashboard-Tile: Kompaktes Widget
const TodoDashboardTile = lazy(() => import('./tiles/TodoDashboardTile'));

// SVG Icon fuer Navigation (keine Emojis!)
const todoNavIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`;

export const routes: PluginRoute[] = [
    {
        path: '/todo',
        component: TodoPage,
        permission: 'todo.view',
    },
];

export const navItems: PluginNavItem[] = [
    {
        label: 'Aufgaben',
        icon: todoNavIcon,
        path: '/todo',
        permission: 'todo.view',
        order: 20,
    },
];

export const dashboardTiles: PluginDashboardTile[] = [
    {
        id: 'todo-overview',
        title: 'Aufgaben',
        description: 'Offene Aufgaben und Ueberfaellige',
        component: TodoDashboardTile,
        permission: 'todo.view',
        order: 10,
        defaultWidth: 12,
        defaultHeight: 8,
        defaultVisible: true,
    },
];

// Optionale Exports — nicht genutzt, aber vom Registry-Generator erwartet
export const extensionTiles: PluginExtensionTile[] = [];
export const settingsPanel: PluginSettingsPanel | undefined = undefined;
export const searchProvider: PluginSearchProvider | undefined = undefined;
export const quickActions: PluginQuickAction[] = [];
