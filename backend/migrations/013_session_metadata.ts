import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // ip_address und user_agent fuer Session-Management
    const hasIp = await knex.schema.hasColumn('refresh_tokens', 'ip_address');
    if (!hasIp) {
        await knex.schema.alterTable('refresh_tokens', (table) => {
            table.string('ip_address', 45).nullable();
            table.string('user_agent', 500).nullable();
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    const hasIp = await knex.schema.hasColumn('refresh_tokens', 'ip_address');
    if (hasIp) {
        await knex.schema.alterTable('refresh_tokens', (table) => {
            table.dropColumn('ip_address');
            table.dropColumn('user_agent');
        });
    }
}
