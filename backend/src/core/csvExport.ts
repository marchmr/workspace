/**
 * CSV Export Utility
 * Generiert CSV-Dateien mit BOM fuer Excel-Kompatibilitaet (DE-Standard: Semikolon)
 */

export interface CsvColumn {
    key: string;
    label: string;
    format?: (value: any) => string;
}

export interface CsvExportOptions {
    separator?: string;   // Default: ';' (DE-Standard)
    bom?: boolean;        // Default: true (UTF-8 BOM fuer Excel)
    dateFormat?: string;  // Default: 'de-DE'
}

function escapeCell(value: any, separator: string): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    // Wenn der Wert den Separator, Anfuehrungszeichen oder Zeilenumbrueche enthaelt
    if (str.includes(separator) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function formatDate(value: any, locale: string): string {
    if (!value) return '';
    try {
        const date = new Date(value);
        if (isNaN(date.getTime())) return String(value);
        return date.toLocaleDateString(locale, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return String(value);
    }
}

export function generateCSV(
    columns: CsvColumn[],
    rows: Record<string, any>[],
    options: CsvExportOptions = {},
): Buffer {
    const sep = options.separator ?? ';';
    const addBom = options.bom !== false;
    const locale = options.dateFormat ?? 'de-DE';

    const lines: string[] = [];

    // Header
    lines.push(columns.map((col) => escapeCell(col.label, sep)).join(sep));

    // Datenzeilen
    for (const row of rows) {
        const cells = columns.map((col) => {
            const value = row[col.key];
            if (col.format) {
                return escapeCell(col.format(value), sep);
            }
            // Auto-Datumsformatierung fuer Date-Objekte und ISO-Strings
            if (value instanceof Date) {
                return escapeCell(formatDate(value, locale), sep);
            }
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
                return escapeCell(formatDate(value, locale), sep);
            }
            return escapeCell(value, sep);
        });
        lines.push(cells.join(sep));
    }

    const csv = lines.join('\r\n') + '\r\n';
    const bom = addBom ? '\uFEFF' : '';
    return Buffer.from(bom + csv, 'utf-8');
}
