import { createHash, randomInt, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../../backend/src/core/config.js';
import { getDatabase } from '../../../backend/src/core/database.js';
import { decrypt } from '../../../backend/src/core/encryption.js';

const SOURCE_PREFIX = '/api/plugins/videoplattform/public';
const KUNDENPORTAL_PREFIX = '/api/plugins/kundenportal/public';
const PLUGIN_ID = 'kundenportal';
const VIDEOPLATTFORM_PLUGIN_ID = 'videoplattform';
const PUBLIC_SUBDOMAIN_SETTING_KEY = 'kundenportal.public_subdomain';
const LEGACY_PUBLIC_SUBDOMAIN_SETTING_KEY = 'videoplattform.public_subdomain';
const PUBLIC_LOGO_FILE_SETTING_KEY = 'kundenportal.public_logo_file';
const LEGACY_PUBLIC_LOGO_FILE_SETTING_KEY = 'videoplattform.public_logo_file';
const PUBLIC_LOGO_HEIGHT_SETTING_KEY = 'kundenportal.public_logo_height';
const LEGACY_PUBLIC_LOGO_HEIGHT_SETTING_KEY = 'videoplattform.public_logo_height';
const PUBLIC_AUTH_MODE_SETTING_KEY = 'kundenportal.public_auth_mode';
const LEGACY_PUBLIC_AUTH_MODE_SETTING_KEY = 'videoplattform.public_auth_mode';
const DEFAULT_PUBLIC_SUBDOMAIN = 'kunden.webdesign-hammer.de';
const DEFAULT_PUBLIC_AUTH_MODE = 'magic_code';
const MAGIC_CODE_TTL_MINUTES = 15;
const MAGIC_SESSION_TTL_HOURS = 72;
const MAGIC_CODE_REQUEST_RATE_MAX = 8;
const MAGIC_CODE_REQUEST_RATE_WINDOW_MS = 60 * 1000;
const MAGIC_CODE_VERIFY_RATE_MAX = 12;
const MAGIC_CODE_VERIFY_RATE_WINDOW_MS = 60 * 1000;
const MAGIC_CODE_REQUEST_EMAIL_WINDOW_MS = 10 * 60 * 1000;
const MAGIC_CODE_REQUEST_EMAIL_MAX = 3;
const MAGIC_CODE_MAX_VERIFY_ATTEMPTS = 6;

type PublicSessionRecord = {
    id: number;
    tenant_id: number;
    customer_id: number;
    email_normalized: string;
    expires_at: string;
    revoked_at: string | null;
};


type PortalCustomerProfile = {
    displayName: string | null;
    companyName: string | null;
    firstName: string | null;
    lastName: string | null;
};

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

function normalizeEmail(input: unknown): string {
    return String(input || '').trim().toLowerCase();
}

function normalizeText(value: unknown): string | null {
    const text = String(value || '').trim();
    return text ? text : null;
}

function hashValue(value: string): string {
    return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function createMagicCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function createSessionToken(): string {
    return createHash('sha256')
        .update(`${randomUUID()}-${Date.now()}-${Math.random()}`)
        .digest('hex');
}

function buildTargetUrl(pathname: string, query: Record<string, any>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            for (const item of value) params.append(key, String(item));
        } else {
            params.set(key, String(value));
        }
    }
    const qs = params.toString();
    return `${SOURCE_PREFIX}${pathname}${qs ? `?${qs}` : ''}`;
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
        if (row?.value_encrypted) return String(row.value_encrypted);
    }
    return null;
}

async function readPublicSubdomain(db: any): Promise<string> {
    const encrypted = await readGlobalEncryptedSetting(db, [
        { pluginId: PLUGIN_ID, key: PUBLIC_SUBDOMAIN_SETTING_KEY },
        { pluginId: VIDEOPLATTFORM_PLUGIN_ID, key: LEGACY_PUBLIC_SUBDOMAIN_SETTING_KEY },
    ]);
    if (!encrypted) return DEFAULT_PUBLIC_SUBDOMAIN;
    try {
        return normalizeHost(decrypt(encrypted)) || DEFAULT_PUBLIC_SUBDOMAIN;
    } catch {
        return DEFAULT_PUBLIC_SUBDOMAIN;
    }
}

