import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { getDatabase } from '../core/database.js';
import { encrypt, decrypt } from '../core/encryption.js';

interface SendMailOptions {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    template?: string;
    data?: Record<string, any>;
    accountId?: number; // Optional: spezifisches E-Mail-Konto
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
    created_at: Date;
    updated_at: Date;
}

interface EmailApi {
    send: (opts: SendMailOptions) => Promise<void>;
    isConfigured: () => Promise<boolean>;
    getAccount: (id: number) => Promise<EmailAccount | null>;
    getDefaultAccount: () => Promise<EmailAccount | null>;
}

async function getAccountById(id: number): Promise<EmailAccount | null> {
    const db = getDatabase();
    const account = await db('email_accounts').where('id', id).first();
    if (!account) return null;
    // Passwort entschluesseln
    if (account.smtp_password) {
        try {
            account.smtp_password = decrypt(account.smtp_password);
        } catch {
            // Falls nicht verschluesselt, Klartext lassen
        }
    }
    return account;
}

async function getDefaultAccount(): Promise<EmailAccount | null> {
    const db = getDatabase();
    const account = await db('email_accounts')
        .where('is_default', true)
        .first();
    if (!account) {
        // Fallback: ersten Account nehmen
        const first = await db('email_accounts').orderBy('id', 'asc').first();
        if (!first) return null;
        if (first.smtp_password) {
            try { first.smtp_password = decrypt(first.smtp_password); } catch { /* */ }
        }
        return first;
    }
    if (account.smtp_password) {
        try { account.smtp_password = decrypt(account.smtp_password); } catch { /* */ }
    }
    return account;
}

