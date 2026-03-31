/**
 * WebSocket Service
 *
 * Echtzeit-Push ueber WebSocket fuer:
 * - Neue Notifications
 * - Dashboard-Updates
 * - Audit-Log Live-Feed
 *
 * Client verbindet: ws://host/api/ws?token=<jwt>
 * Server sendet JSON: { type: string, data: any }
 */

import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

interface WebSocketLike {
    readyState: number;
    close: (code?: number, reason?: string) => void;
    ping: () => void;
    send: (data: string) => void;
    on: (event: string, listener: (...args: any[]) => void) => void;
}

interface ConnectedClient {
    ws: WebSocketLike;
    userId: number;
    tenantId: number;
    permissions: string[];
}

const clients = new Set<ConnectedClient>();
const WS_OPEN = 1;

async function websocketPlugin(fastify: FastifyInstance): Promise<void> {
    await fastify.register(import('@fastify/websocket'));

    // WebSocket Route mit JWT-Auth
    fastify.register(async function wsRoutes(wsApp) {
        wsApp.get('/api/ws', { websocket: true, config: { policy: { public: true } } }, (socket, request) => {
            // Token aus Query oder Header
            const token = (request.query as any)?.token;
            if (!token) {
                socket.close(4001, 'Token erforderlich');
                return;
            }

            let user: any;
            try {
                user = fastify.jwt.verify(token);
            } catch {
                socket.close(4001, 'Ungueltiger Token');
                return;
            }

            const client: ConnectedClient = {
                ws: socket,
                userId: user.userId,
                tenantId: user.tenantId,
                permissions: user.permissions || [],
            };
            clients.add(client);

            console.log(`[WebSocket] Client verbunden: User ${user.userId} (${clients.size} aktiv)`);

            // Ping/Pong Keepalive
            const pingInterval = setInterval(() => {
                if (socket.readyState === WS_OPEN) {
                    socket.ping();
                }
            }, 30000);

            socket.on('close', () => {
                clients.delete(client);
                clearInterval(pingInterval);
                console.log(`[WebSocket] Client getrennt: User ${user.userId} (${clients.size} aktiv)`);

                // Auto-Release Locks wenn keine weiteren WS-Verbindungen des Users bestehen
                const hasOtherConnections = Array.from(clients).some(c => c.userId === user.userId);
                if (!hasOtherConnections) {
                    try {
                        const released = fastify.locks?.releaseAllUserLocks(user.userId) || [];
                        for (const lock of released) {
                            console.log(`[WebSocket] Auto-Release Lock: ${lock.entityType}:${lock.entityId} (User ${user.userId})`);
                            fastify.ws.sendToTenant(lock.tenantId, {
                                type: 'lock.released',
                                data: { entityType: lock.entityType, entityId: lock.entityId },
                            });
                            fastify.audit?.log({
                                action: 'lock.expired',
                                category: 'lock',
                                entityType: lock.entityType,
                                entityId: lock.entityId,
                                tenantId: lock.tenantId,
                            });
                        }
                    } catch { /* locks evtl. noch nicht initialisiert */ }
                }
            });

            socket.on('error', () => {
                clients.delete(client);
                clearInterval(pingInterval);
            });

            // Willkommensnachricht
            send(client, { type: 'connected', data: { userId: user.userId } });
        });
    });

    // Decorator fuer Server-Push
    fastify.decorate('ws', {
        /** An einen bestimmten User senden */
        sendToUser: (userId: number, message: { type: string; data: any }) => {
            for (const client of clients) {
                if (client.userId === userId) {
                    send(client, message);
                }
            }
        },
        /** An alle Clients eines Mandanten senden */
        sendToTenant: (tenantId: number, message: { type: string; data: any }) => {
            for (const client of clients) {
                if (client.tenantId === tenantId) {
                    send(client, message);
                }
            }
        },
        /** An alle verbundenen Clients senden */
        broadcast: (message: { type: string; data: any }) => {
            for (const client of clients) {
                send(client, message);
            }
        },
        /** Anzahl verbundener Clients */
        clientCount: () => clients.size,
    });

    // EventBus anbinden: relevante Events an WebSocket-Clients pushen
    try {
        fastify.events.on('*', async (data: any, meta: any) => {
            const event = meta?.event || 'unknown';
            // Notification-Events direkt an betroffenen User pushen
            if (event.startsWith('notification.')) {
                const userId = data?.userId;
                if (userId) {
                    fastify.ws.sendToUser(userId, { type: 'notification', data });
                }
                return;
            }

            // Andere Events an alle Admins broadcasten (Audit-Feed)
            for (const client of clients) {
                if (client.permissions.includes('*') || client.permissions.includes('audit.view')) {
                    send(client, { type: 'event', data: { event, ...data } });
                }
            }
        });
    } catch {
        // EventBus evtl. noch nicht bereit
    }

    console.log('[WebSocket] Initialisiert');
}

function send(client: ConnectedClient, message: { type: string; data: any }): void {
    try {
        if (client.ws.readyState === WS_OPEN) {
            client.ws.send(JSON.stringify(message));
        }
    } catch {
        // Client vermutlich disconnected
    }
}

// Type Declaration
declare module 'fastify' {
    interface FastifyInstance {
        ws: {
            sendToUser: (userId: number, message: { type: string; data: any }) => void;
            sendToTenant: (tenantId: number, message: { type: string; data: any }) => void;
            broadcast: (message: { type: string; data: any }) => void;
            clientCount: () => number;
        };
    }
}

export default fp(websocketPlugin, { name: 'websocket', dependencies: ['auth'] });
