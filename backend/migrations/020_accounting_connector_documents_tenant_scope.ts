import type { Knex } from 'knex';

const TABLE = 'accounting_connector_documents';

export async function up(knex: Knex): Promise<void> {
    const hasTable = await knex.schema.hasTable(TABLE);
    if (!hasTable) return;

    const hasTenantId = await knex.schema.hasColumn(TABLE, 'tenant_id').catch(() => false);
    if (!hasTenantId) {
        await knex.schema.alterTable(TABLE, (table) => {
            table.integer('tenant_id').unsigned().nullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.index(['tenant_id', 'document_category'], 'acd_tenant_category_idx');
            table.index(['tenant_id', 'customer_number', 'document_category'], 'acd_tenant_customer_number_category_idx');
            table.index(['tenant_id', 'customer_id', 'document_category'], 'acd_tenant_customer_id_category_idx');
            table.index(['tenant_id', 'entity_id', 'document_category'], 'acd_tenant_entity_id_category_idx');
        });
    }

    // Alten globalen UNIQUE-Key auf record_key entfernen (mandantenübergreifend zu strikt).
    await knex.raw(`ALTER TABLE ${TABLE} DROP INDEX record_key`).catch(() => undefined);
    await knex.raw(`ALTER TABLE ${TABLE} DROP INDEX accounting_connector_documents_record_key_unique`).catch(() => undefined);
    await knex.raw(`ALTER TABLE ${TABLE} DROP INDEX ${TABLE}_record_key_unique`).catch(() => undefined);

    // Best-effort Backfill: Wenn ein Event tenant_id enthält, übernehmen wir ihn.
    await knex.raw(`
        UPDATE ${TABLE}
        SET tenant_id = CAST(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.tenant_id')) AS UNSIGNED)
        WHERE tenant_id IS NULL
          AND JSON_EXTRACT(payload_json, '$.tenant_id') IS NOT NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.tenant_id')) REGEXP '^[0-9]+$'
    `).catch(() => undefined);

    // Falls exakt ein aktiver Tenant existiert, setze verbleibende NULL-Einträge auf diesen Tenant.
    const activeTenants = await knex('tenants')
        .where('is_active', true)
        .select('id');
    if (activeTenants.length === 1) {
        const tenantId = Number(activeTenants[0].id);
        if (Number.isInteger(tenantId) && tenantId > 0) {
            await knex(TABLE)
                .whereNull('tenant_id')
                .update({ tenant_id: tenantId });
        }
    }

    // Neuer mandanten-scharfer UNIQUE-Key.
    await knex.schema.alterTable(TABLE, (table) => {
        table.unique(['tenant_id', 'record_key'], 'acd_tenant_record_key_uniq');
    }).catch(() => undefined);
}

export async function down(knex: Knex): Promise<void> {
    const hasTable = await knex.schema.hasTable(TABLE);
    if (!hasTable) return;

    const hasTenantId = await knex.schema.hasColumn(TABLE, 'tenant_id').catch(() => false);
    if (!hasTenantId) return;

    await knex.schema.alterTable(TABLE, (table) => {
        table.dropUnique(['tenant_id', 'record_key'], 'acd_tenant_record_key_uniq');
        table.dropIndex(['tenant_id', 'document_category'], 'acd_tenant_category_idx');
        table.dropIndex(['tenant_id', 'customer_number', 'document_category'], 'acd_tenant_customer_number_category_idx');
        table.dropIndex(['tenant_id', 'customer_id', 'document_category'], 'acd_tenant_customer_id_category_idx');
        table.dropIndex(['tenant_id', 'entity_id', 'document_category'], 'acd_tenant_entity_id_category_idx');
        table.dropColumn('tenant_id');
    });

    // Rückbau: globaler record_key unique wiederherstellen.
    await knex.schema.alterTable(TABLE, (table) => {
        table.unique(['record_key'], 'accounting_connector_documents_record_key_unique');
    }).catch(() => undefined);
}
