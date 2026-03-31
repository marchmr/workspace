import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // Kunden-Adressen (Kundenanschrift, Rechnungsadressen, Lieferadressen, Niederlassungen, Custom)
    await knex.schema.createTable('crm_addresses', (table) => {
        table.increments('id').primary();
        table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.integer('customer_id').unsigned().notNullable().references('id').inTable('crm_customers').onDelete('CASCADE');
        table.string('address_type', 20).notNullable().defaultTo('main');
        // main = Kundenanschrift (max 1), billing = Rechnungsadresse, shipping = Lieferadresse,
        // branch = Niederlassung, custom = Benutzerdefiniert
        table.string('custom_label', 100).nullable(); // z.B. "Zweigstelle Muenchen", "Lager Sued"
        table.boolean('is_default').notNullable().defaultTo(false); // Default fuer diesen Typ
        table.string('company_name', 255).nullable(); // Abweichende Firma
        table.string('recipient', 255).nullable(); // z.B. "z.Hd. Max Mustermann"
        table.string('street', 255).nullable();
        table.string('street2', 255).nullable(); // Zusatzzeile
        table.string('zip', 20).nullable();
        table.string('city', 100).nullable();
        table.string('state', 100).nullable(); // Bundesland
        table.string('country', 100).defaultTo('Deutschland');
        table.text('notes').nullable();
        table.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());

        table.index(['tenant_id', 'customer_id']);
        table.index(['tenant_id', 'address_type']);
    });

    // Bestehende Kunden-Adressen migrieren (street/zip/city auf crm_customers -> crm_addresses)
    const customers = await knex('crm_customers')
        .whereNotNull('street')
        .orWhereNotNull('zip')
        .orWhereNotNull('city')
        .select('id', 'tenant_id', 'company_name', 'street', 'zip', 'city', 'country', 'created_by');

    for (const c of customers) {
        if (c.street || c.zip || c.city) {
            await knex('crm_addresses').insert({
                tenant_id: c.tenant_id,
                customer_id: c.id,
                address_type: 'main',
                is_default: true,
                company_name: c.company_name || null,
                street: c.street || null,
                zip: c.zip || null,
                city: c.city || null,
                country: c.country || 'Deutschland',
                created_by: c.created_by,
                created_at: new Date(),
                updated_at: new Date(),
            });
        }
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('crm_addresses');
}
