import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    const hasColumn = await knex.schema.hasColumn('vp_customers', 'crm_customer_id');
    if (!hasColumn) {
        await knex.schema.alterTable('vp_customers', (table) => {
            table.integer('crm_customer_id').unsigned().nullable().references('id').inTable('crm_customers').onDelete('SET NULL');
            table.index(['tenant_id', 'crm_customer_id'], 'vp_customers_tenant_crm_idx');
        });
    }

    const hasUniqueIndex = await knex.schema.hasTable('vp_customers').then(() => true).catch(() => false);
    if (hasUniqueIndex) {
        try {
            await knex.schema.raw('CREATE UNIQUE INDEX vp_customers_tenant_crm_unique ON vp_customers (tenant_id, crm_customer_id)');
        } catch {
            // Index already exists or DB does not support this exact statement shape.
        }
    }
}

export async function down(knex: Knex): Promise<void> {
    const hasColumn = await knex.schema.hasColumn('vp_customers', 'crm_customer_id');
    if (!hasColumn) return;

    try {
        await knex.schema.raw('DROP INDEX vp_customers_tenant_crm_unique');
    } catch {
        // ignore
    }

    await knex.schema.alterTable('vp_customers', (table) => {
        table.dropIndex(['tenant_id', 'crm_customer_id'], 'vp_customers_tenant_crm_idx');
        table.dropColumn('crm_customer_id');
    });
}
