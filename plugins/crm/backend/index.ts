import { FastifyInstance } from 'fastify';
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

    fastify.events.on('accounting.connector.event.received', async (incoming: any) => {
        try {
            const eventType = String(incoming?.eventType || '').trim().toLowerCase();
            if (!['customer.exported', 'customer.created', 'customer.updated'].includes(eventType)) return;

            const payload = incoming?.payload || {};
            const customer = payload?.customer;
            if (!customer || typeof customer !== 'object') return;

            const customerNumber = String(customer.id ?? customer.customer_number ?? '').trim();
            if (!customerNumber) return;

            const db = getDatabase();
            const tenantFromPayload = Number(payload?.tenant_id ?? customer?.tenant_id ?? customer?.tenantId ?? 0);
            let tenantId = Number.isInteger(tenantFromPayload) && tenantFromPayload > 0 ? tenantFromPayload : 0;
            if (!tenantId) {
                const defaultTenant = await db('tenants').where({ slug: 'default' }).first('id');
                tenantId = Number(defaultTenant?.id || 0);
            }
            if (!tenantId) return;

            const firstName = textOrNull(customer.first_name);
            const lastName = textOrNull(customer.last_name);
            const companyName = textOrNull(customer.company) || (!firstName && !lastName ? textOrNull(customer.name) : null);
            const type = String(customer.kind || '').toLowerCase() === 'person' || (!!firstName || !!lastName) ? 'person' : 'company';
            const addr = extractAddress(customer);

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
                return;
            }

            await db('crm_customers').insert({
                ...record,
                created_at: new Date(),
            });
        } catch (error) {
            console.error('[CRM] Fehler beim Verarbeiten von Accounting-Event:', error);
        }
    });

    console.log('[CRM] Plugin geladen (Kunden, Tickets, Kontakte, Adressen, Notizen, Import/Export)');
}
