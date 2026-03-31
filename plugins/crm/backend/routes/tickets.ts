import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../../backend/src/core/database.js';
import { requirePermission } from '../../../../backend/src/core/permissions.js';
import { decryptIfNotEmpty } from '../../../../backend/src/core/encryption.js';

function tryDecrypt(val: string | null | undefined): string | null {
    if (!val) return null;
    try { return decryptIfNotEmpty(val); }
    catch { return val; }
}

export default async function ticketRoutes(fastify: FastifyInstance): Promise<void> {


    // ══════════════════════════════════════════
    // GET / — Ticket-Liste mit Filter/Pagination
    // ══════════════════════════════════════════
    fastify.get('/', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const {
            page = '1', pageSize = '25', search = '', status = '', priority = '',
            category = '', assigned_to = '', customer_id = '',
            sortBy = 'created_at', sortOrder = 'desc',
        } = request.query as Record<string, string>;

        const pg = Math.max(1, parseInt(page));
        const ps = Math.min(100, Math.max(1, parseInt(pageSize)));
        const offset = (pg - 1) * ps;

        let query = db('crm_tickets as t')
            .leftJoin('crm_customers as c', 't.customer_id', 'c.id')
            .leftJoin('users as u', 't.assigned_to', 'u.id')
            .leftJoin('users as cr', 't.created_by', 'cr.id')
            .leftJoin('crm_contacts as con', 't.contact_id', 'con.id')
            .where('t.tenant_id', user.tenantId);

        let countQuery = db('crm_tickets as t').where('t.tenant_id', user.tenantId);

        if (search) {
            const s = `%${search}%`;
            query = query.where(function () {
                this.where('t.ticket_number', 'like', s)
                    .orWhere('t.subject', 'like', s);
            });
            countQuery = countQuery.where(function () {
                this.where('t.ticket_number', 'like', s)
                    .orWhere('t.subject', 'like', s);
            });
        }

        if (status) {
            query = query.where('t.status', status);
            countQuery = countQuery.where('t.status', status);
        }
        if (priority) {
            query = query.where('t.priority', priority);
            countQuery = countQuery.where('t.priority', priority);
        }
        if (category) {
            query = query.where('t.category', category);
            countQuery = countQuery.where('t.category', category);
        }
        if (assigned_to) {
            query = query.where('t.assigned_to', parseInt(assigned_to));
            countQuery = countQuery.where('t.assigned_to', parseInt(assigned_to));
        }
        if (customer_id) {
            query = query.where('t.customer_id', parseInt(customer_id));
            countQuery = countQuery.where('t.customer_id', parseInt(customer_id));
        }

        const [{ total }] = await countQuery.count('* as total');

        const allowedSort: Record<string, string> = {
            created_at: 't.created_at', subject: 't.subject', status: 't.status',
            priority: 't.priority', due_date: 't.due_date', ticket_number: 't.ticket_number',
        };
        const sortCol = allowedSort[sortBy] || 't.created_at';
        const order = sortOrder === 'asc' ? 'asc' : 'desc';

        const items = await query
            .select(
                't.id', 't.ticket_number', 't.subject', 't.status', 't.priority',
                't.category', 't.due_date', 't.created_at', 't.updated_at',
                't.customer_id', 't.assigned_to', 't.created_by', 't.contact_id',
                'c.company_name as customer_company',
                db.raw("COALESCE(c.company_name, CONCAT(c.first_name, ' ', c.last_name)) as customer_name"),
                'c.customer_number as customer_number',
                'u.display_name as assigned_to_name',
                'cr.display_name as created_by_name',
                db.raw("CONCAT(COALESCE(con.first_name, ''), ' ', COALESCE(con.last_name, '')) as contact_name"),
            )
            .orderBy(sortCol, order)
            .limit(ps)
            .offset(offset);

        const decryptedItems = items.map((t: any) => ({
            ...t,
            assigned_to_name: tryDecrypt(t.assigned_to_name),
            created_by_name: tryDecrypt(t.created_by_name),
        }));

        return reply.send({
            items: decryptedItems,
            pagination: { page: pg, pageSize: ps, total: Number(total), totalPages: Math.ceil(Number(total) / ps) },
        });
    });

    // ══════════════════════════════════════════
    // GET /next-number — Nächste Ticket-Nr
    // ══════════════════════════════════════════
    fastify.get('/next-number', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const year = new Date().getFullYear();
        const prefix = `TK-${year}-`;

        const last = await db('crm_tickets')
            .where('tenant_id', user.tenantId)
            .where('ticket_number', 'like', `${prefix}%`)
            .orderBy('id', 'desc')
            .first();

        let next = 1;
        if (last) {
            const num = parseInt(last.ticket_number.replace(prefix, ''));
            if (!isNaN(num)) next = num + 1;
        }

        return reply.send({ nextNumber: `${prefix}${String(next).padStart(4, '0')}` });
    });

    // ══════════════════════════════════════════
    // GET /:id — Einzelnes Ticket
    // ══════════════════════════════════════════
    fastify.get('/:id', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };

        const ticket = await db('crm_tickets as t')
            .leftJoin('crm_customers as c', 't.customer_id', 'c.id')
            .leftJoin('users as u', 't.assigned_to', 'u.id')
            .leftJoin('users as cr', 't.created_by', 'cr.id')
            .leftJoin('crm_contacts as con', 't.contact_id', 'con.id')
            .where('t.id', id)
            .where('t.tenant_id', user.tenantId)
            .select(
                't.*',
                db.raw("COALESCE(c.company_name, CONCAT(c.first_name, ' ', c.last_name)) as customer_name"),
                'c.customer_number',
                'u.display_name as assigned_to_name',
                'cr.display_name as created_by_name',
                db.raw("CONCAT(COALESCE(con.first_name, ''), ' ', COALESCE(con.last_name, '')) as contact_name"),
            )
            .first();

        if (!ticket) return reply.status(404).send({ error: 'Ticket nicht gefunden' });

        // Kommentare mitlesen
        const comments = await db('crm_ticket_comments as tc')
            .leftJoin('users as u', 'tc.created_by', 'u.id')
            .where('tc.ticket_id', id)
            .where('tc.tenant_id', user.tenantId)
            .select('tc.*', 'u.display_name as author_name')
            .orderBy('tc.created_at', 'asc');

        // Verschluesselte Usernamen entschluesseln
        const decryptedTicket = {
            ...ticket,
            created_by_name: tryDecrypt(ticket.created_by_name),
            assigned_to_name: tryDecrypt(ticket.assigned_to_name),
        };
        const decryptedComments = comments.map((c: any) => ({
            ...c,
            author_name: tryDecrypt(c.author_name),
        }));

        return reply.send({ ...decryptedTicket, comments: decryptedComments });
    });

    // ══════════════════════════════════════════
    // POST / — Neues Ticket
    // ══════════════════════════════════════════
    fastify.post('/', { preHandler: [requirePermission('crm.tickets.create')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const body = request.body as any;

        if (!body.subject?.trim()) {
            return reply.status(400).send({ error: 'Betreff ist erforderlich' });
        }

        // Ticket-Nummer generieren
        const year = new Date().getFullYear();
        const prefix = `TK-${year}-`;
        const last = await db('crm_tickets')
            .where('tenant_id', user.tenantId)
            .where('ticket_number', 'like', `${prefix}%`)
            .orderBy('id', 'desc')
            .first();

        let next = 1;
        if (last) {
            const num = parseInt(last.ticket_number.replace(prefix, ''));
            if (!isNaN(num)) next = num + 1;
        }
        const ticketNumber = `${prefix}${String(next).padStart(4, '0')}`;

        const [id] = await db('crm_tickets').insert({
            tenant_id: user.tenantId,
            ticket_number: ticketNumber,
            customer_id: body.customer_id || null,
            subject: body.subject.trim(),
            description: body.description || null,
            status: body.status || 'open',
            priority: body.priority || 'normal',
            category: body.category || null,
            assigned_to: body.assigned_to || null,
            contact_id: body.contact_id || null,
            due_date: body.due_date || null,
            custom_fields: body.custom_fields ? JSON.stringify(body.custom_fields) : null,
            created_by: user.userId,
            created_at: new Date(),
            updated_at: new Date(),
        });

        // Aktivität loggen
        await db('crm_activities').insert({
            tenant_id: user.tenantId,
            customer_id: body.customer_id || null,
            entity_type: 'ticket',
            entity_id: id,
            type: 'ticket.created',
            title: `Ticket ${ticketNumber} erstellt: ${body.subject.trim()}`,
            created_by: user.userId,
            created_at: new Date(),
        });

        return reply.status(201).send({ id, ticket_number: ticketNumber });
    });

    // ══════════════════════════════════════════
    // PUT /:id — Ticket vollständig aktualisieren
    // ══════════════════════════════════════════
    fastify.put('/:id', { preHandler: [requirePermission('crm.tickets.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };
        const body = request.body as any;

        const ticket = await db('crm_tickets').where({ id, tenant_id: user.tenantId }).first();
        if (!ticket) return reply.status(404).send({ error: 'Ticket nicht gefunden' });

        const updates: any = { updated_at: new Date() };
        const allowed = ['subject', 'description', 'status', 'priority', 'category', 'assigned_to', 'due_date', 'customer_id', 'contact_id'];
        for (const key of allowed) {
            if (body[key] !== undefined) updates[key] = body[key] || null;
        }
        if (body.custom_fields !== undefined) updates.custom_fields = JSON.stringify(body.custom_fields);

        // Status-Timestamps
        if (body.status === 'resolved' && ticket.status !== 'resolved') updates.resolved_at = new Date();
        if (body.status === 'closed' && ticket.status !== 'closed') updates.closed_at = new Date();

        await db('crm_tickets').where({ id, tenant_id: user.tenantId }).update(updates);

        // Status-Änderung loggen
        if (body.status && body.status !== ticket.status) {
            const statusLabels: Record<string, string> = {
                open: 'Offen', in_progress: 'In Bearbeitung', waiting: 'Wartend',
                resolved: 'Gelöst', closed: 'Geschlossen',
            };
            await db('crm_activities').insert({
                tenant_id: user.tenantId,
                customer_id: ticket.customer_id,
                entity_type: 'ticket',
                entity_id: id,
                type: 'ticket.status_changed',
                title: `Ticket ${ticket.ticket_number}: Status → ${statusLabels[body.status] || body.status}`,
                created_by: user.userId,
                created_at: new Date(),
            });
        }

        return reply.send({ ok: true });
    });

    // ══════════════════════════════════════════
    // PATCH /:id — Einzelfeld-Update
    // ══════════════════════════════════════════
    fastify.patch('/:id', { preHandler: [requirePermission('crm.tickets.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };
        const body = request.body as any;

        const ticket = await db('crm_tickets').where({ id, tenant_id: user.tenantId }).first();
        if (!ticket) return reply.status(404).send({ error: 'Ticket nicht gefunden' });

        const updates: any = { updated_at: new Date() };
        const allowed = ['subject', 'description', 'status', 'priority', 'category', 'assigned_to', 'due_date', 'customer_id', 'contact_id'];
        for (const key of allowed) {
            if (body[key] !== undefined) updates[key] = body[key] === '' ? null : body[key];
        }

        if (body.status === 'resolved' && ticket.status !== 'resolved') updates.resolved_at = new Date();
        if (body.status === 'closed' && ticket.status !== 'closed') updates.closed_at = new Date();

        await db('crm_tickets').where({ id, tenant_id: user.tenantId }).update(updates);
        return reply.send({ ok: true });
    });

    // ══════════════════════════════════════════
    // DELETE /:id — Ticket löschen
    // ══════════════════════════════════════════
    fastify.delete('/:id', { preHandler: [requirePermission('crm.tickets.delete')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };

        const ticket = await db('crm_tickets').where({ id, tenant_id: user.tenantId }).first();
        if (!ticket) return reply.status(404).send({ error: 'Ticket nicht gefunden' });

        await db('crm_tickets').where({ id, tenant_id: user.tenantId }).delete();
        return reply.send({ ok: true });
    });

    // ══════════════════════════════════════════
    // POST /:id/comments — Kommentar hinzufügen
    // ══════════════════════════════════════════
    fastify.post('/:id/comments', { preHandler: [requirePermission('crm.tickets.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };
        const body = request.body as any;

        const ticket = await db('crm_tickets').where({ id, tenant_id: user.tenantId }).first();
        if (!ticket) return reply.status(404).send({ error: 'Ticket nicht gefunden' });

        if (!body.content?.trim()) {
            return reply.status(400).send({ error: 'Kommentar darf nicht leer sein' });
        }

        const [commentId] = await db('crm_ticket_comments').insert({
            ticket_id: parseInt(id),
            tenant_id: user.tenantId,
            content: body.content.trim(),
            is_internal: body.is_internal || false,
            created_by: user.userId,
            created_at: new Date(),
        });

        // Ticket-Updated-Timestamp aktualisieren
        await db('crm_tickets').where({ id, tenant_id: user.tenantId }).update({ updated_at: new Date() });

        // Aktivität loggen
        await db('crm_activities').insert({
            tenant_id: user.tenantId,
            customer_id: ticket.customer_id,
            entity_type: 'ticket_comment',
            entity_id: commentId,
            type: 'ticket.comment_added',
            title: `Kommentar zu Ticket ${ticket.ticket_number}`,
            created_by: user.userId,
            created_at: new Date(),
        });

        return reply.status(201).send({ id: commentId });
    });

    // ══════════════════════════════════════════
    // GET /categories — Alle Kategorien
    // ══════════════════════════════════════════
    fastify.get('/categories', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const rows = await db('crm_tickets')
            .where('tenant_id', user.tenantId)
            .whereNotNull('category')
            .where('category', '!=', '')
            .distinct('category')
            .orderBy('category', 'asc');

        return reply.send({ categories: rows.map((r: any) => r.category) });
    });

    // ══════════════════════════════════════════
    // GET /stats — Ticket-Statistiken
    // ══════════════════════════════════════════
    fastify.get('/stats', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;

        const [stats] = await db('crm_tickets')
            .where('tenant_id', user.tenantId)
            .select(
                db.raw('COUNT(*) as total'),
                db.raw("SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count"),
                db.raw("SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count"),
                db.raw("SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting_count"),
                db.raw("SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count"),
                db.raw("SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count"),
                db.raw("SUM(CASE WHEN priority = 'urgent' AND status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) as urgent_open"),
                db.raw("SUM(CASE WHEN due_date < NOW() AND status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) as overdue"),
            );

        return reply.send(stats);
    });
}
