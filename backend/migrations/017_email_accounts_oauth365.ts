import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    const hasTable = await knex.schema.hasTable('email_accounts');
    if (!hasTable) return;

    const addIfMissing = async (column: string, cb: (table: Knex.AlterTableBuilder) => void) => {
        const exists = await knex.schema.hasColumn('email_accounts', column);
        if (!exists) {
            await knex.schema.alterTable('email_accounts', (table) => cb(table));
        }
    };

    await addIfMissing('oauth_tenant_id', (table) => table.string('oauth_tenant_id', 120).nullable());
    await addIfMissing('oauth_client_id', (table) => table.string('oauth_client_id', 255).nullable());
    await addIfMissing('oauth_client_secret', (table) => table.text('oauth_client_secret').nullable());
    await addIfMissing('oauth_refresh_token', (table) => table.text('oauth_refresh_token').nullable());
    await addIfMissing('oauth_access_token', (table) => table.text('oauth_access_token').nullable());
    await addIfMissing('oauth_access_expires_at', (table) => table.timestamp('oauth_access_expires_at').nullable());
    await addIfMissing('oauth_scope', (table) => table.string('oauth_scope', 500).nullable());
}

export async function down(knex: Knex): Promise<void> {
    const hasTable = await knex.schema.hasTable('email_accounts');
    if (!hasTable) return;

    const dropIfExists = async (column: string) => {
        const exists = await knex.schema.hasColumn('email_accounts', column);
        if (exists) {
            await knex.schema.alterTable('email_accounts', (table) => {
                table.dropColumn(column);
            });
        }
    };

    await dropIfExists('oauth_scope');
    await dropIfExists('oauth_access_expires_at');
    await dropIfExists('oauth_access_token');
    await dropIfExists('oauth_refresh_token');
    await dropIfExists('oauth_client_secret');
    await dropIfExists('oauth_client_id');
    await dropIfExists('oauth_tenant_id');
}
