import { createHash, createSign } from 'crypto';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { createRequire } from 'module';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Archiver } from 'archiver';
import { getDatabase } from '../../../backend/src/core/database.js';
import { requirePermission } from '../../../backend/src/core/permissions.js';
import { decrypt } from '../../../backend/src/core/encryption.js';

const pluginRequire = createRequire(import.meta.url);
const backendRequire = createRequire(new URL('../../../backend/package.json', import.meta.url));

type ArchiverFactory = typeof import('archiver').default;

function resolveArchiverFactory(): { factory: ArchiverFactory | null; reason: string | null } {
    try {
        return { factory: pluginRequire('archiver'), reason: null };
    } catch {
        try {
            return { factory: backendRequire('archiver'), reason: null };
        } catch (error: any) {
            const reason = error instanceof Error ? error.message : String(error || 'unknown error');
            return { factory: null, reason };
        }
    }
}

const archiverResolution = resolveArchiverFactory();
const createZipArchiver = archiverResolution.factory;

const PLUGIN_ID = 'dateiaustausch_drive';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHAREPOINT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_CONCURRENT_PUBLIC_UPLOADS = 2;
const MAX_FILES_PER_BULK_UPLOAD = 20;
const CUSTOMER_UPLOADS_ROOT_NAME = 'Kundenuploads';
const DEFAULT_MAX_UPLOAD_MB = 1024;
const SUPPORTED_EXTENSIONS = [
    '.jpg', '.jpeg', '.png', '.webp',
    '.pdf', '.txt', '.csv',
    '.doc', '.docx', '.xlsx', '.pptx',
    '.ai', '.svg', '.psd',
    '.mp4', '.mov', '.webm',
    '.zip',
];
const SUPPORTED_EXTENSIONS_SET = new Set(SUPPORTED_EXTENSIONS);
const PREVIEWABLE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);
const PREVIEWABLE_DOCUMENT_EXTENSIONS = new Set(['.pdf']);
const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
const MAX_BULK_DOWNLOAD_ENTRIES = 2000;
const ALLOWED_MIME_BY_EXTENSION: Record<string, string[]> = {
    '.jpg': ['image/jpeg'],
    '.jpeg': ['image/jpeg'],
    '.png': ['image/png'],
    '.webp': ['image/webp'],
    '.pdf': ['application/pdf'],
    '.txt': ['text/plain'],
    '.csv': ['text/csv', 'application/csv', 'application/vnd.ms-excel'],
    '.doc': ['application/msword', 'application/vnd.ms-word'],
    '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    '.ai': ['application/postscript', 'application/illustrator'],
    '.svg': ['image/svg+xml'],
    '.psd': ['image/vnd.adobe.photoshop', 'application/octet-stream'],
    '.mp4': ['video/mp4'],
    '.mov': ['video/quicktime'],
    '.webm': ['video/webm'],
    '.zip': ['application/zip', 'application/x-zip-compressed'],
};
let activePublicUploads = 0;

type ConnectorProvider = 'google_drive' | 'sharepoint';
type GoogleAuthMode = 'service_account' | 'oauth_refresh';

const SETTING_KEYS = {
    provider: 'dateiaustausch_drive.provider',
    customerFolderPrefix: 'dateiaustausch_drive.customer_folder_prefix',
    maxUploadMb: 'dateiaustausch_drive.max_upload_mb',
    customerQuotaMb: 'dateiaustausch_drive.customer_quota_mb',
    allowedExtensions: 'dateiaustausch_drive.allowed_extensions',

    googleClientEmail: 'dateiaustausch_drive.google.client_email',
    googlePrivateKey: 'dateiaustausch_drive.google.private_key',
    googleRootFolderId: 'dateiaustausch_drive.google.root_folder_id',
    googleSharedDriveId: 'dateiaustausch_drive.google.shared_drive_id',
    googleAuthMode: 'dateiaustausch_drive.google.auth_mode',
    googleOAuthClientId: 'dateiaustausch_drive.google.oauth_client_id',
    googleOAuthClientSecret: 'dateiaustausch_drive.google.oauth_client_secret',
    googleOAuthRefreshToken: 'dateiaustausch_drive.google.oauth_refresh_token',

    spTenantId: 'dateiaustausch_drive.sharepoint.tenant_id',
    spClientId: 'dateiaustausch_drive.sharepoint.client_id',
    spClientSecret: 'dateiaustausch_drive.sharepoint.client_secret',
    spSiteId: 'dateiaustausch_drive.sharepoint.site_id',
    spDriveId: 'dateiaustausch_drive.sharepoint.drive_id',
    spRootFolderId: 'dateiaustausch_drive.sharepoint.root_folder_id',
};

type SessionRow = {
    id: number;
    tenant_id: number;
    customer_id: number;
    email_normalized: string;
    expires_at: string;
    revoked_at: string | null;
};

type ConnectorSettings = {
    provider: ConnectorProvider;
    customerFolderPrefix: string;
    maxUploadMb: number;
    customerQuotaMb: number;
    allowedExtensions: string[];
    google: {
        authMode: GoogleAuthMode;
        clientEmail: string;
        privateKey: string;
        rootFolderId: string;
        sharedDriveId: string | null;
        oauthClientId: string;
        oauthClientSecret: string;
        oauthRefreshToken: string;
    };
    sharepoint: {
        tenantId: string;
        clientId: string;
        clientSecret: string;
        siteId: string;
        driveId: string;
        rootFolderId: string;
    };
};

type DriveEntry = {
    id: string;
    name: string;
    mimeType: string;
    size: number | null;
    modifiedTime: string | null;
    isFolder: boolean;
};

type ProviderContext = {
    provider: ConnectorProvider;
    accessToken: string;
    effectiveGoogleSharedDriveId?: string | null;
    companyFolderId: string;
    companyFolderName: string;
    uploadFolderId: string;
    uploadFolderName: string;
};

type CustomerProfile = {
    displayName: string;
    companyName: string | null;
};

function base64Url(input: Buffer | string): string {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function hashValue(value: string): string {
    return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function escapeDriveQuery(value: string): string {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normalizePrivateKey(value: string): string {
    const raw = String(value || '').trim().replace(/^"+|"+$/g, '');
    return raw.replace(/\\n/g, '\n').replace(/\r/g, '').trim();
}

function parseGoogleServiceAccountJson(raw: string): { clientEmail: string; privateKey: string } | null {
    const input = String(raw || '').trim();
    if (!input.startsWith('{')) return null;
    try {
        const parsed = JSON.parse(input) as { client_email?: unknown; private_key?: unknown };
        const clientEmail = typeof parsed?.client_email === 'string' ? parsed.client_email.trim() : '';
        const privateKey = typeof parsed?.private_key === 'string' ? parsed.private_key : '';
        if (!clientEmail && !privateKey) return null;
        return { clientEmail, privateKey };
    } catch {
        return null;
    }
}

function parsePositiveInt(value: string, fallback: number, min: number, max: number): number {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function parseAllowedExtensions(raw: string): string[] {
    const parsed = String(raw || '')
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.startsWith('.'))
        .filter((part) => SUPPORTED_EXTENSIONS_SET.has(part));
    if (parsed.length === 0) return [...SUPPORTED_EXTENSIONS];
    return Array.from(new Set(parsed));
}

function sanitizeUploadFileName(fileName: string): string {
    const normalized = String(fileName || '')
        .replace(/[^a-zA-Z0-9._ -]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized || `upload-${Date.now()}`;
}

function sanitizeCloudFolderName(folderName: string): string {
    const cleaned = String(folderName || '')
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/^\.+/, '')
        .replace(/\.+$/, '')
        .trim();
    return (cleaned || 'Unbenannt').slice(0, 120);
}

function parseRelativeFolderPath(input: unknown): string[] {
    return String(input || '')
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => sanitizeCloudFolderName(part));
}

function joinRelativeFolderPath(parts: string[]): string {
    return parts.join('/');
}

function isDateFolderName(name: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(name || '').trim());
}

function sortDriveEntries(entries: DriveEntry[]): DriveEntry[] {
    return [...entries].sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;

        const aDateFolder = a.isFolder && isDateFolderName(a.name);
        const bDateFolder = b.isFolder && isDateFolderName(b.name);
        if (aDateFolder && bDateFolder) {
            if (a.name > b.name) return -1;
            if (a.name < b.name) return 1;
            return 0;
        }
        if (aDateFolder !== bDateFolder) return aDateFolder ? -1 : 1;

        return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
    });
}

function isAllowedFileName(fileName: string, allowedExtensions: Set<string>): boolean {
    const ext = path.extname(String(fileName || '')).toLowerCase();
    return allowedExtensions.has(ext);
}

function isAllowedMimeForFile(fileName: string, mimeTypeRaw: string): boolean {
    const mimeType = String(mimeTypeRaw || '').trim().toLowerCase();
    if (!mimeType || mimeType === 'application/octet-stream') return true;
    const normalizedMime = mimeType.split(';')[0]?.trim() || mimeType;
    const ext = path.extname(String(fileName || '')).toLowerCase();
    const allowed = ALLOWED_MIME_BY_EXTENSION[ext];
    if (!allowed || allowed.length === 0) return false;
    return allowed.includes(normalizedMime);
}

function getFileExtension(fileName: string): string {
    return path.extname(String(fileName || '')).toLowerCase();
}

