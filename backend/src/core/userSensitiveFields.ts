import { createHash } from 'crypto';
import { decryptIfNotEmpty, encryptIfNotEmpty } from './encryption.js';

function tryDecrypt(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
        return decryptIfNotEmpty(value);
    } catch {
        // Rueckwaertskompatibel: Altbestand kann noch unverschluesselt sein.
        return value;
    }
}

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function hashEmail(email: string): string {
    return createHash('sha256').update(normalizeEmail(email), 'utf8').digest('hex');
}

export function encryptUserSensitiveFields(input: {
    email?: string | null;
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
}): {
    email?: string | null;
    emailHash?: string | null;
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
} {
    const output: {
        email?: string | null;
        emailHash?: string | null;
        displayName?: string | null;
        firstName?: string | null;
        lastName?: string | null;
    } = {};

    if (input.email !== undefined) {
        const normalized = input.email === null ? null : normalizeEmail(input.email);
        output.email = encryptIfNotEmpty(normalized);
        output.emailHash = normalized ? hashEmail(normalized) : null;
    }
    if (input.displayName !== undefined) {
        output.displayName = encryptIfNotEmpty(input.displayName?.trim() || null);
    }
    if (input.firstName !== undefined) {
        output.firstName = encryptIfNotEmpty(input.firstName?.trim() || null);
    }
    if (input.lastName !== undefined) {
        output.lastName = encryptIfNotEmpty(input.lastName?.trim() || null);
    }

    return output;
}

export function decryptUserSensitiveFields<T extends Record<string, any>>(user: T): T {
    return {
        ...user,
        email: user.email ? tryDecrypt(String(user.email)) : null,
        display_name: user.display_name ? tryDecrypt(String(user.display_name)) : null,
        first_name: user.first_name ? tryDecrypt(String(user.first_name)) : null,
        last_name: user.last_name ? tryDecrypt(String(user.last_name)) : null,
    };
}
