import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { ReactNode } from 'react';

interface ProtectedRouteProps {
    children: ReactNode;
    permission?: string;
}

export function ProtectedRoute({ children, permission }: ProtectedRouteProps) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
                <div className="text-muted">Laden...</div>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (permission) {
        const hasAccess = user.permissions.includes('*') || user.permissions.includes(permission);
        if (!hasAccess) {
            return (
                <div className="card" style={{ textAlign: 'center', marginTop: 'var(--space-2xl)' }}>
                    <h2>🚫 Kein Zugriff</h2>
                    <p className="text-muted mt-md">Sie haben keine Berechtigung für diese Seite.</p>
                </div>
            );
        }
    }

    return <>{children}</>;
}
