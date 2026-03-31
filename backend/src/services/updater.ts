import { config } from '../core/config.js';
import { getDatabase } from '../core/database.js';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { FastifyInstance } from 'fastify';


const execFileAsync = promisify(execFile);

// =============================================
// TYPES
// =============================================

export type UpdateBranch = 'main' | 'experimental';



interface GitHubRelease {
    tag_name: string;
    name: string;
    body: string;
    published_at: string;
    prerelease: boolean;
    assets: GitHubAsset[];
}

interface GitHubAsset {
    name: string;
    browser_download_url: string;
    size: number;
    content_type: string;
}

interface GitHubCommit {
    sha: string;
    commit: {
        message: string;
        author: {
            name: string;
            date: string;
        };
    };
}



export interface InstalledPluginInfo {
    pluginId: string;
    name: string;
    version: string;
    isActive: boolean;
    installedAt: string | null;
}

export interface UpdateProgressEvent {
    message: string;
    progress?: number;
}

interface UpdateInstallOptions {
    onProgress?: (event: UpdateProgressEvent) => void;
    fastify?: FastifyInstance;
}



export interface UpdateCheckResult {
    branch: UpdateBranch;
    available: boolean;
    current: {
        version: string;
        commitHash?: string;
    };
    remote?: {
        version?: string;
        commitHash?: string;
        commitMessages?: { message: string; hash: string; date: string }[];
        changelog?: string;
        releaseName?: string;
        publishedAt?: string;
    };
    updateCommand: string;
}

export interface BackupEntry {
    fileName: string;
    branch: string;
    sizeBytes: number;
    createdAt: string;
    restoreCommand: string;
}

// =============================================
// GITHUB API HELPERS
// =============================================

function getGitHubApiUrl(): string {
    return config.update.url.replace(/\/+$/, '');
}

function parseGitHubVersion(tagName: string): string {
    return tagName.replace(/^v/i, '');
}

async function fetchGitHubJson<T>(endpoint: string): Promise<T | null> {
    const url = `${getGitHubApiUrl()}/${endpoint}`;
    try {
        const res = await fetch(url, {
            headers: {
                accept: 'application/vnd.github+json',
                'user-agent': 'MIKE-WorkSpace-Updater/2.0',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        });
        if (!res.ok) {
            console.error(`[Updater] GitHub API ${res.status} für ${url}`);
            return null;
        }
        return await res.json() as T;
    } catch (err) {
        console.error(`[Updater] GitHub API Fehler für ${url}:`, err);
        return null;
    }
}

// =============================================
// GIT LOCAL HELPERS
// =============================================

async function getLocalCommitHash(): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: config.app.rootDir });
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

async function getLocalBranch(): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd: config.app.rootDir });
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

// =============================================
// BRANCH SETTING (DB)
// =============================================

export async function getUpdateBranch(): Promise<UpdateBranch> {
    try {
        const db = getDatabase();
        const setting = await db('settings')
            .where({ key: 'update.branch' })
            .whereNull('tenant_id')
            .first();
        if (!setting?.value_encrypted) return 'main';
        // Branch ist unverschluesselt gespeichert (kein Geheimnis)
        const raw = String(setting.value_encrypted).trim();
        if (['main', 'experimental'].includes(raw)) {
            return raw as UpdateBranch;
        }
        // Fallback: Versuche entschluesselten Wert
        try {
            const { decrypt } = await import('../core/encryption.js');
            const decrypted = decrypt(raw).trim();
            if (['main', 'experimental'].includes(decrypted)) {
                return decrypted as UpdateBranch;
            }
        } catch {
            // Kein verschluesselter Wert
        }
        // Fallback auf lokal aktiven Git-Branch (falls Setting veraltet/ungueltig)
        const localBranch = await getLocalBranch();
        if (localBranch && ['main', 'experimental'].includes(localBranch)) {
            return localBranch as UpdateBranch;
        }
        return 'main';
    } catch {
        const localBranch = await getLocalBranch();
        if (localBranch && ['main', 'experimental'].includes(localBranch)) {
            return localBranch as UpdateBranch;
        }
        return 'main';
    }
}

export async function setUpdateBranch(branch: UpdateBranch): Promise<void> {
    const db = getDatabase();
    // Branch ist kein Geheimnis — unverschlüsselt speichern
    const existing = await db('settings')
        .where({ key: 'update.branch' })
        .whereNull('tenant_id')
        .first();
    if (existing) {
        await db('settings').where({ id: existing.id }).update({
            value_encrypted: branch,
            category: 'system',
        });
    } else {
        await db('settings').insert({
            key: 'update.branch',
            value_encrypted: branch,
            category: 'system',
            tenant_id: null,
        });
    }
}

// =============================================
// UPDATE CHECK INTERVAL (DB)
// =============================================

