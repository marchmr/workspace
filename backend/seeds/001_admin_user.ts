import type { Knex } from 'knex';
import bcrypt from 'bcrypt';
import { createCipheriv, createHash, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 16;

function getEncryptionKey(): string {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error('ENCRYPTION_KEY fehlt. Seed kann nicht ausgefuehrt werden.');
    }
    return key;
}

function encryptValue(plaintext: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const key = scryptSync(getEncryptionKey(), salt, 32);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return [salt.toString('hex'), iv.toString('hex'), tag.toString('hex'), encrypted].join(':');
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function hashEmail(email: string): string {
    return createHash('sha256').update(normalizeEmail(email), 'utf8').digest('hex');
}

export async function seed(knex: Knex): Promise<void> {
    const hasEmailHash = await knex.schema.hasColumn('users', 'email_hash');

    // Admin-User anlegen (falls nicht vorhanden)
    const existingAdmin = await knex('users').where('username', 'admin').first();
    if (!existingAdmin) {
        // Zufaelliges Einmalpasswort generieren (kein statisches Passwort)
        const randomPassword = randomBytes(12).toString('base64url').slice(0, 16);
        const passwordHash = await bcrypt.hash(randomPassword, 12);
        const email = normalizeEmail('admin@localhost');
        await knex('users').insert({
            username: 'admin',
            email: encryptValue(email),
            ...(hasEmailHash ? { email_hash: hashEmail(email) } : {}),
            password_hash: passwordHash,
            is_active: true,
            mfa_enabled: false,
            created_at: new Date(),
        });
        console.log(`\n========================================`);
        console.log(`  Admin-Benutzer angelegt!`);
        console.log(`  Benutzername: admin`);
        console.log(`  Passwort:     ${randomPassword}`);
        console.log(`  BITTE SOFORT AENDERN!`);
        console.log(`========================================\n`);
    }

    // Admin-User die Super-Admin-Rolle zuweisen
    const admin = await knex('users').where('username', 'admin').first();
    const superAdminRole = await knex('roles').where('name', 'Super-Admin').first();

    if (admin && superAdminRole) {
        const existing = await knex('user_roles')
            .where('user_id', admin.id)
            .where('role_id', superAdminRole.id)
            .first();

        if (!existing) {
            await knex('user_roles').insert({
                user_id: admin.id,
                role_id: superAdminRole.id,
            });
        }
    }

    // Default-Mandant erstellen (falls keiner existiert)
    const hasTenants = await knex.schema.hasTable('tenants');
    if (hasTenants) {
        const existingTenant = await knex('tenants').first();
        if (!existingTenant) {
            await knex('tenants').insert({
                name: 'Hauptunternehmen',
                is_active: true,
                created_at: new Date(),
                updated_at: new Date(),
            });
        }

        // Admin dem Default-Mandant zuweisen
        if (admin) {
            const defaultTenant = await knex('tenants').first();
            if (defaultTenant) {
                const hasUserTenants = await knex.schema.hasTable('user_tenants');
                if (hasUserTenants) {
                    const existingAssignment = await knex('user_tenants')
                        .where('user_id', admin.id)
                        .where('tenant_id', defaultTenant.id)
                        .first();
                    if (!existingAssignment) {
                        await knex('user_tenants').insert({
                            user_id: admin.id,
                            tenant_id: defaultTenant.id,
                        });
                    }
                }
                // Default-Tenant am User setzen
                const hasDefaultTenant = await knex.schema.hasColumn('users', 'default_tenant_id');
                if (hasDefaultTenant) {
                    await knex('users')
                        .where('id', admin.id)
                        .update({ default_tenant_id: defaultTenant.id });
                }
            }
        }
    }
}
