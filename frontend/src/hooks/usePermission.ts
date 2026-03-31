import { useAuth } from '../context/AuthContext';

export function usePermission(permission: string): boolean {
    const { user } = useAuth();
    if (!user) return false;
    if (user.permissions.includes('*')) return true;
    return user.permissions.includes(permission);
}

export function usePermissions(permissions: string[]): boolean {
    const { user } = useAuth();
    if (!user) return false;
    if (user.permissions.includes('*')) return true;
    return permissions.every((p) => user.permissions.includes(p));
}
