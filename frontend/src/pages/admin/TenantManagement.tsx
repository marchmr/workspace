import { useEffect, useState } from 'react';
import { apiFetch } from '../../context/AuthContext';
import { useModal, useToast } from '../../components/ModalProvider';

interface Tenant {
    id: number;
    name: string;
    slug: string;
    is_active: boolean;
    created_at: string;
    logo_file?: string | null;
    logo_updated_at?: string | null;
}

interface TenantUser {
    id: number;
    username: string;
    display_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email: string;
    is_active: boolean;
}

const editIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
);

async function readError(res: Response, fallback: string): Promise<string> {
    try {
        const data = await res.json() as { error?: string; blockedUsers?: string[] };
        if (data?.error) {
            if (Array.isArray(data.blockedUsers) && data.blockedUsers.length > 0) {
                return `${data.error}: ${data.blockedUsers.join(', ')}`;
            }
            return data.error;
        }
    } catch {
        // no-op
    }
    return fallback;
}

export default function TenantManagement() {
    const modal = useModal();
    const toast = useToast();
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [loading, setLoading] = useState(true);
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');

    const [modalOpen, setModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState('');
    const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const [form, setForm] = useState<{ id?: number; name: string; slug: string; isActive: boolean; logoUpdatedAt?: string | null }>({
        name: '',
        slug: '',
        isActive: true,
        logoUpdatedAt: null,
    });

    const getTenantLogoSrc = (tenantId: number, logoUpdatedAt?: string | null) => {
        const base = `/api/auth/tenant-logo/${tenantId}`;
        if (!logoUpdatedAt) return base;
        return `${base}?v=${encodeURIComponent(logoUpdatedAt)}`;
    };

    const loadTenants = async () => {
        setLoading(true);
        const res = await apiFetch('/api/admin/tenants');
        if (res.ok) {
            setTenants(await res.json());
        }
        setLoading(false);
    };

    useEffect(() => {
        void loadTenants();
    }, []);

    const createTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        const res = await apiFetch('/api/admin/tenants', {
            method: 'POST',
            body: JSON.stringify({ name, slug: slug || undefined }),
        });

        if (!res.ok) {
            toast.error(await readError(res, 'Mandant konnte nicht erstellt werden'));
            return;
        }

        setName('');
        setSlug('');
        await loadTenants();
    };

    const openEditModal = async (tenant: Tenant) => {
        setError('');
        setForm({
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            isActive: tenant.is_active,
            logoUpdatedAt: tenant.logo_updated_at || null,
        });
        setSelectedLogoFile(null);
        setModalOpen(true);
        setLoadingUsers(true);
        const res = await apiFetch(`/api/admin/tenants/${tenant.id}/users`);
        if (res.ok) {
            setTenantUsers(await res.json());
        } else {
            setTenantUsers([]);
            setError(await readError(res, 'Benutzerliste konnte nicht geladen werden'));
        }
        setLoadingUsers(false);
    };

    const closeModal = () => {
        if (saving || deleting || uploadingLogo) return;
        setModalOpen(false);
        setSelectedLogoFile(null);
    };

    const saveTenant = async () => {
        if (!form.id) return;
        if (!form.name.trim()) {
            setError('Name ist erforderlich');
            return;
        }
        setSaving(true);
        setError('');
        try {
            const res = await apiFetch(`/api/admin/tenants/${form.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name: form.name.trim(),
                    slug: form.slug.trim(),
                    isActive: form.isActive,
                }),
            });
            if (!res.ok) {
                setError(await readError(res, 'Mandant konnte nicht aktualisiert werden'));
                return;
            }
            setModalOpen(false);
            await loadTenants();
        } finally {
            setSaving(false);
        }
    };

    const deleteTenant = async () => {
        if (!form.id) return;
        const ok = await modal.confirm({ title: 'Mandant löschen', message: 'Mandant wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.', confirmText: 'Löschen', variant: 'danger' });
        if (!ok) return;

        setDeleting(true);
        setError('');
        try {
            const res = await apiFetch(`/api/admin/tenants/${form.id}`, { method: 'DELETE' });
            if (!res.ok) {
                setError(await readError(res, 'Mandant konnte nicht gelöscht werden'));
                return;
            }
            setModalOpen(false);
            await loadTenants();
        } finally {
            setDeleting(false);
        }
    };

    const uploadTenantLogo = async () => {
        if (!form.id || !selectedLogoFile) return;
        setUploadingLogo(true);
        setError('');
        try {
            const payload = new FormData();
            payload.append('logo', selectedLogoFile);

            const res = await apiFetch(`/api/admin/tenants/${form.id}/logo`, {
                method: 'POST',
                body: payload,
            });

            if (!res.ok) {
                setError(await readError(res, 'Logo konnte nicht hochgeladen werden'));
                return;
            }

            const data = await res.json() as { logoUpdatedAt?: string | null };
            setForm((prev) => ({ ...prev, logoUpdatedAt: data.logoUpdatedAt || new Date().toISOString() }));
            setSelectedLogoFile(null);
            await loadTenants();
        } finally {
            setUploadingLogo(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">Mandanten</h1>
                <p className="page-subtitle">Mandanten erstellen, aktivieren und verwalten</p>
            </div>

            <div className="card mb-md">
                <div className="card-title mb-md">Neuen Mandanten anlegen</div>
                <form onSubmit={createTenant} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 'var(--space-sm)' }}>
                    <input
                        className="form-input"
                        placeholder="Name (z. B. Firma Nord)"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                    />
                    <input
                        className="form-input"
                        placeholder="Slug (optional, z. B. firma-nord)"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                    />
                    <button className="btn btn-primary" type="submit">Anlegen</button>
                </form>
            </div>

            <div className="card">
                <div className="card-title mb-md">Vorhandene Mandanten</div>
                {loading ? (
                    <div className="text-muted">Laden...</div>
                ) : (
                    <div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Slug</th>
                                    <th>Status</th>
                                    <th>Erstellt</th>
                                    <th className="text-right">Aktionen</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tenants.map((tenant) => (
                                    <tr key={tenant.id}>
                                        <td><strong>{tenant.name}</strong></td>
                                        <td><code>{tenant.slug}</code></td>
                                        <td>
                                            <span className={`badge ${tenant.is_active ? 'badge-success' : 'badge-danger'}`}>
                                                {tenant.is_active ? 'Aktiv' : 'Inaktiv'}
                                            </span>
                                        </td>
                                        <td className="text-muted">{new Date(tenant.created_at).toLocaleDateString('de-DE')}</td>
                                        <td className="text-right">
                                            <button
                                                className="btn btn-secondary btn-sm icon-only-btn"
                                                onClick={() => openEditModal(tenant)}
                                                title="Mandant bearbeiten"
                                                aria-label="Mandant bearbeiten"
                                            >
                                                {editIcon}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {modalOpen && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-card user-edit-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Mandant bearbeiten</h2>
                            <button className="modal-close" onClick={closeModal} disabled={saving || deleting || uploadingLogo} aria-label="Schließen">×</button>
                        </div>

                        {error && (
                            <div className="modal-alert error">
                                <strong>Fehler:</strong> {error}
                            </div>
                        )}

                        <div className="modal-grid">
                            <div className="form-group">
                                <label className="form-label" htmlFor="tenant-name">Name</label>
                                <input
                                    id="tenant-name"
                                    className="form-input"
                                    value={form.name}
                                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="tenant-slug">Slug</label>
                                <input
                                    id="tenant-slug"
                                    className="form-input"
                                    value={form.slug}
                                    onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="checkbox-row" htmlFor="tenant-active">
                                <input
                                    id="tenant-active"
                                    type="checkbox"
                                    checked={form.isActive}
                                    onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                                />
                                Mandant ist aktiv
                            </label>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Mandanten-Logo (quadratisch)</label>
                            {form.id && (
                                <div className="tenant-logo-upload-row">
                                    <div className="tenant-logo-preview" aria-hidden="true">
                                        {form.logoUpdatedAt ? (
                                            <img
                                                src={getTenantLogoSrc(form.id, form.logoUpdatedAt)}
                                                alt=""
                                                className="tenant-logo-preview-image"
                                            />
                                        ) : (
                                            <span>M</span>
                                        )}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <input
                                            type="file"
                                            className="form-input"
                                            accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
                                            onChange={(e) => setSelectedLogoFile(e.target.files?.[0] || null)}
                                        />
                                        <div className="text-muted mt-md">
                                            Empfohlen: quadratisch, max. 5 MB, JPG/PNG/WEBP/GIF.
                                        </div>
                                    </div>
                                    <button
                                        className="btn btn-primary"
                                        type="button"
                                        onClick={uploadTenantLogo}
                                        disabled={!selectedLogoFile || uploadingLogo || saving || deleting}
                                    >
                                        {uploadingLogo ? 'Lade hoch...' : 'Logo hochladen'}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="form-group">
                            <label className="form-label">Benutzer mit Zugriff ({tenantUsers.length})</label>
                            {loadingUsers ? (
                                <div className="text-muted">Lade Benutzer...</div>
                            ) : tenantUsers.length === 0 ? (
                                <div className="text-muted">Keine Benutzer zugeordnet</div>
                            ) : (
                                <div className="selection-grid">
                                    {tenantUsers.map((user) => {
                                        const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
                                        const label = fullName || user.display_name || user.username;
                                        return (
                                            <div key={user.id} className="checkbox-row" style={{ justifyContent: 'space-between' }}>
                                                <span>
                                                    <strong>{label}</strong>
                                                    <span className="text-muted" style={{ marginLeft: 8, fontSize: 'var(--font-size-xs)' }}>
                                                        @{user.username}
                                                    </span>
                                                </span>
                                                <span className={`badge ${user.is_active ? 'badge-success' : 'badge-danger'}`}>
                                                    {user.is_active ? 'Aktiv' : 'Inaktiv'}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
                            <button className="btn btn-danger" onClick={deleteTenant} disabled={saving || deleting}>
                                {deleting ? 'Lösche...' : 'Mandant löschen'}
                            </button>
                            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                <button className="btn btn-secondary" onClick={closeModal} disabled={saving || deleting || uploadingLogo}>Abbrechen</button>
                                <button className="btn btn-primary" onClick={saveTenant} disabled={saving || deleting || uploadingLogo}>
                                    {saving ? 'Speichere...' : 'Änderungen speichern'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
