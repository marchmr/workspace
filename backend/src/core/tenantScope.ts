/**
 * Tenant-Scope Helper
 *
 * Zentraler Helper fuer Mandanten-Isolation.
 * Filtert Queries automatisch nach tenant_id und
 * setzt tenant_id bei Inserts.
 *
 * Super-Admins (Permission '*') sehen alle Mandanten.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { Knex } from 'knex';

/**
 * Fuegt `.where('tenant_id', tenantId)` hinzu.
 * Super-Admins (Permission '*') werden nicht gefiltert.
 *
 * @example
 *   const rows = await scopedQuery(db('webhooks'), request)
 *     .where('id', id)
 *     .first();
 */
export function scopedQuery<T extends Knex.QueryBuilder>(
    query: T,
    request: FastifyRequest,
    column = 'tenant_id'
): T {
    const perms: string[] = (request as any).user?.permissions || [];
    if (perms.includes('*')) {
        return query; // Super-Admin: kein Filter
    }
    const tenantId = (request as any).user?.tenantId;
    if (!tenantId) {
        // Kein Tenant → leere Ergebnisse erzwingen (sicher)
        return query.whereRaw('1 = 0') as T;
    }
    return query.where(column, tenantId) as T;
}

/**
 * Setzt tenant_id automatisch beim Insert.
 * Super-Admins muessen tenant_id explizit uebergeben.
 *
 * @example
 *   const data = scopedInsert({ name: 'Test', url: '...' }, request);
 *   await db('webhooks').insert(data);
 */
export function scopedInsert(
    data: Record<string, any>,
    request: FastifyRequest,
    column = 'tenant_id'
): Record<string, any> {
    const tenantId = (request as any).user?.tenantId;
    return {
        ...data,
        [column]: data[column] ?? tenantId ?? null,
    };
}

/**
 * Extrahiert die Tenant-ID aus dem Request.
 * Wirft einen Fehler wenn keine Tenant-ID vorhanden ist.
 */
export function requireTenantId(request: FastifyRequest): number {
    const tenantId = (request as any).user?.tenantId;
    if (!tenantId) {
        throw new Error('Kein aktiver Mandant im Token');
    }
    return tenantId;
}

/**
 * Prueft ob der User ein Super-Admin ist (Permission '*').
 */
export function isSuperAdmin(request: FastifyRequest): boolean {
    const perms: string[] = (request as any).user?.permissions || [];
    return perms.includes('*');
}

// Fastify-Plugin: registriert Helpers als Decorator
async function tenantScopePlugin(fastify: FastifyInstance): Promise<void> {
    fastify.decorate('scopedQuery', scopedQuery);
    fastify.decorate('scopedInsert', scopedInsert);
    fastify.decorate('requireTenantId', requireTenantId);
    fastify.decorate('isSuperAdmin', isSuperAdmin);
    console.log('[TenantScope] Helper registriert');
}

export default fp(tenantScopePlugin, { name: 'tenantScope' });
