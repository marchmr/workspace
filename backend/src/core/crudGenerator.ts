/**
 * CRUD-Generator
 *
 * Generiert 5 REST-Endpoints mit eingebautem:
 * - Tenant-Scoping (scopedQuery / scopedInsert)
 * - Zod-Validation
 * - Audit-Logging (auditChange)
 * - Paginierung, Suche, Sortierung
 *
 * Nutzung im Plugin:
 * ```ts
 * createCrudRoutes(fastify, {
 *   table: 'mein_plugin_items',
 *   prefix: '/items',
 *   permission: 'mein-plugin',
 *   pluginId: 'mein-plugin',
 *   schema: z.object({ name: z.string().min(1) }),
 * });
 * ```
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodSchema } from 'zod';

export interface CrudOptions {
    /** DB-Tabellenname */
    table: string;
    /** URL-Prefix (z.B. '/items') */
    prefix: string;
    /** Permission-Basis (z.B. 'mein-plugin' → .view, .create, .edit, .delete) */
    permission: string;
    /** Plugin-ID fuer Audit-Log */
    pluginId: string;
    /** Zod-Schema fuer Create/Update Validation */
    schema: ZodSchema;
    /** Felder die bei ?search=xyz durchsucht werden (Default: ['name']) */
    searchFields?: string[];
    /** Default-Sortierung */
    defaultSort?: { column: string; order: 'asc' | 'desc' };
    /** Felder die im GET-List zurueckgegeben werden (Default: alle) */
    selectFields?: string[];
    /** Maximale Seitengröße (Default: 100) */
    maxPageSize?: number;
    /** Callback vor dem Erstellen (kann Daten manipulieren) */
    beforeCreate?: (data: Record<string, any>, request: FastifyRequest) => Record<string, any> | Promise<Record<string, any>>;
    /** Callback vor dem Update */
    beforeUpdate?: (data: Record<string, any>, request: FastifyRequest) => Record<string, any> | Promise<Record<string, any>>;
    /** Callback nach dem Erstellen */
    afterCreate?: (id: number, data: Record<string, any>, request: FastifyRequest) => void | Promise<void>;
    /** Callback nach dem Loeschen */
    afterDelete?: (id: number, request: FastifyRequest) => void | Promise<void>;
}

export function createCrudRoutes(fastify: FastifyInstance, opts: CrudOptions): void {
    const {
        table,
        prefix,
        permission,
        pluginId,
        schema,
        searchFields = ['name'],
        defaultSort = { column: 'created_at', order: 'desc' },
        maxPageSize = 100,
        beforeCreate,
        beforeUpdate,
        afterCreate,
        afterDelete,
    } = opts;

    const requirePerm = (perm: string) => fastify.requirePermission(`${permission}.${perm}`);

    // ============================================
    // GET /prefix – Liste mit Paginierung + Suche
    // ============================================
    fastify.get(prefix, {
        preHandler: [requirePerm('view')],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as Record<string, string>;
        const page = Math.max(1, parseInt(query.page || '1', 10));
        const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(query.pageSize || '25', 10)));
        const search = (query.search || '').trim();
        const sortColumn = query.sortBy || defaultSort.column;
        const sortOrder = query.sortOrder === 'asc' ? 'asc' : query.sortOrder === 'desc' ? 'desc' : defaultSort.order;

        let baseQuery = fastify.scopedQuery(fastify.db(table), request);

        // Suche (F2 Security Fix: LIKE-Wildcards escapen)
        if (search && searchFields.length > 0) {
            const safeTerm = search.replace(/[%_\\]/g, '\\$&');
            baseQuery = baseQuery.where(function (this: any) {
                for (const field of searchFields) {
                    this.orWhere(field, 'like', `%${safeTerm}%`);
                }
            });
        }

        // Gesamtanzahl
        const countResult = await baseQuery.clone().count('id as count').first();
        const total = Number(countResult?.count || 0);
        const totalPages = Math.ceil(total / pageSize);

        // Daten
        const items = await baseQuery
            .orderBy(sortColumn, sortOrder)
            .limit(pageSize)
            .offset((page - 1) * pageSize);

        return reply.send({
            items,
            pagination: { page, pageSize, total, totalPages },
        });
    });

    // ============================================
    // GET /prefix/:id – Einzelner Datensatz
    // ============================================
    fastify.get(`${prefix}/:id`, {
        preHandler: [requirePerm('view')],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const item = await fastify.scopedQuery(fastify.db(table), request)
            .where(`${table}.id`, id)
            .first();

        if (!item) return reply.status(404).send({ error: 'Nicht gefunden' });
        return reply.send(item);
    });

    // ============================================
    // POST /prefix – Erstellen
    // ============================================
    fastify.post(prefix, {
        preHandler: [requirePerm('create')],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        // Validation
        const result = schema.safeParse(request.body);
        if (!result.success) {
            return reply.status(422).send({
                error: 'Validierungsfehler',
                details: result.error.flatten().fieldErrors,
            });
        }

        let data = result.data as Record<string, any>;

        // Callback
        if (beforeCreate) data = await beforeCreate(data, request);

        // Tenant-ID + Timestamps
        const insertData = fastify.scopedInsert({
            ...data,
            created_at: new Date(),
            updated_at: new Date(),
        }, request);

        const [id] = await fastify.db(table).insert(insertData);

        // Audit
        await fastify.audit.log({
            action: `${pluginId}.created`,
            category: 'plugin',
            entityType: table,
            entityId: id,
            newState: data,
            pluginId,
        }, request);

        // Callback
        if (afterCreate) await afterCreate(id, data, request);

        return reply.status(201).send({ id });
    });

    // ============================================
    // PUT /prefix/:id – Update
    // ============================================
    fastify.put(`${prefix}/:id`, {
        preHandler: [requirePerm('edit')],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };

        // Pruefen ob Datensatz existiert + Tenant
        const existing = await fastify.scopedQuery(fastify.db(table), request)
            .where(`${table}.id`, id)
            .first();

        if (!existing) return reply.status(404).send({ error: 'Nicht gefunden' });

        // Validation
        const result = schema.safeParse(request.body);
        if (!result.success) {
            return reply.status(422).send({
                error: 'Validierungsfehler',
                details: result.error.flatten().fieldErrors,
            });
        }

        let data = result.data as Record<string, any>;

        // Callback
        if (beforeUpdate) data = await beforeUpdate(data, request);

        // Audit mit diff
        await fastify.auditChange({
            table,
            id,
            action: `${pluginId}.updated`,
            category: 'plugin',
            changes: data,
            request,
            pluginId,
        });

        // Update
        await fastify.db(table).where('id', id).update({
            ...data,
            updated_at: new Date(),
        });

        return reply.send({ success: true });
    });

    // ============================================
    // DELETE /prefix/:id – Loeschen
    // ============================================
    fastify.delete(`${prefix}/:id`, {
        preHandler: [requirePerm('delete')],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };

        // Pruefen ob Datensatz existiert + Tenant
        const existing = await fastify.scopedQuery(fastify.db(table), request)
            .where(`${table}.id`, id)
            .first();

        if (!existing) return reply.status(404).send({ error: 'Nicht gefunden' });

        await fastify.db(table).where('id', id).delete();

        // Audit
        await fastify.audit.log({
            action: `${pluginId}.deleted`,
            category: 'plugin',
            entityType: table,
            entityId: id,
            previousState: existing,
            pluginId,
        }, request);

        // Callback
        if (afterDelete) await afterDelete(Number(id), request);

        return reply.send({ success: true });
    });
}
