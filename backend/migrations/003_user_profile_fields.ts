import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    const hasDisplayName = await knex.schema.hasColumn('users', 'display_name');
    if (!hasDisplayName) {
        await knex.schema.alterTable('users', (table) => {
            table.string('display_name', 160).nullable();
        });
    }

    const hasAvatarFile = await knex.schema.hasColumn('users', 'avatar_file');
    if (!hasAvatarFile) {
        await knex.schema.alterTable('users', (table) => {
            table.string('avatar_file', 255).nullable();
        });
    }

    const hasAvatarUpdatedAt = await knex.schema.hasColumn('users', 'avatar_updated_at');
    if (!hasAvatarUpdatedAt) {
        await knex.schema.alterTable('users', (table) => {
            table.timestamp('avatar_updated_at').nullable();
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    const hasAvatarUpdatedAt = await knex.schema.hasColumn('users', 'avatar_updated_at');
    if (hasAvatarUpdatedAt) {
        await knex.schema.alterTable('users', (table) => {
            table.dropColumn('avatar_updated_at');
        });
    }

    const hasAvatarFile = await knex.schema.hasColumn('users', 'avatar_file');
    if (hasAvatarFile) {
        await knex.schema.alterTable('users', (table) => {
            table.dropColumn('avatar_file');
        });
    }

    const hasDisplayName = await knex.schema.hasColumn('users', 'display_name');
    if (hasDisplayName) {
        await knex.schema.alterTable('users', (table) => {
            table.dropColumn('display_name');
        });
    }
}