async function readPublicLogoFile(db: any): Promise<string> {
    const encrypted = await readGlobalEncryptedSetting(db, [
        { pluginId: PLUGIN_ID, key: PUBLIC_LOGO_FILE_SETTING_KEY },
        { pluginId: VIDEOPLATTFORM_PLUGIN_ID, key: LEGACY_PUBLIC_LOGO_FILE_SETTING_KEY },
    ]);
    if (!encrypted) return '';
    try {
        return String(decrypt(encrypted) || '').trim();
    } catch {
        return '';
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
        { pluginId: PLUGIN_ID, key: PUBLIC_LOGO_HEIGHT_SETTING_KEY },
        { pluginId: VIDEOPLATTFORM_PLUGIN_ID, key: LEGACY_PUBLIC_LOGO_HEIGHT_SETTING_KEY },
    ]);
    if (!encrypted) return 52;
    try {
        const value = Number(decrypt(encrypted));
        if (!Number.isFinite(value)) return 52;
        return Math.max(24, Math.min(180, Math.round(value)));
    } catch {
        return 52;
    }
}

async function readPublicAuthMode(db: any): Promise<string> {
    const encrypted = await readGlobalEncryptedSetting(db, [
        { pluginId: PLUGIN_ID, key: PUBLIC_AUTH_MODE_SETTING_KEY },
        { pluginId: VIDEOPLATTFORM_PLUGIN_ID, key: LEGACY_PUBLIC_AUTH_MODE_SETTING_KEY },
    ]);
    if (!encrypted) return DEFAULT_PUBLIC_AUTH_MODE;
    try {
        const value = String(decrypt(encrypted) || '').trim().toLowerCase();
        return value === 'share_code' ? 'share_code' : DEFAULT_PUBLIC_AUTH_MODE;
    } catch {
        return DEFAULT_PUBLIC_AUTH_MODE;
    }
}

async function ensurePublicHost(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const db = getDatabase();
    const configuredHost = normalizeHost(await readPublicSubdomain(db));
    const requestHost = normalizeHost(getRequestHost(request));

    if (!configuredHost) return true;
    if (requestHost === configuredHost) return true;
    if (config.server.env !== 'production' && isLikelyDevelopmentHost(requestHost)) return true;

    reply.status(403).send({
        error: `Dieses Kundenportal ist nur über ${configuredHost} erreichbar.`,
        expectedHost: configuredHost,
    });
    return false;
}

async function ensureCustomerAccessSchema(db: any): Promise<void> {
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
        }).catch(() => undefined);
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
    return `${normalizedBase} (#${crmId})`.slice(0, 255);
}

