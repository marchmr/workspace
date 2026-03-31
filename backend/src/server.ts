import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { mkdir } from 'fs/promises';
import path from 'path';
import { config } from './core/config.js';
import { getDatabase, testConnection, closeDatabase } from './core/database.js';
import authPlugin from './core/auth.js';
import rateLimiterPlugin from './core/rateLimiter.js';
import permissionsPlugin from './core/permissions.js';
import auditLogPlugin from './services/auditLog.js';
import eventBusPlugin from './services/eventBus.js';
import notificationPlugin, { notificationRoutes } from './services/notificationService.js';
import webhookPlugin, { webhookRoutes } from './services/webhookService.js';
import schedulerPlugin, { schedulerRoutes } from './services/schedulerService.js';
import emailPlugin, { emailRoutes } from './services/emailService.js';
import tenantScopePlugin from './core/tenantScope.js';
import policyEnginePlugin from './core/policyEngine.js';
import auditHelpersPlugin from './core/auditHelpers.js';
import pluginStoragePlugin from './core/pluginStorage.js';
import pdfExportPlugin from './core/pdfExport.js';
import { encrypt, decrypt } from './core/encryption.js';
import { createCrudRoutes, type CrudOptions } from './core/crudGenerator.js';
import { z, validateBody, validateQuery, validateParams } from './core/validation.js';
import { registerCorePermissions, createDefaultRoles } from './core/permissions.js';
import { loadPlugins } from './core/pluginLoader.js';
import websocketPlugin from './services/websocket.js';
import lockServicePlugin, { lockRoutes } from './services/lockService.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import documentsRoutes from './routes/documents.js';
import healthRoutes from './routes/health.js';

const fastify = Fastify({
    logger: {
        level: config.server.env === 'production' ? 'info' : 'debug',
    },
    // L1 Security Fix: trustProxy nur fuer Loopback (Reverse-Proxy auf gleichem Host)
    trustProxy: config.server.env === 'production' ? '127.0.0.1' : true,
});

