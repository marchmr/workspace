import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    const hasEvents = await knex.schema.hasTable('accounting_connector_events');
    if (!hasEvents) {
        await knex.schema.createTable('accounting_connector_events', (table) => {
            table.increments('id').primary();
            table.string('event_id', 191).notNullable().unique();
            table.string('event_type', 150).notNullable();
            table.string('nonce', 255).notNullable();
            table.string('timestamp_header', 64).notNullable();
            table.string('body_sha256', 64).notNullable();
            table.text('payload_json', 'longtext').notNullable();
            table.enum('status', ['processed', 'failed']).notNullable().defaultTo('processed');
            table.integer('duplicate_count').notNullable().defaultTo(0);
            table.string('source_ip', 120).nullable();
            table.timestamp('processed_at').notNullable().defaultTo(knex.fn.now());
            table.timestamp('last_seen_at').notNullable().defaultTo(knex.fn.now());
            table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
            table.index(['event_type', 'created_at']);
        });
    }

    const hasNonces = await knex.schema.hasTable('accounting_connector_nonces');
    if (!hasNonces) {
        await knex.schema.createTable('accounting_connector_nonces', (table) => {
            table.string('nonce', 255).primary();
            table.string('event_id', 191).nullable();
            table.timestamp('seen_at').notNullable().defaultTo(knex.fn.now());
            table.index(['seen_at']);
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('accounting_connector_nonces');
    await knex.schema.dropTableIfExists('accounting_connector_events');
}
