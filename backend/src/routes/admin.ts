import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, createHmac, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { getDatabase } from '../core/database.js';
import { requirePermission } from '../core/permissions.js';
import { hashPassword } from '../core/auth.js';
import { encrypt, decrypt } from '../core/encryption.js';
import { config } from '../core/config.js';
import {
    ACCOUNTING_CONNECTOR_SETTING_KEYS,
    buildAccountingConnectorEndpointUrl,
    loadAccountingConnectorSettings,
} from '../core/accountingConnectorSettings.js';
import { decryptUserSensitiveFields, encryptUserSensitiveFields, hashEmail } from '../core/userSensitiveFields.js';
import { createUpdateTask, getUpdateTask, runUpdateTask } from '../services/updateTasks.js';

export default async function adminRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();
    const tenantLogoDir = path.join(config.app.uploadsDir, 'tenant-logos');
    const EXTERNAL_DOCS_SETTING_KEY = 'documents.external_directories';
    const STORAGE_BINDING_SETTING_KEY = 'documents.storage_binding';
    let hasUserEmailHashColumn: boolean | null = null;

    // Passwort-Stärke-Validierung (H1 Security Fix)
    function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
        if (password.length < 10) return { valid: false, error: 'Passwort muss mindestens 10 Zeichen lang sein' };
        if (!/[A-Z]/.test(password)) return { valid: false, error: 'Passwort muss mindestens einen Großbuchstaben enthalten' };
        if (!/[a-z]/.test(password)) return { valid: false, error: 'Passwort muss mindestens einen Kleinbuchstaben enthalten' };
        if (!/[0-9]/.test(password)) return { valid: false, error: 'Passwort muss mindestens eine Zahl enthalten' };
        if (!/[^A-Za-z0-9]/.test(password)) return { valid: false, error: 'Passwort muss mindestens ein Sonderzeichen enthalten' };
        return { valid: true };
    }

    interface ExternalDirectory {
        id: string;
        name: string;
        path: string;
        isActive: boolean;
    }

    interface StorageBindingConfig {
        mode: 'local' | 'external';
        externalDirectoryId: string | null;
    }

    // Auth wird per-Route über requirePermission() sichergestellt (PolicyEngine-konform)

    function getTenantId(request: FastifyRequest): number {
        const tenantId = request.user?.tenantId;
        if (!tenantId) {
            throw new Error('Kein aktiver Mandant im Token');
        }
        return tenantId;
    }

    async function getExternalDirectoriesFromSettings(): Promise<ExternalDirectory[]> {
        const setting = await db('settings')
            .where({ key: EXTERNAL_DOCS_SETTING_KEY })
            .whereNull('tenant_id')
            .first();

        if (!setting?.value_encrypted) return [];

        try {
            const rawValue = decrypt(String(setting.value_encrypted));
            const parsed = JSON.parse(rawValue);
            if (!Array.isArray(parsed)) return [];

            return parsed
                .map((entry: any) => ({
                    id: typeof entry?.id === 'string' && entry.id.trim() ? entry.id.trim() : randomUUID(),
                    name: typeof entry?.name === 'string' ? entry.name.trim() : '',
                    path: typeof entry?.path === 'string' ? entry.path.trim() : '',
                    isActive: entry?.isActive !== false,
                }))
                .filter((entry: ExternalDirectory) => entry.name && entry.path);
        } catch {
            return [];
        }
    }

    async function setGlobalSetting(key: string, value: string, category: string): Promise<void> {
        const existing = await db('settings')
            .where({ key })
            .whereNull('tenant_id')
            .first();

        const encryptedValue = encrypt(value);
        if (existing) {
            await db('settings')
                .where({ id: existing.id })
                .update({
                    value_encrypted: encryptedValue,
                    category,
                    tenant_id: null,
                });
            return;
        }

        await db('settings').insert({
            key,
            value_encrypted: encryptedValue,
            category,
            tenant_id: null,
        });
    }

    async function getStorageBindingConfig(externalDirectories: ExternalDirectory[]): Promise<StorageBindingConfig> {
        const setting = await db('settings')
            .where({ key: STORAGE_BINDING_SETTING_KEY })
            .whereNull('tenant_id')
            .first();

        if (!setting?.value_encrypted) {
            return { mode: 'local', externalDirectoryId: null };
        }

        try {
            const rawValue = decrypt(String(setting.value_encrypted));
            const parsed = JSON.parse(rawValue) as { mode?: unknown; externalDirectoryId?: unknown };
            const mode = parsed.mode === 'external' ? 'external' : 'local';
            const externalDirectoryId = typeof parsed.externalDirectoryId === 'string' && parsed.externalDirectoryId.trim()
                ? parsed.externalDirectoryId.trim()
                : null;

            if (mode === 'external' && externalDirectoryId) {
                const exists = externalDirectories.some((entry) => entry.id === externalDirectoryId);
                if (exists) {
                    return { mode, externalDirectoryId };
                }
            }
        } catch {
            // Ungueltige Alt-Konfiguration -> auf lokal zurueckfallen.
        }

        return { mode: 'local', externalDirectoryId: null };
    }

    function sanitizeRelativePath(rawPath: unknown): string {
        if (typeof rawPath !== 'string') return '';
        const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
        if (!normalized) return '';

        const parts = normalized.split('/').filter(Boolean);
        if (parts.some((part) => part === '.' || part === '..')) {
            throw new Error('Ungültiger Pfad');
        }
        return parts.join('/');
    }

    function resolvePathInsideRoot(rootPath: string, relativePath: string): string {
        const resolved = path.resolve(rootPath, relativePath);
        const rootWithSep = `${rootPath}${path.sep}`;
        if (resolved !== rootPath && !resolved.startsWith(rootWithSep)) {
            throw new Error('Ungültiger Pfad');
        }
        return resolved;
    }

    async function resolveExplorerRoot(scope: string, externalId: string | null): Promise<{ scope: 'local' | 'external'; id: string | null; name: string; rootPath: string }> {
        if (scope === 'local') {
            return {
                scope: 'local',
                id: null,
                name: 'Lokaler Dokumentenspeicher',
                rootPath: path.resolve(config.app.uploadsDir, 'documents'),
            };
        }

        if (scope !== 'external') {
            throw new Error('Ungültiger Scope');
        }

        if (!externalId) {
            throw new Error('Externe Verzeichnis-ID fehlt');
        }

        const externalDirectories = await getExternalDirectoriesFromSettings();
        const external = externalDirectories.find((entry) => entry.id === externalId);
        if (!external) {
            throw new Error('Externes Verzeichnis nicht gefunden');
        }

        return {
            scope: 'external',
            id: external.id,
            name: external.name,
            rootPath: external.path,
        };
    }

    function getMimeTypeByExtension(fileName: string): string {
        const ext = path.extname(fileName).toLowerCase();
        if (ext === '.pdf') return 'application/pdf';
        if (ext === '.png') return 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
        if (ext === '.webp') return 'image/webp';
        if (ext === '.gif') return 'image/gif';
        if (ext === '.svg') return 'image/svg+xml';
        if (ext === '.txt') return 'text/plain; charset=utf-8';
        if (ext === '.md') return 'text/markdown; charset=utf-8';
        if (ext === '.csv') return 'text/csv; charset=utf-8';
        if (ext === '.json') return 'application/json; charset=utf-8';
        if (ext === '.xml') return 'application/xml; charset=utf-8';
        if (ext === '.html') return 'text/html; charset=utf-8';
        if (ext === '.log') return 'text/plain; charset=utf-8';
        return 'application/octet-stream';
    }

    function getPreviewKind(mimeType: string): 'pdf' | 'image' | 'text' | 'none' {
        if (mimeType === 'application/pdf') return 'pdf';
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml')) return 'text';
        return 'none';
    }

    async function getDirectoryStatus(directoryPath: string): Promise<{ exists: boolean; readable: boolean }> {
        try {
            const stats = await fs.stat(directoryPath);
            return { exists: stats.isDirectory(), readable: stats.isDirectory() };
        } catch {
            return { exists: false, readable: false };
        }
    }

    function normalizeIdList(value: unknown): number[] {
        if (!Array.isArray(value)) return [];
        return Array.from(new Set(
            value
                .map((entry) => Number(entry))
                .filter((entry) => Number.isInteger(entry) && entry > 0)
        ));
    }

    async function validatePermissionIds(permissionIds: number[]): Promise<boolean> {
        if (permissionIds.length === 0) return true;
        const rows = await db('permissions').whereIn('id', permissionIds).select('id');
        const existingIds = new Set(rows.map((row: any) => Number(row.id)));
        return permissionIds.every((id) => existingIds.has(id));
    }

    async function hasEmailHashColumn(): Promise<boolean> {
        if (hasUserEmailHashColumn === null) {
            hasUserEmailHashColumn = await db.schema.hasColumn('users', 'email_hash');
        }
        return hasUserEmailHashColumn;
    }

    async function findOtherUserByEmail(email: string, excludeUserId?: number): Promise<{ id: number } | null> {
        if (await hasEmailHashColumn()) {
            const query = db('users')
                .where('email_hash', hashEmail(email))
                .select('id')
                .first();

            if (excludeUserId && Number.isInteger(excludeUserId) && excludeUserId > 0) {
                query.whereNot('id', excludeUserId);
            }

            const user = await query;
            if (!user) return null;
            return { id: Number(user.id) };
        }

        const users = await db('users').select('id', 'email');
        const lookup = email.trim().toLowerCase();
        for (const user of users) {
            if (excludeUserId && Number(user.id) === excludeUserId) continue;
            const decrypted = decryptUserSensitiveFields(user);
            const candidate = String(decrypted.email || '').trim().toLowerCase();
            if (candidate && candidate === lookup) {
                return { id: Number(user.id) };
            }
        }
        return null;
    }

    // =============================================
    // BENUTZER-VERWALTUNG
    // =============================================

    // GET /api/admin/users
    fastify.get('/users', { preHandler: [requirePermission('users.view')] }, async (_request, reply) => {
        const users = await db('users')
            .select(
                'users.id',
                'users.username',
                'users.display_name',
                'users.first_name',
                'users.last_name',
                'users.email',
                'users.is_active',
                'users.mfa_enabled',
                'users.created_at'
            )
            .orderBy('users.username', 'asc');

        // Rollen pro User laden
        const result = await Promise.all(users.map(async (user: any) => {
            const decryptedUser = decryptUserSensitiveFields(user);
            const roles = await db('user_roles')
                .join('roles', 'user_roles.role_id', 'roles.id')
                .where('user_roles.user_id', user.id)
                .select('roles.id', 'roles.name');
            const extraPermissions = await db('user_permissions')
                .join('permissions', 'user_permissions.permission_id', 'permissions.id')
                .where('user_permissions.user_id', user.id)
                .select('permissions.id', 'permissions.key', 'permissions.label', 'permissions.plugin_id')
                .orderBy('permissions.key', 'asc');
            const tenantIds = await db('user_tenants')
                .where('user_id', user.id)
                .pluck('tenant_id');
            return {
                ...decryptedUser,
                roles,
                tenantIds: tenantIds.map((id: any) => Number(id)),
                extraPermissionIds: extraPermissions.map((perm: any) => Number(perm.id)),
                extraPermissions,
            };
        }));

        return reply.send(result);
    });

    // POST /api/admin/users
    fastify.post('/users', { preHandler: [requirePermission('users.create')] }, async (request, reply) => {
        const { username, displayName, firstName, lastName, email, password, roleIds, tenantIds, additionalPermissionIds } = request.body as {
            username: string;
            displayName?: string;
            firstName?: string;
            lastName?: string;
            email: string;
            password: string;
            roleIds: number[];
            tenantIds?: number[];
            additionalPermissionIds?: number[];
        };

        if (!username || !email || !password) {
            return reply.status(400).send({ error: 'Alle Felder sind pflicht' });
        }
        const pwCheck = validatePasswordStrength(password);
        if (!pwCheck.valid) {
            return reply.status(422).send({ error: pwCheck.error });
        }
        if (await findOtherUserByEmail(email)) {
            return reply.status(409).send({ error: 'E-Mail ist bereits vergeben' });
        }

        const assignTenantIds = normalizeIdList(tenantIds || []);
        if (assignTenantIds.length === 0) {
            return reply.status(400).send({ error: 'Mindestens ein Mandant muss zugewiesen sein' });
        }
        const extraPermissionIds = normalizeIdList(additionalPermissionIds || []);
        if (!(await validatePermissionIds(extraPermissionIds))) {
            return reply.status(400).send({ error: 'Ungültige zusätzliche Berechtigungen' });
        }

        const passwordHash = await hashPassword(password);
        const encryptedProfile = encryptUserSensitiveFields({ email, displayName, firstName, lastName });
        const userInsert: Record<string, any> = {
            username,
            display_name: encryptedProfile.displayName || null,
            first_name: encryptedProfile.firstName || null,
            last_name: encryptedProfile.lastName || null,
            email: encryptedProfile.email,
            password_hash: passwordHash,
            is_active: true,
            mfa_enabled: false,
            default_tenant_id: assignTenantIds[0],
            created_at: new Date(),
        };
        if (await hasEmailHashColumn()) {
            userInsert.email_hash = encryptedProfile.emailHash;
        }
        const [userId] = await db('users').insert(userInsert);

        for (const tId of assignTenantIds) {
            await db('user_tenants').insert({
                user_id: userId,
                tenant_id: tId,
                created_at: new Date(),
            });
        }

        // Rollen zuweisen
        if (roleIds && roleIds.length > 0) {
            for (const roleId of roleIds) {
                await db('user_roles').insert({ user_id: userId, role_id: roleId });
            }
        }
        if (extraPermissionIds.length > 0) {
            for (const permissionId of extraPermissionIds) {
                await db('user_permissions').insert({
                    user_id: userId,
                    permission_id: permissionId,
                    created_at: new Date(),
                });
            }
        }

        await fastify.audit.log({
            action: 'admin.user.created',
            category: 'admin',
            entityType: 'users',
            entityId: userId,
            newState: { username, displayName, firstName, lastName, email, roleIds, tenantIds: assignTenantIds, additionalPermissionIds: extraPermissionIds },
        }, request);

        await fastify.events.emit({ event: 'user.created', data: { userId, username, email }, request });

        return reply.status(201).send({ id: userId, username, email });
    });

    // PUT /api/admin/users/:id
    fastify.put('/users/:id', { preHandler: [requirePermission('users.edit')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const { username, displayName, firstName, lastName, email, password, isActive, roleIds, tenantIds, additionalPermissionIds } = request.body as {
            username?: string;
            displayName?: string;
            firstName?: string;
            lastName?: string;
            email?: string;
            password?: string;
            isActive?: boolean;
            roleIds?: number[];
            tenantIds?: number[];
            additionalPermissionIds?: number[];
        };

        const user = await db('users').where('id', id).first();
        if (!user) return reply.status(404).send({ error: 'Benutzer nicht gefunden' });

        const previousState = { ...user };
        const updates: any = {};

        if (username !== undefined) updates.username = username;
        if (displayName !== undefined) {
            updates.display_name = encryptUserSensitiveFields({ displayName }).displayName || null;
        }
        if (firstName !== undefined) {
            updates.first_name = encryptUserSensitiveFields({ firstName }).firstName || null;
        }
        if (lastName !== undefined) {
            updates.last_name = encryptUserSensitiveFields({ lastName }).lastName || null;
        }
        if (email !== undefined) {
            const conflict = await findOtherUserByEmail(email, Number(id));
            if (conflict) {
                return reply.status(409).send({ error: 'E-Mail ist bereits vergeben' });
            }
            const encryptedEmail = encryptUserSensitiveFields({ email });
            updates.email = encryptedEmail.email;
            if (await hasEmailHashColumn()) {
                updates.email_hash = encryptedEmail.emailHash;
            }
        }
        if (password) {
            const pwCheck = validatePasswordStrength(password);
            if (!pwCheck.valid) {
                return reply.status(422).send({ error: pwCheck.error });
            }
            updates.password_hash = await hashPassword(password);
        }
        if (isActive !== undefined) updates.is_active = isActive;

        if (Object.keys(updates).length > 0) {
            await db('users').where('id', id).update(updates);
        }

        // Rollen aktualisieren
        if (roleIds !== undefined) {
            await db('user_roles').where('user_id', id).delete();
            for (const roleId of roleIds) {
                await db('user_roles').insert({ user_id: Number(id), role_id: roleId });
            }
        }

        if (tenantIds !== undefined) {
            const dedupTenantIds = normalizeIdList(tenantIds);
            if (dedupTenantIds.length === 0) {
                return reply.status(400).send({ error: 'Mindestens ein Mandant muss zugewiesen sein' });
            }
            await db('user_tenants').where('user_id', id).delete();
            for (const tId of dedupTenantIds) {
                await db('user_tenants').insert({
                    user_id: Number(id),
                    tenant_id: tId,
                    created_at: new Date(),
                });
            }

            const currentDefault = await db('users').where('id', id).first('default_tenant_id');
            if (!currentDefault?.default_tenant_id || !dedupTenantIds.includes(Number(currentDefault.default_tenant_id))) {
                await db('users').where('id', id).update({ default_tenant_id: dedupTenantIds[0] || null });
            }
        }

        if (additionalPermissionIds !== undefined) {
            const dedupPermissionIds = normalizeIdList(additionalPermissionIds);
            if (!(await validatePermissionIds(dedupPermissionIds))) {
                return reply.status(400).send({ error: 'Ungültige zusätzliche Berechtigungen' });
            }

            await db('user_permissions').where('user_id', id).delete();
            for (const permissionId of dedupPermissionIds) {
                await db('user_permissions').insert({
                    user_id: Number(id),
                    permission_id: permissionId,
                    created_at: new Date(),
                });
            }
        }

        const newUser = await db('users').where('id', id).first();

        await fastify.audit.log({
            action: 'admin.user.updated',
            category: 'admin',
            entityType: 'users',
            entityId: id,
            previousState: decryptUserSensitiveFields(previousState),
            newState: newUser ? decryptUserSensitiveFields(newUser) : null,
        }, request);

        await fastify.events.emit({ event: 'user.updated', data: { userId: Number(id), username: newUser?.username }, request });

        return reply.send({ success: true });
    });

    // DELETE /api/admin/users/:id
    fastify.delete('/users/:id', { preHandler: [requirePermission('users.delete')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const user = await db('users').where('id', id).first();
        if (!user) return reply.status(404).send({ error: 'Benutzer nicht gefunden' });

        await db('users').where('id', id).delete();

        await fastify.audit.log({
            action: 'admin.user.deleted',
            category: 'admin',
            entityType: 'users',
            entityId: id,
            previousState: decryptUserSensitiveFields(user),
        }, request);

        await fastify.events.emit({ event: 'user.deleted', data: { userId: Number(id), username: user.username }, request });

        return reply.send({ success: true });
    });

    // POST /api/admin/users/:id/reset-mfa
    fastify.post('/users/:id/reset-mfa', { preHandler: [requirePermission('users.edit')] }, async (request, reply) => {
        const { id } = request.params as { id: string };

        await db('users').where('id', id).update({
            mfa_enabled: false,
            mfa_secret_encrypted: null,
            recovery_codes_encrypted: null,
        });

        await fastify.audit.log({
            action: 'admin.user.mfa_reset',
            category: 'admin',
            entityType: 'users',
            entityId: id,
        }, request);

        return reply.send({ success: true });
    });

    // =============================================
    // ROLLEN-VERWALTUNG
    // =============================================

    // GET /api/admin/roles
    fastify.get('/roles', { preHandler: [requirePermission('roles.view')] }, async (request, reply) => {
        const roles = await db('roles').select('*').orderBy('name', 'asc');
        const allPermissions = await db('permissions')
            .select('permissions.id', 'permissions.key', 'permissions.label', 'permissions.plugin_id')
            .orderBy('permissions.key', 'asc');

        const result = await Promise.all(roles.map(async (role: any) => {
            const isSuperAdmin = role.name === 'Super-Admin';
            const permissions = isSuperAdmin
                ? allPermissions
                : await db('role_permissions')
                    .join('permissions', 'role_permissions.permission_id', 'permissions.id')
                    .where('role_permissions.role_id', role.id)
                    .select('permissions.id', 'permissions.key', 'permissions.label', 'permissions.plugin_id')
                    .orderBy('permissions.key', 'asc');
            return { ...role, is_super_admin: isSuperAdmin, permissions };
        }));

        return reply.send(result);
    });

    // POST /api/admin/roles
    fastify.post('/roles', { preHandler: [requirePermission('roles.create')] }, async (request, reply) => {
        const { name, description, permissionIds } = request.body as {
            name: string;
            description?: string;
            permissionIds: number[];
        };
        const normalizedName = name?.trim();
        if (!normalizedName) {
            return reply.status(400).send({ error: 'Rollenname ist erforderlich' });
        }
        const normalizedPermissionIds = normalizeIdList(permissionIds || []);
        if (!(await validatePermissionIds(normalizedPermissionIds))) {
            return reply.status(400).send({ error: 'Ungültige Berechtigungen' });
        }
        const existing = await db('roles').where('name', normalizedName).first('id');
        if (existing) {
            return reply.status(409).send({ error: 'Rollenname existiert bereits' });
        }

        const [roleId] = await db('roles').insert({
            name: normalizedName,
            description: description || null,
            is_system: false,
            created_at: new Date(),
        });

        for (const permId of normalizedPermissionIds) {
            await db('role_permissions').insert({ role_id: roleId, permission_id: permId });
        }

        await fastify.audit.log({
            action: 'admin.role.created',
            category: 'admin',
            entityType: 'roles',
            entityId: roleId,
            newState: { name: normalizedName, description, permissionIds: normalizedPermissionIds },
        }, request);

        return reply.status(201).send({ id: roleId, name: normalizedName });
    });

    // PUT /api/admin/roles/:id
    fastify.put('/roles/:id', { preHandler: [requirePermission('roles.edit')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const { name, description, permissionIds } = request.body as {
            name?: string;
            description?: string;
            permissionIds?: number[];
        };

        const role = await db('roles').where('id', id).first();
        if (!role) return reply.status(404).send({ error: 'Rolle nicht gefunden' });
        if (role.name === 'Super-Admin') return reply.status(403).send({ error: 'Super-Admin kann nicht bearbeitet werden' });

        const previousState = { ...role };
        const updates: any = {};
        if (name !== undefined) {
            const normalizedName = name.trim();
            if (!normalizedName) {
                return reply.status(400).send({ error: 'Rollenname ist erforderlich' });
            }
            if (normalizedName !== role.name) {
                const existing = await db('roles').where('name', normalizedName).whereNot('id', id).first('id');
                if (existing) {
                    return reply.status(409).send({ error: 'Rollenname existiert bereits' });
                }
            }
            updates.name = normalizedName;
        }
        if (description !== undefined) updates.description = description;

        if (Object.keys(updates).length > 0) {
            await db('roles').where('id', id).update(updates);
        }

        if (permissionIds !== undefined) {
            const normalizedPermissionIds = normalizeIdList(permissionIds);
            if (!(await validatePermissionIds(normalizedPermissionIds))) {
                return reply.status(400).send({ error: 'Ungültige Berechtigungen' });
            }
            await db('role_permissions').where('role_id', id).delete();
            for (const permId of normalizedPermissionIds) {
                await db('role_permissions').insert({ role_id: Number(id), permission_id: permId });
            }
        }

        const newRole = await db('roles').where('id', id).first();

        await fastify.audit.log({
            action: 'admin.role.updated',
            category: 'admin',
            entityType: 'roles',
            entityId: id,
            previousState,
            newState: newRole,
        }, request);

        return reply.send({ success: true });
    });

    // DELETE /api/admin/roles/:id
    fastify.delete('/roles/:id', { preHandler: [requirePermission('roles.delete')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const role = await db('roles').where('id', id).first();
        if (!role) return reply.status(404).send({ error: 'Rolle nicht gefunden' });
        if (role.name === 'Super-Admin') return reply.status(403).send({ error: 'Super-Admin kann nicht gelöscht werden' });
        if (role.is_system) return reply.status(403).send({ error: 'Systemrollen koennen nicht geloescht werden' });

        await db('roles').where('id', id).delete();

        await fastify.audit.log({
            action: 'admin.role.deleted',
            category: 'admin',
            entityType: 'roles',
            entityId: id,
            previousState: role,
        }, request);

        return reply.send({ success: true });
    });

    // GET /api/admin/permissions -- alle verfuegbaren Permissions
    fastify.get('/permissions', { preHandler: [requirePermission('roles.view')] }, async (request, reply) => {
        const permissions = await db('permissions').select('*').orderBy('key');
        return reply.send(permissions);
    });

    // =============================================
    // MANDANTEN
    // =============================================

    // GET /api/admin/tenants
    fastify.get('/tenants', { preHandler: [requirePermission('tenants.manage')] }, async (_request, reply) => {
        const tenants = await db('tenants').select('*').orderBy('name', 'asc');
        return reply.send(tenants);
    });

    // POST /api/admin/tenants
    fastify.post('/tenants', { preHandler: [requirePermission('tenants.manage')] }, async (request, reply) => {
        const { name, slug, isActive = true } = request.body as { name: string; slug?: string; isActive?: boolean };
        if (!name) {
            return reply.status(400).send({ error: 'Name ist erforderlich' });
        }

        const normalizedSlug = (slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')).slice(0, 120);
        if (!normalizedSlug) {
            return reply.status(400).send({ error: 'Slug ist ungueltig' });
        }

        const exists = await db('tenants').where('slug', normalizedSlug).first();
        if (exists) {
            return reply.status(409).send({ error: 'Mandanten-Slug existiert bereits' });
        }

        const [tenantId] = await db('tenants').insert({
            name,
            slug: normalizedSlug,
            is_active: !!isActive,
            created_at: new Date(),
        });

        await fastify.audit.log({
            action: 'admin.tenant.created',
            category: 'admin',
            entityType: 'tenant',
            entityId: tenantId,
            newState: { name, slug: normalizedSlug, isActive: !!isActive },
        }, request);

        return reply.status(201).send({ id: tenantId, name, slug: normalizedSlug, is_active: !!isActive });
    });

    // PUT /api/admin/tenants/:id
    fastify.put('/tenants/:id', { preHandler: [requirePermission('tenants.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const { name, slug, isActive } = request.body as { name?: string; slug?: string; isActive?: boolean };

        const tenant = await db('tenants').where('id', id).first();
        if (!tenant) return reply.status(404).send({ error: 'Mandant nicht gefunden' });

        const updates: any = {};
        if (name !== undefined) updates.name = name;
        if (slug !== undefined) updates.slug = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 120);
        if (isActive !== undefined) updates.is_active = !!isActive;

        if (updates.slug) {
            const slugExists = await db('tenants').where('slug', updates.slug).whereNot('id', id).first();
            if (slugExists) {
                return reply.status(409).send({ error: 'Mandanten-Slug existiert bereits' });
            }
        }

        if (Object.keys(updates).length > 0) {
            await db('tenants').where('id', id).update(updates);
        }

        const updated = await db('tenants').where('id', id).first();
        await fastify.audit.log({
            action: 'admin.tenant.updated',
            category: 'admin',
            entityType: 'tenant',
            entityId: id,
            previousState: tenant,
            newState: updated,
        }, request);

        return reply.send(updated);
    });

    // POST /api/admin/tenants/:id/logo
    fastify.post('/tenants/:id/logo', { preHandler: [requirePermission('tenants.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const tenantId = Number(id);
        if (!Number.isInteger(tenantId) || tenantId <= 0) {
            return reply.status(400).send({ error: 'Ungültige Mandanten-ID' });
        }

        const tenant = await db('tenants').where('id', tenantId).first();
        if (!tenant) {
            return reply.status(404).send({ error: 'Mandant nicht gefunden' });
        }

        const file = await (request as any).file();
        if (!file) {
            return reply.status(400).send({ error: 'Datei ist erforderlich' });
        }

        const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
        if (!allowed.has(file.mimetype)) {
            return reply.status(400).send({ error: 'Nur JPG, PNG, WEBP oder GIF erlaubt' });
        }

        const ext = file.mimetype === 'image/png'
            ? '.png'
            : file.mimetype === 'image/webp'
                ? '.webp'
                : file.mimetype === 'image/gif'
                    ? '.gif'
                    : '.jpg';

        const buffer = await file.toBuffer();
        if (!buffer.length) {
            return reply.status(400).send({ error: 'Leere Datei' });
        }
        if (buffer.length > 5 * 1024 * 1024) {
            return reply.status(413).send({ error: 'Logo darf maximal 5 MB groß sein' });
        }

        await fs.mkdir(tenantLogoDir, { recursive: true });
        const fileName = `tenant-${tenantId}-${Date.now()}${ext}`;
        const filePath = path.join(tenantLogoDir, fileName);
        await fs.writeFile(filePath, buffer);

        if (tenant.logo_file) {
            const oldPath = path.join(tenantLogoDir, String(tenant.logo_file));
            await fs.rm(oldPath, { force: true });
        }

        const logoUpdatedAt = new Date();
        await db('tenants').where('id', tenantId).update({
            logo_file: fileName,
            logo_updated_at: logoUpdatedAt,
        });

        await fastify.audit.log({
            action: 'admin.tenant.logo.updated',
            category: 'admin',
            entityType: 'tenant',
            entityId: tenantId,
            previousState: { logoFile: tenant.logo_file || null },
            newState: { logoFile: fileName },
        }, request);

        return reply.send({
            success: true,
            logoUrl: `/api/auth/tenant-logo/${tenantId}`,
            logoUpdatedAt: logoUpdatedAt.toISOString(),
        });
    });

    // GET /api/admin/tenants/:id/users
    fastify.get('/tenants/:id/users', { preHandler: [requirePermission('tenants.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const tenant = await db('tenants').where('id', id).first();
        if (!tenant) return reply.status(404).send({ error: 'Mandant nicht gefunden' });

        const users = await db('user_tenants')
            .join('users', 'user_tenants.user_id', 'users.id')
            .where('user_tenants.tenant_id', Number(id))
            .select(
                'users.id',
                'users.username',
                'users.display_name',
                'users.first_name',
                'users.last_name',
                'users.email',
                'users.is_active'
            )
            .orderBy('users.username', 'asc');

        return reply.send(users.map((user: any) => decryptUserSensitiveFields(user)));
    });

    // DELETE /api/admin/tenants/:id
    fastify.delete('/tenants/:id', { preHandler: [requirePermission('tenants.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const tenantId = Number(id);
        const tenant = await db('tenants').where('id', tenantId).first();
        if (!tenant) return reply.status(404).send({ error: 'Mandant nicht gefunden' });
        if (tenant.slug === 'default') {
            return reply.status(400).send({ error: 'Der Standard-Mandant kann nicht gelöscht werden' });
        }

        const tenantUsers = await db('user_tenants')
            .join('users', 'user_tenants.user_id', 'users.id')
            .where('user_tenants.tenant_id', tenantId)
            .select('users.id', 'users.username');

        const userIds = tenantUsers.map((u: any) => Number(u.id));
        if (userIds.length > 0) {
            const assignmentCounts = await db('user_tenants')
                .whereIn('user_id', userIds)
                .select('user_id')
                .count<{ user_id: number; total: string }[]>('* as total')
                .groupBy('user_id');

            const countMap = new Map<number, number>(
                assignmentCounts.map((row: any) => [Number(row.user_id), Number(row.total)])
            );

            const blockedUsers = tenantUsers
                .filter((u: any) => (countMap.get(Number(u.id)) || 0) <= 1)
                .map((u: any) => u.username);

            if (blockedUsers.length > 0) {
                return reply.status(409).send({
                    error: 'Mandant kann nicht gelöscht werden, da manche Benutzer nur diesem Mandanten zugeordnet sind',
                    blockedUsers,
                });
            }
        }

        const fallbackByUser = new Map<number, number>();
        for (const userId of userIds) {
            const fallback = await db('user_tenants')
                .where('user_id', userId)
                .whereNot('tenant_id', tenantId)
                .first('tenant_id');
            if (fallback?.tenant_id) {
                fallbackByUser.set(userId, Number(fallback.tenant_id));
            }
        }

        await db.transaction(async (trx) => {
            for (const [userId, fallbackTenantId] of fallbackByUser.entries()) {
                await trx('users')
                    .where('id', userId)
                    .andWhere('default_tenant_id', tenantId)
                    .update({ default_tenant_id: fallbackTenantId });
            }

            await trx('user_tenants').where('tenant_id', tenantId).delete();
            await trx('tenants').where('id', tenantId).delete();
        });

        if (tenant.logo_file) {
            const oldPath = path.join(tenantLogoDir, String(tenant.logo_file));
            await fs.rm(oldPath, { force: true });
        }

        await fastify.audit.log({
            action: 'admin.tenant.deleted',
            category: 'admin',
            entityType: 'tenant',
            entityId: tenantId,
            previousState: tenant,
        }, request);

        return reply.send({ success: true });
    });

    // =============================================
    // EINSTELLUNGEN
    // =============================================

    // GET /api/admin/settings
    fastify.get('/settings', { preHandler: [requirePermission('settings.manage')] }, async (_request, reply) => {
        const settings = await db('settings').whereNull('tenant_id').select('*');
        return reply.send(settings);
    });

    // PUT /api/admin/settings
    fastify.put('/settings', { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
        const { key, value, category } = request.body as { key: string; value: string; category?: string };
        if (!key) {
            return reply.status(400).send({ error: 'Schluessel ist erforderlich' });
        }
        if (typeof value !== 'string') {
            return reply.status(400).send({ error: 'Wert ist erforderlich' });
        }

        let existing = await db('settings').where({ key }).whereNull('tenant_id').first();
        if (!existing) {
            existing = await db('settings').where({ key }).first();
        }
        const previousState = existing || null;
        const encryptedValue = encrypt(value);

        if (existing) {
            await db('settings').where({ id: existing.id }).update({
                value_encrypted: encryptedValue,
                category: category || existing.category || 'general',
                tenant_id: null,
            });
        } else {
            await db('settings').insert({ key, value_encrypted: encryptedValue, category: category || 'general', tenant_id: null });
        }

        await fastify.audit.log({
            action: 'admin.settings.updated',
            category: 'admin',
            entityType: 'settings',
            entityId: key,
            previousState,
            newState: { key, value: '***', category },
        }, request);

        return reply.send({ success: true });
    });

    // GET /api/admin/settings/accounting-connector
    fastify.get('/settings/accounting-connector', { preHandler: [requirePermission('settings.manage')] }, async (_request, reply) => {
        const connector = await loadAccountingConnectorSettings(db);
        return reply.send({
            enabled: connector.enabled,
            apiKeyHeaderName: connector.apiKeyHeaderName,
            apiKey: connector.apiKey,
            hmacSecret: connector.hmacSecret,
            timestampToleranceSec: connector.timestampToleranceSec,
            nonceTtlSec: connector.nonceTtlSec,
            maxPayloadBytes: connector.maxPayloadBytes,
            publicBaseUrl: connector.publicBaseUrl,
            allowedEventTypes: connector.allowedEventTypes,
            endpointPath: '/api/accounting/events',
            endpointUrl: buildAccountingConnectorEndpointUrl(connector.publicBaseUrl),
            hasApiKey: Boolean(connector.apiKey),
            hasHmacSecret: Boolean(connector.hmacSecret),
        });
    });

    // PUT /api/admin/settings/accounting-connector
    fastify.put('/settings/accounting-connector', { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
        const payload = (request.body || {}) as Record<string, unknown>;

        const enabled = payload.enabled === undefined ? true : Boolean(payload.enabled);
        const apiKeyHeaderName = String(payload.apiKeyHeaderName || '').trim() || 'X-API-Key';
        const apiKey = String(payload.apiKey || '').trim();
        const hmacSecret = String(payload.hmacSecret || '').trim();
        const timestampToleranceSec = Number.parseInt(String(payload.timestampToleranceSec ?? ''), 10);
        const nonceTtlSec = Number.parseInt(String(payload.nonceTtlSec ?? ''), 10);
        const maxPayloadBytes = Number.parseInt(String(payload.maxPayloadBytes ?? ''), 10);
        const publicBaseUrl = String(payload.publicBaseUrl || '').trim();
        const allowedEventTypesRaw = Array.isArray(payload.allowedEventTypes)
            ? payload.allowedEventTypes.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
            : String(payload.allowedEventTypes || '')
                .split(',')
                .map((v) => v.trim().toLowerCase())
                .filter(Boolean);
        const allowedEventTypes = Array.from(new Set(allowedEventTypesRaw));

        if (!/^[A-Za-z0-9-]{1,100}$/.test(apiKeyHeaderName)) {
            return reply.status(400).send({ error: 'API-Key Header Name ist ungültig' });
        }
        if (!Number.isFinite(timestampToleranceSec) || timestampToleranceSec < 30 || timestampToleranceSec > 3600) {
            return reply.status(400).send({ error: 'Timestamp-Fenster muss zwischen 30 und 3600 Sekunden liegen' });
        }
        if (!Number.isFinite(nonceTtlSec) || nonceTtlSec < 30 || nonceTtlSec > 3600) {
            return reply.status(400).send({ error: 'Nonce-TTL muss zwischen 30 und 3600 Sekunden liegen' });
        }
        if (!Number.isFinite(maxPayloadBytes) || maxPayloadBytes < 1024 || maxPayloadBytes > 10 * 1024 * 1024) {
            return reply.status(400).send({ error: 'Max Payload muss zwischen 1024 und 10485760 Bytes liegen' });
        }
        if (enabled && (!apiKey || !hmacSecret)) {
            return reply.status(400).send({ error: 'API-Key und Signatur-Secret sind erforderlich, wenn der Connector aktiv ist' });
        }
        if (publicBaseUrl) {
            try {
                const parsed = new URL(publicBaseUrl);
                if (parsed.protocol !== 'https:') {
                    return reply.status(400).send({ error: 'Connector Base URL muss mit https:// beginnen' });
                }
            } catch {
                return reply.status(400).send({ error: 'Connector Base URL ist ungültig' });
            }
        }

        await setGlobalSetting(ACCOUNTING_CONNECTOR_SETTING_KEYS.enabled, enabled ? 'true' : 'false', 'integrations');
        await setGlobalSetting(ACCOUNTING_CONNECTOR_SETTING_KEYS.apiKeyHeaderName, apiKeyHeaderName, 'integrations');
        await setGlobalSetting(ACCOUNTING_CONNECTOR_SETTING_KEYS.apiKey, apiKey, 'integrations');
        await setGlobalSetting(ACCOUNTING_CONNECTOR_SETTING_KEYS.hmacSecret, hmacSecret, 'integrations');
        await setGlobalSetting(ACCOUNTING_CONNECTOR_SETTING_KEYS.timestampToleranceSec, String(timestampToleranceSec), 'integrations');
        await setGlobalSetting(ACCOUNTING_CONNECTOR_SETTING_KEYS.nonceTtlSec, String(nonceTtlSec), 'integrations');
        await setGlobalSetting(ACCOUNTING_CONNECTOR_SETTING_KEYS.maxPayloadBytes, String(maxPayloadBytes), 'integrations');
        await setGlobalSetting(ACCOUNTING_CONNECTOR_SETTING_KEYS.publicBaseUrl, publicBaseUrl, 'integrations');
        await setGlobalSetting(ACCOUNTING_CONNECTOR_SETTING_KEYS.allowedEventTypes, allowedEventTypes.join(','), 'integrations');

        await fastify.audit.log({
            action: 'admin.settings.accounting_connector.updated',
            category: 'admin',
            entityType: 'settings',
            entityId: 'accounting.connector',
            newState: {
                enabled,
                apiKeyHeaderName,
                hasApiKey: Boolean(apiKey),
                hasHmacSecret: Boolean(hmacSecret),
                timestampToleranceSec,
                nonceTtlSec,
                maxPayloadBytes,
                publicBaseUrl,
                allowedEventTypes,
            },
        }, request);

        const connector = await loadAccountingConnectorSettings(db);
        return reply.send({
            success: true,
            endpointPath: '/api/accounting/events',
            endpointUrl: buildAccountingConnectorEndpointUrl(connector.publicBaseUrl),
        });
    });

    // POST /api/admin/settings/accounting-connector/test
    fastify.post('/settings/accounting-connector/test', { preHandler: [requirePermission('settings.manage')] }, async (_request, reply) => {
        const connector = await loadAccountingConnectorSettings(db);
        if (!connector.enabled) {
            return reply.status(400).send({ ok: false, error: 'Connector ist deaktiviert' });
        }
        if (!connector.apiKey || !connector.hmacSecret) {
            return reply.status(400).send({ ok: false, error: 'API-Key oder Signatur-Secret fehlen' });
        }

        const eventId = `evt_test_${Date.now()}`;
        const timestamp = new Date().toISOString();
        const nonce = `nonce_${Date.now()}_${Math.round(Math.random() * 100000)}`;
        const payload = {
            event_id: eventId,
            event_type: 'customer.updated',
            occurred_at: timestamp,
            instance: { name: 'hammer-core-selftest' },
            document_category: 'customer',
            entity_id: 'TEST-CUSTOMER-1',
            customer: { id: 0, customer_number: 'TEST', name: 'Connector Testkunde', kind: 'firma' },
        };
        const raw = JSON.stringify(payload);
        const bodySha = createHash('sha256').update(raw, 'utf8').digest('hex');
        const signature = createHmac('sha256', connector.hmacSecret)
            .update(`${timestamp}.${nonce}.${bodySha}`, 'utf8')
            .digest('hex');

        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'x-hammer-api-key': connector.apiKey,
            'x-hammer-event-id': eventId,
            'x-hammer-timestamp': timestamp,
            'x-hammer-nonce': nonce,
            'x-hammer-body-sha256': bodySha,
            'x-hammer-signature-alg': 'hmac-sha256',
            'x-hammer-signature': `v1=${signature}`,
        };
        headers[connector.apiKeyHeaderName.toLowerCase()] = connector.apiKey;

        const testResponse = await fastify.inject({
            method: 'POST',
            url: '/api/accounting/events',
            payload: raw,
            headers,
        });

        let parsed: any = null;
        try {
            parsed = JSON.parse(testResponse.body || '{}');
        } catch {
            parsed = { raw: testResponse.body };
        }

        return reply.send({
            ok: testResponse.statusCode >= 200 && testResponse.statusCode < 300,
            statusCode: testResponse.statusCode,
            response: parsed,
            eventId,
            endpointPath: '/api/accounting/events',
            endpointUrl: buildAccountingConnectorEndpointUrl(connector.publicBaseUrl),
        });
    });

    // POST /api/admin/settings/accounting-connector/external-check
    fastify.post('/settings/accounting-connector/external-check', { preHandler: [requirePermission('settings.manage')] }, async (_request, reply) => {
        const connector = await loadAccountingConnectorSettings(db);
        const lookbackHours = 24;
        const since = new Date(Date.now() - (lookbackHours * 60 * 60 * 1000));

        if (!connector.enabled) {
            return reply.send({
                ok: false,
                reason: 'connector_disabled',
                lookbackHours,
                checkedAt: new Date().toISOString(),
                message: 'Connector ist deaktiviert.',
            });
        }

        if (!connector.apiKey || !connector.hmacSecret) {
            return reply.send({
                ok: false,
                reason: 'connector_not_configured',
                lookbackHours,
                checkedAt: new Date().toISOString(),
                message: 'API-Key oder HMAC-Secret fehlen.',
            });
        }

        const hasEventsTable = await db.schema.hasTable('accounting_connector_events');
        if (!hasEventsTable) {
            return reply.send({
                ok: false,
                reason: 'events_table_missing',
                lookbackHours,
                checkedAt: new Date().toISOString(),
                message: 'Keine Event-Tabelle vorhanden.',
            });
        }

        const baseQuery = db('accounting_connector_events')
            .whereNot('event_id', 'like', 'evt_test_%');

        const recentExternal = await baseQuery
            .clone()
            .where('created_at', '>=', since)
            .select('event_id', 'event_type', 'created_at', 'source_ip')
            .orderBy('id', 'desc')
            .first() as any;

        const latestExternal = recentExternal || await baseQuery
            .clone()
            .select('event_id', 'event_type', 'created_at', 'source_ip')
            .orderBy('id', 'desc')
            .first() as any;

        if (!latestExternal) {
            return reply.send({
                ok: false,
                reason: 'no_external_events_received',
                lookbackHours,
                checkedAt: new Date().toISOString(),
                message: 'Noch kein externes Event empfangen.',
                lastExternalEvent: null,
            });
        }

        if (!recentExternal) {
            return reply.send({
                ok: false,
                reason: 'no_recent_external_events',
                lookbackHours,
                checkedAt: new Date().toISOString(),
                message: 'Es gab externe Events, aber nicht in den letzten 24 Stunden.',
                lastExternalEvent: {
                    eventId: String(latestExternal.event_id || ''),
                    eventType: String(latestExternal.event_type || ''),
                    createdAt: latestExternal.created_at ? new Date(latestExternal.created_at).toISOString() : null,
                    sourceIp: latestExternal.source_ip ? String(latestExternal.source_ip) : null,
                },
            });
        }

        return reply.send({
            ok: true,
            reason: 'external_events_received_recently',
            lookbackHours,
            checkedAt: new Date().toISOString(),
            message: 'Mindestens ein externes Event wurde in den letzten 24 Stunden empfangen.',
            lastExternalEvent: {
                eventId: String(recentExternal.event_id || ''),
                eventType: String(recentExternal.event_type || ''),
                createdAt: recentExternal.created_at ? new Date(recentExternal.created_at).toISOString() : null,
                sourceIp: recentExternal.source_ip ? String(recentExternal.source_ip) : null,
            },
        });
    });

    // GET /api/admin/settings/accounting-connector/events
    fastify.get('/settings/accounting-connector/events', { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
        const query = request.query as { limit?: string };
        const limitRaw = Number.parseInt(String(query?.limit || '25'), 10);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 25;

        const hasEventsTable = await db.schema.hasTable('accounting_connector_events');
        if (!hasEventsTable) {
            return reply.send({
                items: [],
                summary: {
                    total: 0,
                    totalDuplicates: 0,
                    processed24h: 0,
                },
            });
        }

        const rows = await db('accounting_connector_events')
            .select(
                'id',
                'event_id',
                'event_type',
                'status',
                'duplicate_count',
                'source_ip',
                'processed_at',
                'last_seen_at',
                'created_at',
                'payload_json',
            )
            .orderBy('id', 'desc')
            .limit(limit);

        const summaryRow = await db('accounting_connector_events')
            .count('* as total')
            .sum('duplicate_count as totalDuplicates')
            .first() as any;

        const last24h = new Date(Date.now() - (24 * 60 * 60 * 1000));
        const processed24hRow = await db('accounting_connector_events')
            .where('created_at', '>=', last24h)
            .count('* as processed24h')
            .first() as any;

        const items = rows.map((row: any) => {
            let payload: any = null;
            try {
                payload = row.payload_json ? JSON.parse(String(row.payload_json)) : null;
            } catch {
                payload = null;
            }
            return {
                id: Number(row.id),
                eventId: String(row.event_id || ''),
                eventType: String(row.event_type || ''),
                status: String(row.status || 'processed'),
                duplicateCount: Number(row.duplicate_count || 0),
                sourceIp: row.source_ip ? String(row.source_ip) : null,
                createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
                processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : null,
                lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
                documentNumber: payload?.document?.nummer ? String(payload.document.nummer) : null,
                customerName: payload?.customer?.name ? String(payload.customer.name) : null,
            };
        });

        return reply.send({
            items,
            summary: {
                total: Number(summaryRow?.total || 0),
                totalDuplicates: Number(summaryRow?.totalDuplicates || 0),
                processed24h: Number(processed24hRow?.processed24h || 0),
            },
        });
    });

    // DELETE /api/admin/settings/accounting-connector/events
    fastify.delete('/settings/accounting-connector/events', { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
        const body = (request.body || {}) as {
            confirm?: boolean;
            olderThanHours?: number;
            eventType?: string;
            sourceIp?: string;
            status?: 'processed' | 'failed';
        };

        if (body.confirm !== true) {
            return reply.status(400).send({ error: 'Löschen erfordert confirm=true' });
        }

        const hasEventsTable = await db.schema.hasTable('accounting_connector_events');
        if (!hasEventsTable) {
            return reply.send({ deleted: 0 });
        }

        const query = db('accounting_connector_events');
        const appliedFilters: Record<string, any> = {};

        const olderThanHours = Number(body.olderThanHours);
        if (Number.isFinite(olderThanHours) && olderThanHours > 0) {
            const cutoff = new Date(Date.now() - Math.round(olderThanHours * 60 * 60 * 1000));
            query.where('created_at', '<', cutoff);
            appliedFilters.olderThanHours = Math.round(olderThanHours);
        }

        const eventType = String(body.eventType || '').trim().toLowerCase();
        if (eventType) {
            query.where('event_type', eventType);
            appliedFilters.eventType = eventType;
        }

        const sourceIp = String(body.sourceIp || '').trim();
        if (sourceIp) {
            query.where('source_ip', sourceIp);
            appliedFilters.sourceIp = sourceIp;
        }

        const status = String(body.status || '').trim().toLowerCase();
        if (status === 'processed' || status === 'failed') {
            query.where('status', status);
            appliedFilters.status = status;
        }

        const deleted = await query.delete();

        await fastify.audit.log({
            action: 'admin.settings.accounting_connector.events.deleted',
            category: 'admin',
            entityType: 'accounting_connector_events',
            entityId: 'bulk-delete',
            newState: {
                deleted,
                filters: appliedFilters,
            },
            tenantId: null,
        }, request);

        return reply.send({ deleted: Number(deleted || 0), filters: appliedFilters });
    });

    // GET /api/admin/settings/plugin/:pluginId -- Einstellungen eines Plugins (entschlüsselt)
    fastify.get('/settings/plugin/:pluginId', { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
        const { pluginId } = request.params as { pluginId: string };
        if (!pluginId || typeof pluginId !== 'string') {
            return reply.status(400).send({ error: 'pluginId ist erforderlich' });
        }

        const rows = await db('settings')
            .where({ plugin_id: pluginId })
            .whereNull('tenant_id')
            .select('id', 'key', 'value_encrypted', 'category', 'plugin_id');

        const settings: Record<string, string> = {};
        for (const row of rows) {
            try {
                settings[row.key] = row.value_encrypted ? decrypt(String(row.value_encrypted)) : '';
            } catch {
                settings[row.key] = '';
            }
        }

        return reply.send(settings);
    });

    // PUT /api/admin/settings/plugin/:pluginId -- Einstellung fuer ein Plugin speichern
    fastify.put('/settings/plugin/:pluginId', { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
        const { pluginId } = request.params as { pluginId: string };
        if (!pluginId || typeof pluginId !== 'string') {
            return reply.status(400).send({ error: 'pluginId ist erforderlich' });
        }

        const { key, value } = request.body as { key: string; value: string };
        if (!key || typeof key !== 'string') {
            return reply.status(400).send({ error: 'Schluessel ist erforderlich' });
        }
        if (typeof value !== 'string') {
            return reply.status(400).send({ error: 'Wert ist erforderlich' });
        }

        const encryptedValue = encrypt(value);
        const existing = await db('settings')
            .where({ key, plugin_id: pluginId })
            .whereNull('tenant_id')
            .first();

        if (existing) {
            await db('settings').where({ id: existing.id }).update({
                value_encrypted: encryptedValue,
            });
        } else {
            await db('settings').insert({
                key,
                value_encrypted: encryptedValue,
                category: 'plugin',
                plugin_id: pluginId,
                tenant_id: null,
            });
        }

        await fastify.audit.log({
            action: 'admin.settings.plugin.updated',
            category: 'admin',
            entityType: 'settings',
            entityId: `${pluginId}:${key}`,
            newState: { pluginId, key, value: '***' },
        }, request);

        return reply.send({ success: true });
    });

    // =============================================
    // DOKUMENTENVERWALTUNG (STORAGE)
    // =============================================

    // GET /api/admin/documents/storage
    fastify.get('/documents/storage', { preHandler: [requirePermission('documents.manage')] }, async (_request, reply) => {
        const localDocumentsPath = path.resolve(config.app.uploadsDir, 'documents');
        const localStatus = await getDirectoryStatus(localDocumentsPath);
        const externalDirectories = await getExternalDirectoriesFromSettings();
        const binding = await getStorageBindingConfig(externalDirectories);

        const externalWithStatus = await Promise.all(externalDirectories.map(async (entry) => ({
            ...entry,
            ...(await getDirectoryStatus(entry.path)),
        })));

        return reply.send({
            storageProvider: config.documents.storageProvider,
            localDirectory: {
                name: 'Lokaler Dokumentenspeicher',
                path: localDocumentsPath,
                isActive: config.documents.storageProvider === 'local',
                ...localStatus,
            },
            binding,
            externalDirectories: externalWithStatus,
            note: 'Externe Verzeichnisse werden aktuell als vorbereitete Konfiguration gespeichert. Die aktive Nutzung folgt mit zukünftigem Storage-Adapter.',
        });
    });

    // PUT /api/admin/documents/storage
    fastify.put('/documents/storage', { preHandler: [requirePermission('documents.manage')] }, async (request, reply) => {
        const payload = request.body as { externalDirectories?: unknown };
        if (!Array.isArray(payload.externalDirectories)) {
            return reply.status(400).send({ error: 'externalDirectories muss ein Array sein' });
        }

        const normalized: ExternalDirectory[] = [];
        const pathSet = new Set<string>();

        for (const rawEntry of payload.externalDirectories) {
            if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
                return reply.status(400).send({ error: 'Ungültiger Eintrag in externalDirectories' });
            }

            const entry = rawEntry as Record<string, unknown>;
            const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : randomUUID();
            const name = typeof entry.name === 'string' ? entry.name.trim() : '';
            const directoryPath = typeof entry.path === 'string' ? entry.path.trim() : '';
            const isActive = entry.isActive !== false;

            if (!name || !directoryPath) {
                return reply.status(400).send({ error: 'Jeder externe Ordner benötigt Name und Pfad' });
            }
            if (name.length > 120 || directoryPath.length > 500) {
                return reply.status(400).send({ error: 'Name oder Pfad ist zu lang' });
            }

            const dedupKey = directoryPath.toLowerCase();
            if (pathSet.has(dedupKey)) {
                return reply.status(409).send({ error: `Pfad doppelt vorhanden: ${directoryPath}` });
            }
            pathSet.add(dedupKey);

            normalized.push({ id, name, path: directoryPath, isActive });
        }

        const previousState = await getExternalDirectoriesFromSettings();
        await setGlobalSetting(EXTERNAL_DOCS_SETTING_KEY, JSON.stringify(normalized), 'documents');

        const binding = await getStorageBindingConfig(normalized);
        if (binding.mode === 'external' && binding.externalDirectoryId) {
            const hasBindingTarget = normalized.some((entry) => entry.id === binding.externalDirectoryId);
            if (!hasBindingTarget) {
                await setGlobalSetting(
                    STORAGE_BINDING_SETTING_KEY,
                    JSON.stringify({ mode: 'local', externalDirectoryId: null } satisfies StorageBindingConfig),
                    'documents'
                );
            }
        }

        await fastify.audit.log({
            action: 'admin.documents.storage.updated',
            category: 'admin',
            entityType: 'settings',
            entityId: EXTERNAL_DOCS_SETTING_KEY,
            previousState: { count: previousState.length },
            newState: { count: normalized.length, entries: normalized.map((entry) => ({ name: entry.name, path: entry.path, isActive: entry.isActive })) },
        }, request);

        return reply.send({ success: true, externalDirectories: normalized });
    });

    // PUT /api/admin/documents/storage/binding
    fastify.put('/documents/storage/binding', { preHandler: [requirePermission('documents.manage')] }, async (request, reply) => {
        const payload = request.body as { mode?: unknown; externalDirectoryId?: unknown };
        const mode = payload.mode === 'external' ? 'external' : 'local';
        const externalDirectoryId = typeof payload.externalDirectoryId === 'string' && payload.externalDirectoryId.trim()
            ? payload.externalDirectoryId.trim()
            : null;

        const externalDirectories = await getExternalDirectoriesFromSettings();
        if (mode === 'external') {
            if (!externalDirectoryId) {
                return reply.status(400).send({ error: 'Bei externem Modus ist externalDirectoryId erforderlich' });
            }
            const externalExists = externalDirectories.some((entry) => entry.id === externalDirectoryId);
            if (!externalExists) {
                return reply.status(404).send({ error: 'Externes Verzeichnis nicht gefunden' });
            }
        }

        const previousState = await getStorageBindingConfig(externalDirectories);
        const nextState: StorageBindingConfig = {
            mode,
            externalDirectoryId: mode === 'external' ? externalDirectoryId : null,
        };

        await setGlobalSetting(STORAGE_BINDING_SETTING_KEY, JSON.stringify(nextState), 'documents');

        await fastify.audit.log({
            action: 'admin.documents.binding.updated',
            category: 'admin',
            entityType: 'settings',
            entityId: STORAGE_BINDING_SETTING_KEY,
            previousState,
            newState: nextState,
        }, request);

        return reply.send({ success: true, binding: nextState });
    });

    // GET /api/admin/documents/storage/explorer
    fastify.get('/documents/storage/explorer', { preHandler: [requirePermission('documents.manage')] }, async (request, reply) => {
        const query = request.query as { scope?: string; id?: string; path?: string };

        let root;
        try {
            root = await resolveExplorerRoot(query.scope || 'local', query.id || null);
        } catch (error) {
            return reply.status(400).send({ error: error instanceof Error ? error.message : 'Ungültige Explorer-Anfrage' });
        }

        let relativePath = '';
        try {
            relativePath = sanitizeRelativePath(query.path);
        } catch (error) {
            return reply.status(400).send({ error: error instanceof Error ? error.message : 'Ungültiger Pfad' });
        }

        let currentPath: string;
        try {
            currentPath = resolvePathInsideRoot(root.rootPath, relativePath);
        } catch (error) {
            return reply.status(400).send({ error: error instanceof Error ? error.message : 'Ungültiger Pfad' });
        }

        let currentStat;
        try {
            currentStat = await fs.stat(currentPath);
        } catch {
            return reply.status(404).send({ error: 'Verzeichnis nicht gefunden' });
        }
        if (!currentStat.isDirectory()) {
            return reply.status(400).send({ error: 'Pfad ist kein Verzeichnis' });
        }

        const dirEntries = await fs.readdir(currentPath, { withFileTypes: true });
        const entries = await Promise.all(dirEntries.map(async (entry) => {
            const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
            const absolutePath = resolvePathInsideRoot(root.rootPath, childRelativePath);
            const stats = await fs.stat(absolutePath);

            if (entry.isDirectory()) {
                return {
                    name: entry.name,
                    kind: 'directory' as const,
                    path: childRelativePath,
                    sizeBytes: null,
                    modifiedAt: stats.mtime.toISOString(),
                    mimeType: null,
                    previewKind: 'none' as const,
                };
            }

            const mimeType = getMimeTypeByExtension(entry.name);
            return {
                name: entry.name,
                kind: 'file' as const,
                path: childRelativePath,
                sizeBytes: Number(stats.size),
                modifiedAt: stats.mtime.toISOString(),
                mimeType,
                previewKind: getPreviewKind(mimeType),
            };
        }));

        entries.sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
        });

        const parentPath = relativePath.includes('/')
            ? relativePath.split('/').slice(0, -1).join('/')
            : '';

        return reply.send({
            root: {
                scope: root.scope,
                id: root.id,
                name: root.name,
                path: root.rootPath,
            },
            currentPath: relativePath,
            parentPath: relativePath ? parentPath : null,
            entries,
        });
    });

    // GET /api/admin/documents/storage/explorer/file
    fastify.get('/documents/storage/explorer/file', { preHandler: [requirePermission('documents.manage')] }, async (request, reply) => {
        const query = request.query as { scope?: string; id?: string; path?: string; download?: string };

        let root;
        try {
            root = await resolveExplorerRoot(query.scope || 'local', query.id || null);
        } catch (error) {
            return reply.status(400).send({ error: error instanceof Error ? error.message : 'Ungültige Explorer-Anfrage' });
        }

        let relativePath = '';
        try {
            relativePath = sanitizeRelativePath(query.path);
        } catch (error) {
            return reply.status(400).send({ error: error instanceof Error ? error.message : 'Ungültiger Pfad' });
        }
        if (!relativePath) {
            return reply.status(400).send({ error: 'Dateipfad fehlt' });
        }

        let filePath: string;
        try {
            filePath = resolvePathInsideRoot(root.rootPath, relativePath);
        } catch (error) {
            return reply.status(400).send({ error: error instanceof Error ? error.message : 'Ungültiger Pfad' });
        }

        let fileStat;
        try {
            fileStat = await fs.stat(filePath);
        } catch {
            return reply.status(404).send({ error: 'Datei nicht gefunden' });
        }
        if (!fileStat.isFile()) {
            return reply.status(400).send({ error: 'Pfad ist keine Datei' });
        }

        const fileName = path.basename(filePath);
        const mimeType = getMimeTypeByExtension(fileName);
        const download = ['1', 'true', 'yes'].includes(String(query.download || '').toLowerCase());

        // XSS-Schutz: Aktive Inhalte (HTML, SVG, XML) immer als Download erzwingen
        const dangerousMimeTypes = ['text/html', 'image/svg+xml', 'application/xml', 'text/xml', 'application/xhtml+xml'];
        const forcedDownload = download || dangerousMimeTypes.includes(mimeType);
        const safeContentType = forcedDownload && dangerousMimeTypes.includes(mimeType) ? 'application/octet-stream' : mimeType;

        reply.header('Content-Type', safeContentType);
        reply.header('Content-Length', String(fileStat.size));
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Content-Disposition', `${forcedDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        return reply.send(createReadStream(filePath));
    });

    // =============================================
    // AUDIT-LOG
    // =============================================

    // GET /api/admin/audit-log
    fastify.get('/audit-log', { preHandler: [requirePermission('audit.view')] }, async (request, reply) => {
        const { category, userId, pluginId, action, from, to, tenantId, search, page = 1, limit = 50 } = request.query as any;

        let query = db('audit_log')
            .leftJoin('users', 'audit_log.user_id', 'users.id')
            .leftJoin('tenants', 'audit_log.tenant_id', 'tenants.id')
            .select(
                'audit_log.*',
                'users.username as user_username',
                'tenants.name as tenant_name'
            )
            .orderBy('audit_log.created_at', 'desc');

        if (category) query = query.where('audit_log.category', category);
        if (userId) query = query.where('audit_log.user_id', userId);
        if (pluginId) query = query.where('audit_log.plugin_id', pluginId);
        if (action) query = query.where('audit_log.action', 'like', `%${action}%`);
        if (tenantId) query = query.where('audit_log.tenant_id', Number(tenantId));
        if (from) query = query.where('audit_log.created_at', '>=', new Date(from));
        if (to) query = query.where('audit_log.created_at', '<=', new Date(to));
        if (search) {
            const term = `%${String(search).slice(0, 200)}%`;
            query = query.where(function () {
                this.where('audit_log.action', 'like', term)
                    .orWhere('users.username', 'like', term)
                    .orWhere('audit_log.entity_type', 'like', term)
                    .orWhere('audit_log.entity_id', 'like', term)
                    .orWhere('audit_log.ip_address', 'like', term)
                    .orWhere('tenants.name', 'like', term);
            });
        }

        const offset = (Number(page) - 1) * Number(limit);

        const countResult = await query.clone().clearSelect().clearOrder().count('audit_log.id as total').first();
        const total = Number(countResult?.total || 0);

        const entries = await query.limit(Number(limit)).offset(offset);

        return reply.send({ entries, total, page: Number(page), limit: Number(limit) });
    });

    // GET /api/admin/audit-log/:id
    fastify.get('/audit-log/:id', { preHandler: [requirePermission('audit.view')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const entry = await db('audit_log')
            .leftJoin('users', 'audit_log.user_id', 'users.id')
            .leftJoin('tenants', 'audit_log.tenant_id', 'tenants.id')
            .where('audit_log.id', id)
            .select('audit_log.*', 'users.username as user_username', 'tenants.name as tenant_name')
            .first();

        if (!entry) return reply.status(404).send({ error: 'Eintrag nicht gefunden' });

        // JSON-Felder parsen
        if (entry.previous_state && typeof entry.previous_state === 'string') {
            entry.previous_state = JSON.parse(entry.previous_state);
        }
        if (entry.new_state && typeof entry.new_state === 'string') {
            entry.new_state = JSON.parse(entry.new_state);
        }

        return reply.send(entry);
    });

    // GET /api/admin/audit-log/entity/:type/:entityId
    fastify.get('/audit-log/entity/:type/:entityId', { preHandler: [requirePermission('audit.view')] }, async (request, reply) => {
        const { type, entityId } = request.params as { type: string; entityId: string };
        const { tenantId } = request.query as { tenantId?: string };

        let query = db('audit_log')
            .leftJoin('users', 'audit_log.user_id', 'users.id')
            .where('audit_log.entity_type', type)
            .where('audit_log.entity_id', entityId)
            .select('audit_log.*', 'users.username as user_username')
            .orderBy('audit_log.created_at', 'desc');

        if (tenantId) query = query.where('audit_log.tenant_id', Number(tenantId));
        const entries = await query;

        return reply.send(entries);
    });

    // GET /api/admin/audit-log/actions — Alle unterschiedlichen Aktionen mit Anzahl
    fastify.get('/audit-log/actions', { preHandler: [requirePermission('audit.view')] }, async (_request, reply) => {
        const actions = await db('audit_log')
            .select('action', 'category')
            .count('id as count')
            .groupBy('action', 'category')
            .orderBy('action', 'asc');

        return reply.send({
            actions: actions.map((a: any) => ({
                action: a.action,
                category: a.category,
                count: Number(a.count),
            })),
        });
    });

    // =============================================
    // PLUGINS
    // =============================================

    // GET /api/admin/plugins
    fastify.get('/plugins', { preHandler: [requirePermission('plugins.manage')] }, async (request, reply) => {
        const plugins = await db('plugins').select('*');
        return reply.send(plugins);
    });

    // POST /api/admin/plugins/:id/toggle
    fastify.post('/plugins/:id/toggle', { preHandler: [requirePermission('plugins.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const plugin = await db('plugins').where('plugin_id', id).first();
        if (!plugin) return reply.status(404).send({ error: 'Plugin nicht gefunden' });

        const newState = !plugin.is_active;
        await db('plugins').where('plugin_id', id).update({ is_active: newState });

        await fastify.audit.log({
            action: newState ? 'admin.plugin.activated' : 'admin.plugin.deactivated',
            category: 'admin',
            entityType: 'plugins',
            entityId: id,
            previousState: { is_active: plugin.is_active },
            newState: { is_active: newState },
        }, request);

        return reply.send({ success: true, isActive: newState, message: 'Neustart erforderlich' });
    });

    // =============================================
    // BACKUP
    // =============================================

    // POST /api/admin/backup/export
    fastify.post('/backup/export', { preHandler: [requirePermission('backup.export')] }, async (request, reply) => {
        const { exportBackup } = await import('../services/backup.js');

        await fastify.audit.log({
            action: 'admin.backup.export',
            category: 'admin',
        }, request);

        const zipBuffer = await exportBackup();

        reply.header('Content-Type', 'application/zip');
        reply.header('Content-Disposition', `attachment; filename="mike-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
        return reply.send(zipBuffer);
    });

    // POST /api/admin/backup/import
    fastify.post('/backup/import', { preHandler: [requirePermission('backup.import')] }, async (request, reply) => {
        const { importBackup } = await import('../services/backup.js');

        const data = await (request as any).file();
        if (!data) return reply.status(400).send({ error: 'Keine Datei hochgeladen' });

        const buffer = await data.toBuffer();
        const result = await importBackup(buffer);

        await fastify.audit.log({
            action: 'admin.backup.import',
            category: 'admin',
            newState: { tablesImported: result.tablesImported, totalRows: result.totalRows },
        }, request);

        return reply.send({ success: true, ...result });
    });

    // =============================================
    // UPDATES
    // =============================================

    // GET /api/admin/updates/check
    fastify.get('/updates/check', { preHandler: [requirePermission('updates.manage')] }, async (request, reply) => {
        const { checkCoreUpdate, checkPluginUpdates, getLocalPluginCatalog, getInstalledPlugins, getBackupsList } = await import('../services/updater.js');

        const [coreUpdate, pluginUpdates, catalog, installedPlugins, backups] = await Promise.all([
            checkCoreUpdate(),
            checkPluginUpdates(),
            getLocalPluginCatalog(),
            getInstalledPlugins(),
            getBackupsList(),
        ]);

        return reply.send({ core: coreUpdate, plugins: pluginUpdates, catalog, installedPlugins, backups });
    });

    // GET /api/admin/updates/branch
    fastify.get('/updates/branch', { preHandler: [requirePermission('updates.manage')] }, async (_request, reply) => {
        const { getUpdateBranch, getUpdateCheckInterval } = await import('../services/updater.js');
        const [branch, checkInterval] = await Promise.all([
            getUpdateBranch(),
            getUpdateCheckInterval(),
        ]);
        return reply.send({ branch, checkInterval });
    });

    // PUT /api/admin/updates/branch
    fastify.put('/updates/branch', { preHandler: [requirePermission('updates.manage')] }, async (request, reply) => {
        const { branch } = request.body as { branch?: string };
        if (!branch || !['main', 'experimental'].includes(branch)) {
            return reply.status(400).send({ error: 'Ungueltiger Branch. Erlaubt: main, experimental' });
        }

        const { setUpdateBranch, getUpdateBranch } = await import('../services/updater.js');
        const previousBranch = await getUpdateBranch();
        await setUpdateBranch(branch as 'main' | 'experimental');

        await fastify.audit.log({
            action: 'admin.update.branch_changed',
            category: 'admin',
            previousState: { branch: previousBranch },
            newState: { branch },
        }, request);

        return reply.send({ success: true, branch });
    });

    // PUT /api/admin/updates/check-interval
    fastify.put('/updates/check-interval', { preHandler: [requirePermission('updates.manage')] }, async (request, reply) => {
        const { seconds } = request.body as { seconds?: number };
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 10) {
            return reply.status(400).send({ error: 'Intervall muss mindestens 10 Sekunden betragen' });
        }

        const { setUpdateCheckInterval } = await import('../services/updater.js');
        await setUpdateCheckInterval(seconds);

        return reply.send({ success: true, seconds: Math.max(10, Math.round(seconds)) });
    });

    // GET /api/admin/updates/backups
    fastify.get('/updates/backups', { preHandler: [requirePermission('updates.manage')] }, async (_request, reply) => {
        const { getBackupsList } = await import('../services/updater.js');
        const backups = await getBackupsList();
        return reply.send({ backups });
    });

    // GET /api/admin/updates/changelog-history
    fastify.get('/updates/changelog-history', { preHandler: [requirePermission('updates.manage')] }, async (_request, reply) => {
        const { getChangelogHistory } = await import('../services/updater.js');
        const history = await getChangelogHistory();
        return reply.send(history);
    });

    // GET /api/admin/updates/tasks/:id
    fastify.get('/updates/tasks/:id', { preHandler: [requirePermission('updates.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const task = getUpdateTask(id);
        if (!task) {
            return reply.status(404).send({ error: 'Update-Task nicht gefunden' });
        }
        return reply.send({ task });
    });

    // POST /api/admin/updates/activate-plugin/:id
    fastify.post('/updates/activate-plugin/:id', { preHandler: [requirePermission('updates.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const { activatePlugin } = await import('../services/updater.js');

        await fastify.audit.log({
            action: 'admin.plugin.activate',
            category: 'admin',
            entityType: 'plugins',
            entityId: id,
        }, request);

        const result = await activatePlugin(id);
        if (!result.success) {
            return reply.status(400).send({ error: result.error });
        }
        return reply.send({ success: true, message: `Plugin ${id} aktiviert. Neustart erforderlich.` });
    });

    // POST /api/admin/updates/deactivate-plugin/:id
    fastify.post('/updates/deactivate-plugin/:id', { preHandler: [requirePermission('updates.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const { deactivatePlugin } = await import('../services/updater.js');

        await fastify.audit.log({
            action: 'admin.plugin.deactivate',
            category: 'admin',
            entityType: 'plugins',
            entityId: id,
        }, request);

        const result = await deactivatePlugin(id);
        if (!result.success) {
            return reply.status(400).send({ error: result.error });
        }
        return reply.send({ success: true, message: `Plugin ${id} deaktiviert. Neustart erforderlich.` });
    });

    // POST /api/admin/updates/remove-plugin/:id
    fastify.post('/updates/remove-plugin/:id', { preHandler: [requirePermission('updates.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const { removePlugin } = await import('../services/updater.js');
        const task = createUpdateTask('plugin-remove', id);

        await fastify.audit.log({
            action: 'admin.update.plugin_remove',
            category: 'admin',
            entityType: 'plugins',
            entityId: id,
        }, request);

        runUpdateTask(task.id, async (reporter) => {
            const result = await removePlugin(id, {
                onProgress: ({ message, progress }) => reporter.log(message, progress),
            });

            if (!result.success) {
                reporter.fail(result.error || `Plugin ${id} konnte nicht entfernt werden`);
                return;
            }

            reporter.success(`Plugin ${id} erfolgreich entfernt`);
        });

        return reply.send({ success: true, taskId: task.id });
    });

    // ==========================================
    // Session Management (Aktive Sitzungen)
    // ==========================================

    // GET /api/admin/sessions
    fastify.get('/sessions', {
        preHandler: [requirePermission('users.manage')],
    }, async (request, reply) => {
        const sessions = await db('refresh_tokens')
            .where('is_revoked', false)
            .where('expires_at', '>', new Date())
            .join('users', 'refresh_tokens.user_id', 'users.id')
            .select(
                'refresh_tokens.id',
                'refresh_tokens.user_id',
                'refresh_tokens.user_agent',
                'refresh_tokens.ip_address',
                'refresh_tokens.created_at',
                'refresh_tokens.expires_at',
                'users.username',
                'users.display_name'
            )
            .orderBy('refresh_tokens.created_at', 'desc');

        // display_name entschluesseln
        const decrypted = sessions.map((s: any) => {
            let displayName = s.display_name;
            try { if (displayName) displayName = decrypt(displayName); } catch { /* */ }
            return {
                id: s.id,
                userId: s.user_id,
                username: s.username,
                displayName,
                userAgent: s.user_agent || 'Unbekannt',
                ipAddress: s.ip_address || 'Unbekannt',
                createdAt: s.created_at,
                expiresAt: s.expires_at,
            };
        });

        return reply.send(decrypted);
    });

    // POST /api/admin/sessions/:id/revoke
    fastify.post('/sessions/:id/revoke', {
        preHandler: [requirePermission('users.manage')],
    }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const session = await db('refresh_tokens').where('id', id).first();
        if (!session) return reply.status(404).send({ error: 'Sitzung nicht gefunden' });

        await db('refresh_tokens').where('id', id).update({ is_revoked: true });

        await fastify.audit.log({
            action: 'admin.session.revoked',
            category: 'admin',
            entityType: 'session',
            entityId: id,
            newState: { userId: session.user_id, ipAddress: session.ip_address },
        }, request);

        return reply.send({ success: true });
    });

    // POST /api/admin/sessions/revoke-all/:userId
    fastify.post('/sessions/revoke-all/:userId', {
        preHandler: [requirePermission('users.manage')],
    }, async (request, reply) => {
        const { userId } = request.params as { userId: string };
        const count = await db('refresh_tokens')
            .where('user_id', userId)
            .where('is_revoked', false)
            .update({ is_revoked: true });

        await fastify.audit.log({
            action: 'admin.sessions.revoked_all',
            category: 'admin',
            entityType: 'user',
            entityId: userId,
            newState: { revokedCount: count },
        }, request);

        return reply.send({ success: true, revokedCount: count });
    });
}
