import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createReadStream } from 'fs';
import { rm, stat } from 'fs/promises';
import path from 'path';
import { config } from '../../../../backend/src/core/config.js';
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

function asText(value: unknown): string {
    return String(value ?? '').trim();
}

function asNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
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

async function removeAccountingDataForCustomer(
    db: any,
    tenantId: number,
    customerId: number,
    customerNumber: string | null,
): Promise<{ documentsDeleted: number; filesDeleted: number }> {
    const hasProjection = await db.schema.hasTable('accounting_connector_documents').catch(() => false);
    if (!hasProjection) return { documentsDeleted: 0, filesDeleted: 0 };

    const identifiers = [String(customerId), asText(customerNumber)].filter(Boolean);
    const rows = await db('accounting_connector_documents')
        .where('tenant_id', tenantId)
        .whereIn('document_category', ['rechnung', 'angebot', 'mahnung', 'gutschrift', 'storno', 'customer'])
        .andWhere(function customerFilter(this: any) {
            this.whereIn('customer_id', identifiers)
                .orWhereIn('customer_number', identifiers)
                .orWhereIn('entity_id', identifiers);
        })
        .select('id', 'pdf_storage_path');

    if (rows.length === 0) return { documentsDeleted: 0, filesDeleted: 0 };

    let filesDeleted = 0;
    for (const row of rows) {
        const storagePath = asText(row.pdf_storage_path);
        if (!storagePath) continue;
        try {
            const absolutePath = resolveAccountingPdfPath(storagePath);
            await rm(absolutePath, { force: true });
            filesDeleted += 1;
        } catch {
            // Datei-Fehler nicht blockierend
        }
    }

    const ids = rows.map((row: any) => Number(row.id)).filter((value: number) => Number.isInteger(value) && value > 0);
    if (ids.length === 0) return { documentsDeleted: 0, filesDeleted };

    const documentsDeleted = Number(await db('accounting_connector_documents').where({ tenant_id: tenantId }).whereIn('id', ids).delete() || 0);
    return { documentsDeleted, filesDeleted };
}

async function syncAccountingCustomerNumber(db: any, tenantId: number, oldNumber: string, nextNumber: string): Promise<number> {
    const previous = asText(oldNumber);
    const next = asText(nextNumber);
    if (!previous || !next || previous === next) return 0;

    const hasProjection = await db.schema.hasTable('accounting_connector_documents').catch(() => false);
    if (!hasProjection) return 0;

    const updated = await db('accounting_connector_documents')
        .where('tenant_id', tenantId)
        .where('customer_number', previous)
        .update({
            customer_number: next,
            updated_at: new Date(),
        });

    return Number(updated || 0);
}

/* ════════════════════════════════════════════
   Routes
   ════════════════════════════════════════════ */

