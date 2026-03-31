import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

interface User {
    id: number;
    username: string;
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email: string;
    permissions: string[];
    roles?: string[];
    mfaEnabled?: boolean;
    tenants?: { id: number; name: string; slug: string; logoUrl?: string | null; logoUpdatedAt?: string | null }[];
    currentTenantId?: number | null;
    avatarUrl?: string | null;
    avatarUpdatedAt?: string | null;
    createdAt?: string | null;
    pinnedTabs?: string[];
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (
        username: string,
        password: string,
        options?: { mfaCode?: string; recoveryCode?: string }
    ) => Promise<{ mfaRequired?: boolean; remainingRecoveryCodes?: number }>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    switchTenant: (tenantId: number) => Promise<void>;
    updatePinnedTabs: (tabs: string[]) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden');
    return ctx;
}

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers || {});
    const hasBody = options.body !== undefined && options.body !== null;
    const isFormData = options.body instanceof FormData;
    if (hasBody && !isFormData && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(url, {
        ...options,
        credentials: 'include',
        headers,
    });

    // Bei 401: einmal Refresh versuchen
    if (res.status === 401 && !url.includes('/auth/refresh') && !url.includes('/auth/login')) {
        const refreshRes = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
        });

        if (refreshRes.ok) {
            const retryHeaders = new Headers(options.headers || {});
            if (hasBody && !isFormData && !retryHeaders.has('Content-Type')) {
                retryHeaders.set('Content-Type', 'application/json');
            }
            // Retry mit neuem Token
            return fetch(url, {
                ...options,
                credentials: 'include',
                headers: retryHeaders,
            });
        }
    }

    return res;
}

export { apiFetch };

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const isLoginRoute = window.location.pathname === '/login';

    const refreshUser = useCallback(async () => {
        try {
            const res = await apiFetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                setUser(data);
            } else {
                setUser(null);
            }
        } catch {
            setUser(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isLoginRoute) {
            setLoading(false);
            return;
        }
        refreshUser();
    }, [refreshUser, isLoginRoute]);

    const login = async (
        username: string,
        password: string,
        options?: { mfaCode?: string; recoveryCode?: string }
    ) => {
        const mfaCode = options?.mfaCode?.trim();
        const recoveryCode = options?.recoveryCode?.trim();
        const endpoint = recoveryCode ? '/api/auth/mfa/recovery' : '/api/auth/login';
        const body = recoveryCode
            ? { username, password, recoveryCode }
            : { username, password, mfaCode };

        const res = await fetch(endpoint, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Login fehlgeschlagen');
        }

        if (data.mfaRequired) {
            return { mfaRequired: true };
        }

        setUser(data.user);
        return {
            remainingRecoveryCodes: typeof data.remainingRecoveryCodes === 'number'
                ? data.remainingRecoveryCodes
                : undefined,
        };
    };

    const logout = async () => {
        await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include',
        });
        setUser(null);
    };

    const switchTenant = async (tenantId: number) => {
        const res = await apiFetch('/api/auth/switch-tenant', {
            method: 'POST',
            body: JSON.stringify({ tenantId }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Mandantenwechsel fehlgeschlagen');
        }
        setUser(data.user);
    };

    const updatePinnedTabs = useCallback(async (tabs: string[]) => {
        const res = await apiFetch('/api/auth/pinned-tabs', {
            method: 'PUT',
            body: JSON.stringify({ pinnedTabs: tabs }),
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Pinned Tabs konnten nicht gespeichert werden');
        }
        setUser((prev) => prev ? { ...prev, pinnedTabs: data.pinnedTabs } : prev);
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, switchTenant, updatePinnedTabs }}>
            {children}
        </AuthContext.Provider>
    );
}
