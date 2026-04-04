import crypto from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
    loadAccountingConnectorSettings,
    normalizeIncomingEventType,
} from '../core/accountingConnectorSettings.js';

type AccountingEventPayload = {
    event_id?: unknown;
    event_type?: unknown;
    occurred_at?: unknown;
    [key: string]: unknown;
};

function readHeader(request: FastifyRequest, headerName: string): string {
    const value = request.headers[headerName.toLowerCase()];
    if (Array.isArray(value)) return String(value[0] || '').trim();
    return String(value || '').trim();
}

function constantTimeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
}

function normalizePositiveInt(value: number, fallback: number): number {
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.round(value);
}

function asRawBodyBuffer(body: unknown): Buffer {
    if (Buffer.isBuffer(body)) return body;
    if (typeof body === 'string') return Buffer.from(body, 'utf8');
    if (body === null || body === undefined) return Buffer.from('', 'utf8');
    return Buffer.from(JSON.stringify(body), 'utf8');
}

function parseIsoTimestamp(value: string): number | null {
    const timestampMs = Date.parse(value);
    if (!Number.isFinite(timestampMs)) return null;
    return timestampMs;
}

function parseSignature(headerValue: string): string | null {
    const match = /^v1=([a-fA-F0-9]{64})$/.exec(headerValue);
    return match ? match[1].toLowerCase() : null;
}

