import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('crm_customers', (table) => {
        table.increments('id').primary();
        table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.string('customer_number', 50).notNullable();
        table.enum('type', ['company', 'person']).notNullable().defaultTo('company');
        table.string('company_name', 255).nullable();
        table.string('salutation', 20).nullable();
        table.string('first_name', 100).nullable();
        table.string('last_name', 100).nullable();
        table.string('email', 255).nullable();
        table.string('phone', 50).nullable();
        table.string('mobile', 50).nullable();
        table.string('fax', 50).nullable();
        table.string('website', 500).nullable();
        table.string('street', 255).nullable();
        table.string('zip', 20).nullable();
        table.string('city', 100).nullable();
        table.string('country', 100).defaultTo('Deutschland');
        table.string('vat_id', 50).nullable();
        table.string('industry', 100).nullable();
        table.string('category', 100).nullable();
        table.enum('status', ['active', 'inactive', 'prospect']).notNullable().defaultTo('active');
        table.string('payment_terms', 255).nullable();
        table.text('notes_internal').nullable();
        table.json('custom_fields').nullable();
        table.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());

        table.index(['tenant_id', 'status']);
        table.index(['tenant_id', 'customer_number']);
        table.index(['tenant_id', 'company_name']);
        table.index(['tenant_id', 'last_name']);
        table.index(['tenant_id', 'email']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('crm_customers');
}
