import { getDatabase } from '../core/database.js';
import { decrypt, encrypt } from '../core/encryption.js';
import { config } from '../core/config.js';
import archiver from 'archiver';
import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { Writable } from 'stream';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

// Tabellen die im Backup enthalten sind (Reihenfolge fuer Import wg. FK)
const CORE_TABLES = [
    'tenants',
    'roles',
    'permissions',
    'role_permissions',
    'users',
    'user_tenants',
    'user_roles',
    'user_permissions',
    'user_dashboard_layouts',
    'settings',
    'plugins',
    'documents',
    'document_permissions',
    'document_links',
    'login_attempts',
    'refresh_tokens',
    'audit_log',
];

// Felder die verschluesselt in der DB liegen und fuer Export entschluesselt werden
const ENCRYPTED_FIELDS: Record<string, string[]> = {
    users: [
        'email',
        'display_name',
        'first_name',
        'last_name',
        'mfa_secret_encrypted',
        'recovery_codes_encrypted',
    ],
    settings: ['value_encrypted'],
};

// Tabellen die beim Import nicht geloescht werden sollen
const SKIP_DELETE_TABLES = ['knex_migrations', 'knex_migrations_lock'];

// Felder die aus dem Export entfernt werden (Sicherheit)
const SKIP_EXPORT_FIELDS: Record<string, string[]> = {
    users: ['password_hash'],
};

type EncryptionPassthroughMap = Record<string, Record<string, string[]>>;
const SUPER_ADMIN_MFA_FIELDS = new Set(['mfa_secret_encrypted', 'recovery_codes_encrypted']);

function looksLikeEncryptedPayload(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const parts = value.split(':');
    return parts.length === 4 && parts.every((part) => part.length > 0);
}

// AES-256-GCM Backup-Verschluesselung
const BACKUP_MAGIC = Buffer.from('MIKE-ENC-V1\0'); // 12 Bytes Magic Header

function deriveBackupKey(passphrase: string): Buffer {
    // SHA-256 des Passphrase → 32 Byte Key fuer AES-256
    return createHash('sha256').update(passphrase, 'utf8').digest();
}

function encryptBackup(plainBuffer: Buffer, passphrase: string): Buffer {
    const key = deriveBackupKey(passphrase);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag(); // 16 Bytes
    // Format: MAGIC (12) + IV (16) + AuthTag (16) + Ciphertext
    return Buffer.concat([BACKUP_MAGIC, iv, authTag, encrypted]);
}

function decryptBackup(encBuffer: Buffer, passphrase: string): Buffer {
    const key = deriveBackupKey(passphrase);
    const iv = encBuffer.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 16);
    const authTag = encBuffer.subarray(BACKUP_MAGIC.length + 16, BACKUP_MAGIC.length + 32);
    const ciphertext = encBuffer.subarray(BACKUP_MAGIC.length + 32);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function isEncryptedBackup(buffer: Buffer): boolean {
    return buffer.length > BACKUP_MAGIC.length && buffer.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC);
}

export function isBackupEncryptionConfigured(): boolean {
    return Boolean(config.backup.encryptionKey);
}

function addPassthroughField(
    map: EncryptionPassthroughMap,
    table: string,
    rowIndex: number,
    field: string
): void {
    if (!map[table]) map[table] = {};
    const key = String(rowIndex);
    if (!map[table][key]) map[table][key] = [];
    if (!map[table][key].includes(field)) {
        map[table][key].push(field);
    }
}

async function getSuperAdminUserIds(db: any): Promise<Set<number>> {
    try {
        const rows = await db('user_roles')
            .join('roles', 'user_roles.role_id', 'roles.id')
            .where('roles.name', 'Super-Admin')
            .select('user_roles.user_id');
        return new Set(rows.map((row: any) => Number(row.user_id)).filter((id: number) => Number.isInteger(id) && id > 0));
    } catch {
        return new Set<number>();
    }
}