export default async function accountingConnectorRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.addContentTypeParser(
        /^application\/(?:json|[a-zA-Z0-9!#$&^_.+-]+\+json)(?:;|$)/,
        { parseAs: 'buffer' },
        (request, body, done) => {
            done(null, body);
        },
    );

    fastify.post('/events', {
        bodyLimit: 10 * 1024 * 1024,
        config: {
            policy: { public: true },
            rateLimit: { max: 60, timeWindow: '1 minute' },
        },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const runtimeConfig = await loadAccountingConnectorSettings(fastify.db);
        const apiKeyHeaderLookup = runtimeConfig.apiKeyHeaderName.toLowerCase();
        const expectedApiKey = runtimeConfig.apiKey;
        const expectedHmacSecret = runtimeConfig.hmacSecret;
        const timestampToleranceSec = normalizePositiveInt(runtimeConfig.timestampToleranceSec, 300);
        const nonceTtlSec = normalizePositiveInt(runtimeConfig.nonceTtlSec, 300);

        if (!runtimeConfig.enabled) {
            return reply.status(503).send({ ok: false, error: 'Connector disabled' });
        }

        if (!expectedApiKey || !expectedHmacSecret) {
            request.log.error('Accounting-Connector nicht konfiguriert: API-Key oder HMAC-Secret fehlt');
            return reply.status(503).send({ ok: false, error: 'Connector not configured' });
        }

        const apiKey = readHeader(request, apiKeyHeaderLookup);
        if (!apiKey || !constantTimeEqual(apiKey, expectedApiKey)) {
            return reply.status(401).send({ ok: false, error: 'Invalid API key' });
        }

        const timestampHeader = readHeader(request, 'x-hammer-timestamp');
        const nonceHeader = readHeader(request, 'x-hammer-nonce');
        const bodyShaHeader = readHeader(request, 'x-hammer-body-sha256').toLowerCase();
        const signatureHeader = readHeader(request, 'x-hammer-signature');
        const signatureAlgHeader = readHeader(request, 'x-hammer-signature-alg').toLowerCase();
        const eventIdHeader = readHeader(request, 'x-hammer-event-id');

        if (!timestampHeader || !nonceHeader || !bodyShaHeader || !signatureHeader) {
            return reply.status(400).send({ ok: false, error: 'Missing security headers' });
        }

        if (nonceHeader.length > 255) {
            return reply.status(400).send({ ok: false, error: 'Invalid nonce' });
        }

        if (signatureAlgHeader && signatureAlgHeader !== 'hmac-sha256') {
            return reply.status(401).send({ ok: false, error: 'Unsupported signature algorithm' });
        }

        if (!/^[a-f0-9]{64}$/.test(bodyShaHeader)) {
            return reply.status(400).send({ ok: false, error: 'Invalid body hash format' });
        }

        const signatureHex = parseSignature(signatureHeader);
        if (!signatureHex) {
            return reply.status(401).send({ ok: false, error: 'Invalid signature format' });
        }

        const timestampMs = parseIsoTimestamp(timestampHeader);
        if (timestampMs === null) {
            return reply.status(400).send({ ok: false, error: 'Invalid timestamp' });
        }
        const nowMs = Date.now();
        const driftSec = Math.abs(nowMs - timestampMs) / 1000;
        if (driftSec > timestampToleranceSec) {
            return reply.status(401).send({ ok: false, error: 'Timestamp outside allowed window' });
        }

        const rawBody = asRawBodyBuffer(request.body);
        if (rawBody.length > runtimeConfig.maxPayloadBytes) {
            return reply.status(413).send({ ok: false, error: 'Payload too large' });
        }
        const calculatedBodySha = crypto.createHash('sha256').update(rawBody).digest('hex');
        if (!constantTimeEqual(calculatedBodySha, bodyShaHeader)) {
            return reply.status(401).send({ ok: false, error: 'Body hash mismatch' });
        }

        const expectedSignature = crypto
            .createHmac('sha256', expectedHmacSecret)
            .update(`${timestampHeader}.${nonceHeader}.${calculatedBodySha}`, 'utf8')
            .digest('hex');

        if (!constantTimeEqual(expectedSignature, signatureHex)) {
            return reply.status(401).send({ ok: false, error: 'Invalid signature' });
        }

        let payload: AccountingEventPayload;
        try {
            payload = JSON.parse(rawBody.toString('utf8')) as AccountingEventPayload;
        } catch {
            return reply.status(400).send({ ok: false, error: 'Invalid JSON body' });
        }

        const payloadEventId = String(payload?.event_id || '').trim();
        const eventType = String(payload?.event_type || '').trim();
        const normalizedEventType = normalizeIncomingEventType(eventType);
        const eventId = payloadEventId || eventIdHeader;

        if (!eventId || !eventType) {
            return reply.status(400).send({ ok: false, error: 'event_id und event_type sind erforderlich' });
        }

        if (eventIdHeader && payloadEventId && eventIdHeader !== payloadEventId) {
            return reply.status(400).send({ ok: false, error: 'event_id header/body mismatch' });
        }
        if (runtimeConfig.allowedEventTypes.length > 0 && !runtimeConfig.allowedEventTypes.includes(normalizedEventType)) {
            return reply.status(202).send({
                ok: true,
                event_id: eventId,
                status: 'ignored_event_type',
            });
        }

        const db = fastify.db;
        const now = new Date();
        const nonceCutoff = new Date(now.getTime() - (nonceTtlSec * 1000));

        let isDuplicateEvent = false;

        try {
            await db.transaction(async (trx) => {
                await trx('accounting_connector_nonces')
                    .where('seen_at', '<', nonceCutoff)
                    .delete();

                try {
                    await trx('accounting_connector_nonces').insert({
                        nonce: nonceHeader,
                        event_id: eventId,
                        seen_at: now,
                    });
                } catch (error: any) {
                    if (error?.code === 'ER_DUP_ENTRY') {
                        throw new Error('REPLAY_NONCE');
                    }
                    throw error;
                }

                const existing = await trx('accounting_connector_events')
                    .where({ event_id: eventId })
                    .first('id');

                if (existing) {
                    await trx('accounting_connector_events')
                        .where({ id: existing.id })
                        .update({
                            last_seen_at: now,
                            duplicate_count: db.raw('duplicate_count + 1'),
                        });
                    isDuplicateEvent = true;
                    return;
                }

                await trx('accounting_connector_events').insert({
                    event_id: eventId,
                    event_type: eventType,
                    nonce: nonceHeader,
                    timestamp_header: timestampHeader,
                    body_sha256: calculatedBodySha,
                    payload_json: JSON.stringify(payload),
                    status: 'processed',
                    source_ip: request.ip || null,
                    processed_at: now,
                    last_seen_at: now,
                    created_at: now,
                    duplicate_count: 0,
                });
            });
        } catch (error: any) {
            if (error?.message === 'REPLAY_NONCE') {
                return reply.status(409).send({ ok: false, error: 'Replay erkannt (Nonce bereits verwendet)' });
            }
            if (error?.code === 'ER_DUP_ENTRY') {
                isDuplicateEvent = true;
            } else {
                request.log.error({ err: error }, 'Accounting-Event konnte nicht gespeichert werden');
                return reply.status(500).send({ ok: false, error: 'Internal error while processing event' });
            }
        }

        if (isDuplicateEvent) {
            return reply.status(200).send({
                ok: true,
                event_id: eventId,
                status: 'already_processed',
            });
        }

        await fastify.audit.log({
            action: 'accounting.connector.event.received',
            category: 'data',
            entityType: 'accounting_event',
            entityId: eventId,
            newState: {
                eventType,
                occurredAt: typeof payload?.occurred_at === 'string' ? payload.occurred_at : null,
            },
            tenantId: null,
        }, request);

        await fastify.events.emit({
            event: 'accounting.connector.event.received',
            data: {
                eventId,
                eventType,
                payload,
            },
            tenantId: null,
        });

        return reply.status(202).send({
            ok: true,
            event_id: eventId,
            status: 'processed',
        });
    });
}
