import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDatabase } from '../../../../backend/src/core/database.js';
import { requirePermission } from '../../../../backend/src/core/permissions.js';

/* ════════════════════════════════════════════
   Kundennummer-Generator
   ════════════════════════════════════════════ */

async function generateCustomerNumber(tenantId: number): Promise<string> {
    const db = getDatabase();
    const year = new Date().getFullYear();
    const prefix = `KD-${year}-`;

    const maxRow = await db('crm_customers')
        .where('tenant_id', tenantId)
        .andWhere('customer_number', 'like', `${prefix}%`)
        .select(db.raw(`MAX(CAST(SUBSTRING(customer_number, ${prefix.length + 1}) AS UNSIGNED)) as max_num`))
        .first();

    const nextNum = ((maxRow as any)?.max_num || 0) + 1;
    return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

/* ════════════════════════════════════════════
   Helper
   ════════════════════════════════════════════ */

function getDisplayName(customer: any): string {
    if (customer.type === 'company' && customer.company_name) {
        return customer.company_name;
    }
    return [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unbenannt';
}

/* ════════════════════════════════════════════
   Routes
   ════════════════════════════════════════════ */

export default async function customerRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();

    // ─── GET / — Kundenliste mit Paginierung, Suche, Filter ───
    fastify.get('/', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const query = request.query as Record<string, string>;

        const page = Math.max(1, parseInt(query.page || '1', 10));
        const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || '25', 10)));
        const search = (query.search || '').trim();
        const status = query.status || '';
        const type = query.type || '';
        const category = query.category || '';
        const sortBy = query.sortBy || 'created_at';
        const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

        let baseQuery = db('crm_customers').where('crm_customers.tenant_id', tenantId);

        // Suchfilter
        if (search) {
            const safeTerm = search.replace(/[%_\\]/g, '\\$&');
            baseQuery = baseQuery.where(function (this: any) {
                this.orWhere('customer_number', 'like', `%${safeTerm}%`)
                    .orWhere('company_name', 'like', `%${safeTerm}%`)
                    .orWhere('first_name', 'like', `%${safeTerm}%`)
                    .orWhere('last_name', 'like', `%${safeTerm}%`)
                    .orWhere('email', 'like', `%${safeTerm}%`)
                    .orWhere('phone', 'like', `%${safeTerm}%`)
                    .orWhere('mobile', 'like', `%${safeTerm}%`)
                    .orWhere('city', 'like', `%${safeTerm}%`);
            });
        }

        // Filter
        if (status && ['active', 'inactive', 'prospect'].includes(status)) {
            baseQuery = baseQuery.where('status', status);
        }
        if (type && ['company', 'person'].includes(type)) {
            baseQuery = baseQuery.where('type', type);
        }
        if (category) {
            baseQuery = baseQuery.where('category', category);
        }

        // Gesamtanzahl
        const countResult = await baseQuery.clone().count('id as count').first();
        const total = Number(countResult?.count || 0);
        const totalPages = Math.ceil(total / pageSize);

        // Daten mit Hauptansprechpartner (LEFT JOIN)
        const items = await baseQuery
            .leftJoin('crm_contacts as pc', function (this: any) {
                this.on('pc.customer_id', '=', 'crm_customers.id')
                    .andOn('pc.is_primary', '=', db.raw('1'));
            })
            .orderBy(sortBy === 'primary_contact' ? db.raw("CONCAT(COALESCE(pc.first_name,''), ' ', COALESCE(pc.last_name,''))") : `crm_customers.${sortBy}`, sortOrder)
            .limit(pageSize)
            .offset((page - 1) * pageSize)
            .select(
                'crm_customers.*',
                db.raw("TRIM(CONCAT(COALESCE(pc.first_name,''), ' ', COALESCE(pc.last_name,''))) as primary_contact_name"),
                'pc.email as primary_contact_email',
                'pc.phone as primary_contact_phone'
            );

        // Display-Name hinzufügen
        const enriched = items.map((c: any) => ({
            ...c,
            display_name: getDisplayName(c),
            primary_contact_name: c.primary_contact_name?.trim() || null,
        }));

        return reply.send({
            items: enriched,
            pagination: { page, pageSize, total, totalPages },
        });
    });

    // ─── GET /categories — Verfügbare Kategorien ───
    fastify.get('/categories', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;

        const categories = await db('crm_customers')
            .where('tenant_id', tenantId)
            .whereNotNull('category')
            .where('category', '!=', '')
            .distinct('category')
            .orderBy('category', 'asc')
            .pluck('category');

        return reply.send({ categories });
    });

    // ─── GET /number/next — Nächste Kundennummer Vorschau ───
    fastify.get('/number/next', { preHandler: [requirePermission('crm.create')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const nextNumber = await generateCustomerNumber(tenantId);
        return reply.send({ nextNumber });
    });

    // ─── POST /check-duplicates — Duplikat-Warnung ───
    fastify.post('/check-duplicates', { preHandler: [requirePermission('crm.create')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const body = request.body as any;
        const duplicates: any[] = [];

        // 1. Exakte E-Mail-Übereinstimmung
        if (body.email?.trim()) {
            const emailMatches = await db('crm_customers')
                .where('tenant_id', tenantId)
                .where('email', body.email.trim())
                .select('id', 'customer_number', 'company_name', 'first_name', 'last_name', 'email', 'city', 'type');

            for (const match of emailMatches) {
                duplicates.push({
                    ...match,
                    display_name: getDisplayName(match),
                    match_reason: 'E-Mail-Adresse stimmt überein',
                    confidence: 'high',
                });
            }
        }

        // 2. Firmenname (LIKE-Suche)
        if (body.company_name?.trim() && duplicates.length < 5) {
            const safeName = body.company_name.trim().replace(/[%_\\]/g, '\\$&');
            const nameMatches = await db('crm_customers')
                .where('tenant_id', tenantId)
                .where('company_name', 'like', `%${safeName}%`)
                .whereNotIn('id', duplicates.map((d: any) => d.id))
                .limit(3)
                .select('id', 'customer_number', 'company_name', 'first_name', 'last_name', 'email', 'city', 'type');

            for (const match of nameMatches) {
                duplicates.push({
                    ...match,
                    display_name: getDisplayName(match),
                    match_reason: 'Aehnlicher Firmenname',
                    confidence: 'medium',
                });
            }
        }

        // 3. Nachname + PLZ
        if (body.last_name?.trim() && body.zip?.trim() && duplicates.length < 5) {
            const lastNameMatches = await db('crm_customers')
                .where('tenant_id', tenantId)
                .where('last_name', body.last_name.trim())
                .where('zip', body.zip.trim())
                .whereNotIn('id', duplicates.map((d: any) => d.id))
                .limit(3)
                .select('id', 'customer_number', 'company_name', 'first_name', 'last_name', 'email', 'city', 'type');

            for (const match of lastNameMatches) {
                duplicates.push({
                    ...match,
                    display_name: getDisplayName(match),
                    match_reason: 'Gleicher Nachname und PLZ',
                    confidence: 'medium',
                });
            }
        }

        return reply.send({ duplicates: duplicates.slice(0, 5) });
    });

    // ─── GET /:id — Einzelner Kunde ───
    fastify.get('/:id', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const tenantId = (request.user as any).tenantId;

        const customer = await db('crm_customers')
            .where({ id, tenant_id: tenantId })
            .first();

        if (!customer) {
            return reply.status(404).send({ error: 'Kunde nicht gefunden' });
        }

        return reply.send({
            ...customer,
            display_name: getDisplayName(customer),
        });
    });

    // ─── GET /:id/summary — Aggregierte Daten für Sidebar ───
    fastify.get('/:id/summary', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const tenantId = (request.user as any).tenantId;

        const customer = await db('crm_customers')
            .where({ id, tenant_id: tenantId })
            .first();

        if (!customer) {
            return reply.status(404).send({ error: 'Kunde nicht gefunden' });
        }

        // Letzte Aktivitaet
        const lastActivity = await db('crm_activities')
            .where({ customer_id: id, tenant_id: tenantId })
            .orderBy('created_at', 'desc')
            .first();

        // Tage seit letztem Kontakt
        let daysSinceContact: number | null = null;
        if (lastActivity) {
            daysSinceContact = Math.floor((Date.now() - new Date(lastActivity.created_at).getTime()) / (1000 * 60 * 60 * 24));
        }

        return reply.send({
            tickets_open: 0,
            tickets_total: 0,
            contacts_count: 0,
            notes_count: 0,
            last_activity: lastActivity?.created_at || null,
            days_since_contact: daysSinceContact,
        });
    });

    // ─── POST / — Neuer Kunde ───
    fastify.post('/', { preHandler: [requirePermission('crm.create')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const userId = (request.user as any).userId;
        const body = request.body as any;

        // Validierung
        if (body.type === 'company' && !body.company_name?.trim()) {
            return reply.status(400).send({ error: 'Firmenname ist bei Typ "Firma" erforderlich' });
        }
        if (body.type === 'person' && !body.last_name?.trim()) {
            return reply.status(400).send({ error: 'Nachname ist bei Typ "Person" erforderlich' });
        }

        // Kundennummer generieren
        let customerNumber: string;
        let attempts = 0;
        while (true) {
            customerNumber = await generateCustomerNumber(tenantId);
            // Prüfen ob Nummer schon existiert (Race-Condition-Schutz)
            const exists = await db('crm_customers')
                .where({ tenant_id: tenantId, customer_number: customerNumber })
                .first();
            if (!exists) break;
            attempts++;
            if (attempts > 10) {
                return reply.status(500).send({ error: 'Kundennummer konnte nicht generiert werden' });
            }
        }

        const insertData: any = {
            tenant_id: tenantId,
            customer_number: customerNumber,
            type: body.type || 'company',
            company_name: body.company_name?.trim() || null,
            salutation: body.salutation?.trim() || null,
            first_name: body.first_name?.trim() || null,
            last_name: body.last_name?.trim() || null,
            email: body.email?.trim() || null,
            phone: body.phone?.trim() || null,
            mobile: body.mobile?.trim() || null,
            fax: body.fax?.trim() || null,
            website: body.website?.trim() || null,
            street: body.street?.trim() || null,
            zip: body.zip?.trim() || null,
            city: body.city?.trim() || null,
            country: body.country?.trim() || 'Deutschland',
            vat_id: body.vat_id?.trim() || null,
            industry: body.industry?.trim() || null,
            category: body.category?.trim() || null,
            status: body.status || 'active',
            payment_terms: body.payment_terms?.trim() || null,
            notes_internal: body.notes_internal?.trim() || null,
            custom_fields: body.custom_fields ? JSON.stringify(body.custom_fields) : null,
            created_by: userId,
            created_at: new Date(),
            updated_at: new Date(),
        };

        const [id] = await db('crm_customers').insert(insertData);
        const customer = await db('crm_customers').where('id', id).first();

        // Aktivität loggen
        await db('crm_activities').insert({
            tenant_id: tenantId,
            customer_id: id,
            type: 'customer.created',
            title: `Kunde ${customerNumber} erstellt`,
            created_by: userId,
            created_at: new Date(),
        });

        // Audit-Log
        await fastify.audit.log({
            action: 'crm.customer.created',
            category: 'plugin',
            entityType: 'crm_customers',
            entityId: String(id),
            newState: { customer_number: customerNumber, type: body.type, company_name: body.company_name, last_name: body.last_name },
            pluginId: 'crm',
        }, request);

        return reply.status(201).send({
            ...customer,
            display_name: getDisplayName(customer),
        });
    });

    // ─── PUT /:id — Kunde vollständig aktualisieren ───
    fastify.put('/:id', { preHandler: [requirePermission('crm.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const tenantId = (request.user as any).tenantId;
        const userId = (request.user as any).userId;
        const body = request.body as any;

        const existing = await db('crm_customers').where({ id, tenant_id: tenantId }).first();
        if (!existing) {
            return reply.status(404).send({ error: 'Kunde nicht gefunden' });
        }

        const update: any = { updated_at: new Date() };

        const fields = [
            'type', 'company_name', 'salutation', 'first_name', 'last_name', 'email',
            'phone', 'mobile', 'fax', 'website', 'street', 'zip', 'city', 'country',
            'vat_id', 'industry', 'category', 'status', 'payment_terms', 'notes_internal',
        ];

        for (const field of fields) {
            if (body[field] !== undefined) {
                update[field] = typeof body[field] === 'string' ? body[field].trim() || null : body[field];
            }
        }

        if (body.custom_fields !== undefined) {
            update.custom_fields = body.custom_fields ? JSON.stringify(body.custom_fields) : null;
        }

        await db('crm_customers').where('id', id).update(update);
        const customer = await db('crm_customers').where('id', id).first();

        // Audit-Log
        await fastify.audit.log({
            action: 'crm.customer.updated',
            category: 'plugin',
            entityType: 'crm_customers',
            entityId: String(id),
            previousState: { company_name: existing.company_name, status: existing.status },
            newState: update,
            pluginId: 'crm',
        }, request);

        return reply.send({
            ...customer,
            display_name: getDisplayName(customer),
        });
    });

    // ─── PATCH /:id — Einzelfeld-Update (Inline-Edit) ───
    fastify.patch('/:id', { preHandler: [requirePermission('crm.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const tenantId = (request.user as any).tenantId;
        const body = request.body as Record<string, any>;

        const existing = await db('crm_customers').where({ id, tenant_id: tenantId }).first();
        if (!existing) {
            return reply.status(404).send({ error: 'Kunde nicht gefunden' });
        }

        const allowedFields = [
            'type', 'company_name', 'salutation', 'first_name', 'last_name', 'email',
            'phone', 'mobile', 'fax', 'website', 'street', 'zip', 'city', 'country',
            'vat_id', 'industry', 'category', 'status', 'payment_terms', 'notes_internal',
            'custom_fields',
        ];

        const update: any = { updated_at: new Date() };
        let fieldChanged = '';

        for (const [key, value] of Object.entries(body)) {
            if (!allowedFields.includes(key)) continue;
            if (key === 'custom_fields') {
                update[key] = value ? JSON.stringify(value) : null;
            } else {
                update[key] = typeof value === 'string' ? value.trim() || null : value;
            }
            fieldChanged = key;
        }

        if (Object.keys(update).length <= 1) {
            return reply.status(400).send({ error: 'Kein gültiges Feld angegeben' });
        }

        await db('crm_customers').where('id', id).update(update);

        // Status-Änderung als Aktivität loggen
        if (update.status && update.status !== existing.status) {
            const statusLabels: Record<string, string> = { active: 'Aktiv', inactive: 'Inaktiv', prospect: 'Interessent' };
            await db('crm_activities').insert({
                tenant_id: tenantId,
                customer_id: Number(id),
                type: 'customer.status_changed',
                title: `Status geändert: ${statusLabels[existing.status] || existing.status} → ${statusLabels[update.status] || update.status}`,
                created_by: (request.user as any).userId,
                metadata: JSON.stringify({ old: existing.status, new: update.status }),
                created_at: new Date(),
            });
        }

        await fastify.audit.log({
            action: 'crm.customer.field_updated',
            category: 'plugin',
            entityType: 'crm_customers',
            entityId: String(id),
            previousState: { [fieldChanged]: existing[fieldChanged] },
            newState: { [fieldChanged]: update[fieldChanged] },
            pluginId: 'crm',
        }, request);

        const customer = await db('crm_customers').where('id', id).first();
        return reply.send({ ...customer, display_name: getDisplayName(customer) });
    });

    // ─── DELETE /:id — Kunde löschen (Hard-Delete) ───
    fastify.delete('/:id', { preHandler: [requirePermission('crm.delete')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const tenantId = (request.user as any).tenantId;

        const existing = await db('crm_customers').where({ id, tenant_id: tenantId }).first();
        if (!existing) {
            return reply.status(404).send({ error: 'Kunde nicht gefunden' });
        }

        // Cascading: activities, favorites, recent werden per FK CASCADE gelöscht
        await db('crm_customers').where('id', id).delete();

        await fastify.audit.log({
            action: 'crm.customer.deleted',
            category: 'plugin',
            entityType: 'crm_customers',
            entityId: String(id),
            previousState: { customer_number: existing.customer_number, company_name: existing.company_name, type: existing.type },
            pluginId: 'crm',
        }, request);

        return reply.send({ success: true });
    });

    // ─── PATCH /bulk/status — Status für mehrere Kunden ändern ───
    fastify.patch('/bulk/status', { preHandler: [requirePermission('crm.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const userId = (request.user as any).userId;
        const { ids, status } = request.body as { ids: number[]; status: string };

        if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
            return reply.status(400).send({ error: 'Ungültige IDs (max. 100)' });
        }
        if (!['active', 'inactive', 'prospect'].includes(status)) {
            return reply.status(400).send({ error: 'Ungültiger Status' });
        }

        const customers = await db('crm_customers')
            .where('tenant_id', tenantId)
            .whereIn('id', ids)
            .select('id', 'customer_number', 'status');

        let updated = 0;
        for (const customer of customers) {
            if (customer.status !== status) {
                await db('crm_customers').where('id', customer.id).update({ status, updated_at: new Date() });

                await fastify.audit.log({
                    action: 'crm.customer.status_changed',
                    category: 'plugin',
                    entityType: 'crm_customers',
                    entityId: String(customer.id),
                    previousState: { status: customer.status },
                    newState: { status },
                    pluginId: 'crm',
                }, request);
                updated++;
            }
        }

        return reply.send({ success: true, updated });
    });

    // ─── PATCH /bulk/category — Kategorie für mehrere Kunden ändern ───
    fastify.patch('/bulk/category', { preHandler: [requirePermission('crm.edit')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const { ids, category } = request.body as { ids: number[]; category: string };

        if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
            return reply.status(400).send({ error: 'Ungültige IDs (max. 100)' });
        }

        await db('crm_customers')
            .where('tenant_id', tenantId)
            .whereIn('id', ids)
            .update({ category: category?.trim() || null, updated_at: new Date() });

        return reply.send({ success: true });
    });

    // ─── DELETE /bulk — Mehrere Kunden löschen ───
    fastify.delete('/bulk', { preHandler: [requirePermission('crm.delete')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const { ids } = request.body as { ids: number[] };

        if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
            return reply.status(400).send({ error: 'Ungültige IDs (max. 100)' });
        }

        const customers = await db('crm_customers')
            .where('tenant_id', tenantId)
            .whereIn('id', ids)
            .select('id', 'customer_number', 'company_name', 'type');

        for (const customer of customers) {
            await db('crm_customers').where('id', customer.id).delete();

            await fastify.audit.log({
                action: 'crm.customer.deleted',
                category: 'plugin',
                entityType: 'crm_customers',
                entityId: String(customer.id),
                previousState: { customer_number: customer.customer_number, company_name: customer.company_name },
                pluginId: 'crm',
            }, request);
        }

        return reply.send({ success: true, deleted: customers.length });
    });

    // ─── GET /search — Globale Suche ───
    fastify.get('/search', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const { q } = request.query as { q?: string };

        if (!q || q.length < 2) return reply.send({ results: [] });

        const safeTerm = q.replace(/[%_\\]/g, '\\$&');

        const results = await db('crm_customers')
            .where('tenant_id', tenantId)
            .where(function (this: any) {
                this.orWhere('customer_number', 'like', `%${safeTerm}%`)
                    .orWhere('company_name', 'like', `%${safeTerm}%`)
                    .orWhere('first_name', 'like', `%${safeTerm}%`)
                    .orWhere('last_name', 'like', `%${safeTerm}%`)
                    .orWhere('email', 'like', `%${safeTerm}%`)
                    .orWhere('phone', 'like', `%${safeTerm}%`)
                    .orWhere('mobile', 'like', `%${safeTerm}%`);
            })
            .orderBy('company_name', 'asc')
            .limit(10)
            .select('id', 'customer_number', 'company_name', 'first_name', 'last_name', 'email', 'phone', 'city', 'type', 'status');

        const enriched = results.map((r: any) => ({
            ...r,
            display_name: getDisplayName(r),
        }));

        return reply.send({ results: enriched });
    });
}
