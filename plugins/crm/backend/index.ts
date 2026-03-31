import { FastifyInstance } from 'fastify';
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

    console.log('[CRM] Plugin geladen (Kunden, Tickets, Kontakte, Adressen, Notizen, Import/Export)');
}
