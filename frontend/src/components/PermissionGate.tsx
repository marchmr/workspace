import type { ReactNode } from 'react';
import { usePermission } from '../hooks/usePermission';

interface PermissionGateProps {
    permission: string;
    children: ReactNode;
    fallback?: ReactNode;
}

export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
    const hasAccess = usePermission(permission);
    return hasAccess ? <>{children}</> : <>{fallback}</>;
}
