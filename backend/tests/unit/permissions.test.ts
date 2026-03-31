import { describe, it, expect } from 'vitest';

/**
 * Tests fuer Permission-Matching und Wildcard-Logik.
 */

function hasPermission(userPerms: string[], required: string): boolean {
    if (userPerms.includes('*')) return true;
    return userPerms.includes(required);
}

function matchesWildcard(pattern: string, event: string): boolean {
    if (pattern === '*') return true;
    if (pattern === event) return true;
    if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        return event.startsWith(prefix + '.');
    }
    return false;
}

describe('Permission-Matching', () => {
    it('Super-Admin (*) hat alle Permissions', () => {
        expect(hasPermission(['*'], 'users.view')).toBe(true);
        expect(hasPermission(['*'], 'backup.export')).toBe(true);
    });

    it('Exakte Permission matcht', () => {
        expect(hasPermission(['users.view', 'users.edit'], 'users.view')).toBe(true);
    });

    it('Fehlende Permission matcht nicht', () => {
        expect(hasPermission(['users.view'], 'users.edit')).toBe(false);
    });

    it('Leere Permissions matchen nichts', () => {
        expect(hasPermission([], 'users.view')).toBe(false);
    });
});

describe('Webhook Event-Wildcard-Matching', () => {
    it('Globaler Wildcard * matcht alles', () => {
        expect(matchesWildcard('*', 'user.created')).toBe(true);
        expect(matchesWildcard('*', 'webhook.test')).toBe(true);
    });

    it('Exakter Match', () => {
        expect(matchesWildcard('user.created', 'user.created')).toBe(true);
    });

    it('Prefix-Wildcard user.* matcht user.created', () => {
        expect(matchesWildcard('user.*', 'user.created')).toBe(true);
        expect(matchesWildcard('user.*', 'user.deleted')).toBe(true);
    });

    it('Prefix-Wildcard matcht keine falschen Prefixe', () => {
        expect(matchesWildcard('user.*', 'webhook.created')).toBe(false);
    });

    it('Kein Match bei unterschiedlichem Event', () => {
        expect(matchesWildcard('user.created', 'user.deleted')).toBe(false);
    });
});
