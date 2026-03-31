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
import { apiFetch } from '@mike/context/AuthContext';

const QuickLinksPage = lazy(() => import('./pages/QuickLinksPage'));
const TenantQuicklinksTile = lazy(() => import('./tiles/TenantQuicklinksTile'));
const PersonalQuicklinksTile = lazy(() => import('./tiles/PersonalQuicklinksTile'));

/* ════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════ */

// Nav-Icon (Link/Kette)
const linkNavIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

// Werkzeug-Icon fuer Gruppe
const toolsGroupIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;

// Plus-Icon fuer QuickAction
const plusActionIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-2px;margin-right:6px;opacity:0.7"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

/* ════════════════════════════════════════════
   Routes
   ════════════════════════════════════════════ */

export const routes: PluginRoute[] = [
    {
        path: '/quicklinks',
        component: QuickLinksPage,
        permission: 'quicklinks.view',
    },
];

/* ════════════════════════════════════════════
   Navigation
   ════════════════════════════════════════════ */

export const navItems: PluginNavItem[] = [
    {
        label: 'Schnellzugriff',
        icon: linkNavIcon,
        path: '/quicklinks',
        permission: 'quicklinks.view',
        order: 25,
        group: 'Tools',
        groupIcon: toolsGroupIcon,
        groupOrder: 10,
    },
];

/* ════════════════════════════════════════════
   Dashboard Tiles
   ════════════════════════════════════════════ */

export const dashboardTiles: PluginDashboardTile[] = [
    {
        id: 'quicklinks-tenant',
        title: 'Team-Links',
        description: 'Mandantenweite Schnellzugriffe',
        component: TenantQuicklinksTile,
        permission: 'quicklinks.view',
        order: 5,
        defaultWidth: 12,
        defaultHeight: 8,
        defaultVisible: true,
        viewModes: [
            { id: 'list', label: 'Liste' },
            { id: 'columns', label: 'Spalten' },
        ],
        defaultViewMode: 'list',
    },
    {
        id: 'quicklinks-personal',
        title: 'Meine Links',
        description: 'Persoenliche Schnellzugriffe',
        component: PersonalQuicklinksTile,
        permission: 'quicklinks.edit',
        order: 6,
        defaultWidth: 12,
        defaultHeight: 8,
        defaultVisible: true,
        viewModes: [
            { id: 'list', label: 'Liste' },
            { id: 'columns', label: 'Spalten' },
        ],
        defaultViewMode: 'list',
    },
];

/* ════════════════════════════════════════════
   Search Provider
   ════════════════════════════════════════════ */

export const searchProvider: PluginSearchProvider = {
    label: 'Schnellzugriff',
    permission: 'quicklinks.view',
    search: async (query: string) => {
        try {
            const res = await apiFetch(`/api/plugins/quicklinks/search?q=${encodeURIComponent(query)}`);
            if (!res.ok) return [];
            const data = await res.json();
            return (data.results || []).map((r: any) => ({
                title: r.title,
                description: `${r.category} — ${r.url}`,
                path: r.url, // Direkt zur URL navigieren
                icon: r.favicon_base64 || undefined,
            }));
        } catch {
            return [];
        }
    },
};

/* ════════════════════════════════════════════
   Quick Actions
   ════════════════════════════════════════════ */

export const quickActions: PluginQuickAction[] = [
    {
        id: 'quicklinks.create',
        label: 'Neuen Quicklink erstellen',
        icon: plusActionIcon,
        keywords: ['link', 'quicklink', 'schnellzugriff', 'url', 'bookmark', 'lesezeichen', 'erstellen'],
        permission: 'quicklinks.edit',
        execute: () => {
            window.location.href = '/quicklinks';
        },
    },
];

/* ════════════════════════════════════════════
   Optionale Exports
   ════════════════════════════════════════════ */

export const extensionTiles: PluginExtensionTile[] = [];
export const settingsPanel: PluginSettingsPanel | undefined = undefined;
