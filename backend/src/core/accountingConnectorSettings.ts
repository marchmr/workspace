import type { Knex } from 'knex';
import { decrypt } from './encryption.js';
import { config } from './config.js';

export const ACCOUNTING_CONNECTOR_SETTING_KEYS = {
    enabled: 'accounting.connector.enabled',
    apiKeyHeaderName: 'accounting.connector.api_key_header',
    apiKey: 'accounting.connector.api_key',
    hmacSecret: 'accounting.connector.hmac_secret',
    timestampToleranceSec: 'accounting.connector.timestamp_tolerance_sec',
    nonceTtlSec: 'accounting.connector.nonce_ttl_sec',
    maxPayloadBytes: 'accounting.connector.max_payload_bytes',
    publicBaseUrl: 'accounting.connector.public_base_url',
    allowedEventTypes: 'accounting.connector.allowed_event_types',
} as const;

export interface AccountingConnectorRuntimeSettings {
    enabled: boolean;
    apiKeyHeaderName: string;
    apiKey: string;
    hmacSecret: string;
    timestampToleranceSec: number;
    nonceTtlSec: number;
    maxPayloadBytes: number;
    publicBaseUrl: string;
    allowedEventTypes: string[];
}

const MIN_TIMESTAMP_TOLERANCE_SEC = 30;
const MAX_TIMESTAMP_TOLERANCE_SEC = 3600;
const MIN_NONCE_TTL_SEC = 30;
const MAX_NONCE_TTL_SEC = 3600;
const MIN_PAYLOAD_BYTES = 1024;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

function parseBool(value: string | undefined, fallback: boolean): boolean {
    if (!value) return fallback;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function parsePositiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeHeaderName(value: string | undefined, fallback: string): string {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    if (!/^[A-Za-z0-9-]{1,100}$/.test(raw)) return fallback;
    return raw;
}

function normalizeUrl(value: string | undefined): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'https:') return '';
        return parsed.origin;
    } catch {
        return '';
    }
}

function normalizeEventTypeList(value: string | undefined): string[] {
    if (!value) return [];
    return Array.from(new Set(
        value
            .split(',')
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean),
    ));
}

export function normalizeIncomingEventType(value: string): string {
    return String(value || '').trim().toLowerCase();
}

export function buildAccountingConnectorEndpointUrl(publicBaseUrl: string): string {
    const base = normalizeUrl(publicBaseUrl);
    if (!base) return '/api/accounting/events';
    return `${base}/api/accounting/events`;
}

export async function loadAccountingConnectorSettings(db: Knex): Promise<AccountingConnectorRuntimeSettings> {
    const keys = Object.values(ACCOUNTING_CONNECTOR_SETTING_KEYS);
    const rows = await db('settings')
        .whereIn('key', keys)
        .whereNull('tenant_id')
        .select('key', 'value_encrypted');

    const rawByKey = new Map<string, string>();
    for (const row of rows) {
        const key = String(row.key || '');
        if (!key) continue;
        const encrypted = row.value_encrypted ? String(row.value_encrypted) : '';
        if (!encrypted) {
            rawByKey.set(key, '');
            continue;
        }
        try {
            rawByKey.set(key, decrypt(encrypted));
        } catch {
            rawByKey.set(key, '');
        }
    }

    const enabled = parseBool(rawByKey.get(ACCOUNTING_CONNECTOR_SETTING_KEYS.enabled), true);
    const apiKeyHeaderName = normalizeHeaderName(
        rawByKey.get(ACCOUNTING_CONNECTOR_SETTING_KEYS.apiKeyHeaderName),
        config.accountingConnector.apiKeyHeaderName,
    );
    const apiKey = String(
        rawByKey.get(ACCOUNTING_CONNECTOR_SETTING_KEYS.apiKey) ?? config.accountingConnector.apiKey,
    ).trim();
    const hmacSecret = String(
        rawByKey.get(ACCOUNTING_CONNECTOR_SETTING_KEYS.hmacSecret) ?? config.accountingConnector.hmacSecret,
    ).trim();
    const timestampToleranceSec = parsePositiveInt(
        rawByKey.get(ACCOUNTING_CONNECTOR_SETTING_KEYS.timestampToleranceSec),
        config.accountingConnector.timestampToleranceSec,
        MIN_TIMESTAMP_TOLERANCE_SEC,
        MAX_TIMESTAMP_TOLERANCE_SEC,
    );
    const nonceTtlSec = parsePositiveInt(
        rawByKey.get(ACCOUNTING_CONNECTOR_SETTING_KEYS.nonceTtlSec),
        config.accountingConnector.nonceTtlSec,
        MIN_NONCE_TTL_SEC,
        MAX_NONCE_TTL_SEC,
    );
    const maxPayloadBytes = parsePositiveInt(
        rawByKey.get(ACCOUNTING_CONNECTOR_SETTING_KEYS.maxPayloadBytes),
        config.accountingConnector.maxPayloadBytes,
        MIN_PAYLOAD_BYTES,
        MAX_PAYLOAD_BYTES,
    );
    const publicBaseUrl = normalizeUrl(
        rawByKey.get(ACCOUNTING_CONNECTOR_SETTING_KEYS.publicBaseUrl),
    );
    const allowedEventTypes = normalizeEventTypeList(
        rawByKey.get(ACCOUNTING_CONNECTOR_SETTING_KEYS.allowedEventTypes),
    );

    return {
        enabled,
        apiKeyHeaderName,
        apiKey,
        hmacSecret,
        timestampToleranceSec,
        nonceTtlSec,
        maxPayloadBytes,
        publicBaseUrl,
        allowedEventTypes,
    };
}
