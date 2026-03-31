/**
 * Health-Check + Changelog Endpoints
 * GET /api/health – Öffentlich (keine Authentifizierung)
 * GET /api/changelog – Öffentlich (Versionshistorie, inkl. Plugin-Changelogs)
 */

import { FastifyInstance } from 'fastify';
import { getDatabase } from '../core/database.js';
import { config } from '../core/config.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const startedAt = Date.now();

interface ChangelogEntry {
    version: string;
    date: string;
    changes: string[];
    plugin?: string;       // Plugin-ID, falls es ein Plugin-Changelog ist
    pluginName?: string;   // Anzeigename des Plugins
}

// Core-Changelog beim Start laden und cachen
let coreChangelogCache: ChangelogEntry[] | null = null;

async function loadCoreChangelog(): Promise<ChangelogEntry[]> {
    if (coreChangelogCache) return coreChangelogCache;
    try {
        const changelogPath = path.resolve(__dirname, '../../changelog.json');
        const raw = await fs.readFile(changelogPath, 'utf8');
        coreChangelogCache = JSON.parse(raw);
        return coreChangelogCache || [];
    } catch {
        return [];
    }
}

/**
 * Plugin-Changelogs laden.
 * Jedes Plugin kann eine `changelog.json` im Root-Verzeichnis haben.
 * Format: Array von { version, date, changes[] }
 * Die Plugin-ID und der Name werden aus dem manifest.json gelesen.
 */
async function loadPluginChangelogs(): Promise<ChangelogEntry[]> {
    const pluginEntries: ChangelogEntry[] = [];

    try {
        const pluginsDir = config.app.pluginsDir;
        const dirs = await fs.readdir(pluginsDir, { withFileTypes: true });

        for (const dir of dirs) {
            if (!dir.isDirectory() || dir.name.startsWith('_') || dir.name.startsWith('.')) continue;

            const pluginDir = path.join(pluginsDir, dir.name);

            // Manifest lesen für ID + Name
            let pluginId = dir.name;
            let pluginName = dir.name;
            try {
                const manifestRaw = await fs.readFile(path.join(pluginDir, 'manifest.json'), 'utf8');
                const manifest = JSON.parse(manifestRaw);
                if (manifest.id) pluginId = manifest.id;
                if (manifest.name) pluginName = manifest.name;
            } catch { /* Kein Manifest → Ordnername verwenden */ }

            // Changelog lesen
            try {
                const changelogRaw = await fs.readFile(path.join(pluginDir, 'changelog.json'), 'utf8');
                const entries: any[] = JSON.parse(changelogRaw);
                if (Array.isArray(entries)) {
                    for (const entry of entries) {
                        if (entry.version && entry.date && Array.isArray(entry.changes)) {
                            pluginEntries.push({
                                version: entry.version,
                                date: entry.date,
                                changes: entry.changes,
                                plugin: pluginId,
                                pluginName,
                            });
                        }
                    }
                }
            } catch { /* Kein Changelog → überspringen */ }
        }
    } catch { /* Plugins-Verzeichnis nicht vorhanden → leer */ }

    return pluginEntries;
}

/**
 * Alle Changelogs laden und nach Datum sortieren (neueste zuerst).
 * Core-Einträge werden gecacht, Plugin-Einträge bei jedem Aufruf geladen
 * (damit neue Plugins sofort sichtbar sind).
 */
async function loadAllChangelogs(): Promise<ChangelogEntry[]> {
    const [coreEntries, pluginEntries] = await Promise.all([
        loadCoreChangelog(),
        loadPluginChangelogs(),
    ]);

    // Zusammenführen und nach Datum sortieren (neueste zuerst)
    const all = [...coreEntries, ...pluginEntries];
    all.sort((a, b) => {
        // Primär: Datum absteigend
        const dateCmp = b.date.localeCompare(a.date);
        if (dateCmp !== 0) return dateCmp;
        // Sekundär: Core vor Plugins
        if (!a.plugin && b.plugin) return -1;
        if (a.plugin && !b.plugin) return 1;
        return 0;
    });

    return all;
}

export default async function healthRoutes(fastify: FastifyInstance): Promise<void> {
    // Core-Changelog beim Start vorladen
    await loadCoreChangelog();

    fastify.get('/api/health', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (_request, reply) => {
        const checks: Record<string, any> = {
            status: 'ok',
            version: config.app.version,
            uptime: Math.floor((Date.now() - startedAt) / 1000),
            timestamp: new Date().toISOString(),
        };

        // DB-Check
        try {
            const db = getDatabase();
            await db.raw('SELECT 1');
            checks.database = 'ok';
        } catch {
            checks.database = 'error';
            checks.status = 'degraded';
        }

        // Disk-Check (uploads)
        try {
            const stats = await fs.stat(config.app.uploadsDir);
            checks.uploads = stats.isDirectory() ? 'ok' : 'missing';
        } catch {
            checks.uploads = 'missing';
        }

        const statusCode = checks.status === 'ok' ? 200 : 503;
        return reply.status(statusCode).send(checks);
    });

    // GET /api/changelog – Öffentlich, liefert Core- und Plugin-Versionshistorie
    fastify.get('/api/changelog', {
        config: {
            rateLimit: { max: 10, timeWindow: '1 minute' },
            policy: { public: true },
        },
    }, async (_request, reply) => {
        const entries = await loadAllChangelogs();
        return reply.send({
            version: config.app.version,
            entries,
        });
    });
}

