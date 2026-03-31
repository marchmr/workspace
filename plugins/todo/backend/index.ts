import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../backend/src/core/database.js';

interface TodoBody {
    title: string;
    description?: string;
    priority?: 'niedrig' | 'mittel' | 'hoch' | 'dringend';
    due_date?: string | null;
}

interface TodoUpdateBody extends Partial<TodoBody> {
    status?: 'offen' | 'in_bearbeitung' | 'erledigt';
    sort_order?: number;
}

export default async function plugin(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    // GET /api/plugins/todo/ — Alle Aufgaben des Nutzers
    fastify.get('/', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const { status, priority } = request.query as { status?: string; priority?: string };

        let query = db('plugin_todo_items').where('user_id', userId);

        if (status && ['offen', 'in_bearbeitung', 'erledigt'].includes(status)) {
            query = query.where('status', status);
        }
        if (priority && ['niedrig', 'mittel', 'hoch', 'dringend'].includes(priority)) {
            query = query.where('priority', priority);
        }

        const items = await query
            .orderByRaw(`FIELD(status, 'offen', 'in_bearbeitung', 'erledigt')`)
            .orderByRaw(`FIELD(priority, 'dringend', 'hoch', 'mittel', 'niedrig')`)
            .orderBy('due_date', 'asc')
            .orderBy('sort_order', 'asc')
            .select('*');

        return reply.send({ items });
    });

    // POST /api/plugins/todo/ — Neue Aufgabe
    fastify.post('/', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const body = request.body as TodoBody;

        if (!body.title || !body.title.trim()) {
            return reply.status(400).send({ error: 'Titel ist erforderlich' });
        }

        const maxSort = await db('plugin_todo_items')
            .where('user_id', userId)
            .max('sort_order as max')
            .first();

        const [id] = await db('plugin_todo_items').insert({
            title: body.title.trim(),
            description: (body.description || '').trim(),
            priority: body.priority || 'mittel',
            due_date: body.due_date || null,
            user_id: userId,
            sort_order: (maxSort?.max || 0) + 1,
            status: 'offen',
        });

        const item = await db('plugin_todo_items').where('id', id).first();

        await fastify.audit.log({
            action: 'todo.item.created',
            category: 'plugin',
            entityType: 'plugin_todo_items',
            entityId: String(id),
            newState: { title: body.title },
        }, request);

        return reply.status(201).send({ item });
    });

    // PUT /api/plugins/todo/:id — Aufgabe aktualisieren
    fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const userId = (request.user as any).userId;
        const body = request.body as TodoUpdateBody;

        const existing = await db('plugin_todo_items')
            .where({ id, user_id: userId })
            .first();

        if (!existing) {
            return reply.status(404).send({ error: 'Aufgabe nicht gefunden' });
        }

        const update: Record<string, any> = { updated_at: new Date() };

        if (body.title !== undefined) update.title = body.title.trim();
        if (body.description !== undefined) update.description = body.description.trim();
        if (body.priority !== undefined) update.priority = body.priority;
        if (body.due_date !== undefined) update.due_date = body.due_date || null;
        if (body.sort_order !== undefined) update.sort_order = body.sort_order;

        if (body.status !== undefined) {
            update.status = body.status;

            // Timer-Logik: "Starten" startet den Timer, "Erledigt"/"Offen" stoppt ihn
            if (body.status === 'in_bearbeitung' && existing.status !== 'in_bearbeitung') {
                // Timer starten
                update.timer_started_at = new Date();
            } else if (body.status !== 'in_bearbeitung' && existing.timer_started_at) {
                // Timer stoppen und Sekunden addieren
                const started = new Date(existing.timer_started_at).getTime();
                const elapsed = Math.floor((Date.now() - started) / 1000);
                update.total_seconds = (existing.total_seconds || 0) + elapsed;
                update.timer_started_at = null;
            }

            if (body.status === 'erledigt' && existing.status !== 'erledigt') {
                update.completed_at = new Date();
            } else if (body.status !== 'erledigt') {
                update.completed_at = null;
            }
        }

        await db('plugin_todo_items').where({ id, user_id: userId }).update(update);
        const item = await db('plugin_todo_items').where('id', id).first();

        await fastify.audit.log({
            action: 'todo.item.updated',
            category: 'plugin',
            entityType: 'plugin_todo_items',
            entityId: String(id),
            previousState: { status: existing.status, title: existing.title },
            newState: update,
        }, request);

        return reply.send({ item });
    });

    // DELETE /api/plugins/todo/:id — Aufgabe loeschen
    fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const userId = (request.user as any).userId;

        const existing = await db('plugin_todo_items')
            .where({ id, user_id: userId })
            .first();

        if (!existing) {
            return reply.status(404).send({ error: 'Aufgabe nicht gefunden' });
        }

        await db('plugin_todo_items').where({ id, user_id: userId }).delete();

        await fastify.audit.log({
            action: 'todo.item.deleted',
            category: 'plugin',
            entityType: 'plugin_todo_items',
            entityId: String(id),
            previousState: { title: existing.title },
        }, request);

        return reply.send({ success: true });
    });

    // GET /api/plugins/todo/stats — Statistiken
    fastify.get('/stats', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;

        const stats = await db('plugin_todo_items')
            .where('user_id', userId)
            .select(db.raw(`
                COUNT(*) as total,
                SUM(CASE WHEN status = 'offen' THEN 1 ELSE 0 END) as offen,
                SUM(CASE WHEN status = 'in_bearbeitung' THEN 1 ELSE 0 END) as in_bearbeitung,
                SUM(CASE WHEN status = 'erledigt' THEN 1 ELSE 0 END) as erledigt,
                SUM(CASE WHEN due_date < CURDATE() AND status != 'erledigt' THEN 1 ELSE 0 END) as ueberfaellig
            `))
            .first();

        return reply.send({ stats });
    });
}
