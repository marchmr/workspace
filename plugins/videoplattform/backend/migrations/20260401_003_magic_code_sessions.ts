import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    const hasMagicCodes = await knex.schema.hasTable('vp_magic_codes');
    if (!hasMagicCodes) {
        await knex.schema.createTable('vp_magic_codes', (table) => {
            table.increments('id').primary();
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.integer('customer_id').unsigned().notNullable().references('id').inTable('vp_customers').onDelete('CASCADE');
            table.string('email_normalized', 255).notNullable();
            table.string('email_hash', 64).notNullable();
            table.string('code_hash', 64).notNullable();
            table.timestamp('expires_at').notNullable();
            table.timestamp('used_at').nullable();
            table.integer('attempts').notNullable().defaultTo(0);
            table.string('ip', 120).nullable();
            table.text('user_agent').nullable();
            table.timestamp('created_at').defaultTo(knex.fn.now());

            table.index(['tenant_id', 'customer_id', 'created_at']);
            table.index(['email_hash', 'created_at']);
            table.index(['expires_at']);
        });
    }

    const hasPublicSessions = await knex.schema.hasTable('vp_public_sessions');
    if (!hasPublicSessions) {
        await knex.schema.createTable('vp_public_sessions', (table) => {
            table.increments('id').primary();
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.integer('customer_id').unsigned().notNullable().references('id').inTable('vp_customers').onDelete('CASCADE');
            table.string('email_normalized', 255).notNullable();
            table.string('token_hash', 64).notNullable();
            table.timestamp('expires_at').notNullable();
            table.timestamp('last_used_at').nullable();
            table.timestamp('revoked_at').nullable();
            table.string('ip', 120).nullable();
            table.text('user_agent').nullable();
            table.timestamp('created_at').defaultTo(knex.fn.now());

            table.unique(['token_hash']);
            table.index(['tenant_id', 'customer_id']);
            table.index(['expires_at']);
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('vp_public_sessions');
    await knex.schema.dropTableIfExists('vp_magic_codes');
}
