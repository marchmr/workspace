import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const SOURCE_PREFIX = '/api/plugins/videoplattform/public';
const TARGET_PREFIX = '/api/plugins/kundenportal/public';

function replacePublicUrls(value: any): any {
    if (typeof value === 'string') {
        return value.split(SOURCE_PREFIX).join(TARGET_PREFIX);
    }
    if (Array.isArray(value)) {
        return value.map((item) => replacePublicUrls(item));
    }
    if (value && typeof value === 'object') {
        const output: Record<string, any> = {};
        for (const [key, current] of Object.entries(value)) {
            output[key] = replacePublicUrls(current);
        }
        return output;
    }
    return value;
}

function buildTargetUrl(pathname: string, query: Record<string, any>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            for (const item of value) params.append(key, String(item));
        } else {
            params.set(key, String(value));
        }
    }
    const qs = params.toString();
    return `${SOURCE_PREFIX}${pathname}${qs ? `?${qs}` : ''}`;
}

async function proxyJson(
    fastify: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
    method: 'GET' | 'POST',
    pathname: string,
    body?: unknown,
): Promise<void> {
    const response = await fastify.inject({
        method,
        url: buildTargetUrl(pathname, request.query as Record<string, any>),
        headers: {
            host: String(request.headers.host || ''),
            'x-forwarded-proto': String((request.headers as any)['x-forwarded-proto'] || 'https'),
            'user-agent': String(request.headers['user-agent'] || ''),
            'content-type': 'application/json',
        },
        payload: body ? JSON.stringify(body) : undefined,
    });

    const contentType = String(response.headers['content-type'] || 'application/json');
    reply.code(response.statusCode);
    reply.header('Content-Type', contentType);
    if (contentType.includes('application/json')) {
        let resolved: any = null;
        try {
            resolved = response.json();
        } catch {
            try {
                resolved = JSON.parse(response.body || '{}');
            } catch {
                resolved = null;
            }
        }
        return reply.send(replacePublicUrls(resolved));
    }

    return reply.send(response.body);
}

async function proxyStream(
    fastify: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
    videoId: number,
): Promise<void> {
    const response = await fastify.inject({
        method: 'GET',
        url: buildTargetUrl(`/stream/${videoId}`, request.query as Record<string, any>),
        headers: {
            host: String(request.headers.host || ''),
            range: String(request.headers.range || ''),
            'x-forwarded-proto': String((request.headers as any)['x-forwarded-proto'] || 'https'),
            'user-agent': String(request.headers['user-agent'] || ''),
        },
    });

    reply.code(response.statusCode);
    for (const [key, value] of Object.entries(response.headers)) {
        if (typeof value === 'undefined') continue;
        if (key.toLowerCase() === 'content-length' && String(value) === '0') continue;
        reply.header(key, value as any);
    }
    return reply.send(response.rawPayload);
}

export default async function plugin(fastify: FastifyInstance): Promise<void> {
    fastify.get('/public/config', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        await proxyJson(fastify, request, reply, 'GET', '/config');
    });

    fastify.post('/public/auth/request-code', {
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        await proxyJson(fastify, request, reply, 'POST', '/auth/request-code', request.body);
    });

    fastify.post('/public/auth/verify-code', {
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        await proxyJson(fastify, request, reply, 'POST', '/auth/verify-code', request.body);
    });

    fastify.get('/public/access/by-session', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        await proxyJson(fastify, request, reply, 'GET', '/access/by-session');
    });

    fastify.post('/public/auth/logout', {
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        await proxyJson(fastify, request, reply, 'POST', '/auth/logout', request.body);
    });

    fastify.get('/public/stream/:videoId', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        const videoId = Number((request.params as any)?.videoId || 0);
        if (!Number.isInteger(videoId) || videoId <= 0) return reply.status(400).send({ error: 'Ungültige Video-ID' });
        await proxyStream(fastify, request, reply, videoId);
    });

    fastify.get('/public/logo', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        const response = await fastify.inject({
            method: 'GET',
            url: buildTargetUrl('/logo', request.query as Record<string, any>),
            headers: { host: String(request.headers.host || '') },
        });

        reply.code(response.statusCode);
        for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === 'undefined') continue;
            reply.header(key, value as any);
        }
        return reply.send(response.rawPayload);
    });

    fastify.get('/public/tenant-logo/:tenantId', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        const tenantId = Number((request.params as any)?.tenantId || 0);
        if (!Number.isInteger(tenantId) || tenantId <= 0) return reply.status(400).send({ error: 'Ungültige Mandanten-ID' });

        const response = await fastify.inject({
            method: 'GET',
            url: buildTargetUrl(`/tenant-logo/${tenantId}`, request.query as Record<string, any>),
            headers: { host: String(request.headers.host || '') },
        });

        reply.code(response.statusCode);
        for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === 'undefined') continue;
            reply.header(key, value as any);
        }
        return reply.send(response.rawPayload);
    });

    fastify.get('/public/health', {
        exposeHeadRoute: false,
        config: { policy: { public: true } },
        policy: { public: true },
    }, async (request, reply) => {
        await proxyJson(fastify, request, reply, 'GET', '/health');
    });
}
