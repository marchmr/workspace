export type AppHostMode = 'workspace' | 'public';

interface HostRoutingConfig {
    currentHost: string;
    mode: AppHostMode;
    workspaceHosts: string[];
    publicHosts: string[];
}

interface HostRestrictedRoute {
    allowedHosts?: string[];
}

function parseCsvHosts(raw: string | undefined): string[] {
    return String(raw || '')
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean);
}

function hostMatchesPattern(host: string, pattern: string): boolean {
    if (!pattern) return false;
    if (pattern === host) return true;
    if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1); // ".example.com"
        return host.endsWith(suffix) && host.length > suffix.length;
    }
    return false;
}

function hostMatchesAnyPattern(host: string, patterns: string[]): boolean {
    return patterns.some((pattern) => hostMatchesPattern(host, pattern));
}

export function getHostRoutingConfig(hostname = window.location.hostname): HostRoutingConfig {
    const currentHost = String(hostname || '').toLowerCase();
    const workspaceHosts = parseCsvHosts(import.meta.env.VITE_WORKSPACE_HOSTS);
    const publicHosts = parseCsvHosts(import.meta.env.VITE_PUBLIC_HOSTS);

    const isExplicitWorkspace = hostMatchesAnyPattern(currentHost, workspaceHosts);
    const isExplicitPublic = hostMatchesAnyPattern(currentHost, publicHosts);

    const isWorkspaceHost = workspaceHosts.length === 0 ? !isExplicitPublic : isExplicitWorkspace;
    const mode: AppHostMode = isExplicitPublic && !isWorkspaceHost ? 'public' : 'workspace';

    return {
        currentHost,
        mode,
        workspaceHosts,
        publicHosts,
    };
}

export function isRouteAllowedForHost(route: HostRestrictedRoute, hostname = window.location.hostname): boolean {
    const allowedHosts = Array.isArray(route.allowedHosts)
        ? route.allowedHosts.map((host) => String(host).trim().toLowerCase()).filter(Boolean)
        : [];

    if (allowedHosts.length === 0) return true;
    return hostMatchesAnyPattern(String(hostname || '').toLowerCase(), allowedHosts);
}
