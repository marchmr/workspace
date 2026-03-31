import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../../backend/src/core/database.js';
import { requirePermission } from '../../../../backend/src/core/permissions.js';
import { decryptIfNotEmpty } from '../../../../backend/src/core/encryption.js';

function tryDecrypt(val: string | null | undefined): string | null {
    if (!val) return null;
    try { return decryptIfNotEmpty(val); }
    catch { return val; }
}

export default async function noteRoutes(fastify: FastifyInstance): Promise<void> {


    // ══════════════════════════════════════════
    // GET / — Notizen (filter by customer/ticket)
    // ══════════════════════════════════════════
    fastify.get('/', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { customer_id, ticket_id, contact_id } = request.query as Record<string, string>;

        let query = db('crm_notes as n')
            .leftJoin('users as u', 'n.created_by', 'u.id')
            .where('n.tenant_id', user.tenantId);

        if (customer_id) query = query.where('n.customer_id', parseInt(customer_id));
        if (ticket_id) query = query.where('n.ticket_id', parseInt(ticket_id));
        if (contact_id) query = query.where('n.contact_id', parseInt(contact_id));

        const notes = await query
            .select('n.*', 'u.display_name as created_by_name')
            .orderBy('n.is_pinned', 'desc')
            .orderBy('n.created_at', 'desc');

        return reply.send({ notes: notes.map((n: any) => ({ ...n, created_by_name: tryDecrypt(n.created_by_name) })) });
    });

    // ══════════════════════════════════════════
    // GET /:id — Einzelne Notiz
    // ══════════════════════════════════════════
    fastify.get('/:id', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };

        const note = await db('crm_notes as n')
            .leftJoin('users as u', 'n.created_by', 'u.id')
            .where('n.id', id)
            .where('n.tenant_id', user.tenantId)
            .select('n.*', 'u.display_name as created_by_name')
            .first();

        if (!note) return reply.status(404).send({ error: 'Notiz nicht gefunden' });
        return reply.send(note);
    });

    // ══════════════════════════════════════════
    // POST / — Neue Notiz
    // ══════════════════════════════════════════
    fastify.post('/', { preHandler: [requirePermission('crm.notes.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const body = request.body as any;

        if (!body.content?.trim() && !body.content_html?.trim()) {
            return reply.status(400).send({ error: 'Inhalt darf nicht leer sein' });
        }

        const [id] = await db('crm_notes').insert({
            tenant_id: user.tenantId,
            customer_id: body.customer_id || null,
            ticket_id: body.ticket_id || null,
            contact_id: body.contact_id || null,
            title: body.title?.trim() || null,
            content: body.content?.trim() || null,
            content_html: body.content_html || null,
            is_pinned: body.is_pinned || false,
            created_by: user.userId,
            created_at: new Date(),
            updated_at: new Date(),
        });

        // Aktivität loggen
        if (body.customer_id) {
            await db('crm_activities').insert({
                tenant_id: user.tenantId,
                customer_id: body.customer_id,
                entity_type: 'note',
                entity_id: id,
                type: 'note.created',
                title: body.title ? `Notiz: ${body.title.trim()}` : 'Neue Notiz erstellt',
                created_by: user.userId,
                created_at: new Date(),
            });
        }

        return reply.status(201).send({ id });
    });

    // ══════════════════════════════════════════
    // PUT /:id — Notiz aktualisieren
    // ══════════════════════════════════════════
    fastify.put('/:id', { preHandler: [requirePermission('crm.notes.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };
        const body = request.body as any;

        const note = await db('crm_notes').where({ id, tenant_id: user.tenantId }).first();
        if (!note) return reply.status(404).send({ error: 'Notiz nicht gefunden' });

        const updates: any = { updated_at: new Date() };
        if (body.title !== undefined) updates.title = body.title?.trim() || null;
        if (body.content !== undefined) updates.content = body.content?.trim() || null;
        if (body.content_html !== undefined) updates.content_html = body.content_html || null;
        if (body.is_pinned !== undefined) updates.is_pinned = body.is_pinned;

        await db('crm_notes').where({ id, tenant_id: user.tenantId }).update(updates);
        return reply.send({ ok: true });
    });

    // ══════════════════════════════════════════
    // PATCH /:id/pin — Notiz pinnen/unpinnen
    // ══════════════════════════════════════════
    fastify.patch('/:id/pin', { preHandler: [requirePermission('crm.notes.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };

        const note = await db('crm_notes').where({ id, tenant_id: user.tenantId }).first();
        if (!note) return reply.status(404).send({ error: 'Notiz nicht gefunden' });

        await db('crm_notes').where({ id, tenant_id: user.tenantId }).update({
            is_pinned: !note.is_pinned,
            updated_at: new Date(),
        });

        return reply.send({ is_pinned: !note.is_pinned });
    });

    // ══════════════════════════════════════════
    // DELETE /:id — Notiz löschen
    // ══════════════════════════════════════════
    fastify.delete('/:id', { preHandler: [requirePermission('crm.notes.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };

        const note = await db('crm_notes').where({ id, tenant_id: user.tenantId }).first();
        if (!note) return reply.status(404).send({ error: 'Notiz nicht gefunden' });

        await db('crm_notes').where({ id, tenant_id: user.tenantId }).delete();
        return reply.send({ ok: true });
    });
}
