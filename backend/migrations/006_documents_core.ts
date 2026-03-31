import type { Knex } from 'knex';

const DOCUMENTS_TABLE = 'documents';
const DOCUMENT_PERMISSIONS_TABLE = 'document_permissions';
const DOCUMENT_LINKS_TABLE = 'document_links';

export async function up(knex: Knex): Promise<void> {
    const hasDocuments = await knex.schema.hasTable(DOCUMENTS_TABLE);
    if (!hasDocuments) {
        await knex.schema.createTable(DOCUMENTS_TABLE, (table) => {
            table.increments('id').primary();
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.string('plugin_id', 100).nullable();
            table.string('title', 255).notNullable();
            table.string('description', 1000).nullable();
            table.string('original_file_name', 255).notNullable();
            table.string('storage_provider', 50).notNullable().defaultTo('local');
            table.string('storage_key', 500).notNullable().unique();
            table.string('mime_type', 120).notNullable();
            table.bigInteger('size_bytes').unsigned().notNullable();
            table.string('sha256_hash', 64).nullable();
            table.enum('access_mode', ['any', 'all']).notNullable().defaultTo('any');
            table.integer('uploaded_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
            table.boolean('is_deleted').notNullable().defaultTo(false);
            table.timestamp('deleted_at').nullable();
            table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
            table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

            table.index(['tenant_id']);
            table.index(['plugin_id']);
            table.index(['is_deleted']);
            table.index(['created_at']);
        });
    }

    const hasDocumentPermissions = await knex.schema.hasTable(DOCUMENT_PERMISSIONS_TABLE);
    if (!hasDocumentPermissions) {
        await knex.schema.createTable(DOCUMENT_PERMISSIONS_TABLE, (table) => {
            table.increments('id').primary();
            table.integer('document_id').unsigned().notNullable().references('id').inTable(DOCUMENTS_TABLE).onDelete('CASCADE');
            table.string('permission_key', 160).notNullable();
            table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

            table.unique(['document_id', 'permission_key']);
            table.index(['permission_key']);
        });
    }

    const hasDocumentLinks = await knex.schema.hasTable(DOCUMENT_LINKS_TABLE);
    if (!hasDocumentLinks) {
        await knex.schema.createTable(DOCUMENT_LINKS_TABLE, (table) => {
            table.increments('id').primary();
            table.integer('document_id').unsigned().notNullable().references('id').inTable(DOCUMENTS_TABLE).onDelete('CASCADE');
            table.string('plugin_id', 100).nullable();
            table.string('entity_type', 160).nullable();
            table.string('entity_id', 160).nullable();
            table.string('label', 200).nullable();
            table.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
            table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

            table.index(['document_id']);
            table.index(['plugin_id', 'entity_type', 'entity_id']);
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(DOCUMENT_LINKS_TABLE);
    await knex.schema.dropTableIfExists(DOCUMENT_PERMISSIONS_TABLE);
    await knex.schema.dropTableIfExists(DOCUMENTS_TABLE);
}
