import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('plugin_quicklinks', (table) => {
        table.increments('id').primary();
        table.string('url', 2000).notNullable();
        table.string('title', 255).notNullable();
        table.string('category', 100).defaultTo('Allgemein');
        table.text('favicon_base64').nullable();
        table.enum('scope', ['personal', 'tenant']).notNullable().defaultTo('personal');
        table.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('CASCADE');
        table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.integer('sort_order').unsigned().defaultTo(0);
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());

        table.index(['tenant_id', 'scope']);
        table.index(['user_id', 'scope']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('plugin_quicklinks');
}
