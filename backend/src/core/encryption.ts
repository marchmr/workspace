import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHmac } from 'crypto';
import { config } from './config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;

// F6 Security Fix: scrypt nur einmal beim Start ausfuehren statt bei jedem Aufruf.
// Pro Verschluesselung wird ein einzigartiger Key via HMAC-SHA256(masterKey, salt) abgeleitet.
const MASTER_KEY = scryptSync(config.encryption.key, 'mike-master-salt', 32);

function deriveKey(salt: Buffer): Buffer {
    return Buffer.from(
        createHmac('sha256', MASTER_KEY).update(salt).digest()
    );
}

/** Legacy-Ableitung fuer bereits verschluesselte Daten (vor diesem Fix) */
function deriveKeyLegacy(salt: Buffer): Buffer {
    return scryptSync(config.encryption.key, salt, 32);
}

export function encrypt(plaintext: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const key = deriveKey(salt);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    // Format: salt:iv:tag:encrypted (all hex)
    return [
        salt.toString('hex'),
        iv.toString('hex'),
        tag.toString('hex'),
        encrypted,
    ].join(':');
}

export function decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 4) {
        throw new Error('Ungueltiges verschluesseltes Format');
    }

    const [saltHex, ivHex, tagHex, encrypted] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    // Zuerst neues Schema versuchen, dann Legacy-Fallback fuer Altdaten
    try {
        const key = deriveKey(salt);
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch {
        // Fallback: Legacy scryptSync-Ableitung (Daten vor F6-Fix)
        const key = deriveKeyLegacy(salt);
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}

export function encryptIfNotEmpty(value: string | null | undefined): string | null {
    if (!value) return null;
    return encrypt(value);
}

export function decryptIfNotEmpty(value: string | null | undefined): string | null {
    if (!value) return null;
    return decrypt(value);
}