export async function getUpdateCheckInterval(): Promise<number> {
    try {
        const db = getDatabase();
        const setting = await db('settings')
            .where({ key: 'update.check_interval_seconds' })
            .whereNull('tenant_id')
            .first();
        if (!setting?.value_encrypted) return 7200; // Default: 2 Stunden
        try {
            const { decrypt } = await import('../core/encryption.js');
            const decrypted = decrypt(String(setting.value_encrypted)).trim();
            const parsed = parseInt(decrypted, 10);
            return Number.isFinite(parsed) && parsed >= 3600 ? parsed : 7200;
        } catch {
            const parsed = parseInt(String(setting.value_encrypted).trim(), 10);
            return Number.isFinite(parsed) && parsed >= 3600 ? parsed : 7200;
        }
    } catch {
        return 7200;
    }
}

export async function setUpdateCheckInterval(seconds: number): Promise<void> {
    const db = getDatabase();
    // Intervall ist kein Geheimnis — unverschlüsselt speichern
    const value = Math.max(3600, Math.round(seconds));
    const existing = await db('settings')
        .where({ key: 'update.check_interval_seconds' })
        .whereNull('tenant_id')
        .first();
    if (existing) {
        await db('settings').where({ id: existing.id }).update({
            value_encrypted: String(value),
            category: 'system',
        });
    } else {
        await db('settings').insert({
            key: 'update.check_interval_seconds',
            value_encrypted: String(value),
            category: 'system',
            tenant_id: null,
        });
    }
}

// =============================================
// CORE UPDATE CHECK
// =============================================

export async function checkCoreUpdate(branch?: UpdateBranch): Promise<UpdateCheckResult> {
    const activeBranch = branch || await getUpdateBranch();
    const currentVersion = config.app.version;
    const localCommitHash = await getLocalCommitHash();

    const current = {
        version: currentVersion,
        commitHash: localCommitHash || undefined,
    };

    const updateCommand = generateUpdateCommand(activeBranch);

    if (activeBranch === 'experimental') {
        return checkExperimentalUpdate(current, updateCommand);
    }

    return checkMainUpdate(current, updateCommand);
}

async function checkMainUpdate(
    current: { version: string; commitHash?: string },
    updateCommand: string,
): Promise<UpdateCheckResult> {
    const release = await fetchGitHubJson<GitHubRelease>('releases/latest');
    if (!release) {
        return { branch: 'main', available: false, current, updateCommand };
    }

    // Verhindert False-Positives, wenn die lokale Version nicht hochgezogen wurde,
    // der Code aber bereits auf dem neuesten Main-Commit steht.
    const latestMainCommit = await fetchGitHubJson<GitHubCommit[]>('commits?sha=main&per_page=1');
    const remoteMainHead = latestMainCommit?.[0]?.sha;
    if (current.commitHash && remoteMainHead && current.commitHash === remoteMainHead) {
        return {
            branch: 'main',
            available: false,
            current,
            remote: {
                version: parseGitHubVersion(release.tag_name),
                changelog: release.body || '',
                releaseName: release.name || '',
                publishedAt: release.published_at || '',
            },
            updateCommand,
        };
    }

    const remoteVersion = parseGitHubVersion(release.tag_name);
    const available = compareVersions(remoteVersion, current.version) > 0;

    return {
        branch: 'main',
        available,
        current,
        remote: {
            version: remoteVersion,
            changelog: release.body || '',
            releaseName: release.name || '',
            publishedAt: release.published_at || '',
        },
        updateCommand,
    };
}

async function checkExperimentalUpdate(
    current: { version: string; commitHash?: string },
    updateCommand: string,
): Promise<UpdateCheckResult> {
    // Letzte 10 Commits vom experimental-Branch holen
    const commits = await fetchGitHubJson<GitHubCommit[]>('commits?sha=experimental&per_page=10');
    if (!commits || commits.length === 0) {
        return { branch: 'experimental', available: false, current, updateCommand };
    }

    const latestCommit = commits[0];
    const available = Boolean(current.commitHash && latestCommit.sha !== current.commitHash);

    const commitMessages = commits.map((c) => ({
        message: c.commit.message.split('\n')[0] || '', // Nur erste Zeile
        hash: c.sha.slice(0, 8),
        date: c.commit.author.date || '',
    }));

    return {
        branch: 'experimental',
        available,
        current,
        remote: {
            commitHash: latestCommit.sha,
            commitMessages,
            publishedAt: latestCommit.commit.author.date || '',
        },
        updateCommand,
    };
}

// =============================================
// CHANGELOG HISTORY
// =============================================

