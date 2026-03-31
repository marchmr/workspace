import { createHash } from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDatabase } from '../core/database.js';
import { requirePermission } from '../core/permissions.js';
import { config } from '../core/config.js';
import {
    createDocumentReadStream,
    saveDocumentToStorage,
} from '../services/documentStorage.js';

type AccessMode = 'any' | 'all';

interface DocumentRow {
    id: number;
    tenant_id: number;
    plugin_id: string | null;
    title: string;
    description: string | null;
    original_file_name: string;
    storage_provider: string;
    storage_key: string;
    mime_type: string;
    size_bytes: number;
    sha256_hash: string | null;
    access_mode: AccessMode;
    uploaded_by: number | null;
    is_deleted: number | boolean;
    deleted_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
}

interface DocumentLinkRow {
    id: number;
    document_id: number;
    plugin_id: string | null;
    entity_type: string | null;
    entity_id: string | null;
    label: string | null;
    created_by: number | null;
    created_at: Date | string;
}

interface UploadPayload {
    title?: string;
    description?: string;
    pluginId?: string;
    entityType?: string;
    entityId?: string;
    linkLabel?: string;
    requiredPermissions?: string[];
    accessMode: AccessMode;
}

interface DocumentView {
    id: number;
    tenantId: number;
    pluginId: string | null;
    title: string;
    description: string | null;
    originalFileName: string;
    mimeType: string;
    sizeBytes: number;
    accessMode: AccessMode;
    requiredPermissions: string[];
    links: Array<{
        id: number;
        pluginId: string | null;
        entityType: string | null;
        entityId: string | null;
        label: string | null;
        createdBy: number | null;
        createdAt: string;
    }>;
    uploadedBy: number | null;
    isDeleted: boolean;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

const DOCUMENT_KEY_PATTERN = /^[a-zA-Z0-9._:-]{1,160}$/;
const ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'application/zip',
    'text/plain',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/json',
]);

function toIso(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    return new Date(value).toISOString();
}

function toInt(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function hasPermission(userPermissions: string[], permission: string): boolean {
    return userPermissions.includes('*') || userPermissions.includes(permission);
}

function parsePermissionList(value: unknown): string[] {
    let rawList: string[] = [];

    if (Array.isArray(value)) {
        rawList = value.map((entry) => String(entry));
    } else if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            rawList = [];
        } else if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                rawList = Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
            } catch {
                rawList = trimmed.split(',').map((entry) => entry.trim());
            }
        } else {
            rawList = trimmed.split(',').map((entry) => entry.trim());
        }
    }

    return Array.from(
        new Set(
            rawList
                .map((entry) => entry.trim())
                .filter((entry) => DOCUMENT_KEY_PATTERN.test(entry))
        )
    );
}

function parseAccessMode(value: unknown): AccessMode {
    return value === 'all' ? 'all' : 'any';
}

