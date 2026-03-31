import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../backend/src/core/database.js';
import { requirePermission } from '../../../backend/src/core/permissions.js';
import https from 'https';
import http from 'http';

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

interface QuicklinkBody {
    url: string;
    title: string;
    category?: string;
    sort_order?: number;
}

/* ════════════════════════════════════════════
   Favicon Fetcher (Server-seitig, DSGVO-konform)
   ════════════════════════════════════════════ */

async function fetchFavicon(urlStr: string): Promise<string | null> {
    try {
        const parsed = new URL(urlStr);
        const faviconUrl = `${parsed.protocol}//${parsed.host}/favicon.ico`;

        return await new Promise<string | null>((resolve) => {
            const client = faviconUrl.startsWith('https') ? https : http;
            const req = client.get(faviconUrl, { timeout: 5000 }, (res) => {
                // Redirect-Handling
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    resolve(null); // Einfachheitshalber bei Redirect abbrechen
                    res.destroy();
                    return;
                }

                if (res.statusCode !== 200) {
                    resolve(null);
                    res.destroy();
                    return;
                }

                const contentType = res.headers['content-type'] || 'image/x-icon';
                const chunks: Buffer[] = [];
                let totalSize = 0;
                const MAX_SIZE = 256 * 1024; // Max 256KB

                res.on('data', (chunk: Buffer) => {
                    totalSize += chunk.length;
                    if (totalSize > MAX_SIZE) {
                        resolve(null);
                        res.destroy();
                        return;
                    }
                    chunks.push(chunk);
                });

                res.on('end', () => {
                    if (chunks.length === 0) {
                        resolve(null);
                        return;
                    }
                    const buffer = Buffer.concat(chunks);
                    const base64 = buffer.toString('base64');
                    const mimeType = contentType.split(';')[0].trim();
                    resolve(`data:${mimeType};base64,${base64}`);
                });

                res.on('error', () => resolve(null));
            });

            req.on('error', () => resolve(null));
            req.on('timeout', () => {
                req.destroy();
                resolve(null);
            });
        });
    } catch {
        return null;
    }
}

/* ════════════════════════════════════════════
   Plugin Routes
   ════════════════════════════════════════════ */

