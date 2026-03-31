import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../../backend/src/core/database.js';
import { requirePermission } from '../../../../backend/src/core/permissions.js';

export default async function contactRoutes(fastify: FastifyInstance): Promise<void> {


    // ══════════════════════════════════════════
    // GET / — Kontakte eines Kunden
    // ══════════════════════════════════════════
    fastify.get('/', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { customer_id } = request.query as { customer_id?: string };

        let query = db('crm_contacts')
            .leftJoin('crm_contact_categories', 'crm_contacts.category_id', 'crm_contact_categories.id')
            .where('crm_contacts.tenant_id', user.tenantId)
            .orderBy('crm_contacts.is_primary', 'desc')
            .orderBy('crm_contacts.last_name', 'asc');

        if (customer_id) {
            query = query.where('crm_contacts.customer_id', parseInt(customer_id));
        }

        const contacts = await query.select(
            'crm_contacts.*',
            'crm_contact_categories.name as category_name',
            'crm_contact_categories.color as category_color'
        );
        return reply.send({ contacts });
    });

    // ══════════════════════════════════════════
    // GET /:id — Einzelner Kontakt
    // ══════════════════════════════════════════
    fastify.get('/:id', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };

        const contact = await db('crm_contacts')
            .where({ id, tenant_id: user.tenantId })
            .first();

        if (!contact) return reply.status(404).send({ error: 'Kontakt nicht gefunden' });
        return reply.send(contact);
    });

    // ══════════════════════════════════════════
    // POST / — Neuer Kontakt
    // ══════════════════════════════════════════
    fastify.post('/', { preHandler: [requirePermission('crm.contacts.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const body = request.body as any;

        if (!body.last_name?.trim()) {
            return reply.status(400).send({ error: 'Nachname ist erforderlich' });
        }
        if (!body.customer_id) {
            return reply.status(400).send({ error: 'Kunde ist erforderlich' });
        }

        // Prüfen ob Kunde existiert und zum Mandanten gehoert
        const customer = await db('crm_customers').where({ id: body.customer_id, tenant_id: user.tenantId }).first();
        if (!customer) return reply.status(404).send({ error: 'Kunde nicht gefunden' });

        // Falls is_primary: alle anderen auf false setzen
        if (body.is_primary) {
            await db('crm_contacts')
                .where({ customer_id: body.customer_id, tenant_id: user.tenantId })
                .update({ is_primary: false });
        }

        const [id] = await db('crm_contacts').insert({
            tenant_id: user.tenantId,
            customer_id: body.customer_id,
            salutation: body.salutation || null,
            first_name: body.first_name?.trim() || null,
            last_name: body.last_name.trim(),
            position: body.position?.trim() || null,
            department: body.department?.trim() || null,
            email: body.email?.trim() || null,
            phone: body.phone?.trim() || null,
            mobile: body.mobile?.trim() || null,
            is_primary: body.is_primary || false,
            is_billing_contact: body.is_billing_contact || false,
            category_id: body.category_id || null,
            notes: body.notes || null,
            custom_fields: body.custom_fields ? JSON.stringify(body.custom_fields) : null,
            created_by: user.userId,
            created_at: new Date(),
            updated_at: new Date(),
        });

        // Aktivität loggen
        await db('crm_activities').insert({
            tenant_id: user.tenantId,
            customer_id: body.customer_id,
            entity_type: 'contact',
            entity_id: id,
            type: 'contact.created',
            title: `Kontakt ${body.first_name || ''} ${body.last_name} hinzugefügt`,
            created_by: user.userId,
            created_at: new Date(),
        });

        return reply.status(201).send({ id });
    });

    // ══════════════════════════════════════════
    // PUT /:id — Kontakt aktualisieren
    // ══════════════════════════════════════════
    fastify.put('/:id', { preHandler: [requirePermission('crm.contacts.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };
        const body = request.body as any;

        const contact = await db('crm_contacts').where({ id, tenant_id: user.tenantId }).first();
        if (!contact) return reply.status(404).send({ error: 'Kontakt nicht gefunden' });

        const updates: any = { updated_at: new Date() };
        const allowed = ['salutation', 'first_name', 'last_name', 'position', 'department', 'email', 'phone', 'mobile', 'is_primary', 'is_billing_contact', 'category_id', 'notes'];
        for (const key of allowed) {
            if (body[key] !== undefined) updates[key] = body[key] === '' ? null : body[key];
        }
        if (body.custom_fields !== undefined) updates.custom_fields = JSON.stringify(body.custom_fields);

        // Falls is_primary: alle anderen auf false setzen
        if (body.is_primary) {
            await db('crm_contacts')
                .where({ customer_id: contact.customer_id, tenant_id: user.tenantId })
                .whereNot('id', id)
                .update({ is_primary: false });
        }

        await db('crm_contacts').where({ id, tenant_id: user.tenantId }).update(updates);
        return reply.send({ ok: true });
    });

    // ══════════════════════════════════════════
    // DELETE /:id — Kontakt löschen
    // ══════════════════════════════════════════
    fastify.delete('/:id', { preHandler: [requirePermission('crm.contacts.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };

        const contact = await db('crm_contacts').where({ id, tenant_id: user.tenantId }).first();
        if (!contact) return reply.status(404).send({ error: 'Kontakt nicht gefunden' });

        await db('crm_contacts').where({ id, tenant_id: user.tenantId }).delete();
        return reply.send({ ok: true });
    });

    // ══════════════════════════════════════════
    // GET /:id/vcard — vCard Export
    // ══════════════════════════════════════════
    fastify.get('/:id/vcard', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };

        const contact = await db('crm_contacts')
            .leftJoin('crm_customers', 'crm_contacts.customer_id', 'crm_customers.id')
            .where({ 'crm_contacts.id': id, 'crm_contacts.tenant_id': user.tenantId })
            .select('crm_contacts.*', 'crm_customers.company_name')
            .first();

        if (!contact) return reply.status(404).send({ error: 'Kontakt nicht gefunden' });

        const lines = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            `N:${contact.last_name || ''};${contact.first_name || ''};;;`,
            `FN:${[contact.first_name, contact.last_name].filter(Boolean).join(' ')}`,
        ];
        if (contact.company_name) lines.push(`ORG:${contact.company_name}`);
        if (contact.position) lines.push(`TITLE:${contact.position}`);
        if (contact.email) lines.push(`EMAIL;TYPE=WORK:${contact.email}`);
        if (contact.phone) lines.push(`TEL;TYPE=WORK:${contact.phone}`);
        if (contact.mobile) lines.push(`TEL;TYPE=CELL:${contact.mobile}`);
        if (contact.department) lines.push(`X-DEPARTMENT:${contact.department}`);
        lines.push(`REV:${new Date().toISOString()}`);
        lines.push('END:VCARD');

        const vcf = lines.join('\r\n');
        const filename = `${(contact.first_name || '').replace(/\s/g, '_')}_${(contact.last_name || '').replace(/\s/g, '_')}.vcf`;

        return reply
            .header('Content-Type', 'text/vcard; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .send(vcf);
    });
}