export async function getChangelogHistory(branch?: UpdateBranch): Promise<{
    releases?: { version: string; name: string; body: string; publishedAt: string; prerelease: boolean }[];
    commits?: { message: string; hash: string; date: string }[];
}> {
    const activeBranch = branch || await getUpdateBranch();

    if (activeBranch === 'experimental') {
        const commits = await fetchGitHubJson<GitHubCommit[]>('commits?sha=experimental&per_page=30');
        if (!commits) return { commits: [] };
        return {
            commits: commits.map((c) => ({
                message: c.commit.message.split('\n')[0] || '',
                hash: c.sha.slice(0, 8),
                date: c.commit.author.date || '',
            })),
        };
    }

    const releases = await fetchGitHubJson<GitHubRelease[]>('releases?per_page=15');
    if (!releases) return { releases: [] };

    const filtered = releases.filter((r) => !r.prerelease);

    return {
        releases: filtered.map((r) => ({
            version: parseGitHubVersion(r.tag_name),
            name: r.name || '',
            body: r.body || '',
            publishedAt: r.published_at || '',
            prerelease: r.prerelease,
        })),
    };
}

// =============================================
// UPDATE COMMAND GENERATION
// =============================================

function generateUpdateCommand(branch: UpdateBranch): string {
    return `sudo bash /opt/mike-workspace/update.sh --branch ${branch}`;
}

// =============================================
// BACKUP LIST
// =============================================

export async function getBackupsList(branch?: UpdateBranch): Promise<BackupEntry[]> {
    const entries: BackupEntry[] = [];
    const branches: UpdateBranch[] = branch ? [branch] : ['main', 'experimental'];
    const backupBase = config.update.backupDir || path.join(config.app.rootDir, 'backups', 'pre-update');
    console.log(`[Updater] getBackupsList: backupBase=${backupBase}, rootDir=${config.app.rootDir}`);
    for (const b of branches) {
        const branchDir = path.join(backupBase, b);
        try {
            const files = await fs.readdir(branchDir);
            for (const fileName of files) {
                if (!fileName.endsWith('.zip')) continue;
                const filePath = path.join(branchDir, fileName);
                try {
                    const stat = await fs.stat(filePath);
                    entries.push({
                        fileName,
                        branch: b,
                        sizeBytes: stat.size,
                        createdAt: stat.birthtime.toISOString(),
                        restoreCommand: `sudo bash /opt/mike-workspace/restore.sh ${filePath}`,
                    });
                } catch {
                    // Datei nicht lesbar
                }
            }
        } catch (err) {
            console.log(`[Updater] Backup-Verzeichnis nicht lesbar: ${branchDir}`, err);
        }
    }

    // Neueste zuerst sortieren
    entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return entries;
}

// =============================================
// PLUGIN MANAGEMENT (Lokal — Monorepo)
// =============================================

/**
 * Liest alle Plugins aus dem plugins/-Verzeichnis und vergleicht
 * deren Version mit der installierten DB-Version.
 */
export async function checkPluginUpdates(): Promise<{ pluginId: string; current: string; available: string; hasUpdate: boolean }[]> {
    const db = getDatabase();
    const results: { pluginId: string; current: string; available: string; hasUpdate: boolean }[] = [];

    try {
        const entries = await fs.readdir(config.app.pluginsDir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

            const manifestPath = path.join(config.app.pluginsDir, entry.name, 'plugin.json');
            try {
                const content = await fs.readFile(manifestPath, 'utf-8');
                const manifest = JSON.parse(content);
                if (!manifest.id || !manifest.version) continue;

                const dbPlugin = await db('plugins').where('plugin_id', manifest.id).first();
                const currentVersion = dbPlugin?.installed_version || dbPlugin?.version || '0.0.0';
                const hasUpdate = compareVersions(manifest.version, currentVersion) > 0;

                results.push({
                    pluginId: manifest.id,
                    current: currentVersion,
                    available: manifest.version,
                    hasUpdate,
                });
            } catch {
                // plugin.json nicht lesbar
            }
        }
    } catch {
        // plugins-Verzeichnis nicht vorhanden
    }

    return results;
}

export async function getInstalledPlugins(): Promise<InstalledPluginInfo[]> {
    const db = getDatabase();
    const rows = await db('plugins')
        .select('plugin_id', 'name', 'version', 'is_active', 'installed_at')
        .orderBy('name', 'asc')
        .orderBy('plugin_id', 'asc');

    return rows.map((row: any) => ({
        pluginId: String(row.plugin_id),
        name: String(row.name || row.plugin_id),
        version: String(row.version || '0.0.0'),
        isActive: Boolean(row.is_active),
        installedAt: row.installed_at ? new Date(row.installed_at).toISOString() : null,
    }));
}

/**
 * Gibt alle im Dateisystem verfuegbaren Plugins zurueck (aus plugin.json).
 * Ersetzt den frueheren Remote-Katalog.
 */
