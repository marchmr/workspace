import { describe, it, expect } from 'vitest';

/**
 * Tests fuer SSRF-Schutz im Webhook-Service.
 * Prueft dass private IPs, localhost und Cloud-Metadata blockiert werden.
 */

// Die isAllowedWebhookUrl-Funktion ist nicht exportiert, daher testen wir die Logik direkt
function isAllowedWebhookUrl(url: string, env = 'production'): { allowed: boolean; reason?: string } {
    try {
        const parsed = new URL(url);

        if (env === 'production' && parsed.protocol !== 'https:') {
            return { allowed: false, reason: 'In Produktion sind nur HTTPS-URLs erlaubt' };
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return { allowed: false, reason: 'Nur HTTP(S)-URLs sind erlaubt' };
        }

        const hostname = parsed.hostname.toLowerCase();

        if (['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]'].includes(hostname)) {
            return { allowed: false, reason: 'Localhost-URLs sind nicht erlaubt' };
        }

        const privateRanges = [
            /^10\./,
            /^172\.(1[6-9]|2\d|3[01])\./,
            /^192\.168\./,
            /^169\.254\./,
            /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
            /^fc/i, /^fd/i, /^fe80/i,
        ];

        if (privateRanges.some((r) => r.test(hostname))) {
            return { allowed: false, reason: 'Interne/Private IP-Adressen sind nicht erlaubt' };
        }

        if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
            return { allowed: false, reason: 'Cloud-Metadata-Endpoints sind nicht erlaubt' };
        }

        return { allowed: true };
    } catch {
        return { allowed: false, reason: 'Ungültige URL' };
    }
}

describe('SSRF-Schutz: isAllowedWebhookUrl', () => {
    describe('Erlaubte URLs', () => {
        it('HTTPS externe URL erlaubt', () => {
            expect(isAllowedWebhookUrl('https://example.com/webhook')).toEqual({ allowed: true });
        });

        it('HTTP in Development erlaubt', () => {
            expect(isAllowedWebhookUrl('http://example.com/webhook', 'development')).toEqual({ allowed: true });
        });
    });

    describe('Protokoll-Checks', () => {
        it('HTTP in Production blockiert', () => {
            const result = isAllowedWebhookUrl('http://example.com/webhook', 'production');
            expect(result.allowed).toBe(false);
        });

        it('FTP blockiert', () => {
            const result = isAllowedWebhookUrl('ftp://example.com/file', 'development');
            expect(result.allowed).toBe(false);
        });

        it('Ungueltige URL blockiert', () => {
            const result = isAllowedWebhookUrl('not-a-url');
            expect(result.allowed).toBe(false);
        });
    });

    describe('Localhost-Blocking', () => {
        const localhosts = ['localhost', '127.0.0.1', '0.0.0.0'];
        for (const host of localhosts) {
            it(`Blockiert ${host}`, () => {
                const result = isAllowedWebhookUrl(`https://${host}/webhook`);
                expect(result.allowed).toBe(false);
            });
        }
    });

    describe('Private IP-Ranges', () => {
        const privateIPs = [
            '10.0.0.1',         // 10.0.0.0/8
            '10.255.255.255',
            '172.16.0.1',       // 172.16.0.0/12
            '172.31.255.255',
            '192.168.0.1',      // 192.168.0.0/16
            '192.168.255.255',
            '169.254.1.1',      // Link-local
        ];

        for (const ip of privateIPs) {
            it(`Blockiert private IP ${ip}`, () => {
                const result = isAllowedWebhookUrl(`https://${ip}/webhook`);
                expect(result.allowed).toBe(false);
            });
        }
    });

    describe('Cloud Metadata Endpoints', () => {
        it('Blockiert AWS Metadata (169.254.169.254)', () => {
            const result = isAllowedWebhookUrl('https://169.254.169.254/latest/meta-data/');
            expect(result.allowed).toBe(false);
        });

        it('Blockiert GCP Metadata (metadata.google.internal)', () => {
            const result = isAllowedWebhookUrl('https://metadata.google.internal/computeMetadata/');
            expect(result.allowed).toBe(false);
        });
    });

    describe('CGNAT Range (100.64.0.0/10)', () => {
        it('Blockiert CGNAT IP 100.64.0.1', () => {
            const result = isAllowedWebhookUrl('https://100.64.0.1/webhook');
            expect(result.allowed).toBe(false);
        });

        it('Blockiert CGNAT IP 100.127.255.255', () => {
            const result = isAllowedWebhookUrl('https://100.127.255.255/webhook');
            expect(result.allowed).toBe(false);
        });
    });

    describe('Erlaubte oeffentliche IPs', () => {
        const publicIPs = ['8.8.8.8', '1.1.1.1', '203.0.113.1', '100.128.0.1'];
        for (const ip of publicIPs) {
            it(`Erlaubt oeffentliche IP ${ip}`, () => {
                const result = isAllowedWebhookUrl(`https://${ip}/webhook`);
                expect(result.allowed).toBe(true);
            });
        }
    });
});
