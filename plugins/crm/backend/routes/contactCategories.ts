import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../../backend/src/core/database.js';
import { requirePermission } from '../../../../backend/src/core/permissions.js';

export default async function contactCategoryRoutes(fastify: FastifyInstance): Promise<void> {
    // ══════════════════════════════════════════
    // GET /categories — Alle Kategorien des Mandanten
    // ══════════════════════════════════════════
    fastify.get('/categories', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;

        const categories = await db('crm_contact_categories')
            .where('tenant_id', user.tenantId)
            .orderBy('sort_order', 'asc')
            .orderBy('name', 'asc')
            .select('*');

        return reply.send({ categories });
    });

    // ══════════════════════════════════════════
    // POST /categories — Neue Kategorie anlegen
    // ══════════════════════════════════════════
    fastify.post('/categories', { preHandler: [requirePermission('crm.contacts.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const body = request.body as any;

        if (!body.name?.trim()) {
            return reply.status(400).send({ error: 'Name ist erforderlich' });
        }

        // Prüfen ob Name schon existiert
        const existing = await db('crm_contact_categories')
            .where({ tenant_id: user.tenantId, name: body.name.trim() })
            .first();
        if (existing) {
            return reply.status(409).send({ error: 'Kategorie existiert bereits' });
        }

        // Höchste sort_order ermitteln
        const maxOrder = await db('crm_contact_categories')
            .where('tenant_id', user.tenantId)
            .max('sort_order as max')
            .first();

        const [id] = await db('crm_contact_categories').insert({
            tenant_id: user.tenantId,
            name: body.name.trim(),
            color: body.color || '#64748b',
            sort_order: (maxOrder?.max || 0) + 1,
            is_default: false,
        });

        return reply.status(201).send({ id });
    });

    // ══════════════════════════════════════════
    // PUT /categories/:id — Kategorie aktualisieren
    // ══════════════════════════════════════════
    fastify.put('/categories/:id', { preHandler: [requirePermission('crm.contacts.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };
        const body = request.body as any;

        const cat = await db('crm_contact_categories')
            .where({ id, tenant_id: user.tenantId })
            .first();
        if (!cat) return reply.status(404).send({ error: 'Kategorie nicht gefunden' });

        const updates: any = {};
        if (body.name !== undefined) updates.name = body.name.trim();
        if (body.color !== undefined) updates.color = body.color;
        if (body.sort_order !== undefined) updates.sort_order = body.sort_order;

        if (Object.keys(updates).length > 0) {
            await db('crm_contact_categories').where({ id, tenant_id: user.tenantId }).update(updates);
        }

        return reply.send({ ok: true });
    });

    // ══════════════════════════════════════════
    // DELETE /categories/:id — Kategorie löschen
    // ══════════════════════════════════════════
    fastify.delete('/categories/:id', { preHandler: [requirePermission('crm.contacts.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };

        const cat = await db('crm_contact_categories')
            .where({ id, tenant_id: user.tenantId })
            .first();
        if (!cat) return reply.status(404).send({ error: 'Kategorie nicht gefunden' });

        // Kontakte auf null setzen bevor Kategorie gelöscht wird
        await db('crm_contacts')
            .where({ category_id: id, tenant_id: user.tenantId })
            .update({ category_id: null });

        await db('crm_contact_categories').where({ id, tenant_id: user.tenantId }).delete();
        return reply.send({ ok: true });
    });

    // ══════════════════════════════════════════
    // PUT /categories/reorder — Sortierung aktualisieren
    // ══════════════════════════════════════════
    fastify.put('/categories/reorder', { preHandler: [requirePermission('crm.contacts.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { order } = request.body as { order: number[] };

        if (!Array.isArray(order)) {
            return reply.status(400).send({ error: 'order Array erforderlich' });
        }

        for (let i = 0; i < order.length; i++) {
            await db('crm_contact_categories')
                .where({ id: order[i], tenant_id: user.tenantId })
                .update({ sort_order: i });
        }

        return reply.send({ ok: true });
    });
}
