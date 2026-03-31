import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { getDatabase } from './database.js';

// Core system permissions
const CORE_PERMISSIONS = [
    { key: 'admin.access', label: 'Admin-Zugang', description: 'Zugang zum Admin-Bereich' },
    { key: 'users.view', label: 'Benutzer anzeigen', description: 'Benutzerliste einsehen' },
    { key: 'users.create', label: 'Benutzer erstellen', description: 'Neue Benutzer anlegen' },
    { key: 'users.edit', label: 'Benutzer bearbeiten', description: 'Benutzer-Daten aendern' },
    { key: 'users.delete', label: 'Benutzer loeschen', description: 'Benutzer entfernen' },
    { key: 'roles.view', label: 'Rollen anzeigen', description: 'Rollenliste einsehen' },
    { key: 'roles.create', label: 'Rollen erstellen', description: 'Neue Rollen anlegen' },
    { key: 'roles.edit', label: 'Rollen bearbeiten', description: 'Rollen-Permissions aendern' },
    { key: 'roles.delete', label: 'Rollen loeschen', description: 'Rollen entfernen' },
    { key: 'plugins.manage', label: 'Plugins verwalten', description: 'Plugins installieren/aktivieren/deaktivieren' },
    { key: 'backup.export', label: 'Backup erstellen', description: 'Datenbank-Export durchfuehren' },
    { key: 'backup.import', label: 'Backup importieren', description: 'Datenbank-Import durchfuehren' },
    { key: 'updates.manage', label: 'Updates verwalten', description: 'System-Updates installieren' },
    { key: 'audit.view', label: 'Audit-Log einsehen', description: 'Audit-Protokoll anzeigen' },
    { key: 'settings.manage', label: 'Einstellungen verwalten', description: 'Systemeinstellungen aendern' },
    { key: 'tenants.manage', label: 'Mandanten verwalten', description: 'Mandanten erstellen und bearbeiten' },
    { key: 'dashboard.view', label: 'Dashboard anzeigen', description: 'Dashboard einsehen' },
    { key: 'documents.view', label: 'Dokumente anzeigen', description: 'Dokumente auflisten und herunterladen' },
    { key: 'documents.upload', label: 'Dokumente hochladen', description: 'Dokumente in den Core-Speicher hochladen' },
    { key: 'documents.delete', label: 'Dokumente löschen', description: 'Dokumente entfernen oder inaktiv setzen' },
    { key: 'documents.link', label: 'Dokumente verknüpfen', description: 'Dokumente mit Entitäten verknüpfen oder lösen' },
    { key: 'documents.manage', label: 'Dokument-Zugriffe verwalten', description: 'ACL und Zugriffsregeln für Dokumente ändern' },
    { key: 'webhooks.manage', label: 'Webhooks verwalten', description: 'Webhooks erstellen, bearbeiten und loeschen' },
    { key: 'notifications.view', label: 'Benachrichtigungen', description: 'Eigene Benachrichtigungen einsehen' },
    { key: 'locks.manage', label: 'Sperren verwalten', description: 'Aktive Entity-Locks einsehen und aufheben' },
];

export async function registerCorePermissions(): Promise<void> {
    const db = getDatabase();

    for (const perm of CORE_PERMISSIONS) {
        const exists = await db('permissions').where('key', perm.key).first();
        if (!exists) {
            await db('permissions').insert({
                key: perm.key,
                label: perm.label,
                description: perm.description,
                plugin_id: null,
                created_at: new Date(),
            });
        }
    }
}

export async function registerPluginPermissions(pluginId: string, permissions: string[]): Promise<void> {
    const db = getDatabase();

    for (const permKey of permissions) {
        const exists = await db('permissions').where('key', permKey).first();
        if (!exists) {
            await db('permissions').insert({
                key: permKey,
                label: permKey,
                description: `Permission fuer Plugin: ${pluginId}`,
                plugin_id: pluginId,
                created_at: new Date(),
            });
        }
    }
}

