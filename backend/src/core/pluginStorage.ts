/**
 * Plugin-Storage
 *
 * Tenant-scoped Datei-Storage fuer Plugins.
 * Dateien werden unter uploads/plugins/<pluginId>/<tenantId>/ gespeichert.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from './config.js';

const PLUGINS_STORAGE_DIR = 'plugins';

interface SaveOptions {
    pluginId: string;
    filename: string;
    data: Buffer;
    request: FastifyRequest;
    metadata?: Record<string, any>;
}

interface StorageFile {
    id: string;
    pluginId: string;
    tenantId: number;
    filename: string;
    path: string;
    size: number;
    createdAt: Date;
    metadata?: Record<string, any>;
}

function getStorageDir(pluginId: string, tenantId: number): string {
    return path.join(config.app.uploadsDir, PLUGINS_STORAGE_DIR, pluginId, String(tenantId));
}

async function pluginStoragePlugin(fastify: FastifyInstance): Promise<void> {
    const db = fastify.db;

    // Tabelle erstellen falls nicht vorhanden
    const hasTable = await db.schema.hasTable('plugin_files');
    if (!hasTable) {
        await db.schema.createTable('plugin_files', (table) => {
            table.string('id', 36).primary();
            table.string('plugin_id', 100).notNullable();
            table.integer('tenant_id').unsigned().notNullable();
            table.string('filename', 500).notNullable();
            table.string('disk_path', 1000).notNullable();
            table.integer('size').unsigned().notNullable().defaultTo(0);
            table.json('metadata').nullable();
            table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
            table.index(['plugin_id', 'tenant_id']);
        });
    }

    fastify.decorate('storage', {
        /**
         * Datei speichern
         */
        async save(opts: SaveOptions): Promise<StorageFile> {
            const tenantId = fastify.requireTenantId(opts.request);
            const dir = getStorageDir(opts.pluginId, tenantId);
            await fs.mkdir(dir, { recursive: true });

            const id = randomUUID();
            const ext = path.extname(opts.filename);
            const diskFilename = `${id}${ext}`;
            const diskPath = path.join(dir, diskFilename);

            await fs.writeFile(diskPath, opts.data);

            const file: StorageFile = {
                id,
                pluginId: opts.pluginId,
                tenantId,
                filename: opts.filename,
                path: diskPath,
                size: opts.data.length,
                createdAt: new Date(),
                metadata: opts.metadata,
            };

            await db('plugin_files').insert({
                id,
                plugin_id: opts.pluginId,
                tenant_id: tenantId,
                filename: opts.filename,
                disk_path: diskPath,
                size: opts.data.length,
                metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
            });

            return file;
        },

        /**
         * Datei lesen
         */
        async get(fileId: string): Promise<Buffer | null> {
            const record = await db('plugin_files').where('id', fileId).first();
            if (!record) return null;
            try {
                return await fs.readFile(record.disk_path);
            } catch {
                return null;
            }
        },

        /**
         * Datei-Metadaten holen
         */
        async getInfo(fileId: string): Promise<StorageFile | null> {
            const r = await db('plugin_files').where('id', fileId).first();
            if (!r) return null;
            return {
                id: r.id,
                pluginId: r.plugin_id,
                tenantId: r.tenant_id,
                filename: r.filename,
                path: r.disk_path,
                size: r.size,
                createdAt: r.created_at,
                metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
            };
        },

        /**
         * Dateien eines Plugins auflisten (tenant-scoped)
         */
        async list(pluginId: string, request: FastifyRequest): Promise<StorageFile[]> {
            const tenantId = fastify.requireTenantId(request);
            const rows = await db('plugin_files')
                .where('plugin_id', pluginId)
                .where('tenant_id', tenantId)
                .orderBy('created_at', 'desc');

            return rows.map((r: any) => ({
                id: r.id,
                pluginId: r.plugin_id,
                tenantId: r.tenant_id,
                filename: r.filename,
                path: r.disk_path,
                size: r.size,
                createdAt: r.created_at,
                metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
            }));
        },

        /**
         * Datei loeschen
         */
        async delete(fileId: string): Promise<boolean> {
            const record = await db('plugin_files').where('id', fileId).first();
            if (!record) return false;

            try {
                await fs.unlink(record.disk_path);
            } catch {
                // Datei existiert evtl. nicht mehr
            }

            await db('plugin_files').where('id', fileId).delete();
            return true;
        },
    });

    console.log('[PluginStorage] Initialisiert');
}

// Type Declaration
declare module 'fastify' {
    interface FastifyInstance {
        storage: {
            save: (opts: SaveOptions) => Promise<StorageFile>;
            get: (fileId: string) => Promise<Buffer | null>;
            getInfo: (fileId: string) => Promise<StorageFile | null>;
            list: (pluginId: string, request: FastifyRequest) => Promise<StorageFile[]>;
            delete: (fileId: string) => Promise<boolean>;
        };
    }
}

export default fp(pluginStoragePlugin, {
    name: 'pluginStorage',
    dependencies: ['auth'],
});