function isPreviewableByExtension(fileName: string): boolean {
    const ext = getFileExtension(fileName);
    return PREVIEWABLE_IMAGE_EXTENSIONS.has(ext) || PREVIEWABLE_DOCUMENT_EXTENSIONS.has(ext);
}

function isPdfByExtension(fileName: string): boolean {
    return PREVIEWABLE_DOCUMENT_EXTENSIONS.has(getFileExtension(fileName));
}

function isImageByExtension(fileName: string): boolean {
    return PREVIEWABLE_IMAGE_EXTENSIONS.has(getFileExtension(fileName));
}

function normalizeProviderErrorMessage(error: unknown): string {
    const raw = String((error as any)?.message || error || '').trim();
    const lower = raw.toLowerCase();
    if (
        lower.includes('service accounts do not have storage quota') ||
        lower.includes('storagequotaexceeded')
    ) {
        return 'Google Drive Service-Account hat kein eigenes Speicherkontingent. Nutze entweder Shared Drive oder Google OAuth (persönliches Drive) in den Plugin-Einstellungen.';
    }
    if (lower.includes('drive api has not been used') || lower.includes('access not configured')) {
        return 'Google Drive API ist für dieses Projekt noch nicht aktiviert. Bitte in Google Cloud unter APIs die Google Drive API aktivieren.';
    }
    return raw || 'Cloud-Anfrage fehlgeschlagen.';
}

function resolveErrorStatusCode(error: unknown): number {
    const explicit = Number((error as any)?.statusCode || (error as any)?.status || 0);
    if (Number.isFinite(explicit) && explicit >= 400 && explicit < 600) return explicit;
    const message = String((error as any)?.message || '').toLowerCase();
    if (message.includes('zu viele anfragen') || message.includes('rate limit') || message.includes('too many requests')) {
        return 429;
    }
    if (message.includes('ungültig') || message.includes('ist erforderlich') || message.includes('nicht erlaubt')) {
        return 400;
    }
    if (message.includes('abgelaufen') || message.includes('unauthorized')) {
        return 401;
    }
    if (
        message.includes('forbidden')
        || message.includes('(403)')
        || message.includes('status 403')
        || message.includes('access denied')
        || message.includes('storagequotaexceeded')
        || message.includes('service accounts do not have storage quota')
    ) {
        return 403;
    }
    return 502;
}

function resolvePublicSessionToken(request: any): string {
    const fromHeader = request.headers['x-public-session-token'];
    if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();
    const fromQuery = request.query?.sessionToken;
    if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim();
    return '';
}

async function verifyPublicSessionByToken(db: any, token: string): Promise<SessionRow | null> {
    if (!token) return null;
    const nowIso = new Date().toISOString();
    const tokenHash = hashValue(token);
    const row = await db('vp_public_sessions')
        .where({ token_hash: tokenHash })
        .whereNull('revoked_at')
        .andWhere('expires_at', '>', nowIso)
        .first();
    if (!row) return null;
    return row as SessionRow;
}

function buildCrmCustomerDisplayName(customer: any): string {
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

async function resolveCustomerProfile(db: any, session: SessionRow): Promise<CustomerProfile> {
    const fallback = `${String(session.customer_id || '').trim() ? `Kunde-${session.customer_id}` : 'Kunde'}`;
    const vpCustomer = await db('vp_customers')
        .where({ id: Number(session.customer_id), tenant_id: Number(session.tenant_id) })
        .first('name', 'crm_customer_id');

    if (!vpCustomer) {
        return { displayName: fallback, companyName: null };
    }

    const vpName = String(vpCustomer.name || '').trim();
    const crmCustomerId = Number(vpCustomer.crm_customer_id || 0);
    if (!crmCustomerId) {
        return { displayName: vpName || fallback, companyName: null };
    }

    const hasCrmCustomers = await db.schema.hasTable('crm_customers').catch(() => false);
    if (!hasCrmCustomers) {
        return { displayName: vpName || fallback, companyName: null };
    }

    const crmCustomer = await db('crm_customers')
        .where({ id: crmCustomerId, tenant_id: Number(session.tenant_id) })
        .first('id', 'type', 'company_name', 'first_name', 'last_name');

    if (!crmCustomer) {
        return { displayName: vpName || fallback, companyName: null };
    }

    const companyName = String(crmCustomer.company_name || '').trim() || null;
    const displayName = buildCrmCustomerDisplayName(crmCustomer) || vpName || fallback;
    return { displayName, companyName };
}

function getCurrentUploadDateFolderName(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

async function loadConnectorSettings(db: any): Promise<ConnectorSettings> {
    const rows = await db('settings')
        .where({ plugin_id: PLUGIN_ID })
        .whereNull('tenant_id')
        .whereIn('key', Object.values(SETTING_KEYS))
        .select('key', 'value_encrypted');

    const values = new Map<string, string>();
    for (const row of rows) {
        try {
            values.set(String(row.key), row.value_encrypted ? decrypt(String(row.value_encrypted)) : '');
        } catch {
            values.set(String(row.key), '');
        }
    }

    const rawProvider = String(values.get(SETTING_KEYS.provider) || 'google_drive').trim();
    const provider: ConnectorProvider = rawProvider === 'sharepoint' ? 'sharepoint' : 'google_drive';
    const rawGoogleAuthMode = String(values.get(SETTING_KEYS.googleAuthMode) || 'service_account').trim().toLowerCase();
    const googleAuthMode: GoogleAuthMode = rawGoogleAuthMode === 'oauth_refresh' ? 'oauth_refresh' : 'service_account';

    const googleClientEmailRaw = String(values.get(SETTING_KEYS.googleClientEmail) || '').trim();
    const googlePrivateKeyRaw = String(values.get(SETTING_KEYS.googlePrivateKey) || '');
    const serviceAccountJson = parseGoogleServiceAccountJson(googlePrivateKeyRaw);

    return {
        provider,
        customerFolderPrefix: String(values.get(SETTING_KEYS.customerFolderPrefix) || 'KD').trim() || 'KD',
        maxUploadMb: parsePositiveInt(
            String(values.get(SETTING_KEYS.maxUploadMb) || ''),
            DEFAULT_MAX_UPLOAD_MB,
            1,
            1024,
        ),
        customerQuotaMb: parsePositiveInt(
            String(values.get(SETTING_KEYS.customerQuotaMb) || ''),
            0,
            0,
            102400,
        ),
        allowedExtensions: parseAllowedExtensions(String(values.get(SETTING_KEYS.allowedExtensions) || '')),
        google: {
            authMode: googleAuthMode,
            clientEmail: googleClientEmailRaw || serviceAccountJson?.clientEmail || '',
            privateKey: normalizePrivateKey(serviceAccountJson?.privateKey || googlePrivateKeyRaw),
            rootFolderId: String(values.get(SETTING_KEYS.googleRootFolderId) || '').trim(),
            sharedDriveId: String(values.get(SETTING_KEYS.googleSharedDriveId) || '').trim() || null,
            oauthClientId: String(values.get(SETTING_KEYS.googleOAuthClientId) || '').trim(),
            oauthClientSecret: String(values.get(SETTING_KEYS.googleOAuthClientSecret) || '').trim(),
            oauthRefreshToken: String(values.get(SETTING_KEYS.googleOAuthRefreshToken) || '').trim(),
        },
        sharepoint: {
            tenantId: String(values.get(SETTING_KEYS.spTenantId) || '').trim(),
            clientId: String(values.get(SETTING_KEYS.spClientId) || '').trim(),
            clientSecret: String(values.get(SETTING_KEYS.spClientSecret) || '').trim(),
            siteId: String(values.get(SETTING_KEYS.spSiteId) || '').trim(),
            driveId: String(values.get(SETTING_KEYS.spDriveId) || '').trim(),
            rootFolderId: String(values.get(SETTING_KEYS.spRootFolderId) || '').trim(),
        },
    };
}

function connectorStatus(settings: ConnectorSettings) {
    const googleConfigured = settings.google.authMode === 'oauth_refresh'
        ? Boolean(
            settings.google.oauthClientId
            && settings.google.oauthClientSecret
            && settings.google.oauthRefreshToken
            && settings.google.rootFolderId,
        )
        : Boolean(settings.google.clientEmail && settings.google.privateKey && settings.google.rootFolderId);
    const sharepointConfigured = Boolean(
        settings.sharepoint.tenantId
        && settings.sharepoint.clientId
        && settings.sharepoint.clientSecret
        && settings.sharepoint.siteId
        && settings.sharepoint.driveId
        && settings.sharepoint.rootFolderId,
    );

    return {
        provider: settings.provider,
        configured: settings.provider === 'google_drive' ? googleConfigured : sharepointConfigured,
        customerFolderPrefix: settings.customerFolderPrefix,
        maxUploadMb: settings.maxUploadMb,
        customerQuotaMb: settings.customerQuotaMb,
        allowedExtensions: settings.allowedExtensions,
        google: {
            configured: googleConfigured,
            authMode: settings.google.authMode,
            hasClientEmail: Boolean(settings.google.clientEmail),
            hasPrivateKey: Boolean(settings.google.privateKey),
            hasRootFolderId: Boolean(settings.google.rootFolderId),
            rootFolderId: settings.google.rootFolderId || null,
            sharedDriveId: settings.google.sharedDriveId,
            hasOAuthClientId: Boolean(settings.google.oauthClientId),
            hasOAuthClientSecret: Boolean(settings.google.oauthClientSecret),
            hasOAuthRefreshToken: Boolean(settings.google.oauthRefreshToken),
        },
        sharepoint: {
            configured: sharepointConfigured,
            hasTenantId: Boolean(settings.sharepoint.tenantId),
            hasClientId: Boolean(settings.sharepoint.clientId),
            hasClientSecret: Boolean(settings.sharepoint.clientSecret),
            hasSiteId: Boolean(settings.sharepoint.siteId),
            hasDriveId: Boolean(settings.sharepoint.driveId),
            hasRootFolderId: Boolean(settings.sharepoint.rootFolderId),
            siteId: settings.sharepoint.siteId || null,
            driveId: settings.sharepoint.driveId || null,
            rootFolderId: settings.sharepoint.rootFolderId || null,
        },
    };
}

async function getGoogleAccessToken(settings: ConnectorSettings['google']): Promise<string> {
    if (settings.authMode === 'oauth_refresh') {
        if (!settings.oauthClientId || !settings.oauthClientSecret || !settings.oauthRefreshToken) {
            throw new Error('Google-Connector ist unvollständig konfiguriert (OAuth).');
        }
        const body = new URLSearchParams({
            client_id: settings.oauthClientId,
            client_secret: settings.oauthClientSecret,
            refresh_token: settings.oauthRefreshToken,
            grant_type: 'refresh_token',
        });
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const tokenPayload = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || typeof tokenPayload?.access_token !== 'string') {
            const detail = tokenPayload?.error_description || tokenPayload?.error || 'Token-Abruf fehlgeschlagen.';
            throw new Error(`Google OAuth Fehler: ${detail}`);
        }
        return tokenPayload.access_token as string;
    }

    if (!settings.clientEmail || !settings.privateKey) {
        throw new Error('Google-Connector ist unvollständig konfiguriert (Service-Account).');
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: settings.clientEmail,
        scope: GOOGLE_SCOPE,
        aud: GOOGLE_TOKEN_URL,
        iat: now,
        exp: now + 3600,
    };

    const encodedHeader = base64Url(JSON.stringify(header));
    const encodedPayload = base64Url(JSON.stringify(payload));
    const unsigned = `${encodedHeader}.${encodedPayload}`;

    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    const signature = signer.sign(settings.privateKey);
    const assertion = `${unsigned}.${base64Url(signature)}`;

    const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
    });

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    const tokenPayload = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || typeof tokenPayload?.access_token !== 'string') {
        const detail = tokenPayload?.error_description || tokenPayload?.error || 'Token-Abruf fehlgeschlagen.';
        throw new Error(`Google OAuth Fehler: ${detail}`);
    }
    return tokenPayload.access_token as string;
}

