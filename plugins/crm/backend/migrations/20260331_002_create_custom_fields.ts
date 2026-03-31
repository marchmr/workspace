import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    const exists = await knex.schema.hasTable('crm_custom_field_definitions');
    if (!exists) {
        await knex.schema.createTable('crm_custom_field_definitions', (table) => {
            table.increments('id').primary();
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.string('field_key', 50).notNullable();
            table.string('label', 100).notNullable();
            table.enum('field_type', ['text', 'number', 'date', 'select', 'checkbox', 'textarea']).notNullable().defaultTo('text');
            table.json('options').nullable();
            table.boolean('required').notNullable().defaultTo(false);
            table.integer('sort_order').unsigned().defaultTo(0);
            table.enum('entity_type', ['customer', 'ticket', 'contact']).notNullable().defaultTo('customer');
            table.boolean('is_active').notNullable().defaultTo(true);
            table.timestamp('created_at').defaultTo(knex.fn.now());

            table.index(['tenant_id', 'entity_type']);
            // MariaDB: max 64 Zeichen fuer Constraint-Namen
            table.unique(['tenant_id', 'field_key', 'entity_type'], { indexName: 'crm_cfd_tenant_key_entity_uniq' });
        });
    } else {
        // Tabelle existiert bereits (z.B. von fehlgeschlagenem Run), Unique-Constraint nachholen
        try {
            await knex.schema.alterTable('crm_custom_field_definitions', (table) => {
                table.unique(['tenant_id', 'field_key', 'entity_type'], { indexName: 'crm_cfd_tenant_key_entity_uniq' });
            });
        } catch { /* Constraint existiert bereits */ }
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('crm_custom_field_definitions');
}
