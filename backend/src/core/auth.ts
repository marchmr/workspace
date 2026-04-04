import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { config } from './config.js';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 64;

export type AuthTokenPayload = {
    userId: number;
    username: string;
    permissions: string[];
    tenantId: number;
    tenantIds: number[];
    sessionId: number;
};

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

export function verifyAccessToken(token: string): AuthTokenPayload {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded !== 'object' || typeof decoded.header !== 'object') {
        throw new Error('Invalid token header');
    }
    const header = decoded.header as unknown as Record<string, unknown>;
    if (header.alg !== 'HS256') {
        throw new Error('Unsupported JWT algorithm');
    }
    if (Array.isArray(header.crit) && header.crit.length > 0) {
        throw new Error('Unsupported JWT critical header');
    }

    const verified = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    if (!verified || typeof verified !== 'object') {
        throw new Error('Invalid token payload');
    }

    const payload = verified as JwtPayload & Partial<AuthTokenPayload>;
    const parsedUser: AuthTokenPayload = {
        userId: Number(payload.userId),
        username: String(payload.username || ''),
        permissions: Array.isArray(payload.permissions)
            ? payload.permissions.map((entry) => String(entry))
            : [],
        tenantId: Number(payload.tenantId),
        tenantIds: Array.isArray(payload.tenantIds)
            ? payload.tenantIds.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry > 0)
            : [],
        sessionId: Number(payload.sessionId),
    };
    if (
        !Number.isInteger(parsedUser.userId) || parsedUser.userId <= 0
        || !Number.isInteger(parsedUser.sessionId) || parsedUser.sessionId <= 0
        || !Number.isInteger(parsedUser.tenantId) || parsedUser.tenantId <= 0
    ) {
        throw new Error('Invalid auth payload');
    }

    return parsedUser;
}



async function authPlugin(fastify: FastifyInstance): Promise<void> {
    fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
        try {
            const authHeader = String(request.headers.authorization || '').trim();
            const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
                ? authHeader.slice(7).trim()
                : '';
            const token = String((request.cookies as any)?.access_token || bearerToken || '').trim();
            if (!token) {
                clearAuthCookies(request, reply);
                return reply.status(401).send({ error: 'Nicht autorisiert' });
            }
            const parsedUser = verifyAccessToken(token);
            (request as any).user = parsedUser;

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
    payload: AuthTokenPayload,
    expiresIn?: SignOptions['expiresIn']
): string {
    const effectiveExpiresIn = expiresIn ?? (config.jwt.accessExpiry as unknown as SignOptions['expiresIn']);
    return jwt.sign(payload, config.jwt.secret, {
        algorithm: 'HS256',
        expiresIn: effectiveExpiresIn,
    });
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
