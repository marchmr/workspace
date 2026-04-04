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

export default async function accountingRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();
    console.log('[Accounting] Plugin geladen');

    // GET /api/plugins/accounting/documents - Dokumente für einen Kunden
    fastify.get('/documents', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as { customerId?: string };
        const customerId = query.customerId;

        if (!customerId || isNaN(Number(customerId))) {
            return reply.status(400).send({ error: 'Invalid customerId' });
        }

        try {
            // Accounting Events für diesen Kunden abrufen
            const events = await db('accounting_connector_events')
                .whereRaw("JSON_EXTRACT(payload_json, '$.customer.id') = ?", [customerId])
                .whereIn('event_type', [
                    'document.finalized',
                    'document.created',
                    'document.storno',
                    'document.payment_status_changed'
                ])
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
    fastify.get('/customer', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as { customerId?: string };
        const customerId = query.customerId;

        if (!customerId || isNaN(Number(customerId))) {
            return reply.status(400).send({ error: 'Invalid customerId' });
        }

        try {
            // Neuestes Customer-Event für diesen Kunden abrufen
            const event = await db('accounting_connector_events')
                .whereRaw("JSON_EXTRACT(payload_json, '$.customer.id') = ?", [customerId])
                .where('event_type', 'customer.updated')
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
