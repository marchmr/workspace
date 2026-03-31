import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    const hasColumn = await knex.schema.hasColumn('users', 'pinned_tabs_json');
    if (hasColumn) return;

    await knex.schema.alterTable('users', (table) => {
        table.text('pinned_tabs_json').nullable().defaultTo('[]');
    });
}

export async function down(knex: Knex): Promise<void> {
    const hasColumn = await knex.schema.hasColumn('users', 'pinned_tabs_json');
    if (!hasColumn) return;

    await knex.schema.alterTable('users', (table) => {
        table.dropColumn('pinned_tabs_json');
    });
}