async function getSharePointAccessToken(settings: ConnectorSettings['sharepoint']): Promise<string> {
    if (!settings.tenantId || !settings.clientId || !settings.clientSecret) {
        throw new Error('SharePoint-Connector ist unvollständig konfiguriert.');
    }

    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(settings.tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
    });

    const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    const tokenPayload = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || typeof tokenPayload?.access_token !== 'string') {
        const detail = tokenPayload?.error_description || tokenPayload?.error || 'Token-Abruf fehlgeschlagen.';
        throw new Error(`SharePoint OAuth Fehler: ${detail}`);
    }
    return tokenPayload.access_token as string;
}

function googleDriveUrl(urlPath: string, settings: ConnectorSettings['google'], search?: Record<string, string>): string {
    const url = new URL(`https://www.googleapis.com${urlPath}`);
    if (search) {
        for (const [key, value] of Object.entries(search)) {
            if (value) url.searchParams.set(key, value);
        }
    }
    if (settings.sharedDriveId) {
        url.searchParams.set('supportsAllDrives', 'true');
        url.searchParams.set('includeItemsFromAllDrives', 'true');
    }
    return url.toString();
}

async function googleJson<T>(accessToken: string, url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(init?.headers || {}),
        },
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message = payload?.error?.message || payload?.error_description || `Google API Fehler (${res.status})`;
        throw new Error(String(message));
    }
    return payload as T;
}

function graphUrl(urlPath: string, search?: Record<string, string>): string {
    const url = new URL(`https://graph.microsoft.com${urlPath}`);
    if (search) {
        for (const [key, value] of Object.entries(search)) {
            if (value) url.searchParams.set(key, value);
        }
    }
    return url.toString();
}

async function graphJson<T>(accessToken: string, url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(init?.headers || {}),
        },
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message = payload?.error?.message || `Graph API Fehler (${res.status})`;
        throw new Error(String(message));
    }
    return payload as T;
}

async function ensureGoogleChildFolder(
    accessToken: string,
    settings: ConnectorSettings['google'],
    parentFolderId: string,
    folderName: string,
): Promise<{ id: string; name: string }> {
    const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${escapeDriveQuery(folderName)}' and '${escapeDriveQuery(parentFolderId)}' in parents`;

    const listUrl = googleDriveUrl('/drive/v3/files', settings, {
        q,
        fields: 'files(id,name)',
        pageSize: '1',
        corpora: settings.sharedDriveId ? 'drive' : 'user',
        driveId: settings.sharedDriveId || '',
    });

    const list = await googleJson<{ files?: Array<{ id: string; name: string }> }>(accessToken, listUrl);
    const existing = list.files?.[0];
    if (existing?.id) return { id: existing.id, name: existing.name || folderName };

    const createUrl = googleDriveUrl('/drive/v3/files', settings, {
        fields: 'id,name',
        supportsAllDrives: 'true',
    });
    const created = await googleJson<{ id: string; name: string }>(accessToken, createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId],
        }),
    });

    return { id: created.id, name: created.name || folderName };
}

async function resolveGoogleEffectiveSharedDriveId(
    accessToken: string,
    settings: ConnectorSettings['google'],
): Promise<string | null> {
    if (settings.sharedDriveId) return settings.sharedDriveId;
    if (!settings.rootFolderId) return null;
    const rootMeta = await googleJson<{ id: string; driveId?: string; mimeType?: string }>(
        accessToken,
        googleDriveUrl(
            `/drive/v3/files/${encodeURIComponent(settings.rootFolderId)}`,
            settings,
            { fields: 'id,driveId,mimeType', supportsAllDrives: 'true' },
        ),
    );
    return String(rootMeta.driveId || '').trim() || null;
}

type GraphItem = {
    id: string;
    name: string;
    size?: number;
    folder?: unknown;
    file?: unknown;
    lastModifiedDateTime?: string;
    parentReference?: { id?: string };
};

async function resolveSharePointCustomerFolder(
    accessToken: string,
    settings: ConnectorSettings['sharepoint'],
    parentFolderId: string,
    folderName: string,
): Promise<{ id: string; name: string }> {
    const listUrl = graphUrl(`/v1.0/sites/${encodeURIComponent(settings.siteId)}/drives/${encodeURIComponent(settings.driveId)}/items/${encodeURIComponent(parentFolderId)}/children`, {
        $top: '200',
        $select: 'id,name,folder',
    });
    const list = await graphJson<{ value?: GraphItem[] }>(accessToken, listUrl);
    const existing = (list.value || []).find((item) => item.folder && item.name === folderName);
    if (existing?.id) return { id: existing.id, name: existing.name || folderName };

    const createUrl = graphUrl(`/v1.0/sites/${encodeURIComponent(settings.siteId)}/drives/${encodeURIComponent(settings.driveId)}/items/${encodeURIComponent(parentFolderId)}/children`);
    const created = await graphJson<GraphItem>(accessToken, createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: folderName,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'replace',
        }),
    });
    return { id: created.id, name: created.name || folderName };
}

async function resolveProviderContext(db: any, settings: ConnectorSettings, session: SessionRow): Promise<ProviderContext> {
    const profile = await resolveCustomerProfile(db, session);
    const customerFolderName = sanitizeCloudFolderName(
        profile.companyName || profile.displayName || `${settings.customerFolderPrefix}-${session.customer_id}`,
    );
    const dateFolderName = getCurrentUploadDateFolderName();

    if (settings.provider === 'sharepoint') {
        const accessToken = await getSharePointAccessToken(settings.sharepoint);
        const kundenuploads = await resolveSharePointCustomerFolder(
            accessToken,
            settings.sharepoint,
            settings.sharepoint.rootFolderId,
            CUSTOMER_UPLOADS_ROOT_NAME,
        );
        const customerFolder = await resolveSharePointCustomerFolder(
            accessToken,
            settings.sharepoint,
            kundenuploads.id,
            customerFolderName,
        );
        const dateFolder = await resolveSharePointCustomerFolder(
            accessToken,
            settings.sharepoint,
            customerFolder.id,
            dateFolderName,
        );
        return {
            provider: 'sharepoint',
            accessToken,
            companyFolderId: customerFolder.id,
            companyFolderName: customerFolder.name,
            uploadFolderId: dateFolder.id,
            uploadFolderName: dateFolder.name,
        };
    }
    const accessToken = await getGoogleAccessToken(settings.google);
    const effectiveSharedDriveId = await resolveGoogleEffectiveSharedDriveId(accessToken, settings.google);
    const googleSettings = effectiveSharedDriveId
        ? { ...settings.google, sharedDriveId: effectiveSharedDriveId }
        : settings.google;

    const kundenuploads = await ensureGoogleChildFolder(
        accessToken,
        googleSettings,
        settings.google.rootFolderId,
        CUSTOMER_UPLOADS_ROOT_NAME,
    );
    const customerFolder = await ensureGoogleChildFolder(
        accessToken,
        googleSettings,
        kundenuploads.id,
        customerFolderName,
    );
    const dateFolder = await ensureGoogleChildFolder(
        accessToken,
        googleSettings,
        customerFolder.id,
        dateFolderName,
    );
    return {
        provider: 'google_drive',
        accessToken,
        effectiveGoogleSharedDriveId: effectiveSharedDriveId,
        companyFolderId: customerFolder.id,
        companyFolderName: customerFolder.name,
        uploadFolderId: dateFolder.id,
        uploadFolderName: dateFolder.name,
    };
}

