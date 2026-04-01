import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { WebSocketProvider } from './context/WebSocketContext';
import ToastContainer from './components/ToastContainer';
import { ModalProvider } from './components/ModalProvider';
import { Layout } from './components/Layout';
import { DynamicBranding } from './components/DynamicBranding';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { lazy, Suspense } from 'react';
import { pluginRegistry, type PluginRegistryEntry, type PluginRoute } from './pluginRegistry';
import { getHostRoutingConfig, isRouteAllowedForHost } from './hostRouting';

// Admin-Seiten lazy laden
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const RoleManagement = lazy(() => import('./pages/admin/RoleManagement'));
const AuditLog = lazy(() => import('./pages/admin/AuditLog'));
const GeneralSettings = lazy(() => import('./pages/admin/GeneralSettings'));

const BackupRestore = lazy(() => import('./pages/admin/BackupRestore'));
const UpdateManager = lazy(() => import('./pages/admin/UpdateManager'));
const SecuritySettings = lazy(() => import('./pages/admin/SecuritySettings'));
const DocumentManagement = lazy(() => import('./pages/admin/DocumentManagement'));
const AdminHome = lazy(() => import('./pages/admin/AdminHome'));
const AdminShell = lazy(() => import('./pages/admin/AdminShell'));
const TenantManagement = lazy(() => import('./pages/admin/TenantManagement'));
const WebhookManagement = lazy(() => import('./pages/admin/WebhookManagement'));
const SessionManagement = lazy(() => import('./pages/admin/SessionManagement'));
const LockManagement = lazy(() => import('./pages/admin/LockManagement'));
const PhpMyAdminRedirect = lazy(() => import('./pages/admin/PhpMyAdminRedirect'));
const EmailAccounts = lazy(() => import('./pages/admin/EmailAccounts'));
const Changelog = lazy(() => import('./pages/Changelog'));
const PublicChangelog = lazy(() => import('./pages/PublicChangelog'));
const Profile = lazy(() => import('./pages/Profile'));
const NotificationHistory = lazy(() => import('./pages/NotificationHistory'));
const Helpcenter = lazy(() => import('./pages/Helpcenter'));
const RegiePage = lazy(() => import('./pages/RegiePage'));

const AdminFallback = () => (
    <div className="text-muted text-center" style={{ padding: 'var(--space-2xl)' }}>Laden...</div>
);

function normalizeRoutePath(routePath: string): string {
    const normalized = routePath.replace(/^\/+/, '');
    return normalized || '/';
}

function toAbsoluteRoutePath(routePath: string): string {
    const normalized = normalizeRoutePath(routePath);
    return normalized === '/' ? '/' : `/${normalized}`;
}

function resolveRoutePermission(entry: PluginRegistryEntry, route: PluginRoute): string | undefined {
    if (route.permission) return route.permission;
    const normalized = normalizeRoutePath(route.path);
    const navMatch = entry.navItems.find((item) => normalizeRoutePath(item.path) === normalized);
    return navMatch?.permission;
}

