import crypto from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../core/config.js';
import {
    loadAccountingConnectorSettings,
    normalizeIncomingEventType,
} from '../core/accountingConnectorSettings.js';

type AccountingEventPayload = {
    event_id?: unknown;
    event_type?: unknown;
    occurred_at?: unknown;
    details?: unknown;
    [key: string]: unknown;
};

type AccountingDocumentCategory = 'rechnung' | 'angebot' | 'mahnung' | 'gutschrift' | 'storno' | 'customer';

type ParsedPdf = {
    fileName: string;
    sha256: string;
    buffer: Buffer;
};

type ParsedAccountingEvent = {
    source: string;
    category: AccountingDocumentCategory;
    documentId: string;
    recordKey: string;
    documentNumber: string | null;
    documentStatus: string | null;
    paymentStatus: string | null;
    amountTotal: number | null;
    amountPaid: number | null;
    amountOpen: number | null;
    currency: string | null;
    documentDate: string | null;
    dueDate: string | null;
    paidAt: string | null;
    finalizedAt: string | null;
    entityId: string | null;
    customerId: string | null;
    customerNumber: string | null;
    sourceInvoiceId: string | null;
    relatedInvoiceId: string | null;
    sourceCreditId: string | null;
    eventTypeOriginal: string | null;
    pdf: ParsedPdf | null;
};

class ProcessingHttpError extends Error {
    statusCode: number;

    constructor(statusCode: number, message: string) {
        super(message);
        this.statusCode = statusCode;
    }
}

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

function asText(value: unknown): string {
    return String(value ?? '').trim();
}

function asOptionalText(value: unknown): string | null {
    const normalized = asText(value);
    return normalized ? normalized : null;
}

function asNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
}

function normalizeCategory(value: unknown): AccountingDocumentCategory | null {
    const raw = asText(value).toLowerCase();
    if (!raw) return null;

    if (raw === 'rechnung' || raw === 'invoice') return 'rechnung';
    if (raw === 'angebot' || raw === 'offer' || raw === 'quote') return 'angebot';
    if (raw === 'mahnung' || raw === 'dunning' || raw === 'reminder') return 'mahnung';
    if (raw === 'gutschrift' || raw === 'credit' || raw === 'credit_note') return 'gutschrift';
    if (raw === 'storno' || raw === 'cancel' || raw === 'cancellation') return 'storno';
    if (raw === 'customer' || raw === 'kunde') return 'customer';

    return null;
}

function normalizeSource(value: unknown): string {
    const raw = asText(value).toLowerCase();
    if (!raw) return 'hammer';
    return raw.slice(0, 120);
}

