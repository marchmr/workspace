/**
 * Entity Lock Service (Pessimistic Locking)
 *
 * In-Memory Lock Manager fuer gleichzeitige Bearbeitung.
 * Locks sind fluechtig — bei Server-Restart gehen sie verloren (gewollt).
 *
 * Features:
 * - acquire/release/heartbeat fuer Entity-Locks
 * - Automatisches Cleanup bei Heartbeat-Timeout (1 Minute)
 * - WebSocket-Push bei Lock-Aenderungen
 * - Audit-Log Integration
 * - REST API fuer Frontend
 * - Admin Force-Release
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { requirePermission } from '../core/permissions.js';

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

interface EntityLock {
    entityType: string;
    entityId: string;
    userId: number;
    username: string;
    displayName: string;
    acquiredAt: Date;
    lastHeartbeat: Date;
    tenantId: number;
}

interface LockUserInfo {
    userId: number;
    username: string;
    displayName: string;
    tenantId: number;
}

interface LockResult {
    acquired: boolean;
    lock?: EntityLock;
    lockedBy?: {
        userId: number;
        username: string;
        displayName: string;
        since: string;
    };
}

/* ════════════════════════════════════════════
   Lock Manager
   ════════════════════════════════════════════ */

// Key format: "entityType:entityId"
const locks = new Map<string, EntityLock>();

const HEARTBEAT_TIMEOUT_MS = 60_000;  // 1 Minute
const CLEANUP_INTERVAL_MS = 10_000;   // Alle 10 Sekunden

function lockKey(entityType: string, entityId: string): string {
    return `${entityType}:${entityId}`;
}

function acquire(entityType: string, entityId: string, user: LockUserInfo): LockResult {
    const key = lockKey(entityType, entityId);
    const existing = locks.get(key);

    if (existing) {
        // Gleicher User darf re-acquiren
        if (existing.userId === user.userId) {
            existing.lastHeartbeat = new Date();
            return { acquired: true, lock: existing };
        }

        // Von jemand anderem gesperrt
        return {
            acquired: false,
            lockedBy: {
                userId: existing.userId,
                username: existing.username,
                displayName: existing.displayName,
                since: existing.acquiredAt.toISOString(),
            },
        };
    }

    const lock: EntityLock = {
        entityType,
        entityId,
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        acquiredAt: new Date(),
        lastHeartbeat: new Date(),
        tenantId: user.tenantId,
    };

    locks.set(key, lock);
    return { acquired: true, lock };
}

function release(entityType: string, entityId: string, userId: number): boolean {
    const key = lockKey(entityType, entityId);
    const existing = locks.get(key);
    if (!existing || existing.userId !== userId) return false;
    locks.delete(key);
    return true;
}

function heartbeat(entityType: string, entityId: string, userId: number): boolean {
    const key = lockKey(entityType, entityId);
    const existing = locks.get(key);
    if (!existing || existing.userId !== userId) return false;
    existing.lastHeartbeat = new Date();
    return true;
}

function forceRelease(entityType: string, entityId: string): EntityLock | null {
    const key = lockKey(entityType, entityId);
    const existing = locks.get(key);
    if (!existing) return null;
    locks.delete(key);
    return existing;
}

function getLock(entityType: string, entityId: string): EntityLock | null {
    return locks.get(lockKey(entityType, entityId)) || null;
}

function getLocksForEntities(entityType: string, entityIds: string[]): Record<string, EntityLock> {
    const result: Record<string, EntityLock> = {};
    for (const id of entityIds) {
        const lock = locks.get(lockKey(entityType, id));
        if (lock) result[id] = lock;
    }
    return result;
}

function getUserLocks(userId: number): EntityLock[] {
    const result: EntityLock[] = [];
    for (const lock of locks.values()) {
        if (lock.userId === userId) result.push(lock);
    }
    return result;
}

function releaseAllUserLocks(userId: number): EntityLock[] {
    const released: EntityLock[] = [];
    for (const [key, lock] of locks.entries()) {
        if (lock.userId === userId) {
            locks.delete(key);
            released.push(lock);
        }
    }
    return released;
}

function getAllLocks(): EntityLock[] {
    return Array.from(locks.values());
}

function isLocked(entityType: string, entityId: string): boolean {
    return locks.has(lockKey(entityType, entityId));
}

/* ════════════════════════════════════════════
   Fastify Type Declaration
   ════════════════════════════════════════════ */

