import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // Notifications: urgent + category Felder hinzufuegen
    const hasUrgent = await knex.schema.hasColumn('notifications', 'urgent');
    if (!hasUrgent) {
        await knex.schema.alterTable('notifications', (table) => {
            table.boolean('urgent').notNullable().defaultTo(false);
            table.string('category', 100).nullable();
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    const hasUrgent = await knex.schema.hasColumn('notifications', 'urgent');
    if (hasUrgent) {
        await knex.schema.alterTable('notifications', (table) => {
            table.dropColumn('urgent');
            table.dropColumn('category');
        });
    }
}
