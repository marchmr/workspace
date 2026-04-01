import { createHash, randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createReadStream } from 'fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import unzipper from 'unzipper';
import { config } from '../core/config.js';

const execFileAsync = promisify(execFile);

type FileKind = 'image' | 'video' | 'pdf' | 'document' | 'zip';

type AllowedType = {
    kind: FileKind;
    extensions: string[];
    mimeTypes: string[];
    signatureMimes: string[];
};

const ALLOWED_TYPES: AllowedType[] = [
    {
        kind: 'image',
        extensions: ['.jpg', '.jpeg'],
        mimeTypes: ['image/jpeg', 'image/jpg', 'application/octet-stream'],
        signatureMimes: ['image/jpeg'],
    },
    {
        kind: 'image',
        extensions: ['.png'],
        mimeTypes: ['image/png', 'application/octet-stream'],
        signatureMimes: ['image/png'],
    },
    {
        kind: 'image',
        extensions: ['.webp'],
        mimeTypes: ['image/webp', 'application/octet-stream'],
        signatureMimes: ['image/webp'],
    },
    {
        kind: 'video',
        extensions: ['.mp4'],
        mimeTypes: ['video/mp4', 'application/octet-stream'],
        signatureMimes: ['video/mp4'],
    },
    {
        kind: 'video',
        extensions: ['.mov'],
        mimeTypes: ['video/quicktime', 'application/octet-stream'],
        signatureMimes: ['video/quicktime'],
    },
    {
        kind: 'video',
        extensions: ['.webm'],
        mimeTypes: ['video/webm', 'application/octet-stream'],
        signatureMimes: ['video/webm'],
    },
    {
        kind: 'pdf',
        extensions: ['.pdf'],
        mimeTypes: ['application/pdf', 'application/octet-stream'],
        signatureMimes: ['application/pdf'],
    },
    {
        kind: 'document',
        extensions: ['.doc'],
        mimeTypes: ['application/msword', 'application/octet-stream'],
        signatureMimes: ['application/msword'],
    },
    {
        kind: 'document',
        extensions: ['.docx'],
        mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
        signatureMimes: ['application/zip'],
    },
    {
        kind: 'document',
        extensions: ['.xlsx'],
        mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'],
        signatureMimes: ['application/zip'],
    },
    {
        kind: 'document',
        extensions: ['.pptx'],
        mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/octet-stream'],
        signatureMimes: ['application/zip'],
    },
    {
        kind: 'document',
        extensions: ['.txt'],
        mimeTypes: ['text/plain', 'application/octet-stream'],
        signatureMimes: ['text/plain'],
    },
    {
        kind: 'zip',
        extensions: ['.zip'],
        mimeTypes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
        signatureMimes: ['application/zip'],
    },
];

export type ValidationOptions = {
    maxBytes: number;
    allowZip: boolean;
    strictSignature: boolean;
};

export type ValidatedFile = {
    sanitizedFileName: string;
    extension: string;
    mimeType: string;
    detectedMimeType: string | null;
    kind: FileKind;
    sha256: string;
    sizeBytes: number;
};

export type MalwareScanResult = {
    status: 'clean' | 'infected' | 'skipped' | 'error';
    engine: string;
    signature: string | null;
    detail: string | null;
};

function startsWith(input: Buffer, signature: number[]): boolean {
    if (input.length < signature.length) return false;
    return signature.every((value, idx) => input[idx] === value);
}

