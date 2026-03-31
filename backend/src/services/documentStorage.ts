import { createReadStream, existsSync } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../core/config.js';

export interface SaveDocumentInput {
    tenantId: number;
    originalFileName: string;
    buffer: Buffer;
}

export interface SavedDocument {
    provider: 'local';
    storageKey: string;
}

export interface DocumentReadStream {
    stream: NodeJS.ReadableStream;
    absolutePath: string;
}

function normalizeStorageKey(storageKey: string): string {
    return storageKey.replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveLocalDocumentPath(storageKey: string): string {
    const documentsRoot = path.resolve(config.app.uploadsDir, 'documents');
    const normalizedKey = normalizeStorageKey(storageKey);
    const resolvedPath = path.resolve(documentsRoot, normalizedKey);

    const rootWithSeparator = `${documentsRoot}${path.sep}`;
    if (resolvedPath !== documentsRoot && !resolvedPath.startsWith(rootWithSeparator)) {
        throw new Error('Ungültiger Storage-Key');
    }

    return resolvedPath;
}

function buildStorageKey(tenantId: number, originalFileName: string): string {
    const ext = path.extname(originalFileName || '').toLowerCase().slice(0, 12);
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const randomPart = randomUUID().replace(/-/g, '');
    return `${tenantId}/${year}/${month}/${randomPart}${ext}`;
}

export async function saveDocumentToStorage(input: SaveDocumentInput): Promise<SavedDocument> {
    if (config.documents.storageProvider !== 'local') {
        throw new Error(`Storage-Provider '${config.documents.storageProvider}' ist noch nicht implementiert`);
    }

    const storageKey = buildStorageKey(input.tenantId, input.originalFileName);
    const absolutePath = resolveLocalDocumentPath(storageKey);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.buffer);

    return {
        provider: 'local',
        storageKey,
    };
}

export function createDocumentReadStream(storageKey: string): DocumentReadStream {
    if (config.documents.storageProvider !== 'local') {
        throw new Error(`Storage-Provider '${config.documents.storageProvider}' ist noch nicht implementiert`);
    }

    const absolutePath = resolveLocalDocumentPath(storageKey);
    if (!existsSync(absolutePath)) {
        throw new Error('Datei im Storage nicht gefunden');
    }

    return {
        stream: createReadStream(absolutePath),
        absolutePath,
    };
}

export async function deleteDocumentFromStorage(storageKey: string): Promise<void> {
    if (config.documents.storageProvider !== 'local') {
        throw new Error(`Storage-Provider '${config.documents.storageProvider}' ist noch nicht implementiert`);
    }

    const absolutePath = resolveLocalDocumentPath(storageKey);
    await rm(absolutePath, { force: true });
}
