import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('plugin_todo_items', (table) => {
        table.increments('id').primary();
        table.string('title', 500).notNullable();
        table.text('description').defaultTo('');
        table.enum('priority', ['niedrig', 'mittel', 'hoch', 'dringend']).defaultTo('mittel');
        table.enum('status', ['offen', 'in_bearbeitung', 'erledigt']).defaultTo('offen');
        table.date('due_date').nullable();
        table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.integer('sort_order').unsigned().defaultTo(0);
        table.timestamp('completed_at').nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());

        table.index(['user_id', 'status']);
        table.index(['user_id', 'due_date']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('plugin_todo_items');
}
