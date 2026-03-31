import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { getDatabase } from '../core/database.js';

interface NotificationPayload {
    title: string;
    message?: string;
    link?: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    pluginId?: string;
    tenantId?: number | null;
    urgent?: boolean;       // true = Toast-Popup anzeigen
    duration?: number;      // Toast-Dauer in ms (default: 5000, 0 = manuell schliessen)
    category?: string;      // Gruppierung (z.B. "lock", "system", "plugin.crm")
}

// SSE connections per user
const sseConnections = new Map<number, Set<FastifyReply>>();

function addSSEConnection(userId: number, reply: FastifyReply): void {
    let conns = sseConnections.get(userId);
    if (!conns) {
        conns = new Set();
        sseConnections.set(userId, conns);
    }
    conns.add(reply);
}

function removeSSEConnection(userId: number, reply: FastifyReply): void {
    const conns = sseConnections.get(userId);
    if (conns) {
        conns.delete(reply);
        if (conns.size === 0) sseConnections.delete(userId);
    }
}

function pushToUser(userId: number, data: any): void {
    const conns = sseConnections.get(userId);
    if (!conns) return;
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const reply of conns) {
        try {
            reply.raw.write(payload);
        } catch {
            conns.delete(reply);
        }
    }
}

async function sendNotification(
    userId: number,
    payload: NotificationPayload
): Promise<number> {
    const db = getDatabase();
    const [id] = await db('notifications').insert({
        user_id: userId,
        title: payload.title,
        message: payload.message || null,
        link: payload.link || null,
        type: payload.type || 'info',
        plugin_id: payload.pluginId || null,
        tenant_id: payload.tenantId ?? null,
        urgent: payload.urgent ?? false,
        category: payload.category || null,
        is_read: false,
        created_at: new Date(),
    });

    const notification = await db('notifications').where('id', id).first();

    // Ergaenze Toast-Metadaten fuer den SSE-Push
    const pushData: any = { type: 'notification', notification };
    if (payload.urgent) {
        pushData.toast = {
            urgent: true,
            duration: payload.duration ?? 5000,
        };
    }
    pushToUser(userId, pushData);

    return id;
}

async function sendToMultipleUsers(
    userIds: number[],
    payload: NotificationPayload
): Promise<void> {
    for (const userId of userIds) {
        await sendNotification(userId, payload);
    }
}

async function broadcastNotification(
    payload: NotificationPayload,
    tenantId?: number
): Promise<void> {
    const db = getDatabase();
    // Alle aktiven User (oder nur im Tenant) ermitteln
    let query = db('users').select('id').where('is_active', true);
    if (tenantId) {
        query = query.whereIn('id',
            db('user_tenant_assignments').select('user_id').where('tenant_id', tenantId)
        );
    }
    const users = await query;
    for (const user of users) {
        await sendNotification(user.id, { ...payload, tenantId: tenantId ?? null });
    }
}

declare module 'fastify' {
    interface FastifyInstance {
        notify: {
            send: (userId: number, payload: NotificationPayload) => Promise<number>;
            sendToMany: (userIds: number[], payload: NotificationPayload) => Promise<void>;
            broadcast: (payload: NotificationPayload, tenantId?: number) => Promise<void>;
        };
    }
}

/**
 * fp()-Plugin: Nur der Decorator (fastify.notify), damit andere Plugins darauf zugreifen koennen.
 * fp() bricht die Fastify-Kapselung auf – Routen duerfen hier NICHT registriert werden,
 * da sie sonst den Prefix aus fastify.register() verlieren.
 */
async function notificationDecorator(fastify: FastifyInstance): Promise<void> {
    fastify.decorate('notify', {
        send: sendNotification,
        sendToMany: sendToMultipleUsers,
        broadcast: broadcastNotification,
    });

    console.log('[Notifications] Decorator initialisiert');
}

/**
 * Gekapselte Routen (KEIN fp()!) – respektieren den Prefix aus fastify.register().
 * Wird in server.ts separat mit { prefix: '/api/auth' } registriert.
 */
export async function notificationRoutes(fastify: FastifyInstance): Promise<void> {
    // GET /api/auth/notifications – Letzte Benachrichtigungen
    fastify.get('/notifications', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const userId = request.user.userId;

        try {
            const notifications = await db('notifications')
                .where('user_id', userId)
                .orderBy('created_at', 'desc')
                .limit(30);

            const unreadCount = await db('notifications')
                .where({ user_id: userId, is_read: false })
                .count('id as count')
                .first();

            return reply.send({
                notifications,
                unreadCount: Number(unreadCount?.count || 0),
            });
        } catch {
            // Tabelle existiert evtl noch nicht
            return reply.send({ notifications: [], unreadCount: 0 });
        }
    });

    // PUT /api/auth/notifications/:id/read
    fastify.put('/notifications/:id/read', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const { id } = request.params as { id: string };
        const userId = request.user.userId;

        await db('notifications')
            .where({ id, user_id: userId })
            .update({ is_read: true });

        return reply.send({ success: true });
    });

    // PUT /api/auth/notifications/read-all
    fastify.put('/notifications/read-all', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const userId = request.user.userId;

        await db('notifications')
            .where({ user_id: userId, is_read: false })
            .update({ is_read: true });

        return reply.send({ success: true });
    });

    // GET /api/auth/notifications/stream – SSE
    fastify.get('/notifications/stream', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = request.user.userId;

        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        reply.raw.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

        addSSEConnection(userId, reply);

        // Keep-alive ping every 30s
        const keepAlive = setInterval(() => {
            try {
                reply.raw.write(': keep-alive\n\n');
            } catch {
                clearInterval(keepAlive);
                removeSSEConnection(userId, reply);
            }
        }, 30_000);

        request.raw.on('close', () => {
            clearInterval(keepAlive);
            removeSSEConnection(userId, reply);
        });
    });

    console.log('[Notifications] Routen registriert');
}

export { NotificationPayload, sendNotification, pushToUser };
export default fp(notificationDecorator, { name: 'notificationService', dependencies: ['auditLog'] });
