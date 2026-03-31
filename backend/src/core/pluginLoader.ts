import { FastifyInstance } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { config } from './config.js';
import { registerPluginPermissions } from './permissions.js';
import { getDatabase } from './database.js';

interface PluginManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    dependencies: string[];
    backend_entry: string;
    frontend_entry: string;
    nav_icon: string;
    nav_label: string;
    nav_order: number;
    permissions: string[];
    settings_page: boolean;
}

/** Optionale Lifecycle-Hooks die ein Plugin exportieren kann */
interface PluginLifecycleHooks {
    onInstall?: (fastify: FastifyInstance, db: any) => Promise<void> | void;
    onUpgrade?: (fastify: FastifyInstance, db: any, fromVersion: string) => Promise<void> | void;
    onUninstall?: (fastify: FastifyInstance, db: any) => Promise<void> | void;
}

interface LoadedPlugin {
    manifest: PluginManifest;
    path: string;
    hooks?: PluginLifecycleHooks;
}

interface DiscoveredPlugin {
    manifest: PluginManifest;
    directoryName: string;
    directoryPath: string;
}

const loadedPlugins: Map<string, LoadedPlugin> = new Map();

export async function discoverPlugins(): Promise<DiscoveredPlugin[]> {
    const pluginsDir = config.app.pluginsDir;
    const discovered: DiscoveredPlugin[] = [];

    try {
        const entries = await fs.readdir(pluginsDir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

            const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
            try {
                const content = await fs.readFile(manifestPath, 'utf-8');
                const manifest: PluginManifest = JSON.parse(content);

                if (!manifest.id || !manifest.backend_entry) {
                    console.warn(`[PluginLoader] Ungueltiges Manifest in ${manifestPath}`);
                    continue;
                }

                manifest.dependencies = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
                manifest.permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];

                discovered.push({
                    manifest,
                    directoryName: entry.name,
                    directoryPath: path.join(pluginsDir, entry.name),
                });
            } catch {
                console.warn(`[PluginLoader] Konnte plugin.json nicht lesen: ${manifestPath}`);
            }
        }
    } catch {
        console.log('[PluginLoader] Plugin-Verzeichnis nicht gefunden, ueberspringe');
    }

    return discovered;
}

function resolveDependencyOrder(plugins: DiscoveredPlugin[]): DiscoveredPlugin[] {
    const byId = new Map<string, DiscoveredPlugin>();
    const state = new Map<string, 'visiting' | 'visited' | 'blocked'>();
    const resolved: DiscoveredPlugin[] = [];

    for (const plugin of plugins) {
        if (byId.has(plugin.manifest.id)) {
            console.warn(`[PluginLoader] Doppelte Plugin-ID '${plugin.manifest.id}' gefunden. Nutze erstes Vorkommen.`);
            continue;
        }
        byId.set(plugin.manifest.id, plugin);
    }

    function visit(plugin: DiscoveredPlugin): boolean {
        const id = plugin.manifest.id;
        const currentState = state.get(id);

        if (currentState === 'visited') return true;
        if (currentState === 'blocked') return false;
        if (currentState === 'visiting') {
            console.warn(`[PluginLoader] Zyklische Abhaengigkeit bei Plugin '${id}' erkannt. Plugin wird uebersprungen.`);
            state.set(id, 'blocked');
            return false;
        }

        state.set(id, 'visiting');

        for (const depId of plugin.manifest.dependencies || []) {
            const dep = byId.get(depId);
            if (!dep) {
                console.warn(`[PluginLoader] Abhaengigkeit '${depId}' fuer Plugin '${id}' nicht gefunden oder nicht aktiv.`);
                state.set(id, 'blocked');
                return false;
            }

            if (!visit(dep)) {
                console.warn(`[PluginLoader] Plugin '${id}' wird uebersprungen, da Abhaengigkeit '${depId}' nicht ladbar ist.`);
                state.set(id, 'blocked');
                return false;
            }
        }

        state.set(id, 'visited');
        resolved.push(plugin);
        return true;
    }

    for (const plugin of byId.values()) {
        visit(plugin);
    }

    return resolved;
}

async function resolveBackendImportPath(plugin: DiscoveredPlugin): Promise<string> {
    const entry = plugin.manifest.backend_entry;
    const entryPath = path.join(plugin.directoryPath, entry);

    // Sicherheitspruefung: Pfad muss innerhalb des Plugin-Verzeichnisses bleiben
    const resolvedEntry = path.resolve(plugin.directoryPath, entry);
    if (!resolvedEntry.startsWith(plugin.directoryPath + path.sep) && resolvedEntry !== plugin.directoryPath) {
        throw new Error(`Backend-Entry '${entry}' liegt ausserhalb des Plugin-Verzeichnisses (Path-Traversal blockiert)`);
    }

    const ext = path.extname(entry);
    const candidates: string[] = [];

    // TypeScript wird direkt von tsx unterstuetzt — kein Kompilieren noetig
    if (ext === '.ts' || ext === '.tsx') {
        candidates.push(entryPath);
    }

    if (!ext) {
        candidates.push(`${entryPath}.ts`, `${entryPath}.js`, `${entryPath}.mjs`, `${entryPath}.cjs`);
    }

    candidates.push(entryPath);

    const uniqueCandidates = [...new Set(candidates)];
    for (const candidate of uniqueCandidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // pruefe naechsten Kandidaten
        }
    }

    throw new Error(`Backend-Entry nicht gefunden: ${entry} (${uniqueCandidates.join(', ')})`);
}

