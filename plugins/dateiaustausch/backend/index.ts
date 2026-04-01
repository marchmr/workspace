import { createHash, randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { createReadStream } from 'fs';
import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../../../backend/src/core/database.js';
import { requirePermission } from '../../../backend/src/core/permissions.js';
import { config } from '../../../backend/src/core/config.js';
import {
    buildSafeStoragePath,
    normalizeFolderPath,
    sanitizeFileName,
    scanBufferForMalware,
    validateUploadedFile,
} from '../../../backend/src/services/fileSecurity.js';

const PLUGIN_ID = 'dateiaustausch';
const STORAGE_ROOT = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID);
const MAX_COMMENT_LENGTH = 2000;

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

async function saveToStorage(storageKey: string, buffer: Buffer): Promise<void> {
    const absPath = buildSafeStoragePath(STORAGE_ROOT, storageKey);
    await fs.mkdir(path.dirname(absPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(absPath, buffer, { mode: 0o600 });
    await fs.chmod(absPath, 0o600).catch(() => undefined);
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
        .join('user_tenant_assignments as uta', 'uta.user_id', 'u.id')
        .where('uta.tenant_id', tenantId)
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

function parseScanMeta(value: unknown): any | null {
    if (!value) return null;
    try {
        return JSON.parse(String(value));
    } catch {
        return { raw: String(value) };
    }
}

async function loadItemWithDetails(db: any, tenantId: number, itemId: number): Promise<any | null> {
    const item = await db('dtx_items').where({ id: itemId, tenant_id: tenantId }).first();
    if (!item) return null;

    const versions = await db('dtx_versions')
        .where({ item_id: itemId, tenant_id: tenantId })
        .orderBy('version_no', 'desc');

    const comments = await db('dtx_comments')
        .where({ item_id: itemId, tenant_id: tenantId })
        .orderBy('created_at', 'asc');

    return {
        id: Number(item.id),
        customerId: Number(item.customer_id),
        folderPath: String(item.folder_path || ''),
        displayName: String(item.display_name || ''),
        workflowStatus: item.workflow_status,
        currentVersionId: item.current_version_id ? Number(item.current_version_id) : null,
        lastActivityAt: toIso(item.last_activity_at),
        createdAt: toIso(item.created_at),
        updatedAt: toIso(item.updated_at),
        versions: versions.map((version: any) => ({
            id: Number(version.id),
            versionNo: Number(version.version_no),
            storageZone: version.storage_zone,
            originalFileName: version.original_file_name,
            mimeType: version.mime_type,
            detectedMimeType: version.detected_mime_type || null,
            sizeBytes: Number(version.size_bytes || 0),
            sha256: version.sha256_hash,
            scanStatus: version.scan_status,
            scanEngine: version.scan_engine || null,
            scanSignature: version.scan_signature || null,
            scanMeta: parseScanMeta(version.scan_meta),
            uploadedByType: version.uploaded_by_type,
            uploadedByUserId: version.uploaded_by_user_id ? Number(version.uploaded_by_user_id) : null,
            uploadedByEmail: version.uploaded_by_email || null,
            createdAt: toIso(version.created_at),
        })),
        comments: comments.map((comment: any) => ({
            id: Number(comment.id),
            versionId: comment.version_id ? Number(comment.version_id) : null,
            authorType: comment.author_type,
            authorDisplay: comment.author_display || null,
            message: comment.message,
            createdAt: toIso(comment.created_at),
        })),
    };
}

async function createComment(db: any, args: {
    tenantId: number;
    itemId: number;
    versionId?: number | null;
    actor: UploadActor;
    message: string;
}): Promise<void> {
    const trimmed = String(args.message || '').trim();
    if (!trimmed) return;

    await db('dtx_comments').insert({
        item_id: args.itemId,
        version_id: args.versionId || null,
        tenant_id: args.tenantId,
        author_type: args.actor.type,
        author_user_id: args.actor.userId,
        author_display: args.actor.display || args.actor.email || null,
        message: trimmed.slice(0, MAX_COMMENT_LENGTH),
        created_at: new Date(),
    });
}

async function saveUploadVersion(db: any, args: {
    tenantId: number;
    customerId: number;
    itemId: number;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    folderPath: string;
    actor: UploadActor;
}): Promise<{ itemId: number; versionId: number; versionNo: number; workflowStatus: WorkflowStatus; scanStatus: string }> {
    const validated = await validateUploadedFile(
        args.fileName,
        args.mimeType,
        args.buffer,
        {
            maxBytes: Math.max(1, config.fileSecurity.maxUploadSizeMb) * 1024 * 1024,
            allowZip: config.fileSecurity.allowZipUploads,
            strictSignature: config.fileSecurity.strictSignatureCheck,
        },
    );

    const scanResult = await scanBufferForMalware(args.buffer, validated.sanitizedFileName);
    if (scanResult.status === 'infected') {
        throw new Error(`Malware erkannt: ${scanResult.signature || 'unbekannt'}`);
    }
    if (scanResult.status === 'error' && config.fileSecurity.clamav.failClosed) {
        throw new Error(scanResult.detail || 'Malware-Scan fehlgeschlagen (fail-closed aktiv).');
    }

    const storageKey = buildStorageKey(args.tenantId, 'quarantine', validated.sanitizedFileName);
    await saveToStorage(storageKey, args.buffer);

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
        scan_status: scanResult.status,
        scan_engine: scanResult.engine,
        scan_signature: scanResult.signature,
        scan_meta: JSON.stringify({ detail: scanResult.detail }),
        uploaded_by_type: args.actor.type,
        uploaded_by_user_id: args.actor.userId,
        uploaded_by_email: args.actor.email,
        uploaded_ip: args.actor.ip,
        uploaded_user_agent: args.actor.userAgent,
        created_at: new Date(),
    });

    const workflowStatus: WorkflowStatus = scanResult.status === 'clean' ? 'pending' : 'pending';

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
        scanStatus: scanResult.status,
    };
}

