import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import nodemailer from 'nodemailer';
import { getDatabase } from '../core/database.js';
import { encrypt, decrypt } from '../core/encryption.js';

interface SendMailOptions {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    accountId?: number;
}

interface EmailAccount {
    id: number;
    name: string;
    provider: string;
    smtp_host: string | null;
    smtp_port: number | null;
    smtp_user: string | null;
    smtp_password: string | null;
    smtp_secure: boolean;
    from_address: string | null;
    from_name: string | null;
    is_default: boolean;
    oauth_tenant_id: string | null;
    oauth_client_id: string | null;
    oauth_client_secret: string | null;
    oauth_refresh_token: string | null;
    oauth_access_token: string | null;
    oauth_access_expires_at: string | Date | null;
    oauth_scope: string | null;
    created_at: Date;
    updated_at: Date;
}

interface EmailApi {
    send: (opts: SendMailOptions) => Promise<void>;
    isConfigured: () => Promise<boolean>;
    getAccount: (id: number) => Promise<EmailAccount | null>;
    getDefaultAccount: () => Promise<EmailAccount | null>;
}

function tryDecrypt(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
        return decrypt(value);
    } catch {
        return value;
    }
}

function normalizeEmail(value: string): string {
    return String(value || '').trim().toLowerCase();
}

function nullIfBlank(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    return str ? str : null;
}

function sanitizeAccount(account: EmailAccount): EmailAccount {
    return {
        ...account,
        smtp_password: tryDecrypt(account.smtp_password),
        oauth_client_secret: tryDecrypt(account.oauth_client_secret),
        oauth_refresh_token: tryDecrypt(account.oauth_refresh_token),
        oauth_access_token: tryDecrypt(account.oauth_access_token),
    };
}

function maskAccountSecrets(account: EmailAccount): Record<string, any> {
    return {
        ...account,
        smtp_password: account.smtp_password ? '••••••' : null,
        oauth_client_secret: account.oauth_client_secret ? '••••••' : null,
        oauth_refresh_token: account.oauth_refresh_token ? '••••••' : null,
        oauth_access_token: account.oauth_access_token ? '••••••' : null,
    };
}

async function getAccountById(id: number): Promise<EmailAccount | null> {
    const db = getDatabase();
    const account = await db('email_accounts').where('id', id).first();
    if (!account) return null;
    return sanitizeAccount(account as EmailAccount);
}

async function getDefaultAccount(): Promise<EmailAccount | null> {
    const db = getDatabase();
    const account = await db('email_accounts').where('is_default', true).first();
    if (account) return sanitizeAccount(account as EmailAccount);
    const first = await db('email_accounts').orderBy('id', 'asc').first();
    if (!first) return null;
    return sanitizeAccount(first as EmailAccount);
}

type M365AuthMode = 'delegated' | 'application';

async function requestM365AccessToken(account: EmailAccount): Promise<{ accessToken: string; mode: M365AuthMode }> {
    const tenantId = String(account.oauth_tenant_id || 'common').trim();
    const clientId = String(account.oauth_client_id || '').trim();
    const clientSecret = String(account.oauth_client_secret || '').trim();
    const refreshToken = String(account.oauth_refresh_token || '').trim();
    const delegatedScope = String(account.oauth_scope || 'offline_access https://graph.microsoft.com/Mail.Send').trim();
    const appScope = 'https://graph.microsoft.com/.default';

    if (!clientId || !clientSecret) {
        throw new Error('M365 OAuth ist unvollständig konfiguriert (client_id/client_secret).');
    }

    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
    const payload = refreshToken
        ? new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            scope: delegatedScope,
        })
        : new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: appScope,
        });

    const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: payload.toString(),
    });

    const data = await res.json().catch(() => ({} as any));
    if (!res.ok || !data?.access_token) {
        throw new Error(data?.error_description || data?.error || 'M365 OAuth Token konnte nicht aktualisiert werden.');
    }

    const expiresInSec = Number(data.expires_in || 3600);
    const expiresAt = new Date(Date.now() + Math.max(60, expiresInSec - 60) * 1000);

    const db = getDatabase();
    await db('email_accounts').where({ id: account.id }).update({
        oauth_access_token: encrypt(String(data.access_token)),
        oauth_access_expires_at: expiresAt,
        updated_at: new Date(),
    });

    return {
        accessToken: String(data.access_token),
        mode: refreshToken ? 'delegated' : 'application',
    };
}

