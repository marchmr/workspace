import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const RETRY_QUERY_PARAM = 'mike_pma_retry';

export default function PhpMyAdminRedirect() {
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.get(RETRY_QUERY_PARAM) === '1') {
            setFailed(true);
            return;
        }

        const targetUrl = new URL('/phpmyadmin/', window.location.origin);
        targetUrl.searchParams.set(RETRY_QUERY_PARAM, '1');
        window.location.replace(targetUrl.toString());
    }, []);

    if (!failed) {
        return (
            <div className="card">
                <div className="card-title">phpMyAdmin wird geöffnet...</div>
                <p className="text-muted mt-md">Weiterleitung läuft.</p>
            </div>
        );
    }

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">phpMyAdmin</h1>
                <p className="page-subtitle">Die Weiterleitung konnte nicht abgeschlossen werden.</p>
            </div>
            <div className="card">
                <p className="text-muted">
                    phpMyAdmin ist auf dieser Installation aktuell nicht über <code>/phpmyadmin/</code> erreichbar.
                    Prüfe bitte die Webserver-Konfiguration.
                </p>
                <div className="mt-lg" style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                    <a href="/phpmyadmin/" className="btn btn-primary">Erneut versuchen</a>
                    <Link to="/admin" className="btn btn-secondary">Zur Administration</Link>
                </div>
            </div>
        </div>
    );
}
