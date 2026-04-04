import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getDatabase } from '../core/database.js';
import { config } from '../core/config.js';
import {
    hashPassword,
    verifyPassword,
    hashToken,
    generateRefreshToken,
    generateAccessToken,
    setAuthCookies,
    clearAuthCookies,
} from '../core/auth.js';
import { getUserPermissions } from '../core/permissions.js';
import { checkAccountLockout, recordLoginAttempt, getLoginRateLimitConfig } from '../core/rateLimiter.js';
import {
    generateTOTPSecret,
    generateQRCodeDataURL,
    verifyTOTPCode,
    generateRecoveryCodes,
    encryptMFASecret,
    decryptMFASecret,
    encryptRecoveryCodes,
    decryptRecoveryCodes,
    useRecoveryCode,
} from '../core/mfa.js';
import { getClientIp } from '../services/auditLog.js';
import { decryptUserSensitiveFields } from '../core/userSensitiveFields.js';

export default async function authRoutes(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();
    const avatarDir = path.join(config.app.uploadsDir, 'avatars');
    const tenantLogoDir = path.join(config.app.uploadsDir, 'tenant-logos');
    const DASHBOARD_LAYOUT_TABLE = 'user_dashboard_layouts';
    const DASHBOARD_KEY_PATTERN = /^[a-zA-Z0-9._:-]{1,190}$/;
    const DASHBOARD_MAX_TILES = 120;

    let hasTenantsLogoUpdatedAtColumn: boolean | null = null;

    async function tenantsHasLogoUpdatedAt(): Promise<boolean> {
        if (hasTenantsLogoUpdatedAtColumn !== null) return hasTenantsLogoUpdatedAtColumn;
        try {
            hasTenantsLogoUpdatedAtColumn = await db.schema.hasColumn('tenants', 'logo_updated_at');
        } catch {
            hasTenantsLogoUpdatedAtColumn = false;
        }
        return hasTenantsLogoUpdatedAtColumn;
    }

    function useSecureCookie(request: FastifyRequest): boolean {
        const mode = String(config.jwt.cookieSecure || 'auto').toLowerCase();
        if (mode === 'true') return true;
        if (mode === 'false') return false;
        if (request.protocol === 'https') return true;
        const forwarded = request.headers['x-forwarded-proto'];
        return typeof forwarded === 'string' && forwarded.split(',')[0].trim().toLowerCase() === 'https';
    }

    async function getUserTenantList(userId: number): Promise<Array<{ id: number; name: string; slug: string; logoUrl: string | null; logoUpdatedAt: string | null }>> {
        const selectColumns = ['tenants.id', 'tenants.name', 'tenants.slug', 'tenants.logo_file'];
        if (await tenantsHasLogoUpdatedAt()) {
            selectColumns.push('tenants.logo_updated_at');
        }

        const rows = await db('user_tenants')
            .join('tenants', 'user_tenants.tenant_id', 'tenants.id')
            .where('user_tenants.user_id', userId)
            .where('tenants.is_active', true)
            .select(selectColumns)
            .orderBy('tenants.name', 'asc');

        return rows.map((row: any) => ({
            id: Number(row.id),
            name: row.name,
            slug: row.slug,
            logoUrl: row.logo_file ? `/api/auth/tenant-logo/${Number(row.id)}` : null,
            logoUpdatedAt: row.logo_updated_at ? new Date(row.logo_updated_at).toISOString() : null,
        }));
    }

    function resolveCurrentTenantId(
        tenants: Array<{ id: number; name: string; slug: string; logoUrl: string | null; logoUpdatedAt: string | null }>,
        preferredTenantId?: number | null
    ): number | null {
        if (!tenants.length) return null;
        if (preferredTenantId && tenants.some((t) => t.id === Number(preferredTenantId))) {
            return Number(preferredTenantId);
        }
        return tenants[0].id;
    }

    async function buildAuthContext(user: any) {
        const permissions = await getUserPermissions(user.id);
        const superAdminRole = await db('user_roles')
            .join('roles', 'user_roles.role_id', 'roles.id')
            .where('user_roles.user_id', user.id)
            .where('roles.name', 'Super-Admin')
            .first();

        const tenants = await getUserTenantList(user.id);
        const currentTenantId = resolveCurrentTenantId(tenants, user.default_tenant_id);
        const tenantIds = tenants.map((t) => t.id);

        return {
            permissions: superAdminRole ? ['*'] : permissions,
            tenants,
            currentTenantId,
            tenantIds,
        };
    }

    function getAvatarMeta(user: any): { avatarUrl: string | null; avatarUpdatedAt: string | null } {
        if (!user?.avatar_file) {
            return { avatarUrl: null, avatarUpdatedAt: null };
        }

        const avatarUpdatedAt = user.avatar_updated_at ? new Date(user.avatar_updated_at).toISOString() : null;
        return { avatarUrl: '/api/auth/avatar', avatarUpdatedAt };
    }

    const PINNED_TABS_MAX = 50;
    const PINNED_TAB_PATH_PATTERN = /^\/[a-zA-Z0-9/_-]{1,200}$/;

    function parsePinnedTabs(raw: string | null | undefined): string[] {
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter((p: unknown) => typeof p === 'string' && PINNED_TAB_PATH_PATTERN.test(p)).slice(0, PINNED_TABS_MAX);
        } catch {
            return [];
        }
    }

    async function buildUserResponse(user: any, context: {
        permissions: string[];
        tenants: Array<{ id: number; name: string; slug: string; logoUrl: string | null; logoUpdatedAt: string | null }>;
        currentTenantId: number | null;
    }) {
        const decryptedUser = decryptUserSensitiveFields(user);
        const avatar = getAvatarMeta(decryptedUser);
        let activePlugins: string[] = [];
        try {
            activePlugins = await db('plugins').where('is_active', true).pluck('plugin_id');
        } catch {
            activePlugins = [];
        }
        return {
            id: decryptedUser.id,
            username: decryptedUser.username,
            displayName: decryptedUser.display_name || null,
            firstName: decryptedUser.first_name || null,
            lastName: decryptedUser.last_name || null,
            email: decryptedUser.email,
            mfaEnabled: Boolean(decryptedUser.mfa_enabled),
            permissions: context.permissions,
            tenants: context.tenants,
            currentTenantId: context.currentTenantId,
            avatarUrl: avatar.avatarUrl,
            avatarUpdatedAt: avatar.avatarUpdatedAt,
            createdAt: decryptedUser.created_at ? new Date(decryptedUser.created_at).toISOString() : null,
            pinnedTabs: parsePinnedTabs(user.pinned_tabs_json),
            activePlugins,
        };
    }

    function extractInsertedRefreshTokenId(result: unknown): number | null {
        if (Array.isArray(result)) {
            const first = result[0] as any;
            if (typeof first === 'number' && Number.isInteger(first) && first > 0) return first;
            if (typeof first === 'bigint') {
                const numeric = Number(first);
                return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
            }
            if (typeof first === 'string') {
                const numeric = Number(first);
                return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
            }
            if (first && typeof first === 'object') {
                const candidate = (first as any).id ?? (first as any).insertId;
                const numeric = Number(candidate);
                return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
            }
            return null;
        }
        const numeric = Number(result as any);
        return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
    }

    async function createRefreshSession(userId: number, request: FastifyRequest): Promise<{ refreshToken: string; sessionId: number }> {
        const refreshToken = generateRefreshToken();
        const tokenHash = hashToken(refreshToken);
        const insertResult = await db('refresh_tokens').insert({
            token_hash: tokenHash,
            user_id: userId,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            is_revoked: false,
            created_at: new Date(),
            ip_address: request.ip || null,
            user_agent: (request.headers['user-agent'] || '').slice(0, 500) || null,
        });
        const sessionId = extractInsertedRefreshTokenId(insertResult);
        if (!sessionId) {
            throw new Error('Refresh-Token-Session konnte nicht erstellt werden');
        }
        return { refreshToken, sessionId };
    }

    type DashboardTileSize = 'small' | 'medium' | 'large';

    /** New free-form layout. Falls back from legacy { order, size, visible }. */
    interface DashboardTileLayout {
        x: number;
        y: number;
        w: number;
        h: number;
        visible: boolean;
        viewMode?: string;
    }
    type DashboardLayout = Record<string, DashboardTileLayout>;

    const GRID_COLUMNS = 48;
    const DASHBOARD_VIEW_MODE_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;

    function isObject(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    function clampInt(val: unknown, min: number, max: number, fallback: number): number {
        const n = Number(val);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, Math.round(n)));
    }

    /** Convert legacy size to grid units */
    function legacySizeToGrid(size: unknown): { w: number; h: number } {
        if (size === 'small') return { w: 12, h: 8 };
        if (size === 'large') return { w: 48, h: 8 };
        return { w: 24, h: 8 }; // medium / default
    }

    function normalizeDashboardLayout(input: unknown): DashboardLayout {
        if (!isObject(input)) {
            return {};
        }

        const entries = Object.entries(input);
        if (entries.length > DASHBOARD_MAX_TILES) {
            throw new Error(`Zu viele Kacheln im Layout (maximal ${DASHBOARD_MAX_TILES})`);
        }

        const normalized: DashboardLayout = {};
        const isLegacy = entries.some(([, v]) => isObject(v) && ('size' in (v as any) || 'order' in (v as any)) && !('x' in (v as any)));

        if (isLegacy) {
            // Auto-migrate legacy format: compute x/y from order
            const sorted = entries
                .filter(([key, val]) => DASHBOARD_KEY_PATTERN.test(key) && isObject(val))
                .map(([key, val]) => {
                    const v = val as Record<string, unknown>;
                    const order = clampInt(v.order, 0, 2000, 0);
                    const { w, h } = legacySizeToGrid(v.size);
                    return { key, order, w, h, visible: v.visible !== false };
                })
                .sort((a, b) => a.order - b.order);

            let cursorX = 0;
            let cursorY = 0;
            let rowMaxH = 0;

            for (const tile of sorted) {
                if (cursorX + tile.w > GRID_COLUMNS) {
                    cursorX = 0;
                    cursorY += rowMaxH;
                    rowMaxH = 0;
                }
                normalized[tile.key] = {
                    x: cursorX,
                    y: cursorY,
                    w: tile.w,
                    h: tile.h,
                    visible: tile.visible,
                };
                cursorX += tile.w;
                rowMaxH = Math.max(rowMaxH, tile.h);
            }
        } else {
            // New format
            for (const [tileKey, rawConfig] of entries) {
                if (!DASHBOARD_KEY_PATTERN.test(tileKey)) continue;
                if (!isObject(rawConfig)) continue;

                const w = clampInt(rawConfig.w, 3, GRID_COLUMNS, 12);
                const x = clampInt(rawConfig.x, 0, GRID_COLUMNS - w, 0);

                normalized[tileKey] = {
                    x,
                    y: clampInt(rawConfig.y, 0, 2000, 0),
                    w,
                    h: clampInt(rawConfig.h, 3, 100, 8),
                    visible: rawConfig.visible !== false,
                    viewMode: (typeof rawConfig.viewMode === 'string' && DASHBOARD_VIEW_MODE_PATTERN.test(rawConfig.viewMode))
                        ? rawConfig.viewMode
                        : undefined,
                };
            }
        }

        return normalized;
    }

    async function getDashboardLayout(userId: number): Promise<{ tiles: DashboardLayout; updatedAt: string | null }> {
        let row: any = null;
        try {
            const hasLayoutTable = await db.schema.hasTable(DASHBOARD_LAYOUT_TABLE);
            if (!hasLayoutTable) return { tiles: {}, updatedAt: null };
            row = await db(DASHBOARD_LAYOUT_TABLE)
                .where('user_id', userId)
                .first('layout_json', 'updated_at');
        } catch {
            return { tiles: {}, updatedAt: null };
        }

        if (!row?.layout_json) {
            return { tiles: {}, updatedAt: null };
        }

        try {
            const parsed = JSON.parse(row.layout_json);
            return {
                tiles: normalizeDashboardLayout(parsed),
                updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
            };
        } catch {
            return { tiles: {}, updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null };
        }
    }

    // POST /api/auth/login
    fastify.post('/login', {
        config: { rateLimit: getLoginRateLimitConfig() },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { username, password, mfaCode } = request.body as {
            username: string;
            password: string;
            mfaCode?: string;
        };
        const clientIp = getClientIp(request);

        if (!username || !password) {
            return reply.status(400).send({ error: 'Benutzername und Passwort erforderlich' });
        }

        const user = await db('users').where('username', username).first();
        if (!user || !user.is_active) {
            await recordLoginAttempt(null, clientIp, false);
            await fastify.audit.log({
                action: 'auth.login.failed',
                category: 'auth',
                entityType: 'user',
                newState: { username, reason: 'Benutzer nicht gefunden oder inaktiv' },
            }, request);
            return reply.status(401).send({ error: 'Ungueltige Anmeldedaten' });
        }

        // Account Lockout pruefen
        const lockout = await checkAccountLockout(user.id);
        if (lockout.locked) {
            await fastify.audit.log({
                action: 'auth.login.locked',
                category: 'auth',
                entityType: 'user',
                entityId: user.id,
                newState: { minutesRemaining: lockout.minutesRemaining },
            }, request);
            return reply.status(429).send({
                error: `Account gesperrt. Noch ${lockout.minutesRemaining} Minute(n) warten.`,
            });
        }

        // Passwort pruefen
        const validPassword = await verifyPassword(password, user.password_hash);
        if (!validPassword) {
            await recordLoginAttempt(user.id, clientIp, false);
            await fastify.audit.log({
                action: 'auth.login.failed',
                category: 'auth',
                entityType: 'user',
                entityId: user.id,
                newState: { reason: 'Falsches Passwort' },
            }, request);
            return reply.status(401).send({ error: 'Ungueltige Anmeldedaten' });
        }

        // MFA pruefen
        if (user.mfa_enabled) {
            if (!mfaCode) {
                return reply.status(200).send({ mfaRequired: true });
            }

            if (!user.mfa_secret_encrypted) {
                await recordLoginAttempt(user.id, clientIp, false);
                await fastify.audit.log({
                    action: 'auth.mfa.failed',
                    category: 'auth',
                    entityType: 'user',
                    entityId: user.id,
                    newState: { reason: 'MFA-Konfiguration fehlt' },
                }, request);
                return reply.status(500).send({ error: 'MFA-Konfiguration fehlerhaft. Bitte Administrator kontaktieren.' });
            }

            let secret: string;
            try {
                secret = decryptMFASecret(user.mfa_secret_encrypted);
            } catch {
                await recordLoginAttempt(user.id, clientIp, false);
                await fastify.audit.log({
                    action: 'auth.mfa.failed',
                    category: 'auth',
                    entityType: 'user',
                    entityId: user.id,
                    newState: { reason: 'MFA-Secret ungueltig' },
                }, request);
                return reply.status(500).send({ error: 'MFA-Konfiguration fehlerhaft. Bitte Administrator kontaktieren.' });
            }

            if (!verifyTOTPCode(secret, user.username, mfaCode)) {
                // TOTP fehlgeschlagen – als Recovery-Code versuchen
                let recoveryUsed = false;
                if (user.recovery_codes_encrypted && mfaCode.length >= 8) {
                    try {
                        const codes = decryptRecoveryCodes(user.recovery_codes_encrypted);
                        const result = useRecoveryCode(codes, mfaCode);
                        if (result.valid) {
                            recoveryUsed = true;
                            await db('users').where('id', user.id).update({
                                recovery_codes_encrypted: encryptRecoveryCodes(result.remainingCodes),
                            });
                            await fastify.audit.log({
                                action: 'auth.mfa.recovery_used',
                                category: 'auth',
                                entityType: 'user',
                                entityId: user.id,
                                newState: { remainingCodes: result.remainingCodes.length },
                            }, request);
                        }
                    } catch { /* Recovery-Entschluesselung fehlgeschlagen, ignorieren */ }
                }

                if (!recoveryUsed) {
                    await recordLoginAttempt(user.id, clientIp, false);
                    await fastify.audit.log({
                        action: 'auth.mfa.failed',
                        category: 'auth',
                        entityType: 'user',
                        entityId: user.id,
                    }, request);
                    return reply.status(401).send({ error: 'Ungueltiger Code' });
                }
            }
        }

        // Login erfolgreich
        await recordLoginAttempt(user.id, clientIp, true);

        const context = await buildAuthContext(user);
        if (!context.currentTenantId) {
            return reply.status(403).send({ error: 'Dem Benutzer ist kein aktiver Mandant zugewiesen' });
        }

        const { refreshToken, sessionId } = await createRefreshSession(user.id, request);

        const payload = {
            userId: user.id,
            username: user.username,
            permissions: context.permissions,
            tenantId: context.currentTenantId,
            tenantIds: context.tenantIds,
            sessionId,
        };

        const accessToken = generateAccessToken(payload);

        setAuthCookies(request, reply, accessToken, refreshToken);

        await fastify.audit.log({
            action: 'auth.login.success',
            category: 'auth',
            entityType: 'user',
            entityId: user.id,
        }, request);

        return reply.send({ user: await buildUserResponse(user, context) });
    });

    // POST /api/auth/refresh
    fastify.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
        const refreshToken = (request.cookies as any)?.refresh_token;
        if (!refreshToken) {
            return reply.status(401).send({ error: 'Kein Refresh-Token' });
        }

        const tokenHash = hashToken(refreshToken);
        const storedToken = await db('refresh_tokens')
            .where('token_hash', tokenHash)
            .first();

        if (!storedToken) {
            return reply.status(401).send({ error: 'Ungueltiger Refresh-Token' });
        }

        // Token bereits verbraucht => Token-Diebstahl-Erkennung
        if (storedToken.is_revoked) {
            // Alle Tokens des Users invalidieren
            await db('refresh_tokens')
                .where('user_id', storedToken.user_id)
                .update({ is_revoked: true });

            await fastify.audit.log({
                action: 'auth.token.theft_detected',
                category: 'auth',
                entityType: 'user',
                entityId: storedToken.user_id,
                newState: { reason: 'Refresh Token wiederverwendet' },
            }, request);

            clearAuthCookies(request, reply);
            return reply.status(401).send({ error: 'Sicherheitswarnung: Alle Sessions wurden beendet' });
        }

        // Token abgelaufen?
        if (new Date(storedToken.expires_at) < new Date()) {
            await db('refresh_tokens').where('id', storedToken.id).update({ is_revoked: true });
            clearAuthCookies(request, reply);
            return reply.status(401).send({ error: 'Refresh-Token abgelaufen' });
        }

        // Alten Token invalidieren (Rotation)
        await db('refresh_tokens').where('id', storedToken.id).update({ is_revoked: true });

        // Neues Token-Paar erstellen
        const user = await db('users').where('id', storedToken.user_id).first();
        if (!user || !user.is_active) {
            clearAuthCookies(request, reply);
            return reply.status(401).send({ error: 'Benutzer nicht mehr aktiv' });
        }

        const context = await buildAuthContext(user);
        if (!context.currentTenantId) {
            clearAuthCookies(request, reply);
            return reply.status(403).send({ error: 'Dem Benutzer ist kein aktiver Mandant zugewiesen' });
        }

        const { refreshToken: newRefreshToken, sessionId } = await createRefreshSession(user.id, request);

        const payload = {
            userId: user.id,
            username: user.username,
            permissions: context.permissions,
            tenantId: context.currentTenantId,
            tenantIds: context.tenantIds,
            sessionId,
        };

        const newAccessToken = generateAccessToken(payload);

        setAuthCookies(request, reply, newAccessToken, newRefreshToken);

        return reply.send({ user: await buildUserResponse(user, context) });
    });

    // POST /api/auth/logout
    fastify.post('/logout', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const sessionId = Number(request.user.sessionId);
        if (Number.isInteger(sessionId) && sessionId > 0) {
            await db('refresh_tokens')
                .where({ id: sessionId, user_id: request.user.userId })
                .update({ is_revoked: true });
        }

        const refreshToken = (request.cookies as any)?.refresh_token;
        if (refreshToken) {
            const tokenHash = hashToken(refreshToken);
            await db('refresh_tokens')
                .where({ token_hash: tokenHash, user_id: request.user.userId })
                .update({ is_revoked: true });
        }

        await fastify.audit.log({
            action: 'auth.logout',
            category: 'auth',
            entityType: 'user',
            entityId: request.user.userId,
        }, request);

        clearAuthCookies(request, reply);
        return reply.send({ success: true });
    });

    // GET /api/auth/ws-token – Kurzlebiges Token fuer WebSocket-Verbindung
    fastify.get('/ws-token', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const token = generateAccessToken({
                userId: request.user.userId,
                username: request.user.username || '',
                tenantId: request.user.tenantId,
                tenantIds: request.user.tenantIds || [],
                permissions: request.user.permissions || [],
                sessionId: request.user.sessionId || 0,
            }, '5m');
            return reply.send({ token });
        } catch (error) {
            request.log.error({ err: error }, 'ws-token konnte nicht erstellt werden');
            return reply.status(401).send({ error: 'Nicht autorisiert' });
        }
    });

    // GET /api/auth/me
    fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const user = await db('users').where('id', request.user.userId).first();
            if (!user) {
                return reply.status(404).send({ error: 'Benutzer nicht gefunden' });
            }

            const roles = await db('user_roles')
                .join('roles', 'user_roles.role_id', 'roles.id')
                .where('user_roles.user_id', user.id)
                .select('roles.name');
            const context = await buildAuthContext(user);

            return reply.send({
                ...(await buildUserResponse(user, context)),
                roles: roles.map((r: any) => r.name),
            });
        } catch (error) {
            request.log.error({ err: error }, 'auth/me fehlgeschlagen');
            return reply.status(500).send({ error: 'Benutzerdaten konnten nicht geladen werden' });
        }
    });

    // GET /api/auth/profile
    fastify.get('/profile', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await db('users').where('id', request.user.userId).first();
        if (!user) {
            return reply.status(404).send({ error: 'Benutzer nicht gefunden' });
        }

        const roles = await db('user_roles')
            .join('roles', 'user_roles.role_id', 'roles.id')
            .where('user_roles.user_id', user.id)
            .select('roles.name');
        const context = await buildAuthContext(user);

        return reply.send({
            ...(await buildUserResponse(user, context)),
            roles: roles.map((r: any) => r.name),
        });
    });

    // POST /api/auth/change-password
    fastify.post('/change-password', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };

        if (!currentPassword || !newPassword) {
            return reply.status(400).send({ error: 'Aktuelles und neues Passwort erforderlich' });
        }

        const user = await db('users').where('id', request.user.userId).first();
        if (!user) return reply.status(404).send({ error: 'Benutzer nicht gefunden' });

        // Aktuelles Passwort pruefen
        const valid = await verifyPassword(currentPassword, user.password_hash);
        if (!valid) {
            return reply.status(400).send({ error: 'Aktuelles Passwort ist falsch' });
        }

        // Neues Passwort validieren
        if (newPassword.length < 10) return reply.status(400).send({ error: 'Neues Passwort muss mindestens 10 Zeichen lang sein' });
        if (!/[A-Z]/.test(newPassword)) return reply.status(400).send({ error: 'Neues Passwort muss mindestens einen Großbuchstaben enthalten' });
        if (!/[a-z]/.test(newPassword)) return reply.status(400).send({ error: 'Neues Passwort muss mindestens einen Kleinbuchstaben enthalten' });
        if (!/[0-9]/.test(newPassword)) return reply.status(400).send({ error: 'Neues Passwort muss mindestens eine Zahl enthalten' });
        if (!/[^A-Za-z0-9]/.test(newPassword)) return reply.status(400).send({ error: 'Neues Passwort muss mindestens ein Sonderzeichen enthalten' });

        // Hash + speichern
        const newHash = await hashPassword(newPassword);
        await db('users').where('id', user.id).update({ password_hash: newHash });

        await fastify.audit.log({
            action: 'auth.password.changed',
            category: 'auth',
            entityType: 'user',
            entityId: user.id,
        }, request);

        return reply.send({ success: true });
    });

    // GET /api/auth/dashboard-layout
    fastify.get('/dashboard-layout', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const layout = await getDashboardLayout(request.user.userId);
            return reply.send(layout);
        } catch (error) {
            request.log.error({ err: error }, 'dashboard-layout konnte nicht geladen werden');
            return reply.send({ tiles: {}, updatedAt: null });
        }
    });

    // PUT /api/auth/dashboard-layout
    fastify.put('/dashboard-layout', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body ?? {}) as { tiles?: unknown };
        const { tiles } = body;

        let normalized: DashboardLayout;
        try {
            normalized = normalizeDashboardLayout(tiles);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Ungültiges Dashboard-Layout';
            return reply.status(400).send({ error: message });
        }

        const now = new Date();
        const payload = JSON.stringify(normalized);

        const hasLayoutTable = await db.schema.hasTable(DASHBOARD_LAYOUT_TABLE);
        if (!hasLayoutTable) {
            return reply.send({
                success: true,
                tiles: normalized,
                updatedAt: now.toISOString(),
            });
        }

        const existing = await db(DASHBOARD_LAYOUT_TABLE)
            .where('user_id', request.user.userId)
            .first('user_id');

        if (existing) {
            await db(DASHBOARD_LAYOUT_TABLE)
                .where('user_id', request.user.userId)
                .update({
                    layout_json: payload,
                    updated_at: now,
                });
        } else {
            await db(DASHBOARD_LAYOUT_TABLE).insert({
                user_id: request.user.userId,
                layout_json: payload,
                updated_at: now,
            });
        }

        await fastify.audit.log({
            action: 'auth.dashboard.layout.updated',
            category: 'auth',
            entityType: 'dashboard_layout',
            entityId: request.user.userId,
            newState: { tileCount: Object.keys(normalized).length },
            tenantId: null,
        }, request);

        return reply.send({
            success: true,
            tiles: normalized,
            updatedAt: now.toISOString(),
        });
    });

    // GET /api/auth/avatar
    fastify.get('/avatar', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await db('users').where('id', request.user.userId).first();
        if (!user?.avatar_file) {
            return reply.status(404).send({ error: 'Kein Avatar vorhanden' });
        }

        const filePath = path.join(avatarDir, user.avatar_file);
        if (!existsSync(filePath)) {
            return reply.status(404).send({ error: 'Avatar-Datei nicht gefunden' });
        }

        const content = await readFile(filePath);
        const ext = path.extname(user.avatar_file).toLowerCase();
        const mime = ext === '.png'
            ? 'image/png'
            : ext === '.webp'
                ? 'image/webp'
                : ext === '.gif'
                    ? 'image/gif'
                    : 'image/jpeg';

        reply.header('Cache-Control', 'private, max-age=300');
        return reply.type(mime).send(content);
    });

    // GET /api/auth/tenant-logo/:tenantId
    fastify.get('/tenant-logo/:tenantId', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { tenantId } = request.params as { tenantId: string };
        const tenantIdNum = Number(tenantId);
        if (!Number.isInteger(tenantIdNum) || tenantIdNum <= 0) {
            return reply.status(400).send({ error: 'Ungültige Mandanten-ID' });
        }

        const assignment = await db('user_tenants')
            .where({ user_id: request.user.userId, tenant_id: tenantIdNum })
            .first('user_id');
        if (!assignment) {
            return reply.status(403).send({ error: 'Keine Berechtigung für diesen Mandanten' });
        }

        const tenant = await db('tenants')
            .where('id', tenantIdNum)
            .first('logo_file');
        if (!tenant?.logo_file) {
            return reply.status(404).send({ error: 'Kein Mandanten-Logo vorhanden' });
        }

        const filePath = path.join(tenantLogoDir, String(tenant.logo_file));
        if (!existsSync(filePath)) {
            return reply.status(404).send({ error: 'Mandanten-Logo nicht gefunden' });
        }

        const content = await readFile(filePath);
        const ext = path.extname(String(tenant.logo_file)).toLowerCase();
        const mime = ext === '.png'
            ? 'image/png'
            : ext === '.webp'
                ? 'image/webp'
                : ext === '.gif'
                    ? 'image/gif'
                    : 'image/jpeg';

        reply.header('Cache-Control', 'private, max-age=300');
        return reply.type(mime).send(content);
    });

    // GET /api/auth/branding (oeffentlich, kein Auth)
    // Liefert nur generische Branding-Info fuer die Login-Seite (keine Tenant-Details)
    fastify.get('/branding', { config: { policy: { public: true } } }, async (_request: FastifyRequest, reply: FastifyReply) => {
        return reply.send({
            companyName: 'Hammer WorkSpace',
            hasLogo: false,
            logoUrl: null,
        });
    });

    // GET /api/auth/branding/logo (oeffentlich, kein Auth)
    // Kein tenant-spezifisches Logo ohne Authentifizierung
    fastify.get('/branding/logo', { config: { policy: { public: true } } }, async (_request: FastifyRequest, reply: FastifyReply) => {
        return reply.status(404).send({ error: 'Kein oeffentliches Logo verfuegbar' });
    });

    // POST /api/auth/avatar
    fastify.post('/avatar', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await db('users').where('id', request.user.userId).first();
        if (!user) {
            return reply.status(404).send({ error: 'Benutzer nicht gefunden' });
        }

        const file = await (request as any).file();
        if (!file) {
            return reply.status(400).send({ error: 'Datei ist erforderlich' });
        }

        const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
        if (!allowed.has(file.mimetype)) {
            return reply.status(400).send({ error: 'Nur JPG, PNG, WEBP oder GIF erlaubt' });
        }

        const ext = file.mimetype === 'image/png'
            ? '.png'
            : file.mimetype === 'image/webp'
                ? '.webp'
                : file.mimetype === 'image/gif'
                    ? '.gif'
                    : '.jpg';

        const buffer = await file.toBuffer();
        if (!buffer.length) {
            return reply.status(400).send({ error: 'Leere Datei' });
        }
        if (buffer.length > 5 * 1024 * 1024) {
            return reply.status(413).send({ error: 'Avatar darf maximal 5 MB groß sein' });
        }

        await mkdir(avatarDir, { recursive: true });
        const timestamp = Date.now();
        const fileName = `user-${user.id}-${timestamp}${ext}`;
        const filePath = path.join(avatarDir, fileName);
        await writeFile(filePath, buffer);

        if (user.avatar_file) {
            const oldPath = path.join(avatarDir, user.avatar_file);
            if (existsSync(oldPath)) {
                await rm(oldPath, { force: true });
            }
        }

        const avatarUpdatedAt = new Date();
        await db('users').where('id', user.id).update({
            avatar_file: fileName,
            avatar_updated_at: avatarUpdatedAt,
        });

        await fastify.audit.log({
            action: 'auth.profile.avatar_updated',
            category: 'auth',
            entityType: 'user',
            entityId: user.id,
            newState: { avatarFile: fileName },
        }, request);

        return reply.send({
            success: true,
            avatarUrl: '/api/auth/avatar',
            avatarUpdatedAt: avatarUpdatedAt.toISOString(),
        });
    });

    // POST /api/auth/switch-tenant
    fastify.post('/switch-tenant', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { tenantId } = request.body as { tenantId?: number };
        if (!tenantId) {
            return reply.status(400).send({ error: 'tenantId ist erforderlich' });
        }

        const user = await db('users').where('id', request.user.userId).first();
        if (!user || !user.is_active) {
            return reply.status(401).send({ error: 'Benutzer nicht mehr aktiv' });
        }

        const tenants = await getUserTenantList(user.id);
        const targetTenant = tenants.find((t) => t.id === Number(tenantId));
        if (!targetTenant) {
            return reply.status(403).send({ error: 'Keine Berechtigung fuer diesen Mandanten' });
        }

        await db('users').where('id', user.id).update({ default_tenant_id: targetTenant.id });

        const context = await buildAuthContext({ ...user, default_tenant_id: targetTenant.id });
        if (!context.currentTenantId) {
            return reply.status(403).send({ error: 'Dem Benutzer ist kein aktiver Mandant zugewiesen' });
        }

        const accessToken = generateAccessToken({
            userId: user.id,
            username: user.username,
            permissions: context.permissions,
            tenantId: context.currentTenantId,
            tenantIds: context.tenantIds,
            sessionId: request.user.sessionId,
        });

        reply.setCookie('access_token', accessToken, {
            httpOnly: true,
            secure: useSecureCookie(request),
            sameSite: 'strict',
            path: '/',
            maxAge: 15 * 60,
        });

        await fastify.audit.log({
            action: 'auth.tenant.switched',
            category: 'auth',
            entityType: 'tenant',
            entityId: targetTenant.id,
            newState: { tenantId: targetTenant.id, tenantName: targetTenant.name },
        }, request);

        return reply.send({ user: await buildUserResponse(user, context) });
    });

    // GET /api/auth/search?q=...  -- Globale Suche
    fastify.get('/search', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { q } = request.query as { q?: string };
        if (!q || typeof q !== 'string' || q.trim().length < 2) {
            return reply.send([]);
        }

        const query = q.trim().toLowerCase();
        // F2 Security Fix: LIKE-Wildcards escapen (verhindert Wildcard-Injection)
        const safeTerm = query.replace(/[%_\\]/g, '\\$&');
        const permissions = request.user?.permissions || [];
        const hasPerm = (p: string) => permissions.includes('*') || permissions.includes(p);

        interface SearchResult {
            title: string;
            description?: string;
            path: string;
            category: string;
        }

        const results: SearchResult[] = [];

        // 1) Statische Seiten durchsuchen
        const pages: Array<{ title: string; description: string; path: string; permission?: string }> = [
            { title: 'Dashboard', description: 'Startseite', path: '/' },
            { title: 'Profil', description: 'Profilseite bearbeiten', path: '/profile' },
            { title: 'Changelog', description: 'Versionshistorie', path: '/changelog' },
            { title: 'Administration', description: 'Admin-Bereich', path: '/admin', permission: 'admin.access' },
            { title: 'Benutzer', description: 'Benutzerverwaltung', path: '/admin/users', permission: 'users.view' },
            { title: 'Rollen', description: 'Rollen und Rechte', path: '/admin/roles', permission: 'roles.view' },
            { title: 'Mandanten', description: 'Mandantenverwaltung', path: '/admin/tenants', permission: 'tenants.manage' },
            { title: 'Einstellungen', description: 'Systemeinstellungen', path: '/admin/settings', permission: 'settings.manage' },
            { title: 'Audit-Log', description: 'Aktivitätsprotokoll', path: '/admin/audit', permission: 'audit.view' },
            { title: 'Backup', description: 'Sicherung & Wiederherstellung', path: '/admin/backup', permission: 'backup.export' },
            { title: 'Updates & Plugins', description: 'Updates und Plugin-Verwaltung', path: '/admin/updates', permission: 'updates.manage' },
            { title: 'Dokumentenverwaltung', description: 'Speicherorte und Verzeichnisse', path: '/admin/documents', permission: 'documents.manage' },
            { title: 'Sicherheit', description: 'Sicherheitseinstellungen', path: '/admin/security', permission: 'admin.access' },
        ];

        for (const page of pages) {
            if (page.permission && !hasPerm(page.permission)) continue;
            if (
                page.title.toLowerCase().includes(query) ||
                page.description.toLowerCase().includes(query)
            ) {
                results.push({ title: page.title, description: page.description, path: page.path, category: 'Seiten' });
            }
        }

        // 2) Benutzer suchen (wenn Berechtigung)
        if (hasPerm('users.view')) {
            try {
                const users = await db('users')
                    .where(function () {
                        this.where('username', 'like', `%${safeTerm}%`)
                            .orWhere('display_name', 'like', `%${safeTerm}%`)
                            .orWhere('email', 'like', `%${safeTerm}%`);
                    })
                    .limit(5)
                    .select('id', 'username', 'display_name', 'email');

                for (const u of users) {
                    const decrypted = decryptUserSensitiveFields(u);
                    results.push({
                        title: decrypted.display_name || decrypted.username,
                        description: `Benutzer: ${decrypted.username}`,
                        path: '/admin/users',
                        category: 'Benutzer',
                    });
                }
            } catch { /* ignore */ }
        }

        // 3) Mandanten suchen (wenn Berechtigung)
        if (hasPerm('tenants.manage')) {
            try {
                const tenants = await db('tenants')
                    .where('name', 'like', `%${safeTerm}%`)
                    .limit(5)
                    .select('id', 'name');

                for (const t of tenants) {
                    results.push({
                        title: t.name,
                        description: 'Mandant',
                        path: '/admin/tenants',
                        category: 'Mandanten',
                    });
                }
            } catch { /* ignore */ }
        }

        return reply.send(results);
    });

    // POST /api/auth/mfa/setup
    fastify.post('/mfa/setup', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await db('users').where('id', request.user.userId).first();
        if (user.mfa_enabled) {
            return reply.status(400).send({ error: 'MFA ist bereits aktiviert' });
        }

        const secret = generateTOTPSecret();
        const qrCode = await generateQRCodeDataURL(secret, user.username);
        const recoveryCodes = generateRecoveryCodes();

        // Temporaer speichern (noch nicht aktiviert)
        await db('users').where('id', user.id).update({
            mfa_secret_encrypted: encryptMFASecret(secret),
            recovery_codes_encrypted: encryptRecoveryCodes(recoveryCodes),
        });

        await fastify.audit.log({
            action: 'auth.mfa.setup_started',
            category: 'auth',
            entityType: 'user',
            entityId: user.id,
        }, request);

        return reply.send({ qrCode, recoveryCodes, secret });
    });

    // POST /api/auth/mfa/verify (Aktivierung bestaetigen)
    fastify.post('/mfa/verify', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { code } = request.body as { code: string };
        const user = await db('users').where('id', request.user.userId).first();

        if (user.mfa_enabled) {
            return reply.status(400).send({ error: 'MFA ist bereits aktiviert' });
        }

        if (!user.mfa_secret_encrypted) {
            return reply.status(400).send({ error: 'Zuerst MFA-Setup starten' });
        }

        const secret = decryptMFASecret(user.mfa_secret_encrypted);
        if (!verifyTOTPCode(secret, user.username, code)) {
            return reply.status(400).send({ error: 'Ungueltiger Code' });
        }

        await db('users').where('id', user.id).update({ mfa_enabled: true });

        await fastify.audit.log({
            action: 'auth.mfa.enabled',
            category: 'auth',
            entityType: 'user',
            entityId: user.id,
        }, request);

        return reply.send({ success: true, message: 'MFA erfolgreich aktiviert' });
    });

    // POST /api/auth/mfa/disable
    fastify.post('/mfa/disable', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { password } = request.body as { password: string };
        const user = await db('users').where('id', request.user.userId).first();

        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) {
            return reply.status(401).send({ error: 'Falsches Passwort' });
        }

        await db('users').where('id', user.id).update({
            mfa_enabled: false,
            mfa_secret_encrypted: null,
            recovery_codes_encrypted: null,
        });

        await fastify.audit.log({
            action: 'auth.mfa.disabled',
            category: 'auth',
            entityType: 'user',
            entityId: user.id,
        }, request);

        return reply.send({ success: true });
    });

    // POST /api/auth/mfa/recovery
    fastify.post('/mfa/recovery', {
        config: { rateLimit: getLoginRateLimitConfig(), policy: { public: true } },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { username, password, recoveryCode } = request.body as {
            username: string;
            password: string;
            recoveryCode: string;
        };
        const clientIp = getClientIp(request);

        if (!username || !password || !recoveryCode) {
            return reply.status(400).send({ error: 'Benutzername, Passwort und Recovery-Code erforderlich' });
        }

        const user = await db('users').where('username', username).first();
        if (!user || !user.is_active) {
            await recordLoginAttempt(null, clientIp, false);
            await fastify.audit.log({
                action: 'auth.mfa.recovery_failed',
                category: 'auth',
                entityType: 'user',
                newState: { username, reason: 'Benutzer nicht gefunden oder inaktiv' },
            }, request);
            return reply.status(401).send({ error: 'Ungueltige Anmeldedaten' });
        }

        // Gleicher Lockout-Schutz wie bei normalem Login.
        const lockout = await checkAccountLockout(user.id);
        if (lockout.locked) {
            await fastify.audit.log({
                action: 'auth.login.locked',
                category: 'auth',
                entityType: 'user',
                entityId: user.id,
                newState: { minutesRemaining: lockout.minutesRemaining, via: 'mfa.recovery' },
            }, request);
            return reply.status(429).send({
                error: `Account gesperrt. Noch ${lockout.minutesRemaining} Minute(n) warten.`,
            });
        }

        const validPassword = await verifyPassword(password, user.password_hash);
        if (!validPassword) {
            await recordLoginAttempt(user.id, clientIp, false);
            await fastify.audit.log({
                action: 'auth.mfa.recovery_failed',
                category: 'auth',
                entityType: 'user',
                entityId: user.id,
                newState: { reason: 'Falsches Passwort' },
            }, request);
            return reply.status(401).send({ error: 'Ungueltige Anmeldedaten' });
        }

        if (!user.recovery_codes_encrypted) {
            return reply.status(400).send({ error: 'Keine Recovery-Codes vorhanden' });
        }

        let codes: string[];
        try {
            codes = decryptRecoveryCodes(user.recovery_codes_encrypted);
        } catch {
            await recordLoginAttempt(user.id, clientIp, false);
            await fastify.audit.log({
                action: 'auth.mfa.recovery_failed',
                category: 'auth',
                entityType: 'user',
                entityId: user.id,
                newState: { reason: 'Recovery-Codes ungueltig gespeichert' },
            }, request);
            return reply.status(500).send({ error: 'MFA-Konfiguration fehlerhaft. Bitte Administrator kontaktieren.' });
        }
        const result = useRecoveryCode(codes, recoveryCode);

        if (!result.valid) {
            await recordLoginAttempt(user.id, clientIp, false);
            await fastify.audit.log({
                action: 'auth.mfa.recovery_failed',
                category: 'auth',
                entityType: 'user',
                entityId: user.id,
                newState: { reason: 'Ungueltiger Recovery-Code' },
            }, request);
            return reply.status(401).send({ error: 'Ungueltiger Recovery-Code' });
        }

        await recordLoginAttempt(user.id, clientIp, true);

        // Verbleibende Codes aktualisieren
        await db('users').where('id', user.id).update({
            recovery_codes_encrypted: encryptRecoveryCodes(result.remainingCodes),
        });

        // Login durchfuehren
        const context = await buildAuthContext(user);
        if (!context.currentTenantId) {
            return reply.status(403).send({ error: 'Dem Benutzer ist kein aktiver Mandant zugewiesen' });
        }

        const { refreshToken: newRefreshToken, sessionId } = await createRefreshSession(user.id, request);

        const payload = {
            userId: user.id,
            username: user.username,
            permissions: context.permissions,
            tenantId: context.currentTenantId,
            tenantIds: context.tenantIds,
            sessionId,
        };

        const accessToken = generateAccessToken(payload);

        setAuthCookies(request, reply, accessToken, newRefreshToken);

        await fastify.audit.log({
            action: 'auth.mfa.recovery_used',
            category: 'auth',
            entityType: 'user',
            entityId: user.id,
            newState: { remainingCodes: result.remainingCodes.length },
        }, request);

        return reply.send({
            user: await buildUserResponse(user, context),
            remainingRecoveryCodes: result.remainingCodes.length,
        });
    });

    // GET /api/auth/pinned-tabs
    fastify.get('/pinned-tabs', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const user = await db('users').where('id', request.user.userId).first('pinned_tabs_json');
        if (!user) return reply.status(404).send({ error: 'Benutzer nicht gefunden' });
        return reply.send({ pinnedTabs: parsePinnedTabs(user.pinned_tabs_json) });
    });

    // PUT /api/auth/pinned-tabs
    fastify.put('/pinned-tabs', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { pinnedTabs } = (request.body ?? {}) as { pinnedTabs?: unknown };

        if (!Array.isArray(pinnedTabs)) {
            return reply.status(400).send({ error: 'pinnedTabs muss ein Array sein' });
        }

        if (pinnedTabs.length > PINNED_TABS_MAX) {
            return reply.status(400).send({ error: `Maximal ${PINNED_TABS_MAX} gepinnte Tabs erlaubt` });
        }

        const validated: string[] = [];
        for (const tab of pinnedTabs) {
            if (typeof tab !== 'string' || !PINNED_TAB_PATH_PATTERN.test(tab)) {
                return reply.status(400).send({ error: `Ungueltiger Tab-Pfad: ${String(tab).slice(0, 50)}` });
            }
            validated.push(tab);
        }

        await db('users').where('id', request.user.userId).update({
            pinned_tabs_json: JSON.stringify(validated),
        });

        await fastify.audit.log({
            action: 'auth.pinned_tabs.updated',
            category: 'auth',
            entityType: 'user',
            entityId: request.user.userId,
            newState: { count: validated.length },
            tenantId: null,
        }, request);

        return reply.send({ pinnedTabs: validated });
    });
}