async function resolveGoogleFolderIdByRelativePath(
    accessToken: string,
    settings: ConnectorSettings['google'],
    baseFolderId: string,
    relativeParts: string[],
): Promise<{ id: string; name: string }> {
    let currentId = baseFolderId;
    let currentName = '';

    for (const part of relativeParts) {
        const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${escapeDriveQuery(part)}' and '${escapeDriveQuery(currentId)}' in parents`;
        const listUrl = googleDriveUrl('/drive/v3/files', settings, {
            q,
            fields: 'files(id,name)',
            pageSize: '1',
            corpora: settings.sharedDriveId ? 'drive' : 'user',
            driveId: settings.sharedDriveId || '',
        });
        const list = await googleJson<{ files?: Array<{ id: string; name: string }> }>(accessToken, listUrl);
        const folder = list.files?.[0];
        if (!folder?.id) throw new Error(`Ordner nicht gefunden: ${part}`);
        currentId = folder.id;
        currentName = folder.name || part;
    }

    if (relativeParts.length === 0) return { id: baseFolderId, name: '' };
    return { id: currentId, name: currentName || relativeParts[relativeParts.length - 1] };
}

async function resolveSharePointFolderIdByRelativePath(
    accessToken: string,
    settings: ConnectorSettings['sharepoint'],
    baseFolderId: string,
    relativeParts: string[],
): Promise<{ id: string; name: string }> {
    let currentId = baseFolderId;
    let currentName = '';

    for (const part of relativeParts) {
        const listUrl = graphUrl(`/v1.0/sites/${encodeURIComponent(settings.siteId)}/drives/${encodeURIComponent(settings.driveId)}/items/${encodeURIComponent(currentId)}/children`, {
            $top: '200',
            $select: 'id,name,folder',
        });
        const list = await graphJson<{ value?: GraphItem[] }>(accessToken, listUrl);
        const folder = (list.value || []).find((item) => item.folder && item.name === part);
        if (!folder?.id) throw new Error(`Ordner nicht gefunden: ${part}`);
        currentId = folder.id;
        currentName = folder.name || part;
    }

    if (relativeParts.length === 0) return { id: baseFolderId, name: '' };
    return { id: currentId, name: currentName || relativeParts[relativeParts.length - 1] };
}

async function resolveFolderFromPath(
    settings: ConnectorSettings,
    ctx: ProviderContext,
    relativeParts: string[],
): Promise<{ id: string; name: string; path: string[] }> {
    if (ctx.provider === 'sharepoint') {
        const folder = await resolveSharePointFolderIdByRelativePath(
            ctx.accessToken,
            settings.sharepoint,
            ctx.companyFolderId,
            relativeParts,
        );
        return { id: folder.id, name: folder.name, path: relativeParts };
    }
    const googleSettings = ctx.effectiveGoogleSharedDriveId
        ? { ...settings.google, sharedDriveId: ctx.effectiveGoogleSharedDriveId }
        : settings.google;
    const folder = await resolveGoogleFolderIdByRelativePath(
        ctx.accessToken,
        googleSettings,
        ctx.companyFolderId,
        relativeParts,
    );
    return { id: folder.id, name: folder.name, path: relativeParts };
}

async function listProviderEntries(settings: ConnectorSettings, ctx: ProviderContext, folderId: string): Promise<DriveEntry[]> {
    if (ctx.provider === 'sharepoint') {
        const listUrl = graphUrl(`/v1.0/sites/${encodeURIComponent(settings.sharepoint.siteId)}/drives/${encodeURIComponent(settings.sharepoint.driveId)}/items/${encodeURIComponent(folderId)}/children`, {
            $top: '200',
            $select: 'id,name,size,folder,file,lastModifiedDateTime,parentReference',
        });
        const list = await graphJson<{ value?: GraphItem[] }>(ctx.accessToken, listUrl);
        const entries = (list.value || []).map((item) => ({
            id: item.id,
            name: item.name,
            mimeType: item.folder ? 'application/vnd.google-apps.folder' : 'application/octet-stream',
            size: Number.isFinite(item.size) ? Number(item.size) : null,
            modifiedTime: item.lastModifiedDateTime || null,
            isFolder: Boolean(item.folder),
        }));
        return sortDriveEntries(entries);
    }

    const googleSettings = ctx.effectiveGoogleSharedDriveId
        ? { ...settings.google, sharedDriveId: ctx.effectiveGoogleSharedDriveId }
        : settings.google;
    const listUrl = googleDriveUrl('/drive/v3/files', googleSettings, {
        q: `'${escapeDriveQuery(folderId)}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,size,modifiedTime,parents)',
        orderBy: 'folder,name',
        pageSize: '200',
        corpora: googleSettings.sharedDriveId ? 'drive' : 'user',
        driveId: googleSettings.sharedDriveId || '',
    });
    const result = await googleJson<{ files?: Array<{ id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }> }>(ctx.accessToken, listUrl);
    const entries = (result.files || []).map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size ? Number(file.size) : null,
        modifiedTime: file.modifiedTime || null,
        isFolder: file.mimeType === 'application/vnd.google-apps.folder',
    }));
    return sortDriveEntries(entries);
}

async function calculateFolderSizeBytes(settings: ConnectorSettings, ctx: ProviderContext, folderId: string): Promise<number> {
    const entries = await listProviderEntries(settings, ctx, folderId);
    let total = 0;
    for (const entry of entries) {
        if (!entry.isFolder && entry.size && Number.isFinite(entry.size)) {
            total += entry.size;
        }
        if (entry.isFolder) {
            total += await calculateFolderSizeBytes(settings, ctx, entry.id);
        }
    }
    return total;
}

async function createGoogleUploadSession(
    settings: ConnectorSettings,
    ctx: ProviderContext,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
) {
    const metadata = {
        name: sanitizeUploadFileName(fileName),
        parents: [ctx.uploadFolderId],
    };
    const startUrl = googleDriveUrl('/upload/drive/v3/files', settings.google, { uploadType: 'resumable' });
    const startRes = await fetch(startUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${ctx.accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': mimeType || 'application/octet-stream',
            'X-Upload-Content-Length': String(sizeBytes),
        },
        body: JSON.stringify(metadata),
    });
    if (!startRes.ok) {
        const payload = await startRes.text().catch(() => '');
        throw new Error(`Drive-Upload konnte nicht gestartet werden (${startRes.status}). ${payload}`);
    }
    const uploadUrl = startRes.headers.get('location');
    if (!uploadUrl) throw new Error('Drive-Upload konnte nicht gestartet werden (Location fehlt).');

    return {
        provider: 'google_drive' as const,
        uploadUrl,
        method: 'PUT' as const,
        chunkSizeBytes: null,
    };
}

async function createSharePointUploadSession(
    settings: ConnectorSettings,
    ctx: ProviderContext,
    fileName: string,
) {
    const cleanName = sanitizeUploadFileName(fileName);
    const createSessionUrl = graphUrl(`/v1.0/sites/${encodeURIComponent(settings.sharepoint.siteId)}/drives/${encodeURIComponent(settings.sharepoint.driveId)}/items/${encodeURIComponent(ctx.uploadFolderId)}:/${encodeURIComponent(cleanName)}:/createUploadSession`);
    const sessionPayload = await graphJson<{ uploadUrl?: string }>(ctx.accessToken, createSessionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            item: {
                '@microsoft.graph.conflictBehavior': 'replace',
                name: cleanName,
            },
        }),
    });
    if (!sessionPayload.uploadUrl) {
        throw new Error('SharePoint Upload-Session konnte nicht erstellt werden.');
    }
    return {
        provider: 'sharepoint' as const,
        uploadUrl: sessionPayload.uploadUrl,
        method: 'PUT' as const,
        chunkSizeBytes: SHAREPOINT_UPLOAD_CHUNK_BYTES,
    };
}

async function createProviderUploadSession(
    settings: ConnectorSettings,
    ctx: ProviderContext,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
) {
    if (ctx.provider === 'sharepoint') {
        return createSharePointUploadSession(settings, ctx, fileName);
    }
    const googleSettings = ctx.effectiveGoogleSharedDriveId
        ? { ...settings.google, sharedDriveId: ctx.effectiveGoogleSharedDriveId }
        : settings.google;
    return createGoogleUploadSession(
        { ...settings, google: googleSettings },
        ctx,
        fileName,
        mimeType,
        sizeBytes,
    );
}

async function streamUploadToTempFile(filePart: any, maxBytes: number): Promise<{ tempPath: string; sizeBytes: number }> {
    const tempDir = path.join(process.cwd(), 'uploads', 'plugins', PLUGIN_ID, 'tmp');
    await fs.mkdir(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, `${Date.now()}-${randomUUID()}.upload`);
    const output = createWriteStream(tempPath);
    let bytes = 0;
    try {
        for await (const chunk of filePart.file) {
            const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += part.length;
            if (bytes > maxBytes) {
                throw new Error(`Datei ist zu groß (max. ${Math.round(maxBytes / (1024 * 1024))} MB).`);
            }
            if (!output.write(part)) {
                await new Promise<void>((resolve) => output.once('drain', resolve));
            }
        }
        output.end();
        await new Promise<void>((resolve) => output.once('finish', resolve));
        return { tempPath, sizeBytes: bytes };
    } catch (error) {
        output.destroy();
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}

async function uploadTempFileToGoogle(uploadUrl: string, tempPath: string, mimeType: string, sizeBytes: number): Promise<void> {
    const stream = await fs.open(tempPath, 'r');
    try {
        const body = stream.createReadStream();
        const res = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': mimeType || 'application/octet-stream',
                'Content-Length': String(sizeBytes),
            },
            // Node.js stream request body
            duplex: 'half' as any,
            body: body as any,
        } as any);
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(`Google-Upload fehlgeschlagen (${res.status}). ${detail}`);
        }
    } finally {
        await stream.close().catch(() => undefined);
    }
}

async function uploadTempFileToSharePoint(uploadUrl: string, tempPath: string, sizeBytes: number, chunkSizeBytes: number): Promise<void> {
    const handle = await fs.open(tempPath, 'r');
    try {
        let offset = 0;
        while (offset < sizeBytes) {
            const next = Math.min(offset + chunkSizeBytes, sizeBytes);
            const length = next - offset;
            const buffer = Buffer.allocUnsafe(length);
            const readResult = await handle.read(buffer, 0, length, offset);
            const chunk = readResult.bytesRead === length ? buffer : buffer.subarray(0, readResult.bytesRead);
            if (chunk.length <= 0) break;

            const res = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Length': String(chunk.length),
                    'Content-Range': `bytes ${offset}-${offset + chunk.length - 1}/${sizeBytes}`,
                },
                body: chunk,
            });
            if (!(res.ok || res.status === 202)) {
                const detail = await res.text().catch(() => '');
                throw new Error(`SharePoint-Upload fehlgeschlagen (${res.status}). ${detail}`);
            }
            offset += chunk.length;
        }
    } finally {
        await handle.close().catch(() => undefined);
    }
}

async function uploadTempFileToProvider(
    settings: ConnectorSettings,
    ctx: ProviderContext,
    fileName: string,
    mimeType: string,
    tempPath: string,
    sizeBytes: number,
): Promise<void> {
    const session = await createProviderUploadSession(settings, ctx, fileName, mimeType, sizeBytes);
    if (session.provider === 'google_drive') {
        await uploadTempFileToGoogle(session.uploadUrl, tempPath, mimeType, sizeBytes);
        return;
    }
    await uploadTempFileToSharePoint(
        session.uploadUrl,
        tempPath,
        sizeBytes,
        session.chunkSizeBytes || SHAREPOINT_UPLOAD_CHUNK_BYTES,
    );
}

async function deleteProviderEntry(
    settings: ConnectorSettings,
    ctx: ProviderContext,
    entryId: string,
): Promise<void> {
    if (ctx.provider === 'sharepoint') {
        const url = graphUrl(
            `/v1.0/sites/${encodeURIComponent(settings.sharepoint.siteId)}/drives/${encodeURIComponent(settings.sharepoint.driveId)}/items/${encodeURIComponent(entryId)}`,
        );
        const res = await fetch(url, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${ctx.accessToken}` },
        });
        if (!res.ok && res.status !== 404) {
            const detail = await res.text().catch(() => '');
            throw new Error(`SharePoint-Löschen fehlgeschlagen (${res.status}). ${detail}`);
        }
        return;
    }

    const url = googleDriveUrl(
        `/drive/v3/files/${encodeURIComponent(entryId)}`,
        settings.google,
        { supportsAllDrives: 'true' },
    );
    const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ctx.accessToken}` },
    });
    if (!res.ok && res.status !== 404) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Google-Löschen fehlgeschlagen (${res.status}). ${detail}`);
    }
}

