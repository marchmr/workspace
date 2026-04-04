import { FastifyInstance } from 'fastify';
import { createHash } from 'crypto';
import { getDatabase } from '../../../backend/src/core/database.js';
import customerRoutes from './routes/customers.js';
import layoutRoutes from './routes/layout.js';
import settingsRoutes from './routes/settings.js';
import statsRoutes from './routes/stats.js';
import ticketRoutes from './routes/tickets.js';
import contactRoutes from './routes/contacts.js';
import contactCategoryRoutes from './routes/contactCategories.js';
import noteRoutes from './routes/notes.js';
import importExportRoutes from './routes/importExport.js';
import addressRoutes from './routes/addresses.js';

function textOrNull(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized : null;
}

function firstText(...values: unknown[]): string | null {
    for (const value of values) {
        const normalized = textOrNull(value);
        if (normalized) return normalized;
    }
    return null;
}

function extractAddress(payload: any): { street: string | null; zip: string | null; city: string | null; country: string | null } {
    const address = payload?.address ?? payload?.main_address ?? payload?.billing_address ?? payload?.shipping_address;
    if (typeof address === 'string') {
        return {
            street: textOrNull(address),
            zip: null,
            city: null,
            country: 'Deutschland',
        };
    }
    return {
        street: firstText(address?.street, address?.street1, address?.line1, payload?.street, payload?.address_street),
        zip: firstText(address?.zip, address?.postal_code, address?.postcode, payload?.zip, payload?.postal_code),
        city: firstText(address?.city, address?.town, payload?.city),
        country: firstText(address?.country, payload?.country) || 'Deutschland',
    };
}

function isCustomerEventType(eventType: string): boolean {
    return ['customer.exported', 'customer.created', 'customer.updated'].includes(eventType);
}

function readCustomerFromPayload(payload: any): any | null {
    const direct = payload?.customer;
    if (direct && typeof direct === 'object') return direct;
    const nested = payload?.data?.customer;
    if (nested && typeof nested === 'object') return nested;
    return null;
}

function readPrimaryContact(customer: any): any | null {
    const direct = customer?.contact_person ?? customer?.contactPerson ?? customer?.primary_contact;
    if (direct && typeof direct === 'object') return direct;

    const contacts = customer?.contacts ?? customer?.contact_persons ?? customer?.contacts_persons;
    if (Array.isArray(contacts)) {
        const preferred = contacts.find((entry: any) => entry?.is_primary || entry?.primary) ?? contacts[0];
        if (preferred && typeof preferred === 'object') return preferred;
    }
    return null;
}

function readPrimaryAddress(customer: any): any | null {
    const direct = customer?.address ?? customer?.main_address ?? customer?.billing_address ?? customer?.shipping_address;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;

    const addresses = customer?.addresses ?? customer?.addresses_list ?? customer?.address_list;
    if (Array.isArray(addresses)) {
        const preferred = addresses.find((entry: any) => entry?.is_main || entry?.is_default || entry?.primary || entry?.type === 'main')
            ?? addresses[0];
        if (preferred && typeof preferred === 'object') return preferred;
    }
    return null;
}

function splitName(fullName: string | null): { firstName: string | null; lastName: string | null } {
    const normalized = textOrNull(fullName);
    if (!normalized) return { firstName: null, lastName: null };
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { firstName: null, lastName: parts[0] };
    return {
        firstName: parts.slice(0, -1).join(' '),
        lastName: parts[parts.length - 1],
    };
}

function buildFallbackCustomerNumber(payload: any, customer: any): string {
    const seed = JSON.stringify({
        eventId: payload?.event_id || payload?.eventId || null,
        name: customer?.name || customer?.company || null,
        email: customer?.email || null,
    });
    const hash = createHash('sha1').update(seed || String(Date.now()), 'utf8').digest('hex').slice(0, 12);
    return `ACCT-${hash}`.toUpperCase();
}

function readCustomerNumber(payload: any, customer: any): string {
    const candidates = [
        customer?.id,
        customer?.customer_id,
        customer?.customer_number,
        customer?.number,
        customer?.uuid,
        payload?.customer_id,
        payload?.customer_number,
    ];
    for (const value of candidates) {
        const normalized = String(value ?? '').trim();
        if (normalized) return normalized;
    }
    return buildFallbackCustomerNumber(payload, customer);
}