function detectMimeBySignature(buffer: Buffer): string | null {
    if (buffer.length < 12) return null;
    if (startsWith(buffer, [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
    if (startsWith(buffer, [0x89, 0x50, 0x4E, 0x47])) return 'image/png';
    if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
    if (startsWith(buffer, [0x50, 0x4B, 0x03, 0x04])) return 'application/zip';
    if (buffer.toString('ascii', 4, 8) === 'ftyp') {
        const brand = buffer.toString('ascii', 8, 12).toLowerCase();
        if (['qt  '].includes(brand)) return 'video/quicktime';
        return 'video/mp4';
    }
    if (startsWith(buffer, [0x1A, 0x45, 0xDF, 0xA3])) return 'video/webm';
    return null;
}

export function sanitizeFileName(fileName: string): string {
    const normalized = String(fileName || '').replace(/[^a-zA-Z0-9._ -]/g, '_').trim();
    const collapsed = normalized.replace(/\s+/g, ' ');
    return collapsed || `upload-${randomUUID().slice(0, 8)}`;
}

export function normalizeFolderPath(input: string): string {
    const normalized = String(input || '')
        .replace(/\\/g, '/')
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean)
        .filter((segment) => segment !== '.' && segment !== '..')
        .map((segment) => segment.replace(/[^a-zA-Z0-9._ -]/g, '_'))
        .join('/');

    return normalized.slice(0, 255);
}

function resolveAllowedType(extension: string): AllowedType | null {
    return ALLOWED_TYPES.find((entry) => entry.extensions.includes(extension)) || null;
}

type ZipSafetyResult = {
    entries: number;
    totalUncompressedBytes: number;
    totalCompressedBytes: number;
    blocked: boolean;
    reason: string | null;
};

function analyzeZipDirectory(directory: { files: any[] }): ZipSafetyResult {
    const maxEntries = config.fileSecurity.zip.maxEntries;
    const maxUncompressedBytes = config.fileSecurity.zip.maxUncompressedMb * 1024 * 1024;
    const maxRatio = config.fileSecurity.zip.maxCompressionRatio;

    let entries = 0;
    let totalUncompressedBytes = 0;
    let totalCompressedBytes = 0;

    for (const file of directory.files) {
        entries += 1;
        totalUncompressedBytes += Number(file.uncompressedSize || 0);
        totalCompressedBytes += Number(file.compressedSize || 0);

        const entryPath = String(file.path || '').replace(/\\/g, '/');
        if (entryPath.includes('../') || entryPath.startsWith('/')) {
            return { entries, totalUncompressedBytes, totalCompressedBytes, blocked: true, reason: 'ZIP enthält unsichere Pfade (Path Traversal).' };
        }
        if (entries > maxEntries) {
            return { entries, totalUncompressedBytes, totalCompressedBytes, blocked: true, reason: `ZIP enthält zu viele Dateien (max. ${maxEntries}).` };
        }
        if (totalUncompressedBytes > maxUncompressedBytes) {
            return { entries, totalUncompressedBytes, totalCompressedBytes, blocked: true, reason: `ZIP ist nach Entpacken zu groß (max. ${config.fileSecurity.zip.maxUncompressedMb} MB).` };
        }
    }

    const compressionRatio = totalCompressedBytes > 0
        ? totalUncompressedBytes / totalCompressedBytes
        : totalUncompressedBytes > 0 ? Number.POSITIVE_INFINITY : 1;

    if (compressionRatio > maxRatio) {
        return { entries, totalUncompressedBytes, totalCompressedBytes, blocked: true, reason: `ZIP-Kompressionsrate ist zu hoch (>${maxRatio}).` };
    }

    return { entries, totalUncompressedBytes, totalCompressedBytes, blocked: false, reason: null };
}

export async function validateZipSafety(fileBuffer: Buffer): Promise<ZipSafetyResult> {
    try {
        const directory = await unzipper.Open.buffer(fileBuffer);
        return analyzeZipDirectory(directory);
    } catch {
        return { entries: 0, totalUncompressedBytes: 0, totalCompressedBytes: 0, blocked: true, reason: 'ZIP-Datei ist beschädigt oder nicht lesbar.' };
    }
}

export async function validateZipSafetyFromFile(filePath: string): Promise<ZipSafetyResult> {
    try {
        const directory = await unzipper.Open.file(filePath);
        return analyzeZipDirectory(directory);
    } catch {
        return { entries: 0, totalUncompressedBytes: 0, totalCompressedBytes: 0, blocked: true, reason: 'ZIP-Datei ist beschädigt oder nicht lesbar.' };
    }
}

export async function validateUploadedFile(
    fileName: string,
    mimeType: string,
    buffer: Buffer,
    options: ValidationOptions,
): Promise<ValidatedFile> {
    if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
        throw new Error('Leere Datei ist nicht erlaubt.');
    }
    if (buffer.length > options.maxBytes) {
        throw new Error(`Datei ist zu groß (max. ${Math.round(options.maxBytes / (1024 * 1024))} MB).`);
    }

    const sanitizedFileName = sanitizeFileName(fileName);
    const extension = path.extname(sanitizedFileName).toLowerCase();
    const allowedType = resolveAllowedType(extension);

    if (!allowedType) {
        throw new Error(`Dateiendung '${extension || 'unbekannt'}' ist nicht erlaubt.`);
    }

    if (allowedType.kind === 'zip' && !options.allowZip) {
        throw new Error('ZIP-Uploads sind derzeit deaktiviert.');
    }

    const normalizedMime = String(mimeType || '').toLowerCase();
    if (!allowedType.mimeTypes.includes(normalizedMime)) {
        throw new Error(`MIME-Typ '${normalizedMime || 'unbekannt'}' ist für ${extension} nicht erlaubt.`);
    }

    const detectedMimeType = detectMimeBySignature(buffer);
    if (detectedMimeType && !allowedType.signatureMimes.includes(detectedMimeType)) {
        throw new Error(`Dateiinhalt passt nicht zu Dateiendung (${extension}).`);
    }

    if (!detectedMimeType && options.strictSignature && allowedType.kind !== 'document') {
        throw new Error('Dateisignatur konnte nicht eindeutig verifiziert werden.');
    }

    if (allowedType.kind === 'zip') {
        const zipInfo = await validateZipSafety(buffer);
        if (zipInfo.blocked) {
            throw new Error(zipInfo.reason || 'ZIP-Datei wurde aus Sicherheitsgründen blockiert.');
        }
    }

    return {
        sanitizedFileName,
        extension,
        mimeType: normalizedMime,
        detectedMimeType,
        kind: allowedType.kind,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        sizeBytes: buffer.length,
    };
}

export async function validateUploadedFileFromPath(
    fileName: string,
    mimeType: string,
    filePath: string,
    options: ValidationOptions,
): Promise<ValidatedFile> {
    const stats = await stat(filePath);
    if (!stats.isFile() || stats.size <= 0) {
        throw new Error('Leere Datei ist nicht erlaubt.');
    }
    if (stats.size > options.maxBytes) {
        throw new Error(`Datei ist zu groß (max. ${Math.round(options.maxBytes / (1024 * 1024))} MB).`);
    }

    const sanitizedFileName = sanitizeFileName(fileName);
    const extension = path.extname(sanitizedFileName).toLowerCase();
    const allowedType = resolveAllowedType(extension);

    if (!allowedType) {
        throw new Error(`Dateiendung '${extension || 'unbekannt'}' ist nicht erlaubt.`);
    }

    if (allowedType.kind === 'zip' && !options.allowZip) {
        throw new Error('ZIP-Uploads sind derzeit deaktiviert.');
    }

    const normalizedMime = String(mimeType || '').toLowerCase();
    if (!allowedType.mimeTypes.includes(normalizedMime)) {
        throw new Error(`MIME-Typ '${normalizedMime || 'unbekannt'}' ist für ${extension} nicht erlaubt.`);
    }

    const sha256 = createHash('sha256');
    let signatureProbe = Buffer.alloc(0);
    for await (const chunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
        const bufChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        sha256.update(bufChunk);
        if (signatureProbe.length < 256) {
            const remaining = 256 - signatureProbe.length;
            signatureProbe = Buffer.concat([signatureProbe, bufChunk.subarray(0, remaining)]);
        }
    }

    const detectedMimeType = detectMimeBySignature(signatureProbe);
    if (detectedMimeType && !allowedType.signatureMimes.includes(detectedMimeType)) {
        throw new Error(`Dateiinhalt passt nicht zu Dateiendung (${extension}).`);
    }

    if (!detectedMimeType && options.strictSignature && allowedType.kind !== 'document') {
        throw new Error('Dateisignatur konnte nicht eindeutig verifiziert werden.');
    }

    if (allowedType.kind === 'zip') {
        const zipInfo = await validateZipSafetyFromFile(filePath);
        if (zipInfo.blocked) {
            throw new Error(zipInfo.reason || 'ZIP-Datei wurde aus Sicherheitsgründen blockiert.');
        }
    }

    return {
        sanitizedFileName,
        extension,
        mimeType: normalizedMime,
        detectedMimeType,
        kind: allowedType.kind,
        sha256: sha256.digest('hex'),
        sizeBytes: stats.size,
    };
}

function buildScanArgs(targetPath: string): string[] {
    const binary = config.fileSecurity.clamav.binary;
    const isDaemon = binary.includes('clamdscan');
    // clamdscan needs --fdpass so the daemon can read the file
    if (isDaemon) return ['--no-summary', '--fdpass', '--stdout', targetPath];
    return ['--no-summary', '--stdout', targetPath];
}

function parseScanOutput(stdout: string, stderr: string): MalwareScanResult | null {
    const output = `${stdout || ''}\n${stderr || ''}`.trim();
    const foundLine = output.split(/\r?\n/).find((line) => line.includes('FOUND')) || '';
    if (foundLine) {
        const signature = foundLine.replace(/^.*?:\s*/, '').replace(/\s+FOUND\s*$/i, '').trim() || 'Malware';
        return { status: 'infected', engine: 'clamav', signature, detail: foundLine };
    }
    return null;
}

function parseScanError(error: any): MalwareScanResult {
    const output = `${error?.stdout || ''}\n${error?.stderr || ''}`.trim();
    const infected = parseScanOutput(error?.stdout || '', error?.stderr || '');
    if (infected) return infected;
    if (error?.code === 1) return { status: 'infected', engine: 'clamav', signature: 'Malware', detail: 'Malware detected' };

    if (error?.code === 'ENOENT') {
        if (config.fileSecurity.clamav.failClosed) {
            return { status: 'error', engine: 'clamav', signature: null, detail: 'ClamAV binary nicht gefunden (fail-closed aktiv).' };
        }
        return { status: 'skipped', engine: 'clamav', signature: null, detail: 'ClamAV binary nicht gefunden.' };
    }

    return { status: 'error', engine: 'clamav', signature: null, detail: output || String(error?.message || 'Scan fehlgeschlagen') };
}

export async function scanBufferForMalware(buffer: Buffer, fileName: string): Promise<MalwareScanResult> {
    if (!config.fileSecurity.clamav.enabled) {
        return { status: 'skipped', engine: 'clamav', signature: null, detail: 'ClamAV disabled' };
    }

    const tmpPrefix = path.join(config.app.uploadsDir, 'tmp-file-security-');
    let tmpDir = '';
    let tmpFile = '';

    try {
        tmpDir = await mkdtemp(tmpPrefix);
        tmpFile = path.join(tmpDir, sanitizeFileName(fileName));
        await writeFile(tmpFile, buffer);

        const { stdout, stderr } = await execFileAsync(
            config.fileSecurity.clamav.binary,
            buildScanArgs(tmpFile),
            { timeout: config.fileSecurity.clamav.timeoutMs, maxBuffer: 1024 * 1024 },
        );

        const infected = parseScanOutput(stdout, stderr);
        if (infected) return infected;

        return { status: 'clean', engine: 'clamav', signature: null, detail: `${stdout || ''}\n${stderr || ''}`.trim() || 'OK' };
    } catch (error: any) {
        return parseScanError(error);
    } finally {
        if (tmpDir) {
            await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
        }
    }
}

export async function scanStoredFileForMalware(filePath: string): Promise<MalwareScanResult> {
    if (!config.fileSecurity.clamav.enabled) {
        return { status: 'skipped', engine: 'clamav', signature: null, detail: 'ClamAV disabled' };
    }

    try {
        const { stdout, stderr } = await execFileAsync(
            config.fileSecurity.clamav.binary,
            buildScanArgs(filePath),
            { timeout: config.fileSecurity.clamav.timeoutMs, maxBuffer: 1024 * 1024 },
        );

        const infected = parseScanOutput(stdout, stderr);
        if (infected) return infected;

        return { status: 'clean', engine: 'clamav', signature: null, detail: `${stdout || ''}\n${stderr || ''}`.trim() || 'OK' };
    } catch (error: any) {
        return parseScanError(error);
    }
}

export function buildSafeStoragePath(baseDir: string, storageKey: string): string {
    const normalized = String(storageKey || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const target = path.resolve(baseDir, normalized);
    const root = path.resolve(baseDir);
    const rootWithSep = `${root}${path.sep}`;
    if (target !== root && !target.startsWith(rootWithSep)) {
        throw new Error('Ungültiger Storage-Key.');
    }
    return target;
}