export default async function customerRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();
    let contactsTableAvailable: boolean | null = null;
    let contactsPrimaryFlagAvailable: boolean | null = null;
    let customersMobileColumnAvailable: boolean | null = null;

    async function canJoinPrimaryContacts(): Promise<boolean> {
        if (contactsTableAvailable === null) {
            contactsTableAvailable = await db.schema.hasTable('crm_contacts').catch(() => false);
        }
        if (!contactsTableAvailable) return false;
        if (contactsPrimaryFlagAvailable === null) {
            contactsPrimaryFlagAvailable = await db.schema.hasColumn('crm_contacts', 'is_primary').catch(() => false);
        }
        return Boolean(contactsPrimaryFlagAvailable);
    }

    async function hasCustomersMobileColumn(): Promise<boolean> {
        if (customersMobileColumnAvailable === null) {
            customersMobileColumnAvailable = await db.schema.hasColumn('crm_customers', 'mobile').catch(() => false);
        }
        return Boolean(customersMobileColumnAvailable);
    }

    // ─── GET / — Kundenliste mit Paginierung, Suche, Filter ───
    fastify.get('/', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
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
            const hasMobileColumn = await hasCustomersMobileColumn();

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
                        .orWhere('phone', 'like', `%${safeTerm}%`);
                    if (hasMobileColumn) {
                        this.orWhere('mobile', 'like', `%${safeTerm}%`);
                    }
                    this
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

            const withPrimaryContact = await canJoinPrimaryContacts();
            const safeSortBy = [
                'customer_number', 'company_name', 'first_name', 'last_name', 'city', 'email', 'phone', 'status', 'created_at',
            ].includes(sortBy) ? sortBy : 'created_at';

            let items: any[] = [];
            if (withPrimaryContact) {
                items = await baseQuery
                    .leftJoin('crm_contacts as pc', function (this: any) {
                        this.on('pc.customer_id', '=', 'crm_customers.id')
                            .andOn('pc.is_primary', '=', db.raw('1'));
                    })
                    .orderBy(
                        sortBy === 'primary_contact'
                            ? db.raw("CONCAT(COALESCE(pc.first_name,''), ' ', COALESCE(pc.last_name,''))")
                            : `crm_customers.${safeSortBy}`,
                        sortOrder,
                    )
                    .limit(pageSize)
                    .offset((page - 1) * pageSize)
                    .select(
                        'crm_customers.*',
                        db.raw("TRIM(CONCAT(COALESCE(pc.first_name,''), ' ', COALESCE(pc.last_name,''))) as primary_contact_name"),
                        'pc.email as primary_contact_email',
                        'pc.phone as primary_contact_phone',
                    );
            } else {
                items = await baseQuery
                    .orderBy(`crm_customers.${safeSortBy}`, sortOrder)
                    .limit(pageSize)
                    .offset((page - 1) * pageSize)
                    .select('crm_customers.*');
                items = items.map((item: any) => ({
                    ...item,
                    primary_contact_name: null,
                    primary_contact_email: null,
                    primary_contact_phone: null,
                }));
            }

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
        } catch (error) {
            request.log.error({ err: error }, 'CRM Kundenliste konnte nicht geladen werden');
            return reply.status(500).send({ error: 'CRM-Kundenliste konnte nicht geladen werden' });
        }
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

    // ─── GET /:id/accounting-documents — Accounting-Dokumente für einen CRM-Kunden ───
    fastify.get('/:id/accounting-documents', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const query = request.query as { category?: string };
        const tenantId = (request.user as any).tenantId;
        const category = asText(query?.category).toLowerCase();
        const allowedCategories = ['rechnung', 'angebot', 'mahnung', 'gutschrift', 'storno'];
        if (category && !allowedCategories.includes(category)) {
            return reply.status(400).send({ error: 'Ungültige Kategorie' });
        }

        const hasProjection = await db.schema.hasTable('accounting_connector_documents').catch(() => false);
        if (!hasProjection) {
            return reply.send({ items: [] });
        }

        const customer = await db('crm_customers')
            .where({ id, tenant_id: tenantId })
            .first('id', 'customer_number');
        if (!customer) {
            return reply.status(404).send({ error: 'Kunde nicht gefunden' });
        }

        const identifiers = [String(customer.id), asText(customer.customer_number)].filter(Boolean);
        const rows = await db('accounting_connector_documents')
            .where('tenant_id', tenantId)
            .whereIn('document_category', category ? [category] : allowedCategories)
            .andWhere(function customerFilter(this: any) {
                this.whereIn('customer_id', identifiers)
                    .orWhereIn('customer_number', identifiers)
                    .orWhereIn('entity_id', identifiers);
            })
            .orderBy('updated_at', 'desc')
            .select(
                'record_key',
                'document_category',
                'document_id',
                'document_number',
                'document_status',
                'payment_status',
                'amount_total',
                'amount_paid',
                'amount_open',
                'currency',
                'document_date',
                'due_date',
                'paid_at',
                'pdf_file_name',
                'pdf_storage_path',
                'updated_at',
            );

        const items = rows.map((row: any) => ({
            recordKey: asText(row.record_key),
            category: asText(row.document_category),
            documentId: asText(row.document_id),
            documentNumber: asText(row.document_number),
            documentStatus: asText(row.document_status),
            paymentStatus: asText(row.payment_status),
            amountTotal: asNumber(row.amount_total, 0),
            amountPaid: asNumber(row.amount_paid, 0),
            amountOpen: asNumber(row.amount_open, 0),
            currency: asText(row.currency) || 'EUR',
            documentDate: asText(row.document_date) || null,
            dueDate: asText(row.due_date) || null,
            paidAt: asText(row.paid_at) || null,
            hasPdf: Boolean(asText(row.pdf_storage_path)),
            updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        }));

        return reply.send({ items });
    });

    // ─── GET /:id/accounting-documents/:recordKey/pdf — PDF aus CRM-Kundenakte ───
    fastify.get('/:id/accounting-documents/:recordKey/pdf', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id, recordKey } = request.params as { id: string; recordKey: string };
        const tenantId = (request.user as any).tenantId;

        const hasProjection = await db.schema.hasTable('accounting_connector_documents').catch(() => false);
        if (!hasProjection) {
            return reply.status(404).send({ error: 'PDF nicht verfügbar' });
        }

        const customer = await db('crm_customers')
            .where({ id, tenant_id: tenantId })
            .first('id', 'customer_number');
        if (!customer) {
            return reply.status(404).send({ error: 'Kunde nicht gefunden' });
        }

        const identifiers = [String(customer.id), asText(customer.customer_number)].filter(Boolean);
        const row = await db('accounting_connector_documents')
            .where('tenant_id', tenantId)
            .where({ record_key: recordKey })
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
            'customer_number',
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

        const nextCustomerNumber = asText(update.customer_number);
        if (Object.prototype.hasOwnProperty.call(update, 'customer_number') && !nextCustomerNumber) {
            return reply.status(400).send({ error: 'Kundennummer darf nicht leer sein' });
        }
        if (nextCustomerNumber && nextCustomerNumber !== asText(existing.customer_number)) {
            const duplicate = await db('crm_customers')
                .where({ tenant_id: tenantId, customer_number: nextCustomerNumber })
                .whereNot('id', id)
                .first('id');
            if (duplicate) {
                return reply.status(400).send({ error: 'Kundennummer bereits vergeben' });
            }
        }

        await db('crm_customers').where('id', id).update(update);
        await syncAccountingCustomerNumber(db, Number(tenantId), asText(existing.customer_number), nextCustomerNumber);
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
            'customer_number',
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

        const nextCustomerNumber = asText(update.customer_number);
        if (Object.prototype.hasOwnProperty.call(update, 'customer_number') && !nextCustomerNumber) {
            return reply.status(400).send({ error: 'Kundennummer darf nicht leer sein' });
        }
        if (nextCustomerNumber && nextCustomerNumber !== asText(existing.customer_number)) {
            const duplicate = await db('crm_customers')
                .where({ tenant_id: tenantId, customer_number: nextCustomerNumber })
                .whereNot('id', id)
                .first('id');
            if (duplicate) {
                return reply.status(400).send({ error: 'Kundennummer bereits vergeben' });
            }
        }

        await db('crm_customers').where('id', id).update(update);
        await syncAccountingCustomerNumber(db, Number(tenantId), asText(existing.customer_number), nextCustomerNumber);

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

        const accountingCleanup = await removeAccountingDataForCustomer(
            db,
            Number(tenantId),
            Number(existing.id),
            asText(existing.customer_number) || null,
        );

        // Cascading: activities, favorites, recent werden per FK CASCADE gelöscht
        await db('crm_customers').where('id', id).delete();

        await fastify.audit.log({
            action: 'crm.customer.deleted',
            category: 'plugin',
            entityType: 'crm_customers',
            entityId: String(id),
            previousState: { customer_number: existing.customer_number, company_name: existing.company_name, type: existing.type },
            newState: accountingCleanup,
            pluginId: 'crm',
        }, request);

        return reply.send({ success: true, accountingCleanup });
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

        let documentsDeleted = 0;
        let filesDeleted = 0;
        for (const customer of customers) {
            const accountingCleanup = await removeAccountingDataForCustomer(
                db,
                Number(tenantId),
                Number(customer.id),
                asText(customer.customer_number) || null,
            );
            documentsDeleted += accountingCleanup.documentsDeleted;
            filesDeleted += accountingCleanup.filesDeleted;

            await db('crm_customers').where('id', customer.id).delete();

            await fastify.audit.log({
                action: 'crm.customer.deleted',
                category: 'plugin',
                entityType: 'crm_customers',
                entityId: String(customer.id),
                previousState: { customer_number: customer.customer_number, company_name: customer.company_name },
                newState: accountingCleanup,
                pluginId: 'crm',
            }, request);
        }

        return reply.send({
            success: true,
            deleted: customers.length,
            accountingCleanup: { documentsDeleted, filesDeleted },
        });
    });

    // ─── GET /search — Globale Suche ───
    fastify.get('/search', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = (request.user as any).tenantId;
        const { q } = request.query as { q?: string };
        const hasMobileColumn = await hasCustomersMobileColumn();

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
                    .orWhere('phone', 'like', `%${safeTerm}%`);
                if (hasMobileColumn) {
                    this.orWhere('mobile', 'like', `%${safeTerm}%`);
                }
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