/**
 * Auto-Registrierung: Plugins die im Dateisystem existieren aber nicht
 * in der DB sind, werden automatisch registriert und aktiviert.
 */
async function autoRegisterPlugins(discovered: DiscoveredPlugin[]): Promise<void> {
    const db = getDatabase();

    for (const plugin of discovered) {
        const { manifest } = plugin;
        const existing = await db('plugins').where('plugin_id', manifest.id).first();

        if (!existing) {
            console.log(`[PluginLoader] Neues Plugin entdeckt: ${manifest.name} v${manifest.version} — registriere automatisch`);
            await db('plugins').insert({
                plugin_id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                is_active: true,
                installed_at: new Date(),
            });
        } else if (existing.version !== manifest.version) {
            // Version im Dateisystem ist neuer (nach git pull/update.sh)
            await db('plugins').where('plugin_id', manifest.id).update({
                version: manifest.version,
                name: manifest.name,
            });
        }
    }
}

export async function loadPlugins(fastify: FastifyInstance): Promise<void> {
    const db = getDatabase();
    const discovered = await discoverPlugins();
    loadedPlugins.clear();

    // Auto-Registrierung: Neue Plugins werden automatisch in die DB aufgenommen
    await autoRegisterPlugins(discovered);

    // Nur aktivierte Plugins laden
    const activePlugins = await db('plugins').where('is_active', true).select('plugin_id');
    const activeIds = new Set(activePlugins.map((p: any) => p.plugin_id));

    const activeDiscovered = discovered.filter((p) => activeIds.has(p.manifest.id));
    const ordered = resolveDependencyOrder(activeDiscovered);

    for (const plugin of ordered) {
        const { manifest } = plugin;
        try {
            console.log(`[PluginLoader] Lade Plugin: ${manifest.name} v${manifest.version}`);

            // Plugin-Permissions registrieren
            if (manifest.permissions.length > 0) {
                await registerPluginPermissions(manifest.id, manifest.permissions);
            }

            // Backend-Plugin dynamisch importieren (tsx unterstuetzt .ts direkt)
            const pluginPath = await resolveBackendImportPath(plugin);
            const pluginModule = await import(pathToFileURL(pluginPath).href);

            // Als Fastify-Sub-Plugin unter /api/plugins/{id}/ registrieren
            await fastify.register(pluginModule.default || pluginModule, {
                prefix: `/api/plugins/${manifest.id}`,
            });

            // Plugin-Migrationen ausfuehren
            const migrationsDir = path.join(plugin.directoryPath, 'backend', 'migrations');
            try {
                await fs.access(migrationsDir);
                const knex = getDatabase();
                await knex.migrate.latest({
                    directory: migrationsDir,
                    tableName: `knex_migrations_${manifest.id}`,
                    loadExtensions: ['.js', '.cjs', '.ts'],
                });
                console.log(`[PluginLoader] Migrationen fuer ${manifest.id} ausgefuehrt`);
            } catch {
                // Keine Migrationen vorhanden
            }

            // Lifecycle-Hooks pruefen
            const hooks: PluginLifecycleHooks = {
                onInstall: pluginModule.onInstall,
                onUpgrade: pluginModule.onUpgrade,
                onUninstall: pluginModule.onUninstall,
            };

            // Version aus DB holen fuer Lifecycle-Entscheidung
            const dbPlugin = await db('plugins').where('plugin_id', manifest.id).first();
            const installedVersion = dbPlugin?.installed_version || null;

            if (!installedVersion) {
                // Erstmalige Installation
                if (hooks.onInstall) {
                    try {
                        console.log(`[PluginLoader] onInstall fuer ${manifest.id}`);
                        await hooks.onInstall(fastify, db);
                    } catch (err) {
                        console.error(`[PluginLoader] onInstall-Fehler fuer ${manifest.id}:`, err);
                    }
                }
            } else if (installedVersion !== manifest.version) {
                // Version-Upgrade (nach git pull / update.sh)
                if (hooks.onUpgrade) {
                    try {
                        console.log(`[PluginLoader] onUpgrade fuer ${manifest.id}: ${installedVersion} → ${manifest.version}`);
                        await hooks.onUpgrade(fastify, db, installedVersion);
                    } catch (err) {
                        console.error(`[PluginLoader] onUpgrade-Fehler fuer ${manifest.id}:`, err);
                    }
                }
            }

            // Installierte Version in DB aktualisieren
            await db('plugins').where('plugin_id', manifest.id).update({
                installed_version: manifest.version,
            });

            loadedPlugins.set(manifest.id, { manifest, path: pluginPath, hooks });
            console.log(`[PluginLoader] Plugin ${manifest.name} erfolgreich geladen`);
        } catch (error) {
            console.error(`[PluginLoader] Fehler beim Laden von Plugin ${manifest.id}:`, error);
        }
    }
}

export function getLoadedPlugins(): Map<string, LoadedPlugin> {
    return loadedPlugins;
}

export function getPluginManifests(): PluginManifest[] {
    return Array.from(loadedPlugins.values()).map((p) => p.manifest);
}