export default function App() {
    const hostRouting = getHostRoutingConfig();

    const pluginRoutes = pluginRegistry.flatMap((entry) =>
        entry.routes
            .filter((route) => isRouteAllowedForHost(route, hostRouting.currentHost))
            .map((route) => {
                const RouteComponent = route.component;
                const permission = resolveRoutePermission(entry, route);

                return {
                    key: `plugin-${entry.id}-${route.path}`,
                    path: normalizeRoutePath(route.path),
                    isPublic: Boolean(route.public),
                    permission,
                    element: (
                        <Suspense fallback={<AdminFallback />}>
                            <RouteComponent />
                        </Suspense>
                    ),
                };
            })
    );

    const protectedPluginRoutes = pluginRoutes.filter((route) => !route.isPublic);
    const publicPluginRoutes = pluginRoutes.filter((route) => route.isPublic);
    const firstPublicRoute = publicPluginRoutes[0]?.path ? toAbsoluteRoutePath(publicPluginRoutes[0].path) : null;

    const protectedPluginRouteElements = protectedPluginRoutes.map((route) => (
        <Route
            key={route.key}
            path={route.path}
            element={
                <ProtectedRoute permission={route.permission}>
                    {route.element}
                </ProtectedRoute>
            }
        />
    ));

    const publicPluginRouteElements = publicPluginRoutes.map((route) => (
        <Route
            key={route.key}
            path={route.path}
            element={route.element}
        />
    ));

    const workspaceRoutes = (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/releases" element={<Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Laden...</div>}><PublicChangelog /></Suspense>} />

            <Route element={
                <ProtectedRoute>
                    <Layout />
                </ProtectedRoute>
            }>
                <Route index element={<Dashboard />} />
                <Route path="regie" element={<Suspense fallback={<AdminFallback />}><RegiePage /></Suspense>} />
                <Route path="profile" element={<Suspense fallback={<AdminFallback />}><Profile /></Suspense>} />
                <Route path="notifications" element={<Suspense fallback={<AdminFallback />}><NotificationHistory /></Suspense>} />
                <Route path="helpcenter" element={<Suspense fallback={<AdminFallback />}><Helpcenter /></Suspense>} />
                <Route path="changelog" element={<Suspense fallback={<AdminFallback />}><Changelog /></Suspense>} />
                <Route path="phpmyadmin/*" element={
                    <ProtectedRoute permission="admin.access">
                        <Suspense fallback={<AdminFallback />}><PhpMyAdminRedirect /></Suspense>
                    </ProtectedRoute>
                } />
                {protectedPluginRouteElements}

                <Route path="admin" element={
                    <ProtectedRoute permission="admin.access">
                        <Suspense fallback={<AdminFallback />}><AdminShell /></Suspense>
                    </ProtectedRoute>
                }>
                    <Route index element={<Suspense fallback={<AdminFallback />}><AdminHome /></Suspense>} />
                    <Route path="users" element={
                        <ProtectedRoute permission="users.view">
                            <Suspense fallback={<AdminFallback />}><UserManagement /></Suspense>
                        </ProtectedRoute>
                    } />
                    <Route path="roles" element={
                        <ProtectedRoute permission="roles.view">
                            <Suspense fallback={<AdminFallback />}><RoleManagement /></Suspense>
                        </ProtectedRoute>
                    } />
                    <Route path="audit" element={
                        <ProtectedRoute permission="audit.view">
                            <Suspense fallback={<AdminFallback />}><AuditLog /></Suspense>
                        </ProtectedRoute>
                    } />
                    <Route path="settings" element={
                        <ProtectedRoute permission="settings.manage">
                            <Suspense fallback={<AdminFallback />}><GeneralSettings /></Suspense>
                        </ProtectedRoute>
                    } />
                    <Route path="email" element={
                        <ProtectedRoute permission="settings.manage">
                            <Suspense fallback={<AdminFallback />}><EmailAccounts /></Suspense>
                        </ProtectedRoute>
                    } />
                    <Route path="tenants" element={
                        <ProtectedRoute permission="tenants.manage">
                            <Suspense fallback={<AdminFallback />}><TenantManagement /></Suspense>
                        </ProtectedRoute>
                    } />
                    <Route path="webhooks" element={
                        <ProtectedRoute permission="webhooks.manage">
                            <Suspense fallback={<AdminFallback />}><WebhookManagement /></Suspense>
                        </ProtectedRoute>
                    } />
                    <Route path="sessions" element={
                        <ProtectedRoute permission="users.manage">
                            <Suspense fallback={<AdminFallback />}><SessionManagement /></Suspense>
                        </ProtectedRoute>
                    } />
                    <Route path="backup" element={
                        <ProtectedRoute permission="backup.export">
                            <Suspense fallback={<AdminFallback />}><BackupRestore /></Suspense>
                        </ProtectedRoute>
                    } />
                    <Route path="documents" element={
                        <ProtectedRoute permission="documents.manage">
                            <Suspense fallback={<AdminFallback />}><DocumentManagement /></Suspense>
                        </ProtectedRoute>
                    } />
                    <Route path="updates" element={
                        <ProtectedRoute permission="updates.manage">
                            <Suspense fallback={<AdminFallback />}><UpdateManager /></Suspense>
                        </ProtectedRoute>
                    } />
                    <Route path="security" element={
                        <ProtectedRoute permission="admin.access">
                            <Suspense fallback={<AdminFallback />}><SecuritySettings /></Suspense>
                        </ProtectedRoute>
                    } />
                    <Route path="locks" element={
                        <ProtectedRoute permission="locks.manage">
                            <Suspense fallback={<AdminFallback />}><LockManagement /></Suspense>
                        </ProtectedRoute>
                    } />
                </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );

    const publicRoutes = (
        <Routes>
            {publicPluginRouteElements}
            {firstPublicRoute ? (
                <Route path="*" element={<Navigate to={firstPublicRoute} replace />} />
            ) : (
                <Route path="*" element={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Kein oeffentliches Portal konfiguriert.</div>} />
            )}
        </Routes>
    );

    return (
        <AuthProvider>
            <ToastProvider>
            <WebSocketProvider>
            <ModalProvider>
                <ToastContainer />
                <BrowserRouter>
                    <DynamicBranding />
                    {hostRouting.mode === 'public' ? publicRoutes : workspaceRoutes}
                </BrowserRouter>
            </ModalProvider>
            </WebSocketProvider>
            </ToastProvider>
        </AuthProvider>
    );
}
