import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
    // Tickets
    await knex.schema.createTable('crm_tickets', (table) => {
        table.increments('id').primary();
        table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.string('ticket_number', 50).notNullable();
        table.integer('customer_id').unsigned().nullable().references('id').inTable('crm_customers').onDelete('SET NULL');
        table.string('subject', 500).notNullable();
        table.text('description').nullable();
        table.enum('status', ['open', 'in_progress', 'waiting', 'resolved', 'closed']).notNullable().defaultTo('open');
        table.enum('priority', ['low', 'normal', 'high', 'urgent']).notNullable().defaultTo('normal');
        table.string('category', 100).nullable();
        table.integer('assigned_to').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
        table.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
        table.timestamp('due_date').nullable();
        table.timestamp('resolved_at').nullable();
        table.timestamp('closed_at').nullable();
        table.json('custom_fields').nullable();
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());

        table.index(['tenant_id', 'status']);
        table.index(['tenant_id', 'customer_id']);
        table.index(['tenant_id', 'assigned_to']);
        table.index(['tenant_id', 'ticket_number']);
        table.index(['tenant_id', 'priority']);
    });

    // Ticket-Kommentare
    await knex.schema.createTable('crm_ticket_comments', (table) => {
        table.increments('id').primary();
        table.integer('ticket_id').unsigned().notNullable().references('id').inTable('crm_tickets').onDelete('CASCADE');
        table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.text('content').notNullable();
        table.boolean('is_internal').defaultTo(false);
        table.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
        table.timestamp('created_at').defaultTo(knex.fn.now());

        table.index(['ticket_id']);
    });

    // Kontakte (Ansprechpartner)
    await knex.schema.createTable('crm_contacts', (table) => {
        table.increments('id').primary();
        table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.integer('customer_id').unsigned().notNullable().references('id').inTable('crm_customers').onDelete('CASCADE');
        table.string('salutation', 20).nullable();
        table.string('first_name', 100).nullable();
        table.string('last_name', 100).notNullable();
        table.string('position', 100).nullable();
        table.string('department', 100).nullable();
        table.string('email', 255).nullable();
        table.string('phone', 50).nullable();
        table.string('mobile', 50).nullable();
        table.boolean('is_primary').defaultTo(false);
        table.text('notes').nullable();
        table.json('custom_fields').nullable();
        table.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());

        table.index(['tenant_id', 'customer_id']);
        table.index(['tenant_id', 'email']);
    });

    // Notizen
    await knex.schema.createTable('crm_notes', (table) => {
        table.increments('id').primary();
        table.integer('tenant_id').unsigned().notNullable().references('id').inTable('tenants').onDelete('CASCADE');
        table.integer('customer_id').unsigned().nullable().references('id').inTable('crm_customers').onDelete('CASCADE');
        table.integer('ticket_id').unsigned().nullable().references('id').inTable('crm_tickets').onDelete('CASCADE');
        table.integer('contact_id').unsigned().nullable().references('id').inTable('crm_contacts').onDelete('CASCADE');
        table.string('title', 255).nullable();
        table.text('content').nullable();
        table.text('content_html').nullable();
        table.boolean('is_pinned').defaultTo(false);
        table.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
        table.timestamp('created_at').defaultTo(knex.fn.now());
        table.timestamp('updated_at').defaultTo(knex.fn.now());

        table.index(['tenant_id', 'customer_id']);
        table.index(['tenant_id', 'ticket_id']);
    });
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('crm_notes');
    await knex.schema.dropTableIfExists('crm_contacts');
    await knex.schema.dropTableIfExists('crm_ticket_comments');
    await knex.schema.dropTableIfExists('crm_tickets');
}