function sanitizeFileName(fileName: string): string {
    const cleaned = fileName.replace(/[\\/:*?"<>|]+/g, '_').trim();
    return cleaned || 'dokument';
}

function isAllowedMimeType(mimeType: string): boolean {
    if (config.documents.allowAllMimeTypes) return true;
    return ALLOWED_MIME_TYPES.has(mimeType);
}

function encodeFileNameForHeader(fileName: string): string {
    return encodeURIComponent(fileName)
        .replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
        .replace(/\*/g, '%2A');
}

async function ensurePermissionKeysExist(permissionKeys: string[]): Promise<void> {
    if (!permissionKeys.length) return;

    const db = getDatabase();
    const existing = await db('permissions')
        .whereIn('key', permissionKeys)
        .pluck('key');
    const existingSet = new Set(existing.map((value: any) => String(value)));
    const missing = permissionKeys.filter((key) => !existingSet.has(key));
    if (missing.length > 0) {
        throw new Error(`Unbekannte Permission(s): ${missing.join(', ')}`);
    }
}

async function resolvePluginFallbackPermissions(
    pluginId: string,
    cache: Map<string, string[]>
): Promise<string[]> {
    if (cache.has(pluginId)) {
        return cache.get(pluginId) || [];
    }

    const db = getDatabase();
    const viewPermissions = (await db('permissions')
        .where('plugin_id', pluginId)
        .andWhere('key', 'like', '%.view')
        .pluck('key'))
        .map((value: any) => String(value));

    const result = viewPermissions.length > 0
        ? viewPermissions
        : (await db('permissions').where('plugin_id', pluginId).pluck('key')).map((value: any) => String(value));

    cache.set(pluginId, result);
    return result;
}

async function getDocumentPermissionsMap(documentIds: number[]): Promise<Map<number, string[]>> {
    const map = new Map<number, string[]>();
    if (!documentIds.length) return map;

    const db = getDatabase();
    const rows = await db('document_permissions')
        .whereIn('document_id', documentIds)
        .select('document_id', 'permission_key');

    for (const row of rows) {
        const documentId = Number((row as any).document_id);
        const permissionKey = String((row as any).permission_key);
        if (!map.has(documentId)) map.set(documentId, []);
        map.get(documentId)?.push(permissionKey);
    }

    return map;
}

async function getDocumentLinksMap(documentIds: number[]): Promise<Map<number, DocumentLinkRow[]>> {
    const map = new Map<number, DocumentLinkRow[]>();
    if (!documentIds.length) return map;

    const db = getDatabase();
    const rows = await db('document_links')
        .whereIn('document_id', documentIds)
        .orderBy('created_at', 'asc');

    for (const row of rows) {
        const link = row as DocumentLinkRow;
        const documentId = Number(link.document_id);
        if (!map.has(documentId)) map.set(documentId, []);
        map.get(documentId)?.push(link);
    }

    return map;
}

async function resolveEffectivePermissionsForDocument(
    document: DocumentRow,
    explicitPermissions: string[],
    pluginPermissionCache: Map<string, string[]>
): Promise<string[]> {
    if (explicitPermissions.length > 0) {
        return explicitPermissions;
    }

    if (!document.plugin_id) {
        return [];
    }

    return resolvePluginFallbackPermissions(document.plugin_id, pluginPermissionCache);
}

async function canUserAccessDocument(
    document: DocumentRow,
    userPermissions: string[],
    explicitPermissions: string[],
    pluginPermissionCache: Map<string, string[]>
): Promise<boolean> {
    if (hasPermission(userPermissions, 'documents.manage')) return true;

    const effectivePermissions = await resolveEffectivePermissionsForDocument(
        document,
        explicitPermissions,
        pluginPermissionCache
    );

    if (document.plugin_id && effectivePermissions.length === 0) {
        // Plugin-Dokumente ohne ACL oder Plugin-View-Rechte sind standardmäßig gesperrt.
        return false;
    }

    if (effectivePermissions.length === 0) {
        return true;
    }

    if (document.access_mode === 'all') {
        return effectivePermissions.every((permission) => hasPermission(userPermissions, permission));
    }

    return effectivePermissions.some((permission) => hasPermission(userPermissions, permission));
}

function toDocumentView(
    row: DocumentRow,
    requiredPermissions: string[],
    links: DocumentLinkRow[]
): DocumentView {
    return {
        id: Number(row.id),
        tenantId: Number(row.tenant_id),
        pluginId: row.plugin_id || null,
        title: row.title,
        description: row.description || null,
        originalFileName: row.original_file_name,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        accessMode: row.access_mode === 'all' ? 'all' : 'any',
        requiredPermissions,
        links: links.map((link) => ({
            id: Number(link.id),
            pluginId: link.plugin_id || null,
            entityType: link.entity_type || null,
            entityId: link.entity_id || null,
            label: link.label || null,
            createdBy: link.created_by ? Number(link.created_by) : null,
            createdAt: toIso(link.created_at) || new Date().toISOString(),
        })),
        uploadedBy: row.uploaded_by ? Number(row.uploaded_by) : null,
        isDeleted: Boolean(row.is_deleted),
        deletedAt: toIso(row.deleted_at),
        createdAt: toIso(row.created_at) || new Date().toISOString(),
        updatedAt: toIso(row.updated_at) || new Date().toISOString(),
    };
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

async function parseUploadPayloadFromMultipart(request: FastifyRequest): Promise<{
    filePart: any;
    payload: UploadPayload;
}> {
    const filePart = await (request as any).file();
    if (!filePart) {
        throw new Error('Datei ist erforderlich');
    }

    const title = getFieldValue(filePart.fields, 'title')?.trim();
    const description = getFieldValue(filePart.fields, 'description')?.trim();
    const pluginId = getFieldValue(filePart.fields, 'pluginId')?.trim();
    const entityType = getFieldValue(filePart.fields, 'entityType')?.trim();
    const entityId = getFieldValue(filePart.fields, 'entityId')?.trim();
    const linkLabel = getFieldValue(filePart.fields, 'linkLabel')?.trim();
    const accessMode = parseAccessMode(getFieldValue(filePart.fields, 'accessMode'));
    const requiredPermissions = parsePermissionList(getFieldValue(filePart.fields, 'requiredPermissions'));

    return {
        filePart,
        payload: {
            title,
            description,
            pluginId,
            entityType,
            entityId,
            linkLabel,
            requiredPermissions,
            accessMode,
        },
    };
}

export default async function documentsRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    // Auth wird per-Route über requirePermission() sichergestellt (PolicyEngine-konform)

    // POST /api/documents/upload (multipart/form-data)
    fastify.post('/upload', { preHandler: [requirePermission('documents.upload')] }, async (request, reply) => {
        const tenantId = request.user.tenantId;

        let parsed: { filePart: any; payload: UploadPayload };
        try {
            parsed = await parseUploadPayloadFromMultipart(request);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Ungültige Upload-Anfrage';
            return reply.status(400).send({ error: message });
        }

        const { filePart, payload } = parsed;

        const mimeType = String(filePart.mimetype || '').toLowerCase();
        if (!isAllowedMimeType(mimeType)) {
            return reply.status(400).send({ error: `Dateityp '${mimeType || 'unbekannt'}' ist nicht erlaubt` });
        }

        const maxFileSizeBytes = Math.max(1, config.documents.maxFileSizeMb) * 1024 * 1024;
        const buffer = await filePart.toBuffer();
        if (buffer.length === 0) {
            return reply.status(400).send({ error: 'Leere Datei ist nicht erlaubt' });
        }
        if (buffer.length > maxFileSizeBytes) {
            return reply.status(413).send({ error: `Datei überschreitet ${config.documents.maxFileSizeMb} MB` });
        }

        let requiredPermissions = payload.requiredPermissions || [];
        const pluginPermissionCache = new Map<string, string[]>();
        if (payload.pluginId && requiredPermissions.length === 0) {
            requiredPermissions = await resolvePluginFallbackPermissions(payload.pluginId, pluginPermissionCache);
            if (requiredPermissions.length === 0) {
                return reply.status(400).send({
                    error: 'Für pluginId wurden keine View-Permissions gefunden. Bitte requiredPermissions explizit übergeben.',
                });
            }
        }

        try {
            await ensurePermissionKeysExist(requiredPermissions);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Ungültige Permission-Liste';
            return reply.status(400).send({ error: message });
        }

        if (!hasPermission(request.user.permissions, 'documents.manage')) {
            const forbidden = requiredPermissions.filter((permission) => !hasPermission(request.user.permissions, permission));
            if (forbidden.length > 0) {
                return reply.status(403).send({
                    error: `Keine Berechtigung, diese ACL zu setzen: ${forbidden.join(', ')}`,
                });
            }
        }

        const originalFileName = sanitizeFileName(filePart.filename || 'dokument');
        const title = payload.title?.slice(0, 255) || originalFileName;
        const description = payload.description?.slice(0, 1000) || null;
        const checksum = createHash('sha256').update(buffer).digest('hex');

        let storage;
        try {
            storage = await saveDocumentToStorage({
                tenantId,
                originalFileName,
                buffer,
            });
        } catch (error) {
            request.log.error({ error }, 'Document storage save failed');
            return reply.status(500).send({ error: 'Datei konnte nicht gespeichert werden' });
        }

        const now = new Date();
        const [documentId] = await db('documents').insert({
            tenant_id: tenantId,
            plugin_id: payload.pluginId || null,
            title,
            description,
            original_file_name: originalFileName,
            storage_provider: storage.provider,
            storage_key: storage.storageKey,
            mime_type: mimeType,
            size_bytes: buffer.length,
            sha256_hash: checksum,
            access_mode: payload.accessMode,
            uploaded_by: request.user.userId,
            is_deleted: false,
            deleted_at: null,
            created_at: now,
            updated_at: now,
        });

        if (requiredPermissions.length > 0) {
            const rows = requiredPermissions.map((permission) => ({
                document_id: documentId,
                permission_key: permission,
                created_at: now,
            }));
            await db('document_permissions').insert(rows);
        }

        const hasLinkData = Boolean(payload.entityType || payload.entityId || payload.pluginId);
        if (hasLinkData) {
            await db('document_links').insert({
                document_id: documentId,
                plugin_id: payload.pluginId || null,
                entity_type: payload.entityType || null,
                entity_id: payload.entityId || null,
                label: payload.linkLabel || null,
                created_by: request.user.userId,
                created_at: now,
            });
        }

        await fastify.audit.log({
            action: 'documents.uploaded',
            category: 'data',
            entityType: 'documents',
            entityId: documentId,
            newState: {
                tenantId,
                pluginId: payload.pluginId || null,
                title,
                originalFileName,
                sizeBytes: buffer.length,
                mimeType,
                accessMode: payload.accessMode,
                requiredPermissions,
                linkedEntity: payload.entityType && payload.entityId
                    ? { entityType: payload.entityType, entityId: payload.entityId }
                    : null,
            },
            pluginId: payload.pluginId || undefined,
        }, request);

        return reply.status(201).send({
            id: Number(documentId),
            title,
            originalFileName,
            mimeType,
            sizeBytes: buffer.length,
            requiredPermissions,
            accessMode: payload.accessMode,
        });
    });

    // GET /api/documents
    fastify.get('/', { preHandler: [requirePermission('documents.view')] }, async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        const tenantId = request.user.tenantId;

        const pluginId = typeof query.pluginId === 'string' ? query.pluginId.trim() : '';
        const entityType = typeof query.entityType === 'string' ? query.entityType.trim() : '';
        const entityId = typeof query.entityId === 'string' ? query.entityId.trim() : '';
        const search = typeof query.q === 'string' ? query.q.trim() : '';
        const limit = clamp(toInt(query.limit) || 50, 1, 200);
        const offset = clamp(toInt(query.offset) || 0, 0, 100000);
        const includeDeleted = parseBoolean(query.includeDeleted);

        if (includeDeleted && !hasPermission(request.user.permissions, 'documents.manage')) {
            return reply.status(403).send({ error: 'includeDeleted ist nur mit documents.manage erlaubt' });
        }

        const baseQuery = db('documents')
            .where('documents.tenant_id', tenantId)
            .modify((qb: any) => {
                if (!includeDeleted) qb.where('documents.is_deleted', false);
                if (pluginId) qb.where('documents.plugin_id', pluginId);
                if (search) {
                    const escapedSearch = search.replace(/[%_\\\\]/g, '\\\\$&');
                    qb.andWhere((nested: any) => {
                        nested
                            .where('documents.title', 'like', `%${escapedSearch}%`)
                            .orWhere('documents.original_file_name', 'like', `%${escapedSearch}%`);
                    });
                }
                if (entityType || entityId) {
                    qb.whereExists(function (this: any) {
                        this.select(db.raw('1'))
                            .from('document_links')
                            .whereRaw('document_links.document_id = documents.id');
                        if (entityType) this.andWhere('entity_type', entityType);
                        if (entityId) this.andWhere('entity_id', entityId);
                    });
                }
            })
            .orderBy('documents.created_at', 'desc')
            .limit(limit)
            .offset(offset)
            .select('*');

        const rows = (await baseQuery) as DocumentRow[];
        const documentIds = rows.map((row) => Number(row.id));
        const permissionsMap = await getDocumentPermissionsMap(documentIds);
        const linksMap = await getDocumentLinksMap(documentIds);

        const pluginPermissionCache = new Map<string, string[]>();
        const visibleDocuments: DocumentView[] = [];
        for (const row of rows) {
            const requiredPermissions = permissionsMap.get(Number(row.id)) || [];
            const canAccess = await canUserAccessDocument(row, request.user.permissions, requiredPermissions, pluginPermissionCache);
            if (!canAccess) continue;
            visibleDocuments.push(
                toDocumentView(
                    row,
                    requiredPermissions,
                    linksMap.get(Number(row.id)) || []
                )
            );
        }

        return reply.send({
            items: visibleDocuments,
            returned: visibleDocuments.length,
            limit,
            offset,
        });
    });

    // GET /api/documents/:id
    fastify.get('/:id', { preHandler: [requirePermission('documents.view')] }, async (request, reply) => {
        const documentId = toInt((request.params as any).id);
        if (!documentId) return reply.status(400).send({ error: 'Ungültige Dokument-ID' });

        const row = await db('documents')
            .where({ id: documentId, tenant_id: request.user.tenantId })
            .first() as DocumentRow | undefined;

        if (!row) return reply.status(404).send({ error: 'Dokument nicht gefunden' });

        if (row.is_deleted && !hasPermission(request.user.permissions, 'documents.manage')) {
            return reply.status(404).send({ error: 'Dokument nicht gefunden' });
        }

        const permissionsMap = await getDocumentPermissionsMap([documentId]);
        const linksMap = await getDocumentLinksMap([documentId]);
        const requiredPermissions = permissionsMap.get(documentId) || [];

        const canAccess = await canUserAccessDocument(row, request.user.permissions, requiredPermissions, new Map());
        if (!canAccess) return reply.status(403).send({ error: 'Keine Berechtigung für dieses Dokument' });

        return reply.send(
            toDocumentView(row, requiredPermissions, linksMap.get(documentId) || [])
        );
    });

    // GET /api/documents/:id/download
    fastify.get('/:id/download', { preHandler: [requirePermission('documents.view')] }, async (request, reply) => {
        const documentId = toInt((request.params as any).id);
        if (!documentId) return reply.status(400).send({ error: 'Ungültige Dokument-ID' });

        const row = await db('documents')
            .where({ id: documentId, tenant_id: request.user.tenantId })
            .first() as DocumentRow | undefined;

        if (!row) return reply.status(404).send({ error: 'Dokument nicht gefunden' });
        if (row.is_deleted && !hasPermission(request.user.permissions, 'documents.manage')) {
            return reply.status(404).send({ error: 'Dokument nicht gefunden' });
        }

        const permissionsMap = await getDocumentPermissionsMap([documentId]);
        const requiredPermissions = permissionsMap.get(documentId) || [];
        const canAccess = await canUserAccessDocument(row, request.user.permissions, requiredPermissions, new Map());
        if (!canAccess) return reply.status(403).send({ error: 'Keine Berechtigung für dieses Dokument' });

        let fileStream: NodeJS.ReadableStream;
        try {
            fileStream = createDocumentReadStream(row.storage_key).stream;
        } catch {
            return reply.status(404).send({ error: 'Datei im Storage nicht gefunden' });
        }

        const safeName = sanitizeFileName(row.original_file_name);
        reply.header('Content-Type', row.mime_type || 'application/octet-stream');
        reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeFileNameForHeader(safeName)}`);

        await fastify.audit.log({
            action: 'documents.downloaded',
            category: 'data',
            entityType: 'documents',
            entityId: documentId,
            newState: { pluginId: row.plugin_id || null, originalFileName: row.original_file_name },
            pluginId: row.plugin_id || undefined,
        }, request);

        return reply.send(fileStream);
    });

    // PUT /api/documents/:id/access
    fastify.put('/:id/access', { preHandler: [requirePermission('documents.manage')] }, async (request, reply) => {
        const documentId = toInt((request.params as any).id);
        if (!documentId) return reply.status(400).send({ error: 'Ungültige Dokument-ID' });

        const body = (request.body || {}) as { requiredPermissions?: unknown; accessMode?: unknown };
        const requiredPermissions = parsePermissionList(body.requiredPermissions);
        const accessMode = parseAccessMode(body.accessMode);

        try {
            await ensurePermissionKeysExist(requiredPermissions);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Ungültige Permission-Liste';
            return reply.status(400).send({ error: message });
        }

        const row = await db('documents')
            .where({ id: documentId, tenant_id: request.user.tenantId })
            .first() as DocumentRow | undefined;
        if (!row) return reply.status(404).send({ error: 'Dokument nicht gefunden' });

        await db.transaction(async (trx) => {
            await trx('documents')
                .where({ id: documentId })
                .update({
                    access_mode: accessMode,
                    updated_at: new Date(),
                });

            await trx('document_permissions').where({ document_id: documentId }).delete();

            if (requiredPermissions.length > 0) {
                await trx('document_permissions').insert(
                    requiredPermissions.map((permission) => ({
                        document_id: documentId,
                        permission_key: permission,
                        created_at: new Date(),
                    }))
                );
            }
        });

        await fastify.audit.log({
            action: 'documents.access.updated',
            category: 'admin',
            entityType: 'documents',
            entityId: documentId,
            previousState: { accessMode: row.access_mode },
            newState: { accessMode, requiredPermissions },
            pluginId: row.plugin_id || undefined,
        }, request);

        return reply.send({ success: true, accessMode, requiredPermissions });
    });

    // POST /api/documents/:id/links
    fastify.post('/:id/links', { preHandler: [requirePermission('documents.link')] }, async (request, reply) => {
        const documentId = toInt((request.params as any).id);
        if (!documentId) return reply.status(400).send({ error: 'Ungültige Dokument-ID' });

        const body = (request.body || {}) as {
            pluginId?: unknown;
            entityType?: unknown;
            entityId?: unknown;
            label?: unknown;
        };

        const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
        const entityType = typeof body.entityType === 'string' ? body.entityType.trim() : '';
        const entityId = typeof body.entityId === 'string' ? body.entityId.trim() : '';
        const label = typeof body.label === 'string' ? body.label.trim().slice(0, 200) : '';

        if (!pluginId && !entityType && !entityId) {
            return reply.status(400).send({ error: 'Mindestens pluginId oder entityType/entityId muss gesetzt sein' });
        }

        const row = await db('documents')
            .where({ id: documentId, tenant_id: request.user.tenantId })
            .first() as DocumentRow | undefined;
        if (!row) return reply.status(404).send({ error: 'Dokument nicht gefunden' });

        const [linkId] = await db('document_links').insert({
            document_id: documentId,
            plugin_id: pluginId || null,
            entity_type: entityType || null,
            entity_id: entityId || null,
            label: label || null,
            created_by: request.user.userId,
            created_at: new Date(),
        });

        await fastify.audit.log({
            action: 'documents.link.created',
            category: 'data',
            entityType: 'document_links',
            entityId: linkId,
            newState: {
                documentId,
                pluginId: pluginId || null,
                entityType: entityType || null,
                entityId: entityId || null,
            },
            pluginId: row.plugin_id || undefined,
        }, request);

        return reply.status(201).send({
            id: Number(linkId),
            documentId,
            pluginId: pluginId || null,
            entityType: entityType || null,
            entityId: entityId || null,
            label: label || null,
        });
    });

    // DELETE /api/documents/:id/links/:linkId
    fastify.delete('/:id/links/:linkId', { preHandler: [requirePermission('documents.link')] }, async (request, reply) => {
        const documentId = toInt((request.params as any).id);
        const linkId = toInt((request.params as any).linkId);
        if (!documentId || !linkId) {
            return reply.status(400).send({ error: 'Ungültige Link-ID oder Dokument-ID' });
        }

        const row = await db('documents')
            .where({ id: documentId, tenant_id: request.user.tenantId })
            .first() as DocumentRow | undefined;
        if (!row) return reply.status(404).send({ error: 'Dokument nicht gefunden' });

        const link = await db('document_links')
            .where({ id: linkId, document_id: documentId })
            .first() as DocumentLinkRow | undefined;
        if (!link) return reply.status(404).send({ error: 'Verknüpfung nicht gefunden' });

        await db('document_links').where({ id: linkId }).delete();

        await fastify.audit.log({
            action: 'documents.link.deleted',
            category: 'data',
            entityType: 'document_links',
            entityId: linkId,
            previousState: {
                documentId,
                pluginId: link.plugin_id,
                entityType: link.entity_type,
                entityId: link.entity_id,
            },
            pluginId: row.plugin_id || undefined,
        }, request);

        return reply.send({ success: true });
    });

    // DELETE /api/documents/:id (Soft Delete)
    fastify.delete('/:id', { preHandler: [requirePermission('documents.delete')] }, async (request, reply) => {
        const documentId = toInt((request.params as any).id);
        if (!documentId) return reply.status(400).send({ error: 'Ungültige Dokument-ID' });

        const row = await db('documents')
            .where({ id: documentId, tenant_id: request.user.tenantId })
            .first() as DocumentRow | undefined;
        if (!row) return reply.status(404).send({ error: 'Dokument nicht gefunden' });

        const permissionsMap = await getDocumentPermissionsMap([documentId]);
        const requiredPermissions = permissionsMap.get(documentId) || [];
        const canAccess = await canUserAccessDocument(row, request.user.permissions, requiredPermissions, new Map());
        if (!canAccess) return reply.status(403).send({ error: 'Keine Berechtigung für dieses Dokument' });

        await db('documents')
            .where({ id: documentId })
            .update({
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date(),
            });

        await fastify.audit.log({
            action: 'documents.deleted',
            category: 'data',
            entityType: 'documents',
            entityId: documentId,
            previousState: { title: row.title, originalFileName: row.original_file_name },
            pluginId: row.plugin_id || undefined,
        }, request);

        return reply.send({ success: true });
    });

    // POST /api/documents/:id/restore
    fastify.post('/:id/restore', { preHandler: [requirePermission('documents.manage')] }, async (request, reply) => {
        const documentId = toInt((request.params as any).id);
        if (!documentId) return reply.status(400).send({ error: 'Ungültige Dokument-ID' });

        const row = await db('documents')
            .where({ id: documentId, tenant_id: request.user.tenantId })
            .first() as DocumentRow | undefined;
        if (!row) return reply.status(404).send({ error: 'Dokument nicht gefunden' });

        if (!row.is_deleted) {
            return reply.send({ success: true });
        }

        await db('documents')
            .where({ id: documentId })
            .update({
                is_deleted: false,
                deleted_at: null,
                updated_at: new Date(),
            });

        await fastify.audit.log({
            action: 'documents.restored',
            category: 'admin',
            entityType: 'documents',
            entityId: documentId,
            newState: { title: row.title },
            pluginId: row.plugin_id || undefined,
        }, request);

        return reply.send({ success: true });
    });
}