export async function getUserPermissions(userId: number): Promise<string[]> {
    const db = getDatabase();

    const roleRows = await db('user_roles')
        .join('role_permissions', 'user_roles.role_id', 'role_permissions.role_id')
        .join('permissions', 'role_permissions.permission_id', 'permissions.id')
        .where('user_roles.user_id', userId)
        .select('permissions.key');

    const directRows = await db('user_permissions')
        .join('permissions', 'user_permissions.permission_id', 'permissions.id')
        .where('user_permissions.user_id', userId)
        .select('permissions.key');

    return [...new Set([
        ...roleRows.map((r: any) => String(r.key)),
        ...directRows.map((r: any) => String(r.key)),
    ])];
}

export async function hasPermission(userId: number, permission: string): Promise<boolean> {
    const db = getDatabase();

    // Super-Admin hat alles
    const superAdminRole = await db('user_roles')
        .join('roles', 'user_roles.role_id', 'roles.id')
        .where('user_roles.user_id', userId)
        .where('roles.name', 'Super-Admin')
        .first();

    if (superAdminRole) return true;

    const perms = await getUserPermissions(userId);
    return perms.includes(permission);
}

/**
 * Erzeugt einen preHandler der:
 * 1. authenticate aufruft (JWT prüfen, request.user setzen)
 * 2. Permissions prüft
 *
 * Damit ist requirePermission alleiniger preHandler — die PolicyEngine
 * erkennt ihn korrekt und kein separates fastify.authenticate ist nötig.
 */
export function requirePermission(...requiredPermissions: string[]) {
    return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
        // Schritt 1: Auth — setzt request.user
        if (!request.user) {
            try {
                const fastify = request.server;
                await fastify.authenticate(request, reply);
            } catch {
                return; // authenticate hat bereits 401 gesendet
            }
        }

        // Schritt 2: Nach Auth nochmal prüfen (falls authenticate fehlschlug)
        if (!request.user) {
            if (!reply.sent) {
                reply.status(401).send({ error: 'Nicht autorisiert' });
            }
            return;
        }

        // Schritt 3: Permissions prüfen
        const userPerms = request.user.permissions || [];

        // Super-Admin bypass
        if (userPerms.includes('*')) return;

        const hasAll = requiredPermissions.every((p) => userPerms.includes(p));
        if (!hasAll) {
            reply.status(403).send({
                error: 'Keine Berechtigung',
                required: requiredPermissions,
            });
        }
    };
}

export async function createDefaultRoles(): Promise<void> {
    const db = getDatabase();

    async function ensureRole(name: string, description: string): Promise<{ id: number; isNew: boolean }> {
        const existing = await db('roles').where('name', name).first();
        if (existing) {
            return { id: Number(existing.id), isNew: false };
        }
        const [id] = await db('roles').insert({
            name,
            description,
            is_system: true,
            created_at: new Date(),
        });
        return { id: Number(id), isNew: true };
    }

    async function ensureRolePermissions(roleId: number, permissionIds: number[]): Promise<void> {
        if (!permissionIds.length) return;
        const existing = await db('role_permissions')
            .where('role_id', roleId)
            .pluck('permission_id');
        const existingSet = new Set(existing.map((id: any) => Number(id)));

        for (const permissionId of permissionIds) {
            if (existingSet.has(permissionId)) continue;
            await db('role_permissions').insert({
                role_id: roleId,
                permission_id: permissionId,
            });
        }
    }

    // Super-Admin
    const superAdmin = await ensureRole('Super-Admin', 'Vollzugriff auf alle Funktionen');
    const allPerms = await db('permissions').select('id');
    await ensureRolePermissions(superAdmin.id, allPerms.map((perm: any) => Number(perm.id)));

    // Admin
    const admin = await ensureRole('Admin', 'Verwaltungszugang ohne Plugin-spezifische Rechte');
    const corePerms = await db('permissions').whereNull('plugin_id').select('id');
    await ensureRolePermissions(admin.id, corePerms.map((perm: any) => Number(perm.id)));

    // Benutzer
    const user = await ensureRole('Benutzer', 'Basis-Zugang');
    const dashboardPerm = await db('permissions').where('key', 'dashboard.view').first('id');
    if (dashboardPerm?.id) {
        await ensureRolePermissions(user.id, [Number(dashboardPerm.id)]);
    }
}

async function permissionsPlugin(fastify: FastifyInstance): Promise<void> {
    fastify.decorate('requirePermission', requirePermission);
}

export default fp(permissionsPlugin, { name: 'permissions' });

