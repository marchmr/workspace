import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../context/AuthContext';
import { useModal } from '../../components/ModalProvider';

interface User {
    id: number;
    username: string;
    display_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email: string;
    is_active: boolean;
    mfa_enabled: boolean;
    roles: { id: number; name: string }[];
    tenantIds: number[];
    extraPermissionIds: number[];
    extraPermissions: { id: number; key: string; label: string; plugin_id: string | null }[];
    created_at: string;
}

interface Tenant {
    id: number;
    name: string;
}

interface Role {
    id: number;
    name: string;
}

interface Permission {
    id: number;
    key: string;
    label: string;
    plugin_id: string | null;
}

interface EditFormState {
    id?: number;
    username: string;
    displayName: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    isActive: boolean;
    roleIds: number[];
    tenantIds: number[];
    additionalPermissionIds: number[];
    mfaEnabled: boolean;
}

const editIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
);

async function readError(res: Response, fallback: string): Promise<string> {
    try {
        const data = await res.json() as { error?: string };
        if (data?.error) return data.error;
    } catch {
        // no-op
    }
    return fallback;
}

export default function UserManagement() {
    const modal = useModal();
    const [users, setUsers] = useState<User[]>([]);
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
    const [loading, setLoading] = useState(true);

    const [modalOpen, setModalOpen] = useState(false);
    const [isCreateMode, setIsCreateMode] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [form, setForm] = useState<EditFormState>({
        username: '',
        displayName: '',
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        isActive: true,
        roleIds: [],
        tenantIds: [],
        additionalPermissionIds: [],
        mfaEnabled: false,
    });

    const loadUsers = async () => {
        setLoading(true);
        const [usersRes, tenantsRes, rolesRes, permissionsRes] = await Promise.all([
            apiFetch('/api/admin/users'),
            apiFetch('/api/admin/tenants'),
            apiFetch('/api/admin/roles'),
            apiFetch('/api/admin/permissions'),
        ]);

        if (usersRes.ok) setUsers(await usersRes.json());
        if (tenantsRes.ok) setTenants(await tenantsRes.json());
        if (rolesRes.ok) {
            const roleData = await rolesRes.json() as Array<{ id: number; name: string }>;
            setRoles(roleData.map((role) => ({ id: role.id, name: role.name })));
        }
        if (permissionsRes.ok) {
            const permissionData = await permissionsRes.json() as Permission[];
            setAllPermissions(permissionData.sort((a, b) => a.key.localeCompare(b.key, 'de', { sensitivity: 'base' })));
        }
        setLoading(false);
    };

    useEffect(() => {
        void loadUsers();
    }, []);

    // Handle ?action=create from Quick Actions
    const [searchParams, setSearchParams] = useSearchParams();
    useEffect(() => {
        if (searchParams.get('action') === 'create' && !loading && tenants.length > 0) {
            openCreateModal();
            setSearchParams({}, { replace: true });
        }
    }, [loading, searchParams, tenants.length]);

    const userCountLabel = useMemo(() => `${users.length} Benutzer`, [users.length]);
    const groupedPermissions = useMemo(() => {
        const groups = new Map<string, Permission[]>();
        for (const permission of allPermissions) {
            const group = permission.plugin_id ? `Plugin: ${permission.plugin_id}` : 'Core';
            const list = groups.get(group) || [];
            list.push(permission);
            groups.set(group, list);
        }

        return Array.from(groups.entries())
            .sort((a, b) => {
                if (a[0] === 'Core') return -1;
                if (b[0] === 'Core') return 1;
                return a[0].localeCompare(b[0], 'de', { sensitivity: 'base' });
            })
            .map(([group, permissions]) => ({
                group,
                permissions: permissions.sort((a, b) => a.key.localeCompare(b.key, 'de', { sensitivity: 'base' })),
            }));
    }, [allPermissions]);

    const openCreateModal = () => {
        setIsCreateMode(true);
        setError('');
        setForm({
            username: '',
            displayName: '',
            firstName: '',
            lastName: '',
            email: '',
            password: '',
            isActive: true,
            roleIds: [],
            tenantIds: tenants.length > 0 ? [tenants[0].id] : [],
            additionalPermissionIds: [],
            mfaEnabled: false,
        });
        setModalOpen(true);
    };

    const openEditModal = (user: User) => {
        setIsCreateMode(false);
        setError('');
        setForm({
            id: user.id,
            username: user.username,
            displayName: user.display_name || '',
            firstName: user.first_name || '',
            lastName: user.last_name || '',
            email: user.email,
            password: '',
            isActive: user.is_active,
            roleIds: user.roles.map((role) => role.id),
            tenantIds: user.tenantIds,
            additionalPermissionIds: user.extraPermissionIds || [],
            mfaEnabled: user.mfa_enabled,
        });
        setModalOpen(true);
    };

    const closeModal = () => {
        if (saving) return;
        setModalOpen(false);
    };

    const toggleRole = (roleId: number) => {
        setForm((prev) => ({
            ...prev,
            roleIds: prev.roleIds.includes(roleId)
                ? prev.roleIds.filter((id) => id !== roleId)
                : [...prev.roleIds, roleId],
        }));
    };

    const toggleTenant = (tenantId: number) => {
        setForm((prev) => ({
            ...prev,
            tenantIds: prev.tenantIds.includes(tenantId)
                ? prev.tenantIds.filter((id) => id !== tenantId)
                : [...prev.tenantIds, tenantId],
        }));
    };

    const toggleAdditionalPermission = (permissionId: number) => {
        setForm((prev) => ({
            ...prev,
            additionalPermissionIds: prev.additionalPermissionIds.includes(permissionId)
                ? prev.additionalPermissionIds.filter((id) => id !== permissionId)
                : [...prev.additionalPermissionIds, permissionId],
        }));
    };

    const saveUser = async () => {
        setError('');

        if (!form.username.trim() || !form.email.trim()) {
            setError('Benutzername und E-Mail sind erforderlich.');
            return;
        }
        if (isCreateMode && !form.password.trim()) {
            setError('Für neue Benutzer ist ein Passwort erforderlich.');
            return;
        }
        if (form.tenantIds.length === 0) {
            setError('Mindestens ein Mandant muss zugewiesen sein.');
            return;
        }

        setSaving(true);
        try {
            if (isCreateMode) {
                const createRes = await apiFetch('/api/admin/users', {
                    method: 'POST',
                    body: JSON.stringify({
                        username: form.username.trim(),
                        displayName: form.displayName.trim(),
                        firstName: form.firstName.trim(),
                        lastName: form.lastName.trim(),
                        email: form.email.trim(),
                        password: form.password.trim(),
                        roleIds: form.roleIds,
                        tenantIds: form.tenantIds,
                        additionalPermissionIds: form.additionalPermissionIds,
                    }),
                });

                if (!createRes.ok) {
                    setError(await readError(createRes, 'Benutzer konnte nicht erstellt werden.'));
                    return;
                }
            } else {
                const updateRes = await apiFetch(`/api/admin/users/${form.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        username: form.username.trim(),
                        displayName: form.displayName.trim(),
                        firstName: form.firstName.trim(),
                        lastName: form.lastName.trim(),
                        email: form.email.trim(),
                        password: form.password.trim() || undefined,
                        isActive: form.isActive,
                        roleIds: form.roleIds,
                        tenantIds: form.tenantIds,
                        additionalPermissionIds: form.additionalPermissionIds,
                    }),
                });

                if (!updateRes.ok) {
                    setError(await readError(updateRes, 'Benutzer konnte nicht gespeichert werden.'));
                    return;
                }
            }

            setModalOpen(false);
            await loadUsers();
        } finally {
            setSaving(false);
        }
    };

    const resetMfa = async () => {
        if (!form.id) return;
        const ok = await modal.confirm({ title: 'MFA zurücksetzen', message: 'MFA für diesen Benutzer wirklich zurücksetzen?', confirmText: 'Zurücksetzen', variant: 'warning' });
        if (!ok) return;

        const res = await apiFetch(`/api/admin/users/${form.id}/reset-mfa`, { method: 'POST' });
        if (!res.ok) {
            setError(await readError(res, 'MFA konnte nicht zurückgesetzt werden.'));
            return;
        }
        setForm((prev) => ({ ...prev, mfaEnabled: false }));
        await loadUsers();
    };

    const deleteUser = async () => {
        if (!form.id) return;
        const ok = await modal.confirm({
            title: 'Benutzer löschen',
            message: `Soll der Benutzer "${form.username}" wirklich unwiderruflich gelöscht werden?`,
            confirmText: 'Endgültig löschen',
            variant: 'danger',
        });
        if (!ok) return;

        setSaving(true);
        try {
            const res = await apiFetch(`/api/admin/users/${form.id}`, { method: 'DELETE' });
            if (!res.ok) {
                setError(await readError(res, 'Benutzer konnte nicht gelöscht werden.'));
                return;
            }
            setModalOpen(false);
            await loadUsers();
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="text-muted">Laden...</div>;

    return (
        <div>
            <div className="flex-between">
                <div className="page-header">
                    <h1 className="page-title">Benutzerverwaltung</h1>
                    <p className="page-subtitle">{userCountLabel}</p>
                </div>
                <button className="btn btn-primary" onClick={openCreateModal}>+ Neuer Benutzer</button>
            </div>

            <div className="card">
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Benutzername</th>
                                <th>E-Mail</th>
                                <th>Rollen</th>
                                <th>Einzelrechte</th>
                                <th>Mandanten</th>
                                <th>MFA</th>
                                <th>Status</th>
                                <th>Erstellt</th>
                                <th className="text-right">Aktionen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((user) => (
                                <tr key={user.id}>
                                    <td><strong>{user.username}</strong></td>
                                    <td>{user.email}</td>
                                    <td>
                                        {user.roles.map((role) => (
                                            <span key={role.id} className="badge badge-info" style={{ marginRight: 4 }}>{role.name}</span>
                                        ))}
                                    </td>
                                    <td>
                                        {user.extraPermissions?.length ? (
                                            <>
                                                {user.extraPermissions.slice(0, 2).map((perm) => (
                                                    <span key={perm.id} className="badge badge-warning" style={{ marginRight: 4 }}>
                                                        {perm.key}
                                                    </span>
                                                ))}
                                                {user.extraPermissions.length > 2 && (
                                                    <span className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                                                        +{user.extraPermissions.length - 2} weitere
                                                    </span>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-muted">-</span>
                                        )}
                                    </td>
                                    <td>
                                        {user.tenantIds.map((tenantId) => {
                                            const tenant = tenants.find((t) => t.id === tenantId);
                                            return (
                                                <span key={tenantId} className="badge badge-info" style={{ marginRight: 4 }}>
                                                    {tenant ? tenant.name : `#${tenantId}`}
                                                </span>
                                            );
                                        })}
                                    </td>
                                    <td>
                                        {user.mfa_enabled
                                            ? <span className="badge badge-success">Aktiv</span>
                                            : <span className="badge badge-warning">Aus</span>}
                                    </td>
                                    <td>
                                        {user.is_active
                                            ? <span className="badge badge-success">Aktiv</span>
                                            : <span className="badge badge-danger">Inaktiv</span>}
                                    </td>
                                    <td className="text-muted">{new Date(user.created_at).toLocaleDateString('de-DE')}</td>
                                    <td className="text-right">
                                        <button
                                            className="btn btn-secondary btn-sm icon-only-btn"
                                            onClick={() => openEditModal(user)}
                                            title="Benutzer bearbeiten"
                                            aria-label="Benutzer bearbeiten"
                                        >
                                            {editIcon}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {modalOpen && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-card user-edit-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{isCreateMode ? 'Neuen Benutzer erstellen' : 'Benutzer bearbeiten'}</h2>
                            <button className="modal-close" onClick={closeModal} disabled={saving} aria-label="Schließen">×</button>
                        </div>

                        {error && (
                            <div className="modal-alert error">
                                <strong>Fehler:</strong> {error}
                            </div>
                        )}

                        <div className="modal-grid">
                            <div className="form-group">
                                <label className="form-label" htmlFor="edit-username">Benutzername</label>
                                <input
                                    id="edit-username"
                                    className="form-input"
                                    value={form.username}
                                    onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="edit-email">E-Mail</label>
                                <input
                                    id="edit-email"
                                    className="form-input"
                                    value={form.email}
                                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="edit-display-name">Anzeigename</label>
                                <input
                                    id="edit-display-name"
                                    className="form-input"
                                    value={form.displayName}
                                    onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="edit-first-name">Vorname</label>
                                <input
                                    id="edit-first-name"
                                    className="form-input"
                                    value={form.firstName}
                                    onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="edit-last-name">Nachname</label>
                                <input
                                    id="edit-last-name"
                                    className="form-input"
                                    value={form.lastName}
                                    onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="edit-password">
                                    {isCreateMode ? 'Passwort' : 'Neues Passwort (optional)'}
                                </label>
                                <input
                                    id="edit-password"
                                    className="form-input"
                                    type="password"
                                    value={form.password}
                                    onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                                    autoComplete="new-password"
                                />
                            </div>
                            {!isCreateMode && (
                                <div className="form-group">
                                    <label className="form-label" htmlFor="edit-active">Status</label>
                                    <label className="checkbox-row" htmlFor="edit-active">
                                        <input
                                            id="edit-active"
                                            type="checkbox"
                                            checked={form.isActive}
                                            onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                                        />
                                        Benutzer ist aktiv
                                    </label>
                                </div>
                            )}
                        </div>

                        <div className="form-group">
                            <label className="form-label">Rollen</label>
                            <div className="selection-grid">
                                {roles.map((role) => (
                                    <label key={role.id} className="checkbox-row">
                                        <input
                                            type="checkbox"
                                            checked={form.roleIds.includes(role.id)}
                                            onChange={() => toggleRole(role.id)}
                                        />
                                        {role.name}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Zusätzliche Einzelrechte (additiv)</label>
                            <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 8 }}>
                                Diese Rechte werden zusätzlich zu den Rollen-Rechten vergeben.
                            </div>
                            {groupedPermissions.map((group) => (
                                <div key={`user-perm-${group.group}`} style={{ marginBottom: 'var(--space-md)' }}>
                                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 8 }}>
                                        {group.group}
                                    </div>
                                    <div className="selection-grid">
                                        {group.permissions.map((permission) => (
                                            <label key={permission.id} className="checkbox-row">
                                                <input
                                                    type="checkbox"
                                                    checked={form.additionalPermissionIds.includes(permission.id)}
                                                    onChange={() => toggleAdditionalPermission(permission.id)}
                                                />
                                                {permission.key}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="form-group">
                            <label className="form-label">Mandanten</label>
                            <div className="selection-grid">
                                {tenants.map((tenant) => (
                                    <label key={tenant.id} className="checkbox-row">
                                        <input
                                            type="checkbox"
                                            checked={form.tenantIds.includes(tenant.id)}
                                            onChange={() => toggleTenant(tenant.id)}
                                        />
                                        {tenant.name}
                                    </label>
                                ))}
                            </div>
                        </div>

                        {!isCreateMode && (
                            <div className="modal-footer-row">
                                <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)' }}>
                                    MFA: {form.mfaEnabled ? 'Aktiv' : 'Aus'}
                                </div>
                                <button className="btn btn-secondary btn-sm" onClick={resetMfa} disabled={!form.mfaEnabled || saving}>
                                    MFA zurücksetzen
                                </button>
                            </div>
                        )}

                        <div className="modal-actions">
                            {!isCreateMode && (
                                <button
                                    className="btn btn-danger"
                                    onClick={deleteUser}
                                    disabled={saving}
                                    style={{ marginRight: 'auto' }}
                                >
                                    Benutzer löschen
                                </button>
                            )}
                            <button className="btn btn-secondary" onClick={closeModal} disabled={saving}>Abbrechen</button>
                            <button className="btn btn-primary" onClick={saveUser} disabled={saving}>
                                {saving ? 'Speichere...' : isCreateMode ? 'Benutzer erstellen' : 'Änderungen speichern'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
