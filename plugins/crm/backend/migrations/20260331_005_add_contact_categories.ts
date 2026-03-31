import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // Ansprechpartner-Kategorien (frei definierbar pro Mandant)
    await knex.schema.createTable('crm_contact_categories', (table) => {
        table.increments('id').primary();
        table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.string('name', 100).notNullable();
        table.string('color', 7).notNullable().defaultTo('#64748b');
        table.integer('sort_order').notNullable().defaultTo(0);
        table.boolean('is_default').notNullable().defaultTo(false);
        table.timestamp('created_at').defaultTo(knex.fn.now());

        table.unique(['tenant_id', 'name']);
        table.index(['tenant_id', 'sort_order']);
    });

    // Kategorie-Spalte für Kontakte
    await knex.schema.alterTable('crm_contacts', (table) => {
        table.integer('category_id').unsigned().nullable().references('id').inTable('crm_contact_categories').onDelete('SET NULL');
        table.boolean('is_billing_contact').notNullable().defaultTo(false);
    });

    // Ansprechpartner-Verknüpfung auf Tickets
    await knex.schema.alterTable('crm_tickets', (table) => {
        table.integer('contact_id').unsigned().nullable().references('id').inTable('crm_contacts').onDelete('SET NULL');
    });

    // Standard-Kategorien für alle bestehenden Mandanten einfügen
    const tenants = await knex('tenants').select('id');
    const defaults = [
        { name: 'Geschäftsführung', color: '#7c3aed', sort_order: 0 },
        { name: 'Buchhaltung', color: '#2563eb', sort_order: 1 },
        { name: 'Vertrieb', color: '#16a34a', sort_order: 2 },
        { name: 'Technik', color: '#d97706', sort_order: 3 },
        { name: 'Rechnungen', color: '#dc2626', sort_order: 4 },
    ];

    for (const tenant of tenants) {
        for (const cat of defaults) {
            await knex('crm_contact_categories').insert({
                tenant_id: tenant.id,
                name: cat.name,
                color: cat.color,
                sort_order: cat.sort_order,
                is_default: true,
            });
        }
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('crm_tickets', (table) => {
        table.dropColumn('contact_id');
    });
    await knex.schema.alterTable('crm_contacts', (table) => {
        table.dropColumn('category_id');
        table.dropColumn('is_billing_contact');
    });
    await knex.schema.dropTableIfExists('crm_contact_categories');
}
