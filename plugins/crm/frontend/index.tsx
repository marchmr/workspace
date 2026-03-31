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

/* ════════════════════════════════════════════
   Lazy-Loaded Seiten & Tiles
   ════════════════════════════════════════════ */

const CrmHomePage = lazy(() => import('./pages/CrmHomePage'));
const CustomerListPage = lazy(() => import('./pages/CustomerListPage'));
const CustomerRecordPage = lazy(() => import('./pages/CustomerRecordPage'));
const TicketListPage = lazy(() => import('./pages/TicketListPage'));
const TicketDetailPage = lazy(() => import('./pages/TicketDetailPage'));
const ImportPage = lazy(() => import('./pages/ImportPage'));
const ExportPage = lazy(() => import('./pages/ExportPage'));
const CrmOverviewTile = lazy(() => import('./tiles/CrmOverviewTile'));
const RecentCustomersTile = lazy(() => import('./tiles/RecentCustomersTile'));
const CrmSettingsPage = lazy(() => import('./admin/CrmSettingsPage'));

/* ════════════════════════════════════════════
   SVG Icons
   ════════════════════════════════════════════ */

const crmNavIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

const customersIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

const ticketsIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5v2"/><path d="M15 11v2"/><path d="M15 17v2"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>`;

const importIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

const exportIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

const crmGroupIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 8h4"/><path d="M7 12h6"/></svg>`;

const companyIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>`;

const personIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

/* ════════════════════════════════════════════
   Routes
   ════════════════════════════════════════════ */

export const routes: PluginRoute[] = [
    {
        path: '/crm',
        component: CrmHomePage,
        permission: 'crm.view',
    },
    {
        path: '/crm/customers',
        component: CustomerListPage,
        permission: 'crm.view',
    },
    {
        path: '/crm/customers/:id',
        component: CustomerRecordPage,
        permission: 'crm.view',
    },
    {
        path: '/crm/tickets',
        component: TicketListPage,
        permission: 'crm.tickets.view',
    },
    {
        path: '/crm/tickets/:id',
        component: TicketDetailPage,
        permission: 'crm.tickets.view',
    },
    {
        path: '/crm/import',
        component: ImportPage,
        permission: 'crm.create',
    },
    {
        path: '/crm/export',
        component: ExportPage,
        permission: 'crm.view',
    },
];

/* ════════════════════════════════════════════
   Navigation
   ════════════════════════════════════════════ */

export const navItems: PluginNavItem[] = [
    {
        label: 'CRM',
        icon: crmNavIcon,
        path: '/crm',
        permission: 'crm.view',
        order: 10,
        group: 'CRM',
        groupIcon: crmGroupIcon,
        groupOrder: 5,
    },
    {
        label: 'Kunden',
        icon: customersIcon,
        path: '/crm/customers',
        permission: 'crm.view',
        order: 11,
        group: 'CRM',
        groupIcon: crmGroupIcon,
        groupOrder: 5,
    },
    {
        label: 'Tickets',
        icon: ticketsIcon,
        path: '/crm/tickets',
        permission: 'crm.tickets.view',
        order: 12,
        group: 'CRM',
        groupIcon: crmGroupIcon,
        groupOrder: 5,
    },
    {
        label: 'Import',
        icon: importIcon,
        path: '/crm/import',
        permission: 'crm.create',
        order: 13,
        group: 'CRM',
        groupIcon: crmGroupIcon,
        groupOrder: 5,
    },
    {
        label: 'Export',
        icon: exportIcon,
        path: '/crm/export',
        permission: 'crm.view',
        order: 14,
        group: 'CRM',
        groupIcon: crmGroupIcon,
        groupOrder: 5,
    },
];

/* ════════════════════════════════════════════
   Dashboard Tiles
   ════════════════════════════════════════════ */

export const dashboardTiles: PluginDashboardTile[] = [
    {
        id: 'crm-overview',
        title: 'CRM Übersicht',
        description: 'Kunden- und Ticket-Statistiken',
        component: CrmOverviewTile,
        permission: 'crm.view',
        order: 5,
        defaultWidth: 12,
        defaultHeight: 8,
        defaultVisible: true,
    },
    {
        id: 'crm-recent',
        title: 'Letzte Kunden',
        description: 'Zuletzt geöffnete Kunden',
        component: RecentCustomersTile,
        permission: 'crm.view',
        order: 6,
        defaultWidth: 12,
        defaultHeight: 8,
        defaultVisible: true,
    },
];

/* ════════════════════════════════════════════
   GlobalSearch Provider
   ════════════════════════════════════════════ */

export const searchProvider: PluginSearchProvider = {
    label: 'CRM',
    permission: 'crm.view',
    search: async (query: string) => {
        try {
            const res = await apiFetch(`/api/plugins/crm/customers/search?q=${encodeURIComponent(query)}`);
            if (!res.ok) return [];
            const data = await res.json();
            return (data.results || []).map((r: any) => ({
                title: r.display_name,
                description: `${r.customer_number} — ${r.city || ''} ${r.phone || ''}`.trim(),
                path: `/crm/customers/${r.id}`,
                icon: r.type === 'company' ? companyIcon : personIcon,
            }));
        } catch {
            return [];
        }
    },
};

/* ════════════════════════════════════════════
   Settings Panel
   ════════════════════════════════════════════ */

export const settingsPanel: PluginSettingsPanel = {
    component: CrmSettingsPage,
    permission: 'crm.manage',
};

/* ════════════════════════════════════════════
   Optional Exports
   ════════════════════════════════════════════ */

export const extensionTiles: PluginExtensionTile[] = [];

// SVG icon helper (Feather-style, 14x14 inline)
const qaIcon = (d: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-2px;margin-right:6px;opacity:0.7">${d}</svg>`;
const qaIcons = {
    plus: qaIcon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    users: qaIcon('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    ticket: qaIcon('<path d="M15 5v2"/><path d="M15 11v2"/><path d="M15 17v2"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>'),
    upload: qaIcon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
    download: qaIcon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
    home: qaIcon('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
};

export const quickActions: PluginQuickAction[] = [
    {
        id: 'crm.create-customer',
        label: 'Neuen Kunden anlegen',
        icon: qaIcons.plus,
        keywords: ['kunde', 'anlegen', 'erstellen', 'neu', 'firma', 'customer', 'create'],
        permission: 'crm.create',
        execute: () => { window.location.href = '/crm/customers?action=create'; },
    },
    {
        id: 'crm.create-ticket',
        label: 'Neues Ticket anlegen',
        icon: qaIcons.plus,
        keywords: ['ticket', 'anlegen', 'erstellen', 'neu', 'support', 'anfrage'],
        permission: 'crm.tickets.create',
        execute: () => { window.location.href = '/crm/tickets?action=create'; },
    },
    {
        id: 'crm.customers',
        label: 'Kundenliste öffnen',
        icon: qaIcons.users,
        keywords: ['kunden', 'liste', 'übersicht', 'customer', 'suchen'],
        permission: 'crm.view',
        execute: () => { window.location.href = '/crm/customers'; },
    },
    {
        id: 'crm.tickets',
        label: 'Ticketliste öffnen',
        icon: qaIcons.ticket,
        keywords: ['tickets', 'liste', 'übersicht', 'support'],
        permission: 'crm.tickets.view',
        execute: () => { window.location.href = '/crm/tickets'; },
    },
    {
        id: 'crm.overview',
        label: 'CRM Übersicht',
        icon: qaIcons.home,
        keywords: ['crm', 'dashboard', 'übersicht', 'startseite'],
        permission: 'crm.view',
        execute: () => { window.location.href = '/crm'; },
    },
    {
        id: 'crm.import',
        label: 'CRM Import',
        icon: qaIcons.upload,
        keywords: ['import', 'csv', 'hochladen', 'einlesen'],
        permission: 'crm.create',
        execute: () => { window.location.href = '/crm/import'; },
    },
    {
        id: 'crm.export',
        label: 'CRM Export',
        icon: qaIcons.download,
        keywords: ['export', 'csv', 'pdf', 'herunterladen', 'download'],
        permission: 'crm.view',
        execute: () => { window.location.href = '/crm/export'; },
    },
];
