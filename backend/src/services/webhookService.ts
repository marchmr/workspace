import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { getDatabase } from '../core/database.js';
import { encrypt, decrypt } from '../core/encryption.js';
import { config } from '../core/config.js';
import crypto from 'crypto';
import dns from 'dns';
import { isIP, isIPv4 } from 'net';

interface WebhookRecord {
    id: number;
    name: string;
    url: string;
    secret: string;
    events: string;
    is_active: boolean;
    tenant_id: number | null;
}

function signPayload(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Prueft ob eine aufgeloeste IP-Adresse privat/intern ist (DNS-Rebinding-Schutz)
function isPrivateIP(ip: string): boolean {
    // IPv4 private/loopback/link-local/CGNAT/metadata
    if (isIPv4(ip)) {
        const parts = ip.split('.').map(Number);
        if (parts[0] === 127) return true;                           // 127.0.0.0/8
        if (parts[0] === 10) return true;                            // 10.0.0.0/8
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
        if (parts[0] === 192 && parts[1] === 168) return true;      // 192.168.0.0/16
        if (parts[0] === 169 && parts[1] === 254) return true;      // Link-local / Cloud Metadata
        if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT
        if (parts[0] === 0) return true;                             // 0.0.0.0/8
    }
    // IPv6 private/loopback/link-local
    const lower = ip.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;  // ULA
    if (lower.startsWith('fe80')) return true;                          // Link-local
    return false;
}

// SSRF-Schutz: Nur sichere externe URLs erlauben
function isAllowedWebhookUrl(url: string): { allowed: boolean; reason?: string } {
    try {
        const parsed = new URL(url);

        // HTTPS erzwingen in Produktion (Finding #2)
        if (config.server.env === 'production' && parsed.protocol !== 'https:') {
            return { allowed: false, reason: 'In Produktion sind nur HTTPS-URLs erlaubt' };
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return { allowed: false, reason: 'Nur HTTP(S)-URLs sind erlaubt' };
        }

        const hostname = parsed.hostname.toLowerCase();

        // Localhost und Loopback blocken
        if (['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]'].includes(hostname)) {
            return { allowed: false, reason: 'Localhost-URLs sind nicht erlaubt' };
        }

        // Private/Interne IP-Bereiche blocken
        const privateRanges = [
            /^10\./,                          // 10.0.0.0/8
            /^172\.(1[6-9]|2\d|3[01])\./,    // 172.16.0.0/12
            /^192\.168\./,                    // 192.168.0.0/16
            /^169\.254\./,                    // Link-local / Cloud Metadata
            /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT 100.64.0.0/10
            /^fc/i, /^fd/i, /^fe80/i,         // IPv6 private
        ];

        if (privateRanges.some((r) => r.test(hostname))) {
            return { allowed: false, reason: 'Interne/Private IP-Adressen sind nicht erlaubt' };
        }

        // Metadata-Endpoints von Cloud-Providern blocken
        if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
            return { allowed: false, reason: 'Cloud-Metadata-Endpoints sind nicht erlaubt' };
        }

        return { allowed: true };
    } catch {
        return { allowed: false, reason: 'Ungültige URL' };
    }
}

async function deliverWebhook(webhook: WebhookRecord, event: string, data: any): Promise<void> {
    const db = getDatabase();
    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data });

    // Secret entschlüsseln für HMAC-Signierung
    let plainSecret: string;
    try {
        plainSecret = decrypt(webhook.secret);
    } catch {
        plainSecret = webhook.secret; // Fallback für alte unverschlüsselte Secrets
    }
    const signature = signPayload(body, plainSecret);
    const startTime = Date.now();

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        // DNS-Rebinding-Schutz (Finding #1): IP nach DNS-Aufloesung pruefen
        const targetHostname = new URL(webhook.url).hostname;
        if (!isIP(targetHostname)) {
            try {
                const { address } = await dns.promises.lookup(targetHostname);
                if (isPrivateIP(address)) {
                    console.warn(`[Webhooks] DNS-Rebinding blockiert: ${targetHostname} -> ${address}`);
                    await db('webhook_logs').insert({
                        webhook_id: webhook.id,
                        event,
                        payload: body,
                        status_code: 0,
                        response_body: `DNS-Rebinding blockiert: ${targetHostname} aufgeloest zu privater IP ${address}`,
                        response_time_ms: 0,
                        created_at: new Date(),
                    });
                    return;
                }
            } catch {
                // DNS-Fehler: Webhook trotzdem nicht ausfuehren
                return;
            }
        }

        const response = await fetch(webhook.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': `sha256=${signature}`,
                'X-Webhook-Event': event,
            },
            body,
            signal: controller.signal,
        });

        clearTimeout(timeout);

        const responseBody = await response.text().catch(() => '');

        await db('webhook_logs').insert({
            webhook_id: webhook.id,
            event,
            payload: body,
            status_code: response.status,
            response_body: responseBody.substring(0, 2000),
            duration_ms: Date.now() - startTime,
            created_at: new Date(),
        });
    } catch (error: any) {
        await db('webhook_logs').insert({
            webhook_id: webhook.id,
            event,
            payload: body,
            error: error.message || 'Unknown error',
            duration_ms: Date.now() - startTime,
            created_at: new Date(),
        });
        console.error(`[Webhooks] Delivery-Fehler fuer '${webhook.name}':`, error.message);
    }
}

