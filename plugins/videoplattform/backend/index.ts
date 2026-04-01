import { createHash, randomInt, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDatabase } from '../../../backend/src/core/database.js';
import { requirePermission } from '../../../backend/src/core/permissions.js';
import { config } from '../../../backend/src/core/config.js';
import { decrypt, encrypt } from '../../../backend/src/core/encryption.js';

const PLUGIN_ID = 'videoplattform';
const KUNDENPORTAL_PLUGIN_ID = 'kundenportal';
const PUBLIC_SUBDOMAIN_SETTING_KEY = 'videoplattform.public_subdomain';
const KUNDENPORTAL_PUBLIC_SUBDOMAIN_SETTING_KEY = 'kundenportal.public_subdomain';
const PUBLIC_LOGO_FILE_SETTING_KEY = 'videoplattform.public_logo_file';
const KUNDENPORTAL_PUBLIC_LOGO_FILE_SETTING_KEY = 'kundenportal.public_logo_file';
const PUBLIC_LOGO_HEIGHT_SETTING_KEY = 'videoplattform.public_logo_height';
const KUNDENPORTAL_PUBLIC_LOGO_HEIGHT_SETTING_KEY = 'kundenportal.public_logo_height';
const PUBLIC_AUTH_MODE_SETTING_KEY = 'videoplattform.public_auth_mode';
const KUNDENPORTAL_PUBLIC_AUTH_MODE_SETTING_KEY = 'kundenportal.public_auth_mode';
const DEFAULT_PUBLIC_SUBDOMAIN = 'kunden.webdesign-hammer.de';
const DEFAULT_PUBLIC_AUTH_MODE = 'magic_code';
const MAX_VIDEO_SIZE_BYTES = 3 * 1024 * 1024 * 1024; // 3 GB
const MAGIC_CODE_TTL_MINUTES = 15;
const MAGIC_SESSION_TTL_HOURS = 72;
const MAGIC_CODE_REQUEST_RATE_MAX = 8;
const MAGIC_CODE_REQUEST_RATE_WINDOW_MS = 60 * 1000;
const MAGIC_CODE_VERIFY_RATE_MAX = 12;
const MAGIC_CODE_VERIFY_RATE_WINDOW_MS = 60 * 1000;
const MAGIC_CODE_REQUEST_EMAIL_WINDOW_MS = 10 * 60 * 1000;
const MAGIC_CODE_REQUEST_EMAIL_MAX = 3;
const MAGIC_CODE_MAX_VERIFY_ATTEMPTS = 6;
const execFileAsync = promisify(execFile);

interface VideoRecord {
    id: number;
    tenant_id: number;
    title: string;
    description: string | null;
    source_type: 'upload' | 'url';
    video_url: string | null;
    file_name: string | null;
    file_path: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    category: string;
    customer_id: number | null;
    created_at: string;
    updated_at: string;
    customer_name?: string | null;
}

interface CodeRecord {
    id: number;
    tenant_id: number;
    scope: 'video' | 'customer';
    video_id: number | null;
    customer_id: number | null;
    code: string;
    is_active: 0 | 1 | boolean;
    expires_at: string | null;
    created_at: string;
}

interface MagicCodeRecord {
    id: number;
    tenant_id: number;
    customer_id: number;
    email_normalized: string;
    email_hash: string;
    code_hash: string;
    expires_at: string;
    used_at: string | null;
}

interface PublicSessionRecord {
    id: number;
    tenant_id: number;
    customer_id: number;
    email_normalized: string;
    token_hash: string;
    expires_at: string;
    revoked_at: string | null;
}

type CustomerSourceMode = 'videoplattform' | 'crm';

type ResolvedCustomerSource = {
    mode: CustomerSourceMode;
    hasLinkColumn: boolean;
};

type PortalCustomerProfile = {
    displayName: string | null;
    companyName: string | null;
    firstName: string | null;
    lastName: string | null;
};

async function ensureVideoplattformSchema(db: any): Promise<void> {
    const hasCustomers = await db.schema.hasTable('vp_customers');
    if (!hasCustomers) {
        await db.schema.createTable('vp_customers', (table: any) => {
            table.increments('id').primary();
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.string('name', 255).notNullable();
            table.timestamp('created_at').defaultTo(db.fn.now());
            table.unique(['tenant_id', 'name']);
            table.index(['tenant_id', 'created_at']);
        });
    }

    const hasCrmLink = await db.schema.hasColumn('vp_customers', 'crm_customer_id').catch(() => false);
    if (!hasCrmLink) {
        await db.schema.alterTable('vp_customers', (table: any) => {
            table.integer('crm_customer_id').unsigned().nullable().references('id').inTable('crm_customers').onDelete('SET NULL');
            table.index(['tenant_id', 'crm_customer_id'], 'vp_customers_tenant_crm_idx');
        });
    }

    const hasVideos = await db.schema.hasTable('vp_videos');
    if (!hasVideos) {
        await db.schema.createTable('vp_videos', (table: any) => {
            table.increments('id').primary();
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.string('title', 255).notNullable();
            table.text('description').nullable();
            table.enum('source_type', ['upload', 'url']).notNullable().defaultTo('upload');
            table.text('video_url').nullable();
            table.string('file_name', 255).nullable();
            table.string('file_path', 600).nullable();
            table.string('mime_type', 120).nullable();
            table.bigInteger('size_bytes').nullable();
            table.string('category', 120).notNullable().defaultTo('Allgemein');
            table.integer('customer_id').unsigned().nullable().references('id').inTable('vp_customers').onDelete('SET NULL');
            table.timestamp('created_at').defaultTo(db.fn.now());
            table.timestamp('updated_at').defaultTo(db.fn.now());
            table.index(['tenant_id', 'created_at']);
            table.index(['tenant_id', 'customer_id']);
            table.index(['tenant_id', 'category']);
        });
    }

    const hasShareCodes = await db.schema.hasTable('vp_share_codes');
    if (!hasShareCodes) {
        await db.schema.createTable('vp_share_codes', (table: any) => {
            table.increments('id').primary();
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.enum('scope', ['video', 'customer']).notNullable().defaultTo('video');
            table.integer('video_id').unsigned().nullable().references('id').inTable('vp_videos').onDelete('CASCADE');
            table.integer('customer_id').unsigned().nullable().references('id').inTable('vp_customers').onDelete('CASCADE');
            table.string('code', 40).notNullable();
            table.boolean('is_active').notNullable().defaultTo(true);
            table.timestamp('expires_at').nullable();
            table.timestamp('created_at').defaultTo(db.fn.now());
            table.unique(['tenant_id', 'code']);
            table.index(['tenant_id', 'scope']);
            table.index(['tenant_id', 'video_id']);
            table.index(['tenant_id', 'customer_id']);
        });
    }

    const hasActivityLogs = await db.schema.hasTable('vp_activity_logs');
    if (!hasActivityLogs) {
        await db.schema.createTable('vp_activity_logs', (table: any) => {
            table.increments('id').primary();
            table.integer('tenant_id').unsigned().nullable().references('id').inTable('tenants').onDelete('SET NULL');
            table.string('event_type', 80).notNullable();
            table.string('ip', 120).nullable();
            table.text('user_agent').nullable();
            table.integer('video_id').unsigned().nullable().references('id').inTable('vp_videos').onDelete('SET NULL');
            table.integer('customer_id').unsigned().nullable().references('id').inTable('vp_customers').onDelete('SET NULL');
            table.string('code', 40).nullable();
            table.boolean('success').notNullable().defaultTo(false);
            table.text('detail').nullable();
            table.timestamp('created_at').defaultTo(db.fn.now());
            table.index(['tenant_id', 'created_at']);
            table.index(['event_type', 'created_at']);
        });
    }

    const hasMagicCodes = await db.schema.hasTable('vp_magic_codes');
    if (!hasMagicCodes) {
        await db.schema.createTable('vp_magic_codes', (table: any) => {
            table.increments('id').primary();
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.integer('customer_id').unsigned().notNullable().references('id').inTable('vp_customers').onDelete('CASCADE');
            table.string('email_normalized', 255).notNullable();
            table.string('email_hash', 64).notNullable();
            table.string('code_hash', 64).notNullable();
            table.timestamp('expires_at').notNullable();
            table.timestamp('used_at').nullable();
            table.integer('attempts').notNullable().defaultTo(0);
            table.string('ip', 120).nullable();
            table.text('user_agent').nullable();
            table.timestamp('created_at').defaultTo(db.fn.now());
            table.index(['tenant_id', 'customer_id', 'created_at']);
            table.index(['email_hash', 'created_at']);
            table.index(['expires_at']);
        });
    }

    const hasPublicSessions = await db.schema.hasTable('vp_public_sessions');
    if (!hasPublicSessions) {
        await db.schema.createTable('vp_public_sessions', (table: any) => {
            table.increments('id').primary();
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.integer('customer_id').unsigned().notNullable().references('id').inTable('vp_customers').onDelete('CASCADE');
            table.string('email_normalized', 255).notNullable();
            table.string('token_hash', 64).notNullable();
            table.timestamp('expires_at').notNullable();
            table.timestamp('last_used_at').nullable();
            table.timestamp('revoked_at').nullable();
            table.string('ip', 120).nullable();
            table.text('user_agent').nullable();
            table.timestamp('created_at').defaultTo(db.fn.now());
            table.unique(['token_hash']);
            table.index(['tenant_id', 'customer_id']);
            table.index(['expires_at']);
        });
    }
}