declare module 'fastify' {
    interface FastifyInstance {
        locks: {
            acquire: (entityType: string, entityId: string, user: LockUserInfo) => LockResult;
            release: (entityType: string, entityId: string, userId: number) => boolean;
            heartbeat: (entityType: string, entityId: string, userId: number) => boolean;
            forceRelease: (entityType: string, entityId: string) => EntityLock | null;
            getLock: (entityType: string, entityId: string) => EntityLock | null;
            getLocksForEntities: (entityType: string, entityIds: string[]) => Record<string, EntityLock>;
            getUserLocks: (userId: number) => EntityLock[];
            releaseAllUserLocks: (userId: number) => EntityLock[];
            getAllLocks: () => EntityLock[];
            isLocked: (entityType: string, entityId: string) => boolean;
        };
    }
}

/* ════════════════════════════════════════════
   Decorator Plugin (fp - bricht Kapselung auf)
   ════════════════════════════════════════════ */

async function lockServiceDecorator(fastify: FastifyInstance): Promise<void> {
    fastify.decorate('locks', {
        acquire,
        release,
        heartbeat,
        forceRelease,
        getLock,
        getLocksForEntities,
        getUserLocks,
        releaseAllUserLocks,
        getAllLocks,
        isLocked,
    });

    // Cleanup-Interval: Abgelaufene Locks entfernen
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        const expired: EntityLock[] = [];

        for (const [key, lock] of locks.entries()) {
            if (now - lock.lastHeartbeat.getTime() > HEARTBEAT_TIMEOUT_MS) {
                locks.delete(key);
                expired.push(lock);
            }
        }

        for (const lock of expired) {
            console.log(`[LockService] Lock expired: ${lock.entityType}:${lock.entityId} (User ${lock.username})`);

            // WebSocket broadcast
            try {
                fastify.ws.sendToTenant(lock.tenantId, {
                    type: 'lock.expired',
                    data: { entityType: lock.entityType, entityId: lock.entityId },
                });
            } catch { /* WS evtl. nicht bereit */ }

            // Audit-Log
            try {
                fastify.audit?.log({
                    action: 'lock.expired',
                    category: 'lock',
                    entityType: lock.entityType,
                    entityId: lock.entityId,
                    tenantId: lock.tenantId,
                });
            } catch { /* Audit evtl. nicht bereit */ }
        }
    }, CLEANUP_INTERVAL_MS);

    fastify.addHook('onClose', () => {
        clearInterval(cleanupInterval);
    });

    console.log(`[LockService] Initialisiert (Timeout: ${HEARTBEAT_TIMEOUT_MS / 1000}s, Cleanup: ${CLEANUP_INTERVAL_MS / 1000}s)`);
}

/* ════════════════════════════════════════════
   REST API Routes (gekapselt, mit Prefix)
   ════════════════════════════════════════════ */