async function webhookPlugin(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    // Listen on ALL events via wildcard
    fastify.events.on('*', async (payload, meta) => {
        try {
            // Tenant-Isolation: Nur Webhooks des gleichen Mandanten oder globale (tenant_id=NULL)
            const query = db('webhooks').where('is_active', true);
            if (meta.tenantId) {
                query.andWhere((qb) => {
                    qb.where('tenant_id', meta.tenantId).orWhereNull('tenant_id');
                });
            }
            const webhooks = await query;

            for (const webhook of webhooks) {
                const events: string[] = JSON.parse(webhook.events || '[]');
                // Match exact or wildcard prefix (e.g. 'user.*' matches 'user.created')
                const matches = events.some((pattern: string) => {
                    if (pattern === '*') return true;
                    if (pattern === meta.event) return true;
                    if (pattern.endsWith('.*')) {
                        const prefix = pattern.slice(0, -2);
                        return meta.event.startsWith(prefix + '.');
                    }
                    return false;
                });

                if (matches) {
                    // Fire and forget – keine internen Metadaten an externe URLs senden
                    deliverWebhook(webhook, meta.event, payload).catch(() => { });
                }
            }
        } catch (error) {
            console.error('[Webhooks] Event-Listener-Fehler:', error);
        }
    });

    console.log('[Webhooks] Event-Listener initialisiert');
}

// Admin-Routen fuer Webhook-Verwaltung (ohne fp! damit prefix funktioniert)
export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();
    const { scopedQuery, scopedInsert } = await import('../core/tenantScope.js');

    // CRUD endpoints for webhook management
    const requirePermission = (perm: string) => async (request: any, reply: any) => {
        await fastify.authenticate(request, reply);
        const perms: string[] = request.user?.permissions || [];
        if (!perms.includes('*') && !perms.includes(perm)) {
            return reply.status(403).send({ error: 'Keine Berechtigung' });
        }
    };

    // GET /api/admin/webhooks
    fastify.get('/', { preHandler: [requirePermission('webhooks.manage')] }, async (request, reply) => {
        const webhooks = await scopedQuery(db('webhooks'), request).orderBy('created_at', 'desc');
        return reply.send(webhooks.map((w: any) => ({
            ...w,
            events: JSON.parse(w.events || '[]'),
            secret: '••••••',
        })));
    });

    // POST /api/admin/webhooks
    fastify.post('/', { preHandler: [requirePermission('webhooks.manage')] }, async (request, reply) => {
        const { name, url, events, secret } = request.body as {
            name: string; url: string; events: string[]; secret?: string;
        };

        if (!name || !url || !events?.length) {
            return reply.status(400).send({ error: 'Name, URL und Events sind erforderlich' });
        }

        // SSRF-Schutz: URL validieren
        const urlCheck = isAllowedWebhookUrl(url);
        if (!urlCheck.allowed) {
            return reply.status(400).send({ error: `URL nicht erlaubt: ${urlCheck.reason}` });
        }

        const webhookSecret = secret || crypto.randomBytes(32).toString('hex');

        const [id] = await db('webhooks').insert(scopedInsert({
            name,
            url,
            secret: encrypt(webhookSecret),
            events: JSON.stringify(events),
            is_active: true,
            created_by: request.user.userId,
            created_at: new Date(),
            updated_at: new Date(),
        }, request));

        await fastify.events.emit({ event: 'webhook.created', data: { webhookId: id, name }, request });

        return reply.status(201).send({ id, secret: webhookSecret });
    });

    // PUT /api/admin/webhooks/:id
    fastify.put('/:id', { preHandler: [requirePermission('webhooks.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const { name, url, events, is_active } = request.body as {
            name?: string; url?: string; events?: string[]; is_active?: boolean;
        };

        // SSRF-Schutz bei URL-Änderung
        if (url !== undefined) {
            const urlCheck = isAllowedWebhookUrl(url);
            if (!urlCheck.allowed) {
                return reply.status(400).send({ error: `URL nicht erlaubt: ${urlCheck.reason}` });
            }
        }

        const updates: Record<string, any> = { updated_at: new Date() };
        if (name !== undefined) updates.name = name;
        if (url !== undefined) updates.url = url;
        if (events !== undefined) updates.events = JSON.stringify(events);
        if (is_active !== undefined) updates.is_active = is_active;

        const updated = await scopedQuery(db('webhooks'), request).where('id', id).update(updates);
        if (!updated) return reply.status(404).send({ error: 'Webhook nicht gefunden' });
        return reply.send({ success: true });
    });

    // DELETE /api/admin/webhooks/:id
    fastify.delete('/:id', { preHandler: [requirePermission('webhooks.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const webhook = await scopedQuery(db('webhooks'), request).where('id', id).first();
        if (!webhook) return reply.status(404).send({ error: 'Webhook nicht gefunden' });
        await db('webhook_logs').where('webhook_id', id).delete();
        await db('webhooks').where('id', id).delete();
        return reply.send({ success: true });
    });

    // GET /api/admin/webhooks/:id/logs
    fastify.get('/:id/logs', { preHandler: [requirePermission('webhooks.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const webhook = await scopedQuery(db('webhooks'), request).where('id', id).first();
        if (!webhook) return reply.status(404).send({ error: 'Webhook nicht gefunden' });
        const logs = await db('webhook_logs')
            .where('webhook_id', id)
            .orderBy('created_at', 'desc')
            .limit(50);
        return reply.send(logs);
    });

    // POST /api/admin/webhooks/:id/test
    fastify.post('/:id/test', { preHandler: [requirePermission('webhooks.manage')] }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const webhook = await scopedQuery(db('webhooks'), request).where('id', id).first();
        if (!webhook) return reply.status(404).send({ error: 'Webhook nicht gefunden' });

        await deliverWebhook(webhook, 'test.ping', {
            message: 'Dies ist ein Test-Event',
            timestamp: new Date().toISOString(),
        });

        return reply.send({ success: true, message: 'Test-Event gesendet' });
    });
}

export default fp(webhookPlugin, { name: 'webhookService', dependencies: ['eventBus'] });
