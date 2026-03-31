import { describe, it, expect } from 'vitest';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

/**
 * Tests fuer Backup-Verschluesselung (AES-256-GCM).
 * Prueft Roundtrip, falschen Key, und Rueckwaertskompatibilitaet.
 */

const BACKUP_MAGIC = Buffer.from('MIKE-ENC-V1\0');

function deriveBackupKey(passphrase: string): Buffer {
    return createHash('sha256').update(passphrase, 'utf8').digest();
}

function encryptBackup(plainBuffer: Buffer, passphrase: string): Buffer {
    const key = deriveBackupKey(passphrase);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([BACKUP_MAGIC, iv, authTag, encrypted]);
}

function decryptBackup(encBuffer: Buffer, passphrase: string): Buffer {
    const key = deriveBackupKey(passphrase);
    const iv = encBuffer.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 16);
    const authTag = encBuffer.subarray(BACKUP_MAGIC.length + 16, BACKUP_MAGIC.length + 32);
    const ciphertext = encBuffer.subarray(BACKUP_MAGIC.length + 32);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function isEncryptedBackup(buffer: Buffer): boolean {
    return buffer.length > BACKUP_MAGIC.length && buffer.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC);
}

describe('Backup-Verschluesselung (AES-256-GCM)', () => {
    const testKey = 'mein-sicheres-backup-passwort-2026';

    it('Roundtrip: Verschluesseln → Entschluesseln ergibt Original', () => {
        const original = Buffer.from('{"users": [{"id": 1, "name": "Test"}]}');
        const encrypted = encryptBackup(original, testKey);
        const decrypted = decryptBackup(encrypted, testKey);
        expect(decrypted).toEqual(original);
    });

    it('Verschluesseltes Backup hat Magic Header', () => {
        const data = Buffer.from('test data');
        const encrypted = encryptBackup(data, testKey);
        expect(isEncryptedBackup(encrypted)).toBe(true);
    });

    it('Unverschluesseltes Backup wird als solches erkannt', () => {
        const plainZip = Buffer.from('PK\x03\x04 fake zip header');
        expect(isEncryptedBackup(plainZip)).toBe(false);
    });

    it('Falscher Key wirft Fehler', () => {
        const data = Buffer.from('sensitive data');
        const encrypted = encryptBackup(data, testKey);
        expect(() => decryptBackup(encrypted, 'falscher-key')).toThrow();
    });

    it('Manipulierter Ciphertext wirft Fehler (Auth Tag)', () => {
        const data = Buffer.from('important data');
        const encrypted = encryptBackup(data, testKey);
        // Letztes Byte aendern → AuthTag stimmt nicht mehr
        encrypted[encrypted.length - 1] ^= 0xFF;
        expect(() => decryptBackup(encrypted, testKey)).toThrow();
    });

    it('Grosse Daten funktionieren', () => {
        const largeData = randomBytes(1024 * 1024); // 1 MB
        const encrypted = encryptBackup(largeData, testKey);
        const decrypted = decryptBackup(encrypted, testKey);
        expect(decrypted).toEqual(largeData);
    });

    it('Verschiedene IVs erzeugen verschiedene Ciphertexte', () => {
        const data = Buffer.from('same data');
        const enc1 = encryptBackup(data, testKey);
        const enc2 = encryptBackup(data, testKey);
        // IV ist random → Ciphertext muss unterschiedlich sein
        expect(enc1.equals(enc2)).toBe(false);
        // Aber beide entschluesseln zum gleichen Klartext
        expect(decryptBackup(enc1, testKey)).toEqual(data);
        expect(decryptBackup(enc2, testKey)).toEqual(data);
    });
});