async function resolveCustomerByEmail(
    db: any,
    normalizedEmail: string,
): Promise<{ tenantId: number; crmCustomerId: number; customerName: string } | null> {
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

async function ensureVpCustomerForCrm(
    db: any,
    tenantId: number,
    crmCustomerId: number,
    customerName: string,
): Promise<number | null> {
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
    const tokenHash = hashValue(token);
    const row = await db('vp_public_sessions')
        .where({ token_hash: tokenHash })
        .whereNull('revoked_at')
        .andWhere('expires_at', '>=', db.fn.now())
        .first();
    return row as PublicSessionRecord || null;
}

async function getPortalCustomerProfile(db: any, tenantId: number, vpCustomerId: number): Promise<PortalCustomerProfile> {
    const customer = await db('vp_customers')
        .where({ tenant_id: tenantId, id: vpCustomerId })
        .first('name', 'crm_customer_id');

    if (!customer) return { displayName: null, companyName: null, firstName: null, lastName: null };

    const fallbackName = normalizeText(customer.name);
    const crmCustomerId = Number(customer.crm_customer_id || 0);
    if (!crmCustomerId) {
        return { displayName: fallbackName, companyName: null, firstName: null, lastName: null };
    }

    const hasCrmCustomers = await db.schema.hasTable('crm_customers').catch(() => false);
    if (!hasCrmCustomers) {
        return { displayName: fallbackName, companyName: null, firstName: null, lastName: null };
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


export default async function plugin(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();
    await ensureCustomerAccessSchema(db);

    fastify.get('/public/modules', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (_request, reply) => {
        const fileExchangePlugin = await db('plugins')
            .where({ plugin_id: 'dateiaustausch' })
            .first();

        return reply.send({
            dateiaustauschEnabled: Boolean(fileExchangePlugin?.is_active),
        });
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
        const tenantLogoUrl = firstTenant?.logo_file ? `${KUNDENPORTAL_PREFIX}/tenant-logo/${firstTenant.id}` : null;

        return {
            expectedHost: configuredHost,
            brand: tenantName,
            tenantName,
            tenantLogoUrl,
            authMode,
            logoUrl: fallbackLogoFile ? `${KUNDENPORTAL_PREFIX}/logo` : null,
            logoHeight,
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

        const recentForEmail = await db('vp_magic_codes')
            .where({ email_hash: emailHash })
            .andWhere('created_at', '>=', cutoff)
            .count('id as count')
            .first();
        if (Number(recentForEmail?.count || 0) >= MAGIC_CODE_REQUEST_EMAIL_MAX) {
            return { success: true, message: 'Wenn die E-Mail bekannt ist, wurde ein Code versendet.' };
        }

        const resolved = await resolveCustomerByEmail(db, email);
        if (!resolved) return { success: true, message: 'Wenn die E-Mail bekannt ist, wurde ein Code versendet.' };

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
        const tenant = await db('tenants').where({ id: row.tenant_id }).first('id', 'logo_file', 'name');
        const fallbackLogoFile = await readPublicLogoFile(db);
        const activePlugins = await db('plugins').where('is_active', true).pluck('plugin_id');

        return {
            sessionToken,
            expiresAt: sessionExpiresAt.toISOString(),
            customerId: row.customer_id,
            customerName: customerProfile.displayName || null,
            customerProfile,
            tenantName: tenant?.name || null,
            tenantLogoUrl: tenant?.logo_file
                ? `${KUNDENPORTAL_PREFIX}/tenant-logo/${Number(tenant.id)}?sessionToken=${encodeURIComponent(sessionToken)}`
                : null,
            logoUrl: fallbackLogoFile ? `${KUNDENPORTAL_PREFIX}/logo` : null,
            activePlugins,
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
        const tenant = await db('tenants').where({ id: session.tenant_id }).first('id', 'logo_file', 'name');
        const fallbackLogoFile = await readPublicLogoFile(db);
        const activePlugins = await db('plugins').where('is_active', true).pluck('plugin_id');

        return {
            sessionToken,
            expiresAt: session.expires_at,
            customerId: session.customer_id,
            customerName: customerProfile.displayName || null,
            customerProfile,
            tenantName: tenant?.name || null,
            tenantLogoUrl: tenant?.logo_file
                ? `${KUNDENPORTAL_PREFIX}/tenant-logo/${Number(tenant.id)}?sessionToken=${encodeURIComponent(sessionToken)}`
                : null,
            logoUrl: fallbackLogoFile ? `${KUNDENPORTAL_PREFIX}/logo` : null,
            activePlugins,
        };
    });

    fastify.post('/public/auth/logout', {
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request) => {
        const sessionToken = String((request.body as any)?.sessionToken || '').trim();
        if (!sessionToken) return { success: true };
        const tokenHash = hashValue(sessionToken);
        await db('vp_public_sessions')
            .where({ token_hash: tokenHash })
            .whereNull('revoked_at')
            .update({ revoked_at: db.fn.now() });
        return { success: true };
    });


    fastify.get('/public/logo', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (_request, reply) => {
        const fileName = await readPublicLogoFile(db);
        if (!fileName) return reply.status(404).send({ error: 'Kein Portal-Logo hinterlegt' });
        
        const absPathNew = path.join(config.app.uploadsDir, 'plugins', PLUGIN_ID, 'branding', fileName);
        const absPathOld = path.join(config.app.uploadsDir, 'plugins', VIDEOPLATTFORM_PLUGIN_ID, 'branding', fileName);

        for (const targetPath of [absPathNew, absPathOld]) {
            try {
                await fs.access(targetPath);
                reply.header('Cache-Control', 'public, max-age=300');
                reply.type(logoMimeTypeFromFileName(fileName));
                return reply.send(createReadStream(targetPath));
            } catch {
                continue;
            }
        }
        
        return reply.status(404).send({ error: 'Logo-Datei nicht gefunden' });
    });

    fastify.get('/public/tenant-logo/:tenantId', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        const ok = await ensurePublicHost(request, reply);
        if (!ok) return;

        const tenantId = Number((request.params as any)?.tenantId || 0);
        if (!Number.isInteger(tenantId) || tenantId <= 0) return reply.status(400).send({ error: 'Ungültige Mandanten-ID' });

        const tenant = await db('tenants').where({ id: tenantId }).first('logo_file');
        if (!tenant?.logo_file) return reply.status(404).send({ error: 'Kein Tenant-Logo vorhanden' });

        const absPath = path.join(config.app.uploadsDir, 'tenant-logos', String(tenant.logo_file));
        try {
            await fs.access(absPath);
            reply.header('Cache-Control', 'public, max-age=300');
            reply.type(logoMimeTypeFromFileName(String(tenant.logo_file)));
            return reply.send(createReadStream(absPath));
        } catch {
            return reply.status(404).send({ error: 'Tenant-Logo-Datei nicht gefunden' });
        }
    });

    fastify.get('/public/health', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async () => ({ ok: true, plugin: PLUGIN_ID }));
}