function normalizeHost(value: string | undefined): string {
    return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function getRequestHost(request: FastifyRequest): string {
    const host = String(request.headers.host || '').trim().toLowerCase();
    if (!host) return '';
    return host.split(':')[0] || '';
}

function isLikelyDevelopmentHost(host: string): boolean {
    return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
}

async function readGlobalEncryptedSetting(
    db: any,
    variants: Array<{ pluginId: string; key: string }>,
): Promise<string | null> {
    for (const variant of variants) {
        const row = await db('settings')
            .where({ plugin_id: variant.pluginId, key: variant.key })
            .whereNull('tenant_id')
            .first('value_encrypted');
        if (row?.value_encrypted) {
            return String(row.value_encrypted);
        }
    }
    return null;
}

async function readPublicSubdomain(db: any): Promise<string> {
    const encrypted = await readGlobalEncryptedSetting(db, [
        { pluginId: KUNDENPORTAL_PLUGIN_ID, key: KUNDENPORTAL_PUBLIC_SUBDOMAIN_SETTING_KEY },
        { pluginId: PLUGIN_ID, key: PUBLIC_SUBDOMAIN_SETTING_KEY },
    ]);
    if (!encrypted) return DEFAULT_PUBLIC_SUBDOMAIN;

    try {
        const value = decrypt(encrypted);
        return normalizeHost(value) || DEFAULT_PUBLIC_SUBDOMAIN;
    } catch {
        return DEFAULT_PUBLIC_SUBDOMAIN;
    }
}

async function readPublicLogoFile(db: any): Promise<string | null> {
    const encrypted = await readGlobalEncryptedSetting(db, [
        { pluginId: KUNDENPORTAL_PLUGIN_ID, key: KUNDENPORTAL_PUBLIC_LOGO_FILE_SETTING_KEY },
        { pluginId: PLUGIN_ID, key: PUBLIC_LOGO_FILE_SETTING_KEY },
    ]);
    if (!encrypted) return null;
    try {
        const value = decrypt(encrypted).trim();
        return value || null;
    } catch {
        return null;
    }
}

function logoMimeTypeFromFileName(fileName: string): string {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.svg') return 'image/svg+xml';
    return 'image/jpeg';
}

async function readPublicLogoHeight(db: any): Promise<number> {
    const encrypted = await readGlobalEncryptedSetting(db, [
        { pluginId: KUNDENPORTAL_PLUGIN_ID, key: KUNDENPORTAL_PUBLIC_LOGO_HEIGHT_SETTING_KEY },
        { pluginId: PLUGIN_ID, key: PUBLIC_LOGO_HEIGHT_SETTING_KEY },
    ]);
    if (!encrypted) return 52;
    try {
        const raw = decrypt(encrypted).trim();
        const value = Number(raw);
        if (!Number.isFinite(value)) return 52;
        return Math.max(24, Math.min(180, Math.round(value)));
    } catch {
        return 52;
    }
}

async function readPublicAuthMode(db: any): Promise<'share_code' | 'magic_code'> {
    const encrypted = await readGlobalEncryptedSetting(db, [
        { pluginId: KUNDENPORTAL_PLUGIN_ID, key: KUNDENPORTAL_PUBLIC_AUTH_MODE_SETTING_KEY },
        { pluginId: PLUGIN_ID, key: PUBLIC_AUTH_MODE_SETTING_KEY },
    ]);
    if (!encrypted) return DEFAULT_PUBLIC_AUTH_MODE as 'magic_code';
    try {
        const raw = decrypt(encrypted).trim().toLowerCase();
        if (raw === 'share_code') return 'share_code';
        return 'magic_code';
    } catch {
        return DEFAULT_PUBLIC_AUTH_MODE as 'magic_code';
    }
}

function toPlayableMp4Name(fileName: string): string {
    const base = sanitizeFileName(fileName).replace(/\.[^/.]+$/, '');
    return `${base || 'video'}.mp4`;
}

async function transcodeToMp4(inputPath: string, outputPath: string): Promise<void> {
    const args = [
        '-y',
        '-i', inputPath,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-c:a', 'aac',
        '-b:a', '128k',
        outputPath,
    ];
    try {
        await execFileAsync('ffmpeg', args, { timeout: 60 * 60 * 1000 });
    } catch (error: any) {
        const details = `${error?.stderr || ''}${error?.stdout || ''}${error?.message || ''}`.trim();
        throw new Error(`Video-Konvertierung fehlgeschlagen. Stelle sicher, dass ffmpeg installiert ist. ${details}`.trim());
    }
}

type StoredUploadResult = {
    fileName: string;
    filePath: string;
    mimeType: string;
    sizeBytes: number;
    transcoded: boolean;
};
const streamTranscodeLocks = new Map<number, Promise<void>>();

function isLikelyBrowserPlayableFormat(fileName: string, mimeType: string): boolean {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    const mime = String(mimeType || '').toLowerCase();
    if (mime === 'video/mp4' || ext === '.mp4') return true;
    if (mime === 'video/webm' || ext === '.webm') return true;
    if (mime === 'video/ogg' || ext === '.ogv' || ext === '.ogg') return true;
    return false;
}

async function storeUploadedVideoWithFallback(args: {
    tenantId: number;
    originalFileName: string;
    originalMimeType: string;
    uploadBuffer: Buffer;
    requireTranscodeForCompatibility: boolean;
    logWarn: (message: string) => void;
}): Promise<StoredUploadResult> {
    const uploadsRoot = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID, String(args.tenantId));
    await fs.mkdir(uploadsRoot, { recursive: true });

    const inputName = sanitizeFileName(args.originalFileName || 'video');
    const tempInputName = `${Date.now()}-${randomUUID()}-src-${inputName}`;
    const tempInputRelPath = path.join(String(args.tenantId), tempInputName);
    const tempInputAbsPath = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID, tempInputRelPath);

    const playableName = toPlayableMp4Name(args.originalFileName || 'video.mp4');
    const convertedName = `${Date.now()}-${randomUUID()}-${sanitizeFileName(playableName)}`;
    const convertedRelPath = path.join(String(args.tenantId), convertedName);
    const convertedAbsPath = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID, convertedRelPath);

    await fs.writeFile(tempInputAbsPath, args.uploadBuffer);

    try {
        await transcodeToMp4(tempInputAbsPath, convertedAbsPath);
        const convertedStat = await fs.stat(convertedAbsPath);
        return {
            fileName: sanitizeFileName(playableName),
            filePath: convertedRelPath,
            mimeType: 'video/mp4',
            sizeBytes: convertedStat.size,
            transcoded: true,
        };
    } catch (error: any) {
        args.logWarn(`Video-Konvertierung fehlgeschlagen, speichere Originaldatei. ${error?.message || 'Unbekannter Fehler'}`);
        if (args.requireTranscodeForCompatibility) {
            await fs.rm(convertedAbsPath, { force: true }).catch(() => undefined);
            throw new Error('Die Datei wurde hochgeladen, kann aber ohne ffmpeg-Konvertierung nicht zuverlässig abgespielt werden. Bitte ffmpeg installieren und erneut hochladen.');
        }
        const fallbackName = `${Date.now()}-${randomUUID()}-${sanitizeFileName(args.originalFileName || 'video')}`;
        const fallbackRelPath = path.join(String(args.tenantId), fallbackName);
        const fallbackAbsPath = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID, fallbackRelPath);
        await fs.rename(tempInputAbsPath, fallbackAbsPath);
        const fallbackStat = await fs.stat(fallbackAbsPath);

        await fs.rm(convertedAbsPath, { force: true }).catch(() => undefined);

        return {
            fileName: sanitizeFileName(args.originalFileName || 'video'),
            filePath: fallbackRelPath,
            mimeType: args.originalMimeType || 'application/octet-stream',
            sizeBytes: fallbackStat.size,
            transcoded: false,
        };
    } finally {
        await fs.rm(tempInputAbsPath, { force: true }).catch(() => undefined);
    }
}

async function ensurePlayableUploadForStreaming(db: any, video: VideoRecord, logWarn: (msg: string) => void): Promise<VideoRecord> {
    if (video.source_type !== 'upload' || !video.file_path) return video;

    const currentPath = String(video.file_path || '');
    const currentExt = path.extname(currentPath).toLowerCase();
    const currentMime = String(video.mime_type || '').toLowerCase();
    const alreadyPlayable = currentExt === '.mp4' && currentMime === 'video/mp4';
    if (alreadyPlayable) return video;

    const lockKey = Number(video.id);
    let job = streamTranscodeLocks.get(lockKey);

    if (!job) {
        job = (async () => {
            const normalizedPath = normalizeLocalVideoPath(currentPath);
            const absPath = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID, normalizedPath);
            const uploadsRoot = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID, String(video.tenant_id));
            const playableName = toPlayableMp4Name(video.file_name || path.basename(currentPath) || `video-${video.id}.mp4`);
            const convertedName = `${Date.now()}-${randomUUID()}-${sanitizeFileName(playableName)}`;
            const convertedRelPath = path.join(String(video.tenant_id), convertedName);
            const convertedAbsPath = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID, convertedRelPath);

            try {
                await fs.mkdir(uploadsRoot, { recursive: true });
                await fs.access(absPath);
                await transcodeToMp4(absPath, convertedAbsPath);
                const convertedStat = await fs.stat(convertedAbsPath);

                await db('vp_videos')
                    .where({ id: video.id, tenant_id: video.tenant_id })
                    .update({
                        file_name: sanitizeFileName(playableName),
                        file_path: convertedRelPath,
                        mime_type: 'video/mp4',
                        size_bytes: convertedStat.size,
                        updated_at: db.fn.now(),
                    });

                await fs.rm(absPath, { force: true }).catch(() => undefined);
            } catch (error: any) {
                await fs.rm(convertedAbsPath, { force: true }).catch(() => undefined);
                logWarn(`Automatische Stream-Konvertierung fehlgeschlagen (Video ${video.id}). ${error?.message || 'Unbekannter Fehler'}`);
            }
        })().finally(() => {
            streamTranscodeLocks.delete(lockKey);
        });

        streamTranscodeLocks.set(lockKey, job);
    }

    await job;
    const refreshed = await db('vp_videos')
        .where({ id: video.id, tenant_id: video.tenant_id })
        .first();

    return (refreshed as VideoRecord) || video;
}