async function start(): Promise<void> {
    try {
        // Storage-Grundstruktur sicherstellen (auch fuer bestehende Installationen ohne Ordner).
        await mkdir(path.resolve(config.app.uploadsDir, 'documents'), { recursive: true });
        await mkdir(path.resolve(config.app.uploadsDir, 'avatars'), { recursive: true });
        await mkdir(path.resolve(config.app.uploadsDir, 'tenant-logos'), { recursive: true });

        // DB-Verbindung pruefen
        await testConnection();

        // Knex als Decorator
        const db = getDatabase();
        fastify.decorate('db', db);
        fastify.decorate('getTenantId', (request) => request.user?.tenantId ?? null);
        fastify.decorate('encrypt', encrypt);
        fastify.decorate('decrypt', decrypt);
        fastify.decorate('validation', {
            z,
            validateBody,
            validateQuery,
            validateParams,
        });
        fastify.decorate('createCrudRoutes', function createCrudRoutesDecorator(opts: CrudOptions): void {
            createCrudRoutes(this, opts);
        });

        // Core-Plugins registrieren
        await fastify.register(cors, {
            origin: config.server.env === 'production' ? false : true,
            credentials: true,
        });
        await fastify.register(cookie);
        await fastify.register(helmet, {
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    imgSrc: ["'self'", 'data:', 'blob:'],
                    connectSrc: ["'self'", 'ws:', 'wss:'],
                    fontSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    frameAncestors: ["'none'"],
                },
            },
            crossOriginEmbedderPolicy: false, // Kompatibilitaet mit externen Ressourcen
        });
        await fastify.register(multipart, {
            limits: {
                // L2 Security Fix: Limit an konfiguriertes Maximum anpassen
                fileSize: config.documents.maxFileSizeMb * 1024 * 1024,
            },
        });
        await fastify.register(rateLimiterPlugin);
        await fastify.register(authPlugin);
        await fastify.register(permissionsPlugin);
        await fastify.register(auditLogPlugin);
        await fastify.register(auditHelpersPlugin);
        await fastify.register(eventBusPlugin);
        await fastify.register(notificationPlugin);
        await fastify.register(schedulerPlugin);
        await fastify.register(emailPlugin);
        await fastify.register(tenantScopePlugin);
        await fastify.register(policyEnginePlugin);
        await fastify.register(websocketPlugin);
        await fastify.register(lockServicePlugin);
        await fastify.register(pluginStoragePlugin);
        await fastify.register(pdfExportPlugin);

        // Core-Permissions und Rollen initialisieren
        await registerCorePermissions();
        await createDefaultRoles();

        // Core API-Routen
        await fastify.register(authRoutes, { prefix: '/api/auth' });
        await fastify.register(notificationRoutes, { prefix: '/api/auth' });
        await fastify.register(adminRoutes, { prefix: '/api/admin' });
        await fastify.register(webhookPlugin);
        await fastify.register(webhookRoutes, { prefix: '/api/admin/webhooks' });
        await fastify.register(schedulerRoutes, { prefix: '/api/admin' });
        await fastify.register(emailRoutes, { prefix: '/api/admin' });
        await fastify.register(documentsRoutes, { prefix: '/api/documents' });
        await fastify.register(lockRoutes, { prefix: '/api/locks' });

        // Dynamisch Plugins laden
        await loadPlugins(fastify);

        // Health-Check (erweitert – mit DB-Ping, Uptime, Disk)
        await fastify.register(healthRoutes);

        // Server starten
        await fastify.listen({ port: config.server.port, host: '0.0.0.0' });
        console.log(`[Server] MIKE WorkSpace v${config.app.version} laeuft auf Port ${config.server.port}`);

        // Update-Erkennung: Bei Versions-/Commit-Änderung Audit-Log schreiben
        try {
            const { execFile } = await import('child_process');
            const { promisify } = await import('util');
            const execFileAsync = promisify(execFile);
            let currentCommit: string | null = null;
            try {
                const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: config.app.rootDir });
                currentCommit = stdout.trim() || null;
            } catch { /* kein git */ }

            const lastVersion = await db('settings').where({ key: 'system.last_version' }).whereNull('tenant_id').first();
            const lastCommitRow = await db('settings').where({ key: 'system.last_commit' }).whereNull('tenant_id').first();
            const lastVer = lastVersion?.value_encrypted || null;
            const lastCom = lastCommitRow?.value_encrypted || null;

            const versionChanged = lastVer !== null && lastVer !== config.app.version;
            const commitChanged = lastCom !== null && currentCommit !== null && lastCom !== currentCommit;

            if (versionChanged || commitChanged) {
                await fastify.audit.log({
                    action: 'system.update.applied',
                    category: 'admin',
                    entityType: 'system',
                    newState: {
                        previousVersion: lastVer,
                        newVersion: config.app.version,
                        previousCommit: lastCom,
                        newCommit: currentCommit,
                    },
                });
                console.log(`[Server] Update erkannt: ${lastVer || '?'}@${lastCom || '?'} → v${config.app.version}@${currentCommit || '?'}`);
            }

            // Aktuelle Version/Commit speichern
            const upsert = async (key: string, value: string) => {
                const existing = await db('settings').where({ key }).whereNull('tenant_id').first();
                if (existing) {
                    await db('settings').where({ id: existing.id }).update({ value_encrypted: value, category: 'system' });
                } else {
                    await db('settings').insert({ key, value_encrypted: value, category: 'system', tenant_id: null });
                }
            };
            await upsert('system.last_version', config.app.version);
            if (currentCommit) await upsert('system.last_commit', currentCommit);
        } catch (err) {
            console.error('[Server] Update-Erkennung fehlgeschlagen:', err);
        }

        // Abgelaufene/revoked Refresh-Tokens bereinigen (M2 Security Fix)
        try {
            const cleaned = await db('refresh_tokens')
                .where('expires_at', '<', new Date())
                .orWhere('is_revoked', true)
                .delete();
            if (cleaned > 0) console.log(`[Server] ${cleaned} abgelaufene Refresh-Tokens bereinigt`);
        } catch { /* Tabelle existiert evtl noch nicht */ }
    } catch (error) {
        console.error('[Server] Start fehlgeschlagen:', error);
        process.exit(1);
    }
}

// Graceful Shutdown
async function shutdown(): Promise<void> {
    console.log('[Server] Herunterfahren...');
    try { fastify.scheduler?.stopAll(); } catch { /* */ }
    await fastify.close();
    await closeDatabase();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