async function streamProviderDownload(
    settings: ConnectorSettings,
    ctx: ProviderContext,
    parentFolderId: string,
    fileId: string,
    reply: any,
): Promise<void> {
    if (ctx.provider === 'sharepoint') {
        const children = await listProviderEntries(settings, ctx, parentFolderId);
        const selected = children.find((entry) => !entry.isFolder && entry.id === fileId);
        if (!selected) throw new Error('Datei nicht gefunden.');

        const itemMetaUrl = graphUrl(`/v1.0/sites/${encodeURIComponent(settings.sharepoint.siteId)}/drives/${encodeURIComponent(settings.sharepoint.driveId)}/items/${encodeURIComponent(fileId)}`, {
            $select: 'id,name,size,@microsoft.graph.downloadUrl',
        });
        const itemMeta = await graphJson<Record<string, any>>(ctx.accessToken, itemMetaUrl);
        const downloadUrl = String(itemMeta['@microsoft.graph.downloadUrl'] || '');
        if (!downloadUrl) throw new Error('Download-URL konnte nicht ermittelt werden.');

        const mediaRes = await fetch(downloadUrl);
        if (!mediaRes.ok || !mediaRes.body) {
            const payload = await mediaRes.text().catch(() => '');
            throw new Error(`Download fehlgeschlagen (${mediaRes.status}). ${payload}`);
        }

        const downloadName = sanitizeUploadFileName(String(itemMeta.name || selected.name || 'download'));
        reply.header('Content-Type', mediaRes.headers.get('content-type') || 'application/octet-stream');
        reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
        reply.raw.writeHead(200);
        for await (const chunk of mediaRes.body as any) reply.raw.write(chunk);
        reply.raw.end();
        return;
    }

    const googleSettings = ctx.effectiveGoogleSharedDriveId
        ? { ...settings.google, sharedDriveId: ctx.effectiveGoogleSharedDriveId }
        : settings.google;
    const listUrl = googleDriveUrl(`/drive/v3/files/${encodeURIComponent(fileId)}`, googleSettings, {
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: 'true',
    });
    const fileMeta = await googleJson<{ id: string; name: string; mimeType: string; parents?: string[] }>(ctx.accessToken, listUrl);
    if (!Array.isArray(fileMeta.parents) || !fileMeta.parents.includes(parentFolderId)) {
        throw new Error('Datei nicht gefunden.');
    }

    const mediaUrl = googleDriveUrl(`/drive/v3/files/${encodeURIComponent(fileId)}`, googleSettings, {
        alt: 'media',
        supportsAllDrives: 'true',
    });
    const mediaRes = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${ctx.accessToken}` } });
    if (!mediaRes.ok || !mediaRes.body) {
        const payload = await mediaRes.text().catch(() => '');
        throw new Error(`Download fehlgeschlagen (${mediaRes.status}). ${payload}`);
    }

    const downloadName = sanitizeUploadFileName(fileMeta.name || 'download');
    reply.header('Content-Type', fileMeta.mimeType || 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    reply.raw.writeHead(200);
    for await (const chunk of mediaRes.body as any) reply.raw.write(chunk);
    reply.raw.end();
}

function sanitizeZipPathPart(value: string): string {
    const normalized = sanitizeUploadFileName(String(value || '').trim());
    return normalized.replace(/[\\/]/g, '-').trim() || 'unnamed';
}

async function getProviderFileStream(
    settings: ConnectorSettings,
    ctx: ProviderContext,
    fileId: string,
    fallbackName: string,
    fallbackMime: string,
): Promise<{ stream: NodeJS.ReadableStream; fileName: string; mimeType: string }> {
    if (ctx.provider === 'sharepoint') {
        const itemMetaUrl = graphUrl(`/v1.0/sites/${encodeURIComponent(settings.sharepoint.siteId)}/drives/${encodeURIComponent(settings.sharepoint.driveId)}/items/${encodeURIComponent(fileId)}`, {
            $select: 'id,name,@microsoft.graph.downloadUrl',
        });
        const itemMeta = await graphJson<Record<string, any>>(ctx.accessToken, itemMetaUrl);
        const downloadUrl = String(itemMeta['@microsoft.graph.downloadUrl'] || '');
        if (!downloadUrl) throw new Error('Download-URL konnte nicht ermittelt werden.');

        const mediaRes = await fetch(downloadUrl);
        if (!mediaRes.ok || !mediaRes.body) {
            const payload = await mediaRes.text().catch(() => '');
            throw new Error(`Download fehlgeschlagen (${mediaRes.status}). ${payload}`);
        }
        return {
            stream: Readable.fromWeb(mediaRes.body as any),
            fileName: sanitizeUploadFileName(String(itemMeta.name || fallbackName || 'download')),
            mimeType: mediaRes.headers.get('content-type') || fallbackMime || 'application/octet-stream',
        };
    }

    const googleSettings = ctx.effectiveGoogleSharedDriveId
        ? { ...settings.google, sharedDriveId: ctx.effectiveGoogleSharedDriveId }
        : settings.google;

    const metaUrl = googleDriveUrl(`/drive/v3/files/${encodeURIComponent(fileId)}`, googleSettings, {
        fields: 'id,name,mimeType',
        supportsAllDrives: 'true',
    });
    const fileMeta = await googleJson<{ id: string; name: string; mimeType: string }>(ctx.accessToken, metaUrl);

    const mediaUrl = googleDriveUrl(`/drive/v3/files/${encodeURIComponent(fileId)}`, googleSettings, {
        alt: 'media',
        supportsAllDrives: 'true',
    });
    const mediaRes = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${ctx.accessToken}` } });
    if (!mediaRes.ok || !mediaRes.body) {
        const payload = await mediaRes.text().catch(() => '');
        throw new Error(`Download fehlgeschlagen (${mediaRes.status}). ${payload}`);
    }
    return {
        stream: Readable.fromWeb(mediaRes.body as any),
        fileName: sanitizeUploadFileName(fileMeta.name || fallbackName || 'download'),
        mimeType: fileMeta.mimeType || fallbackMime || 'application/octet-stream',
    };
}

