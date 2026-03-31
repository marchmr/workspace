import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('vp_customers', (table) => {
        table.increments('id').primary();
        table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.string('name', 255).notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());

        table.unique(['tenant_id', 'name']);
        table.index(['tenant_id', 'created_at']);
    });

    await knex.schema.createTable('vp_videos', (table) => {
        table.increments('id').primary();
        table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.string('title', 255).notNullable();
        table.text('description').nullable();
        table.enum('source_type', ['upload', 'url']).notNullable().defaultTo('upload');
        table.text('video_url').nullable();
        table.string('file_name', 255).nullable();
        table.string('file_path', 600).nullable();
        table.string('mime_type', 120).nullable();
        table.bigInteger('size_bytes').nullable();
        table.string('category', 120).notNullable().defaultTo('Allgemein');
        table.integer('customer_id').unsigned().nullable().references('id').inTable('vp_customers').onDelete('SET NULL');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());

        table.index(['tenant_id', 'created_at']);
        table.index(['tenant_id', 'customer_id']);
        table.index(['tenant_id', 'category']);
    });

    await knex.schema.createTable('vp_share_codes', (table) => {
        table.increments('id').primary();
        table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.enum('scope', ['video', 'customer']).notNullable().defaultTo('video');
        table.integer('video_id').unsigned().nullable().references('id').inTable('vp_videos').onDelete('CASCADE');
        table.integer('customer_id').unsigned().nullable().references('id').inTable('vp_customers').onDelete('CASCADE');
        table.string('code', 40).notNullable();
        table.boolean('is_active').notNullable().defaultTo(true);
        table.timestamp('expires_at').nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());

        table.unique(['tenant_id', 'code']);
        table.index(['tenant_id', 'scope']);
        table.index(['tenant_id', 'video_id']);
        table.index(['tenant_id', 'customer_id']);
    });

    await knex.schema.createTable('vp_activity_logs', (table) => {
        table.increments('id').primary();
        table.integer('tenant_id').unsigned().nullable().references('id').inTable('tenants').onDelete('SET NULL');
        table.string('event_type', 80).notNullable();
        table.string('ip', 120).nullable();
        table.text('user_agent').nullable();
        table.integer('video_id').unsigned().nullable().references('id').inTable('vp_videos').onDelete('SET NULL');
        table.integer('customer_id').unsigned().nullable().references('id').inTable('vp_customers').onDelete('SET NULL');
        table.string('code', 40).nullable();
        table.boolean('success').notNullable().defaultTo(false);
        table.text('detail').nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());

        table.index(['tenant_id', 'created_at']);
        table.index(['event_type', 'created_at']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('vp_activity_logs');
    await knex.schema.dropTableIfExists('vp_share_codes');
    await knex.schema.dropTableIfExists('vp_videos');
    await knex.schema.dropTableIfExists('vp_customers');
}
