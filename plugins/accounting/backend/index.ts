import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../../backend/src/core/config.js';
import { getDatabase } from '../../../backend/src/core/database.js';

interface AccountingDocument {
    id: string;
    eventId: string;
    documentCategory: string;
    documentId: string;
    documentNumber: string;
    documentStatus: string;
    amountTotal: number;
    currency: string;
    paymentStatus: string;
    amountPaid: number;
    amountOpen: number;
    documentDate: string;
    dueDate: string | null;
    paidAt: string | null;
    finalizedAt: string | null;
    createdAt: string;
    hasPdf?: boolean;
}

interface AccountingConnectorDocumentRow {
    record_key: string;
    event_id: string;
    document_category: string;
    document_id: string;
    document_number: string | null;
    document_status: string | null;
    amount_total: number | string | null;
    currency: string | null;
    payment_status: string | null;
    amount_paid: number | string | null;
    amount_open: number | string | null;
    document_date: string | null;
    due_date: string | null;
    paid_at: string | null;
    finalized_at: string | null;
    pdf_storage_path: string | null;
    updated_at: string | null;
    created_at: string | null;
}

interface CustomerData {
    id: number;
    name: string;
    customerNumber: string;
    address: string;
    kind: string;
    contactPerson: string | null;
    email: string | null;
}

type PublicSessionRecord = {
    id: number;
    tenant_id: number;
    customer_id: number;
    expires_at: string;
    revoked_at: string | null;
};

