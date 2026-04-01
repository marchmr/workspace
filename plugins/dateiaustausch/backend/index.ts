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
const MAX_FOLDER_ZIP_ITEMS = 3000;
const MAX_FOLDER_ZIP_TOTAL_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB
const MAX_SCAN_QUEUE_PENDING = 200;

type WorkflowStatus = 'pending' | 'clean' | 'rejected' | 'reviewed';

type SessionRow = {
    id: number;
    tenant_id: number;
    customer_id: number;
    email_normalized: string;
    expires_at: string;
    revoked_at: string | null;
};

type FolderRow = {
    id: number;
    tenant_id: number;
    customer_id: number;
    folder_path: string;
    created_at: string;
    updated_at: string;
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
    const legacyDoubleHash = hashValue(tokenHash);
    const row = await db('vp_public_sessions')
        .whereIn('token_hash', [tokenHash, legacyDoubleHash])
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

function applyHardenedPreviewHeaders(reply: any, mimeType: string, fileName: string): void {
    const encodedName = encodeFileNameForHeader(fileName);
    const sanitizedName = fileName.replace(/"/g, '');
    reply.header('Content-Type', mimeType || 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Cache-Control', 'private, max-age=120');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('Content-Disposition', `inline; filename="${sanitizedName}"; filename*=UTF-8''${encodedName}`);
}

function normalizeWorkflowStatus(input: unknown): WorkflowStatus | null {
    const value = String(input || '').trim().toLowerCase();
    if (value === 'pending' || value === 'clean' || value === 'rejected' || value === 'reviewed') {
        return value;
    }
    return null;
}

type ZipFileEntry = {
    itemId: number;
    versionId: number;
    folderPath: string;
    displayName: string;
    storageKey: string;
    sizeBytes: number;
};

function sanitizeZipPathPart(input: string): string {
    return String(input || '')
        .trim()
        .replace(/\\/g, '_')
        .replace(/\//g, '_')
        .replace(/\.\./g, '_')
        .replace(/[^a-zA-Z0-9._ -]/g, '_')
        .replace(/\s+/g, ' ')
        .trim() || 'item';
}

function buildZipFileEntryName(baseFolderPath: string, itemFolderPath: string, fileName: string): string {
    const normalizedBase = normalizeFolderPath(baseFolderPath);
    const normalizedItemFolder = normalizeFolderPath(itemFolderPath);
    let relativeFolder = normalizedItemFolder;
    if (normalizedBase) {
        if (normalizedItemFolder === normalizedBase) relativeFolder = '';
        else if (normalizedItemFolder.startsWith(`${normalizedBase}/`)) relativeFolder = normalizedItemFolder.slice(normalizedBase.length + 1);
    }

    const pathParts = relativeFolder
        .split('/')
        .filter(Boolean)
        .map((part) => sanitizeZipPathPart(part));

    const safeFileName = sanitizeFileName(fileName);
    return [...pathParts, safeFileName].join('/');
}

function getFolderNameForZip(folderPath: string): string {
    const normalized = normalizeFolderPath(folderPath);
    const parts = normalized.split('/').filter(Boolean);
    return sanitizeZipPathPart(parts[parts.length - 1] || 'ordner');
}

function getBaseName(folderPath: string): string {
    const normalized = normalizeFolderPath(folderPath);
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'ordner';
}

async function loadCleanFolderZipEntries(db: any, args: {
    tenantId: number;
    customerId: number;
    folderPath: string;
}): Promise<ZipFileEntry[]> {
    const normalizedFolderPath = normalizeFolderPath(args.folderPath);
    const rows = await db('dtx_items as i')
        .join('dtx_versions as v', 'v.id', 'i.current_version_id')
        .where('i.tenant_id', args.tenantId)
        .andWhere('i.customer_id', args.customerId)
        .andWhere('i.workflow_status', 'clean')
        .andWhere('v.scan_status', 'clean')
        .andWhere('v.storage_zone', 'clean')
        .modify((qb: any) => {
            if (!normalizedFolderPath) return;
            qb.andWhere((nested: any) => {
                nested.where('i.folder_path', normalizedFolderPath).orWhere('i.folder_path', 'like', `${normalizedFolderPath}/%`);
            });
        })
        .select(
            'i.id as item_id',
            'i.folder_path',
            'i.display_name',
            'v.id as version_id',
            'v.storage_key',
            'v.size_bytes',
        )
        .orderBy('i.folder_path', 'asc')
        .orderBy('i.display_name', 'asc')
        .limit(MAX_FOLDER_ZIP_ITEMS + 1);

    if (rows.length > MAX_FOLDER_ZIP_ITEMS) {
        throw new Error(`Zu viele Dateien im Ordner (max. ${MAX_FOLDER_ZIP_ITEMS}).`);
    }

    return rows.map((row: any) => ({
        itemId: Number(row.item_id),
        versionId: Number(row.version_id),
        folderPath: String(row.folder_path || ''),
        displayName: String(row.display_name || 'datei'),
        storageKey: String(row.storage_key || ''),
        sizeBytes: Number(row.size_bytes || 0),
    }));
}

async function streamFolderZip(reply: any, args: {
    fileName: string;
    baseFolderPath: string;
    entries: ZipFileEntry[];
}): Promise<void> {
    if (!args.entries.length) {
        reply.status(404).send({ error: 'Keine sauberen Dateien in diesem Ordner gefunden.' });
        return;
    }

    let totalBytes = 0;
    for (const entry of args.entries) {
        totalBytes += Math.max(0, Number(entry.sizeBytes || 0));
        if (totalBytes > MAX_FOLDER_ZIP_TOTAL_BYTES) {
            reply.status(413).send({ error: 'ZIP zu groß. Bitte Ordner weiter aufteilen.' });
            return;
        }
    }

    let archiveFactory: any;
    try {
        const module = await import('archiver');
        archiveFactory = module.default || module;
    } catch {
        reply.status(503).send({ error: 'ZIP-Erstellung momentan nicht verfügbar (archiver fehlt).' });
        return;
    }

    const archive = archiveFactory('zip', { zlib: { level: 9 } });
    archive.on('warning', () => undefined);
    archive.on('error', (err) => {
        if (!reply.sent) {
            reply.status(500).send({ error: 'ZIP-Erstellung fehlgeschlagen.' });
            return;
        }
        reply.raw.destroy(err);
    });

    reply.header('Content-Type', 'application/zip');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store, max-age=0');
    reply.header('Pragma', 'no-cache');
    const zipName = `${sanitizeFileName(args.fileName)}.zip`;
    const encodedName = encodeFileNameForHeader(zipName);
    const safeName = zipName.replace(/"/g, '');
    reply.header('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`);
    reply.send(archive);

    (async () => {
        try {
            for (const entry of args.entries) {
                const absPath = buildSafeStoragePath(STORAGE_ROOT, entry.storageKey);
                try {
                    const st = await fs.stat(absPath);
                    if (!st.isFile()) continue;
                } catch {
                    continue;
                }
                const relativeName = buildZipFileEntryName(args.baseFolderPath, entry.folderPath, entry.displayName);
                const rootPrefix = args.baseFolderPath ? `${getFolderNameForZip(args.baseFolderPath)}/` : '';
                const name = `${rootPrefix}${relativeName}`.replace(/^\/+/, '');
                archive.file(absPath, { name: name || sanitizeFileName(entry.displayName) });
            }

            await archive.finalize();
        } catch (error) {
            archive.destroy(error as Error);
        }
    })().catch(() => undefined);
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

async function ensureFolderSchema(db: any): Promise<void> {
    const hasFolders = await db.schema.hasTable('dtx_folders').catch(() => false);
    if (!hasFolders) {
        await db.schema.createTable('dtx_folders', (table: any) => {
            table.increments('id').primary();
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.integer('customer_id').unsigned().notNullable().references('id').inTable('vp_customers').onDelete('CASCADE');
            table.string('folder_path', 255).notNullable();
            table.timestamp('created_at').defaultTo(db.fn.now());
            table.timestamp('updated_at').defaultTo(db.fn.now());
            table.unique(['tenant_id', 'customer_id', 'folder_path'], 'dtx_folders_tenant_customer_path_uq');
            table.index(['tenant_id', 'customer_id'], 'dtx_folders_tenant_customer_idx');
        });
    }
}

async function ensureFolderExists(db: any, tenantId: number, customerId: number, folderPathInput: string): Promise<void> {
    const folderPath = normalizeFolderPath(folderPathInput);
    if (!folderPath) return;
    const now = new Date();

    const parts = folderPath.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        const existing = await db('dtx_folders')
            .where({ tenant_id: tenantId, customer_id: customerId, folder_path: current })
            .first('id');
        if (existing) {
            await db('dtx_folders').where({ id: Number(existing.id) }).update({ updated_at: now });
            continue;
        }
        await db('dtx_folders').insert({
            tenant_id: tenantId,
            customer_id: customerId,
            folder_path: current,
            created_at: now,
            updated_at: now,
        });
    }
}

function splitFileNameAndExt(fileName: string): { name: string; ext: string } {
    const clean = sanitizeFileName(fileName || 'Datei');
    const ext = path.extname(clean);
    const name = ext ? clean.slice(0, -ext.length) : clean;
    return { name: name || 'Datei', ext: ext || '' };
}

async function resolveUniqueItemDisplayName(
    db: any,
    tenantId: number,
    customerId: number,
    folderPath: string,
    preferredName: string,
): Promise<string> {
    const { name, ext } = splitFileNameAndExt(preferredName);
    const rows = await db('dtx_items')
        .where({
            tenant_id: tenantId,
            customer_id: customerId,
            folder_path: folderPath,
        })
        .select('display_name');
    const existing = new Set<string>(rows.map((row: any) => String(row.display_name || '').toLowerCase()));
    if (!existing.has(preferredName.toLowerCase())) return preferredName;

    for (let index = 1; index <= 5000; index += 1) {
        const candidate = `${name} (${index})${ext}`;
        if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return `${name}-${randomUUID().slice(0, 8)}${ext}`;
}

async function duplicateCurrentItemVersion(db: any, args: {
    tenantId: number;
    customerId: number;
    sourceItemId: number;
    targetFolderPath: string;
    actor: UploadActor;
}): Promise<number> {
    const sourceItem = await db('dtx_items')
        .where({ id: args.sourceItemId, tenant_id: args.tenantId, customer_id: args.customerId })
        .first();
    if (!sourceItem) throw new Error('Quelldatei nicht gefunden.');
    if (!sourceItem.current_version_id) throw new Error('Quelldatei hat keine aktuelle Version.');

    const sourceVersion = await db('dtx_versions')
        .where({
            id: Number(sourceItem.current_version_id),
            item_id: Number(sourceItem.id),
            tenant_id: args.tenantId,
        })
        .first();
    if (!sourceVersion) throw new Error('Dateiversion nicht gefunden.');

    const sourceStorageKey = String(sourceVersion.storage_key || '');
    const sourceAbsPath = buildSafeStoragePath(STORAGE_ROOT, sourceStorageKey);
    await fs.access(sourceAbsPath);

    const sourceZone = String(sourceVersion.storage_zone || '');
    const sourceScanStatus = String(sourceVersion.scan_status || '');
    if (sourceZone !== 'clean' || sourceScanStatus !== 'clean') {
        throw new Error('Nur saubere Dateien koennen kopiert werden.');
    }
    const zone: 'clean' = 'clean';
    const sourceFileName = sanitizeFileName(String(sourceVersion.original_file_name || sourceItem.display_name || 'Datei'));
    const targetDisplayName = await resolveUniqueItemDisplayName(
        db,
        args.tenantId,
        args.customerId,
        args.targetFolderPath,
        sourceFileName,
    );
    const targetStorageKey = buildStorageKey(args.tenantId, zone as 'clean' | 'quarantine', targetDisplayName);
    await saveTempFileToStorage(targetStorageKey, sourceAbsPath);

    const now = new Date();
    const [newItemId] = await db('dtx_items').insert({
        tenant_id: args.tenantId,
        customer_id: args.customerId,
        folder_path: args.targetFolderPath,
        display_name: targetDisplayName,
        workflow_status: 'clean',
        current_version_id: null,
        last_activity_at: now,
        created_at: now,
        updated_at: now,
    });

    const [newVersionId] = await db('dtx_versions').insert({
        item_id: Number(newItemId),
        tenant_id: args.tenantId,
        version_no: 1,
        storage_zone: zone,
        storage_key: targetStorageKey,
        original_file_name: targetDisplayName,
        mime_type: String(sourceVersion.mime_type || 'application/octet-stream'),
        detected_mime_type: String(sourceVersion.detected_mime_type || sourceVersion.mime_type || 'application/octet-stream'),
        size_bytes: Number(sourceVersion.size_bytes || 0),
        sha256_hash: String(sourceVersion.sha256_hash || ''),
        scan_status: 'clean',
        scan_engine: String(sourceVersion.scan_engine || ''),
        scan_signature: String(sourceVersion.scan_signature || ''),
        scan_meta: sourceVersion.scan_meta || null,
        uploaded_by_type: args.actor.type,
        uploaded_by_user_id: args.actor.userId,
        uploaded_by_email: args.actor.email,
        uploaded_ip: args.actor.ip,
        uploaded_user_agent: args.actor.userAgent,
        created_at: now,
    });

    await db('dtx_items')
        .where({ id: Number(newItemId), tenant_id: args.tenantId })
        .update({ current_version_id: Number(newVersionId), updated_at: now });

    if (args.targetFolderPath) {
        await ensureFolderExists(db, args.tenantId, args.customerId, args.targetFolderPath);
    }

    return Number(newItemId);
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
    await ensureFolderSchema(db);
    await fs.mkdir(STORAGE_ROOT, { recursive: true, mode: 0o700 });
    await fs.chmod(STORAGE_ROOT, 0o700).catch(() => undefined);
    const hasCrmCustomersTable = await db.schema.hasTable('crm_customers').catch(() => false);
    const crmCustomerHasNumber = hasCrmCustomersTable
        ? await db.schema.hasColumn('crm_customers', 'customer_number').catch(() => false)
        : false;
    const crmCustomerHasCompany = hasCrmCustomersTable
        ? await db.schema.hasColumn('crm_customers', 'company_name').catch(() => false)
        : false;
    const crmCustomerHasFirst = hasCrmCustomersTable
        ? await db.schema.hasColumn('crm_customers', 'first_name').catch(() => false)
        : false;
    const crmCustomerHasLast = hasCrmCustomersTable
        ? await db.schema.hasColumn('crm_customers', 'last_name').catch(() => false)
        : false;
    let scanQueue: Promise<void> = Promise.resolve();
    let scanQueuePending = 0;

    function resolveTenantIdOrReply(request: any, reply: any): number | null {
        const tenantId = Number(request?.user?.tenantId || 0);
        if (!Number.isInteger(tenantId) || tenantId <= 0) {
            reply.status(401).send({ error: 'Nicht authentifiziert.' });
            return null;
        }
        return tenantId;
    }

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

        let items: any[] = [];
        try {
            items = await db('dtx_items as i')
                .leftJoin('dtx_versions as v', 'v.id', 'i.current_version_id')
                .where('i.tenant_id', Number(session.tenant_id))
                .andWhere('i.customer_id', Number(session.customer_id))
                .whereNotNull('i.current_version_id')
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
        } catch (error) {
            // Fallback query for older/inconsistent schemas to avoid hard 500 in customer UI.
            fastify.log.error({ error }, 'dateiaustausch: public files query failed, using fallback');
            items = await db('dtx_items as i')
                .where('i.tenant_id', Number(session.tenant_id))
                .andWhere('i.customer_id', Number(session.customer_id))
                .whereNotNull('i.current_version_id')
                .select(
                    'i.id',
                    'i.folder_path',
                    'i.display_name',
                    'i.workflow_status',
                    'i.current_version_id',
                    'i.updated_at',
                )
                .orderBy('i.updated_at', 'desc')
                .limit(200);
        }

        return items.map((item: any) => ({
            id: Number(item.id),
            folderPath: String(item.folder_path || ''),
            displayName: String(item.display_name || ''),
            workflowStatus: item.workflow_status,
            currentVersionId: item.current_version_id ? Number(item.current_version_id) : null,
            currentVersionNo: item.current_version_no ? Number(item.current_version_no) : 1,
            currentScanStatus: item.current_scan_status || null,
            currentVersionCreatedAt: toIso(item.current_version_created_at),
            updatedAt: toIso(item.updated_at),
        }));
    });

    fastify.get('/public/folders', {
        exposeHeadRoute: false,
        config: { policy: { public: true }, rateLimit: { max: 30, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = resolvePublicSessionToken(request);
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });
        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        let folders: Array<{ folder_path: string }> = [];
        let itemFolders: Array<{ folder_path: string }> = [];
        try {
            [folders, itemFolders] = await Promise.all([
                db('dtx_folders')
                    .where({ tenant_id: Number(session.tenant_id), customer_id: Number(session.customer_id) })
                    .select('folder_path')
                    .orderBy('folder_path', 'asc'),
                db('dtx_items')
                    .where({ tenant_id: Number(session.tenant_id), customer_id: Number(session.customer_id) })
                    .whereNotNull('folder_path')
                    .where('folder_path', '!=', '')
                    .distinct('folder_path'),
            ]);
        } catch (error) {
            // Fallback if dtx_folders table/schema is temporarily inconsistent.
            fastify.log.error({ error }, 'dateiaustausch: public folders query failed, using fallback');
            itemFolders = await db('dtx_items')
                .where({ tenant_id: Number(session.tenant_id), customer_id: Number(session.customer_id) })
                .whereNotNull('folder_path')
                .where('folder_path', '!=', '')
                .distinct('folder_path');
        }

        const merged = new Set<string>();
        for (const row of folders) merged.add(String((row as FolderRow).folder_path || '').trim());
        for (const row of itemFolders) merged.add(String((row as any).folder_path || '').trim());
        return Array.from(merged).filter(Boolean).sort((a, b) => a.localeCompare(b, 'de'));
    });

    fastify.post('/public/folders', {
        config: { policy: { public: true }, rateLimit: { max: 20, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = resolvePublicSessionToken(request);
        const folderPath = normalizeFolderPath(String((request.body as any)?.folderPath || ''));
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });
        if (!folderPath) return reply.status(400).send({ error: 'Ordnerpfad ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });
        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        await ensureFolderExists(db, Number(session.tenant_id), Number(session.customer_id), folderPath);
        return { success: true, folderPath };
    });

    fastify.delete('/public/folders', {
        config: { policy: { public: true }, rateLimit: { max: 20, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = resolvePublicSessionToken(request);
        const folderPath = normalizeFolderPath(String((request.query as any)?.folderPath || ''));
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });
        if (!folderPath) return reply.status(400).send({ error: 'Ordnerpfad ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });
        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        const tenantId = Number(session.tenant_id);
        const customerId = Number(session.customer_id);
        const folderPrefix = `${folderPath}/%`;

        const [hasFilesInFolder, hasSubFolders] = await Promise.all([
            db('dtx_items')
                .where({ tenant_id: tenantId, customer_id: customerId, folder_path: folderPath })
                .first('id'),
            db('dtx_folders')
                .where({ tenant_id: tenantId, customer_id: customerId })
                .where('folder_path', 'like', folderPrefix)
                .first('id'),
        ]);

        if (hasFilesInFolder || hasSubFolders) {
            return reply.status(409).send({ error: 'Ordner ist nicht leer.' });
        }

        await db('dtx_folders')
            .where({ tenant_id: tenantId, customer_id: customerId, folder_path: folderPath })
            .delete();

        return { success: true };
    });

    fastify.post('/public/files/upload', {
        config: {
            policy: { public: true },
            rateLimit: { max: 8, timeWindow: '1 minute' },
        },
        policy: { public: true },
    }, async (request, reply) => {
        const uploadStart = Date.now();
        if (scanQueuePending >= MAX_SCAN_QUEUE_PENDING) {
            return reply.status(503).send({ error: 'Upload aktuell ausgelastet. Bitte in 1-2 Minuten erneut versuchen.' });
        }
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
        const streamDoneMs = Date.now() - uploadStart;
        fastify.log.info({ streamDoneMs, fileName: filePart.filename }, 'dateiaustausch: file stream complete');

        const actor: UploadActor = {
            type: 'customer',
            userId: null,
            email: String(session.email_normalized || ''),
            display: String(session.email_normalized || ''),
            ip: String(request.ip || ''),
            userAgent: String(request.headers['user-agent'] || ''),
        };

        let itemId = rawItemId;
        let createdNewItem = false;
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
            createdNewItem = true;
        }
        if (folderPath) {
            await ensureFolderExists(db, Number(session.tenant_id), Number(session.customer_id), folderPath);
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
            const validationDoneMs = Date.now() - uploadStart;
            fastify.log.info({ validationDoneMs, itemId, versionId: result.versionId }, 'dateiaustausch: validation complete, scan queued');

            scanQueuePending += 1;
            scanQueue = scanQueue
                .then(() => processVersionMalwareScan(fastify, db, {
                    tenantId: Number(session.tenant_id),
                    itemId,
                    versionId: result.versionId,
                    storageKey: result.storageKey,
                }))
                .catch((queueError) => {
                    fastify.log.error({ queueError }, 'dateiaustausch scan queue failed');
                })
                .finally(() => {
                    scanQueuePending = Math.max(0, scanQueuePending - 1);
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

            const totalMs = Date.now() - uploadStart;
            fastify.log.info({ totalMs, itemId }, 'dateiaustausch: upload handler complete');

            return reply.status(201).send({
                success: true,
                itemId,
                workflowStatus: result.workflowStatus,
                scanStatus: result.scanStatus,
            });
        } catch (error) {
            if (createdNewItem && Number.isInteger(itemId) && itemId > 0) {
                // If validation/upload fails, remove orphan item so blocked files never appear as uploaded.
                await db('dtx_items')
                    .where({ id: itemId, tenant_id: Number(session.tenant_id) })
                    .whereNull('current_version_id')
                    .delete()
                    .catch(() => undefined);
            }
            const message = error instanceof Error ? error.message : 'Upload fehlgeschlagen.';
            fastify.log.error({ error, durationMs: Date.now() - uploadStart }, 'dateiaustausch: upload failed');
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

    fastify.post('/public/files/bulk-delete', {
        config: { policy: { public: true }, rateLimit: { max: 8, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = resolvePublicSessionToken(request);
        const body = (request.body as any) || {};
        const fileIds = Array.isArray(body.fileIds) ? body.fileIds : [];
        const folderPathsRaw = Array.isArray(body.folderPaths) ? body.folderPaths : [];
        const fileIdList = fileIds
            .map((value: any) => Number(value))
            .filter((value: number) => Number.isInteger(value) && value > 0);
        const folderPaths = folderPathsRaw
            .map((value: any) => normalizeFolderPath(String(value || '')))
            .filter(Boolean);

        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });
        if (fileIdList.length === 0 && folderPaths.length === 0) {
            return reply.status(400).send({ error: 'Keine Elemente zum Löschen übergeben.' });
        }

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });

        const tenantId = Number(session.tenant_id);
        const customerId = Number(session.customer_id);
        const normalizedFolderPaths = Array.from(new Set(folderPaths)).sort((a, b) => b.length - a.length);

        const folderPrefixes = normalizedFolderPaths.map((folderPath) => `${folderPath}/%`);
        const folderQueries = normalizedFolderPaths.map((folderPath, index) => {
            const prefix = folderPrefixes[index];
            return db('dtx_items')
                .where({ tenant_id: tenantId, customer_id: customerId, folder_path: folderPath })
                .orWhere((qb: any) => qb
                    .where({ tenant_id: tenantId, customer_id: customerId })
                    .where('folder_path', 'like', prefix))
                .select('id');
        });
        const folderItemRows = folderQueries.length ? (await Promise.all(folderQueries)).flat() : [];
        const folderFileIds = folderItemRows.map((row: any) => Number(row.id)).filter((id: number) => id > 0);
        const candidateItemIds = Array.from(new Set([...fileIdList, ...folderFileIds]));
        const validItems = candidateItemIds.length
            ? await db('dtx_items')
                .where({ tenant_id: tenantId, customer_id: customerId })
                .whereIn('id', candidateItemIds)
                .select('id')
            : [];
        const allItemIds = validItems.map((row: any) => Number(row.id)).filter((id: number) => id > 0);

        const versions = allItemIds.length
            ? await db('dtx_versions')
                .where({ tenant_id: tenantId })
                .whereIn('item_id', allItemIds)
                .select('storage_key')
            : [];

        await db.transaction(async (trx: any) => {
            if (allItemIds.length) {
                await trx('dtx_comments')
                    .where({ tenant_id: tenantId })
                    .whereIn('item_id', allItemIds)
                    .delete();
                await trx('dtx_versions')
                    .where({ tenant_id: tenantId })
                    .whereIn('item_id', allItemIds)
                    .delete();
                await trx('dtx_items')
                    .where({ tenant_id: tenantId, customer_id: customerId })
                    .whereIn('id', allItemIds)
                    .delete();
            }

            for (const folderPath of normalizedFolderPaths) {
                const prefix = `${folderPath}/%`;
                await trx('dtx_folders')
                    .where({ tenant_id: tenantId, customer_id: customerId, folder_path: folderPath })
                    .orWhere((qb: any) => qb
                        .where({ tenant_id: tenantId, customer_id: customerId })
                        .where('folder_path', 'like', prefix))
                    .delete();
            }
        });

        for (const row of versions) {
            const storageKey = String((row as any).storage_key || '');
            if (!storageKey) continue;
            const absPath = buildSafeStoragePath(STORAGE_ROOT, storageKey);
            await fs.rm(absPath, { force: true }).catch(() => undefined);
        }

        return {
            success: true,
            deletedFiles: allItemIds.length,
            deletedFolders: normalizedFolderPaths.length,
        };
    });

    fastify.post('/public/files/copy', {
        config: { policy: { public: true }, rateLimit: { max: 8, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = resolvePublicSessionToken(request);
        const body = (request.body as any) || {};
        const itemIds = Array.isArray(body.itemIds) ? body.itemIds : [];
        const folderPathsRaw = Array.isArray(body.folderPaths) ? body.folderPaths : [];
        const targetFolderPath = normalizeFolderPath(String(body.targetFolderPath || ''));

        const fileIds = itemIds
            .map((value: any) => Number(value))
            .filter((value: number) => Number.isInteger(value) && value > 0);
        const folderPaths = folderPathsRaw
            .map((value: any) => normalizeFolderPath(String(value || '')))
            .filter(Boolean);

        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });
        if (fileIds.length === 0 && folderPaths.length === 0) {
            return reply.status(400).send({ error: 'Keine Elemente zum Kopieren übergeben.' });
        }

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });

        const tenantId = Number(session.tenant_id);
        const customerId = Number(session.customer_id);
        const actor: UploadActor = {
            type: 'customer',
            userId: null,
            email: String(session.email_normalized || ''),
            display: String(session.email_normalized || ''),
            ip: String(request.ip || ''),
            userAgent: String(request.headers['user-agent'] || ''),
        };

        let copiedCount = 0;
        for (const itemId of fileIds) {
            await duplicateCurrentItemVersion(db, {
                tenantId,
                customerId,
                sourceItemId: itemId,
                targetFolderPath,
                actor,
            });
            copiedCount += 1;
        }

        const uniqueFolderPaths = Array.from(new Set(folderPaths)).sort((a, b) => a.length - b.length);
        for (const sourceFolderPath of uniqueFolderPaths) {
            const sourcePrefix = `${sourceFolderPath}/`;
            const sourceFolders = await db('dtx_folders')
                .where({ tenant_id: tenantId, customer_id: customerId, folder_path: sourceFolderPath })
                .orWhere((qb: any) => qb
                    .where({ tenant_id: tenantId, customer_id: customerId })
                    .where('folder_path', 'like', `${sourcePrefix}%`))
                .select('folder_path');

            const mappedRoot = targetFolderPath ? `${targetFolderPath}/${getBaseName(sourceFolderPath)}` : getBaseName(sourceFolderPath);
            await ensureFolderExists(db, tenantId, customerId, mappedRoot);
            for (const folderRow of sourceFolders) {
                const sourcePath = normalizeFolderPath(String((folderRow as any).folder_path || ''));
                if (!sourcePath) continue;
                const relative = sourcePath === sourceFolderPath ? '' : sourcePath.slice(sourceFolderPath.length + 1);
                const destPath = relative ? `${mappedRoot}/${relative}` : mappedRoot;
                await ensureFolderExists(db, tenantId, customerId, destPath);
            }

            const sourceItems = await db('dtx_items')
                .where({ tenant_id: tenantId, customer_id: customerId, folder_path: sourceFolderPath })
                .orWhere((qb: any) => qb
                    .where({ tenant_id: tenantId, customer_id: customerId })
                    .where('folder_path', 'like', `${sourcePrefix}%`))
                .select('id', 'folder_path');

            for (const sourceItem of sourceItems) {
                const sourceItemPath = normalizeFolderPath(String((sourceItem as any).folder_path || ''));
                const relative = sourceItemPath === sourceFolderPath ? '' : sourceItemPath.slice(sourceFolderPath.length + 1);
                const destPath = relative ? `${mappedRoot}/${relative}` : mappedRoot;
                await duplicateCurrentItemVersion(db, {
                    tenantId,
                    customerId,
                    sourceItemId: Number((sourceItem as any).id),
                    targetFolderPath: destPath,
                    actor,
                });
                copiedCount += 1;
            }
        }

        return { success: true, copiedCount };
    });

    fastify.get('/public/files/:itemId/versions/:versionId/download', {
        exposeHeadRoute: false,
        config: { policy: { public: true }, rateLimit: { max: 40, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const itemId = Number((request.params as any)?.itemId || 0);
        const versionId = Number((request.params as any)?.versionId || 0);
        const sessionToken = resolvePublicSessionToken(request);

        if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(versionId) || versionId <= 0) {
            return reply.status(400).send({ error: 'Ungültige Dateiversion.' });
        }
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });
        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

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

    fastify.get('/public/folders/download', {
        exposeHeadRoute: false,
        config: { policy: { public: true }, rateLimit: { max: 20, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = resolvePublicSessionToken(request);
        const folderPath = normalizeFolderPath(String((request.query as any)?.folderPath || ''));
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });
        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        const entries = await loadCleanFolderZipEntries(db, {
            tenantId: Number(session.tenant_id),
            customerId: Number(session.customer_id),
            folderPath,
        });

        const folderName = folderPath ? getFolderNameForZip(folderPath) : 'Dateien';
        await streamFolderZip(reply, {
            fileName: `dateiaustausch-${folderName}-${new Date().toISOString().slice(0, 10)}`,
            baseFolderPath: folderPath,
            entries,
        });
    });

    fastify.get('/public/files/:itemId/versions/:versionId/preview', {
        exposeHeadRoute: false,
        config: { policy: { public: true }, rateLimit: { max: 60, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const itemId = Number((request.params as any)?.itemId || 0);
        const versionId = Number((request.params as any)?.versionId || 0);
        if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(versionId) || versionId <= 0) {
            return reply.status(400).send({ error: 'Ungültige Dateiversion.' });
        }

        const sessionToken = resolvePublicSessionToken(request);
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

        const fileName = String(version.original_file_name || 'preview.bin');
        applyHardenedPreviewHeaders(reply, String(version.mime_type || 'application/octet-stream'), fileName);
        return reply.send(createReadStream(absPath));
    });

    fastify.get('/items', { preHandler: [requirePermission('dateiaustausch.view')] }, async (request, reply) => {
        const tenantId = resolveTenantIdOrReply(request, reply);
        if (!tenantId) return;
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
            .whereNotNull('i.current_version_id')
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
                hasCrmCustomersTable && crmCustomerHasCompany
                    ? db.raw("COALESCE(NULLIF(cc.company_name, ''), c.name) as customer_name")
                    : db.raw('c.name as customer_name'),
                hasCrmCustomersTable && crmCustomerHasNumber ? db.raw('cc.customer_number as customer_number') : db.raw('NULL as customer_number'),
                hasCrmCustomersTable && crmCustomerHasCompany ? db.raw('cc.company_name as customer_company_name') : db.raw('NULL as customer_company_name'),
                hasCrmCustomersTable && crmCustomerHasFirst ? db.raw('cc.first_name as customer_first_name') : db.raw('NULL as customer_first_name'),
                hasCrmCustomersTable && crmCustomerHasLast ? db.raw('cc.last_name as customer_last_name') : db.raw('NULL as customer_last_name'),
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
            customerNumber: row.customer_number || null,
            customerCompanyName: row.customer_company_name || null,
            customerFirstName: row.customer_first_name || null,
            customerLastName: row.customer_last_name || null,
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

    fastify.get('/folders', { preHandler: [requirePermission('dateiaustausch.view')] }, async (request, reply) => {
        const tenantId = resolveTenantIdOrReply(request, reply);
        if (!tenantId) return;
        const customerId = Number((request.query as any)?.customerId || 0);

        const rows = await db('dtx_folders as f')
            .leftJoin('vp_customers as c', function joinCustomer() {
                this.on('c.id', '=', 'f.customer_id').andOn('c.tenant_id', '=', 'f.tenant_id');
            })
            .modify((qb: any) => {
                if (hasCrmCustomersTable) {
                    qb.leftJoin('crm_customers as cc', function joinCrmCustomer() {
                        this.on('cc.id', '=', 'c.crm_customer_id').andOn('cc.tenant_id', '=', 'c.tenant_id');
                    });
                }
            })
            .where('f.tenant_id', tenantId)
            .modify((qb: any) => {
                if (Number.isInteger(customerId) && customerId > 0) qb.andWhere('f.customer_id', customerId);
            })
            .select(
                'f.id',
                'f.customer_id',
                'f.folder_path',
                'f.updated_at',
                hasCrmCustomersTable && crmCustomerHasCompany
                    ? db.raw("COALESCE(NULLIF(cc.company_name, ''), c.name) as customer_name")
                    : db.raw('c.name as customer_name'),
                hasCrmCustomersTable && crmCustomerHasNumber ? db.raw('cc.customer_number as customer_number') : db.raw('NULL as customer_number'),
                hasCrmCustomersTable && crmCustomerHasCompany ? db.raw('cc.company_name as customer_company_name') : db.raw('NULL as customer_company_name'),
                hasCrmCustomersTable && crmCustomerHasFirst ? db.raw('cc.first_name as customer_first_name') : db.raw('NULL as customer_first_name'),
                hasCrmCustomersTable && crmCustomerHasLast ? db.raw('cc.last_name as customer_last_name') : db.raw('NULL as customer_last_name'),
            )
            .orderBy('f.customer_id', 'asc')
            .orderBy('f.folder_path', 'asc');

        return rows.map((row: any) => ({
            id: Number(row.id),
            customerId: Number(row.customer_id),
            customerName: row.customer_name || null,
            customerNumber: row.customer_number || null,
            customerCompanyName: row.customer_company_name || null,
            customerFirstName: row.customer_first_name || null,
            customerLastName: row.customer_last_name || null,
            folderPath: String(row.folder_path || ''),
            updatedAt: toIso(row.updated_at),
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
        const tenantId = resolveTenantIdOrReply(request, reply);
        if (!tenantId) return;
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

    fastify.get('/folders/download', { preHandler: [requirePermission('dateiaustausch.view')] }, async (request, reply) => {
        const tenantId = resolveTenantIdOrReply(request, reply);
        if (!tenantId) return;
        const customerId = Number((request.query as any)?.customerId || 0);
        const folderPath = normalizeFolderPath(String((request.query as any)?.folderPath || ''));
        if (!Number.isInteger(customerId) || customerId <= 0) {
            return reply.status(400).send({ error: 'customerId ist erforderlich.' });
        }

        const customerExists = await db('vp_customers')
            .where({ tenant_id: tenantId, id: customerId })
            .first('id');
        if (!customerExists) return reply.status(404).send({ error: 'Kunde nicht gefunden.' });

        const entries = await loadCleanFolderZipEntries(db, {
            tenantId,
            customerId,
            folderPath,
        });

        const folderName = folderPath ? getFolderNameForZip(folderPath) : `kunde-${customerId}`;
        await streamFolderZip(reply, {
            fileName: `dateiaustausch-${folderName}-${new Date().toISOString().slice(0, 10)}`,
            baseFolderPath: folderPath,
            entries,
        });
    });

    fastify.get('/items/:itemId/versions/:versionId/preview', { preHandler: [requirePermission('dateiaustausch.view')] }, async (request, reply) => {
        const tenantId = resolveTenantIdOrReply(request, reply);
        if (!tenantId) return;
        const itemId = Number((request.params as any)?.itemId || 0);
        const versionId = Number((request.params as any)?.versionId || 0);
        if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(versionId) || versionId <= 0) {
            return reply.status(400).send({ error: 'Ungültige Dateiversion.' });
        }

        const version = await db('dtx_versions')
            .where({ id: versionId, item_id: itemId, tenant_id: tenantId })
            .first();
        if (!version) return reply.status(404).send({ error: 'Datei nicht gefunden.' });
        if (String(version.scan_status || '') !== 'clean' || String(version.storage_zone || '') !== 'clean') {
            return reply.status(403).send({ error: 'Vorschau erst nach sauberem Malware-Scan verfuegbar.' });
        }

        const absPath = buildSafeStoragePath(STORAGE_ROOT, String(version.storage_key));
        try {
            await fs.access(absPath);
        } catch {
            return reply.status(404).send({ error: 'Datei nicht im Storage gefunden.' });
        }

        const fileName = String(version.original_file_name || 'preview.bin');
        applyHardenedPreviewHeaders(reply, String(version.mime_type || 'application/octet-stream'), fileName);
        return reply.send(createReadStream(absPath));
    });
}
