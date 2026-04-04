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

function extractAddress(payload: any): { street: string | null; zip: string | null; city: string | null; country: string | null } {
    const address = payload?.address;
    if (typeof address === 'string') {
        return {
            street: textOrNull(address),
            zip: null,
            city: null,
            country: 'Deutschland',
        };
    }
    return {
        street: textOrNull(address?.street),
        zip: textOrNull(address?.zip),
        city: textOrNull(address?.city),
        country: textOrNull(address?.country) || 'Deutschland',
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

    async function upsertCustomerFromAccountingEvent(payload: any): Promise<void> {
        const customer = readCustomerFromPayload(payload);
        if (!customer) return;

        const customerNumber = readCustomerNumber(payload, customer);

        const db = getDatabase();
        const targetTenantIds = await resolveTargetTenantIds(db, payload, customer);
        if (targetTenantIds.length === 0) return;

        const firstName = textOrNull(customer.first_name);
        const lastName = textOrNull(customer.last_name);
        const companyName = textOrNull(customer.company) || (!firstName && !lastName ? textOrNull(customer.name) : null);
        const type = String(customer.kind || '').toLowerCase() === 'person' || (!!firstName || !!lastName) ? 'person' : 'company';
        const addr = extractAddress(customer);

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
            } else {
                await db('crm_customers').insert({
                    ...record,
                    created_at: new Date(),
                });
            }
        }
    }

    fastify.events.on('accounting.connector.event.received', async (incoming: any) => {
        try {
            const eventType = String(incoming?.eventType || '').trim().toLowerCase();
            if (!isCustomerEventType(eventType)) return;
            await upsertCustomerFromAccountingEvent(incoming?.payload || {});
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
                const customerKey = String(payload?.customer?.id ?? payload?.customer?.customer_number ?? '').trim();
                if (!customerKey || newestByCustomer.has(customerKey)) continue;
                newestByCustomer.set(customerKey, payload);
            } catch {
                // kaputte Einzelpayloads ignorieren
            }
        }

        for (const payload of newestByCustomer.values()) {
            await upsertCustomerFromAccountingEvent(payload);
        }

        if (newestByCustomer.size > 0) {
            console.log(`[CRM] Accounting-Backfill verarbeitet: ${newestByCustomer.size} Kunden`);
        }
    } catch (error) {
        console.error('[CRM] Accounting-Backfill fehlgeschlagen:', error);
    }

    console.log('[CRM] Plugin geladen (Kunden, Tickets, Kontakte, Adressen, Notizen, Import/Export)');
}
