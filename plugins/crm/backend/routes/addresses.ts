import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../../backend/src/core/database.js';
import { requirePermission } from '../../../../backend/src/core/permissions.js';

const ADDRESS_TYPES = ['main', 'billing', 'shipping', 'branch', 'custom'] as const;

const TYPE_LABELS: Record<string, string> = {
    main: 'Kundenanschrift',
    billing: 'Rechnungsadresse',
    shipping: 'Lieferadresse',
    branch: 'Niederlassung',
    custom: 'Sonstige',
};

export default async function addressRoutes(fastify: FastifyInstance): Promise<void> {



    // ══════════════════════════════════════════
    // GET / — Adressen eines Kunden (oder alle)
    // ══════════════════════════════════════════
    fastify.get('/', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { customer_id, type } = request.query as { customer_id?: string; type?: string };

        let query = db('crm_addresses')
            .where('crm_addresses.tenant_id', user.tenantId)
            .orderBy('address_type', 'asc')
            .orderBy('is_default', 'desc')
            .orderBy('created_at', 'asc');

        if (customer_id) {
            query = query.where('customer_id', parseInt(customer_id));
        }

        if (type && ADDRESS_TYPES.includes(type as any)) {
            query = query.where('address_type', type);
        }

        const addresses = await query.select('*');

        // Label hinzufügen
        const enriched = addresses.map((a: any) => ({
            ...a,
            type_label: a.address_type === 'custom' && a.custom_label
                ? a.custom_label
                : TYPE_LABELS[a.address_type] || a.address_type,
        }));

        return reply.send({ addresses: enriched, typeLabels: TYPE_LABELS });
    });

    // ══════════════════════════════════════════
    // GET /:id — Einzelne Adresse
    // ══════════════════════════════════════════
    fastify.get('/:id', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };

        const address = await db('crm_addresses')
            .where({ id, tenant_id: user.tenantId })
            .first();

        if (!address) {
            return reply.status(404).send({ error: 'Adresse nicht gefunden' });
        }

        return reply.send(address);
    });

    // ══════════════════════════════════════════
    // POST / — Neue Adresse erstellen
    // ══════════════════════════════════════════
    fastify.post('/', { preHandler: [requirePermission('crm.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const body = request.body as any;

        if (!body.customer_id) {
            return reply.status(400).send({ error: 'customer_id ist erforderlich' });
        }

        const addressType = body.address_type || 'main';
        if (!ADDRESS_TYPES.includes(addressType)) {
            return reply.status(400).send({ error: `Ungültiger Adresstyp. Erlaubt: ${ADDRESS_TYPES.join(', ')}` });
        }

        // Kunde validieren
        const customer = await db('crm_customers')
            .where({ id: body.customer_id, tenant_id: user.tenantId })
            .first();
        if (!customer) {
            return reply.status(404).send({ error: 'Kunde nicht gefunden' });
        }

        // Main-Adresse: max 1 pro Kunde
        if (addressType === 'main') {
            const existingMain = await db('crm_addresses')
                .where({ customer_id: body.customer_id, tenant_id: user.tenantId, address_type: 'main' })
                .first();
            if (existingMain) {
                return reply.status(409).send({ error: 'Es existiert bereits eine Kundenanschrift. Bitte diese bearbeiten statt eine neue zu erstellen.' });
            }
        }

        // Falls is_default gesetzt, alle anderen des gleichen Typs zuruecksetzen
        if (body.is_default) {
            await db('crm_addresses')
                .where({ customer_id: body.customer_id, tenant_id: user.tenantId, address_type: addressType })
                .update({ is_default: false });
        }

        const insertData: any = {
            tenant_id: user.tenantId,
            customer_id: body.customer_id,
            address_type: addressType,
            custom_label: addressType === 'custom' || addressType === 'branch' ? (body.custom_label?.trim() || null) : null,
            is_default: body.is_default || false,
            company_name: body.company_name?.trim() || null,
            recipient: body.recipient?.trim() || null,
            street: body.street?.trim() || null,
            street2: body.street2?.trim() || null,
            zip: body.zip?.trim() || null,
            city: body.city?.trim() || null,
            state: body.state?.trim() || null,
            country: body.country?.trim() || 'Deutschland',
            notes: body.notes?.trim() || null,
            created_by: user.userId,
            created_at: new Date(),
            updated_at: new Date(),
        };

        const [id] = await db('crm_addresses').insert(insertData);
        const address = await db('crm_addresses').where('id', id).first();

        // Audit
        await fastify.audit.log({
            action: 'crm.address.created',
            category: 'plugin',
            entityType: 'crm_addresses',
            entityId: String(id),
            newState: { address_type: addressType, city: body.city, customer_id: body.customer_id },
            pluginId: 'crm',
        }, request);

        return reply.status(201).send(address);
    });

    // ══════════════════════════════════════════
    // PUT /:id — Adresse aktualisieren
    // ══════════════════════════════════════════
    fastify.put('/:id', { preHandler: [requirePermission('crm.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };
        const body = request.body as any;

        const existing = await db('crm_addresses')
            .where({ id, tenant_id: user.tenantId })
            .first();

        if (!existing) {
            return reply.status(404).send({ error: 'Adresse nicht gefunden' });
        }

        const update: any = { updated_at: new Date() };
        const fields = ['company_name', 'recipient', 'street', 'street2', 'zip', 'city', 'state', 'country', 'notes', 'custom_label'];
        for (const field of fields) {
            if (body[field] !== undefined) {
                update[field] = typeof body[field] === 'string' ? body[field].trim() || null : body[field];
            }
        }

        if (body.is_default !== undefined) {
            update.is_default = body.is_default;
            // Falls default gesetzt, andere des gleichen Typs zuruecksetzen
            if (body.is_default) {
                await db('crm_addresses')
                    .where({ customer_id: existing.customer_id, tenant_id: user.tenantId, address_type: existing.address_type })
                    .whereNot('id', id)
                    .update({ is_default: false });
            }
        }

        await db('crm_addresses').where('id', id).update(update);
        const address = await db('crm_addresses').where('id', id).first();

        await fastify.audit.log({
            action: 'crm.address.updated',
            category: 'plugin',
            entityType: 'crm_addresses',
            entityId: String(id),
            previousState: { city: existing.city, street: existing.street },
            newState: update,
            pluginId: 'crm',
        }, request);

        return reply.send(address);
    });

    // ══════════════════════════════════════════
    // DELETE /:id — Adresse löschen
    // ══════════════════════════════════════════
    fastify.delete('/:id', { preHandler: [requirePermission('crm.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };

        const existing = await db('crm_addresses')
            .where({ id, tenant_id: user.tenantId })
            .first();

        if (!existing) {
            return reply.status(404).send({ error: 'Adresse nicht gefunden' });
        }

        await db('crm_addresses').where('id', id).delete();

        await fastify.audit.log({
            action: 'crm.address.deleted',
            category: 'plugin',
            entityType: 'crm_addresses',
            entityId: String(id),
            previousState: { address_type: existing.address_type, city: existing.city, customer_id: existing.customer_id },
            pluginId: 'crm',
        }, request);

        return reply.send({ success: true });
    });
}
