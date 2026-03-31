import { describe, it, expect } from 'vitest';
import { scopedQuery, scopedInsert, requireTenantId, isSuperAdmin } from '../../src/core/tenantScope.js';

// Mock Knex QueryBuilder
function mockQueryBuilder(records: any[] = []) {
    const state: { wheres: Record<string, any>; whereRawCalled: boolean } = {
        wheres: {},
        whereRawCalled: false,
    };

    const qb: any = {
        where(col: string, val: any) { state.wheres[col] = val; return qb; },
        whereRaw(expr: string) { state.whereRawCalled = true; return qb; },
        first() { return records[0] || null; },
        orderBy() { return qb; },
        _state: state,
    };
    return qb;
}

function mockRequest(perms: string[], tenantId: number | null): any {
    return { user: { permissions: perms, tenantId, userId: 1, username: 'test' } };
}

describe('scopedQuery', () => {
    it('Super-Admin (*) sieht alle Daten – kein tenant_id Filter', () => {
        const qb = mockQueryBuilder();
        scopedQuery(qb, mockRequest(['*'], 1));
        expect(qb._state.wheres).not.toHaveProperty('tenant_id');
    });

    it('Normaler User bekommt tenant_id Filter', () => {
        const qb = mockQueryBuilder();
        scopedQuery(qb, mockRequest(['users.view'], 5));
        expect(qb._state.wheres.tenant_id).toBe(5);
    });

    it('User ohne Tenant bekommt leere Ergebnisse (1=0)', () => {
        const qb = mockQueryBuilder();
        scopedQuery(qb, mockRequest(['users.view'], null as any));
        expect(qb._state.whereRawCalled).toBe(true);
    });

    it('Custom column name funktioniert', () => {
        const qb = mockQueryBuilder();
        scopedQuery(qb, mockRequest(['users.view'], 3), 'mandant_id');
        expect(qb._state.wheres.mandant_id).toBe(3);
    });
});

describe('scopedInsert', () => {
    it('Setzt tenant_id automatisch', () => {
        const data = scopedInsert({ name: 'Test' }, mockRequest([], 7));
        expect(data.tenant_id).toBe(7);
        expect(data.name).toBe('Test');
    });

    it('Ueberschreibt explizite tenant_id nicht', () => {
        const data = scopedInsert({ name: 'Test', tenant_id: 99 }, mockRequest([], 7));
        expect(data.tenant_id).toBe(99);
    });

    it('Setzt null wenn kein Tenant vorhanden', () => {
        const data = scopedInsert({ name: 'Test' }, mockRequest([], null as any));
        expect(data.tenant_id).toBeNull();
    });
});

describe('requireTenantId', () => {
    it('Gibt Tenant-ID zurueck', () => {
        expect(requireTenantId(mockRequest([], 42))).toBe(42);
    });

    it('Wirft Fehler ohne Tenant', () => {
        expect(() => requireTenantId(mockRequest([], null as any))).toThrow();
    });
});

describe('isSuperAdmin', () => {
    it('Erkennt Super-Admin korrekt', () => {
        expect(isSuperAdmin(mockRequest(['*'], 1))).toBe(true);
    });

    it('Normaler User ist kein Super-Admin', () => {
        expect(isSuperAdmin(mockRequest(['users.view', 'users.edit'], 1))).toBe(false);
    });

    it('Leere Permissions sind kein Super-Admin', () => {
        expect(isSuperAdmin(mockRequest([], 1))).toBe(false);
    });
});
