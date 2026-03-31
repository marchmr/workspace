import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cron, { ScheduledTask } from 'node-cron';
import { getDatabase } from '../core/database.js';

interface SchedulerTaskOptions {
    id: string;
    name: string;
    cron: string;
    handler: () => Promise<void> | void;
    pluginId?: string;
}

interface SchedulerApi {
    register: (opts: SchedulerTaskOptions) => Promise<void>;
    unregister: (taskId: string) => Promise<void>;
    stopAll: () => void;
}

const activeTasks = new Map<string, ScheduledTask>();

async function schedulerPlugin(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    const scheduler: SchedulerApi = {
        async register(opts: SchedulerTaskOptions): Promise<void> {
            if (!cron.validate(opts.cron)) {
                console.error(`[Scheduler] Ungueltige Cron-Expression fuer '${opts.id}': ${opts.cron}`);
                return;
            }

            // In DB registrieren/aktualisieren
            const existing = await db('scheduled_tasks').where('task_id', opts.id).first();
            if (existing) {
                await db('scheduled_tasks').where('task_id', opts.id).update({
                    name: opts.name,
                    cron_expression: opts.cron,
                    plugin_id: opts.pluginId || null,
                });
            } else {
                await db('scheduled_tasks').insert({
                    task_id: opts.id,
                    name: opts.name,
                    cron_expression: opts.cron,
                    plugin_id: opts.pluginId || null,
                    is_active: true,
                });
            }

            // Bestehenden Task stoppen falls vorhanden
            if (activeTasks.has(opts.id)) {
                activeTasks.get(opts.id)!.stop();
                activeTasks.delete(opts.id);
            }

            // Task nur starten wenn is_active
            const taskRecord = await db('scheduled_tasks').where('task_id', opts.id).first();
            if (taskRecord && !taskRecord.is_active) {
                console.log(`[Scheduler] Task '${opts.id}' registriert aber deaktiviert`);
                return;
            }

            const task = cron.schedule(opts.cron, async () => {
                const startedAt = new Date();
                const runId = (await db('scheduled_task_runs').insert({
                    task_id: opts.id,
                    started_at: startedAt,
                    status: 'running',
                }))[0];

                try {
                    await opts.handler();
                    const finishedAt = new Date();
                    await db('scheduled_task_runs').where('id', runId).update({
                        status: 'success',
                        finished_at: finishedAt,
                        duration_ms: finishedAt.getTime() - startedAt.getTime(),
                    });
                    await db('scheduled_tasks').where('task_id', opts.id).update({
                        last_run_at: finishedAt,
                    });
                } catch (error: any) {
                    const finishedAt = new Date();
                    await db('scheduled_task_runs').where('id', runId).update({
                        status: 'error',
                        finished_at: finishedAt,
                        duration_ms: finishedAt.getTime() - startedAt.getTime(),
                        error_message: error?.message || String(error),
                    });
                    console.error(`[Scheduler] Fehler in Task '${opts.id}':`, error?.message);
                }
            });

            activeTasks.set(opts.id, task);
            console.log(`[Scheduler] Task '${opts.id}' registriert (${opts.cron})`);
        },

        async unregister(taskId: string): Promise<void> {
            if (activeTasks.has(taskId)) {
                activeTasks.get(taskId)!.stop();
                activeTasks.delete(taskId);
            }
            await db('scheduled_tasks').where('task_id', taskId).delete();
            console.log(`[Scheduler] Task '${taskId}' entfernt`);
        },

        stopAll(): void {
            for (const [id, task] of activeTasks) {
                task.stop();
                console.log(`[Scheduler] Task '${id}' gestoppt`);
            }
            activeTasks.clear();
        },
    };

    fastify.decorate('scheduler', scheduler);

    // Core-Task: Alte Task-Runs aufraeumen (aelter als 30 Tage)
    await scheduler.register({
        id: 'core.cleanup-task-runs',
        name: 'Task-Run-History bereinigen',
        cron: '0 3 * * *', // Taeglich um 03:00
        handler: async () => {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const deleted = await db('scheduled_task_runs')
                .where('started_at', '<', thirtyDaysAgo)
                .delete();
            if (deleted > 0) {
                console.log(`[Scheduler] ${deleted} alte Task-Runs bereinigt`);
            }
        },
    });

    // Core-Task: Automatischer Update-Check (Sekunden-Intervall via setInterval)
    let updateCheckTimer: ReturnType<typeof setInterval> | null = null;
    let currentUpdateCheckIntervalMs = 0;
    let lastNotifiedUpdateKey = ''; // Verhindert Spam bei gleichem Update

    async function runUpdateCheck(): Promise<void> {
        try {
            const { checkCoreUpdate, getUpdateBranch } = await import('./updater.js');
            const branch = await getUpdateBranch();
            const result = await checkCoreUpdate(branch);

            if (!result.available || !result.remote) return;

            // Eindeutigen Schluessel fuer dieses Update erzeugen (verhindert mehrfache Benachrichtigungen)
            const updateKey = `${result.branch}:${result.remote.version || result.remote.commitHash || ''}`;
            if (updateKey === lastNotifiedUpdateKey) return;
            lastNotifiedUpdateKey = updateKey;

            // Alle Admin-User mit updates.manage-Berechtigung ermitteln
            const adminUserIds = await getAdminUserIdsWithPermission('updates.manage');
            if (adminUserIds.length === 0) return;

            const branchLabels: Record<string, string> = {
                main: 'Main (Stabil)',
                experimental: 'Experimental',
            };

            let title = 'Update verfuegbar';
            let message = '';
            if (result.branch === 'experimental') {
                title = 'Neuer Commit verfuegbar';
                message = `Branch: ${branchLabels[result.branch]} - Commit: ${result.remote.commitHash?.slice(0, 8) || 'unbekannt'}`;
            } else {
                title = `Update v${result.remote.version || '?'} verfuegbar`;
                message = `Branch: ${branchLabels[result.branch]}${result.remote.releaseName ? ` - ${result.remote.releaseName}` : ''}`;
            }

            if (fastify.notify) {
                await fastify.notify.sendToMany(adminUserIds, {
                    title,
                    message,
                    link: '/admin/updates',
                    type: 'info',
                    category: 'system.update',
                    urgent: false,
                });
            }

            console.log(`[UpdateCheck] Update-Benachrichtigung gesendet: ${title}`);
        } catch (error: any) {
            console.error('[UpdateCheck] Fehler beim automatischen Update-Check:', error?.message || error);
        }
    }

    async function getAdminUserIdsWithPermission(permissionKey: string): Promise<number[]> {
        try {
            // Super-Admins haben immer alle Berechtigungen
            const superAdminIds = await db('user_roles')
                .join('roles', 'user_roles.role_id', 'roles.id')
                .where('roles.name', 'Super-Admin')
                .pluck('user_roles.user_id');

            // User mit expliziter Berechtigung ueber Rolle
            const roleUserIds = await db('user_roles')
                .join('role_permissions', 'user_roles.role_id', 'role_permissions.role_id')
                .join('permissions', 'role_permissions.permission_id', 'permissions.id')
                .where('permissions.key', permissionKey)
                .pluck('user_roles.user_id');

            // User mit direkter Berechtigung
            const directUserIds = await db('user_permissions')
                .join('permissions', 'user_permissions.permission_id', 'permissions.id')
                .where('permissions.key', permissionKey)
                .pluck('user_permissions.user_id');

            const allIds = new Set<number>([
                ...superAdminIds.map(Number),
                ...roleUserIds.map(Number),
                ...directUserIds.map(Number),
            ]);

            // Nur aktive User zurueckgeben
            if (allIds.size === 0) return [];
            const activeUsers = await db('users')
                .whereIn('id', Array.from(allIds))
                .where('is_active', true)
                .pluck('id');

            return activeUsers.map(Number);
        } catch {
            return [];
        }
    }

    async function startOrRestartUpdateCheckTimer(): Promise<void> {
        try {
            const { getUpdateCheckInterval } = await import('./updater.js');
            const intervalSeconds = await getUpdateCheckInterval();
            const intervalMs = intervalSeconds * 1000;

            // Nur neu starten wenn sich das Intervall geaendert hat
            if (updateCheckTimer && currentUpdateCheckIntervalMs === intervalMs) return;

            if (updateCheckTimer) {
                clearInterval(updateCheckTimer);
                updateCheckTimer = null;
            }

            currentUpdateCheckIntervalMs = intervalMs;
            updateCheckTimer = setInterval(() => {
                void runUpdateCheck();
            }, intervalMs);

            console.log(`[UpdateCheck] Automatischer Check alle ${intervalSeconds}s gestartet`);
        } catch (error: any) {
            console.error('[UpdateCheck] Konnte Update-Check-Timer nicht starten:', error?.message);
        }
    }

    // Update-Check-Timer starten (mit Verzoegerung, damit der Server vollstaendig hochgefahren ist)
    setTimeout(() => {
        void startOrRestartUpdateCheckTimer();
    }, 5000);

    // Periodisch Intervall-Aenderungen pruefen (alle 60s)
    setInterval(() => {
        void startOrRestartUpdateCheckTimer();
    }, 60_000);

    // Timer beim Server-Shutdown aufraeumen
    fastify.addHook('onClose', async () => {
        if (updateCheckTimer) {
            clearInterval(updateCheckTimer);
            updateCheckTimer = null;
        }
    });

    console.log('[Scheduler] Service initialisiert');
}

