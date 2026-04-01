import { createHash, randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { once } from 'events';
import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../../../backend/src/core/database.js';
import { requirePermission } from '../../../backend/src/core/permissions.js';
import { config } from '../../../backend/src/core/config.js';
import {
    buildSafeStoragePath,
    normalizeFolderPath,
    sanitizeFileName,
    scanStoredFileForMalware,
    validateUploadedFileFromPath,
} from '../../../backend/src/services/fileSecurity.js';

const PLUGIN_ID = 'dateiaustausch';
const STORAGE_ROOT = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID);

type WorkflowStatus = 'pending' | 'clean' | 'rejected' | 'reviewed';

type SessionRow = {
    id: number;
    tenant_id: number;
    customer_id: number;
    email_normalized: string;
    expires_at: string;
    revoked_at: string | null;
};

type UploadActor = {
    type: 'customer' | 'admin';
    userId: number | null;
    email: string | null;
    display: string | null;
    ip: string | null;
    userAgent: string | null;
};

function hashValue(value: string): string {
    return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function toIso(input: unknown): string | null {
    if (!input) return null;
    const date = new Date(String(input));
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString();
}

function buildStorageKey(tenantId: number, zone: 'quarantine' | 'clean' | 'rejected', fileName: string): string {
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const ext = path.extname(fileName).toLowerCase().slice(0, 12);
    return `${tenantId}/${zone}/${year}/${month}/${randomUUID().replace(/-/g, '')}${ext}`;
}

async function saveTempFileToStorage(storageKey: string, sourcePath: string): Promise<void> {
    const absPath = buildSafeStoragePath(STORAGE_ROOT, storageKey);
    await fs.mkdir(path.dirname(absPath), { recursive: true, mode: 0o700 });
    await fs.copyFile(sourcePath, absPath);
    await fs.chmod(absPath, 0o600).catch(() => undefined);
}

async function streamUploadPartToTempFile(filePart: any, maxBytes: number): Promise<{ tempDir: string; tempPath: string }> {
    const tempDir = path.join(STORAGE_ROOT, 'tmp', randomUUID());
    await fs.mkdir(tempDir, { recursive: true, mode: 0o700 });

    const tempPath = path.join(tempDir, 'upload.bin');
    const output = createWriteStream(tempPath, { mode: 0o600 });
    let bytes = 0;

    try {
        for await (const chunk of filePart.file) {
            const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += part.length;
            if (bytes > maxBytes) {
                throw new Error(`Datei ist zu groß (max. ${Math.round(maxBytes / (1024 * 1024))} MB).`);
            }
            if (!output.write(part)) {
                await once(output, 'drain');
            }
        }
        output.end();
        await once(output, 'finish');
        return { tempDir, tempPath };
    } catch (error) {
        output.destroy();
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
}

function getFieldValue(fields: Record<string, any> | undefined, key: string): string | undefined {
    const rawField = fields?.[key];
    if (!rawField) return undefined;

    if (Array.isArray(rawField)) {
        const first = rawField[0];
        if (!first) return undefined;
        return typeof first.value === 'string' ? first.value : String(first.value ?? '');
    }

    if (typeof rawField.value === 'string') {
        return rawField.value;
    }
    return String(rawField.value ?? '');
}

async function verifyPublicSessionByToken(db: any, token: string): Promise<SessionRow | null> {
    const tokenHash = hashValue(token);
    const row = await db('vp_public_sessions')
        .where({ token_hash: tokenHash })
        .whereNull('revoked_at')
        .andWhere('expires_at', '>=', db.fn.now())
        .first();

    return row as SessionRow || null;
}

async function getTenantUserIds(db: any, tenantId: number): Promise<number[]> {
    const rows = await db('users as u')
        .join('user_tenants as ut', 'ut.user_id', 'u.id')
        .where('ut.tenant_id', tenantId)
        .andWhere('u.is_active', true)
        .select('u.id')
        .groupBy('u.id');
    return rows.map((row: any) => Number(row.id)).filter((value: number) => Number.isInteger(value) && value > 0);
}

function encodeFileNameForHeader(fileName: string): string {
    return encodeURIComponent(fileName)
        .replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
        .replace(/\*/g, '%2A');
}

function applyHardenedDownloadHeaders(reply: any, mimeType: string, fileName: string): void {
    const encodedName = encodeFileNameForHeader(fileName);
    const sanitizedName = fileName.replace(/"/g, '');
    reply.header('Content-Type', mimeType || 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Cache-Control', 'no-store, max-age=0');
    reply.header('Pragma', 'no-cache');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('Content-Disposition', `attachment; filename="${sanitizedName}"; filename*=UTF-8''${encodedName}`);
}

function normalizeWorkflowStatus(input: unknown): WorkflowStatus | null {
    const value = String(input || '').trim().toLowerCase();
    if (value === 'pending' || value === 'clean' || value === 'rejected' || value === 'reviewed') {
        return value;
    }
    return null;
}

function resolvePublicSessionToken(request: any, fileFields?: Record<string, any>): string {
    return String(
        getFieldValue(fileFields, 'sessionToken')
        || (request.query as any)?.sessionToken
        || (request.body as any)?.sessionToken
        || (request.headers as any)['x-public-session-token']
        || '',
    ).trim();
}

async function loadItemWithDetails(db: any, tenantId: number, itemId: number): Promise<any | null> {
    const item = await db('dtx_items as i')
        .leftJoin('dtx_versions as v', 'v.id', 'i.current_version_id')
        .where('i.id', itemId)
        .andWhere('i.tenant_id', tenantId)
        .select(
            'i.id',
            'i.customer_id',
            'i.folder_path',
            'i.display_name',
            'i.workflow_status',
            'i.current_version_id',
            'i.last_activity_at',
            'i.created_at',
            'i.updated_at',
            'v.version_no as current_version_no',
            'v.scan_status as current_scan_status',
            'v.created_at as current_version_created_at',
        )
        .first();
    if (!item) return null;

    return {
        id: Number(item.id),
        customerId: Number(item.customer_id),
        folderPath: String(item.folder_path || ''),
        displayName: String(item.display_name || ''),
        workflowStatus: item.workflow_status,
        currentVersionId: item.current_version_id ? Number(item.current_version_id) : null,
        currentVersionNo: item.current_version_no ? Number(item.current_version_no) : null,
        currentScanStatus: item.current_scan_status || null,
        currentVersionCreatedAt: toIso(item.current_version_created_at),
        lastActivityAt: toIso(item.last_activity_at),
        createdAt: toIso(item.created_at),
        updatedAt: toIso(item.updated_at),
    };
}

async function saveUploadVersion(db: any, args: {
    tenantId: number;
    customerId: number;
    itemId: number;
    fileName: string;
    mimeType: string;
    tempPath: string;
    folderPath: string;
    actor: UploadActor;
}): Promise<{ itemId: number; versionId: number; versionNo: number; workflowStatus: WorkflowStatus; scanStatus: string; storageKey: string; storedFileName: string }> {
    const validated = await validateUploadedFileFromPath(
        args.fileName,
        args.mimeType,
        args.tempPath,
        {
            maxBytes: Math.max(1, config.fileSecurity.maxUploadSizeMb) * 1024 * 1024,
            allowZip: config.fileSecurity.allowZipUploads,
            strictSignature: config.fileSecurity.strictSignatureCheck,
        },
    );

    const storageKey = buildStorageKey(args.tenantId, 'quarantine', validated.sanitizedFileName);
    await saveTempFileToStorage(storageKey, args.tempPath);

    const existingItem = await db('dtx_items')
        .where({ id: args.itemId, tenant_id: args.tenantId, customer_id: args.customerId })
        .first();

    if (!existingItem) {
        throw new Error('Dateiobjekt nicht gefunden.');
    }

    const latestVersion = await db('dtx_versions')
        .where({ tenant_id: args.tenantId, item_id: args.itemId })
        .max('version_no as maxVersion')
        .first();

    const versionNo = Number((latestVersion as any)?.maxVersion || 0) + 1;

    const [versionId] = await db('dtx_versions').insert({
        item_id: args.itemId,
        tenant_id: args.tenantId,
        version_no: versionNo,
        storage_zone: 'quarantine',
        storage_key: storageKey,
        original_file_name: validated.sanitizedFileName,
        mime_type: validated.mimeType,
        detected_mime_type: validated.detectedMimeType,
        size_bytes: validated.sizeBytes,
        sha256_hash: validated.sha256,
        scan_status: 'pending',
        scan_engine: null,
        scan_signature: null,
        scan_meta: null,
        uploaded_by_type: args.actor.type,
        uploaded_by_user_id: args.actor.userId,
        uploaded_by_email: args.actor.email,
        uploaded_ip: args.actor.ip,
        uploaded_user_agent: args.actor.userAgent,
        created_at: new Date(),
    });

    const workflowStatus: WorkflowStatus = 'pending';

    await db('dtx_items')
        .where({ id: args.itemId, tenant_id: args.tenantId })
        .update({
            display_name: validated.sanitizedFileName,
            folder_path: args.folderPath,
            workflow_status: workflowStatus,
            current_version_id: Number(versionId),
            last_activity_at: new Date(),
            updated_at: new Date(),
        });

    return {
        itemId: Number(args.itemId),
        versionId: Number(versionId),
        versionNo,
        workflowStatus,
        scanStatus: 'pending',
        storageKey,
        storedFileName: validated.sanitizedFileName,
    };
}

async function processVersionMalwareScan(
    fastify: FastifyInstance,
    db: any,
    args: { tenantId: number; itemId: number; versionId: number; storageKey: string },
): Promise<void> {
    try {
        const absPath = buildSafeStoragePath(STORAGE_ROOT, args.storageKey);
        const scanResult = await scanStoredFileForMalware(absPath);

        let nextScanStatus: 'clean' | 'infected' | 'error' | 'skipped' = scanResult.status;
        if (scanResult.status === 'error' && config.fileSecurity.clamav.failClosed) {
            nextScanStatus = 'error';
        }

        await db('dtx_versions')
            .where({ id: args.versionId, tenant_id: args.tenantId, item_id: args.itemId })
            .update({
                scan_status: nextScanStatus,
                scan_engine: scanResult.engine || null,
                scan_signature: scanResult.signature || null,
                scan_meta: JSON.stringify({ detail: scanResult.detail || null }),
            });

        if (nextScanStatus === 'infected' || (nextScanStatus === 'error' && config.fileSecurity.clamav.failClosed)) {
            await db('dtx_versions')
                .where({ id: args.versionId, tenant_id: args.tenantId, item_id: args.itemId })
                .update({ storage_zone: 'rejected' });

            await db('dtx_items')
                .where({ id: args.itemId, tenant_id: args.tenantId })
                .update({ workflow_status: 'rejected', last_activity_at: new Date(), updated_at: new Date() });
        } else if (nextScanStatus === 'clean' || nextScanStatus === 'skipped') {
            await db('dtx_versions')
                .where({ id: args.versionId, tenant_id: args.tenantId, item_id: args.itemId })
                .update({ storage_zone: 'clean' });

            await db('dtx_items')
                .where({ id: args.itemId, tenant_id: args.tenantId })
                .update({ workflow_status: 'clean', last_activity_at: new Date(), updated_at: new Date() });
        }

        await fastify.audit.log({
            action: 'dateiaustausch.scan.completed',
            category: 'plugin',
            pluginId: PLUGIN_ID,
            entityType: 'dtx_version',
            entityId: String(args.versionId),
            newState: {
                itemId: args.itemId,
                scanStatus: nextScanStatus,
                scanEngine: scanResult.engine || null,
                scanSignature: scanResult.signature || null,
            },
        });
    } catch (error: any) {
        await db('dtx_versions')
            .where({ id: args.versionId, tenant_id: args.tenantId, item_id: args.itemId })
            .update({
                scan_status: 'error',
                scan_meta: JSON.stringify({ detail: String(error?.message || 'scan job failed') }),
            })
            .catch(() => undefined);

        fastify.log.error({ error, versionId: args.versionId }, 'dateiaustausch malware scan job failed');
    }
}

export default async function plugin(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();
    await fs.mkdir(STORAGE_ROOT, { recursive: true, mode: 0o700 });
    await fs.chmod(STORAGE_ROOT, 0o700).catch(() => undefined);
    const hasCrmCustomersTable = await db.schema.hasTable('crm_customers').catch(() => false);
    let scanQueue: Promise<void> = Promise.resolve();

    fastify.get('/public/files', {
        exposeHeadRoute: false,
        config: { policy: { public: true }, rateLimit: { max: 30, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = resolvePublicSessionToken(request);
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });

        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        const items = await db('dtx_items as i')
            .leftJoin('dtx_versions as v', 'v.id', 'i.current_version_id')
            .where('i.tenant_id', Number(session.tenant_id))
            .andWhere('i.customer_id', Number(session.customer_id))
            .select(
                'i.id',
                'i.folder_path',
                'i.display_name',
                'i.workflow_status',
                'i.current_version_id',
                'i.updated_at',
                'v.version_no as current_version_no',
                'v.scan_status as current_scan_status',
                'v.created_at as current_version_created_at',
            )
            .orderBy('i.updated_at', 'desc')
            .limit(200);

        return items.map((item: any) => ({
            id: Number(item.id),
            folderPath: String(item.folder_path || ''),
            displayName: String(item.display_name || ''),
            workflowStatus: item.workflow_status,
            currentVersionId: item.current_version_id ? Number(item.current_version_id) : null,
            currentVersionNo: item.current_version_no ? Number(item.current_version_no) : null,
            currentScanStatus: item.current_scan_status || null,
            currentVersionCreatedAt: toIso(item.current_version_created_at),
            updatedAt: toIso(item.updated_at),
        }));
    });

    fastify.post('/public/files/upload', {
        config: {
            policy: { public: true },
            rateLimit: { max: 8, timeWindow: '1 minute' },
        },
        policy: { public: true },
    }, async (request, reply) => {
        const filePart = await (request as any).file();
        if (!filePart) return reply.status(400).send({ error: 'Datei ist erforderlich.' });

        const sessionToken = resolvePublicSessionToken(request, filePart.fields);
        const folderPath = normalizeFolderPath(String(getFieldValue(filePart.fields, 'folderPath') || ''));
        const rawItemId = Number(getFieldValue(filePart.fields, 'itemId') || 0);

        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });

        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        const maxUploadBytes = Math.max(1, config.fileSecurity.maxUploadSizeMb) * 1024 * 1024;
        const tempUpload = await streamUploadPartToTempFile(filePart, maxUploadBytes);
        const actor: UploadActor = {
            type: 'customer',
            userId: null,
            email: String(session.email_normalized || ''),
            display: String(session.email_normalized || ''),
            ip: String(request.ip || ''),
            userAgent: String(request.headers['user-agent'] || ''),
        };

        let itemId = rawItemId;
        if (!Number.isInteger(itemId) || itemId <= 0) {
            const [createdItemId] = await db('dtx_items').insert({
                tenant_id: Number(session.tenant_id),
                customer_id: Number(session.customer_id),
                folder_path: folderPath,
                display_name: sanitizeFileName(String(filePart.filename || 'upload')),
                workflow_status: 'pending',
                current_version_id: null,
                last_activity_at: new Date(),
                created_at: new Date(),
                updated_at: new Date(),
            });
            itemId = Number(createdItemId);
        }

        try {
            const result = await saveUploadVersion(db, {
                tenantId: Number(session.tenant_id),
                customerId: Number(session.customer_id),
                itemId,
                fileName: String(filePart.filename || 'upload'),
                mimeType: String(filePart.mimetype || '').toLowerCase(),
                tempPath: tempUpload.tempPath,
                folderPath,
                actor,
            });
            scanQueue = scanQueue
                .then(() => processVersionMalwareScan(fastify, db, {
                    tenantId: Number(session.tenant_id),
                    itemId,
                    versionId: result.versionId,
                    storageKey: result.storageKey,
                }))
                .catch((queueError) => {
                    fastify.log.error({ queueError }, 'dateiaustausch scan queue failed');
                });

            try {
                const users = await getTenantUserIds(db, Number(session.tenant_id));
                if (users.length > 0) {
                    await fastify.notify.sendToMany(users, {
                        title: 'Neuer Datei-Upload im Kundenportal',
                    message: `${actor.email || 'Kunde'} hat ${sanitizeFileName(String(filePart.filename || 'Datei'))} hochgeladen.`,
                        type: 'info',
                        pluginId: PLUGIN_ID,
                        tenantId: Number(session.tenant_id),
                        link: '/dateiaustausch',
                        category: 'plugin.dateiaustausch',
                    });
                }
            } catch (notifyError) {
                // Upload darf nie durch Notification-Fehler scheitern.
                fastify.log.error({ notifyError }, 'dateiaustausch notify failed');
            }

            await fastify.audit.log({
                action: 'dateiaustausch.public_upload.created',
                category: 'plugin',
                entityType: 'dtx_item',
                entityId: String(itemId),
                pluginId: PLUGIN_ID,
                newState: {
                    itemId,
                    versionId: result.versionId,
                    versionNo: result.versionNo,
                    workflowStatus: result.workflowStatus,
                    scanStatus: result.scanStatus,
                    folderPath,
                    uploader: actor.email,
                },
            }, request);

            return reply.status(201).send({
                success: true,
                itemId,
                workflowStatus: result.workflowStatus,
                scanStatus: result.scanStatus,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Upload fehlgeschlagen.';
            return reply.status(400).send({ error: message });
        } finally {
            await fs.rm(tempUpload.tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
    });

    fastify.delete('/public/files/:itemId', {
        config: { policy: { public: true }, rateLimit: { max: 10, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const itemId = Number((request.params as any)?.itemId || 0);
        const sessionToken = resolvePublicSessionToken(request);

        if (!Number.isInteger(itemId) || itemId <= 0) return reply.status(400).send({ error: 'Ungültige Datei-ID.' });
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });

        const item = await db('dtx_items')
            .where({ id: itemId, tenant_id: Number(session.tenant_id), customer_id: Number(session.customer_id) })
            .first();
        if (!item) return reply.status(404).send({ error: 'Datei nicht gefunden.' });

        const versions = await db('dtx_versions')
            .where({ item_id: itemId, tenant_id: Number(session.tenant_id) })
            .select('id', 'storage_key');

        await db.transaction(async (trx: any) => {
            await trx('dtx_comments').where({ item_id: itemId, tenant_id: Number(session.tenant_id) }).delete();
            await trx('dtx_versions').where({ item_id: itemId, tenant_id: Number(session.tenant_id) }).delete();
            await trx('dtx_items').where({ id: itemId, tenant_id: Number(session.tenant_id) }).delete();
        });

        for (const version of versions) {
            const absPath = buildSafeStoragePath(STORAGE_ROOT, String((version as any).storage_key || ''));
            await fs.rm(absPath, { force: true }).catch(() => undefined);
        }

        await fastify.audit.log({
            action: 'dateiaustausch.public_file.deleted',
            category: 'plugin',
            pluginId: PLUGIN_ID,
            entityType: 'dtx_item',
            entityId: String(itemId),
            previousState: { customerId: Number(session.customer_id) },
        }, request);

        return { success: true };
    });

    fastify.get('/public/files/:itemId/versions/:versionId/download', {
        exposeHeadRoute: false,
        config: { policy: { public: true }, rateLimit: { max: 40, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const itemId = Number((request.params as any)?.itemId || 0);
        const versionId = Number((request.params as any)?.versionId || 0);
        const sessionToken = String((request.query as any)?.sessionToken || '').trim();

        if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(versionId) || versionId <= 0) {
            return reply.status(400).send({ error: 'Ungültige Dateiversion.' });
        }
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });

        const version = await db('dtx_versions as v')
            .join('dtx_items as i', 'i.id', 'v.item_id')
            .where('v.id', versionId)
            .andWhere('v.item_id', itemId)
            .andWhere('v.tenant_id', Number(session.tenant_id))
            .andWhere('i.customer_id', Number(session.customer_id))
            .select('v.*')
            .first();

        if (!version) return reply.status(404).send({ error: 'Datei nicht gefunden.' });
        if (String(version.scan_status || '') !== 'clean' || String(version.storage_zone || '') !== 'clean') {
            return reply.status(403).send({ error: 'Datei ist noch nicht freigegeben.' });
        }

        const absPath = buildSafeStoragePath(STORAGE_ROOT, String(version.storage_key));

        try {
            await fs.access(absPath);
        } catch {
            return reply.status(404).send({ error: 'Datei nicht im Storage gefunden.' });
        }

        const fileName = String(version.original_file_name || 'download.bin');
        applyHardenedDownloadHeaders(reply, String(version.mime_type || 'application/octet-stream'), fileName);
        return reply.send(createReadStream(absPath));
    });

    fastify.get('/items', { preHandler: [requirePermission('dateiaustausch.view')] }, async (request) => {
        const tenantId = request.user.tenantId;
        const query = request.query as Record<string, any>;
        const status = normalizeWorkflowStatus(query.status);
        const customerId = Number(query.customerId || 0);

        const rows = await db('dtx_items as i')
            .leftJoin('vp_customers as c', function joinCustomer() {
                this.on('c.id', '=', 'i.customer_id').andOn('c.tenant_id', '=', 'i.tenant_id');
            })
            .modify((qb: any) => {
                if (hasCrmCustomersTable) {
                    qb.leftJoin('crm_customers as cc', function joinCrmCustomer() {
                        this.on('cc.id', '=', 'c.crm_customer_id').andOn('cc.tenant_id', '=', 'c.tenant_id');
                    });
                }
            })
            .leftJoin('dtx_versions as v', 'v.id', 'i.current_version_id')
            .where('i.tenant_id', tenantId)
            .modify((qb: any) => {
                if (status) qb.andWhere('i.workflow_status', status);
                if (Number.isInteger(customerId) && customerId > 0) qb.andWhere('i.customer_id', customerId);
            })
            .select(
                'i.id',
                'i.customer_id',
                'i.folder_path',
                'i.display_name',
                'i.workflow_status',
                'i.updated_at',
                'i.current_version_id',
                hasCrmCustomersTable
                    ? db.raw("COALESCE(NULLIF(cc.company_name, ''), c.name) as customer_name")
                    : db.raw('c.name as customer_name'),
                'v.version_no as current_version_no',
                'v.scan_status as current_scan_status',
                'v.scan_signature as current_scan_signature',
                'v.created_at as current_version_created_at',
            )
            .orderBy('i.updated_at', 'desc')
            .limit(500);

        return rows.map((row: any) => ({
            id: Number(row.id),
            customerId: Number(row.customer_id),
            customerName: row.customer_name || null,
            folderPath: row.folder_path || '',
            displayName: row.display_name || '',
            workflowStatus: row.workflow_status,
            updatedAt: toIso(row.updated_at),
            currentVersionId: row.current_version_id ? Number(row.current_version_id) : null,
            currentVersionNo: row.current_version_no ? Number(row.current_version_no) : null,
            currentScanStatus: row.current_scan_status || null,
            currentScanSignature: row.current_scan_signature || null,
            currentVersionCreatedAt: toIso(row.current_version_created_at),
        }));
    });

    fastify.get('/items/:itemId', { preHandler: [requirePermission('dateiaustausch.view')] }, async (request, reply) => {
        const tenantId = request.user.tenantId;
        const itemId = Number((request.params as any)?.itemId || 0);
        if (!Number.isInteger(itemId) || itemId <= 0) return reply.status(400).send({ error: 'Ungültige Datei-ID.' });

        const item = await loadItemWithDetails(db, tenantId, itemId);
        if (!item) return reply.status(404).send({ error: 'Datei nicht gefunden.' });
        return item;
    });

    fastify.get('/items/:itemId/versions/:versionId/download', { preHandler: [requirePermission('dateiaustausch.review')] }, async (request, reply) => {
        const tenantId = request.user.tenantId;
        const itemId = Number((request.params as any)?.itemId || 0);
        const versionId = Number((request.params as any)?.versionId || 0);

        if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(versionId) || versionId <= 0) {
            return reply.status(400).send({ error: 'Ungültige Dateiversion.' });
        }

        const version = await db('dtx_versions')
            .where({ id: versionId, item_id: itemId, tenant_id: tenantId })
            .first();

        if (!version) return reply.status(404).send({ error: 'Datei nicht gefunden.' });

        const absPath = buildSafeStoragePath(STORAGE_ROOT, String(version.storage_key));

        try {
            await fs.access(absPath);
        } catch {
            return reply.status(404).send({ error: 'Datei nicht im Storage gefunden.' });
        }

        const fileName = String(version.original_file_name || 'download.bin');
        applyHardenedDownloadHeaders(reply, String(version.mime_type || 'application/octet-stream'), fileName);
        return reply.send(createReadStream(absPath));
    });
}
