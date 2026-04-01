import { FastifyInstance } from 'fastify';
import { requirePermission } from '../core/permissions.js';
import { getSubdomainStatus, provisionSubdomain, runSubdomainPreflight } from '../services/subdomainProvisioning.js';

function parseHost(value: unknown): string {
    return String(value || '').trim();
}

export default async function subdomainProvisioningRoutes(fastify: FastifyInstance): Promise<void> {
    async function registerProvisioningRoutes(scopeId: 'videoplattform' | 'kundenportal'): Promise<void> {
        const base = `/subdomain-provisioning/${scopeId}`;

        fastify.get(`${base}/preflight`, { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
            const host = parseHost((request.query as any)?.host);
            if (!host) {
                return reply.status(400).send({ error: 'host ist erforderlich' });
            }

            try {
                const result = await runSubdomainPreflight(host);
                return reply.send(result);
            } catch (error: any) {
                return reply.status(400).send({ error: error?.message || 'Preflight konnte nicht geladen werden' });
            }
        });

        fastify.get(`${base}/status`, { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
            const host = parseHost((request.query as any)?.host);
            if (!host) {
                return reply.status(400).send({ error: 'host ist erforderlich' });
            }

            try {
                const result = await getSubdomainStatus(host);
                return reply.send(result);
            } catch (error: any) {
                return reply.status(400).send({ error: error?.message || 'Status konnte nicht geladen werden' });
            }
        });

        fastify.post(`${base}/provision`, { preHandler: [requirePermission('settings.manage')] }, async (request, reply) => {
            const host = parseHost((request.body as any)?.host);
            const publicPathRaw = parseHost((request.body as any)?.publicPath);
            const publicPath = publicPathRaw || '/';

            if (!host) {
                return reply.status(400).send({ error: 'host ist erforderlich' });
            }

            try {
                const result = await provisionSubdomain(host, publicPath);

                await fastify.audit.log({
                    action: 'admin.subdomain.provisioning.executed',
                    category: 'admin',
                    entityType: 'subdomain_provisioning',
                    entityId: `${scopeId}:${result.host}`,
                    newState: {
                        host: result.host,
                        ok: result.ok,
                        sslCertExists: result.sslCertExists,
                        steps: result.steps,
                    },
                }, request);

                const statusCode = result.ok ? 200 : 409;
                return reply.status(statusCode).send(result);
            } catch (error: any) {
                return reply.status(400).send({ error: error?.message || 'Provisionierung fehlgeschlagen' });
            }
        });
    }

    await registerProvisioningRoutes('videoplattform');
    await registerProvisioningRoutes('kundenportal');
}
