/**
 * Audit-Change-Helper
 *
 * Vereinfacht das Loggen von Aenderungen mit automatischem Before/After-State.
 * Berechnet den Diff und maskiert sensitive Felder.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { getDatabase } from './database.js';
import type { AuditCategory } from '../services/auditLog.js';

/** Felder die im Audit-Log maskiert werden */
const SENSITIVE_FIELDS = new Set([
    'password_hash',
    'mfa_secret',
    'mfa_secret_encrypted',
    'recovery_codes_encrypted',
    'secret',
    'token_hash',
    'refresh_token',
]);

/** Maskiert sensitive Felder mit '***' */
function maskSensitiveFields(obj: Record<string, any>): Record<string, any> {
    const masked: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (SENSITIVE_FIELDS.has(key)) {
            masked[key] = '***';
        } else {
            masked[key] = value;
        }
    }
    return masked;
}

/** Berechnet den Diff zwischen zwei Objekten – nur geaenderte Felder */
export function calculateDiff(
    before: Record<string, any>,
    after: Record<string, any>
): { changedFields: string[]; previousState: Record<string, any>; newState: Record<string, any> } {
    const changedFields: string[] = [];
    const previousState: Record<string, any> = {};
    const newState: Record<string, any> = {};

    for (const key of Object.keys(after)) {
        const oldVal = before[key];
        const newVal = after[key];

        // Ignoriere interne Felder
        if (key === 'updated_at' || key === 'created_at') continue;

        // Vergleich (stringify fuer JSON-Typen)
        const oldStr = JSON.stringify(oldVal ?? null);
        const newStr = JSON.stringify(newVal ?? null);

        if (oldStr !== newStr) {
            changedFields.push(key);
            previousState[key] = SENSITIVE_FIELDS.has(key) ? '***' : oldVal;
            newState[key] = SENSITIVE_FIELDS.has(key) ? '***' : newVal;
        }
    }

    return { changedFields, previousState, newState };
}

interface AuditChangeOptions {
    /** DB-Tabellenname */
    table: string;
    /** ID des betroffenen Datensatzes */
    id: string | number;
    /** Aktion (z.B. 'admin.user.updated') */
    action: string;
    /** Kategorie (z.B. 'admin', 'data', 'auth') */
    category: AuditCategory;
    /** Nur die geaenderten Felder (PATCH-Objekt) */
    changes: Record<string, any>;
    /** Request fuer User/Tenant-Kontext */
    request: FastifyRequest;
    /** Plugin-ID (optional) */
    pluginId?: string;
    /** Custom Entity-Typ (default: table) */
    entityType?: string;
}

async function auditHelpersPlugin(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    /**
     * Loggt eine Aenderung mit automatischem Before/After-State.
     * Holt den aktuellen Stand aus der DB, berechnet den Diff, und schreibt ins Audit-Log.
     */
    fastify.decorate('auditChange', async (opts: AuditChangeOptions) => {
        try {
            // Vorher-Zustand aus DB holen
            const before = await db(opts.table).where('id', opts.id).first();

            if (!before) {
                // Datensatz existiert nicht (mehr) – trotzdem loggen
                await fastify.audit.log({
                    action: opts.action,
                    category: opts.category,
                    entityType: opts.entityType || opts.table,
                    entityId: String(opts.id),
                    newState: maskSensitiveFields(opts.changes),
                    pluginId: opts.pluginId,
                }, opts.request);
                return;
            }

            // Diff berechnen
            const { changedFields, previousState, newState } = calculateDiff(before, opts.changes);

            // Nur loggen wenn sich tatsaechlich etwas geaendert hat
            if (changedFields.length === 0) return;

            await fastify.audit.log({
                action: opts.action,
                category: opts.category,
                entityType: opts.entityType || opts.table,
                entityId: String(opts.id),
                previousState: {
                    ...previousState,
                    _changedFields: changedFields,
                },
                newState,
                pluginId: opts.pluginId,
            }, opts.request);
        } catch (err) {
            // Audit-Fehler nie propagieren
            console.error('[AuditHelpers] Fehler beim Audit-Change-Log:', err);
        }
    });

    console.log('[AuditHelpers] Initialisiert');
}

// Type Declaration
declare module 'fastify' {
    interface FastifyInstance {
        auditChange: (opts: AuditChangeOptions) => Promise<void>;
    }
}

export default fp(auditHelpersPlugin, {
    name: 'auditHelpers',
    dependencies: ['auditLog'],
});
