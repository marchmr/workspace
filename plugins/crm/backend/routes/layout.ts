import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../../backend/src/core/database.js';
import { decryptIfNotEmpty } from '../../../../backend/src/core/encryption.js';
import { requirePermission } from '../../../../backend/src/core/permissions.js';

function tryDecrypt(val: string | null | undefined): string | null {
    if (!val) return null;
    try { return decryptIfNotEmpty(val); }
    catch { return val; }
}

export default async function layoutRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    // ─── GET / — Kundenakte-Layout laden ───
    fastify.get('/', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;

        const layout = await db('crm_customer_layouts')
            .where('user_id', userId)
            .first();

        if (!layout) {
            return reply.send({ layout: null });
        }

        return reply.send({
            layout: typeof layout.layout_json === 'string' ? JSON.parse(layout.layout_json) : layout.layout_json,
        });
    });

    // ─── PUT / — Kundenakte-Layout speichern ───
    fastify.put('/', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const body = request.body as any;

        if (!body.layout) {
            return reply.status(400).send({ error: 'Layout-Daten fehlen' });
        }

        const existing = await db('crm_customer_layouts').where('user_id', userId).first();

        if (existing) {
            await db('crm_customer_layouts')
                .where('user_id', userId)
                .update({
                    layout_json: JSON.stringify(body.layout),
                    updated_at: new Date(),
                });
        } else {
            await db('crm_customer_layouts').insert({
                user_id: userId,
                layout_json: JSON.stringify(body.layout),
                updated_at: new Date(),
            });
        }

        return reply.send({ success: true });
    });

    // ─── GET /recent — Zuletzt geöffnete Kunden ───
    fastify.get('/recent', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const tenantId = (request.user as any).tenantId;

        const recent = await db('crm_recent_customers as rc')
            .join('crm_customers as c', 'rc.customer_id', 'c.id')
            .where('rc.user_id', userId)
            .where('c.tenant_id', tenantId)
            .orderBy('rc.opened_at', 'desc')
            .limit(10)
            .select('c.id', 'c.customer_number', 'c.company_name', 'c.first_name', 'c.last_name', 'c.type', 'c.city', 'c.status', 'rc.opened_at');

        const enriched = recent.map((c: any) => ({
            ...c,
            display_name: c.type === 'company' && c.company_name ? c.company_name : [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unbenannt',
        }));

        return reply.send({ recent: enriched });
    });

    // ─── POST /recent/:customerId — Kunden als geöffnet markieren ───
    fastify.post('/recent/:customerId', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const { customerId } = request.params as { customerId: string };

        // Alten Eintrag aktualisieren oder neuen erstellen
        const existing = await db('crm_recent_customers')
            .where({ user_id: userId, customer_id: Number(customerId) })
            .first();

        if (existing) {
            await db('crm_recent_customers')
                .where('id', existing.id)
                .update({ opened_at: new Date() });
        } else {
            await db('crm_recent_customers').insert({
                user_id: userId,
                customer_id: Number(customerId),
                opened_at: new Date(),
            });

            // Max. 10 Einträge behalten
            const allRecent = await db('crm_recent_customers')
                .where('user_id', userId)
                .orderBy('opened_at', 'desc')
                .select('id');

            if (allRecent.length > 10) {
                const idsToDelete = allRecent.slice(10).map((r: any) => r.id);
                await db('crm_recent_customers').whereIn('id', idsToDelete).delete();
            }
        }

        return reply.send({ success: true });
    });

    // ─── GET /favorites — Favoriten des Users ───
    fastify.get('/favorites', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const tenantId = (request.user as any).tenantId;

        const favorites = await db('crm_favorites as f')
            .join('crm_customers as c', 'f.customer_id', 'c.id')
            .where('f.user_id', userId)
            .where('c.tenant_id', tenantId)
            .orderBy('f.created_at', 'desc')
            .select('c.id', 'c.customer_number', 'c.company_name', 'c.first_name', 'c.last_name', 'c.type', 'c.city', 'c.status', 'f.created_at as favorited_at');

        const enriched = favorites.map((c: any) => ({
            ...c,
            display_name: c.type === 'company' && c.company_name ? c.company_name : [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unbenannt',
        }));

        return reply.send({ favorites: enriched });
    });

    // ─── POST /favorites/:customerId — Favorit hinzufügen ───
    fastify.post('/favorites/:customerId', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const { customerId } = request.params as { customerId: string };

        const existing = await db('crm_favorites')
            .where({ user_id: userId, customer_id: Number(customerId) })
            .first();

        if (!existing) {
            await db('crm_favorites').insert({
                user_id: userId,
                customer_id: Number(customerId),
                created_at: new Date(),
            });
        }

        return reply.send({ success: true });
    });

    // ─── DELETE /favorites/:customerId — Favorit entfernen ───
    fastify.delete('/favorites/:customerId', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const { customerId } = request.params as { customerId: string };

        await db('crm_favorites')
            .where({ user_id: userId, customer_id: Number(customerId) })
            .delete();

        return reply.send({ success: true });
    });

    // ─── GET /activities/:customerId — Aktivitaets-Timeline ───
    fastify.get('/activities/:customerId', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const { customerId } = request.params as { customerId: string };
        const { limit: limitStr } = request.query as { limit?: string };
        const limit = Math.min(50, Math.max(1, parseInt(limitStr || '20', 10)));

        const activities = await db('crm_activities')
            .where({ customer_id: Number(customerId), tenant_id: tenantId })
            .orderBy('created_at', 'desc')
            .limit(limit)
            .select('*');

        // User-Namen laden
        const userIds = [...new Set(activities.map((a: any) => a.created_by).filter(Boolean))];
        const users = userIds.length > 0
            ? await db('users').whereIn('id', userIds).select('id', 'username', 'display_name')
            : [];
        const userMap = new Map(users.map((u: any) => [u.id, tryDecrypt(u.display_name) || u.username]));

        const enriched = activities.map((a: any) => ({
            ...a,
            created_by_name: userMap.get(a.created_by) || 'System',
            metadata: a.metadata ? (typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata) : null,
        }));

        return reply.send({ activities: enriched });
    });
}
