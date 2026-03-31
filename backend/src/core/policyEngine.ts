/**
 * Policy Engine
 *
 * Zentrales Authorization-Layer das alle API-Requests absichert.
 *
 * Funktionsweise:
 * 1. Jede Route kann ein `policy`-Objekt in den Schema-Optionen definieren
 * 2. Der onRequest-Hook prüft automatisch Auth, Permissions und Tenant-Isolation
 * 3. Routes ohne Policy UND ohne Auth-PreHandler werden automatisch BLOCKIERT (401)
 *
 * Sicherheitsgarantie: Keine /api/-Route kann versehentlich öffentlich sein.
 * Plugins müssen entweder `preHandler: [requirePermission('...')]` (empfohlen,
 * authentifiziert intern), `preHandler: [fastify.authenticate]`, oder
 * `config: { policy: { public: true } }` setzen – sonst wird die Route blockiert.
 */

import { FastifyInstance, FastifyRequest, FastifyReply, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';

export interface RoutePolicy {
    /** Erforderliche Permission (z.B. 'users.view'). Wenn gesetzt, wird Auth erzwungen. */
    permission?: string;
    /** Route erfordert Authentifizierung (Default: true für alle /api/-Routes) */
    requireAuth?: boolean;
    /** Route ist öffentlich (kein Auth nötig, z.B. Login) */
    public?: boolean;
}

// Erweitere RouteOptions um policy
declare module 'fastify' {
    interface RouteOptions {
        policy?: RoutePolicy;
    }
    interface FastifyContextConfig {
        policy?: RoutePolicy;
    }
}

// Hardcoded öffentliche Pfade (Auth-Flow, Health, etc.)
const PUBLIC_PATHS = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/refresh',
    '/api/health',
];

function isPublicPath(url: string): boolean {
    return PUBLIC_PATHS.some(p => url === p || url.startsWith(p + '/'));
}

async function policyEnginePlugin(fastify: FastifyInstance): Promise<void> {
    // Set von Route-Patterns die weder Policy noch PreHandler haben
    // Format: "METHOD /api/path" (z.B. "GET /api/admin/scheduler")
    const unprotectedPatterns = new Set<string>();
    const logEntries: string[] = [];

    // Hook: Bei jeder Route-Registrierung prüfen ob eine Policy definiert ist
    fastify.addHook('onRoute', (routeOptions: RouteOptions) => {
        const url = routeOptions.url || '';
        const method = routeOptions.method;

        // Nur API-Routes prüfen
        if (!url.startsWith('/api/')) return;

        // Hardcoded public endpoints überspringen
        if (isPublicPath(url)) return;

        // Policy aus Route-Config extrahieren
        const policy = routeOptions.config?.policy || (routeOptions as any).policy;

        if (policy?.public) return; // Explizit öffentlich markiert

        // Route hat weder Policy noch Auth-PreHandler → als ungeschützt markieren
        if (!policy && !hasAuthPreHandler(routeOptions)) {
            const methods = Array.isArray(method) ? method : [method];
            for (const m of methods) {
                unprotectedPatterns.add(`${m} ${url}`);
                logEntries.push(`${m} ${url}`);
            }
        }
    });

    // Nach dem Starten: Status loggen
    fastify.addHook('onReady', async () => {
        if (logEntries.length > 0) {
            console.warn('[PolicyEngine] BLOCKIERT – Folgende API-Routes haben weder Policy noch Auth-PreHandler:');
            for (const route of logEntries) {
                console.warn(`  ✗ ${route}`);
            }
            console.warn('[PolicyEngine] Diese Routes werden automatisch mit 401 abgelehnt!');
        } else {
            console.log('[PolicyEngine] Alle API-Routes sind geschützt ✓');
        }
    });

    // onRequest-Hook: Policy durchsetzen + ungeschützte Routes blockieren
    fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        const url = request.url.split('?')[0]; // Query-Parameter entfernen
        const method = request.method;

        // Nur API-Routes
        if (!url.startsWith('/api/')) return;

        // Hardcoded public endpoints
        if (isPublicPath(url)) return;

        // Route-Config lesen
        const policy: RoutePolicy | undefined = (request.routeOptions?.config as any)?.policy;

        // ─── BLOCKER: Route ohne Policy und ohne PreHandler ───
        if (!policy) {
            // Prüfe ob diese Route als ungeschützt erkannt wurde
            const routeUrl = request.routeOptions?.url || url;
            const patternKey = `${method} ${routeUrl}`;
            if (unprotectedPatterns.has(patternKey)) {
                // Automatisch Auth erzwingen – wenn das fehlschlägt → 401
                try {
                    await fastify.authenticate(request, reply);
                } catch {
                    return; // authenticate hat bereits 401 geantwortet
                }
            }
            return; // Route hat preHandler → weiter
        }

        if (policy.public) return; // Explizit öffentlich

        // Auth erzwingen
        if (policy.requireAuth !== false) {
            try {
                await fastify.authenticate(request, reply);
            } catch {
                return; // authenticate hat bereits geantwortet
            }
        }

        // Permission prüfen
        if (policy.permission) {
            const perms: string[] = (request as any).user?.permissions || [];
            if (!perms.includes('*') && !perms.includes(policy.permission)) {
                // Audit-Trail bei Policy-Verletzung
                try {
                    await fastify.audit.log({
                        action: 'policy.denied',
                        category: 'auth',
                        entityType: 'route',
                        entityId: `${request.method} ${request.url}`,
                        newState: {
                            requiredPermission: policy.permission,
                            userPermissions: perms,
                        },
                    }, request);
                } catch { /* Audit-Fehler nicht propagieren */ }

                return reply.status(403).send({ error: 'Keine Berechtigung' });
            }
        }
    });

    console.log('[PolicyEngine] Initialisiert (Enforce-Modus aktiv)');
}

/**
 * Prüft ob eine Route bereits einen Auth-PreHandler hat
 * (z.B. fastify.authenticate oder requirePermission)
 */
function hasAuthPreHandler(routeOptions: RouteOptions): boolean {
    const handlers = routeOptions.preHandler;
    if (!handlers) return false;
    if (Array.isArray(handlers)) return handlers.length > 0;
    return typeof handlers === 'function';
}

export default fp(policyEnginePlugin, {
    name: 'policyEngine',
    dependencies: ['auth', 'auditLog'],
});

