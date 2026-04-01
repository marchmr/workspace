import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function updateFavicon(url: string | null) {
    let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
    }
    const newHref = url || '/favicon.ico';
    // Only update if it's actually different (ignoring search params if possible, or just exact match)
    if (!link.href.endsWith(newHref) && link.href !== newHref) {
        link.href = newHref;
    }
}

export function DynamicBranding() {
    const { user, loading } = useAuth();
    const location = useLocation();

    useEffect(() => {
        if (loading) return;

        // Skip plugin public pages that manage their own titles
        if (location.pathname.startsWith('/kundenportal')) {
            return;
        }

        // Login page specific
        if (location.pathname === '/login') {
            document.title = 'WorkSpace';
            updateFavicon('/favicon.ico');
            return;
        }

        // If authenticated and have tenant info
        if (user && user.currentTenantId) {
            const tenant = user.tenants?.find((t) => t.id === user.currentTenantId);
            if (tenant) {
                document.title = `WorkSpace - ${tenant.name}`;
                updateFavicon(tenant.logoUrl || '/favicon.ico');
                return;
            }
        }

        // Default fallback (e.g. public pages without context)
        document.title = 'WorkSpace';
        updateFavicon('/favicon.ico');
        
    }, [user, loading, location.pathname]);

    return null;
}
