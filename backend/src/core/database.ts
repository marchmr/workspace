import Knex from 'knex';
import { config } from './config.js';

let dbInstance: Knex.Knex | null = null;

export function getDatabase(): Knex.Knex {
    if (!dbInstance) {
        dbInstance = Knex.default({
            client: 'mysql2',
            connection: {
                host: config.db.host,
                port: config.db.port,
                database: config.db.name,
                user: config.db.user,
                password: config.db.password,
                charset: 'utf8mb4',
            },
            pool: {
                min: 2,
                max: 10,
            },
            migrations: {
                tableName: 'knex_migrations',
                directory: '../migrations',
            },
        });
    }
    return dbInstance;
}

export async function testConnection(): Promise<void> {
    const db = getDatabase();
    try {
        await db.raw('SELECT 1');
        console.log('[DB] MariaDB-Verbindung erfolgreich');
    } catch (error) {
        console.error('[DB] MariaDB-Verbindung fehlgeschlagen:', error);
        throw error;
    }
}

export async function closeDatabase(): Promise<void> {
    if (dbInstance) {
        await dbInstance.destroy();
        dbInstance = null;
    }
}
