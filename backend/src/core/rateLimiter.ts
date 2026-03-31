import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { getDatabase } from './database.js';

const LOGIN_MAX_ATTEMPTS = 10;
const LOCKOUT_DURATION_MINUTES = 15;
const LOGIN_RATE_WINDOW_MS = 60 * 1000; // 1 minute
const LOGIN_RATE_MAX = 5;
const API_RATE_WINDOW_MS = 60 * 1000; // 1 minute
const API_RATE_MAX_ANONYMOUS = 60;      // Unauthentifiziert: 60/min
const API_RATE_MAX_AUTHENTICATED = 500; // Authentifiziert: 500/min

// Vorgefertigte Rate-Limit-Profile für verschiedene Route-Typen
export const rateLimits = {
    /** Standard API – global default (wird dynamisch per Auth angepasst) */
    api: { max: API_RATE_MAX_AUTHENTICATED, timeWindow: API_RATE_WINDOW_MS },
    /** Login (5/min) */
    login: { max: LOGIN_RATE_MAX, timeWindow: LOGIN_RATE_WINDOW_MS },
    /** Strikt (3/min) – Passwort-Reset, MFA-Setup, Token-Generierung */
    strict: {
        max: 3,
        timeWindow: 60 * 1000,
        keyGenerator: (request: FastifyRequest) => request.ip,
        errorResponseBuilder: () => ({
            error: 'Zu viele Anfragen. Bitte eine Minute warten.',
        }),
    },
    /** Upload (10 pro 5 Min) – Datei-Uploads */
    upload: {
        max: 10,
        timeWindow: 5 * 60 * 1000,
        keyGenerator: (request: FastifyRequest) => request.ip,
        errorResponseBuilder: () => ({
            error: 'Upload-Limit erreicht. Bitte 5 Minuten warten.',
        }),
    },
};

async function rateLimiterPlugin(fastify: FastifyInstance): Promise<void> {
    await fastify.register(import('@fastify/rate-limit'), {
        global: true,
        max: (request: FastifyRequest, _key: string) => {
            // Authentifizierte Benutzer: großzügiges Limit
            // Anonyme Requests (Login, Branding): strengeres Limit
            const user = (request as any).user;
            return user?.userId ? API_RATE_MAX_AUTHENTICATED : API_RATE_MAX_ANONYMOUS;
        },
        timeWindow: API_RATE_WINDOW_MS,
        keyGenerator: (request: FastifyRequest) => {
            // Per-User statt per-IP für authentifizierte Requests
            const user = (request as any).user;
            if (user?.userId) return `user:${user.userId}`;
            return request.ip;
        },
        errorResponseBuilder: () => {
            return { error: 'Zu viele Anfragen. Bitte später erneut versuchen.' };
        },
    });
}

export async function checkAccountLockout(userId: number): Promise<{ locked: boolean; minutesRemaining: number }> {
    const db = getDatabase();
    const cutoff = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000);

    const recentFailures = await db('login_attempts')
        .where('user_id', userId)
        .where('success', false)
        .where('created_at', '>', cutoff)
        .count('id as count')
        .first();

    const failCount = Number(recentFailures?.count || 0);

    if (failCount >= LOGIN_MAX_ATTEMPTS) {
        const lastAttempt = await db('login_attempts')
            .where('user_id', userId)
            .where('success', false)
            .orderBy('created_at', 'desc')
            .first();

        if (lastAttempt) {
            const lockoutEnd = new Date(lastAttempt.created_at).getTime() + LOCKOUT_DURATION_MINUTES * 60 * 1000;
            const remaining = Math.ceil((lockoutEnd - Date.now()) / 60000);
            if (remaining > 0) {
                return { locked: true, minutesRemaining: remaining };
            }
        }
    }

    return { locked: false, minutesRemaining: 0 };
}

export async function recordLoginAttempt(
    userId: number | null,
    ipAddress: string,
    success: boolean
): Promise<void> {
    const db = getDatabase();

    await db('login_attempts').insert({
        user_id: userId,
        ip_address: ipAddress,
        success,
        created_at: new Date(),
    });

    // Bei erfolgreichem Login: alte Fehlversuche zuruecksetzen
    if (success && userId) {
        await db('login_attempts')
            .where('user_id', userId)
            .where('success', false)
            .delete();
    }
}

export function getLoginRateLimitConfig() {
    return {
        max: LOGIN_RATE_MAX,
        timeWindow: LOGIN_RATE_WINDOW_MS,
        keyGenerator: (request: FastifyRequest) => request.ip,
        errorResponseBuilder: () => ({
            error: 'Zu viele Login-Versuche. Bitte eine Minute warten.',
        }),
    };
}

export default fp(rateLimiterPlugin, { name: 'rateLimiter' });