function hashValue(value: string): string {
    return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function asNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function asText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeDocumentCategory(input: unknown, eventType: string): string {
    const raw = asText(input).toLowerCase();
    const et = asText(eventType).toLowerCase();

    const candidates = [raw, et];
    for (const value of candidates) {
        if (!value) continue;
        if (value.includes('rechnung') || value.includes('invoice')) return 'rechnung';
        if (value.includes('angebot') || value.includes('offer') || value.includes('quote')) return 'angebot';
        if (value.includes('gutschrift') || value.includes('credit')) return 'gutschrift';
        if (value.includes('storno') || value.includes('cancel')) return 'storno';
        if (value.includes('mahnung') || value.includes('dunn')) return 'mahnung';
    }

    return raw || 'rechnung';
}

function extractDocumentFromPayload(payload: any, event: any): AccountingDocument | null {
    const document = payload?.document && typeof payload.document === 'object' ? payload.document : {};
    const eventType = asText(event?.event_type);

    const category = normalizeDocumentCategory(
        payload?.document_category ?? document?.category ?? document?.typ,
        eventType,
    );

    const documentId = asText(payload?.document_id ?? document?.id);
    const documentNumber = asText(payload?.document_number ?? document?.nummer ?? document?.number);
    const documentStatus = asText(payload?.document_status ?? document?.status);

    // Relevantes Dokument erkennen, auch wenn nur verschachteltes legacy payload vorhanden ist.
    if (!documentId && !documentNumber && !documentStatus && !asText(payload?.document_category) && !asText(document?.id)) {
        return null;
    }

    const amountTotal = asNumber(payload?.amount_total ?? document?.betrag_brutto ?? document?.amount_total, 0);
    const amountPaid = asNumber(payload?.amount_paid ?? document?.betrag_bezahlt ?? document?.amount_paid, 0);
    const explicitOpen = payload?.amount_open ?? document?.betrag_offen ?? document?.amount_open;
    const amountOpen = explicitOpen !== undefined && explicitOpen !== null
        ? asNumber(explicitOpen, 0)
        : Math.max(0, amountTotal - amountPaid);

    return {
        id: documentId || asText(event?.event_id),
        eventId: asText(event?.event_id),
        documentCategory: category,
        documentId,
        documentNumber,
        documentStatus,
        amountTotal,
        currency: asText(payload?.currency ?? document?.waehrung ?? document?.currency) || 'EUR',
        paymentStatus: asText(payload?.payment_status ?? document?.payment_status ?? document?.zahlstatus),
        amountPaid,
        amountOpen,
        documentDate: asText(payload?.document_date ?? document?.datum),
        dueDate: asText(payload?.due_date ?? document?.faellig_am) || null,
        paidAt: asText(payload?.paid_at ?? document?.bezahlt_am) || null,
        finalizedAt: asText(payload?.finalized_at ?? document?.finalisiert_am) || null,
        createdAt: String(event?.created_at || ''),
    };
}

function mapConnectorRowToDocument(row: AccountingConnectorDocumentRow): AccountingDocument {
    return {
        id: asText(row.record_key) || asText(row.event_id) || asText(row.document_id),
        eventId: asText(row.event_id),
        documentCategory: asText(row.document_category),
        documentId: asText(row.document_id),
        documentNumber: asText(row.document_number),
        documentStatus: asText(row.document_status),
        amountTotal: asNumber(row.amount_total, 0),
        currency: asText(row.currency) || 'EUR',
        paymentStatus: asText(row.payment_status),
        amountPaid: asNumber(row.amount_paid, 0),
        amountOpen: asNumber(row.amount_open, 0),
        documentDate: asText(row.document_date),
        dueDate: asText(row.due_date) || null,
        paidAt: asText(row.paid_at) || null,
        finalizedAt: asText(row.finalized_at) || null,
        createdAt: String(row.updated_at || row.created_at || ''),
        hasPdf: Boolean(asText(row.pdf_storage_path)),
    };
}

function formatCrmAddress(input: { street?: unknown; zip?: unknown; city?: unknown; country?: unknown }): string {
    const street = asText(input.street);
    const zip = asText(input.zip);
    const city = asText(input.city);
    const country = asText(input.country);

    const lines: string[] = [];
    if (street) lines.push(street);
    const zipCity = [zip, city].filter(Boolean).join(' ').trim();
    if (zipCity) lines.push(zipCity);
    if (country) lines.push(country);
    return lines.join('\n');
}

async function resolveCustomerFromCrm(
    db: any,
    tenantId: number,
    vpCustomerId: number,
): Promise<CustomerData | null> {
    const hasVpCustomers = await db.schema.hasTable('vp_customers').catch(() => false);
    const hasCrmCustomers = await db.schema.hasTable('crm_customers').catch(() => false);
    if (!hasVpCustomers || !hasCrmCustomers) return null;

    const vpCustomer = await db('vp_customers')
        .where({ tenant_id: tenantId, id: vpCustomerId })
        .first('crm_customer_id');
    const crmCustomerId = Number(vpCustomer?.crm_customer_id || 0);
    if (!Number.isInteger(crmCustomerId) || crmCustomerId <= 0) return null;

    const crmCustomer = await db('crm_customers')
        .where({ tenant_id: tenantId, id: crmCustomerId })
        .first(
            'id',
            'type',
            'customer_number',
            'company_name',
            'first_name',
            'last_name',
            'email',
            'street',
            'zip',
            'city',
            'country',
        );
    if (!crmCustomer) return null;

    const hasCrmAddresses = await db.schema.hasTable('crm_addresses').catch(() => false);
    const mainAddress = hasCrmAddresses
        ? await db('crm_addresses')
            .where({ tenant_id: tenantId, customer_id: crmCustomerId, address_type: 'main' })
            .orderBy('is_default', 'desc')
            .orderBy('id', 'asc')
            .first('street', 'zip', 'city', 'country')
        : null;

    const firstName = asText(crmCustomer.first_name);
    const lastName = asText(crmCustomer.last_name);
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const companyName = asText(crmCustomer.company_name);
    const name = companyName || fullName || `Kunde #${crmCustomerId}`;
    const contactPerson = fullName || null;
    const address = formatCrmAddress(mainAddress || crmCustomer);

    return {
        id: Number(crmCustomer.id),
        name,
        customerNumber: asText(crmCustomer.customer_number),
        address,
        kind: asText(crmCustomer.type),
        contactPerson,
        email: asText(crmCustomer.email) || null,
    };
}

function resolveAccountingPdfPath(relativePath: string): string {
    const uploadsRoot = path.resolve(config.app.uploadsDir);
    const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const absolutePath = path.resolve(uploadsRoot, normalized);
    const rootWithSeparator = `${uploadsRoot}${path.sep}`;
    if (absolutePath !== uploadsRoot && !absolutePath.startsWith(rootWithSeparator)) {
        throw new Error('Ungültiger PDF-Pfad');
    }
    return absolutePath;
}

async function verifyPublicSessionByToken(db: any, token: string): Promise<PublicSessionRecord | null> {
    const tokenHash = hashValue(token);
    const legacyDoubleHash = hashValue(tokenHash);
    const row = await db('vp_public_sessions')
        .whereIn('token_hash', [tokenHash, legacyDoubleHash])
        .whereNull('revoked_at')
        .andWhere('expires_at', '>=', db.fn.now())
        .first('id', 'tenant_id', 'customer_id', 'expires_at', 'revoked_at');
    return (row as PublicSessionRecord) || null;
}

async function resolveAccountingCustomerIdentifiers(
    db: any,
    tenantId: number,
    vpCustomerId: number,
): Promise<string[]> {
    const ids = new Set<string>();
    ids.add(String(vpCustomerId));

    const vpCustomer = await db('vp_customers')
        .where({ tenant_id: tenantId, id: vpCustomerId })
        .first('crm_customer_id');

    const crmCustomerId = Number(vpCustomer?.crm_customer_id || 0);
    if (crmCustomerId > 0) {
        ids.add(String(crmCustomerId));
        const crmCustomer = await db('crm_customers')
            .where({ tenant_id: tenantId, id: crmCustomerId })
            .first('customer_number');
        const customerNumber = String(crmCustomer?.customer_number || '').trim();
        if (customerNumber) ids.add(customerNumber);
    }

    return Array.from(ids).filter(Boolean);
}

export default async function accountingRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();
    console.log('[Accounting] Plugin geladen');

    // GET /api/plugins/accounting/documents - Dokumente für einen Kunden
    fastify.get('/documents', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as { sessionToken?: string };
        const sessionToken = String(query?.sessionToken || '').trim();
        if (!sessionToken) {
            return reply.status(400).send({ error: 'Session-Token ist erforderlich' });
        }

        try {
            const session = await verifyPublicSessionByToken(db, sessionToken);
            if (!session) {
                return reply.status(401).send({ error: 'Session ungültig oder abgelaufen' });
            }

            const identifiers = await resolveAccountingCustomerIdentifiers(db, Number(session.tenant_id), Number(session.customer_id));
            if (identifiers.length === 0) {
                return reply.send({ documents: [] });
            }

            const hasProjectionTable = await db.schema.hasTable('accounting_connector_documents').catch(() => false);
            if (hasProjectionTable) {
                const rows = await db('accounting_connector_documents')
                    .where('tenant_id', Number(session.tenant_id))
                    .whereIn('document_category', ['rechnung', 'angebot', 'mahnung', 'gutschrift', 'storno'])
                    .andWhere(function customerFilter(this: any) {
                        this.whereIn('customer_id', identifiers)
                            .orWhereIn('customer_number', identifiers)
                            .orWhereIn('entity_id', identifiers);
                    })
                    .orderBy('updated_at', 'desc')
                    .select(
                        'record_key',
                        'event_id',
                        'document_category',
                        'document_id',
                        'document_number',
                        'document_status',
                        'amount_total',
                        'currency',
                        'payment_status',
                        'amount_paid',
                        'amount_open',
                        'document_date',
                        'due_date',
                        'paid_at',
                        'finalized_at',
                        'pdf_storage_path',
                        'updated_at',
                        'created_at',
                    ) as AccountingConnectorDocumentRow[];

                return reply.send({
                    documents: rows.map(mapConnectorRowToDocument),
                });
            }

            // Dokument-Events fuer den Kunden abrufen (neues und legacy Payload-Format).
            const events = await db('accounting_connector_events')
                .andWhere(function customerFilter(this: any) {
                    this.whereIn(db.raw("JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.customer.id'))"), identifiers)
                        .orWhereIn(db.raw("JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.customer.customer_number'))"), identifiers);
                })
                .andWhere(function documentPayloadFilter(this: any) {
                    this.whereNotNull(db.raw("JSON_EXTRACT(payload_json, '$.document')"))
                        .orWhereNotNull(db.raw("JSON_EXTRACT(payload_json, '$.document_id')"))
                        .orWhereNotNull(db.raw("JSON_EXTRACT(payload_json, '$.document_category')"));
                })
                .orderBy('created_at', 'desc')
                .select('event_id', 'event_type', 'payload_json', 'created_at');

            const documents: AccountingDocument[] = [];

            for (const event of events) {
                try {
                    const payload = JSON.parse(event.payload_json);
                    const doc = extractDocumentFromPayload(payload, event);
                    if (doc) documents.push(doc);
                } catch (parseError) {
                    console.error('Error parsing accounting event payload:', parseError);
                }
            }

            return reply.send({ documents });
        } catch (error) {
            console.error('Error fetching accounting documents:', error);
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });

    // GET /api/plugins/accounting/documents/:documentRecordId/pdf - PDF Download
    fastify.get('/documents/:documentRecordId/pdf', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as { sessionToken?: string };
        const params = request.params as { documentRecordId?: string };
        const sessionToken = String(query?.sessionToken || '').trim();
        const documentRecordId = String(params?.documentRecordId || '').trim();

        if (!sessionToken) {
            return reply.status(400).send({ error: 'Session-Token ist erforderlich' });
        }
        if (!documentRecordId) {
            return reply.status(400).send({ error: 'Dokument-ID ist erforderlich' });
        }

        try {
            const hasProjectionTable = await db.schema.hasTable('accounting_connector_documents').catch(() => false);
            if (!hasProjectionTable) {
                return reply.status(404).send({ error: 'Dokument-PDF nicht verfügbar' });
            }

            const session = await verifyPublicSessionByToken(db, sessionToken);
            if (!session) {
                return reply.status(401).send({ error: 'Session ungültig oder abgelaufen' });
            }

            const identifiers = await resolveAccountingCustomerIdentifiers(
                db,
                Number(session.tenant_id),
                Number(session.customer_id),
            );
            if (identifiers.length === 0) {
                return reply.status(404).send({ error: 'Dokument nicht gefunden' });
            }

            const row = await db('accounting_connector_documents')
                .where({ record_key: documentRecordId })
                .where('tenant_id', Number(session.tenant_id))
                .whereIn('document_category', ['rechnung', 'angebot', 'mahnung', 'gutschrift', 'storno'])
                .andWhere(function customerFilter(this: any) {
                    this.whereIn('customer_id', identifiers)
                        .orWhereIn('customer_number', identifiers)
                        .orWhereIn('entity_id', identifiers);
                })
                .first('pdf_storage_path', 'pdf_file_name');

            if (!row?.pdf_storage_path) {
                return reply.status(404).send({ error: 'PDF nicht gefunden' });
            }

            const absolutePath = resolveAccountingPdfPath(String(row.pdf_storage_path));
            await stat(absolutePath);

            const fileName = asText(row.pdf_file_name) || 'dokument.pdf';
            const encodedName = encodeURIComponent(fileName)
                .replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
                .replace(/\*/g, '%2A');

            reply
                .header('Content-Type', 'application/pdf')
                .header('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
                .header('Cache-Control', 'private, max-age=0, must-revalidate');

            return reply.send(createReadStream(absolutePath));
        } catch (error) {
            console.error('Error downloading accounting PDF:', error);
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });

    // GET /api/plugins/accounting/customer - Kundendaten
    fastify.get('/customer', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as { sessionToken?: string };
        const sessionToken = String(query?.sessionToken || '').trim();
        if (!sessionToken) {
            return reply.status(400).send({ error: 'Session-Token ist erforderlich' });
        }

        try {
            const session = await verifyPublicSessionByToken(db, sessionToken);
            if (!session) {
                return reply.status(401).send({ error: 'Session ungültig oder abgelaufen' });
            }

            const crmCustomer = await resolveCustomerFromCrm(
                db,
                Number(session.tenant_id),
                Number(session.customer_id),
            );
            if (crmCustomer) {
                return reply.send({ customer: crmCustomer });
            }

            const identifiers = await resolveAccountingCustomerIdentifiers(db, Number(session.tenant_id), Number(session.customer_id));
            if (identifiers.length === 0) {
                return reply.status(404).send({ error: 'Customer not found' });
            }

            const hasProjectionTable = await db.schema.hasTable('accounting_connector_documents').catch(() => false);
            if (hasProjectionTable) {
                const customerRecord = await db('accounting_connector_documents')
                    .where('tenant_id', Number(session.tenant_id))
                    .where('document_category', 'customer')
                    .andWhere(function customerFilter(this: any) {
                        this.whereIn('customer_id', identifiers)
                            .orWhereIn('customer_number', identifiers)
                            .orWhereIn('entity_id', identifiers);
                    })
                    .orderBy('updated_at', 'desc')
                    .select('payload_json')
                    .first();

                if (customerRecord?.payload_json) {
                    const payload = JSON.parse(String(customerRecord.payload_json || '{}'));
                    if (payload?.customer && typeof payload.customer === 'object') {
                        const customer: CustomerData = {
                            id: Number(payload.customer.id || 0),
                            name: payload.customer.name || '',
                            customerNumber: payload.customer.customer_number || '',
                            address: payload.customer.address || '',
                            kind: payload.customer.kind || '',
                            contactPerson: payload.customer.contact_person || null,
                            email: payload.customer.email || null,
                        };
                        return reply.send({ customer });
                    }
                }
            }

            // Neuestes Customer-Event fuer diesen Kunden abrufen.
            const event = await db('accounting_connector_events')
                .whereIn('event_type', ['customer.updated', 'customer.created', 'customer.exported'])
                .andWhere(function customerFilter(this: any) {
                    this.whereIn(db.raw("JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.customer.id'))"), identifiers)
                        .orWhereIn(db.raw("JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.customer.customer_number'))"), identifiers);
                })
                .orderBy('created_at', 'desc')
                .select('payload_json')
                .first();

            if (!event) {
                return reply.status(404).send({ error: 'Customer not found' });
            }

            const payload = JSON.parse(event.payload_json);
            const customer: CustomerData = {
                id: payload.customer.id,
                name: payload.customer.name || '',
                customerNumber: payload.customer.customer_number || '',
                address: payload.customer.address || '',
                kind: payload.customer.kind || '',
                contactPerson: payload.customer.contact_person || null,
                email: payload.customer.email || null,
            };

            return reply.send({ customer });
        } catch (error) {
            console.error('Error fetching customer data:', error);
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
