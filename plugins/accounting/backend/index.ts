import { createHash } from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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

            // Accounting Events für diesen Kunden abrufen
            const events = await db('accounting_connector_events')
                .whereIn('event_type', [
                    'document.finalized',
                    'document.created',
                    'document.storno',
                    'document.payment_status_changed'
                ])
                .andWhere(function customerFilter(this: any) {
                    this.whereIn(db.raw("JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.customer.id'))"), identifiers)
                        .orWhereIn(db.raw("JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.customer.customer_number'))"), identifiers);
                })
                .orderBy('created_at', 'desc')
                .select('event_id', 'payload_json', 'created_at');

            const documents: AccountingDocument[] = [];

            for (const event of events) {
                try {
                    const payload = JSON.parse(event.payload_json);

                    if (payload.document_category && payload.document) {
                        const doc: AccountingDocument = {
                            id: payload.document_id || event.event_id,
                            eventId: event.event_id,
                            documentCategory: payload.document_category,
                            documentId: payload.document_id || '',
                            documentNumber: payload.document_number || '',
                            documentStatus: payload.document_status || '',
                            amountTotal: payload.amount_total || 0,
                            currency: payload.currency || 'EUR',
                            paymentStatus: payload.payment_status || '',
                            amountPaid: payload.amount_paid || 0,
                            amountOpen: payload.amount_open || 0,
                            documentDate: payload.document_date || '',
                            dueDate: payload.due_date || null,
                            paidAt: payload.paid_at || null,
                            finalizedAt: payload.finalized_at || null,
                            createdAt: event.created_at,
                        };
                        documents.push(doc);
                    }
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
            const identifiers = await resolveAccountingCustomerIdentifiers(db, Number(session.tenant_id), Number(session.customer_id));
            if (identifiers.length === 0) {
                return reply.status(404).send({ error: 'Customer not found' });
            }

            // Neuestes Customer-Event für diesen Kunden abrufen
            const event = await db('accounting_connector_events')
                .where('event_type', 'customer.updated')
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
