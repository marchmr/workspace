import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // Notifications
    await knex.schema.createTable('notifications', (table) => {
        table.increments('id').primary();
        table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.string('title', 255).notNullable();
        table.text('message').nullable();
        table.string('link', 500).nullable();
        table.enum('type', ['info', 'success', 'warning', 'error']).notNullable().defaultTo('info');
        table.boolean('is_read').notNullable().defaultTo(false);
        table.string('plugin_id', 100).nullable();
        table.integer('tenant_id').unsigned().nullable().references('id').inTable('tenants').onDelete('SET NULL');
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.index(['user_id', 'is_read']);
        table.index(['user_id', 'created_at']);
    });

    // Webhooks
    await knex.schema.createTable('webhooks', (table) => {
        table.increments('id').primary();
        table.string('name', 200).notNullable();
        table.string('url', 1000).notNullable();
        table.string('secret', 500).notNullable();
        table.json('events').notNullable(); // Array of event names
        table.boolean('is_active').notNullable().defaultTo(true);
        table.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
        table.integer('tenant_id').unsigned().nullable().references('id').inTable('tenants').onDelete('SET NULL');
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });

    // Webhook Logs
    await knex.schema.createTable('webhook_logs', (table) => {
        table.increments('id').primary();
        table.integer('webhook_id').unsigned().notNullable().references('id').inTable('webhooks').onDelete('CASCADE');
        table.string('event', 200).notNullable();
        table.text('payload').nullable();
        table.integer('status_code').nullable();
        table.text('response_body').nullable();
        table.text('error').nullable();
        table.integer('duration_ms').nullable();
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.index(['webhook_id', 'created_at']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('webhook_logs');
    await knex.schema.dropTableIfExists('webhooks');
    await knex.schema.dropTableIfExists('notifications');
}
