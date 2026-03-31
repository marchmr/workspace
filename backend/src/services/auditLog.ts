import { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { getDatabase } from '../core/database.js';

const SENSITIVE_FIELDS = ['password', 'password_hash', 'encryption_key', 'jwt_secret', 'mfa_secret', 'mfa_secret_encrypted', 'recovery_codes_encrypted', 'token', 'refresh_token'];

export type AuditCategory = 'auth' | 'data' | 'admin' | 'plugin' | 'lock';

export interface AuditLogEntry {
    action: string;
    category: AuditCategory;
    entityType?: string;
    entityId?: string | number;
    previousState?: Record<string, any> | null;
    newState?: Record<string, any> | null;
    pluginId?: string;
    tenantId?: number | null;
}

export function maskSensitiveFields(data: Record<string, any> | null | undefined): Record<string, any> | null {
    if (!data) return null;

    const masked = { ...data };
    for (const field of SENSITIVE_FIELDS) {
        if (field in masked) {
            masked[field] = '***MASKED***';
        }
    }
    return masked;
}

export function getClientIp(request: FastifyRequest): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    return request.ip;
}

export function getUserAgent(request: FastifyRequest): string {
    return (request.headers['user-agent'] as string) || 'unknown';
}

async function writeAuditLog(
    entry: AuditLogEntry,
    userId: number | null,
    request?: FastifyRequest
): Promise<void> {
    const db = getDatabase();
    const tenantId = entry.tenantId !== undefined ? entry.tenantId : (request?.user?.tenantId || null);

    await db('audit_log').insert({
        user_id: userId,
        action: entry.action,
        category: entry.category,
        entity_type: entry.entityType || null,
        entity_id: entry.entityId ? String(entry.entityId) : null,
        previous_state: entry.previousState ? JSON.stringify(maskSensitiveFields(entry.previousState)) : null,
        new_state: entry.newState ? JSON.stringify(maskSensitiveFields(entry.newState)) : null,
        ip_address: request ? getClientIp(request) : null,
        user_agent: request ? getUserAgent(request) : null,
        plugin_id: entry.pluginId || null,
        tenant_id: tenantId,
        created_at: new Date(),
    });
}

// Wrapper fuer automatisches Vorher/Nachher-Tracking
export async function withAudit(
    tableName: string,
    entityId: string | number,
    action: string,
    category: Exclude<AuditCategory, 'auth'>,
    operation: () => Promise<void>,
    userId: number | null,
    request?: FastifyRequest,
    pluginId?: string
): Promise<void> {
    const db = getDatabase();

    // Vorher-Zustand lesen
    let previousState: Record<string, any> | null = null;
    if (action !== 'create') {
        previousState = await db(tableName).where('id', entityId).first() || null;
    }

    // Operation ausfuehren
    await operation();

    // Nachher-Zustand lesen
    let newState: Record<string, any> | null = null;
    if (action !== 'delete') {
        newState = await db(tableName).where('id', entityId).first() || null;
    }

    await writeAuditLog(
        {
            action,
            category,
            entityType: tableName,
            entityId,
            previousState,
            newState,
            pluginId,
        },
        userId,
        request
    );
}

declare module 'fastify' {
    interface FastifyInstance {
        audit: {
            log: (entry: AuditLogEntry, request?: FastifyRequest) => Promise<void>;
            withAudit: typeof withAudit;
        };
    }
}

async function auditLogPlugin(fastify: FastifyInstance): Promise<void> {
    fastify.decorate('audit', {
        log: async (entry: AuditLogEntry, request?: FastifyRequest) => {
            const userId = request?.user?.userId || null;
            await writeAuditLog(entry, userId, request);
        },
        withAudit,
    });
}

export default fp(auditLogPlugin, { name: 'auditLog' });
