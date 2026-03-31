import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // Users
    await knex.schema.createTable('users', (table) => {
        table.increments('id').primary();
        table.string('username', 100).notNullable().unique();
        table.string('email', 255).notNullable().unique();
        table.string('password_hash', 255).notNullable();
        table.boolean('is_active').notNullable().defaultTo(true);
        table.text('mfa_secret_encrypted').nullable();
        table.boolean('mfa_enabled').notNullable().defaultTo(false);
        table.text('recovery_codes_encrypted').nullable();
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });

    // Roles
    await knex.schema.createTable('roles', (table) => {
        table.increments('id').primary();
        table.string('name', 100).notNullable().unique();
        table.string('description', 500).nullable();
        table.boolean('is_system').notNullable().defaultTo(false);
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });

    // Permissions
    await knex.schema.createTable('permissions', (table) => {
        table.increments('id').primary();
        table.string('key', 100).notNullable().unique();
        table.string('label', 200).notNullable();
        table.string('description', 500).nullable();
        table.string('plugin_id', 100).nullable();
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });

    // Role-Permission (Many-to-Many)
    await knex.schema.createTable('role_permissions', (table) => {
        table.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('CASCADE');
        table.integer('permission_id').unsigned().notNullable().references('id').inTable('permissions').onDelete('CASCADE');
        table.primary(['role_id', 'permission_id']);
    });

    // User-Role (Many-to-Many)
    await knex.schema.createTable('user_roles', (table) => {
        table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('CASCADE');
        table.primary(['user_id', 'role_id']);
    });

    // Refresh Tokens
    await knex.schema.createTable('refresh_tokens', (table) => {
        table.increments('id').primary();
        table.string('token_hash', 64).notNullable().unique();
        table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
        table.timestamp('expires_at').notNullable();
        table.boolean('is_revoked').notNullable().defaultTo(false);
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });

    // Login Attempts
    await knex.schema.createTable('login_attempts', (table) => {
        table.increments('id').primary();
        table.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
        table.string('ip_address', 45).notNullable();
        table.boolean('success').notNullable();
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });

    // Settings
    await knex.schema.createTable('settings', (table) => {
        table.increments('id').primary();
        table.string('key', 200).notNullable().unique();
        table.text('value_encrypted').nullable();
        table.string('category', 100).notNullable().defaultTo('general');
        table.string('plugin_id', 100).nullable();
    });

    // Plugins
    await knex.schema.createTable('plugins', (table) => {
        table.increments('id').primary();
        table.string('plugin_id', 100).notNullable().unique();
        table.string('name', 200).notNullable();
        table.string('version', 50).notNullable();
        table.boolean('is_active').notNullable().defaultTo(false);
        table.timestamp('installed_at').notNullable().defaultTo(knex.fn.now());
    });

    // Audit Log
    await knex.schema.createTable('audit_log', (table) => {
        table.increments('id').primary();
        table.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
        table.string('action', 200).notNullable();
        table.enum('category', ['auth', 'data', 'admin', 'plugin']).notNullable();
        table.string('entity_type', 100).nullable();
        table.string('entity_id', 100).nullable();
        table.json('previous_state').nullable();
        table.json('new_state').nullable();
        table.string('ip_address', 45).nullable();
        table.string('user_agent', 500).nullable();
        table.string('plugin_id', 100).nullable();
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

        // Indices fuer schnelle Filterung
        table.index(['category']);
        table.index(['user_id']);
        table.index(['entity_type', 'entity_id']);
        table.index(['created_at']);
        table.index(['plugin_id']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('audit_log');
    await knex.schema.dropTableIfExists('plugins');
    await knex.schema.dropTableIfExists('settings');
    await knex.schema.dropTableIfExists('login_attempts');
    await knex.schema.dropTableIfExists('refresh_tokens');
    await knex.schema.dropTableIfExists('user_roles');
    await knex.schema.dropTableIfExists('role_permissions');
    await knex.schema.dropTableIfExists('permissions');
    await knex.schema.dropTableIfExists('roles');
    await knex.schema.dropTableIfExists('users');
}