export async function exportBackup(tenantId?: number): Promise<Buffer> {
    const db = getDatabase();
    const backupData: Record<string, any[]> = {};
    const encryptionPassthrough: EncryptionPassthroughMap = {};
    const superAdminUserIds = await getSuperAdminUserIds(db);

    // Plugin-Tabellen ermitteln
    const pluginTables = await getPluginTables(db);
    const allTables = [...CORE_TABLES, ...pluginTables];

    for (const table of allTables) {
        try {
            let query = db(table).select('*');
            if (tenantId && await tableHasTenantColumn(db, table)) {
                query = query.where('tenant_id', tenantId);
            }

            let rows = await query;

            // Verschluesselte Felder entschluesseln
            const encFields = ENCRYPTED_FIELDS[table];
            if (encFields) {
                rows = rows.map((row: any, rowIndex: number) => {
                    const decrypted = { ...row };
                    for (const field of encFields) {
                        if (decrypted[field]) {
                            // Nur Super-Admin-MFA-Geheimnisse bleiben im Export verschluesselt.
                            if (
                                table === 'users'
                                && superAdminUserIds.has(Number(decrypted.id))
                                && SUPER_ADMIN_MFA_FIELDS.has(field)
                            ) {
                                addPassthroughField(encryptionPassthrough, table, rowIndex, field);
                                continue;
                            }
                            try {
                                decrypted[field] = decrypt(decrypted[field]);
                            } catch {
                                // Wenn Wert wie Ciphertext aussieht, beim Import nicht doppelt verschluesseln.
                                if (looksLikeEncryptedPayload(decrypted[field])) {
                                    addPassthroughField(encryptionPassthrough, table, rowIndex, field);
                                }
                            }
                        }
                    }
                    return decrypted;
                });
            }

            // Sicherheits-sensible Felder entfernen (M3 Security Fix)
            const skipFields = SKIP_EXPORT_FIELDS[table];
            if (skipFields) {
                rows = rows.map((row: any) => {
                    const cleaned = { ...row };
                    for (const field of skipFields) {
                        delete cleaned[field];
                    }
                    return cleaned;
                });
            }

            backupData[table] = rows;
        } catch {
            // Tabelle existiert evtl nicht, ueberspringe
        }
    }

    // ZIP-Datei erstellen
    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const writable = new Writable({
            write(chunk, _encoding, callback) {
                chunks.push(Buffer.from(chunk));
                callback();
            },
        });

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', reject);
        writable.on('finish', () => resolve(Buffer.concat(chunks)));

        archive.pipe(writable);

        // Daten als JSON
        archive.append(JSON.stringify(backupData, null, 2), { name: 'data.json' });

        // Backup-Metadaten
        archive.append(JSON.stringify({
            version: config.app.version,
            created_at: new Date().toISOString(),
            scope: tenantId ? 'tenant' : 'full',
            tables: Object.keys(backupData),
            table_counts: Object.fromEntries(
                Object.entries(backupData).map(([k, v]) => [k, v.length])
            ),
            encryption_passthrough: encryptionPassthrough,
        }, null, 2), { name: 'meta.json' });

        // uploads-Ordner einpacken (falls vorhanden)
        const uploadsDir = config.app.uploadsDir;
        if (fss.existsSync(uploadsDir)) {
            archive.directory(uploadsDir, 'uploads');
        }

        archive.finalize();
    });

    // Verschluesselung anwenden wenn konfiguriert
    if (config.backup.encryptionKey) {
        return encryptBackup(zipBuffer, config.backup.encryptionKey);
    }
    console.warn('[Backup] WARNUNG: Backup ist NICHT verschluesselt (BACKUP_ENCRYPTION_KEY nicht gesetzt)');
    return zipBuffer;
}

