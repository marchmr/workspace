import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/routes/auth.ts', import.meta.url), 'utf8');

function extractBlock(startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (start === -1 || end === -1) {
        throw new Error(`Konnte Block nicht finden: ${startMarker}`);
    }
    return source.slice(start, end);
}

describe('MFA Auth Hardening (Regressionsschutz)', () => {
    it('login blockiert aktivierte MFA ohne Secret statt still zu umgehen', () => {
        const loginBlock = extractBlock(
            "fastify.post('/login'",
            "    // POST /api/auth/refresh"
        );
        expect(loginBlock).toContain('if (!user.mfa_secret_encrypted)');
        expect(loginBlock).toContain('MFA-Konfiguration fehlerhaft. Bitte Administrator kontaktieren.');
        expect(loginBlock).toContain("await recordLoginAttempt(user.id, clientIp, false);");
    });

    it('recovery login nutzt denselben Rate-Limit- und Lockout-Schutz wie /login', () => {
        const recoveryBlock = extractBlock(
            "fastify.post('/mfa/recovery'",
            '    });\n}'
        );
        expect(recoveryBlock).toContain("config: { rateLimit: getLoginRateLimitConfig() }");
        expect(recoveryBlock).toContain('const lockout = await checkAccountLockout(user.id);');
        expect(recoveryBlock).toContain("await recordLoginAttempt(null, clientIp, false);");
        expect(recoveryBlock).toContain("await recordLoginAttempt(user.id, clientIp, false);");
        expect(recoveryBlock).toContain("await recordLoginAttempt(user.id, clientIp, true);");
    });
});