// Admin-Routen fuer Scheduler-Verwaltung (ohne fp!)
export async function schedulerRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    // GET /api/admin/scheduler – Alle Tasks
    fastify.get('/scheduler', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const tasks = await db('scheduled_tasks').orderBy('created_at', 'desc');
        // Letzten Run pro Task holen
        const enriched = await Promise.all(tasks.map(async (task: any) => {
            const lastRun = await db('scheduled_task_runs')
                .where('task_id', task.task_id)
                .orderBy('started_at', 'desc')
                .first();
            const runCount = await db('scheduled_task_runs')
                .where('task_id', task.task_id)
                .count('id as count')
                .first();
            return {
                ...task,
                last_run: lastRun || null,
                total_runs: runCount?.count || 0,
            };
        }));
        return reply.send(enriched);
    });

    // PUT /api/admin/scheduler/:taskId/toggle – Aktivieren/Deaktivieren
    fastify.put('/scheduler/:taskId/toggle', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { taskId } = request.params as { taskId: string };
        const task = await db('scheduled_tasks').where('task_id', taskId).first();
        if (!task) return reply.status(404).send({ error: 'Task nicht gefunden' });

        const newState = !task.is_active;
        await db('scheduled_tasks').where('task_id', taskId).update({ is_active: newState });

        // Task zur Laufzeit stoppen/starten ist nicht moeglich ohne Re-Register,
        // daher Info zurueckgeben und Neustart empfehlen
        return reply.send({
            success: true,
            is_active: newState,
            message: newState
                ? 'Task aktiviert (wird nach Neustart ausgefuehrt)'
                : 'Task deaktiviert (wird nach Neustart nicht mehr ausgefuehrt)',
        });
    });

    // GET /api/admin/scheduler/:taskId/runs – Run-History
    fastify.get('/scheduler/:taskId/runs', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { taskId } = request.params as { taskId: string };
        const runs = await db('scheduled_task_runs')
            .where('task_id', taskId)
            .orderBy('started_at', 'desc')
            .limit(50);
        return reply.send(runs);
    });
}

export default fp(schedulerPlugin, { name: 'schedulerService' });