export default async function plugin(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();
    await fs.mkdir(STORAGE_ROOT, { recursive: true, mode: 0o700 });
    await fs.chmod(STORAGE_ROOT, 0o700).catch(() => undefined);

    fastify.get('/public/files', {
        exposeHeadRoute: false,
        config: { policy: { public: true }, rateLimit: { max: 30, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = String((request.query as any)?.sessionToken || '').trim();
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

        const sessionToken = String(
            getFieldValue(filePart.fields, 'sessionToken')
            || (request.query as any)?.sessionToken
            || (request.headers as any)['x-public-session-token']
            || '',
        ).trim();
        const folderPath = normalizeFolderPath(String(getFieldValue(filePart.fields, 'folderPath') || ''));
        const comment = String(getFieldValue(filePart.fields, 'comment') || '').trim();
        const rawItemId = Number(getFieldValue(filePart.fields, 'itemId') || 0);

        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });

        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        const uploadBuffer = await filePart.toBuffer();
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
                buffer: uploadBuffer,
                folderPath,
                actor,
            });

            if (comment) {
                await createComment(db, {
                    tenantId: Number(session.tenant_id),
                    itemId,
                    versionId: result.versionId,
                    actor,
                    message: comment,
                });
            }

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
                versionId: result.versionId,
                versionNo: result.versionNo,
                workflowStatus: result.workflowStatus,
                scanStatus: result.scanStatus,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Upload fehlgeschlagen.';
            return reply.status(400).send({ error: message });
        }
    });

    fastify.post('/public/files/:itemId/comments', {
        config: { policy: { public: true }, rateLimit: { max: 12, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const itemId = Number((request.params as any)?.itemId || 0);
        const sessionToken = String((request.body as any)?.sessionToken || '').trim();
        const message = String((request.body as any)?.message || '').trim();

        if (!Number.isInteger(itemId) || itemId <= 0) return reply.status(400).send({ error: 'Ungültige Datei-ID.' });
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });
        if (!message) return reply.status(400).send({ error: 'Kommentar ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });

        const item = await db('dtx_items')
            .where({ id: itemId, tenant_id: Number(session.tenant_id), customer_id: Number(session.customer_id) })
            .first();

        if (!item) return reply.status(404).send({ error: 'Datei nicht gefunden.' });

        await createComment(db, {
            tenantId: Number(session.tenant_id),
            itemId,
            versionId: null,
            actor: {
                type: 'customer',
                userId: null,
                email: String(session.email_normalized || ''),
                display: String(session.email_normalized || ''),
                ip: String(request.ip || ''),
                userAgent: String(request.headers['user-agent'] || ''),
            },
            message,
        });

        await db('dtx_items')
            .where({ id: itemId, tenant_id: Number(session.tenant_id) })
            .update({ last_activity_at: new Date(), updated_at: new Date() });

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
                'c.name as customer_name',
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

    fastify.patch('/items/:itemId/status', { preHandler: [requirePermission('dateiaustausch.review')] }, async (request, reply) => {
        const tenantId = request.user.tenantId;
        const itemId = Number((request.params as any)?.itemId || 0);
        const status = normalizeWorkflowStatus((request.body as any)?.status);

        if (!Number.isInteger(itemId) || itemId <= 0) return reply.status(400).send({ error: 'Ungültige Datei-ID.' });
        if (!status) return reply.status(400).send({ error: 'Ungültiger Status.' });

        const item = await db('dtx_items').where({ id: itemId, tenant_id: tenantId }).first();
        if (!item) return reply.status(404).send({ error: 'Datei nicht gefunden.' });

        await db('dtx_items')
            .where({ id: itemId, tenant_id: tenantId })
            .update({ workflow_status: status, last_activity_at: new Date(), updated_at: new Date() });

        if (item.current_version_id) {
            let zone: 'quarantine' | 'clean' | 'rejected' = 'quarantine';
            if (status === 'clean' || status === 'reviewed') zone = 'clean';
            if (status === 'rejected') zone = 'rejected';
            await db('dtx_versions')
                .where({ id: item.current_version_id, tenant_id: tenantId })
                .update({ storage_zone: zone });
        }

        await fastify.audit.log({
            action: 'dateiaustausch.item.status_changed',
            category: 'plugin',
            pluginId: PLUGIN_ID,
            entityType: 'dtx_item',
            entityId: String(itemId),
            previousState: { workflowStatus: item.workflow_status },
            newState: { workflowStatus: status },
        }, request);

        return { success: true };
    });

    fastify.post('/items/:itemId/comments', { preHandler: [requirePermission('dateiaustausch.comment')] }, async (request, reply) => {
        const tenantId = request.user.tenantId;
        const itemId = Number((request.params as any)?.itemId || 0);
        const message = String((request.body as any)?.message || '').trim();

        if (!Number.isInteger(itemId) || itemId <= 0) return reply.status(400).send({ error: 'Ungültige Datei-ID.' });
        if (!message) return reply.status(400).send({ error: 'Kommentar ist erforderlich.' });

        const item = await db('dtx_items').where({ id: itemId, tenant_id: tenantId }).first();
        if (!item) return reply.status(404).send({ error: 'Datei nicht gefunden.' });

        await createComment(db, {
            tenantId,
            itemId,
            versionId: null,
            actor: {
                type: 'admin',
                userId: request.user.userId,
                email: request.user.username,
                display: request.user.username,
                ip: String(request.ip || ''),
                userAgent: String(request.headers['user-agent'] || ''),
            },
            message,
        });

        await db('dtx_items').where({ id: itemId, tenant_id: tenantId }).update({ last_activity_at: new Date(), updated_at: new Date() });

        return { success: true };
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
