import type { Knex } from 'knex';

const TABLE = 'accounting_connector_documents';

export async function up(knex: Knex): Promise<void> {
    const hasTable = await knex.schema.hasTable(TABLE);
    if (!hasTable) {
        await knex.schema.createTable(TABLE, (table) => {
            table.increments('id').primary();
            table.string('record_key', 400).notNullable().unique();
            table.string('source', 120).notNullable().defaultTo('hammer');
            table.string('document_category', 40).notNullable();
            table.string('document_id', 191).notNullable();
            table.string('document_number', 191).nullable();
            table.string('event_id', 191).notNullable();
            table.string('event_type', 150).notNullable();
            table.string('event_type_original', 150).nullable();
            table.string('document_status', 100).nullable();
            table.string('payment_status', 100).nullable();
            table.decimal('amount_total', 14, 2).nullable();
            table.decimal('amount_paid', 14, 2).nullable();
            table.decimal('amount_open', 14, 2).nullable();
            table.string('currency', 16).nullable();
            table.string('document_date', 64).nullable();
            table.string('due_date', 64).nullable();
            table.string('paid_at', 64).nullable();
            table.string('finalized_at', 64).nullable();
            table.string('entity_id', 191).nullable();
            table.string('customer_id', 191).nullable();
            table.string('customer_number', 191).nullable();
            table.string('source_invoice_id', 191).nullable();
            table.string('related_invoice_id', 191).nullable();
            table.string('source_credit_id', 191).nullable();
            table.string('pdf_file_name', 255).nullable();
            table.string('pdf_sha256', 64).nullable();
            table.string('pdf_storage_path', 500).nullable();
            table.text('payload_json', 'longtext').notNullable();
            table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
            table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

            table.index(['document_category', 'updated_at'], 'acd_category_updated_idx');
            table.index(['customer_id', 'document_category'], 'acd_customer_category_idx');
            table.index(['customer_number', 'document_category'], 'acd_customer_number_category_idx');
            table.index(['entity_id', 'document_category'], 'acd_entity_category_idx');
            table.index(['event_id'], 'acd_event_idx');
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(TABLE);
}
