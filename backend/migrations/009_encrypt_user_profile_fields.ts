import type { Knex } from 'knex';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;

function getEncryptionKey(): string {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error('ENCRYPTION_KEY fehlt. Migration kann nicht ausgefuehrt werden.');
    }
    return key;
}

function deriveKey(salt: Buffer): Buffer {
    return scryptSync(getEncryptionKey(), salt, 32);
}

function encrypt(plaintext: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const key = deriveKey(salt);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    return [
        salt.toString('hex'),
        iv.toString('hex'),
        tag.toString('hex'),
        encrypted,
    ].join(':');
}

function decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 4) {
        throw new Error('Ungueltiges verschluesseltes Format');
    }

    const [saltHex, ivHex, tagHex, encrypted] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const key = deriveKey(salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag.subarray(0, TAG_LENGTH));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function hashEmail(email: string): string {
    return createHash('sha256').update(normalizeEmail(email), 'utf8').digest('hex');
}

function tryDecrypt(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
        return decrypt(value);
    } catch {
        return value;
    }
}

function encryptIfPresent(value: string | null | undefined): string | null {
    if (!value) return null;
    const plaintext = tryDecrypt(value);
    if (!plaintext) return null;
    return encrypt(plaintext);
}

export async function up(knex: Knex): Promise<void> {
    const hasEmailHash = await knex.schema.hasColumn('users', 'email_hash');
    if (!hasEmailHash) {
        await knex.schema.alterTable('users', (table) => {
            table.string('email_hash', 64).nullable();
            table.index(['email_hash'], 'users_email_hash_idx');
        });
    }

    try {
        await knex.raw('ALTER TABLE `users` DROP INDEX `users_email_unique`');
    } catch {
        // Index kann bereits entfernt sein.
    }

    try {
        await knex.raw('ALTER TABLE `users` MODIFY COLUMN `email` TEXT NOT NULL');
    } catch {
        // Bereits angepasst oder DB-spezifische Abweichung.
    }
    try {
        await knex.raw('ALTER TABLE `users` MODIFY COLUMN `display_name` TEXT NULL');
    } catch {
        // Bereits angepasst oder Spalte existiert nicht.
    }
    try {
        await knex.raw('ALTER TABLE `users` MODIFY COLUMN `first_name` TEXT NULL');
    } catch {
        // Bereits angepasst oder Spalte existiert nicht.
    }
    try {
        await knex.raw('ALTER TABLE `users` MODIFY COLUMN `last_name` TEXT NULL');
    } catch {
        // Bereits angepasst oder Spalte existiert nicht.
    }

    const users = await knex('users').select('id', 'email', 'display_name', 'first_name', 'last_name');
    for (const user of users) {
        const emailPlain = normalizeEmail(tryDecrypt(user.email) || '');
        if (!emailPlain) {
            throw new Error(`Benutzer #${user.id} hat keine gueltige E-Mail fuer die Verschluesselung`);
        }

        await knex('users').where('id', user.id).update({
            email: encrypt(emailPlain),
            email_hash: hashEmail(emailPlain),
            display_name: encryptIfPresent(user.display_name),
            first_name: encryptIfPresent(user.first_name),
            last_name: encryptIfPresent(user.last_name),
        });
    }

    try {
        await knex.raw('ALTER TABLE `users` MODIFY COLUMN `email_hash` VARCHAR(64) NOT NULL');
    } catch {
        // Bereits NOT NULL.
    }
    try {
        await knex.raw('ALTER TABLE `users` ADD UNIQUE INDEX `users_email_hash_unique` (`email_hash`)');
    } catch {
        // Bereits vorhanden.
    }
}

export async function down(knex: Knex): Promise<void> {
    const hasEmailHash = await knex.schema.hasColumn('users', 'email_hash');
    if (!hasEmailHash) {
        return;
    }

    const users = await knex('users').select('id', 'email', 'display_name', 'first_name', 'last_name');
    for (const user of users) {
        const emailPlain = tryDecrypt(user.email) || '';
        if (!emailPlain) {
            throw new Error(`Benutzer #${user.id} hat keine gueltige E-Mail fuer den Rollback`);
        }

        await knex('users').where('id', user.id).update({
            email: emailPlain,
            display_name: tryDecrypt(user.display_name),
            first_name: tryDecrypt(user.first_name),
            last_name: tryDecrypt(user.last_name),
        });
    }

    try {
        await knex.raw('ALTER TABLE `users` DROP INDEX `users_email_hash_unique`');
    } catch {
        // Index nicht vorhanden.
    }

    try {
        await knex.raw('ALTER TABLE `users` MODIFY COLUMN `email` VARCHAR(255) NOT NULL');
    } catch {
        // DB-spezifischer Fall.
    }
    try {
        await knex.raw('ALTER TABLE `users` MODIFY COLUMN `display_name` VARCHAR(160) NULL');
    } catch {
        // DB-spezifischer Fall.
    }
    try {
        await knex.raw('ALTER TABLE `users` MODIFY COLUMN `first_name` VARCHAR(120) NULL');
    } catch {
        // DB-spezifischer Fall.
    }
    try {
        await knex.raw('ALTER TABLE `users` MODIFY COLUMN `last_name` VARCHAR(120) NULL');
    } catch {
        // DB-spezifischer Fall.
    }

    await knex.schema.alterTable('users', (table) => {
        table.dropIndex(['email_hash'], 'users_email_hash_idx');
        table.dropColumn('email_hash');
    });

    try {
        await knex.raw('ALTER TABLE `users` ADD UNIQUE INDEX `users_email_unique` (`email`)');
    } catch {
        // Bereits vorhanden.
    }
}
