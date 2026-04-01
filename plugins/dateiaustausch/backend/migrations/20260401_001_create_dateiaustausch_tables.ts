import type { Knex } from 'knex';

const ITEMS_TABLE = 'dtx_items';
const VERSIONS_TABLE = 'dtx_versions';
const COMMENTS_TABLE = 'dtx_comments';

export async function up(knex: Knex): Promise<void> {
    const hasItems = await knex.schema.hasTable(ITEMS_TABLE);
    if (!hasItems) {
        await knex.schema.createTable(ITEMS_TABLE, (table) => {
            table.increments('id').primary();
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.integer('customer_id').unsigned().notNullable().references('id').inTable('vp_customers').onDelete('CASCADE');
            table.string('folder_path', 255).notNullable().defaultTo('');
            table.string('display_name', 255).notNullable();
            table.integer('current_version_id').unsigned().nullable();
            table.enum('workflow_status', ['pending', 'clean', 'rejected', 'reviewed']).notNullable().defaultTo('pending');
            table.timestamp('last_activity_at').defaultTo(knex.fn.now());
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('updated_at').defaultTo(knex.fn.now());
            table.index(['tenant_id', 'customer_id']);
            table.index(['tenant_id', 'workflow_status']);
            table.index(['tenant_id', 'updated_at']);
        });
    }

    const hasVersions = await knex.schema.hasTable(VERSIONS_TABLE);
    if (!hasVersions) {
        await knex.schema.createTable(VERSIONS_TABLE, (table) => {
            table.increments('id').primary();
            table.integer('item_id').unsigned().notNullable().references('id').inTable(ITEMS_TABLE).onDelete('CASCADE');
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.integer('version_no').unsigned().notNullable();
            table.enum('storage_zone', ['quarantine', 'clean', 'rejected']).notNullable().defaultTo('quarantine');
            table.string('storage_key', 800).notNullable();
            table.string('original_file_name', 255).notNullable();
            table.string('mime_type', 140).notNullable();
            table.string('detected_mime_type', 140).nullable();
            table.bigInteger('size_bytes').notNullable();
            table.string('sha256_hash', 64).notNullable();
            table.enum('scan_status', ['pending', 'clean', 'infected', 'error', 'skipped']).notNullable().defaultTo('pending');
            table.string('scan_engine', 80).nullable();
            table.string('scan_signature', 255).nullable();
            table.text('scan_meta').nullable();
            table.enum('uploaded_by_type', ['customer', 'admin']).notNullable();
            table.integer('uploaded_by_user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
            table.string('uploaded_by_email', 255).nullable();
            table.string('uploaded_ip', 120).nullable();
            table.text('uploaded_user_agent').nullable();
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.unique(['item_id', 'version_no']);
            table.index(['tenant_id', 'scan_status']);
            table.index(['tenant_id', 'created_at']);
        });
    }

    const hasComments = await knex.schema.hasTable(COMMENTS_TABLE);
    if (!hasComments) {
        await knex.schema.createTable(COMMENTS_TABLE, (table) => {
            table.increments('id').primary();
            table.integer('item_id').unsigned().notNullable().references('id').inTable(ITEMS_TABLE).onDelete('CASCADE');
            table.integer('version_id').unsigned().nullable().references('id').inTable(VERSIONS_TABLE).onDelete('SET NULL');
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.enum('author_type', ['customer', 'admin', 'system']).notNullable();
            table.integer('author_user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
            table.string('author_display', 255).nullable();
            table.text('message').notNullable();
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.index(['tenant_id', 'item_id']);
            table.index(['tenant_id', 'created_at']);
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(COMMENTS_TABLE);
    await knex.schema.dropTableIfExists(VERSIONS_TABLE);
    await knex.schema.dropTableIfExists(ITEMS_TABLE);
}