export default async function plugin(fastify: FastifyInstance): Promise<void> {
    // Kunden CRUD + Suche + Bulk
    await fastify.register(customerRoutes, { prefix: '/customers' });

    // Tickets CRUD + Kommentare + Stats
    await fastify.register(ticketRoutes, { prefix: '/tickets' });

    // Kontakte CRUD
    await fastify.register(contactRoutes, { prefix: '/contacts' });

    // Ansprechpartner-Kategorien
    await fastify.register(contactCategoryRoutes, { prefix: '/contacts' });

    // Notizen CRUD
    await fastify.register(noteRoutes, { prefix: '/notes' });

    // Import/Export (CSV + PDF)
    await fastify.register(importExportRoutes, { prefix: '/io' });

    // Layout, Recent, Favorites, Activities
    await fastify.register(layoutRoutes, { prefix: '/layout' });

    // Admin-Settings (Custom-Felder)
    await fastify.register(settingsRoutes, { prefix: '/settings' });

    // Dashboard-KPIs
    await fastify.register(statsRoutes, { prefix: '/stats' });

    // Kunden-Adressen CRUD
    await fastify.register(addressRoutes, { prefix: '/addresses' });

    async function resolveTargetTenantIds(db: any, payload: any, customer: any): Promise<number[]> {
        const explicitTenant = Number(payload?.tenant_id ?? customer?.tenant_id ?? customer?.tenantId ?? 0);
        if (Number.isInteger(explicitTenant) && explicitTenant > 0) return [explicitTenant];

        const activeTenants = await db('tenants')
            .where('is_active', true)
            .select('id');
        const ids = activeTenants
            .map((row: any) => Number(row.id))
            .filter((id: number) => Number.isInteger(id) && id > 0);
        if (ids.length > 0) return ids;

        const defaultTenant = await db('tenants').where({ slug: 'default' }).first('id');
        const fallbackId = Number(defaultTenant?.id || 0);
        return fallbackId > 0 ? [fallbackId] : [];
    }

    async function upsertCustomerFromAccountingEvent(payload: any): Promise<{ inserted: number; updated: number }> {
        const customer = readCustomerFromPayload(payload);
        if (!customer) return { inserted: 0, updated: 0 };

        const customerNumber = readCustomerNumber(payload, customer);

        const db = getDatabase();
        const targetTenantIds = await resolveTargetTenantIds(db, payload, customer);
        if (targetTenantIds.length === 0) return { inserted: 0, updated: 0 };

        const firstName = textOrNull(customer.first_name);
        const lastName = textOrNull(customer.last_name);
        const companyName = textOrNull(customer.company) || (!firstName && !lastName ? textOrNull(customer.name) : null);
        const type = String(customer.kind || '').toLowerCase() === 'person' || (!!firstName || !!lastName) ? 'person' : 'company';
        const primaryAddress = readPrimaryAddress(customer) || customer;
        const addr = extractAddress(primaryAddress);
        const primaryContact = readPrimaryContact(customer);
        let inserted = 0;
        let updated = 0;
        const contactsTableExists = await db.schema.hasTable('crm_contacts').catch(() => false);
        const addressesTableExists = await db.schema.hasTable('crm_addresses').catch(() => false);

        async function upsertPrimaryContact(tenantId: number, customerId: number): Promise<void> {
            if (!contactsTableExists || !primaryContact) return;

            const split = splitName(firstText(primaryContact.full_name, primaryContact.name));
            const contactFirstName = firstText(primaryContact.first_name, primaryContact.firstName, split.firstName);
            const contactLastName = firstText(primaryContact.last_name, primaryContact.lastName, split.lastName);
            if (!contactLastName) return; // crm_contacts.last_name ist NOT NULL

            const contactPayload: any = {
                tenant_id: tenantId,
                customer_id: customerId,
                salutation: firstText(primaryContact.salutation, primaryContact.anrede),
                first_name: contactFirstName,
                last_name: contactLastName,
                position: firstText(primaryContact.position, primaryContact.role, primaryContact.job_title),
                department: firstText(primaryContact.department, primaryContact.team),
                email: firstText(primaryContact.email, primaryContact.mail),
                phone: firstText(primaryContact.phone, primaryContact.telefon),
                mobile: firstText(primaryContact.mobile, primaryContact.cellphone),
                is_primary: true,
                updated_at: new Date(),
            };

            const existingContact = await db('crm_contacts')
                .where({ tenant_id: tenantId, customer_id: customerId, is_primary: 1 })
                .first('id');

            if (existingContact?.id) {
                await db('crm_contacts').where({ id: existingContact.id }).update(contactPayload);
            } else {
                await db('crm_contacts').insert({
                    ...contactPayload,
                    created_at: new Date(),
                });
            }
        }

        async function upsertMainAddress(tenantId: number, customerId: number, companyNameForAddress: string | null): Promise<void> {
            if (!addressesTableExists) return;
            if (!addr.street && !addr.zip && !addr.city) return;

            const payload = {
                tenant_id: tenantId,
                customer_id: customerId,
                address_type: 'main',
                is_default: true,
                company_name: companyNameForAddress,
                street: addr.street,
                zip: addr.zip,
                city: addr.city,
                country: addr.country || 'Deutschland',
                updated_at: new Date(),
            };

            const existing = await db('crm_addresses')
                .where({ tenant_id: tenantId, customer_id: customerId, address_type: 'main' })
                .first('id');

            if (existing?.id) {
                await db('crm_addresses').where({ id: existing.id }).update(payload);
            } else {
                await db('crm_addresses').insert({
                    ...payload,
                    created_at: new Date(),
                });
            }
        }

        for (const tenantId of targetTenantIds) {
            const record = {
                tenant_id: tenantId,
                customer_number: customerNumber,
                type,
                company_name: companyName,
                first_name: firstName,
                last_name: lastName,
                email: textOrNull(customer.email),
                phone: textOrNull(customer.phone),
                street: addr.street,
                zip: addr.zip,
                city: addr.city,
                country: addr.country,
                status: 'active',
                updated_at: new Date(),
            };

            const existing = await db('crm_customers')
                .where({ tenant_id: tenantId, customer_number: customerNumber })
                .first('id');

            if (existing?.id) {
                await db('crm_customers').where({ id: existing.id }).update(record);
                await upsertPrimaryContact(tenantId, Number(existing.id));
                await upsertMainAddress(tenantId, Number(existing.id), companyName);
                updated++;
            } else {
                const insertResult = await db('crm_customers').insert({
                    ...record,
                    created_at: new Date(),
                });
                let customerId = Number(Array.isArray(insertResult) ? insertResult[0] : insertResult);
                if (!Number.isInteger(customerId) || customerId <= 0) {
                    const insertedRow = await db('crm_customers')
                        .where({ tenant_id: tenantId, customer_number: customerNumber })
                        .first('id');
                    customerId = Number(insertedRow?.id || 0);
                }
                if (customerId > 0) {
                    await upsertPrimaryContact(tenantId, customerId);
                    await upsertMainAddress(tenantId, customerId, companyName);
                }
                inserted++;
            }
        }
        return { inserted, updated };
    }

    fastify.events.on('accounting.connector.event.received', async (incoming: any) => {
        try {
            const eventType = String(incoming?.eventType || '').trim().toLowerCase();
            if (!isCustomerEventType(eventType)) return;
            const result = await upsertCustomerFromAccountingEvent(incoming?.payload || {});
            if (result.inserted > 0 || result.updated > 0) {
                console.log(`[CRM] Accounting Live-Import: +${result.inserted} neu, ~${result.updated} aktualisiert`);
            }
        } catch (error) {
            console.error('[CRM] Fehler beim Verarbeiten von Accounting-Event:', error);
        }
    });

    // Backfill: Beim Plugin-Start die juengsten Accounting-Kunden-Events einlesen,
    // damit bereits empfangene Events auch ohne erneutes Senden im CRM landen.
    try {
        const db = getDatabase();
        const rows = await db('accounting_connector_events')
            .whereIn('event_type', ['customer.exported', 'customer.created', 'customer.updated'])
            .orderBy('created_at', 'desc')
            .limit(2000)
            .select('payload_json');

        const newestByCustomer = new Map<string, any>();
        for (const row of rows) {
            try {
                const payload = JSON.parse(String(row.payload_json || '{}'));
                const backfillCustomer = readCustomerFromPayload(payload);
                if (!backfillCustomer) continue;
                const customerKey = readCustomerNumber(payload, backfillCustomer);
                if (!customerKey || newestByCustomer.has(customerKey)) continue;
                newestByCustomer.set(customerKey, payload);
            } catch {
                // kaputte Einzelpayloads ignorieren
            }
        }

        let inserted = 0;
        let updated = 0;
        for (const payload of newestByCustomer.values()) {
            const result = await upsertCustomerFromAccountingEvent(payload);
            inserted += result.inserted;
            updated += result.updated;
        }

        if (newestByCustomer.size > 0) {
            console.log(`[CRM] Accounting-Backfill verarbeitet: ${newestByCustomer.size} Kunden-Events, +${inserted} neu, ~${updated} aktualisiert`);
        }
    } catch (error) {
        console.error('[CRM] Accounting-Backfill fehlgeschlagen:', error);
    }

    console.log('[CRM] Plugin geladen (Kunden, Tickets, Kontakte, Adressen, Notizen, Import/Export)');
}