function sanitizeCode(input: unknown): string {
    return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

function normalizeEmail(input: unknown): string {
    return String(input || '').trim().toLowerCase();
}

function hashValue(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
}

function createMagicCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function createSessionToken(): string {
    return `${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
}

function isCodeExpired(expiresAt: string | null): boolean {
    if (!expiresAt) return false;
    const time = new Date(expiresAt).getTime();
    if (!Number.isFinite(time)) return false;
    return time < Date.now();
}

function createCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'VID-';
    for (let i = 0; i < 8; i += 1) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
}

function sanitizeFileName(fileName: string): string {
    return String(fileName || 'video').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255) || 'video';
}

function normalizeLocalVideoPath(relPath: string): string {
    const normalized = path.normalize(String(relPath || '')).replace(/^\/+/, '');
    if (normalized.includes('..')) {
        throw new Error('Ungültiger Dateipfad');
    }
    return normalized;
}

function formatVideo(video: VideoRecord) {
    return {
        id: video.id,
        title: video.title,
        description: video.description || '',
        sourceType: video.source_type,
        videoUrl: video.video_url,
        fileName: video.file_name,
        mimeType: video.mime_type,
        sizeBytes: video.size_bytes,
        category: video.category,
        customerId: video.customer_id,
        customerName: video.customer_name || null,
        createdAt: video.created_at,
        streamUrl: `/api/plugins/videoplattform/public/stream/${video.id}`,
    };
}

async function ensurePublicHost(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const db = getDatabase();
    const configuredHost = normalizeHost(await readPublicSubdomain(db));
    const requestHost = normalizeHost(getRequestHost(request));

    if (!configuredHost) return true;
    if (requestHost === configuredHost) return true;

    if (config.server.env !== 'production' && isLikelyDevelopmentHost(requestHost)) {
        return true;
    }

    reply.status(403).send({
        error: `Dieses Kundenportal ist nur über ${configuredHost} erreichbar.`,
        expectedHost: configuredHost,
    });
    return false;
}

async function logActivity(db: any, payload: {
    tenantId: number | null;
    eventType: string;
    request: FastifyRequest;
    videoId?: number | null;
    customerId?: number | null;
    code?: string | null;
    success: boolean;
    detail?: string | null;
}): Promise<void> {
    await db('vp_activity_logs').insert({
        tenant_id: payload.tenantId,
        event_type: payload.eventType,
        ip: String(payload.request.ip || '').slice(0, 120) || null,
        user_agent: String(payload.request.headers['user-agent'] || '').slice(0, 1000) || null,
        video_id: payload.videoId || null,
        customer_id: payload.customerId || null,
        code: payload.code || null,
        success: payload.success,
        detail: payload.detail || null,
    });
}

async function createUniqueCode(db: any, tenantId: number): Promise<string> {
    for (let i = 0; i < 10; i += 1) {
        const code = createCode();
        const existing = await db('vp_share_codes').where({ tenant_id: tenantId, code }).first('id');
        if (!existing) return code;
    }
    return `VID-${createHash('sha256').update(randomUUID()).digest('hex').slice(0, 10).toUpperCase()}`;
}

function getTenantId(request: FastifyRequest): number {
    const tenantId = request.user?.tenantId;
    if (!tenantId) throw new Error('Kein Mandant im Token');
    return Number(tenantId);
}

function parseOptionalDate(input: unknown): string | null {
    const value = String(input || '').trim();
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function sendVideoFile(request: FastifyRequest, reply: FastifyReply, filePath: string, mimeType?: string | null): Promise<void> {
    const rangeHeader = String(request.headers.range || '');
    try {
        const stat = await fs.stat(filePath);
        const size = stat.size;

        if (!rangeHeader) {
            reply.header('Content-Type', mimeType || 'video/mp4');
            reply.header('Content-Length', String(size));
            reply.header('Cache-Control', 'no-store');
            return reply.send(createReadStream(filePath));
        }

        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        if (!match) {
            return reply.status(416).send();
        }

        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : size - 1;

        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= size || start > end) {
            return reply.status(416).send();
        }

        reply.status(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Length', String(end - start + 1));
        reply.header('Content-Type', mimeType || 'video/mp4');
        reply.header('Cache-Control', 'no-store');
        return reply.send(createReadStream(filePath, { start, end }));
    } catch {
        return reply.status(404).send({ error: 'Videodatei nicht gefunden' });
    }
}

async function resolveUploadVideoAbsolutePath(video: { tenant_id: number; file_path: string }): Promise<string | null> {
    const normalizedPath = normalizeLocalVideoPath(video.file_path);
    const tenantPrefix = `${video.tenant_id}/`;
    const withoutTenantPrefix = normalizedPath.startsWith(tenantPrefix) ? normalizedPath.slice(tenantPrefix.length) : normalizedPath;
    const pluginRoot = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID);

    const candidates: string[] = [
        path.join(pluginRoot, normalizedPath),
        path.join(pluginRoot, 'videos', normalizedPath),
    ];

    if (!normalizedPath.startsWith(tenantPrefix)) {
        candidates.push(path.join(pluginRoot, String(video.tenant_id), normalizedPath));
        candidates.push(path.join(pluginRoot, 'videos', String(video.tenant_id), normalizedPath));
    } else {
        candidates.push(path.join(pluginRoot, 'videos', String(video.tenant_id), withoutTenantPrefix));
    }

    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // try next
        }
    }
    return null;
}

function buildCustomerDisplayName(customer: any): string {
    const type = String(customer?.type || '').toLowerCase();
    const companyName = String(customer?.company_name || '').trim();
    const firstName = String(customer?.first_name || '').trim();
    const lastName = String(customer?.last_name || '').trim();

    if (type === 'company' && companyName) return companyName;
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;
    if (companyName) return companyName;
    return `CRM-Kunde #${customer?.id ?? ''}`.trim();
}

function buildUniqueCustomerName(baseName: string, crmId: number): string {
    const normalizedBase = String(baseName || '').trim() || `CRM-Kunde #${crmId}`;
    const fallback = `${normalizedBase} (#${crmId})`;
    return fallback.slice(0, 255);
}

function normalizeText(value: unknown): string | null {
    const text = String(value || '').trim();
    return text ? text : null;
}

async function getPortalCustomerProfile(db: any, tenantId: number, vpCustomerId: number): Promise<PortalCustomerProfile> {
    const customer = await db('vp_customers')
        .where({ tenant_id: tenantId, id: vpCustomerId })
        .first('name', 'crm_customer_id');

    if (!customer) {
        return {
            displayName: null,
            companyName: null,
            firstName: null,
            lastName: null,
        };
    }

    const fallbackName = normalizeText(customer.name);
    const crmCustomerId = Number(customer.crm_customer_id || 0);
    if (!crmCustomerId) {
        return {
            displayName: fallbackName,
            companyName: null,
            firstName: null,
            lastName: null,
        };
    }

    const hasCrmCustomers = await db.schema.hasTable('crm_customers').catch(() => false);
    if (!hasCrmCustomers) {
        return {
            displayName: fallbackName,
            companyName: null,
            firstName: null,
            lastName: null,
        };
    }

    const crmCustomer = await db('crm_customers')
        .where({ tenant_id: tenantId, id: crmCustomerId })
        .first('company_name', 'first_name', 'last_name');

    const companyName = normalizeText(crmCustomer?.company_name);
    const firstName = normalizeText(crmCustomer?.first_name);
    const lastName = normalizeText(crmCustomer?.last_name);
    const fullName = normalizeText([firstName, lastName].filter(Boolean).join(' '));

    return {
        displayName: companyName || fullName || fallbackName,
        companyName,
        firstName,
        lastName,
    };
}

async function resolveCustomerSource(db: any): Promise<ResolvedCustomerSource> {
    const crmTableExists = await db.schema.hasTable('crm_customers').catch(() => false);
    if (!crmTableExists) return { mode: 'videoplattform', hasLinkColumn: false };

    const hasLinkColumn = await db.schema.hasColumn('vp_customers', 'crm_customer_id').catch(() => false);
    if (!hasLinkColumn) return { mode: 'videoplattform', hasLinkColumn: false };

    return { mode: 'crm', hasLinkColumn: true };
}

async function syncCustomersFromCrm(db: any, tenantId: number): Promise<void> {
    const hasCrmColumn = await db.schema.hasColumn('vp_customers', 'crm_customer_id').catch(() => false);
    if (!hasCrmColumn) return;

    const crmRows = await db('crm_customers')
        .where({ tenant_id: tenantId })
        .whereIn('status', ['active', 'prospect', 'inactive'])
        .select('id', 'type', 'company_name', 'first_name', 'last_name', 'created_at');

    for (const crmRow of crmRows) {
        const crmId = Number(crmRow.id);
        const name = buildCustomerDisplayName(crmRow).slice(0, 255) || `CRM-Kunde #${crmId}`;

        const existingByCrm = await db('vp_customers')
            .where({ tenant_id: tenantId, crm_customer_id: crmId })
            .first('id', 'name');

        if (existingByCrm) {
            if (String(existingByCrm.name || '') !== name) {
                try {
                    await db('vp_customers')
                        .where({ id: existingByCrm.id, tenant_id: tenantId })
                        .update({ name });
                } catch (error: any) {
                    if (error?.code !== 'ER_DUP_ENTRY') throw error;
                    await db('vp_customers')
                        .where({ id: existingByCrm.id, tenant_id: tenantId })
                        .update({ name: buildUniqueCustomerName(name, crmId) });
                }
            }
            continue;
        }

        const existingByName = await db('vp_customers')
            .where({ tenant_id: tenantId, name })
            .first('id', 'crm_customer_id');

        if (existingByName && !existingByName.crm_customer_id) {
            await db('vp_customers')
                .where({ id: existingByName.id, tenant_id: tenantId })
                .update({ crm_customer_id: crmId });
            continue;
        }

        try {
            await db('vp_customers').insert({
                tenant_id: tenantId,
                name,
                crm_customer_id: crmId,
                created_at: crmRow.created_at || new Date(),
            });
        } catch (error: any) {
            if (error?.code !== 'ER_DUP_ENTRY') throw error;
            await db('vp_customers').insert({
                tenant_id: tenantId,
                name: buildUniqueCustomerName(name, crmId),
                crm_customer_id: crmId,
                created_at: crmRow.created_at || new Date(),
            });
        }
    }
}

async function assertCustomerExists(db: any, tenantId: number, customerId: number, source: ResolvedCustomerSource): Promise<boolean> {
    const query = db('vp_customers').where({ id: customerId, tenant_id: tenantId });
    if (source.mode === 'crm') query.whereNotNull('crm_customer_id');
    const customer = await query.first('id');
    return Boolean(customer);
}

async function resolveCustomerByEmail(db: any, normalizedEmail: string): Promise<{ tenantId: number; crmCustomerId: number; customerName: string } | null> {
    const hasCrmCustomers = await db.schema.hasTable('crm_customers').catch(() => false);
    const hasCrmContacts = await db.schema.hasTable('crm_contacts').catch(() => false);
    if (!hasCrmCustomers) return null;

    if (hasCrmContacts) {
        const contactMatch = await db('crm_contacts as cc')
            .join('crm_customers as c', function joinCustomer() {
                this.on('c.id', '=', 'cc.customer_id').andOn('c.tenant_id', '=', 'cc.tenant_id');
            })
            .whereRaw('LOWER(cc.email) = ?', [normalizedEmail])
            .whereIn('c.status', ['active', 'prospect', 'inactive'])
            .orderBy('cc.is_primary', 'desc')
            .orderBy('cc.id', 'asc')
            .select('c.id as crm_customer_id', 'c.tenant_id', 'c.company_name', 'c.first_name', 'c.last_name')
            .first();

        if (contactMatch) {
            return {
                tenantId: Number(contactMatch.tenant_id),
                crmCustomerId: Number(contactMatch.crm_customer_id),
                customerName: buildCustomerDisplayName(contactMatch),
            };
        }
    }

    const customerMatch = await db('crm_customers as c')
        .whereRaw('LOWER(c.email) = ?', [normalizedEmail])
        .whereIn('c.status', ['active', 'prospect', 'inactive'])
        .orderBy('c.id', 'asc')
        .select('c.id as crm_customer_id', 'c.tenant_id', 'c.company_name', 'c.first_name', 'c.last_name')
        .first();

    if (!customerMatch) return null;
    return {
        tenantId: Number(customerMatch.tenant_id),
        crmCustomerId: Number(customerMatch.crm_customer_id),
        customerName: buildCustomerDisplayName(customerMatch),
    };
}

async function ensureVpCustomerForCrm(db: any, tenantId: number, crmCustomerId: number, customerName: string): Promise<number | null> {
    const hasColumn = await db.schema.hasColumn('vp_customers', 'crm_customer_id').catch(() => false);
    if (!hasColumn) return null;

    const existingByCrm = await db('vp_customers')
        .where({ tenant_id: tenantId, crm_customer_id: crmCustomerId })
        .first('id', 'name');

    if (existingByCrm) {
        if (String(existingByCrm.name || '') !== customerName) {
            try {
                await db('vp_customers')
                    .where({ id: existingByCrm.id, tenant_id: tenantId })
                    .update({ name: customerName });
            } catch (error: any) {
                if (error?.code !== 'ER_DUP_ENTRY') throw error;
                await db('vp_customers')
                    .where({ id: existingByCrm.id, tenant_id: tenantId })
                    .update({ name: buildUniqueCustomerName(customerName, crmCustomerId) });
            }
        }
        return Number(existingByCrm.id);
    }

    const existingByName = await db('vp_customers')
        .where({ tenant_id: tenantId, name: customerName })
        .first('id', 'crm_customer_id');

    if (existingByName) {
        if (!existingByName.crm_customer_id) {
            await db('vp_customers')
                .where({ id: existingByName.id, tenant_id: tenantId })
                .update({ crm_customer_id: crmCustomerId });
        }
        return Number(existingByName.id);
    }

    let id: any;
    try {
        [id] = await db('vp_customers').insert({
            tenant_id: tenantId,
            name: customerName,
            crm_customer_id: crmCustomerId,
            created_at: new Date(),
        });
    } catch (error: any) {
        if (error?.code !== 'ER_DUP_ENTRY') throw error;
        [id] = await db('vp_customers').insert({
            tenant_id: tenantId,
            name: buildUniqueCustomerName(customerName, crmCustomerId),
            crm_customer_id: crmCustomerId,
            created_at: new Date(),
        });
    }
    return Number(id);
}

async function verifyPublicSessionByToken(db: any, token: string): Promise<PublicSessionRecord | null> {
    const hash = hashValue(token);
    const row = await db('vp_public_sessions')
        .where({ token_hash: hash })
        .whereNull('revoked_at')
        .andWhere('expires_at', '>=', db.fn.now())
        .first();
    return row as PublicSessionRecord || null;
}

async function getVideosForCustomer(db: any, tenantId: number, customerId: number): Promise<VideoRecord[]> {
    return db('vp_videos as v')
        .leftJoin('vp_customers as c', function joinCustomer() {
            this.on('c.id', '=', 'v.customer_id').andOn('c.tenant_id', '=', 'v.tenant_id');
        })
        .where('v.tenant_id', tenantId)
        .andWhere('v.customer_id', customerId)
        .select('v.*', 'c.name as customer_name')
        .orderBy('v.created_at', 'desc');
}

export default async function plugin(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();
    await ensureVideoplattformSchema(db);
    const brandingDir = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID, 'branding');

    async function upsertPluginSetting(key: string, value: string): Promise<void> {
        const encrypted = encrypt(value);
        const existing = await db('settings')
            .where({ plugin_id: PLUGIN_ID, key })
            .whereNull('tenant_id')
            .first('id');

        if (existing) {
            await db('settings').where({ id: existing.id }).update({ value_encrypted: encrypted });
            return;
        }

        await db('settings').insert({
            key,
            value_encrypted: encrypted,
            category: 'plugin',
            plugin_id: PLUGIN_ID,
            tenant_id: null,
        });
    }

    async function listCodesForScope(tenantId: number, scope: 'video' | 'customer', id: number): Promise<any[]> {
        const base = db('vp_share_codes')
            .where({ tenant_id: tenantId, scope })
            .orderBy('created_at', 'desc');

        const rows = scope === 'video'
            ? await base.andWhere({ video_id: id })
            : await base.andWhere({ customer_id: id });

        return rows.map((row: CodeRecord) => ({
            id: row.id,
            code: row.code,
            isActive: Boolean(row.is_active),
            expiresAt: row.expires_at,
            createdAt: row.created_at,
            scope: row.scope,
        }));
    }

    fastify.get('/customers', { preHandler: [requirePermission('videoplattform.view')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const source = await resolveCustomerSource(db);
        if (source.mode === 'crm') {
            await syncCustomersFromCrm(db, tenantId);
        }

        let query = db('vp_customers as c')
            .where('c.tenant_id', tenantId)
            .select(
                'c.id',
                'c.name',
                'c.created_at',
                db.raw('(SELECT COUNT(*) FROM vp_videos v WHERE v.tenant_id = c.tenant_id AND v.customer_id = c.id) AS video_count'),
                db.raw("(SELECT COUNT(*) FROM vp_share_codes sc WHERE sc.tenant_id = c.tenant_id AND sc.customer_id = c.id AND sc.scope = 'customer' AND sc.is_active = 1 AND (sc.expires_at IS NULL OR sc.expires_at >= NOW())) AS active_code_count")
            )
            .orderBy('c.created_at', 'desc');

        if (source.mode === 'crm') {
            query = query.whereNotNull('c.crm_customer_id');
        }

        const rows = await query;
        reply.header('X-Videoplattform-Customer-Source', source.mode);

        return rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            createdAt: row.created_at,
            videoCount: Number(row.video_count || 0),
            activeCodeCount: Number(row.active_code_count || 0),
        }));
    });

    fastify.post('/customers', { preHandler: [requirePermission('videoplattform.manage')] }, async (request, reply) => {
        return reply.status(409).send({
            error: 'Manuelle Kundenanlage ist deaktiviert. Kunden bitte im CRM verwalten.',
        });
    });

    fastify.put('/customers/:id', { preHandler: [requirePermission('videoplattform.manage')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const source = await resolveCustomerSource(db);
        if (source.mode === 'crm') {
            return reply.status(409).send({ error: 'Kunden werden aus dem CRM synchronisiert und können hier nicht manuell bearbeitet werden.' });
        }

        const id = Number((request.params as any)?.id);
        const name = String((request.body as any)?.name || '').trim();

        if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Ungültige ID' });
        if (!name) return reply.status(400).send({ error: 'Kundenname ist erforderlich' });

        const existing = await db('vp_customers').where({ id, tenant_id: tenantId }).first();
        if (!existing) return reply.status(404).send({ error: 'Kunde nicht gefunden' });

        try {
            await db('vp_customers').where({ id, tenant_id: tenantId }).update({ name });
            await fastify.audit.log({
                action: 'videoplattform.customer.updated',
                category: 'plugin',
                entityType: 'vp_customers',
                entityId: String(id),
                pluginId: PLUGIN_ID,
                previousState: { name: existing.name },
                newState: { name },
            }, request);
            return { success: true };
        } catch {
            return reply.status(409).send({ error: 'Kundenname existiert bereits' });
        }
    });

    fastify.delete('/customers/:id', { preHandler: [requirePermission('videoplattform.manage')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const source = await resolveCustomerSource(db);
        if (source.mode === 'crm') {
            return reply.status(409).send({ error: 'Kunden werden aus dem CRM synchronisiert und können hier nicht gelöscht werden.' });
        }

        const id = Number((request.params as any)?.id);

        if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Ungültige ID' });

        const existing = await db('vp_customers').where({ id, tenant_id: tenantId }).first();
        if (!existing) return reply.status(404).send({ error: 'Kunde nicht gefunden' });

        await db.transaction(async (trx) => {
            await trx('vp_share_codes').where({ tenant_id: tenantId, customer_id: id }).delete();
            await trx('vp_videos').where({ tenant_id: tenantId, customer_id: id }).update({ customer_id: null });
            await trx('vp_customers').where({ id, tenant_id: tenantId }).delete();
        });

        await fastify.audit.log({
            action: 'videoplattform.customer.deleted',
            category: 'plugin',
            entityType: 'vp_customers',
            entityId: String(id),
            pluginId: PLUGIN_ID,
            previousState: { name: existing.name },
        }, request);

        return { success: true };
    });

    fastify.get('/videos', { preHandler: [requirePermission('videoplattform.view')] }, async (request) => {
        const tenantId = getTenantId(request);
        const source = await resolveCustomerSource(db);
        if (source.mode === 'crm') {
            await syncCustomersFromCrm(db, tenantId);
        }
        const query = request.query as Record<string, any>;
        const customerId = Number(query.customerId || 0);
        const keyword = String(query.keyword || '').trim().toLowerCase();

        let builder = db('vp_videos as v')
            .leftJoin('vp_customers as c', function joinCustomers() {
                this.on('c.id', '=', 'v.customer_id').andOn('c.tenant_id', '=', 'v.tenant_id');
            })
            .where('v.tenant_id', tenantId)
            .select(
                'v.*',
                'c.name as customer_name',
                db.raw("(SELECT COUNT(*) FROM vp_share_codes sc WHERE sc.tenant_id = v.tenant_id AND sc.video_id = v.id AND sc.scope = 'video' AND sc.is_active = 1 AND (sc.expires_at IS NULL OR sc.expires_at >= NOW())) AS active_code_count")
            )
            .orderBy('v.created_at', 'desc');

        if (customerId > 0) {
            builder = builder.andWhere('v.customer_id', customerId);
        }

        if (keyword) {
            builder = builder.andWhere((qb: any) => {
                qb.whereRaw('LOWER(v.title) LIKE ?', [`%${keyword}%`])
                    .orWhereRaw("LOWER(COALESCE(v.description, '')) LIKE ?", [`%${keyword}%`])
                    .orWhereRaw('LOWER(v.category) LIKE ?', [`%${keyword}%`])
                    .orWhereRaw("LOWER(COALESCE(c.name, '')) LIKE ?", [`%${keyword}%`]);
            });
        }

        const rows = await builder;
        return rows.map((row: any) => ({
            ...formatVideo(row),
            activeCodeCount: Number(row.active_code_count || 0),
        }));
    });

    fastify.post('/videos', { preHandler: [requirePermission('videoplattform.manage')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const contentType = String(request.headers['content-type'] || '').toLowerCase();

        let payload: Record<string, any> = {};
        let uploadFile: any = null;

        if (contentType.includes('multipart/form-data')) {
            uploadFile = await (request as any).file();
            if (!uploadFile) return reply.status(400).send({ error: 'Datei ist erforderlich' });

            payload = {
                title: uploadFile.fields?.title?.value,
                description: uploadFile.fields?.description?.value,
                category: uploadFile.fields?.category?.value,
                customerId: uploadFile.fields?.customerId?.value,
            };
        } else {
            payload = (request.body || {}) as Record<string, any>;
        }

        const title = String(payload.title || '').trim();
        const description = String(payload.description || '').trim();
        const category = String(payload.category || 'Allgemein').trim() || 'Allgemein';
        const customerId = Number(payload.customerId || 0) || null;

        if (!title) return reply.status(400).send({ error: 'Titel ist erforderlich' });

        let customerExists = null;
        if (customerId) {
            const source = await resolveCustomerSource(db);
            customerExists = await assertCustomerExists(db, tenantId, customerId, source);
            if (!customerExists) return reply.status(400).send({ error: 'Kunde nicht gefunden' });
        }

        let sourceType: 'upload' | 'url' = 'url';
        let videoUrl: string | null = null;
        let fileName: string | null = null;
        let filePath: string | null = null;
        let mimeType: string | null = null;
        let sizeBytes: number | null = null;

        if (uploadFile) {
            const uploadBuffer = await uploadFile.toBuffer();
            const safeMime = String(uploadFile.mimetype || '').toLowerCase();
            if (!safeMime.startsWith('video/')) {
                return reply.status(400).send({ error: 'Nur Video-Dateien sind erlaubt' });
            }
            if (uploadBuffer.length <= 0) {
                return reply.status(400).send({ error: 'Leere Datei ist nicht erlaubt' });
            }
            if (uploadBuffer.length > MAX_VIDEO_SIZE_BYTES) {
                return reply.status(413).send({ error: 'Datei ist zu groß (max. 3 GB)' });
            }
            const stored = await storeUploadedVideoWithFallback({
                tenantId,
                originalFileName: String(uploadFile.filename || 'video'),
                originalMimeType: safeMime || 'video/mp4',
                uploadBuffer,
                requireTranscodeForCompatibility: !isLikelyBrowserPlayableFormat(String(uploadFile.filename || ''), safeMime),
                logWarn: (message) => fastify.log.warn(message),
            });

            sourceType = 'upload';
            fileName = stored.fileName;
            filePath = stored.filePath;
            mimeType = stored.mimeType;
            sizeBytes = stored.sizeBytes;
        } else {
            const rawUrl = String(payload.videoUrl || '').trim();
            if (!rawUrl) return reply.status(400).send({ error: 'Für URL-Video ist videoUrl erforderlich' });
            sourceType = 'url';
            videoUrl = rawUrl;
        }

        const [id] = await db('vp_videos').insert({
            tenant_id: tenantId,
            title,
            description: description || null,
            source_type: sourceType,
            video_url: videoUrl,
            file_name: fileName,
            file_path: filePath,
            mime_type: mimeType,
            size_bytes: sizeBytes,
            category,
            customer_id: customerId,
        });

        await fastify.audit.log({
            action: 'videoplattform.video.created',
            category: 'plugin',
            entityType: 'vp_videos',
            entityId: String(id),
            pluginId: PLUGIN_ID,
            newState: { title, sourceType, customerId },
        }, request);

        return reply.status(201).send({ id });
    });

    fastify.put('/videos/:id', { preHandler: [requirePermission('videoplattform.manage')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const id = Number((request.params as any)?.id);
        if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Ungültige ID' });

        const existing = await db('vp_videos').where({ id, tenant_id: tenantId }).first();
        if (!existing) return reply.status(404).send({ error: 'Video nicht gefunden' });

        const body = (request.body || {}) as Record<string, any>;
        const update: Record<string, any> = {
            updated_at: new Date(),
        };

        if (body.title !== undefined) update.title = String(body.title || '').trim();
        if (body.description !== undefined) update.description = String(body.description || '').trim() || null;
        if (body.category !== undefined) update.category = String(body.category || '').trim() || 'Allgemein';
        if (body.customerId !== undefined) {
            const customerId = Number(body.customerId || 0) || null;
            if (customerId) {
                const source = await resolveCustomerSource(db);
                const customer = await assertCustomerExists(db, tenantId, customerId, source);
                if (!customer) return reply.status(400).send({ error: 'Kunde nicht gefunden' });
            }
            update.customer_id = customerId;
        }

        await db('vp_videos').where({ id, tenant_id: tenantId }).update(update);

        await fastify.audit.log({
            action: 'videoplattform.video.updated',
            category: 'plugin',
            entityType: 'vp_videos',
            entityId: String(id),
            pluginId: PLUGIN_ID,
            previousState: { title: existing.title },
            newState: update,
        }, request);

        return { success: true };
    });

    fastify.post('/videos/:id/replace', { preHandler: [requirePermission('videoplattform.manage')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const id = Number((request.params as any)?.id);
        if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Ungültige ID' });

        const existing = await db('vp_videos').where({ id, tenant_id: tenantId }).first();
        if (!existing) return reply.status(404).send({ error: 'Video nicht gefunden' });

        const uploadFile = await (request as any).file();
        if (!uploadFile) return reply.status(400).send({ error: 'Datei ist erforderlich' });

        const uploadBuffer = await uploadFile.toBuffer();
        const safeMime = String(uploadFile.mimetype || '').toLowerCase();
        if (!safeMime.startsWith('video/')) return reply.status(400).send({ error: 'Nur Video-Dateien sind erlaubt' });
        if (uploadBuffer.length <= 0) return reply.status(400).send({ error: 'Leere Datei ist nicht erlaubt' });
        if (uploadBuffer.length > MAX_VIDEO_SIZE_BYTES) return reply.status(413).send({ error: 'Datei ist zu groß (max. 3 GB)' });
        const stored = await storeUploadedVideoWithFallback({
            tenantId,
            originalFileName: String(uploadFile.filename || 'video'),
            originalMimeType: safeMime || 'video/mp4',
            uploadBuffer,
            requireTranscodeForCompatibility: !isLikelyBrowserPlayableFormat(String(uploadFile.filename || ''), safeMime),
            logWarn: (message) => fastify.log.warn(message),
        });

        await db('vp_videos').where({ id, tenant_id: tenantId }).update({
            source_type: 'upload',
            video_url: null,
            file_name: stored.fileName,
            file_path: stored.filePath,
            mime_type: stored.mimeType,
            size_bytes: stored.sizeBytes,
            updated_at: new Date(),
        });

        if (existing.file_path) {
            const oldFilePath = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID, normalizeLocalVideoPath(existing.file_path));
            await fs.rm(oldFilePath, { force: true });
        }

        await fastify.audit.log({
            action: 'videoplattform.video.replaced',
            category: 'plugin',
            entityType: 'vp_videos',
            entityId: String(id),
            pluginId: PLUGIN_ID,
            previousState: { sourceType: existing.source_type, filePath: existing.file_path },
            newState: { sourceType: 'upload', filePath: stored.filePath },
        }, request);

        return { success: true };
    });

    fastify.get('/videos/:id/stream', { preHandler: [requirePermission('videoplattform.view')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const id = Number((request.params as any)?.id);
        if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Ungültige ID' });

        const video = await db('vp_videos')
            .where({ tenant_id: tenantId, id })
            .first();
        if (!video) return reply.status(404).send({ error: 'Video nicht gefunden' });

        if (video.source_type === 'url') {
            if (!video.video_url) return reply.status(404).send({ error: 'Video-URL fehlt' });
            return reply.redirect(video.video_url);
        }

        if (!video.file_path) return reply.status(404).send({ error: 'Videodatei fehlt' });
        const absPath = await resolveUploadVideoAbsolutePath(video);
        if (!absPath) {
            request.log.warn(`Videodatei nicht gefunden (admin stream), videoId=${video.id}, rel=${video.file_path}`);
            return reply.status(404).send({ error: 'Videodatei nicht gefunden' });
        }
        return sendVideoFile(request, reply, absPath, video.mime_type || 'video/mp4');
    });

    fastify.delete('/videos/:id', { preHandler: [requirePermission('videoplattform.manage')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const id = Number((request.params as any)?.id);
        if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Ungültige ID' });

        const existing = await db('vp_videos').where({ id, tenant_id: tenantId }).first();
        if (!existing) return reply.status(404).send({ error: 'Video nicht gefunden' });

        await db.transaction(async (trx) => {
            await trx('vp_share_codes').where({ tenant_id: tenantId, video_id: id }).delete();
            await trx('vp_videos').where({ id, tenant_id: tenantId }).delete();
        });

        if (existing.file_path) {
            const oldFilePath = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID, normalizeLocalVideoPath(existing.file_path));
            await fs.rm(oldFilePath, { force: true });
        }

        await fastify.audit.log({
            action: 'videoplattform.video.deleted',
            category: 'plugin',
            entityType: 'vp_videos',
            entityId: String(id),
            pluginId: PLUGIN_ID,
            previousState: { title: existing.title },
        }, request);

        return { success: true };
    });

    fastify.get('/videos/:id/codes', { preHandler: [requirePermission('videoplattform.view')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const id = Number((request.params as any)?.id);
        if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Ungültige ID' });

        const exists = await db('vp_videos').where({ id, tenant_id: tenantId }).first('id');
        if (!exists) return reply.status(404).send({ error: 'Video nicht gefunden' });

        return { items: await listCodesForScope(tenantId, 'video', id) };
    });

    fastify.post('/videos/:id/codes', { preHandler: [requirePermission('videoplattform.manage')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const id = Number((request.params as any)?.id);
        if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Ungültige ID' });

        const video = await db('vp_videos').where({ id, tenant_id: tenantId }).first('id');
        if (!video) return reply.status(404).send({ error: 'Video nicht gefunden' });

        const body = (request.body || {}) as Record<string, unknown>;
        const code = sanitizeCode(body.code) || await createUniqueCode(db, tenantId);
        const expiresAt = parseOptionalDate(body.expiresAt);

        const [newId] = await db('vp_share_codes').insert({
            tenant_id: tenantId,
            scope: 'video',
            video_id: id,
            customer_id: null,
            code,
            is_active: true,
            expires_at: expiresAt,
        });

        await fastify.audit.log({
            action: 'videoplattform.code.video.created',
            category: 'plugin',
            entityType: 'vp_share_codes',
            entityId: String(newId),
            pluginId: PLUGIN_ID,
            newState: { code, scope: 'video', videoId: id },
        }, request);

        return reply.status(201).send({ id: newId, code });
    });

    fastify.get('/customers/:id/codes', { preHandler: [requirePermission('videoplattform.view')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const id = Number((request.params as any)?.id);
        if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Ungültige ID' });

        const source = await resolveCustomerSource(db);
        const exists = await assertCustomerExists(db, tenantId, id, source);
        if (!exists) return reply.status(404).send({ error: 'Kunde nicht gefunden' });

        return { items: await listCodesForScope(tenantId, 'customer', id) };
    });

    fastify.post('/customers/:id/codes', { preHandler: [requirePermission('videoplattform.manage')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const id = Number((request.params as any)?.id);
        if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Ungültige ID' });

        const source = await resolveCustomerSource(db);
        const customer = await assertCustomerExists(db, tenantId, id, source);
        if (!customer) return reply.status(404).send({ error: 'Kunde nicht gefunden' });

        const body = (request.body || {}) as Record<string, unknown>;
        const code = sanitizeCode(body.code) || await createUniqueCode(db, tenantId);
        const expiresAt = parseOptionalDate(body.expiresAt);

        const [newId] = await db('vp_share_codes').insert({
            tenant_id: tenantId,
            scope: 'customer',
            video_id: null,
            customer_id: id,
            code,
            is_active: true,
            expires_at: expiresAt,
        });

        await fastify.audit.log({
            action: 'videoplattform.code.customer.created',
            category: 'plugin',
            entityType: 'vp_share_codes',
            entityId: String(newId),
            pluginId: PLUGIN_ID,
            newState: { code, scope: 'customer', customerId: id },
        }, request);

        return reply.status(201).send({ id: newId, code });
    });

    fastify.patch('/codes/:id', { preHandler: [requirePermission('videoplattform.manage')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const id = Number((request.params as any)?.id);
        if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Ungültige ID' });

        const existing = await db('vp_share_codes').where({ id, tenant_id: tenantId }).first();
        if (!existing) return reply.status(404).send({ error: 'Code nicht gefunden' });

        const body = (request.body || {}) as Record<string, unknown>;
        const update: Record<string, unknown> = {};

        if (body.isActive !== undefined) {
            update.is_active = Boolean(body.isActive);
        }
        if (body.expiresAt !== undefined) {
            update.expires_at = parseOptionalDate(body.expiresAt);
        }

        if (Object.keys(update).length === 0) {
            return reply.status(400).send({ error: 'Keine Änderungen übergeben' });
        }

        await db('vp_share_codes').where({ id, tenant_id: tenantId }).update(update);

        await fastify.audit.log({
            action: 'videoplattform.code.updated',
            category: 'plugin',
            entityType: 'vp_share_codes',
            entityId: String(id),
            pluginId: PLUGIN_ID,
            newState: update,
        }, request);

        return { success: true };
    });

    fastify.delete('/codes/:id', { preHandler: [requirePermission('videoplattform.manage')] }, async (request, reply) => {
        const tenantId = getTenantId(request);
        const id = Number((request.params as any)?.id);
        if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ error: 'Ungültige ID' });

        const existing = await db('vp_share_codes').where({ id, tenant_id: tenantId }).first();
        if (!existing) return reply.status(404).send({ error: 'Code nicht gefunden' });

        await db('vp_share_codes').where({ id, tenant_id: tenantId }).delete();

        await fastify.audit.log({
            action: 'videoplattform.code.deleted',
            category: 'plugin',
            entityType: 'vp_share_codes',
            entityId: String(id),
            pluginId: PLUGIN_ID,
            previousState: { code: existing.code },
        }, request);

        return { success: true };
    });

    fastify.get('/admin/branding/logo', { preHandler: [requirePermission('settings.manage')] }, async () => {
        const fileName = await readPublicLogoFile(db);
        return {
            exists: Boolean(fileName),
            url: fileName ? '/api/plugins/videoplattform/public/logo' : null,
            fileName,
        };
    });

    fastify.post('/admin/branding/logo', { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
        const file = await (request as any).file();
        if (!file) return reply.status(400).send({ error: 'Logo-Datei ist erforderlich' });

        const mimeType = String(file.mimetype || '').toLowerCase();
        if (!mimeType.startsWith('image/')) {
            return reply.status(400).send({ error: 'Nur Bilddateien sind erlaubt (png, jpg, webp, svg)' });
        }

        const buffer = await file.toBuffer();
        if (buffer.length <= 0) {
            return reply.status(400).send({ error: 'Leere Datei ist nicht erlaubt' });
        }
        if (buffer.length > 4 * 1024 * 1024) {
            return reply.status(413).send({ error: 'Logo ist zu groß (max. 4 MB)' });
        }

        await fs.mkdir(brandingDir, { recursive: true });
        const previousFileName = await readPublicLogoFile(db);
        const ext = path.extname(String(file.filename || '')).toLowerCase() || (mimeType === 'image/png' ? '.png' : '.jpg');
        const nextFileName = `portal-logo-${Date.now()}-${randomUUID()}${ext}`;
        const targetPath = path.join(brandingDir, nextFileName);
        await fs.writeFile(targetPath, buffer);

        await upsertPluginSetting(PUBLIC_LOGO_FILE_SETTING_KEY, nextFileName);

        if (previousFileName && previousFileName !== nextFileName) {
            await fs.rm(path.join(brandingDir, previousFileName), { force: true }).catch(() => undefined);
        }

        return {
            success: true,
            url: `/api/plugins/videoplattform/public/logo?v=${Date.now()}`,
            fileName: nextFileName,
        };
    });

    fastify.delete('/admin/branding/logo', { preHandler: [requirePermission('settings.manage')] }, async () => {
        const previousFileName = await readPublicLogoFile(db);
        if (previousFileName) {
            await fs.rm(path.join(brandingDir, previousFileName), { force: true }).catch(() => undefined);
        }
        await upsertPluginSetting(PUBLIC_LOGO_FILE_SETTING_KEY, '');
        return { success: true };
    });

    fastify.get('/activity', { preHandler: [requirePermission('videoplattform.view')] }, async (request) => {
        const tenantId = getTenantId(request);
        const limitRaw = Number((request.query as any)?.limit || 100);
        const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 100));

        const rows = await db('vp_activity_logs as l')
            .leftJoin('vp_videos as v', function joinVideo() {
                this.on('v.id', '=', 'l.video_id').andOn('v.tenant_id', '=', 'l.tenant_id');
            })
            .leftJoin('vp_customers as c', function joinCustomer() {
                this.on('c.id', '=', 'l.customer_id').andOn('c.tenant_id', '=', 'l.tenant_id');
            })
            .where('l.tenant_id', tenantId)
            .select('l.*', 'v.title as video_title', 'c.name as customer_name')
            .orderBy('l.created_at', 'desc')
            .limit(limit);

        return rows.map((row: any) => ({
            id: row.id,
            createdAt: row.created_at,
            eventType: row.event_type,
            ip: row.ip,
            code: row.code,
            success: Boolean(row.success),
            detail: row.detail,
            videoId: row.video_id,
            videoTitle: row.video_title || null,
            customerId: row.customer_id,
            customerName: row.customer_name || null,
        }));
    });

    fastify.get('/public/config', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        const ok = await ensurePublicHost(request, reply);
        if (!ok) return;

        const configuredHost = await readPublicSubdomain(db);
        const fallbackLogoFile = await readPublicLogoFile(db);
        const logoHeight = await readPublicLogoHeight(db);
        const authMode = await readPublicAuthMode(db);
        
        const firstTenant = await db('tenants').orderBy('id', 'asc').first('id', 'name', 'logo_file');
        const tenantName = firstTenant?.name || 'Hammer WorkSpace';
        const tenantLogoUrl = firstTenant?.logo_file ? `/api/plugins/videoplattform/public/tenant-logo/${firstTenant.id}` : null;

        return {
            expectedHost: configuredHost,
            brand: tenantName,
            tenantName,
            tenantLogoUrl,
            authMode,
            logoUrl: fallbackLogoFile ? '/api/plugins/videoplattform/public/logo' : null,
            logoHeight,
        };
    });

    fastify.get('/public/portal/videos', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        const ok = await ensurePublicHost(request, reply);
        if (!ok) return;

        const sessionToken = String((request.query as any)?.sessionToken || '').trim();
        if (!sessionToken) return reply.status(401).send({ error: 'Session-Token ist erforderlich.' });

        const rawHash = createHash('sha256').update(sessionToken).digest('hex');
        const sessionTokenHash = createHash('sha256').update(rawHash).digest('hex');

        const session = await db('vp_public_sessions')
            .where({ token_hash: sessionTokenHash })
            .andWhere('expires_at', '>', new Date())
            .first();

        if (!session) return reply.status(401).send({ error: 'Session ungültig oder abgelaufen.' });

        const videos = await getVideosForCustomer(db, Number(session.tenant_id), Number(session.customer_id));
        return {
            videos: videos.map((video) => formatVideo(video)),
        };
    });

    fastify.post('/public/access/by-code', {
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        const ok = await ensurePublicHost(request, reply);
        if (!ok) return;
        const authMode = await readPublicAuthMode(db);
        if (authMode !== 'share_code') {
            return reply.status(409).send({ error: 'Freigabecode-Login ist deaktiviert.' });
        }

        const code = sanitizeCode((request.body as any)?.code);
        if (!code) return reply.status(400).send({ error: 'Freigabecode ist erforderlich' });

        const codeRow = await db('vp_share_codes').where({ code, is_active: true }).first();
        if (!codeRow || isCodeExpired(codeRow.expires_at)) {
            await logActivity(db, {
                tenantId: codeRow?.tenant_id || null,
                eventType: 'code_access',
                request,
                code,
                success: false,
                detail: 'Ungültiger oder abgelaufener Freigabecode',
            });
            return reply.status(404).send({ error: 'Code ungültig oder abgelaufen' });
        }

        let videos: VideoRecord[] = [];
        let customerName: string | null = null;
        let tenantLogoUrl: string | null = null;

        if (codeRow.scope === 'video' && codeRow.video_id) {
            const video = await db('vp_videos as v')
                .leftJoin('vp_customers as c', function joinCustomer() {
                    this.on('c.id', '=', 'v.customer_id').andOn('c.tenant_id', '=', 'v.tenant_id');
                })
                .where('v.tenant_id', codeRow.tenant_id)
                .andWhere('v.id', codeRow.video_id)
                .select('v.*', 'c.name as customer_name')
                .first();
            if (video) {
                videos = [video as VideoRecord];
                customerName = video.customer_name || null;
            }
        }

        if (codeRow.scope === 'customer' && codeRow.customer_id) {
            const customer = await db('vp_customers')
                .where({ tenant_id: codeRow.tenant_id, id: codeRow.customer_id })
                .first('name');
            customerName = customer?.name || null;

            videos = await db('vp_videos as v')
                .leftJoin('vp_customers as c', function joinCustomer() {
                    this.on('c.id', '=', 'v.customer_id').andOn('c.tenant_id', '=', 'v.tenant_id');
                })
                .where('v.tenant_id', codeRow.tenant_id)
                .andWhere((qb: any) => {
                    qb.where('v.customer_id', codeRow.customer_id).orWhereNull('v.customer_id');
                })
                .select('v.*', 'c.name as customer_name')
                .orderBy('v.created_at', 'desc');
        }

        await logActivity(db, {
            tenantId: codeRow.tenant_id,
            eventType: 'code_access',
            request,
            code,
            success: videos.length > 0,
            customerId: codeRow.customer_id,
            videoId: codeRow.video_id,
            detail: videos.length > 0 ? 'Freigabe erfolgreich' : 'Keine Videos gefunden',
        });

        if (videos.length === 0) {
            return reply.status(404).send({ error: 'Keine Videos für diesen Code verfügbar' });
        }

        const tenant = await db('tenants')
            .where({ id: codeRow.tenant_id })
            .first('id', 'logo_file', 'name');
        if (tenant?.logo_file) {
            tenantLogoUrl = `/api/plugins/videoplattform/public/tenant-logo/${Number(tenant.id)}?code=${encodeURIComponent(code)}`;
        }

        const fallbackLogoFile = await readPublicLogoFile(db);

        return {
            code,
            scope: codeRow.scope,
            customerId: codeRow.customer_id,
            customerName,
            tenantName: tenant?.name || null,
            tenantLogoUrl,
            logoUrl: fallbackLogoFile ? '/api/plugins/videoplattform/public/logo' : null,
            videos: videos.map((video) => formatVideo(video)),
        };
    });

    fastify.post('/public/auth/request-code', {
        config: {
            policy: { public: true },
            rateLimit: {
                max: MAGIC_CODE_REQUEST_RATE_MAX,
                timeWindow: MAGIC_CODE_REQUEST_RATE_WINDOW_MS,
                keyGenerator: (req: FastifyRequest) => req.ip,
                errorResponseBuilder: () => ({
                    success: true,
                    message: 'Wenn die E-Mail bekannt ist, wurde ein Code versendet.',
                }),
            },
        },
        policy: { public: true },
    }, async (request, reply) => {
        const ok = await ensurePublicHost(request, reply);
        if (!ok) return;

        const authMode = await readPublicAuthMode(db);
        if (authMode !== 'magic_code') {
            return reply.status(409).send({ error: 'Magic-Code-Login ist nicht aktiv.' });
        }

        const email = normalizeEmail((request.body as any)?.email);
        if (!email || !email.includes('@')) {
            return reply.status(400).send({ error: 'Gültige E-Mail ist erforderlich.' });
        }
        const emailHash = hashValue(email);
        const cutoff = new Date(Date.now() - MAGIC_CODE_REQUEST_EMAIL_WINDOW_MS);

        // Zusätzliche Schutzschicht gegen Mail-Spam auf dieselbe Adresse.
        const recentForEmail = await db('vp_magic_codes')
            .where({ email_hash: emailHash })
            .andWhere('created_at', '>=', cutoff)
            .count('id as count')
            .first();
        if (Number(recentForEmail?.count || 0) >= MAGIC_CODE_REQUEST_EMAIL_MAX) {
            return { success: true, message: 'Wenn die E-Mail bekannt ist, wurde ein Code versendet.' };
        }

        const resolved = await resolveCustomerByEmail(db, email);
        // Immer generische Antwort für Datenschutz.
        if (!resolved) return { success: true, message: 'Wenn die E-Mail bekannt ist, wurde ein Code versendet.' };

        await syncCustomersFromCrm(db, resolved.tenantId).catch(() => undefined);
        const vpCustomerId = await ensureVpCustomerForCrm(db, resolved.tenantId, resolved.crmCustomerId, resolved.customerName);
        if (!vpCustomerId) return { success: true, message: 'Wenn die E-Mail bekannt ist, wurde ein Code versendet.' };

        const code = createMagicCode();
        const codeHash = hashValue(`${email}|${code}`);
        const expiresAt = new Date(Date.now() + MAGIC_CODE_TTL_MINUTES * 60 * 1000);

        await db('vp_magic_codes')
            .where({ tenant_id: resolved.tenantId, customer_id: vpCustomerId, email_hash: emailHash })
            .whereNull('used_at')
            .andWhere('expires_at', '>=', db.fn.now())
            .update({ used_at: db.fn.now() });

        await db('vp_magic_codes').insert({
            tenant_id: resolved.tenantId,
            customer_id: vpCustomerId,
            email_normalized: email,
            email_hash: emailHash,
            code_hash: codeHash,
            expires_at: expiresAt,
            ip: String(request.ip || '').slice(0, 120) || null,
            user_agent: String(request.headers['user-agent'] || '').slice(0, 1000) || null,
            created_at: new Date(),
        });

        await fastify.mail.send({
            to: email,
            subject: 'Ihr Login-Code für das Kundenportal',
            text: `Hallo,\n\nIhr Login-Code lautet: ${code}\n\nDer Code ist ${MAGIC_CODE_TTL_MINUTES} Minuten gültig.\n\nWenn Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail.`,
            html: `<p>Hallo,</p><p>Ihr Login-Code lautet:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Der Code ist <strong>${MAGIC_CODE_TTL_MINUTES} Minuten</strong> gültig.</p><p>Wenn Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail.</p>`,
        });

        await logActivity(db, {
            tenantId: resolved.tenantId,
            eventType: 'magic_code.requested',
            request,
            customerId: vpCustomerId,
            success: true,
            detail: 'Magic-Code per E-Mail versendet',
        });

        return { success: true, message: 'Wenn die E-Mail bekannt ist, wurde ein Code versendet.' };
    });

    fastify.post('/public/auth/verify-code', {
        config: {
            policy: { public: true },
            rateLimit: {
                max: MAGIC_CODE_VERIFY_RATE_MAX,
                timeWindow: MAGIC_CODE_VERIFY_RATE_WINDOW_MS,
                keyGenerator: (req: FastifyRequest) => req.ip,
                errorResponseBuilder: () => ({
                    error: 'Zu viele Versuche. Bitte kurz warten und erneut probieren.',
                }),
            },
        },
        policy: { public: true },
    }, async (request, reply) => {
        const ok = await ensurePublicHost(request, reply);
        if (!ok) return;

        const authMode = await readPublicAuthMode(db);
        if (authMode !== 'magic_code') {
            return reply.status(409).send({ error: 'Magic-Code-Login ist nicht aktiv.' });
        }

        const email = normalizeEmail((request.body as any)?.email);
        const code = String((request.body as any)?.code || '').trim();
        if (!email || !email.includes('@')) return reply.status(400).send({ error: 'Gültige E-Mail ist erforderlich.' });
        if (!/^\d{6}$/.test(code)) return reply.status(400).send({ error: '6-stelliger Code erforderlich.' });

        const emailHash = hashValue(email);
        const codeHash = hashValue(`${email}|${code}`);
        await db('vp_magic_codes')
            .where({ email_hash: emailHash })
            .whereNull('used_at')
            .andWhere('expires_at', '>=', db.fn.now())
            .increment('attempts', 1);

        const row = await db('vp_magic_codes')
            .where({ email_hash: emailHash, code_hash: codeHash })
            .whereNull('used_at')
            .andWhere('expires_at', '>=', db.fn.now())
            .andWhere('attempts', '<=', MAGIC_CODE_MAX_VERIFY_ATTEMPTS)
            .orderBy('created_at', 'desc')
            .first();

        if (!row) {
            await logActivity(db, {
                tenantId: null,
                eventType: 'magic_code.verify',
                request,
                success: false,
                detail: 'Ungültiger oder abgelaufener Magic-Code',
            });
            return reply.status(401).send({ error: 'Ungültiger oder abgelaufener Code.' });
        }

        await db('vp_magic_codes').where({ id: row.id }).update({ used_at: db.fn.now() });
        await db('vp_public_sessions')
            .where({ tenant_id: row.tenant_id, customer_id: row.customer_id, email_normalized: email })
            .whereNull('revoked_at')
            .update({ revoked_at: db.fn.now() });

        const sessionToken = createSessionToken();
        const sessionTokenHash = hashValue(sessionToken);
        const sessionExpiresAt = new Date(Date.now() + MAGIC_SESSION_TTL_HOURS * 60 * 60 * 1000);

        await db('vp_public_sessions').insert({
            tenant_id: row.tenant_id,
            customer_id: row.customer_id,
            email_normalized: email,
            token_hash: sessionTokenHash,
            expires_at: sessionExpiresAt,
            last_used_at: new Date(),
            ip: String(request.ip || '').slice(0, 120) || null,
            user_agent: String(request.headers['user-agent'] || '').slice(0, 1000) || null,
            created_at: new Date(),
        });

        const customerProfile = await getPortalCustomerProfile(db, Number(row.tenant_id), Number(row.customer_id));
        const videos = await getVideosForCustomer(db, Number(row.tenant_id), Number(row.customer_id));
        const tenant = await db('tenants').where({ id: row.tenant_id }).first('id', 'logo_file', 'name');
        const fallbackLogoFile = await readPublicLogoFile(db);

        await logActivity(db, {
            tenantId: row.tenant_id,
            eventType: 'magic_code.verify',
            request,
            customerId: row.customer_id,
            success: true,
            detail: 'Portal-Login erfolgreich',
        });

        return {
            sessionToken,
            expiresAt: sessionExpiresAt.toISOString(),
            customerId: row.customer_id,
            customerName: customerProfile.displayName || null,
            customerProfile,
            tenantName: tenant?.name || null,
            tenantLogoUrl: tenant?.logo_file
                ? `/api/plugins/videoplattform/public/tenant-logo/${Number(tenant.id)}?sessionToken=${encodeURIComponent(sessionToken)}`
                : null,
            logoUrl: fallbackLogoFile ? '/api/plugins/videoplattform/public/logo' : null,
            videos: videos.map((video) => formatVideo(video)),
        };
    });

    fastify.get('/public/access/by-session', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        const ok = await ensurePublicHost(request, reply);
        if (!ok) return;

        const sessionToken = String((request.query as any)?.sessionToken || '').trim();
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session ungültig oder abgelaufen.' });

        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        const customerProfile = await getPortalCustomerProfile(db, Number(session.tenant_id), Number(session.customer_id));
        const videos = await getVideosForCustomer(db, Number(session.tenant_id), Number(session.customer_id));
        const tenant = await db('tenants').where({ id: session.tenant_id }).first('id', 'logo_file', 'name');
        const fallbackLogoFile = await readPublicLogoFile(db);

        return {
            sessionToken,
            expiresAt: session.expires_at,
            customerId: session.customer_id,
            customerName: customerProfile.displayName || null,
            customerProfile,
            tenantName: tenant?.name || null,
            tenantLogoUrl: tenant?.logo_file
                ? `/api/plugins/videoplattform/public/tenant-logo/${Number(tenant.id)}?sessionToken=${encodeURIComponent(sessionToken)}`
                : null,
            logoUrl: fallbackLogoFile ? '/api/plugins/videoplattform/public/logo' : null,
            videos: videos.map((video) => formatVideo(video)),
        };
    });

    fastify.post('/public/auth/logout', {
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = String((request.body as any)?.sessionToken || '').trim();
        if (!sessionToken) return { success: true };
        const tokenHash = hashValue(sessionToken);
        await db('vp_public_sessions')
            .where({ token_hash: tokenHash })
            .whereNull('revoked_at')
            .update({ revoked_at: db.fn.now() });
        return { success: true };
    });

    fastify.get('/public/stream/:videoId', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        const ok = await ensurePublicHost(request, reply);
        if (!ok) return;

        const videoId = Number((request.params as any)?.videoId);
        const code = sanitizeCode((request.query as any)?.code);
        const sessionToken = String((request.query as any)?.sessionToken || '').trim();
        if (!Number.isInteger(videoId) || videoId <= 0) return reply.status(400).send({ error: 'Ungültige Video-ID' });
        if (!code && !sessionToken) return reply.status(400).send({ error: 'Code oder Session-Token ist erforderlich' });

        let tenantId: number | null = null;
        let customerId: number | null = null;
        let accessKind: 'share_code' | 'magic_session' = 'share_code';

        if (sessionToken) {
            const session = await verifyPublicSessionByToken(db, sessionToken);
            if (!session) {
                await logActivity(db, {
                    tenantId: null,
                    eventType: 'video_stream',
                    request,
                    videoId,
                    success: false,
                    detail: 'Ungültige oder abgelaufene Session',
                });
                return reply.status(401).send({ error: 'Session ungültig oder abgelaufen' });
            }
            tenantId = Number(session.tenant_id);
            customerId = Number(session.customer_id);
            accessKind = 'magic_session';
            await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });
        } else {
            const codeRow = await db('vp_share_codes').where({ code, is_active: true }).first();
            if (!codeRow || isCodeExpired(codeRow.expires_at)) {
                await logActivity(db, {
                    tenantId: codeRow?.tenant_id || null,
                    eventType: 'video_stream',
                    request,
                    code,
                    videoId,
                    success: false,
                    detail: 'Ungültiger oder abgelaufener Freigabecode',
                });
                return reply.status(403).send({ error: 'Code ungültig oder abgelaufen' });
            }
            tenantId = Number(codeRow.tenant_id);
            if (codeRow.scope === 'customer' && Number(codeRow.customer_id) > 0) customerId = Number(codeRow.customer_id);
            accessKind = 'share_code';
        }

        const video = await db('vp_videos')
            .where({ tenant_id: tenantId, id: videoId })
            .first();

        if (!video) {
            await logActivity(db, {
                tenantId,
                eventType: 'video_stream',
                request,
                code,
                videoId,
                success: false,
                detail: 'Video nicht gefunden',
            });
            return reply.status(404).send({ error: 'Video nicht gefunden' });
        }

        let allowed = false;
        if (accessKind === 'magic_session') {
            allowed = Number(video.customer_id) > 0 && Number(video.customer_id) === Number(customerId);
        } else {
            const codeRow = await db('vp_share_codes').where({ code, is_active: true }).first();
            allowed = Boolean(codeRow && (
                (codeRow.scope === 'video' && Number(codeRow.video_id) === videoId)
                || (codeRow.scope === 'customer'
                    && Number(codeRow.customer_id) > 0
                    && (Number(codeRow.customer_id) === Number(video.customer_id) || video.customer_id === null))
            ));
        }

        if (!allowed) {
            await logActivity(db, {
                tenantId,
                eventType: 'video_stream',
                request,
                code,
                videoId,
                customerId: video.customer_id,
                success: false,
                detail: 'Code nicht berechtigt für dieses Video',
            });
            return reply.status(403).send({ error: 'Keine Berechtigung für dieses Video' });
        }

        const streamVideo = await ensurePlayableUploadForStreaming(db, video as VideoRecord, (msg) => request.log.warn(msg));

        await logActivity(db, {
            tenantId,
            eventType: 'video_stream',
            request,
            code,
            videoId,
            customerId: streamVideo.customer_id,
            success: true,
            detail: 'Video-Stream gestartet',
        });

        if (streamVideo.source_type === 'url') {
            if (!streamVideo.video_url) return reply.status(404).send({ error: 'Video-URL fehlt' });
            return reply.redirect(streamVideo.video_url);
        }

        if (!streamVideo.file_path) return reply.status(404).send({ error: 'Videodatei fehlt' });
        const absPath = await resolveUploadVideoAbsolutePath(streamVideo);
        if (!absPath) {
            request.log.warn(`Videodatei nicht gefunden (public stream), videoId=${streamVideo.id}, rel=${streamVideo.file_path}`);
            return reply.status(404).send({ error: 'Videodatei nicht gefunden' });
        }
        return sendVideoFile(request, reply, absPath, streamVideo.mime_type || 'video/mp4');
    });

    fastify.get('/public/health', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async () => ({ ok: true, plugin: PLUGIN_ID }));

    fastify.get('/public/logo', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (_request, reply) => {
        const fileName = await readPublicLogoFile(db);
        if (!fileName) return reply.status(404).send({ error: 'Kein Portal-Logo hinterlegt' });
        const absPath = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID, 'branding', fileName);
        try {
            await fs.access(absPath);
            reply.header('Cache-Control', 'public, max-age=300');
            reply.type(logoMimeTypeFromFileName(fileName));
            return reply.send(createReadStream(absPath));
        } catch {
            return reply.status(404).send({ error: 'Logo-Datei nicht gefunden' });
        }
    });

    fastify.get('/public/tenant-logo/:tenantId', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        const ok = await ensurePublicHost(request, reply);
        if (!ok) return;

        const tenantId = Number((request.params as any)?.tenantId);
        const code = sanitizeCode((request.query as any)?.code);
        const sessionToken = String((request.query as any)?.sessionToken || '').trim();
        if (!Number.isInteger(tenantId) || tenantId <= 0) return reply.status(400).send({ error: 'Ungültige Tenant-ID' });
        if (!code && !sessionToken) return reply.status(400).send({ error: 'Code oder Session-Token ist erforderlich' });

        if (sessionToken) {
            const session = await verifyPublicSessionByToken(db, sessionToken);
            if (!session || Number(session.tenant_id) !== tenantId) {
                return reply.status(403).send({ error: 'Keine Berechtigung für dieses Logo' });
            }
        } else {
            const codeRow = await db('vp_share_codes').where({ code, is_active: true }).first('tenant_id', 'expires_at');
            if (!codeRow || isCodeExpired(codeRow.expires_at) || Number(codeRow.tenant_id) !== tenantId) {
                return reply.status(403).send({ error: 'Keine Berechtigung für dieses Logo' });
            }
        }

        const tenant = await db('tenants').where({ id: tenantId }).first('logo_file');
        if (!tenant?.logo_file) return reply.status(404).send({ error: 'Kein Tenant-Logo vorhanden' });

        const absPath = path.join(config.app.uploadsDir, 'tenant-logos', String(tenant.logo_file));
        try {
            await fs.access(absPath);
            reply.header('Cache-Control', 'private, max-age=300');
            reply.type(logoMimeTypeFromFileName(String(tenant.logo_file)));
            return reply.send(createReadStream(absPath));
        } catch {
            return reply.status(404).send({ error: 'Tenant-Logo-Datei nicht gefunden' });
        }
    });

    fastify.head('/public/config', {
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (_request, reply) => {
        reply.status(200).send();
    });

    fastify.head('/public/stream/:videoId', {
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (_request, reply) => {
        reply.status(200).send();
    });

    fastify.head('/public/health', {
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (_request, reply) => {
        reply.status(200).send();
    });
}
