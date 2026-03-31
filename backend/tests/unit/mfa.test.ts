import { beforeAll, describe, it, expect, vi } from 'vitest';

vi.mock('../../src/core/encryption.js', () => ({
    encrypt: (plainText: string) => `enc:${Buffer.from(plainText, 'utf8').toString('base64')}`,
    decrypt: (payload: string) => Buffer.from(String(payload).replace(/^enc:/, ''), 'base64').toString('utf8'),
}));

let mfa: Awaited<typeof import('../../src/core/mfa.js')>;

beforeAll(async () => {
    mfa = await import('../../src/core/mfa.js');
});

describe('MFA core helpers', () => {
    it('erstellt gueltiges TOTP-Secret und verifiziert aktuellen Code', () => {
        const secret = mfa.generateTOTPSecret();
        const totp = mfa.createTOTP(secret, 'testuser');
        const token = totp.generate();

        expect(secret).toMatch(/^[A-Z2-7]+$/);
        expect(token).toMatch(/^\d{6}$/);
        expect(mfa.verifyTOTPCode(secret, 'testuser', token)).toBe(true);
    });

    it('lehnt falschen TOTP-Code ab', () => {
        const secret = mfa.generateTOTPSecret();
        expect(mfa.verifyTOTPCode(secret, 'testuser', '000000')).toBe(false);
    });

    it('erstellt Recovery-Codes im erwarteten Format', () => {
        const codes = mfa.generateRecoveryCodes();
        expect(codes).toHaveLength(10);
        for (const code of codes) {
            expect(code).toMatch(/^[A-F0-9]{8}$/);
        }
    });

    it('verbraucht Recovery-Code case-insensitive genau einmal', () => {
        const codes = ['A1B2C3D4', '1122AABB'];
        const first = mfa.useRecoveryCode(codes, 'a1b2c3d4');
        expect(first.valid).toBe(true);
        expect(first.remainingCodes).toEqual(['1122AABB']);

        const second = mfa.useRecoveryCode(first.remainingCodes, 'A1B2C3D4');
        expect(second.valid).toBe(false);
        expect(second.remainingCodes).toEqual(['1122AABB']);
    });

    it('verschluesselt und entschluesselt MFA-Daten verlustfrei', () => {
        const secret = 'JBSWY3DPEHPK3PXP';
        const encryptedSecret = mfa.encryptMFASecret(secret);
        expect(mfa.decryptMFASecret(encryptedSecret)).toBe(secret);

        const recoveryCodes = ['A1B2C3D4', 'E5F60718'];
        const encryptedCodes = mfa.encryptRecoveryCodes(recoveryCodes);
        expect(mfa.decryptRecoveryCodes(encryptedCodes)).toEqual(recoveryCodes);
    });
});
