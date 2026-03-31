import type { Knex } from 'knex';

const TABLE_NAME = 'user_dashboard_layouts';

export async function up(knex: Knex): Promise<void> {
    const hasTable = await knex.schema.hasTable(TABLE_NAME);
    if (hasTable) return;

    await knex.schema.createTable(TABLE_NAME, (table) => {
        table.integer('user_id').unsigned().primary().references('id').inTable('users').onDelete('CASCADE');
        table.text('layout_json', 'longtext').notNullable();
        table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(TABLE_NAME);
}