export async function importBackup(inputBuffer: Buffer, tenantId?: number): Promise<{ tablesImported: string[]; totalRows: number }> {
    const db = getDatabase();

    // Verschluesselung erkennen und entschluesseln
    let zipBuffer = inputBuffer;
    if (isEncryptedBackup(inputBuffer)) {
        if (!config.backup.encryptionKey) {
            throw new Error('Backup ist verschluesselt, aber BACKUP_ENCRYPTION_KEY ist nicht konfiguriert');
        }
        try {
            zipBuffer = decryptBackup(inputBuffer, config.backup.encryptionKey);
        } catch {
            throw new Error('Backup-Entschluesselung fehlgeschlagen – falscher Key?');
        }
    }
    const unzipper = await import('unzipper');
    const directory = await unzipper.Open.buffer(zipBuffer);

    // data.json lesen
    const dataFile = directory.files.find((f: any) => f.path === 'data.json');
    if (!dataFile) throw new Error('Backup-Datei ist ungueltig: data.json fehlt');

    const dataBuffer = await dataFile.buffer();
    const backupData: Record<string, any[]> = JSON.parse(dataBuffer.toString('utf-8'));
    const metaFile = directory.files.find((f: any) => f.path === 'meta.json');
    let encryptionPassthrough: EncryptionPassthroughMap = {};
    if (metaFile) {
        try {
            const metaBuffer = await metaFile.buffer();
            const metaData = JSON.parse(metaBuffer.toString('utf-8'));
            if (metaData?.encryption_passthrough && typeof metaData.encryption_passthrough === 'object') {
                encryptionPassthrough = metaData.encryption_passthrough as EncryptionPassthroughMap;
            }
        } catch {
            // Meta optional: bei Fehlern weiterhin importieren.
        }
    }

    let totalRows = 0;
    const tablesImported: string[] = [];

    // Fremdschluessel-Checks temporaer deaktivieren
    await db.raw('SET FOREIGN_KEY_CHECKS = 0');

    try {
        // Alle Tabellen in umgekehrter Reihenfolge leeren (FK-sicher)
        const tables = Object.keys(backupData).reverse();
        for (const table of tables) {
            if (SKIP_DELETE_TABLES.includes(table)) continue;
            try {
                if (tenantId && await tableHasTenantColumn(db, table)) {
                    await db(table).where('tenant_id', tenantId).delete();
                } else if (!tenantId) {
                    await db(table).truncate();
                }
            } catch {
                // Tabelle existiert evtl. nicht
            }
        }

        // Daten importieren (in richtiger Reihenfolge)
        const importOrder = Object.keys(backupData);
        for (const table of importOrder) {
            if (SKIP_DELETE_TABLES.includes(table)) continue;

            const rows = backupData[table];
            if (!rows || rows.length === 0) continue;

            // Verschluesselte Felder wieder verschluesseln
            const encFields = ENCRYPTED_FIELDS[table];
            const tablePassthrough = encryptionPassthrough[table] || {};
            const processedRows = rows.map((row: any, rowIndex: number) => {
                const processed = { ...row };
                if (tenantId && 'tenant_id' in processed) {
                    processed.tenant_id = tenantId;
                }
                if (encFields) {
                    const passthroughFields = new Set(tablePassthrough[String(rowIndex)] || []);
                    for (const field of encFields) {
                        if (processed[field]) {
                            if (passthroughFields.has(field)) continue;
                            processed[field] = encrypt(processed[field]);
                        }
                    }
                }
                return processed;
            });

            // Batch-Insert (max 500 pro Chunk)
            const chunkSize = 500;
            for (let i = 0; i < processedRows.length; i += chunkSize) {
                const chunk = processedRows.slice(i, i + chunkSize);
                await db(table).insert(chunk);
            }

            totalRows += rows.length;
            tablesImported.push(table);
        }
    } finally {
        await db.raw('SET FOREIGN_KEY_CHECKS = 1');
    }

    // Uploads wiederherstellen
    await fs.rm(config.app.uploadsDir, { recursive: true, force: true });
    await fs.mkdir(config.app.uploadsDir, { recursive: true });
    const uploadFiles = directory.files.filter((f: any) => f.path.startsWith('uploads/') && f.type === 'File');
    for (const file of uploadFiles) {
        const relativePath = file.path.replace('uploads/', '');
        const targetPath = path.resolve(config.app.uploadsDir, relativePath);
        // Zip-Slip-Schutz: Pfad muss innerhalb von uploadsDir bleiben
        if (!targetPath.startsWith(path.resolve(config.app.uploadsDir) + path.sep)) {
            console.warn(`[Backup] Zip-Slip blockiert: ${file.path}`);
            continue;
        }
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        const content = await file.buffer();
        await fs.writeFile(targetPath, content);
    }

    return { tablesImported, totalRows };
}

async function getPluginTables(db: any): Promise<string[]> {
    // Alle Tabellen der DB abfragen und Core-Tabellen + Knex-System-Tabellen rausfiltern
    const result = await db.raw('SHOW TABLES');
    const allDbTables: string[] = result[0].map((row: any) => Object.values(row)[0] as string);

    return allDbTables.filter((t: string) =>
        !CORE_TABLES.includes(t) &&
        !t.startsWith('knex_migrations')
    );
}

async function tableHasTenantColumn(db: any, table: string): Promise<boolean> {
    try {
        const columns = await db(table).columnInfo();
        return Object.prototype.hasOwnProperty.call(columns, 'tenant_id');
    } catch {
        return false;
    }
}
