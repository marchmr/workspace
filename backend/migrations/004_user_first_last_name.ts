import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    const hasFirstName = await knex.schema.hasColumn('users', 'first_name');
    if (!hasFirstName) {
        await knex.schema.alterTable('users', (table) => {
            table.string('first_name', 120).nullable();
        });
    }

    const hasLastName = await knex.schema.hasColumn('users', 'last_name');
    if (!hasLastName) {
        await knex.schema.alterTable('users', (table) => {
            table.string('last_name', 120).nullable();
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    const hasLastName = await knex.schema.hasColumn('users', 'last_name');
    if (hasLastName) {
        await knex.schema.alterTable('users', (table) => {
            table.dropColumn('last_name');
        });
    }

    const hasFirstName = await knex.schema.hasColumn('users', 'first_name');
    if (hasFirstName) {
        await knex.schema.alterTable('users', (table) => {
            table.dropColumn('first_name');
        });
    }
}