export default async function plugin(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    // ─── GET / — Alle Links (mandantenweit + eigene persoenliche) ───
    fastify.get('/', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const tenantId = (request.user as any).tenantId;

        const tenantLinks = await db('plugin_quicklinks')
            .where({ tenant_id: tenantId, scope: 'tenant' })
            .orderBy('category', 'asc')
            .orderBy('sort_order', 'asc')
            .orderBy('title', 'asc')
            .select('*');

        const personalLinks = await db('plugin_quicklinks')
            .where({ user_id: userId, scope: 'personal' })
            .orderBy('category', 'asc')
            .orderBy('sort_order', 'asc')
            .orderBy('title', 'asc')
            .select('*');

        return reply.send({ tenantLinks, personalLinks });
    });

    // ─── GET /tenant — Nur Mandanten-Links ───
    fastify.get('/tenant', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;

        const links = await db('plugin_quicklinks')
            .where({ tenant_id: tenantId, scope: 'tenant' })
            .orderBy('category', 'asc')
            .orderBy('sort_order', 'asc')
            .orderBy('title', 'asc')
            .select('*');

        return reply.send({ links });
    });

    // ─── GET /personal — Nur persoenliche Links ───
    fastify.get('/personal', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;

        const links = await db('plugin_quicklinks')
            .where({ user_id: userId, scope: 'personal' })
            .orderBy('category', 'asc')
            .orderBy('sort_order', 'asc')
            .orderBy('title', 'asc')
            .select('*');

        return reply.send({ links });
    });

    // ─── POST / — Persoenlichen Link erstellen ───
    fastify.post('/', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const tenantId = (request.user as any).tenantId;
        const body = request.body as QuicklinkBody;

        if (!body.url || !body.url.trim()) {
            return reply.status(400).send({ error: 'URL ist erforderlich' });
        }
        if (!body.title || !body.title.trim()) {
            return reply.status(400).send({ error: 'Titel ist erforderlich' });
        }

        // URL normalisieren
        let url = body.url.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        // Favicon laden
        const favicon = await fetchFavicon(url);

        const maxSort = await db('plugin_quicklinks')
            .where({ user_id: userId, scope: 'personal' })
            .max('sort_order as max')
            .first();

        const [id] = await db('plugin_quicklinks').insert({
            url,
            title: body.title.trim(),
            category: (body.category || 'Allgemein').trim(),
            favicon_base64: favicon,
            scope: 'personal',
            user_id: userId,
            tenant_id: tenantId,
            sort_order: (maxSort?.max || 0) + 1,
        });

        const item = await db('plugin_quicklinks').where('id', id).first();

        await fastify.audit.log({
            action: 'quicklinks.personal.created',
            category: 'plugin',
            entityType: 'plugin_quicklinks',
            entityId: String(id),
            newState: { title: body.title, url },
        }, request);

        return reply.status(201).send({ item });
    });

    // ─── POST /tenant — Mandanten-Link erstellen (Admin) ───
    fastify.post('/tenant', { preHandler: [requirePermission('quicklinks.manage')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const userId = (request.user as any).userId;
        const body = request.body as QuicklinkBody;

        if (!body.url || !body.url.trim()) {
            return reply.status(400).send({ error: 'URL ist erforderlich' });
        }
        if (!body.title || !body.title.trim()) {
            return reply.status(400).send({ error: 'Titel ist erforderlich' });
        }

        let url = body.url.trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        const favicon = await fetchFavicon(url);

        const maxSort = await db('plugin_quicklinks')
            .where({ tenant_id: tenantId, scope: 'tenant' })
            .max('sort_order as max')
            .first();

        const [id] = await db('plugin_quicklinks').insert({
            url,
            title: body.title.trim(),
            category: (body.category || 'Allgemein').trim(),
            favicon_base64: favicon,
            scope: 'tenant',
            user_id: userId,
            tenant_id: tenantId,
            sort_order: (maxSort?.max || 0) + 1,
        });

        const item = await db('plugin_quicklinks').where('id', id).first();

        await fastify.audit.log({
            action: 'quicklinks.tenant.created',
            category: 'plugin',
            entityType: 'plugin_quicklinks',
            entityId: String(id),
            newState: { title: body.title, url, scope: 'tenant' },
        }, request);

        return reply.status(201).send({ item });
    });

    // ─── PUT /:id — Link aktualisieren ───
    fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const userId = (request.user as any).userId;
        const body = request.body as Partial<QuicklinkBody>;

        const existing = await db('plugin_quicklinks').where('id', id).first();
        if (!existing) {
            return reply.status(404).send({ error: 'Link nicht gefunden' });
        }

        // Berechtigung pruefen: eigener Link oder Admin fuer Tenant-Links
        if (existing.scope === 'personal' && existing.user_id !== userId) {
            return reply.status(403).send({ error: 'Keine Berechtigung' });
        }
        if (existing.scope === 'tenant') {
            const permissions: string[] = (request.user as any)?.permissions || [];
            const canManage = permissions.includes('*') || permissions.includes('quicklinks.manage');
            if (!canManage) {
                return reply.status(403).send({ error: 'Keine Berechtigung' });
            }
        }

        const update: Record<string, any> = { updated_at: new Date() };

        if (body.title !== undefined) update.title = body.title.trim();
        if (body.category !== undefined) update.category = body.category.trim() || 'Allgemein';
        if (body.sort_order !== undefined) update.sort_order = body.sort_order;

        if (body.url !== undefined) {
            let url = body.url.trim();
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            update.url = url;
            // Neues Favicon laden bei URL-Aenderung
            update.favicon_base64 = await fetchFavicon(url);
        }

        await db('plugin_quicklinks').where('id', id).update(update);
        const item = await db('plugin_quicklinks').where('id', id).first();

        await fastify.audit.log({
            action: 'quicklinks.updated',
            category: 'plugin',
            entityType: 'plugin_quicklinks',
            entityId: String(id),
            previousState: { title: existing.title, url: existing.url },
            newState: update,
        }, request);

        return reply.send({ item });
    });

    // ─── DELETE /:id — Link loeschen ───
    fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const userId = (request.user as any).userId;

        const existing = await db('plugin_quicklinks').where('id', id).first();
        if (!existing) {
            return reply.status(404).send({ error: 'Link nicht gefunden' });
        }

        if (existing.scope === 'personal' && existing.user_id !== userId) {
            return reply.status(403).send({ error: 'Keine Berechtigung' });
        }
        if (existing.scope === 'tenant') {
            const permissions: string[] = (request.user as any)?.permissions || [];
            const canManage = permissions.includes('*') || permissions.includes('quicklinks.manage');
            if (!canManage) {
                return reply.status(403).send({ error: 'Keine Berechtigung' });
            }
        }

        await db('plugin_quicklinks').where('id', id).delete();

        await fastify.audit.log({
            action: 'quicklinks.deleted',
            category: 'plugin',
            entityType: 'plugin_quicklinks',
            entityId: String(id),
            previousState: { title: existing.title, url: existing.url, scope: existing.scope },
        }, request);

        return reply.send({ success: true });
    });

    // ─── GET /categories — Verfuegbare Kategorien ───
    fastify.get('/categories', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as any).userId;
        const tenantId = (request.user as any).tenantId;

        const categories = await db('plugin_quicklinks')
            .where(function () {
                this.where({ tenant_id: tenantId, scope: 'tenant' })
                    .orWhere({ user_id: userId, scope: 'personal' });
            })
            .distinct('category')
            .orderBy('category', 'asc')
            .pluck('category');

        return reply.send({ categories });
    });

    // ─── GET /search — Fuer GlobalSearch ───
    fastify.get('/search', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { q } = request.query as { q?: string };
        const userId = (request.user as any).userId;
        const tenantId = (request.user as any).tenantId;

        if (!q || q.length < 2) return reply.send({ results: [] });

        const results = await db('plugin_quicklinks')
            .where(function () {
                this.where({ tenant_id: tenantId, scope: 'tenant' })
                    .orWhere({ user_id: userId, scope: 'personal' });
            })
            .andWhere(function () {
                this.where('title', 'like', `%${q}%`)
                    .orWhere('url', 'like', `%${q}%`)
                    .orWhere('category', 'like', `%${q}%`);
            })
            .orderBy('title', 'asc')
            .limit(10)
            .select('id', 'title', 'url', 'category', 'scope', 'favicon_base64');

        return reply.send({ results });
    });

    // ─── GET /favicon — Favicon neu laden (manuell) ───
    fastify.get('/favicon', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { url } = request.query as { url?: string };
        if (!url) return reply.status(400).send({ error: 'URL erforderlich' });

        const favicon = await fetchFavicon(url);
        return reply.send({ favicon });
    });
}