async function appendProviderEntryToArchive(
    settings: ConnectorSettings,
    ctx: ProviderContext,
    entry: DriveEntry,
    archive: Archiver,
    basePath: string,
    counters: { files: number },
): Promise<void> {
    const safeName = sanitizeZipPathPart(entry.name);
    const zipEntryPath = basePath ? `${basePath}/${safeName}` : safeName;

    if (entry.isFolder) {
        archive.append('', { name: `${zipEntryPath}/` });
        const children = await listProviderEntries(settings, ctx, entry.id);
        for (const child of children) {
            await appendProviderEntryToArchive(settings, ctx, child, archive, zipEntryPath, counters);
        }
        return;
    }

    counters.files += 1;
    if (counters.files > MAX_BULK_DOWNLOAD_ENTRIES) {
        throw new Error(`Zu viele Dateien für ZIP-Download (max. ${MAX_BULK_DOWNLOAD_ENTRIES}).`);
    }

    const fileStream = await getProviderFileStream(settings, ctx, entry.id, entry.name, entry.mimeType);
    archive.append(fileStream.stream as any, {
        name: zipEntryPath,
        date: entry.modifiedTime ? new Date(entry.modifiedTime) : new Date(),
    });
}

async function streamProviderPreview(
    settings: ConnectorSettings,
    ctx: ProviderContext,
    parentFolderId: string,
    fileId: string,
    reply: any,
): Promise<void> {
    if (ctx.provider === 'sharepoint') {
        const children = await listProviderEntries(settings, ctx, parentFolderId);
        const selected = children.find((entry) => !entry.isFolder && entry.id === fileId);
        if (!selected) throw new Error('Datei nicht gefunden.');
        if (!isPreviewableByExtension(selected.name)) {
            throw new Error('Für diesen Dateityp ist keine Vorschau verfügbar.');
        }

        const itemMetaUrl = graphUrl(`/v1.0/sites/${encodeURIComponent(settings.sharepoint.siteId)}/drives/${encodeURIComponent(settings.sharepoint.driveId)}/items/${encodeURIComponent(fileId)}`, {
            $select: 'id,name,size,@microsoft.graph.downloadUrl',
        });
        const itemMeta = await graphJson<Record<string, any>>(ctx.accessToken, itemMetaUrl);
        const downloadUrl = String(itemMeta['@microsoft.graph.downloadUrl'] || '');
        if (!downloadUrl) throw new Error('Download-URL konnte nicht ermittelt werden.');
        const size = Number(itemMeta.size || 0);
        if (Number.isFinite(size) && size > MAX_PREVIEW_BYTES) {
            throw new Error(`Vorschau ist auf ${Math.round(MAX_PREVIEW_BYTES / (1024 * 1024))} MB begrenzt.`);
        }

        const mediaRes = await fetch(downloadUrl);
        if (!mediaRes.ok || !mediaRes.body) {
            const payload = await mediaRes.text().catch(() => '');
            throw new Error(`Vorschau fehlgeschlagen (${mediaRes.status}). ${payload}`);
        }

        const fileName = sanitizeUploadFileName(String(itemMeta.name || selected.name || 'preview'));
        const contentType = mediaRes.headers.get('content-type')
            || (isPdfByExtension(fileName) ? 'application/pdf' : 'image/*');
        reply.header('Content-Type', contentType);
        reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        reply.header('Cache-Control', 'private, max-age=60');
        reply.raw.writeHead(200);
        for await (const chunk of mediaRes.body as any) reply.raw.write(chunk);
        reply.raw.end();
        return;
    }

    const googleSettings = ctx.effectiveGoogleSharedDriveId
        ? { ...settings.google, sharedDriveId: ctx.effectiveGoogleSharedDriveId }
        : settings.google;
    const listUrl = googleDriveUrl(`/drive/v3/files/${encodeURIComponent(fileId)}`, googleSettings, {
        fields: 'id,name,mimeType,parents,size',
        supportsAllDrives: 'true',
    });
    const fileMeta = await googleJson<{ id: string; name: string; mimeType: string; parents?: string[]; size?: string }>(ctx.accessToken, listUrl);
    if (!Array.isArray(fileMeta.parents) || !fileMeta.parents.includes(parentFolderId)) {
        throw new Error('Datei nicht gefunden.');
    }
    if (!isPreviewableByExtension(fileMeta.name || '')) {
        throw new Error('Für diesen Dateityp ist keine Vorschau verfügbar.');
    }
    const size = Number(fileMeta.size || 0);
    if (Number.isFinite(size) && size > MAX_PREVIEW_BYTES) {
        throw new Error(`Vorschau ist auf ${Math.round(MAX_PREVIEW_BYTES / (1024 * 1024))} MB begrenzt.`);
    }

    const mediaUrl = googleDriveUrl(`/drive/v3/files/${encodeURIComponent(fileId)}`, googleSettings, {
        alt: 'media',
        supportsAllDrives: 'true',
    });
    const mediaRes = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${ctx.accessToken}` } });
    if (!mediaRes.ok || !mediaRes.body) {
        const payload = await mediaRes.text().catch(() => '');
        throw new Error(`Vorschau fehlgeschlagen (${mediaRes.status}). ${payload}`);
    }

    const fileName = sanitizeUploadFileName(fileMeta.name || 'preview');
    const contentType = fileMeta.mimeType
        || (isPdfByExtension(fileName) ? 'application/pdf' : 'image/*');
    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    reply.header('Cache-Control', 'private, max-age=60');
    reply.raw.writeHead(200);
    for await (const chunk of mediaRes.body as any) reply.raw.write(chunk);
    reply.raw.end();
}

export default async function plugin(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    async function logDateiaustauschAudit(
        request: FastifyRequest,
        payload: {
            action: string;
            session?: SessionRow | null;
            entityType?: string;
            entityId?: string | number | null;
            newState?: Record<string, any> | null;
            previousState?: Record<string, any> | null;
        },
    ): Promise<void> {
        let enrichedNewState = payload.newState || null;
        if (payload.session) {
            try {
                const profile = await resolveCustomerProfile(db, payload.session);
                enrichedNewState = {
                    ...(payload.newState || {}),
                    customerName: profile.displayName,
                    customerCompany: profile.companyName || null,
                };
            } catch {
                // best effort only
            }
        }
        await (fastify as any).audit.log({
            action: payload.action,
            category: 'plugin',
            pluginId: PLUGIN_ID,
            entityType: payload.entityType || (payload.session ? 'vp_customers' : 'dateiaustausch_public'),
            entityId: payload.entityId !== undefined
                ? (payload.entityId === null ? undefined : String(payload.entityId))
                : (payload.session ? String(payload.session.customer_id) : undefined),
            tenantId: payload.session ? payload.session.tenant_id : null,
            previousState: payload.previousState || null,
            newState: enrichedNewState,
        }, request).catch((err: any) => fastify.log.error(`Audit logging failed: ${err.message}`));
    }

    fastify.get('/admin/connector/status', { preHandler: [requirePermission('settings.manage')] }, async () => {
        const settings = await loadConnectorSettings(db);
        return connectorStatus(settings);
    });

    fastify.post('/admin/connector/test', { preHandler: [requirePermission('settings.manage')] }, async (_request, reply) => {
        const settings = await loadConnectorSettings(db);
        const status = connectorStatus(settings);
        if (!status.configured) {
            return reply.status(400).send({
                error: 'Connector unvollständig. Bitte erforderliche Felder ausfüllen.',
                status,
            });
        }
        try {
            if (settings.provider === 'sharepoint') {
                const token = await getSharePointAccessToken(settings.sharepoint);
                const folder = await graphJson<{ id: string; name: string }>(
                    token,
                    graphUrl(`/v1.0/sites/${encodeURIComponent(settings.sharepoint.siteId)}/drives/${encodeURIComponent(settings.sharepoint.driveId)}/items/${encodeURIComponent(settings.sharepoint.rootFolderId)}`, { $select: 'id,name' }),
                );
                return { success: true, status, rootFolder: folder };
            }

            const token = await getGoogleAccessToken(settings.google);
            const effectiveSharedDriveId = await resolveGoogleEffectiveSharedDriveId(token, settings.google);
            const folder = await googleJson<{ id: string; name: string; mimeType: string }>(
                token,
                googleDriveUrl(`/drive/v3/files/${encodeURIComponent(settings.google.rootFolderId)}`, settings.google, { fields: 'id,name,mimeType', supportsAllDrives: 'true' }),
            );
            return {
                success: true,
                status,
                rootFolder: folder,
                authMode: settings.google.authMode,
                effectiveSharedDriveId: effectiveSharedDriveId || null,
                uploadReady: settings.google.authMode === 'oauth_refresh' ? true : Boolean(effectiveSharedDriveId),
                hint: effectiveSharedDriveId
                    ? null
                    : (settings.google.authMode === 'oauth_refresh'
                        ? null
                        : 'Root-Ordner liegt nicht in einem Shared Drive. Für Service-Account-Uploads bitte Shared Drive verwenden.'),
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Verbindungstest fehlgeschlagen.';
            return reply.status(400).send({ error: message, status });
        }
    });

    fastify.get('/public/files', {
        exposeHeadRoute: false,
        config: { policy: { public: true }, rateLimit: { max: 30, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        try {
            const sessionToken = resolvePublicSessionToken(request);
            if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });
            const session = await verifyPublicSessionByToken(db, sessionToken);
            if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });
            await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

            const settings = await loadConnectorSettings(db);
            const status = connectorStatus(settings);
            if (!status.configured) return reply.status(503).send({ error: 'Cloud-Connector ist noch nicht konfiguriert.' });

            const ctx = await resolveProviderContext(db, settings, session);
            const relativeParts = parseRelativeFolderPath((request.query as any)?.folderPath);
            const folder = await resolveFolderFromPath(settings, ctx, relativeParts);
            const entries = await listProviderEntries(settings, ctx, folder.id);

            let quotaMb = settings.customerQuotaMb;
            let usedBytes = 0;
            if (quotaMb > 0) {
                usedBytes = await calculateFolderSizeBytes(settings, ctx, ctx.companyFolderId);
            }

            await logDateiaustauschAudit(request, {
                action: 'cp.file.list',
                session,
                newState: {
                    provider: ctx.provider,
                    folderPath: joinRelativeFolderPath(relativeParts),
                    entryCount: entries.length,
                },
            });

            return {
                provider: ctx.provider,
                folderId: folder.id,
                folderName: relativeParts.length ? relativeParts[relativeParts.length - 1] : ctx.companyFolderName,
                baseFolderName: ctx.companyFolderName,
                currentPath: joinRelativeFolderPath(relativeParts),
                uploadFolderName: ctx.uploadFolderName,
                entries,
                quotaMb: quotaMb > 0 ? quotaMb : null,
                usedBytes: quotaMb > 0 ? usedBytes : null,
            };
        } catch (error: any) {
            const statusCode = resolveErrorStatusCode(error);
            return reply.status(statusCode).send({ error: normalizeProviderErrorMessage(error) });
        }
    });

    fastify.post('/public/files/upload/session', {
        config: { policy: { public: true }, rateLimit: { max: 20, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        try {
            const sessionToken = resolvePublicSessionToken(request);
            if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });
            const session = await verifyPublicSessionByToken(db, sessionToken);
            if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });
            await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

            const settings = await loadConnectorSettings(db);
            const status = connectorStatus(settings);
            if (!status.configured) return reply.status(503).send({ error: 'Cloud-Connector ist noch nicht konfiguriert.' });

            const body = (request.body || {}) as {
                fileName?: string;
                mimeType?: string;
                sizeBytes?: number;
            };
            const fileName = String(body.fileName || '').trim();
            const mimeType = String(body.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
            const sizeBytes = Number(body.sizeBytes || 0);

            if (!fileName) return reply.status(400).send({ error: 'Dateiname ist erforderlich.' });
            if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
                return reply.status(400).send({ error: 'Dateigröße ist ungültig.' });
            }
            const allowedExtensions = new Set(settings.allowedExtensions);
            if (!isAllowedFileName(fileName, allowedExtensions)) {
                return reply.status(400).send({ error: `Dateityp nicht erlaubt. Erlaubt: ${settings.allowedExtensions.join(', ')}` });
            }
            if (!isAllowedMimeForFile(fileName, mimeType)) {
                return reply.status(400).send({ error: 'MIME-Typ passt nicht zur Dateiendung.' });
            }

            const maxUploadBytes = Math.max(1, settings.maxUploadMb) * 1024 * 1024;
            if (sizeBytes > maxUploadBytes) {
                return reply.status(400).send({ error: `Datei ist zu groß (max. ${settings.maxUploadMb} MB).` });
            }

            const ctx = await resolveProviderContext(db, settings, session);

            if (settings.customerQuotaMb > 0) {
                const usedBytes = await calculateFolderSizeBytes(settings, ctx, ctx.companyFolderId);
                const quotaBytes = settings.customerQuotaMb * 1024 * 1024;
                if (usedBytes + sizeBytes > quotaBytes) {
                    const usedMb = (usedBytes / 1024 / 1024).toFixed(1);
                    return reply.status(400).send({ error: `Speicherlimit erreicht (${usedMb} / ${settings.customerQuotaMb} MB belegt). Bitte Dateien löschen oder den Administrator kontaktieren.` });
                }
            }
            const uploadSession = await createProviderUploadSession(
                settings,
                ctx,
                fileName,
                mimeType,
                sizeBytes,
            );

            await logDateiaustauschAudit(request, {
                action: 'cp.file.upload.session_start',
                session,
                newState: {
                    fileName,
                    sizeBytes,
                    mimeType,
                },
            });

            return reply.status(201).send({
                success: true,
                provider: ctx.provider,
                folderName: `${ctx.companyFolderName}/${ctx.uploadFolderName}`,
                session: uploadSession,
                file: {
                    name: sanitizeUploadFileName(fileName),
                    mimeType,
                    size: sizeBytes,
                },
            });
        } catch (error: any) {
            const statusCode = resolveErrorStatusCode(error);
            return reply.status(statusCode).send({ error: normalizeProviderErrorMessage(error) });
        }
    });

    fastify.post('/public/files/upload', {
        config: { policy: { public: true }, rateLimit: { max: 6, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = resolvePublicSessionToken(request);
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });
        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });
        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        const settings = await loadConnectorSettings(db);
        const status = connectorStatus(settings);
        if (!status.configured) return reply.status(503).send({ error: 'Cloud-Connector ist noch nicht konfiguriert.' });

        if (activePublicUploads >= MAX_CONCURRENT_PUBLIC_UPLOADS) {
            return reply.status(429).send({
                error: `Server ist ausgelastet. Bitte kurz erneut versuchen (max. ${MAX_CONCURRENT_PUBLIC_UPLOADS} parallele Uploads).`,
            });
        }

        const maxUploadBytes = Math.max(1, settings.maxUploadMb) * 1024 * 1024;
        const allowedExtensions = new Set(settings.allowedExtensions);
        const uploaded: Array<{ name: string; mimeType: string; size: number }> = [];
        activePublicUploads += 1;
        try {
            const ctx = await resolveProviderContext(db, settings, session);

            if (settings.customerQuotaMb > 0) {
                const usedBytes = await calculateFolderSizeBytes(settings, ctx, ctx.companyFolderId);
                const quotaBytes = settings.customerQuotaMb * 1024 * 1024;
                if (usedBytes >= quotaBytes) {
                    const usedMb = (usedBytes / 1024 / 1024).toFixed(1);
                    return reply.status(400).send({ error: `Speicherlimit erreicht (${usedMb} / ${settings.customerQuotaMb} MB belegt). Bitte Dateien löschen oder den Administrator kontaktieren.` });
                }
            }

            const parts = (request as any).parts ? (request as any).parts() : null;
            if (!parts) {
                return reply.status(400).send({ error: 'Multipart-Upload ist erforderlich.' });
            }

            let filesSeen = 0;
            for await (const part of parts) {
                if (!part || part.type !== 'file') continue;
                filesSeen += 1;
                if (filesSeen > MAX_FILES_PER_BULK_UPLOAD) {
                    return reply.status(400).send({ error: `Zu viele Dateien. Maximal ${MAX_FILES_PER_BULK_UPLOAD} pro Upload.` });
                }

                const fileName = sanitizeUploadFileName(String(part.filename || '').trim());
                const mimeType = String(part.mimetype || 'application/octet-stream').trim() || 'application/octet-stream';
                if (!isAllowedFileName(fileName, allowedExtensions)) {
                    return reply.status(400).send({ error: `Dateityp nicht erlaubt: ${fileName}. Erlaubt: ${settings.allowedExtensions.join(', ')}` });
                }
                if (!isAllowedMimeForFile(fileName, mimeType)) {
                    return reply.status(400).send({ error: `MIME-Typ passt nicht zur Dateiendung: ${fileName}.` });
                }

                let tempPath = '';
                try {
                    const streamed = await streamUploadToTempFile(part, maxUploadBytes);
                    if (!Number.isFinite(streamed.sizeBytes) || streamed.sizeBytes <= 0) {
                        return reply.status(400).send({ error: `Leere Datei ist nicht erlaubt: ${fileName}.` });
                    }
                    tempPath = streamed.tempPath;
                    await uploadTempFileToProvider(settings, ctx, fileName, mimeType, tempPath, streamed.sizeBytes);
                    uploaded.push({ name: fileName, mimeType, size: streamed.sizeBytes });

                    await logDateiaustauschAudit(request, {
                        action: 'cp.file.upload',
                        session,
                        newState: {
                            fileName,
                            sizeBytes: streamed.sizeBytes,
                            mimeType,
                        },
                    });
                } finally {
                    if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => undefined);
                }
            }

            if (filesSeen === 0) {
                return reply.status(400).send({ error: 'Mindestens eine Datei ist erforderlich.' });
            }

            return reply.status(201).send({
                success: true,
                provider: ctx.provider,
                uploadedCount: uploaded.length,
                uploaded,
                targetFolder: `${ctx.companyFolderName}/${ctx.uploadFolderName}`,
            });
        } catch (error: any) {
            const statusCode = resolveErrorStatusCode(error);
            return reply.status(statusCode).send({ error: normalizeProviderErrorMessage(error) });
        } finally {
            activePublicUploads = Math.max(0, activePublicUploads - 1);
        }
    });

    fastify.post('/public/items/delete', {
        config: { policy: { public: true }, rateLimit: { max: 20, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = resolvePublicSessionToken(request);
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });
        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });
        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        const settings = await loadConnectorSettings(db);
        const status = connectorStatus(settings);
        if (!status.configured) return reply.status(503).send({ error: 'Cloud-Connector ist noch nicht konfiguriert.' });

        const body = (request.body || {}) as { ids?: unknown };
        const ids = Array.isArray(body.ids)
            ? body.ids.map((id) => String(id || '').trim()).filter(Boolean)
            : [];
        if (ids.length === 0) {
            return reply.status(400).send({ error: 'Mindestens ein Eintrag muss ausgewählt sein.' });
        }
        if (ids.length > 100) {
            return reply.status(400).send({ error: 'Zu viele Einträge auf einmal (max. 100).' });
        }

        try {
            const ctx = await resolveProviderContext(db, settings, session);
            const relativeParts = parseRelativeFolderPath((request.query as any)?.folderPath);
            const folder = await resolveFolderFromPath(settings, ctx, relativeParts);
            const currentEntries = await listProviderEntries(settings, ctx, folder.id);
            const allowedMap = new Map(currentEntries.map((entry) => [entry.id, entry]));

            const validIds = ids.filter((id) => allowedMap.has(id));
            if (validIds.length === 0) {
                return reply.status(400).send({ error: 'Keine gültigen Einträge im aktuellen Ordner ausgewählt.' });
            }

            const deletedIds: string[] = [];
            const failed: Array<{ id: string; reason: string }> = [];
            for (const id of validIds) {
                try {
                    await deleteProviderEntry(settings, ctx, id);
                    deletedIds.push(id);
                } catch (error: any) {
                    failed.push({ id, reason: String(error?.message || 'Löschen fehlgeschlagen.') });
                }
            }

            await logDateiaustauschAudit(request, {
                action: 'cp.file.delete',
                session,
                newState: {
                    folderPath: joinRelativeFolderPath(relativeParts),
                    selectedCount: ids.length,
                    deletedCount: deletedIds.length,
                    failedCount: failed.length,
                    deletedItems: deletedIds.map((id) => {
                        const entry = allowedMap.get(id);
                        return { id, name: entry?.name || null, isFolder: Boolean(entry?.isFolder) };
                    }),
                },
            });

            return {
                success: failed.length === 0,
                deletedCount: deletedIds.length,
                deletedIds,
                failed,
            };
        } catch (error: any) {
            const statusCode = resolveErrorStatusCode(error);
            return reply.status(statusCode).send({ error: normalizeProviderErrorMessage(error) || 'Löschen fehlgeschlagen.' });
        }
    });

    fastify.post('/public/items/download', {
        config: { policy: { public: true }, rateLimit: { max: 10, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = resolvePublicSessionToken(request);
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });
        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });
        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        const settings = await loadConnectorSettings(db);
        const status = connectorStatus(settings);
        if (!status.configured) return reply.status(503).send({ error: 'Cloud-Connector ist noch nicht konfiguriert.' });

        const body = (request.body || {}) as { ids?: unknown };
        const ids = Array.isArray(body.ids)
            ? body.ids.map((id) => String(id || '').trim()).filter(Boolean)
            : [];
        if (ids.length === 0) {
            return reply.status(400).send({ error: 'Mindestens ein Eintrag muss ausgewählt sein.' });
        }
        if (ids.length > 200) {
            return reply.status(400).send({ error: 'Zu viele Einträge auf einmal (max. 200).' });
        }

        try {
            const ctx = await resolveProviderContext(db, settings, session);
            const relativeParts = parseRelativeFolderPath((request.query as any)?.folderPath);
            const folder = await resolveFolderFromPath(settings, ctx, relativeParts);
            const currentEntries = await listProviderEntries(settings, ctx, folder.id);
            const allowedMap = new Map(currentEntries.map((entry) => [entry.id, entry]));

            const validEntries = ids
                .map((id) => allowedMap.get(id))
                .filter((entry): entry is DriveEntry => Boolean(entry));
            if (validEntries.length === 0) {
                return reply.status(400).send({ error: 'Keine gültigen Einträge im aktuellen Ordner ausgewählt.' });
            }

            await logDateiaustauschAudit(request, {
                action: 'cp.file.download.zip',
                session,
                newState: {
                    folderPath: joinRelativeFolderPath(relativeParts),
                    selectedCount: ids.length,
                    entryCount: validEntries.length,
                    entries: validEntries.map((entry) => ({
                        id: entry.id,
                        name: entry.name,
                        isFolder: Boolean(entry.isFolder),
                    })),
                },
            });

            const zipBaseName = sanitizeZipPathPart(relativeParts.length
                ? relativeParts[relativeParts.length - 1]
                : ctx.companyFolderName);
            const zipName = `dateiaustausch-${zipBaseName}-${new Date().toISOString().slice(0, 10)}.zip`;

            if (!createZipArchiver) {
                return reply.status(503).send({
                    error: `ZIP-Download aktuell nicht verfügbar (archiver fehlt: ${archiverResolution.reason || 'unbekannt'}).`,
                });
            }

            reply.header('Content-Type', 'application/zip');
            reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);
            reply.raw.writeHead(200);

            const archive = createZipArchiver('zip', { zlib: { level: 6 } });
            archive.on('error', (err) => {
                if (!reply.raw.destroyed) reply.raw.destroy(err);
            });
            archive.pipe(reply.raw);

            const counters = { files: 0 };
            for (const entry of validEntries) {
                await appendProviderEntryToArchive(settings, ctx, entry, archive, '', counters);
            }
            await archive.finalize();
            return reply;
        } catch (error: any) {
            const statusCode = resolveErrorStatusCode(error);
            return reply.status(statusCode).send({ error: normalizeProviderErrorMessage(error) || 'ZIP-Download fehlgeschlagen.' });
        }
    });

    fastify.get('/public/files/:fileId/download', {
        exposeHeadRoute: false,
        config: { policy: { public: true }, rateLimit: { max: 60, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = resolvePublicSessionToken(request);
        const relativeParts = parseRelativeFolderPath((request.query as any)?.folderPath);
        const fileId = String((request.params as any)?.fileId || '').trim();
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });
        if (!fileId) return reply.status(400).send({ error: 'Datei-ID ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });
        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        const settings = await loadConnectorSettings(db);
        const status = connectorStatus(settings);
        if (!status.configured) return reply.status(503).send({ error: 'Cloud-Connector ist noch nicht konfiguriert.' });

        try {
            const ctx = await resolveProviderContext(db, settings, session);
            const folder = await resolveFolderFromPath(settings, ctx, relativeParts);
            const entries = await listProviderEntries(settings, ctx, folder.id);
            const selected = entries.find((entry) => String(entry.id) === fileId);
            await logDateiaustauschAudit(request, {
                action: 'cp.file.download',
                session,
                entityType: 'cloud_file',
                entityId: fileId,
                newState: {
                    folderPath: joinRelativeFolderPath(relativeParts),
                    fileName: selected?.name || null,
                    isFolder: selected ? Boolean(selected.isFolder) : null,
                },
            });
            await streamProviderDownload(settings, ctx, folder.id, fileId, reply);
            return reply;
        } catch (error: any) {
            const statusCode = resolveErrorStatusCode(error);
            return reply.status(statusCode).send({ error: normalizeProviderErrorMessage(error) || 'Download fehlgeschlagen.' });
        }
    });

    fastify.get('/public/files/:fileId/preview', {
        exposeHeadRoute: false,
        config: { policy: { public: true }, rateLimit: { max: 90, timeWindow: '1 minute' } },
        policy: { public: true },
    }, async (request, reply) => {
        const sessionToken = resolvePublicSessionToken(request);
        const relativeParts = parseRelativeFolderPath((request.query as any)?.folderPath);
        const fileId = String((request.params as any)?.fileId || '').trim();
        if (!sessionToken) return reply.status(400).send({ error: 'Session-Token ist erforderlich.' });
        if (!fileId) return reply.status(400).send({ error: 'Datei-ID ist erforderlich.' });

        const session = await verifyPublicSessionByToken(db, sessionToken);
        if (!session) return reply.status(401).send({ error: 'Session abgelaufen oder ungültig.' });
        await db('vp_public_sessions').where({ id: session.id }).update({ last_used_at: new Date() });

        const settings = await loadConnectorSettings(db);
        const status = connectorStatus(settings);
        if (!status.configured) return reply.status(503).send({ error: 'Cloud-Connector ist noch nicht konfiguriert.' });

        try {
            const ctx = await resolveProviderContext(db, settings, session);
            const folder = await resolveFolderFromPath(settings, ctx, relativeParts);
            const entries = await listProviderEntries(settings, ctx, folder.id);
            const selected = entries.find((entry) => String(entry.id) === fileId);
            await logDateiaustauschAudit(request, {
                action: 'cp.file.preview',
                session,
                entityType: 'cloud_file',
                entityId: fileId,
                newState: {
                    folderPath: joinRelativeFolderPath(relativeParts),
                    fileName: selected?.name || null,
                    isFolder: selected ? Boolean(selected.isFolder) : null,
                },
            });
            await streamProviderPreview(settings, ctx, folder.id, fileId, reply);
            return reply;
        } catch (error: any) {
            const statusCode = resolveErrorStatusCode(error);
            return reply.status(statusCode).send({ error: normalizeProviderErrorMessage(error) || 'Vorschau fehlgeschlagen.' });
        }
    });
}
