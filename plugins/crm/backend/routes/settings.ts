import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../../backend/src/core/database.js';
import { requirePermission } from '../../../../backend/src/core/permissions.js';

export default async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    /* ═══════════════════════════════════════════════
       Custom-Felder Verwaltung
       ═══════════════════════════════════════════════ */

    // ─── GET /custom-fields — Alle Custom-Felder des Mandanten ───
    fastify.get('/custom-fields', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const { entity_type } = request.query as { entity_type?: string };

        let query = db('crm_custom_field_definitions')
            .where('tenant_id', tenantId)
            .orderBy('sort_order', 'asc');

        if (entity_type && ['customer', 'ticket', 'contact'].includes(entity_type)) {
            query = query.where('entity_type', entity_type);
        }

        const fields = await query.select('*');

        const enriched = fields.map((f: any) => ({
            ...f,
            options: f.options ? (typeof f.options === 'string' ? JSON.parse(f.options) : f.options) : [],
        }));

        return reply.send({ fields: enriched });
    });

    // ─── POST /custom-fields — Custom-Feld erstellen ───
    fastify.post('/custom-fields', { preHandler: [requirePermission('crm.manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const body = request.body as any;

        if (!body.label?.trim()) {
            return reply.status(400).send({ error: 'Label ist erforderlich' });
        }

        // field_key aus Label generieren
        const fieldKey = body.label
            .trim()
            .toLowerCase()
            .replace(/[äÄ]/g, 'ae')
            .replace(/[öÖ]/g, 'oe')
            .replace(/[üÜ]/g, 'ue')
            .replace(/ß/g, 'ss')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '');

        // Prüfen ob field_key schon existiert
        const existing = await db('crm_custom_field_definitions')
            .where({ tenant_id: tenantId, field_key: fieldKey, entity_type: body.entity_type || 'customer' })
            .first();

        if (existing) {
            return reply.status(409).send({ error: 'Ein Feld mit diesem Namen existiert bereits' });
        }

        // Maximale Sortierung ermitteln
        const maxSort = await db('crm_custom_field_definitions')
            .where('tenant_id', tenantId)
            .max('sort_order as max')
            .first();

        const [id] = await db('crm_custom_field_definitions').insert({
            tenant_id: tenantId,
            field_key: fieldKey,
            label: body.label.trim(),
            field_type: body.field_type || 'text',
            options: body.options ? JSON.stringify(body.options) : null,
            required: body.required || false,
            sort_order: (maxSort?.max || 0) + 1,
            entity_type: body.entity_type || 'customer',
            is_active: true,
            created_at: new Date(),
        });

        const field = await db('crm_custom_field_definitions').where('id', id).first();

        await fastify.audit.log({
            action: 'crm.custom_field.created',
            category: 'plugin',
            entityType: 'crm_custom_field_definitions',
            entityId: String(id),
            newState: { label: body.label, field_type: body.field_type, entity_type: body.entity_type },
            pluginId: 'crm',
        }, request);

        return reply.status(201).send({
            ...field,
            options: field.options ? (typeof field.options === 'string' ? JSON.parse(field.options) : field.options) : [],
        });
    });

    // ─── PUT /custom-fields/:id — Custom-Feld bearbeiten ───
    fastify.put('/custom-fields/:id', { preHandler: [requirePermission('crm.manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const tenantId = (request.user as any).tenantId;
        const body = request.body as any;

        const existing = await db('crm_custom_field_definitions')
            .where({ id, tenant_id: tenantId })
            .first();

        if (!existing) {
            return reply.status(404).send({ error: 'Custom-Feld nicht gefunden' });
        }

        const update: any = {};
        if (body.label !== undefined) update.label = body.label.trim();
        if (body.field_type !== undefined) update.field_type = body.field_type;
        if (body.options !== undefined) update.options = JSON.stringify(body.options);
        if (body.required !== undefined) update.required = body.required;
        if (body.sort_order !== undefined) update.sort_order = body.sort_order;
        if (body.is_active !== undefined) update.is_active = body.is_active;

        if (Object.keys(update).length === 0) {
            return reply.status(400).send({ error: 'Keine Änderungen' });
        }

        await db('crm_custom_field_definitions').where('id', id).update(update);
        const field = await db('crm_custom_field_definitions').where('id', id).first();

        await fastify.audit.log({
            action: 'crm.custom_field.updated',
            category: 'plugin',
            entityType: 'crm_custom_field_definitions',
            entityId: String(id),
            previousState: { label: existing.label },
            newState: update,
            pluginId: 'crm',
        }, request);

        return reply.send({
            ...field,
            options: field.options ? (typeof field.options === 'string' ? JSON.parse(field.options) : field.options) : [],
        });
    });

    // ─── DELETE /custom-fields/:id — Custom-Feld löschen ───
    fastify.delete('/custom-fields/:id', { preHandler: [requirePermission('crm.manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const tenantId = (request.user as any).tenantId;

        const existing = await db('crm_custom_field_definitions')
            .where({ id, tenant_id: tenantId })
            .first();

        if (!existing) {
            return reply.status(404).send({ error: 'Custom-Feld nicht gefunden' });
        }

        await db('crm_custom_field_definitions').where('id', id).delete();

        await fastify.audit.log({
            action: 'crm.custom_field.deleted',
            category: 'plugin',
            entityType: 'crm_custom_field_definitions',
            entityId: String(id),
            previousState: { label: existing.label, field_key: existing.field_key },
            pluginId: 'crm',
        }, request);

        return reply.send({ success: true });
    });
}
