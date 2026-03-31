import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // Kundenakte-Layout pro User (kundenübergreifend)
    await knex.schema.createTable('crm_customer_layouts', (table) => {
        table.increments('id').primary();
        table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.text('layout_json').notNullable().defaultTo('{}');
        table.timestamp('updated_at').defaultTo(knex.fn.now());

        table.unique(['user_id']);
    });

    // Zuletzt geöffnete Kunden
    await knex.schema.createTable('crm_recent_customers', (table) => {
        table.increments('id').primary();
        table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.integer('customer_id').unsigned().notNullable().references('id').inTable('crm_customers').onDelete('CASCADE');
        table.timestamp('opened_at').defaultTo(knex.fn.now());

        table.index(['user_id']);
    });

    // Favoriten
    await knex.schema.createTable('crm_favorites', (table) => {
        table.increments('id').primary();
        table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.integer('customer_id').unsigned().notNullable().references('id').inTable('crm_customers').onDelete('CASCADE');
        table.timestamp('created_at').defaultTo(knex.fn.now());

        table.unique(['user_id', 'customer_id']);
    });

    // Aktivitaets-Timeline
    await knex.schema.createTable('crm_activities', (table) => {
        table.increments('id').primary();
        table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.integer('customer_id').unsigned().notNullable().references('id').inTable('crm_customers').onDelete('CASCADE');
        table.string('type', 50).notNullable();
        table.string('title', 500).notNullable();
        table.string('entity_type', 50).nullable();
        table.integer('entity_id').unsigned().nullable();
        table.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
        table.json('metadata').nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());

        table.index(['customer_id']);
        table.index(['tenant_id', 'customer_id']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('crm_activities');
    await knex.schema.dropTableIfExists('crm_favorites');
    await knex.schema.dropTableIfExists('crm_recent_customers');
    await knex.schema.dropTableIfExists('crm_customer_layouts');
}
