import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { config } from './config.js';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 64;

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): string {
    return randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
}



async function authPlugin(fastify: FastifyInstance): Promise<void> {
    await fastify.register(import('@fastify/jwt'), {
        secret: config.jwt.secret,
        cookie: {
            cookieName: 'access_token',
            signed: false,
        },
    });

    fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
        try {
            await request.jwtVerify();

            const sessionId = Number((request.user as any)?.sessionId);
            const userId = Number((request.user as any)?.userId);
            if (!Number.isInteger(sessionId) || sessionId <= 0 || !Number.isInteger(userId) || userId <= 0) {
                clearAuthCookies(request, reply);
                return reply.status(401).send({ error: 'Nicht autorisiert' });
            }

            const session = await fastify.db('refresh_tokens')
                .where({
                    id: sessionId,
                    user_id: userId,
                    is_revoked: false,
                })
                .first('id', 'expires_at');

            if (!session || new Date(session.expires_at) < new Date()) {
                clearAuthCookies(request, reply);
                return reply.status(401).send({ error: 'Sitzung abgelaufen' });
            }
        } catch {
            clearAuthCookies(request, reply);
            return reply.status(401).send({ error: 'Nicht autorisiert' });
        }
    });
}

export function generateAccessToken(
    fastify: FastifyInstance,
    payload: { userId: number; username: string; permissions: string[]; tenantId: number; tenantIds: number[]; sessionId: number }
): string {
    return fastify.jwt.sign(payload, { expiresIn: config.jwt.accessExpiry });
}

function shouldUseSecureCookies(request: FastifyRequest): boolean {
    const mode = String(config.jwt.cookieSecure || 'auto').toLowerCase();

    if (mode === 'true') return true;
    if (mode === 'false') return false;

    // auto: nur bei echter HTTPS-Verbindung
    if (request.protocol === 'https') return true;

    const forwardedProto = request.headers['x-forwarded-proto'];
    if (typeof forwardedProto === 'string') {
        return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
    }

    return false;
}

export function setAuthCookies(
    request: FastifyRequest,
    reply: FastifyReply,
    accessToken: string,
    refreshToken: string
): void {
    const secure = shouldUseSecureCookies(request);

    reply.setCookie('access_token', accessToken, {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/',
        maxAge: 15 * 60, // 15 minutes
    });

    reply.setCookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/api/auth/refresh',
        maxAge: 7 * 24 * 60 * 60, // 7 days
    });
}

export function clearAuthCookies(request: FastifyRequest, reply: FastifyReply): void {
    const secure = shouldUseSecureCookies(request);

    reply.clearCookie('access_token', {
        path: '/',
        httpOnly: true,
        secure,
        sameSite: 'strict',
    });
    reply.clearCookie('refresh_token', {
        path: '/api/auth/refresh',
        httpOnly: true,
        secure,
        sameSite: 'strict',
    });
}

export default fp(authPlugin, { name: 'auth' });
