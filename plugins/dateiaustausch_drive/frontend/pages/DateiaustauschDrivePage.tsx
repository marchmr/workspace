import { useEffect, useState } from 'react';
import { apiFetch } from '@mike/context/AuthContext';

type ConnectorStatus = {
    provider: 'google_drive' | 'sharepoint';
    configured: boolean;
    customerFolderPrefix: string;
    google: {
        configured: boolean;
        sharedDriveId: string | null;
        rootFolderId: string | null;
    };
    sharepoint: {
        configured: boolean;
        siteId: string | null;
        driveId: string | null;
        rootFolderId: string | null;
    };
};

export default function DateiaustauschDrivePage() {
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<ConnectorStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        setLoading(true);
        apiFetch('/api/plugins/dateiaustausch_drive/admin/connector/status')
            .then(async (res) => {
                const payload = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(payload?.error || 'Status konnte nicht geladen werden.');
                if (active) setStatus(payload as ConnectorStatus);
            })
            .catch((err) => {
                if (active) setError(err instanceof Error ? err.message : 'Status konnte nicht geladen werden.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    return (
        <div className="page">
            <div className="card dtxd-stack">
                <div>
                    <h1 className="page-title">Dateiaustausch Drive</h1>
                    <p className="text-muted">Cloud-Connector (Google Drive oder SharePoint) als alternative Dateiaustausch-Infrastruktur.</p>
                </div>

                {loading ? <p className="text-muted">Lade Status...</p> : null}
                {error ? <p className="text-danger">{error}</p> : null}

                {!loading && !error && status ? (
                    <div className="dtxd-grid">
                        <div className="card">
                            <h3>Connector</h3>
                            <p className={status.configured ? 'text-success' : 'text-warning'}>
                                {status.configured ? 'Konfiguriert' : 'Nicht konfiguriert'}
                            </p>
                        </div>
                        <div className="card">
                            <h3>Provider</h3>
                            <p>{status.provider === 'sharepoint' ? 'SharePoint' : 'Google Drive'}</p>
                        </div>
                        <div className="card">
                            <h3>Ziel</h3>
                            {status.provider === 'sharepoint' ? (
                                <p>
                                    Site: {status.sharepoint.siteId || '-'}
                                    <br />
                                    Drive: {status.sharepoint.driveId || '-'}
                                </p>
                            ) : (
                                <p>
                                    Root: {status.google.rootFolderId || '-'}
                                    <br />
                                    Shared Drive: {status.google.sharedDriveId || 'My Drive'}
                                </p>
                            )}
                        </div>
                    </div>
                ) : null}

                <div className="card">
                    <p className="dtxd-muted">
                        Konfiguration und Verbindungstest findest du unter <strong>Admin → Einstellungen → Dateiaustausch Drive</strong>.
                    </p>
                </div>
            </div>
        </div>
    );
}