export async function getLocalPluginCatalog(): Promise<{ id: string; name: string; description: string; version: string; author: string }[]> {
    const catalog: { id: string; name: string; description: string; version: string; author: string }[] = [];

    try {
        const entries = await fs.readdir(config.app.pluginsDir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

            const manifestPath = path.join(config.app.pluginsDir, entry.name, 'plugin.json');
            try {
                const content = await fs.readFile(manifestPath, 'utf-8');
                const manifest = JSON.parse(content);
                if (!manifest.id) continue;

                catalog.push({
                    id: manifest.id,
                    name: manifest.name || manifest.id,
                    description: manifest.description || '',
                    version: manifest.version || '0.0.0',
                    author: manifest.author || '',
                });
            } catch {
                // plugin.json nicht lesbar
            }
        }
    } catch {
        // plugins-Verzeichnis nicht vorhanden
    }

    return catalog.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Aktiviert ein Plugin (setzt is_active=true in der DB).
 * Erfordert Server-Neustart damit der PluginLoader es laedt.
 */
export async function activatePlugin(pluginId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const normalized = normalizePluginId(pluginId);
        const db = getDatabase();
        const existing = await db('plugins').where('plugin_id', normalized).first();

        if (!existing) {
            // Plugin existiert im Dateisystem aber nicht in DB — registrieren
            const manifestPath = path.join(config.app.pluginsDir, normalized, 'plugin.json');
            const content = await fs.readFile(manifestPath, 'utf-8');
            const manifest = JSON.parse(content);

            await db('plugins').insert({
                plugin_id: normalized,
                name: manifest.name || normalized,
                version: manifest.version || '0.0.0',
                is_active: true,
                installed_at: new Date(),
            });
        } else {
            await db('plugins').where('plugin_id', normalized).update({ is_active: true });
        }

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * Deaktiviert ein Plugin (setzt is_active=false in der DB).
 * Plugin-Dateien und DB-Tabellen bleiben erhalten.
 */
export async function deactivatePlugin(pluginId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const normalized = normalizePluginId(pluginId);
        const db = getDatabase();
        await db('plugins').where('plugin_id', normalized).update({ is_active: false });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * Entfernt ein Plugin komplett (DB-Eintrag, Permissions, Migrationen).
 * Plugin-Dateien im Repo werden NICHT geloescht (kommen mit git pull zurueck).
 */
export async function removePlugin(pluginId: string, options?: UpdateInstallOptions): Promise<{ success: boolean; error?: string }> {
    const progress = (message: string, value?: number): void => {
        options?.onProgress?.({ message, progress: value });
    };

    try {
        const normalizedPluginId = normalizePluginId(pluginId);
        progress(`Pruefe Plugin ${normalizedPluginId}`, 5);

        const db = getDatabase();
        const existing = await db('plugins').where('plugin_id', normalizedPluginId).first();
        if (!existing) {
            return { success: false, error: `Plugin '${normalizedPluginId}' ist nicht installiert` };
        }

        progress('Entferne Plugin-Permissions und Zuweisungen', 20);
        await db('permissions').where('plugin_id', normalizedPluginId).delete();

        progress('Entferne plugin-spezifische Einstellungen', 35);
        await db('settings').where('plugin_id', normalizedPluginId).delete();

        progress('Entferne Plugin aus Installationsliste', 50);
        await db('plugins').where('plugin_id', normalizedPluginId).delete();

        progress('Bereinige Migrations-Tracking', 65);
        const migrationTable = `knex_migrations_${normalizedPluginId}`;
        const migrationLockTable = `${migrationTable}_lock`;
        await db.schema.dropTableIfExists(migrationLockTable);
        await db.schema.dropTableIfExists(migrationTable);

        progress('Plugin entfernt (Neustart erforderlich)', 100);

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// =============================================
// VERSION VERGLEICH
// =============================================

function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);

    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const va = pa[i] || 0;
        const vb = pb[i] || 0;
        if (va > vb) return 1;
        if (va < vb) return -1;
    }
    return 0;
}

function normalizePluginId(pluginId: string): string {
    const normalized = String(pluginId || '').trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) {
        throw new Error('Ungueltige Plugin-ID');
    }
    return normalized;
}

function resolveUpdateUrl(relativePath: string): string {
    if (/^https?:\/\//i.test(relativePath)) {
        return relativePath;
    }
    const cleanBase = config.update.url.replace(/\/+$/, '');
    const cleanPath = relativePath.replace(/^\/+/, '');
    return `${cleanBase}/${cleanPath}`;
}

function createUpdateRequestToken(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function withCacheBust(url: string, cacheBust?: string): string {
    if (!cacheBust) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}cb=${encodeURIComponent(cacheBust)}`;
}

function normalizeStringArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}