export async function lockRoutes(fastify: FastifyInstance): Promise<void> {
    // POST /api/locks/acquire
    fastify.post('/acquire', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { entityType, entityId } = request.body as { entityType: string; entityId: string };
        if (!entityType || !entityId) {
            return reply.status(400).send({ error: 'entityType und entityId erforderlich' });
        }

        const user: LockUserInfo = {
            userId: request.user.userId,
            username: request.user.username || '',
            displayName: request.user.username || '',
            tenantId: request.user.tenantId,
        };

        const result = fastify.locks.acquire(entityType, entityId, user);

        if (result.acquired) {
            // WebSocket: Lock-Acquired an alle im Tenant
            fastify.ws.sendToTenant(request.user.tenantId, {
                type: 'lock.acquired',
                data: {
                    entityType,
                    entityId,
                    userId: user.userId,
                    username: user.username,
                    displayName: user.displayName,
                },
            });

            // Audit-Log
            fastify.audit?.log({
                action: 'lock.acquired',
                category: 'lock',
                entityType,
                entityId,
                tenantId: user.tenantId,
            }, request);
        }

        return reply.status(result.acquired ? 200 : 409).send(result);
    });

    // POST /api/locks/release
    fastify.post('/release', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { entityType, entityId } = request.body as { entityType: string; entityId: string };
        if (!entityType || !entityId) {
            return reply.status(400).send({ error: 'entityType und entityId erforderlich' });
        }

        const released = fastify.locks.release(entityType, entityId, request.user.userId);

        if (released) {
            fastify.ws.sendToTenant(request.user.tenantId, {
                type: 'lock.released',
                data: { entityType, entityId },
            });

            fastify.audit?.log({
                action: 'lock.released',
                category: 'lock',
                entityType,
                entityId,
                tenantId: request.user.tenantId,
            }, request);
        }

        return reply.send({ released });
    });

    // POST /api/locks/heartbeat
    fastify.post('/heartbeat', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { entityType, entityId } = request.body as { entityType: string; entityId: string };
        if (!entityType || !entityId) {
            return reply.status(400).send({ error: 'entityType und entityId erforderlich' });
        }

        const ok = fastify.locks.heartbeat(entityType, entityId, request.user.userId);
        return reply.send({ ok });
    });

    // POST /api/locks/request-access — Zugriff anfragen (sendet Notification an Lock-Holder)
    fastify.post('/request-access', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { entityType, entityId } = request.body as { entityType: string; entityId: string };
        if (!entityType || !entityId) {
            return reply.status(400).send({ error: 'entityType und entityId erforderlich' });
        }

        const lock = fastify.locks.getLock(entityType, entityId);
        if (!lock) {
            return reply.status(404).send({ error: 'Kein aktiver Lock fuer diese Entitaet' });
        }

        if (lock.userId === request.user.userId) {
            return reply.send({ sent: false, reason: 'Eigener Lock' });
        }

        // Urgent Notification an Lock-Holder
        await fastify.notify.send(lock.userId, {
            title: `${request.user.username} moechte ${entityType} #${entityId} bearbeiten`,
            message: 'Bitte Bearbeitung beenden oder Sperre freigeben.',
            type: 'warning',
            urgent: true,
            duration: 8000,
            category: 'lock',
        });

        return reply.send({ sent: true });
    });

    // GET /api/locks/query?entityType=...&entityIds=1,2,3
    fastify.get('/query', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { entityType, entityIds } = request.query as { entityType: string; entityIds: string };
        if (!entityType || !entityIds) {
            return reply.status(400).send({ error: 'entityType und entityIds erforderlich' });
        }

        const ids = entityIds.split(',').map(id => id.trim()).filter(Boolean);
        const result = fastify.locks.getLocksForEntities(entityType, ids);

        // Nur sichere Felder zurueckgeben
        const safe: Record<string, any> = {};
        for (const [id, lock] of Object.entries(result)) {
            safe[id] = {
                userId: lock.userId,
                username: lock.username,
                displayName: lock.displayName,
                acquiredAt: lock.acquiredAt.toISOString(),
                lastHeartbeat: lock.lastHeartbeat.toISOString(),
            };
        }

        return reply.send({ locks: safe });
    });

    // GET /api/locks/mine
    fastify.get('/mine', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userLocks = fastify.locks.getUserLocks(request.user.userId);
        return reply.send({
            locks: userLocks.map(l => ({
                entityType: l.entityType,
                entityId: l.entityId,
                acquiredAt: l.acquiredAt.toISOString(),
                lastHeartbeat: l.lastHeartbeat.toISOString(),
            })),
        });
    });

    // GET /api/locks/all — Admin
    fastify.get('/all', { preHandler: [requirePermission('locks.manage')] }, async (_request: FastifyRequest, reply: FastifyReply) => {
        const allLocks = fastify.locks.getAllLocks();
        return reply.send({
            locks: allLocks.map(l => ({
                entityType: l.entityType,
                entityId: l.entityId,
                userId: l.userId,
                username: l.username,
                displayName: l.displayName,
                acquiredAt: l.acquiredAt.toISOString(),
                lastHeartbeat: l.lastHeartbeat.toISOString(),
                tenantId: l.tenantId,
            })),
        });
    });

    // DELETE /api/locks/:entityType/:entityId — Admin Force Release
    fastify.delete('/:entityType/:entityId', { preHandler: [requirePermission('locks.manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { entityType, entityId } = request.params as { entityType: string; entityId: string };
        const released = fastify.locks.forceRelease(entityType, entityId);

        if (!released) {
            return reply.status(404).send({ error: 'Kein aktiver Lock fuer diese Entitaet' });
        }

        // WebSocket an alle
        fastify.ws.sendToTenant(released.tenantId, {
            type: 'lock.released',
            data: { entityType, entityId },
        });

        // Audit: Admin hat Lock erzwungen
        fastify.audit?.log({
            action: 'lock.forced',
            category: 'admin',
            entityType,
            entityId,
            tenantId: request.user.tenantId,
            newState: {
                forceReleasedFrom: released.username,
                forceReleasedFromUserId: released.userId,
            },
        }, request);

        // Notification an betroffenen User
        await fastify.notify.send(released.userId, {
            title: `Sperre fuer ${entityType} #${entityId} aufgehoben`,
            message: `Ein Administrator hat Ihre Sperre aufgehoben.`,
            type: 'warning',
            urgent: true,
            category: 'lock',
        });

        return reply.send({ released: true, previousOwner: released.username });
    });

    console.log('[LockService] Routen registriert');
}

export { EntityLock, LockUserInfo, LockResult };
export default fp(lockServiceDecorator, { name: 'lockService', dependencies: ['websocket', 'notificationService'] });
