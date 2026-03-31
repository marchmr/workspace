import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // Mandanten
    const hasTenants = await knex.schema.hasTable('tenants');
    if (!hasTenants) {
        await knex.schema.createTable('tenants', (table) => {
            table.increments('id').primary();
            table.string('name', 200).notNullable().unique();
            table.string('slug', 120).notNullable().unique();
            table.boolean('is_active').notNullable().defaultTo(true);
            table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        });
    }

    // User <-> Mandant Zuordnung
    const hasUserTenants = await knex.schema.hasTable('user_tenants');
    if (!hasUserTenants) {
        await knex.schema.createTable('user_tenants', (table) => {
            table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
            table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
            table.primary(['user_id', 'tenant_id']);
            table.index(['tenant_id']);
        });
    }

    // Default-Mandant
    const existingDefault = await knex('tenants').where('slug', 'default').first();
    const tenantId = existingDefault
        ? existingDefault.id
        : (await knex('tenants').insert({
            name: 'Standard-Mandant',
            slug: 'default',
            is_active: true,
            created_at: new Date(),
        }))[0];

    // users.default_tenant_id
    const hasDefaultTenantCol = await knex.schema.hasColumn('users', 'default_tenant_id');
    if (!hasDefaultTenantCol) {
        await knex.schema.alterTable('users', (table) => {
            table.integer('default_tenant_id').unsigned().nullable().references('id').inTable('tenants').onDelete('SET NULL');
            table.index(['default_tenant_id']);
        });
    }

    // Bestehende User in Standard-Mandant zuordnen
    const users = await knex('users').select('id');
    for (const user of users) {
        const exists = await knex('user_tenants')
            .where({ user_id: user.id, tenant_id: tenantId })
            .first();
        if (!exists) {
            await knex('user_tenants').insert({
                user_id: user.id,
                tenant_id: tenantId,
                created_at: new Date(),
            });
        }
    }
    await knex('users').whereNull('default_tenant_id').update({ default_tenant_id: tenantId });

    // settings.tenant_id
    const hasSettingsTenant = await knex.schema.hasColumn('settings', 'tenant_id');
    if (!hasSettingsTenant) {
        await knex.schema.alterTable('settings', (table) => {
            table.integer('tenant_id').unsigned().nullable().references('id').inTable('tenants').onDelete('CASCADE');
            table.index(['tenant_id']);
        });
    }
    await knex('settings').whereNull('tenant_id').update({ tenant_id: tenantId });

    // Unique-Key von settings.key auf (tenant_id, key) umstellen
    try {
        await knex.raw('ALTER TABLE `settings` DROP INDEX `settings_key_unique`');
    } catch {
        // index evtl. bereits entfernt
    }
    try {
        await knex.raw('ALTER TABLE `settings` ADD UNIQUE INDEX `settings_tenant_key_unique` (`tenant_id`, `key`)');
    } catch {
        // index evtl. bereits vorhanden
    }

    // audit_log.tenant_id
    const hasAuditTenant = await knex.schema.hasColumn('audit_log', 'tenant_id');
    if (!hasAuditTenant) {
        await knex.schema.alterTable('audit_log', (table) => {
            table.integer('tenant_id').unsigned().nullable().references('id').inTable('tenants').onDelete('SET NULL');
            table.index(['tenant_id']);
        });
    }
    await knex('audit_log').whereNull('tenant_id').update({ tenant_id: tenantId });
}

export async function down(knex: Knex): Promise<void> {
    const hasAuditTenant = await knex.schema.hasColumn('audit_log', 'tenant_id');
    if (hasAuditTenant) {
        await knex.schema.alterTable('audit_log', (table) => {
            table.dropColumn('tenant_id');
        });
    }

    const hasSettingsTenant = await knex.schema.hasColumn('settings', 'tenant_id');
    if (hasSettingsTenant) {
        try {
            await knex.raw('ALTER TABLE `settings` DROP INDEX `settings_tenant_key_unique`');
        } catch {
            // ignore
        }
        try {
            await knex.raw('ALTER TABLE `settings` ADD UNIQUE INDEX `settings_key_unique` (`key`)');
        } catch {
            // ignore
        }
        await knex.schema.alterTable('settings', (table) => {
            table.dropColumn('tenant_id');
        });
    }

    const hasDefaultTenantCol = await knex.schema.hasColumn('users', 'default_tenant_id');
    if (hasDefaultTenantCol) {
        await knex.schema.alterTable('users', (table) => {
            table.dropColumn('default_tenant_id');
        });
    }

    await knex.schema.dropTableIfExists('user_tenants');
    await knex.schema.dropTableIfExists('tenants');
}
