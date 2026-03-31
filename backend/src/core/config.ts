import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Fehlende Umgebungsvariable: ${key}`);
    }
    return value;
}

function optionalEnv(key: string, defaultValue: string): string {
    return process.env[key] || defaultValue;
}

function optionalBoolEnv(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (!value) return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function optionalCsvEnv(key: string): string[] {
    const raw = process.env[key];
    if (!raw) return [];
    return raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
}

function normalizeUpdateUrl(value: string): string {
    const fallback = 'https://api.github.com/repos/marchmr/workspace';
    const raw = (value || '').trim();
    if (!raw) return fallback;

    const lower = raw.toLowerCase();
    // Legacy-Migrationspfad: alte Mike-Update-Quellen immer auf neues Repo umbiegen.
    if (lower.includes('download.mike-server.eu')) return fallback;
    if (lower.includes('/repos/mike') && !lower.includes('/repos/marchmr/workspace')) return fallback;

    return raw;
}

function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map((part) => parseInt(part, 10) || 0);
    const pb = b.split('.').map((part) => parseInt(part, 10) || 0);
    const max = Math.max(pa.length, pb.length);
    for (let i = 0; i < max; i++) {
        const va = pa[i] || 0;
        const vb = pb[i] || 0;
        if (va > vb) return 1;
        if (va < vb) return -1;
    }
    return 0;
}

function readBackendPackageVersion(): string | null {
    try {
        const packagePath = path.resolve(__dirname, '../../package.json');
        const raw = fs.readFileSync(packagePath, 'utf8');
        const parsed = JSON.parse(raw);
        const version = typeof parsed?.version === 'string' ? parsed.version.trim() : '';
        return version || null;
    } catch {
        return null;
    }
}

function resolveAppVersion(defaultVersion: string): string {
    const envVersion = (process.env.APP_VERSION || '').trim();
    const packageVersion = readBackendPackageVersion();

    if (envVersion && packageVersion) {
        return compareVersions(packageVersion, envVersion) >= 0 ? packageVersion : envVersion;
    }
    if (packageVersion) return packageVersion;
    if (envVersion) return envVersion;
    return defaultVersion;
}

const appRootDir = path.resolve(__dirname, '../../..');
const appPort = parseInt(optionalEnv('PORT', '3000'), 10);

export const config = {
    db: {
        host: requireEnv('DB_HOST'),
        port: parseInt(optionalEnv('DB_PORT', '3306'), 10),
        name: requireEnv('DB_NAME'),
        user: requireEnv('DB_USER'),
        password: requireEnv('DB_PASSWORD'),
    },

    encryption: {
        key: requireEnv('ENCRYPTION_KEY'),
    },

    jwt: {
        secret: requireEnv('JWT_SECRET'),
        accessExpiry: optionalEnv('JWT_ACCESS_EXPIRY', '15m'),
        refreshExpiry: optionalEnv('JWT_REFRESH_EXPIRY', '7d'),
        cookieSecure: optionalEnv('COOKIE_SECURE', 'auto'),
    },

    server: {
        port: appPort,
        env: optionalEnv('NODE_ENV', 'production'),
    },

    update: {
        url: normalizeUpdateUrl(optionalEnv('UPDATE_URL', 'https://api.github.com/repos/marchmr/workspace')),
        requireHash: optionalBoolEnv('UPDATE_REQUIRE_HASH', true),
        backupDir: optionalEnv('UPDATE_BACKUP_DIR', ''),
        maxBackups: { main: 5, experimental: 10 } as Record<string, number>,
    },

    backup: {
        encryptionKey: optionalEnv('BACKUP_ENCRYPTION_KEY', ''),
    },

    documents: {
        storageProvider: optionalEnv('DOCUMENT_STORAGE_PROVIDER', 'local'),
        maxFileSizeMb: parseInt(optionalEnv('DOCUMENT_MAX_FILE_SIZE_MB', '25'), 10),
        allowAllMimeTypes: optionalBoolEnv('DOCUMENT_ALLOW_ALL_MIME_TYPES', false),
    },

    app: {
        version: resolveAppVersion('1.20.0'),
        // App-Root: eine Ebene oberhalb von backend/ (funktioniert in src und dist)
        rootDir: appRootDir,
        pluginsDir: path.resolve(__dirname, '../../../plugins'),
        uploadsDir: path.resolve(__dirname, '../../../uploads'),
    },

    subdomainProvisioning: {
        enabled: optionalBoolEnv('SUBDOMAIN_PROVISIONING_ENABLED', true),
        useSudo: optionalBoolEnv('SUBDOMAIN_PROVISIONING_USE_SUDO', true),
        frontendDistDir: optionalEnv('SUBDOMAIN_FRONTEND_DIST_DIR', path.resolve(appRootDir, 'frontend/dist')),
        backendProxyUrl: optionalEnv('SUBDOMAIN_BACKEND_PROXY_URL', `http://127.0.0.1:${appPort}`),
        nginxSitesAvailableDir: optionalEnv('SUBDOMAIN_NGINX_SITES_AVAILABLE_DIR', '/etc/nginx/sites-available'),
        nginxSitesEnabledDir: optionalEnv('SUBDOMAIN_NGINX_SITES_ENABLED_DIR', '/etc/nginx/sites-enabled'),
        sslEmail: optionalEnv('SUBDOMAIN_SSL_EMAIL', optionalEnv('SSL_EMAIL', '')),
        expectedServerIps: optionalCsvEnv('SUBDOMAIN_EXPECTED_SERVER_IPS'),
    },
} as const;

export function generateRandomKey(bytes: number = 32): string {
    return randomBytes(bytes).toString('hex');
}
