import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('plugin_todo_items', (table) => {
        table.integer('total_seconds').unsigned().defaultTo(0);
        table.timestamp('timer_started_at').nullable();
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('plugin_todo_items', (table) => {
        table.dropColumn('total_seconds');
        table.dropColumn('timer_started_at');
    });
}
