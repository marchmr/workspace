/**
 * Migration 012: Erweiterungen fuer v1.14.0
 * - plugins.installed_version: Versionstracking fuer Lifecycle-Hooks
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // Plugin Lifecycle: Version tracking
    const hasCol = await knex.schema.hasColumn('plugins', 'installed_version');
    if (!hasCol) {
        await knex.schema.alterTable('plugins', (table) => {
            table.string('installed_version', 50).nullable();
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    const hasCol = await knex.schema.hasColumn('plugins', 'installed_version');
    if (hasCol) {
        await knex.schema.alterTable('plugins', (table) => {
            table.dropColumn('installed_version');
        });
    }
}