async function emailPlugin(fastify: FastifyInstance): Promise<void> {
    const mail: EmailApi = {
        async send(opts: SendMailOptions): Promise<void> {
            let account: EmailAccount | null;

            if (opts.accountId) {
                account = await getAccountById(opts.accountId);
                if (!account) {
                    throw new Error(`E-Mail-Konto mit ID ${opts.accountId} nicht gefunden.`);
                }
            } else {
                account = await getDefaultAccount();
            }

            if (!account) {
                throw new Error('Kein E-Mail-Konto konfiguriert. Bitte unter Administration > E-Mail-Konten einrichten.');
            }

            if (account.provider === 'smtp') {
                // SMTP-Versand (wird spaeter mit nodemailer implementiert)
                throw new Error('SMTP-Versand ist noch nicht implementiert. Kommt in einer zukuenftigen Version.');
            }

            if (account.provider === 'm365') {
                throw new Error('Microsoft 365 E-Mail-Connector ist noch nicht implementiert.');
            }

            throw new Error(`Unbekannter E-Mail-Provider: ${account.provider}`);
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

// Admin-Routen fuer E-Mail-Konten
export async function emailRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    // GET /api/admin/email/accounts - Alle Konten auflisten
    fastify.get('/email/accounts', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
        const accounts = await db('email_accounts').orderBy('name', 'asc');
        // Passwoerter maskieren
        const safe = accounts.map((a: EmailAccount) => ({
            ...a,
            smtp_password: a.smtp_password ? '••••••' : null,
        }));
        return reply.send(safe);
    });

    // GET /api/admin/email/accounts/list - Kurzliste fuer Plugin-Dropdowns
    fastify.get('/email/accounts/list', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
        const accounts = await db('email_accounts')
            .select('id', 'name', 'from_address', 'is_default')
            .orderBy('name', 'asc');
        return reply.send(accounts);
    });

    // GET /api/admin/email/accounts/:id - Einzelnes Konto
    fastify.get('/email/accounts/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const account = await db('email_accounts').where('id', id).first();
        if (!account) return reply.status(404).send({ error: 'Konto nicht gefunden' });
        account.smtp_password = account.smtp_password ? '••••••' : null;
        return reply.send(account);
    });

    // POST /api/admin/email/accounts - Neues Konto erstellen
    fastify.post('/email/accounts', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const body = request.body as Record<string, any>;

        // Pflichtfeld
        if (!body.name?.trim()) {
            return reply.status(400).send({ error: 'Name ist erforderlich' });
        }

        // Passwort verschluesseln
        let password = body.smtp_password || null;
        if (password) {
            password = encrypt(password);
        }

        // Falls is_default, alle anderen zuruecksetzen
        if (body.is_default) {
            await db('email_accounts').update({ is_default: false });
        }

        const [id] = await db('email_accounts').insert({
            name: body.name.trim(),
            provider: body.provider || 'smtp',
            smtp_host: body.smtp_host || null,
            smtp_port: body.smtp_port ? parseInt(String(body.smtp_port), 10) : 587,
            smtp_user: body.smtp_user || null,
            smtp_password: password,
            smtp_secure: body.smtp_secure !== false,
            from_address: body.from_address || null,
            from_name: body.from_name || null,
            is_default: !!body.is_default,
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

    // PUT /api/admin/email/accounts/:id - Konto bearbeiten
    fastify.put('/email/accounts/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as Record<string, any>;

        const existing = await db('email_accounts').where('id', id).first();
        if (!existing) return reply.status(404).send({ error: 'Konto nicht gefunden' });

        // Passwort: maskiertes nicht ueberschreiben
        let password = existing.smtp_password;
        if (body.smtp_password && body.smtp_password !== '••••••') {
            password = encrypt(body.smtp_password);
        }

        // Falls is_default, alle anderen zuruecksetzen
        if (body.is_default) {
            await db('email_accounts').where('id', '!=', id).update({ is_default: false });
        }

        await db('email_accounts').where('id', id).update({
            name: body.name?.trim() || existing.name,
            provider: body.provider || existing.provider,
            smtp_host: body.smtp_host ?? existing.smtp_host,
            smtp_port: body.smtp_port ? parseInt(String(body.smtp_port), 10) : existing.smtp_port,
            smtp_user: body.smtp_user ?? existing.smtp_user,
            smtp_password: password,
            smtp_secure: body.smtp_secure !== undefined ? body.smtp_secure !== false : existing.smtp_secure,
            from_address: body.from_address ?? existing.from_address,
            from_name: body.from_name ?? existing.from_name,
            is_default: body.is_default !== undefined ? !!body.is_default : existing.is_default,
            updated_at: new Date(),
        });

        await fastify.audit.log({
            action: 'email.account.updated',
            category: 'admin',
            entityType: 'email_accounts',
            entityId: parseInt(id, 10),
            newState: { name: body.name, provider: body.provider },
        }, request);

        return reply.send({ success: true });
    });

    // DELETE /api/admin/email/accounts/:id - Konto loeschen
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

    // POST /api/admin/email/accounts/:id/test - Test-Mail senden
    fastify.post('/email/accounts/:id/test', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const { to } = request.body as { to?: string };

        if (!to) {
            return reply.status(400).send({ error: 'Empfaenger-Adresse (to) ist erforderlich' });
        }

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

    // Legacy-Kompatibilitaet: alte Settings-Routen weiterleiten
    fastify.get('/email/settings', { preHandler: [fastify.authenticate] }, async (_request, reply) => {
        const accounts = await db('email_accounts').orderBy('is_default', 'desc').first();
        if (!accounts) {
            return reply.send({ provider: 'none' });
        }
        return reply.send({
            provider: accounts.provider,
            smtp_host: accounts.smtp_host,
            smtp_port: String(accounts.smtp_port || 587),
            smtp_user: accounts.smtp_user,
            smtp_password: accounts.smtp_password ? '••••••' : '',
            smtp_secure: String(accounts.smtp_secure),
            from_address: accounts.from_address,
            from_name: accounts.from_name,
        });
    });
}

export default fp(emailPlugin, { name: 'emailService' });
