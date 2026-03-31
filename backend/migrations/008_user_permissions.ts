import type { Knex } from 'knex';

const TABLE_NAME = 'user_permissions';

export async function up(knex: Knex): Promise<void> {
    const hasTable = await knex.schema.hasTable(TABLE_NAME);
    if (hasTable) return;

    await knex.schema.createTable(TABLE_NAME, (table) => {
        table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.integer('permission_id').unsigned().notNullable().references('id').inTable('permissions').onDelete('CASCADE');
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.primary(['user_id', 'permission_id']);
        table.index(['permission_id']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(TABLE_NAME);
}
