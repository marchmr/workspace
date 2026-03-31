import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // Neue Tabelle fuer E-Mail-Konten
    await knex.schema.createTable('email_accounts', (table) => {
        table.increments('id').primary();
        table.string('name', 100).notNullable();
        table.string('provider', 20).notNullable().defaultTo('smtp');
        table.string('smtp_host', 255).nullable();
        table.integer('smtp_port').nullable().defaultTo(587);
        table.string('smtp_user', 255).nullable();
        table.text('smtp_password').nullable(); // AES-256-GCM verschluesselt
        table.boolean('smtp_secure').notNullable().defaultTo(true);
        table.string('from_address', 255).nullable();
        table.string('from_name', 100).nullable();
        table.boolean('is_default').notNullable().defaultTo(false);
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });

    // Bestehende Single-Email-Konfiguration migrieren
    const existing = await knex('settings')
        .where('plugin_id', 'core.email')
        .select('key', 'value_encrypted');

    if (existing.length > 0) {
        const settings: Record<string, string> = {};
        for (const row of existing) {
            settings[row.key] = row.value_encrypted || '';
        }

        if (settings.provider && settings.provider !== 'none') {
            await knex('email_accounts').insert({
                name: 'Standard',
                provider: settings.provider || 'smtp',
                smtp_host: settings.smtp_host || null,
                smtp_port: settings.smtp_port ? parseInt(settings.smtp_port, 10) : 587,
                smtp_user: settings.smtp_user || null,
                smtp_password: settings.smtp_password || null,
                smtp_secure: settings.smtp_secure === 'true',
                from_address: settings.from_address || null,
                from_name: settings.from_name || null,
                is_default: true,
            });
        }

        // Alte Settings bereinigen
        await knex('settings').where('plugin_id', 'core.email').del();
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('email_accounts');
}
