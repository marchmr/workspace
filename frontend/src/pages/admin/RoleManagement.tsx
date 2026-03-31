import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../context/AuthContext';
import { useModal } from '../../components/ModalProvider';

interface Permission {
    id: number;
    key: string;
    label: string;
    plugin_id: string | null;
}

interface Role {
    id: number;
    name: string;
    description: string | null;
    is_system: boolean;
    is_super_admin?: boolean;
    permissions: Permission[];
}

interface RoleFormState {
    id?: number;
    name: string;
    description: string;
    permissionIds: number[];
    isSystem: boolean;
    isSuperAdmin: boolean;
}

function normalizePermissionGroup(permission: Permission): string {
    if (!permission.plugin_id) return 'Core';
    return `Plugin: ${permission.plugin_id}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
    try {
        const data = await res.json() as { error?: string };
        if (data?.error) return data.error;
    } catch {
        // no-op
    }
    return fallback;
}

export default function RoleManagement() {
    const modal = useModal();
    const [roles, setRoles] = useState<Role[]>([]);
    const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState('');
    const [permFilter, setPermFilter] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState<RoleFormState>({
        name: '',
        description: '',
        permissionIds: [],
        isSystem: false,
        isSuperAdmin: false,
    });

    const loadData = async () => {
        setLoading(true);
        setError('');
        try {
            const [rolesRes, permsRes] = await Promise.all([
                apiFetch('/api/admin/roles'),
                apiFetch('/api/admin/permissions'),
            ]);

            if (!rolesRes.ok) {
                setError(await readError(rolesRes, 'Rollen konnten nicht geladen werden.'));
                return;
            }
            if (!permsRes.ok) {
                setError(await readError(permsRes, 'Berechtigungen konnten nicht geladen werden.'));
                return;
            }

            const roleData = await rolesRes.json() as Role[];
            const permissionData = await permsRes.json() as Permission[];
            setRoles(roleData);
            setAllPermissions(permissionData.sort((a, b) => a.key.localeCompare(b.key, 'de', { sensitivity: 'base' })));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
    }, []);

    const superAdminRole = useMemo(
        () => roles.find((role) => role.is_super_admin || role.name === 'Super-Admin') || null,
        [roles]
    );

    const editableRoles = useMemo(
        () => roles.filter((role) => !(role.is_super_admin || role.name === 'Super-Admin')),
        [roles]
    );

    const groupedCatalogPermissions = useMemo(() => {
        const groups = new Map<string, Permission[]>();
        for (const permission of allPermissions) {
            const groupKey = normalizePermissionGroup(permission);
            const list = groups.get(groupKey) || [];
            list.push(permission);
            groups.set(groupKey, list);
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

    const filteredModalPermissions = useMemo(() => {
        const normalizedFilter = permFilter.trim().toLowerCase();
        return groupedCatalogPermissions
            .map((entry) => ({
                ...entry,
                permissions: entry.permissions.filter((permission) => {
                    if (!normalizedFilter) return true;
                    return permission.key.toLowerCase().includes(normalizedFilter)
                        || permission.label.toLowerCase().includes(normalizedFilter);
                }),
            }))
            .filter((entry) => entry.permissions.length > 0);
    }, [groupedCatalogPermissions, permFilter]);

    const openCreateModal = () => {
        setError('');
        setPermFilter('');
        setForm({
            name: '',
            description: '',
            permissionIds: [],
            isSystem: false,
            isSuperAdmin: false,
        });
        setModalOpen(true);
    };

    const openEditModal = (role: Role) => {
        const isSuperAdmin = Boolean(role.is_super_admin || role.name === 'Super-Admin');
        setError('');
        setPermFilter('');
        setForm({
            id: role.id,
            name: role.name,
            description: role.description || '',
            permissionIds: role.permissions.map((permission) => Number(permission.id)),
            isSystem: Boolean(role.is_system),
            isSuperAdmin,
        });
        setModalOpen(true);
    };

    const closeModal = () => {
        if (saving || deleting) return;
        setModalOpen(false);
    };

    const togglePermission = (permissionId: number) => {
        setForm((prev) => ({
            ...prev,
            permissionIds: prev.permissionIds.includes(permissionId)
                ? prev.permissionIds.filter((id) => id !== permissionId)
                : [...prev.permissionIds, permissionId],
        }));
    };

    const saveRole = async () => {
        if (form.isSuperAdmin) return;
        if (!form.name.trim()) {
            setError('Rollenname ist erforderlich.');
            return;
        }

        setSaving(true);
        setError('');
        try {
            if (form.id) {
                const res = await apiFetch(`/api/admin/roles/${form.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        name: form.name.trim(),
                        description: form.description.trim() || null,
                        permissionIds: form.permissionIds,
                    }),
                });
                if (!res.ok) {
                    setError(await readError(res, 'Rolle konnte nicht gespeichert werden.'));
                    return;
                }
            } else {
                const res = await apiFetch('/api/admin/roles', {
                    method: 'POST',
                    body: JSON.stringify({
                        name: form.name.trim(),
                        description: form.description.trim() || null,
                        permissionIds: form.permissionIds,
                    }),
                });
                if (!res.ok) {
                    setError(await readError(res, 'Rolle konnte nicht erstellt werden.'));
                    return;
                }
            }

            setModalOpen(false);
            await loadData();
        } finally {
            setSaving(false);
        }
    };

    const deleteRole = async () => {
        if (!form.id || form.isSuperAdmin || form.isSystem) return;
        const ok = await modal.confirm({ title: 'Rolle löschen', message: 'Rolle wirklich löschen?', confirmText: 'Löschen', variant: 'danger' });
        if (!ok) return;

        setDeleting(true);
        setError('');
        try {
            const res = await apiFetch(`/api/admin/roles/${form.id}`, { method: 'DELETE' });
            if (!res.ok) {
                setError(await readError(res, 'Rolle konnte nicht gelöscht werden.'));
                return;
            }
            setModalOpen(false);
            await loadData();
        } finally {
            setDeleting(false);
        }
    };

    if (loading) return <div className="text-muted">Laden...</div>;

    return (
        <div>
            <div className="flex-between">
                <div className="page-header">
                    <h1 className="page-title">Rollen & Rechte</h1>
                    <p className="page-subtitle">
                        {roles.length} Rollen, {allPermissions.length} Berechtigungen
                    </p>
                </div>
                <button className="btn btn-primary" onClick={openCreateModal}>+ Neue Rolle</button>
            </div>

            {error && (
                <div className="card mb-md">
                    <p className="text-danger"><strong>Fehler:</strong> {error}</p>
                </div>
            )}

            {superAdminRole && (
                <div className="card mb-md">
                    <div className="card-header" style={{ marginBottom: 'var(--space-sm)' }}>
                        <div>
                            <div className="card-title">Super-Admin</div>
                            <div className="text-muted">Standardrolle mit vollständigem Zugriff auf alle aktuellen und zukünftigen Berechtigungen.</div>
                        </div>
                        <span className="badge badge-info">Nicht bearbeitbar</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <span className="badge badge-success">Alle Berechtigungen</span>
                    </div>
                </div>
            )}

            <div className="card mb-md">
                <div className="card-title mb-md">Rollenübersicht</div>
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Rolle</th>
                                <th>Typ</th>
                                <th>Berechtigungen</th>
                                <th className="text-right">Aktionen</th>
                            </tr>
                        </thead>
                        <tbody>
                            {editableRoles.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="text-muted">Keine bearbeitbaren Rollen vorhanden.</td>
                                </tr>
                            ) : editableRoles.map((role) => (
                                <tr key={role.id}>
                                    <td>
                                        <strong>{role.name}</strong>
                                        {role.description && (
                                            <div className="text-muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 4 }}>
                                                {role.description}
                                            </div>
                                        )}
                                    </td>
                                    <td>
                                        <span className={`badge ${role.is_system ? 'badge-info' : 'badge-warning'}`}>
                                            {role.is_system ? 'Standard' : 'Individuell'}
                                        </span>
                                    </td>
                                    <td>{role.permissions.length}</td>
                                    <td className="text-right">
                                        <button className="btn btn-secondary btn-sm" onClick={() => openEditModal(role)}>
                                            Bearbeiten
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="card">
                <div className="card-title mb-md">Verfügbare Berechtigungen</div>
                {groupedCatalogPermissions.map((group) => (
                    <div key={group.group} style={{ marginBottom: 'var(--space-md)' }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 8 }}>
                            {group.group}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {group.permissions.map((permission) => (
                                <span key={permission.id} className="badge badge-info" title={permission.label}>
                                    {permission.key}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {modalOpen && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-card user-edit-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{form.id ? 'Rolle bearbeiten' : 'Rolle erstellen'}</h2>
                            <button className="modal-close" onClick={closeModal} disabled={saving || deleting} aria-label="Schließen">×</button>
                        </div>

                        {form.isSuperAdmin && (
                            <div className="modal-alert error" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}>
                                Super-Admin ist eine feste Standardrolle und nicht bearbeitbar.
                            </div>
                        )}

                        <div className="modal-grid">
                            <div className="form-group">
                                <label className="form-label" htmlFor="role-name">Rollenname</label>
                                <input
                                    id="role-name"
                                    className="form-input"
                                    value={form.name}
                                    disabled={saving || deleting || form.isSuperAdmin || form.isSystem}
                                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="role-description">Beschreibung</label>
                                <input
                                    id="role-description"
                                    className="form-input"
                                    value={form.description}
                                    disabled={saving || deleting || form.isSuperAdmin}
                                    onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label" htmlFor="permission-filter">Berechtigungen filtern</label>
                            <input
                                id="permission-filter"
                                className="form-input"
                                placeholder="z. B. users, documents, plugin..."
                                value={permFilter}
                                onChange={(event) => setPermFilter(event.target.value)}
                                disabled={saving || deleting || form.isSuperAdmin}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Berechtigungen ({form.permissionIds.length} ausgewählt)</label>
                            {filteredModalPermissions.length === 0 ? (
                                <div className="text-muted">Keine passenden Berechtigungen gefunden.</div>
                            ) : (
                                filteredModalPermissions.map((group) => (
                                    <div key={`modal-${group.group}`} style={{ marginBottom: 'var(--space-md)' }}>
                                        <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', marginBottom: 8 }}>
                                            {group.group}
                                        </div>
                                        <div className="selection-grid">
                                            {group.permissions.map((permission) => (
                                                <label key={permission.id} className="checkbox-row">
                                                    <input
                                                        type="checkbox"
                                                        checked={form.permissionIds.includes(permission.id)}
                                                        disabled={saving || deleting || form.isSuperAdmin}
                                                        onChange={() => togglePermission(permission.id)}
                                                    />
                                                    {permission.key}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
                            <button
                                className="btn btn-danger"
                                onClick={deleteRole}
                                disabled={!form.id || form.isSystem || form.isSuperAdmin || saving || deleting}
                            >
                                {deleting ? 'Lösche...' : 'Rolle löschen'}
                            </button>
                            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                <button className="btn btn-secondary" onClick={closeModal} disabled={saving || deleting}>
                                    Abbrechen
                                </button>
                                <button className="btn btn-primary" onClick={saveRole} disabled={saving || deleting || form.isSuperAdmin}>
                                    {saving ? 'Speichere...' : form.id ? 'Änderungen speichern' : 'Rolle erstellen'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