function sanitizeFileName(fileName: string): string {
    const clean = fileName.replace(/[\\/:*?"<>|]+/g, '_').trim();
    return clean || 'document.pdf';
}

function sanitizePathSegment(input: string): string {
    const safe = input.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
    return safe || 'unknown';
}

function decodeBase64Strict(input: string): Buffer | null {
    const normalized = input.replace(/\s+/g, '');
    if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
        return null;
    }

    try {
        const decoded = Buffer.from(normalized, 'base64');
        if (decoded.length === 0) return null;
        const check = decoded.toString('base64').replace(/=+$/g, '');
        const expected = normalized.replace(/=+$/g, '');
        return check === expected ? decoded : null;
    } catch {
        return null;
    }
}

async function storePdfFile(parsed: ParsedAccountingEvent): Promise<string | null> {
    if (!parsed.pdf) return null;

    const targetDir = path.resolve(
        config.app.uploadsDir,
        'accounting-connector',
        sanitizePathSegment(parsed.source),
        sanitizePathSegment(parsed.category),
        sanitizePathSegment(parsed.documentId),
    );
    await mkdir(targetDir, { recursive: true });

    const absolutePath = path.join(targetDir, parsed.pdf.fileName);
    await writeFile(absolutePath, parsed.pdf.buffer);

    return path.relative(config.app.uploadsDir, absolutePath).replace(/\\/g, '/');
}

function parseIncomingAccountingPayload(payload: AccountingEventPayload): ParsedAccountingEvent {
    const document = payload?.document && typeof payload.document === 'object' ? payload.document as Record<string, unknown> : {};
    const details = payload?.details && typeof payload.details === 'object' ? payload.details as Record<string, unknown> : {};
    const customer = payload?.customer && typeof payload.customer === 'object' ? payload.customer as Record<string, unknown> : {};

    const category = normalizeCategory(payload?.document_category ?? document?.category ?? document?.typ);
    if (!category) {
        throw new ProcessingHttpError(422, 'Ungültige oder fehlende document_category');
    }

    const source = normalizeSource(payload?.source ?? details?.source);
    const entityId = asOptionalText(payload?.entity_id ?? payload?.entityId ?? customer?.id ?? payload?.customer_id);
    const customerId = asOptionalText(customer?.id ?? payload?.customer_id ?? entityId);
    const customerNumber = asOptionalText(customer?.customer_number ?? payload?.customer_number);

    let documentId = asText(payload?.document_id ?? document?.id);
    if (category === 'customer') {
        documentId = entityId || customerId || '';
        if (!documentId) {
            throw new ProcessingHttpError(422, 'Für customer-Events ist entity_id oder customer.id erforderlich');
        }
    } else if (!documentId) {
        throw new ProcessingHttpError(422, 'document_id ist für Dokument-Events erforderlich');
    }

    const documentNumber = asOptionalText(payload?.document_number ?? document?.nummer ?? document?.number);
    const documentStatus = asOptionalText(payload?.document_status ?? document?.status);
    const paymentStatus = asOptionalText(payload?.payment_status ?? document?.payment_status ?? document?.zahlstatus);

    const amountTotal = asNumberOrNull(payload?.amount_total ?? document?.betrag_brutto ?? document?.amount_total);
    const amountPaid = asNumberOrNull(payload?.amount_paid ?? document?.betrag_bezahlt ?? document?.amount_paid);
    const explicitAmountOpen = payload?.amount_open ?? document?.betrag_offen ?? document?.amount_open;
    let amountOpen = asNumberOrNull(explicitAmountOpen);
    if (amountOpen === null && amountTotal !== null) {
        amountOpen = Math.max(0, amountTotal - (amountPaid ?? 0));
    }

    let parsedPdf: ParsedPdf | null = null;
    if (category !== 'customer') {
        const documentPdf = payload?.document_pdf;
        if (!documentPdf || typeof documentPdf !== 'object') {
            throw new ProcessingHttpError(422, 'document_pdf ist für Dokument-Events erforderlich');
        }

        const pdfRecord = documentPdf as Record<string, unknown>;
        const contentBase64 = asText(pdfRecord.content_base64);
        const declaredSha = asText(pdfRecord.sha256).toLowerCase();
        const fileName = sanitizeFileName(asText(pdfRecord.filename));

        if (!contentBase64 || !declaredSha || !fileName) {
            throw new ProcessingHttpError(422, 'document_pdf.content_base64, sha256 und filename sind erforderlich');
        }

        if (!/^[a-f0-9]{64}$/.test(declaredSha)) {
            throw new ProcessingHttpError(422, 'document_pdf.sha256 muss ein SHA256-Hash sein');
        }

        const decoded = decodeBase64Strict(contentBase64);
        if (!decoded) {
            throw new ProcessingHttpError(422, 'document_pdf.content_base64 ist ungültig');
        }

        const actualSha = crypto.createHash('sha256').update(decoded).digest('hex');
        if (!constantTimeEqual(actualSha, declaredSha)) {
            throw new ProcessingHttpError(422, 'document_pdf sha256 mismatch');
        }

        parsedPdf = {
            fileName,
            sha256: declaredSha,
            buffer: decoded,
        };
    }

    return {
        source,
        category,
        documentId,
        recordKey: `${source}:${category}:${documentId}`,
        documentNumber,
        documentStatus,
        paymentStatus,
        amountTotal,
        amountPaid,
        amountOpen,
        currency: asOptionalText(payload?.currency ?? document?.waehrung ?? document?.currency),
        documentDate: asOptionalText(payload?.document_date ?? document?.datum),
        dueDate: asOptionalText(payload?.due_date ?? document?.faellig_am),
        paidAt: asOptionalText(payload?.paid_at ?? document?.bezahlt_am),
        finalizedAt: asOptionalText(payload?.finalized_at ?? document?.finalisiert_am),
        entityId,
        customerId,
        customerNumber,
        sourceInvoiceId: asOptionalText(details?.source_invoice_id),
        relatedInvoiceId: asOptionalText(details?.related_invoice_id),
        sourceCreditId: asOptionalText(details?.source_credit_id),
        eventTypeOriginal: asOptionalText(details?.event_type_original),
        pdf: parsedPdf,
    };
}

async function upsertAccountingDocumentRecord(args: {
    trx: any;
    eventId: string;
    eventType: string;
    payload: AccountingEventPayload;
    parsed: ParsedAccountingEvent;
    pdfStoragePath: string | null;
}): Promise<void> {
    const {
        trx,
        eventId,
        eventType,
        payload,
        parsed,
        pdfStoragePath,
    } = args;

    const now = new Date();

    const baseRow = {
        source: parsed.source,
        document_category: parsed.category,
        document_id: parsed.documentId,
        document_number: parsed.documentNumber,
        event_id: eventId,
        event_type: eventType,
        event_type_original: parsed.eventTypeOriginal,
        document_status: parsed.documentStatus,
        payment_status: parsed.paymentStatus,
        amount_total: parsed.amountTotal,
        amount_paid: parsed.amountPaid,
        amount_open: parsed.amountOpen,
        currency: parsed.currency,
        document_date: parsed.documentDate,
        due_date: parsed.dueDate,
        paid_at: parsed.paidAt,
        finalized_at: parsed.finalizedAt,
        entity_id: parsed.entityId,
        customer_id: parsed.customerId,
        customer_number: parsed.customerNumber,
        source_invoice_id: parsed.sourceInvoiceId,
        related_invoice_id: parsed.relatedInvoiceId,
        source_credit_id: parsed.sourceCreditId,
        pdf_file_name: parsed.pdf?.fileName || null,
        pdf_sha256: parsed.pdf?.sha256 || null,
        pdf_storage_path: pdfStoragePath,
        payload_json: JSON.stringify(payload),
        updated_at: now,
    };

    const existing = await trx('accounting_connector_documents')
        .where({ record_key: parsed.recordKey })
        .first('id');

    if (existing?.id) {
        await trx('accounting_connector_documents')
            .where({ id: existing.id })
            .update(baseRow);
        return;
    }

    await trx('accounting_connector_documents').insert({
        record_key: parsed.recordKey,
        ...baseRow,
        created_at: now,
    });
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

        const apiKeyCandidates = [
            readHeader(request, 'x-hammer-api-key'),
            readHeader(request, runtimeConfig.apiKeyHeaderName),
            readHeader(request, 'x-api-key'),
        ].map((value) => value.trim()).filter(Boolean);
        const apiKey = apiKeyCandidates[0] || '';
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

        let parsedPayload: ParsedAccountingEvent;
        try {
            parsedPayload = parseIncomingAccountingPayload(payload);
        } catch (error: any) {
            if (error instanceof ProcessingHttpError) {
                return reply.status(error.statusCode).send({ ok: false, error: error.message });
            }
            request.log.error({ err: error }, 'Accounting-Event Payload konnte nicht geparst werden');
            return reply.status(500).send({ ok: false, error: 'Internal error while parsing event payload' });
        }

        const db = fastify.db;
        const hasProjectionTable = await db.schema.hasTable('accounting_connector_documents').catch(() => false);
        if (!hasProjectionTable) {
            request.log.error('Accounting-Connector Dokument-Projection-Tabelle fehlt (Migration 019 nicht ausgeführt)');
            return reply.status(503).send({ ok: false, error: 'Connector storage not ready (migration missing)' });
        }
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

                const pdfStoragePath = await storePdfFile(parsedPayload);
                await upsertAccountingDocumentRecord({
                    trx,
                    eventId,
                    eventType,
                    payload,
                    parsed: parsedPayload,
                    pdfStoragePath,
                });

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
                eventTypeOriginal: parsedPayload.eventTypeOriginal,
                documentCategory: parsedPayload.category,
                documentId: parsedPayload.documentId,
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
