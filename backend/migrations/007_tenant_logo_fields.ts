import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    const hasLogoFile = await knex.schema.hasColumn('tenants', 'logo_file');
    if (!hasLogoFile) {
        await knex.schema.alterTable('tenants', (table) => {
            table.string('logo_file', 255).nullable();
        });
    }

    const hasLogoUpdatedAt = await knex.schema.hasColumn('tenants', 'logo_updated_at');
    if (!hasLogoUpdatedAt) {
        await knex.schema.alterTable('tenants', (table) => {
            table.timestamp('logo_updated_at').nullable();
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    const hasLogoUpdatedAt = await knex.schema.hasColumn('tenants', 'logo_updated_at');
    if (hasLogoUpdatedAt) {
        await knex.schema.alterTable('tenants', (table) => {
            table.dropColumn('logo_updated_at');
        });
    }

    const hasLogoFile = await knex.schema.hasColumn('tenants', 'logo_file');
    if (hasLogoFile) {
        await knex.schema.alterTable('tenants', (table) => {
            table.dropColumn('logo_file');
        });
    }
}
