import { TOTP, Secret } from 'otpauth';
import QRCode from 'qrcode';
import { encrypt, decrypt } from './encryption.js';
import { randomBytes } from 'crypto';

const ISSUER = 'MIKE WorkSpace';
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 8;

export function generateTOTPSecret(): string {
    const secret = new Secret({ size: 20 });
    return secret.base32;
}

export function createTOTP(secret: string, username: string): TOTP {
    return new TOTP({
        issuer: ISSUER,
        label: username,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secret),
    });
}

export function verifyTOTPCode(secret: string, username: string, code: string): boolean {
    const totp = createTOTP(secret, username);
    const delta = totp.validate({ token: code, window: 1 });
    return delta !== null;
}

export async function generateQRCodeDataURL(secret: string, username: string): Promise<string> {
    const totp = createTOTP(secret, username);
    const uri = totp.toString();
    return QRCode.toDataURL(uri);
}

export function generateRecoveryCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
        const code = randomBytes(RECOVERY_CODE_LENGTH / 2)
            .toString('hex')
            .toUpperCase();
        codes.push(code);
    }
    return codes;
}

export function encryptMFASecret(secret: string): string {
    return encrypt(secret);
}

export function decryptMFASecret(encrypted: string): string {
    return decrypt(encrypted);
}

export function encryptRecoveryCodes(codes: string[]): string {
    return encrypt(JSON.stringify(codes));
}

export function decryptRecoveryCodes(encrypted: string): string[] {
    return JSON.parse(decrypt(encrypted));
}

export function useRecoveryCode(codes: string[], usedCode: string): { valid: boolean; remainingCodes: string[] } {
    const upperCode = usedCode.toUpperCase();
    const index = codes.indexOf(upperCode);

    if (index === -1) {
        return { valid: false, remainingCodes: codes };
    }

    const remainingCodes = [...codes];
    remainingCodes.splice(index, 1);
    return { valid: true, remainingCodes };
}