async function getM365AccessToken(account: EmailAccount): Promise<{ accessToken: string; mode: M365AuthMode }> {
    const existingToken = String(account.oauth_access_token || '').trim();
    const existingExpiry = account.oauth_access_expires_at ? new Date(account.oauth_access_expires_at) : null;
    const stillValid = existingToken
        && existingExpiry
        && Number.isFinite(existingExpiry.getTime())
        && existingExpiry.getTime() > Date.now() + 30_000;

    if (stillValid) {
        return {
            accessToken: existingToken,
            mode: String(account.oauth_refresh_token || '').trim() ? 'delegated' : 'application',
        };
    }

    return requestM365AccessToken(account);
}

function toEmailAddressList(value: string | string[]): Array<{ emailAddress: { address: string } }> {
    const values = Array.isArray(value) ? value : String(value).split(',');
    const addresses = values
        .map((entry) => normalizeEmail(String(entry)))
        .filter(Boolean);

    if (addresses.length === 0) {
        throw new Error('Empfänger-Adresse fehlt.');
    }

    return addresses.map((address) => ({ emailAddress: { address } }));
}

async function sendViaM365Graph(account: EmailAccount, opts: SendMailOptions): Promise<void> {
    const { accessToken, mode } = await getM365AccessToken(account);
    const fromAddress = normalizeEmail(account.from_address || account.smtp_user || '');
    const fromName = String(account.from_name || '').trim();
    if (!fromAddress) throw new Error('Absender-Adresse fehlt (from_address).');

    const payload = {
        message: {
            subject: opts.subject,
            body: {
                contentType: opts.html ? 'HTML' : 'Text',
                content: opts.html || opts.text || '',
            },
            from: {
                emailAddress: {
                    address: fromAddress,
                    ...(fromName ? { name: fromName } : {}),
                },
            },
            toRecipients: toEmailAddressList(opts.to),
        },
        saveToSentItems: true,
    };

    const endpoint = mode === 'application'
        ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromAddress)}/sendMail`
        : 'https://graph.microsoft.com/v1.0/me/sendMail';

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const details = await response.text().catch(() => '');
        throw new Error(`M365 Graph Versand fehlgeschlagen (${response.status}): ${details || 'Unbekannter Fehler'}`);
    }
}

async function createTransport(account: EmailAccount): Promise<any> {
    const host = String(account.smtp_host || '').trim();
    const port = Number(account.smtp_port || 587);
    const secure = Boolean(account.smtp_secure);
    const user = String(account.smtp_user || '').trim();

    if (account.provider === 'smtp') {
        const pass = String(account.smtp_password || '').trim();
        if (!host || !user || !pass) {
            throw new Error('SMTP-Konfiguration unvollständig (Host, Benutzer, Passwort).');
        }
        return nodemailer.createTransport({
            host,
            port,
            secure,
            auth: { user, pass },
        });
    }

    throw new Error(`Unbekannter E-Mail-Provider: ${account.provider}`);
}

async function emailPlugin(fastify: FastifyInstance): Promise<void> {
    const mail: EmailApi = {
        async send(opts: SendMailOptions): Promise<void> {
            const account = opts.accountId ? await getAccountById(opts.accountId) : await getDefaultAccount();
            if (!account) {
                throw new Error('Kein E-Mail-Konto konfiguriert. Bitte unter Administration > E-Mail-Konten einrichten.');
            }

            if (account.provider === 'm365') {
                await sendViaM365Graph(account, opts);
                return;
            }

            const transporter = await createTransport(account);
            const fromAddress = normalizeEmail(account.from_address || account.smtp_user || '');
            const fromName = String(account.from_name || '').trim();
            if (!fromAddress) throw new Error('Absender-Adresse fehlt (from_address oder smtp_user).');

            await transporter.sendMail({
                from: fromName ? `"${fromName}" <${fromAddress}>` : fromAddress,
                to: opts.to,
                subject: opts.subject,
                text: opts.text,
                html: opts.html,
            });
        },

        async isConfigured(): Promise<boolean> {
            const account = await getDefaultAccount();
            return account !== null && account.provider !== 'none';
        },

        async getAccount(id: number): Promise<EmailAccount | null> {
            return getAccountById(id);
        },

        async getDefaultAccount(): Promise<EmailAccount | null> {
            return getDefaultAccount();
        },
    };

    fastify.decorate('mail', mail);
    console.log('[E-Mail] Multi-Account Service initialisiert');
}

export async function emailRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    fastify.get('/email/accounts', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
        const accounts = await db('email_accounts').orderBy('name', 'asc');
        return reply.send(accounts.map((a: EmailAccount) => maskAccountSecrets(a)));
    });

    fastify.get('/email/accounts/list', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
        const accounts = await db('email_accounts').select('id', 'name', 'from_address', 'is_default').orderBy('name', 'asc');
        return reply.send(accounts);
    });

    fastify.get('/email/accounts/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const account = await db('email_accounts').where('id', id).first();
        if (!account) return reply.status(404).send({ error: 'Konto nicht gefunden' });
        return reply.send(maskAccountSecrets(account as EmailAccount));
    });

    fastify.post('/email/accounts', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const body = request.body as Record<string, any>;
        if (!body.name?.trim()) return reply.status(400).send({ error: 'Name ist erforderlich' });

        if (body.is_default) await db('email_accounts').update({ is_default: false });

        const [id] = await db('email_accounts').insert({
            name: body.name.trim(),
            provider: body.provider || 'smtp',
            smtp_host: nullIfBlank(body.smtp_host),
            smtp_port: body.smtp_port ? parseInt(String(body.smtp_port), 10) : 587,
            smtp_user: nullIfBlank(body.smtp_user),
            smtp_password: body.smtp_password ? encrypt(String(body.smtp_password)) : null,
            smtp_secure: body.smtp_secure !== false,
            from_address: nullIfBlank(body.from_address),
            from_name: nullIfBlank(body.from_name),
            is_default: !!body.is_default,
            oauth_tenant_id: nullIfBlank(body.oauth_tenant_id),
            oauth_client_id: nullIfBlank(body.oauth_client_id),
            oauth_client_secret: body.oauth_client_secret ? encrypt(String(body.oauth_client_secret)) : null,
            oauth_refresh_token: body.oauth_refresh_token ? encrypt(String(body.oauth_refresh_token)) : null,
            oauth_access_token: body.oauth_access_token ? encrypt(String(body.oauth_access_token)) : null,
            oauth_access_expires_at: nullIfBlank(body.oauth_access_expires_at),
            oauth_scope: nullIfBlank(body.oauth_scope),
            created_at: new Date(),
            updated_at: new Date(),
        });

        await fastify.audit.log({
            action: 'email.account.created',
            category: 'admin',
            entityType: 'email_accounts',
            entityId: id,
            newState: { name: body.name, provider: body.provider },
        }, request);

        return reply.status(201).send({ id, success: true });
    });

    fastify.put('/email/accounts/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as Record<string, any>;
        const existing = await db('email_accounts').where('id', id).first();
        if (!existing) return reply.status(404).send({ error: 'Konto nicht gefunden' });

        if (body.is_default) await db('email_accounts').where('id', '!=', id).update({ is_default: false });

        const updates: Record<string, any> = {
            name: body.name?.trim() || existing.name,
            provider: body.provider || existing.provider,
            smtp_host: body.smtp_host !== undefined ? nullIfBlank(body.smtp_host) : existing.smtp_host,
            smtp_port: body.smtp_port ? parseInt(String(body.smtp_port), 10) : existing.smtp_port,
            smtp_user: body.smtp_user !== undefined ? nullIfBlank(body.smtp_user) : existing.smtp_user,
            smtp_secure: body.smtp_secure !== undefined ? body.smtp_secure !== false : existing.smtp_secure,
            from_address: body.from_address !== undefined ? nullIfBlank(body.from_address) : existing.from_address,
            from_name: body.from_name !== undefined ? nullIfBlank(body.from_name) : existing.from_name,
            is_default: body.is_default !== undefined ? !!body.is_default : existing.is_default,
            oauth_tenant_id: body.oauth_tenant_id !== undefined ? nullIfBlank(body.oauth_tenant_id) : existing.oauth_tenant_id,
            oauth_client_id: body.oauth_client_id !== undefined ? nullIfBlank(body.oauth_client_id) : existing.oauth_client_id,
            oauth_access_expires_at: body.oauth_access_expires_at !== undefined ? nullIfBlank(body.oauth_access_expires_at) : existing.oauth_access_expires_at,
            oauth_scope: body.oauth_scope !== undefined ? nullIfBlank(body.oauth_scope) : existing.oauth_scope,
            updated_at: new Date(),
        };

        if (body.smtp_password && body.smtp_password !== '••••••') {
            updates.smtp_password = encrypt(String(body.smtp_password));
        }
        if (body.oauth_client_secret && body.oauth_client_secret !== '••••••') {
            updates.oauth_client_secret = encrypt(String(body.oauth_client_secret));
            updates.oauth_access_token = null;
            updates.oauth_access_expires_at = null;
        }
        if (body.oauth_refresh_token && body.oauth_refresh_token !== '••••••') {
            updates.oauth_refresh_token = encrypt(String(body.oauth_refresh_token));
            updates.oauth_access_token = null;
            updates.oauth_access_expires_at = null;
        }
        if (body.oauth_access_token && body.oauth_access_token !== '••••••') {
            updates.oauth_access_token = encrypt(String(body.oauth_access_token));
        }

        await db('email_accounts').where('id', id).update(updates);

        await fastify.audit.log({
            action: 'email.account.updated',
            category: 'admin',
            entityType: 'email_accounts',
            entityId: parseInt(id, 10),
            newState: { name: updates.name, provider: updates.provider },
        }, request);

        return reply.send({ success: true });
    });

    fastify.delete('/email/accounts/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const existing = await db('email_accounts').where('id', id).first();
        if (!existing) return reply.status(404).send({ error: 'Konto nicht gefunden' });

        await db('email_accounts').where('id', id).del();
        await fastify.audit.log({
            action: 'email.account.deleted',
            category: 'admin',
            entityType: 'email_accounts',
            entityId: parseInt(id, 10),
            previousState: { name: existing.name, provider: existing.provider },
        }, request);
        return reply.send({ success: true });
    });

    fastify.post('/email/accounts/:id/test', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const { to } = request.body as { to?: string };
        if (!to) return reply.status(400).send({ error: 'Empfänger-Adresse (to) ist erforderlich' });

        try {
            await fastify.mail.send({
                to,
                subject: 'MIKE Test-E-Mail',
                text: 'Dies ist eine Test-E-Mail von MIKE WorkSpace.',
                accountId: parseInt(id, 10),
            });
            return reply.send({ success: true, message: 'Test-E-Mail gesendet' });
        } catch (error: any) {
            return reply.status(400).send({ error: error.message });
        }
    });

    fastify.get('/email/settings', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
        const account = await db('email_accounts').orderBy('is_default', 'desc').first();
        if (!account) return reply.send({ provider: 'none' });
        return reply.send(maskAccountSecrets(account as EmailAccount));
    });
}

export default fp(emailPlugin, { name: 'emailService' });
