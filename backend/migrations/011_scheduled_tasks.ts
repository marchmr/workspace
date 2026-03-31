import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('scheduled_tasks', (table) => {
        table.increments('id').primary();
        table.string('task_id', 100).notNullable().unique();
        table.string('name', 255).notNullable();
        table.string('cron_expression', 100).notNullable();
        table.string('plugin_id', 100).nullable();
        table.boolean('is_active').defaultTo(true);
        table.timestamp('last_run_at').nullable();
        table.timestamp('next_run_at').nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
    });

    await knex.schema.createTable('scheduled_task_runs', (table) => {
        table.increments('id').primary();
        table.string('task_id', 100).notNullable();
        table.timestamp('started_at').notNullable();
        table.timestamp('finished_at').nullable();
        table.enum('status', ['running', 'success', 'error']).defaultTo('running');
        table.text('error_message').nullable();
        table.integer('duration_ms').nullable();
        table.index(['task_id', 'started_at']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('scheduled_task_runs');
    await knex.schema.dropTableIfExists('scheduled_tasks');
}
