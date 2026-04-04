import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../../../backend/src/core/permissions.js';
import { getDatabase } from '../../../../backend/src/core/database.js';
import { createRequire } from 'module';

// pdfmake Typen fuer TS
import type { TDocumentDefinitions, Content, TableCell, Style } from 'pdfmake/interfaces.js';

// pdfmake Server-Side: der Konstruktor liegt unter pdfmake/src/printer (nicht im Haupt-Export).
// Lazy-Init um CJS/ESM-Kompatibilitaet unter tsx sicherzustellen.
const _require = createRequire(import.meta.url);

/* ════════════════════════════════════════════
   CSV Parser (kein externer Dependency noetig)
   ════════════════════════════════════════════ */

function parseCSV(raw: string, delimiter = ';'): { headers: string[]; rows: string[][] } {
    const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length === 0) return { headers: [], rows: [] };

    const parseLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === delimiter && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current.trim());
        return result;
    };

    const headers = parseLine(lines[0]);
    const rows: string[][] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parsed = parseLine(line);
        if (parsed.length > 0) rows.push(parsed);
    }
    return { headers, rows };
}

/* ════════════════════════════════════════════
   Kundennummer-Generator (Kopie aus customers.ts)
   ════════════════════════════════════════════ */

async function generateCustomerNumber(tenantId: number): Promise<string> {
    const db = getDatabase();
    const year = new Date().getFullYear();
    const prefix = `KD-${year}-`;
    const maxRow = await db('crm_customers')
        .where('tenant_id', tenantId)
        .andWhere('customer_number', 'like', `${prefix}%`)
        .select(db.raw(`MAX(CAST(SUBSTRING(customer_number, ${prefix.length + 1}) AS UNSIGNED)) as max_num`))
        .first();
    const nextNum = ((maxRow as any)?.max_num || 0) + 1;
    return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

/* ════════════════════════════════════════════
   Fonts für pdfmake (eingebettete Standard-Fonts)
   ════════════════════════════════════════════ */

// Helvetica ist in pdfkit eingebaut — keine externen Font-Dateien noetig
const pdfFonts: any = {
    Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
    },
};

// Lazy Printer — wird beim ersten Aufruf initialisiert
let _printer: any = null;
function getPrinter(): any {
    if (!_printer) {
        const PdfPrinter = _require('pdfmake/src/printer');
        _printer = new PdfPrinter(pdfFonts);
    }
    return _printer;
}
const defaultFont = 'Helvetica';

/* ════════════════════════════════════════════
   Mapping-Definitionen für CSV-Import
   ════════════════════════════════════════════ */

const FIELD_MAP: Record<string, { dbField: string; label: string }> = {
    // Standard-Zuordnungen (Case insensitive matching)
    'firmenname': { dbField: 'company_name', label: 'Firmenname' },
    'firma': { dbField: 'company_name', label: 'Firmenname' },
    'company': { dbField: 'company_name', label: 'Firmenname' },
    'company_name': { dbField: 'company_name', label: 'Firmenname' },
    'anrede': { dbField: 'salutation', label: 'Anrede' },
    'salutation': { dbField: 'salutation', label: 'Anrede' },
    'vorname': { dbField: 'first_name', label: 'Vorname' },
    'first_name': { dbField: 'first_name', label: 'Vorname' },
    'nachname': { dbField: 'last_name', label: 'Nachname' },
    'last_name': { dbField: 'last_name', label: 'Nachname' },
    'name': { dbField: 'last_name', label: 'Nachname' },
    'e-mail': { dbField: 'email', label: 'E-Mail' },
    'email': { dbField: 'email', label: 'E-Mail' },
    'mail': { dbField: 'email', label: 'E-Mail' },
    'telefon': { dbField: 'phone', label: 'Telefon' },
    'phone': { dbField: 'phone', label: 'Telefon' },
    'tel': { dbField: 'phone', label: 'Telefon' },
    'mobil': { dbField: 'mobile', label: 'Mobil' },
    'mobile': { dbField: 'mobile', label: 'Mobil' },
    'handy': { dbField: 'mobile', label: 'Mobil' },
    'fax': { dbField: 'fax', label: 'Fax' },
    'webseite': { dbField: 'website', label: 'Webseite' },
    'website': { dbField: 'website', label: 'Webseite' },
    'homepage': { dbField: 'website', label: 'Webseite' },
    'strasse': { dbField: 'street', label: 'Strasse' },
    'street': { dbField: 'street', label: 'Strasse' },
    'straße': { dbField: 'street', label: 'Strasse' },
    'adresse': { dbField: 'street', label: 'Strasse' },
    'plz': { dbField: 'zip', label: 'PLZ' },
    'zip': { dbField: 'zip', label: 'PLZ' },
    'postleitzahl': { dbField: 'zip', label: 'PLZ' },
    'ort': { dbField: 'city', label: 'Ort' },
    'stadt': { dbField: 'city', label: 'Ort' },
    'city': { dbField: 'city', label: 'Ort' },
    'land': { dbField: 'country', label: 'Land' },
    'country': { dbField: 'country', label: 'Land' },
    'ust-idnr': { dbField: 'vat_id', label: 'USt-IdNr.' },
    'ust-id': { dbField: 'vat_id', label: 'USt-IdNr.' },
    'vat_id': { dbField: 'vat_id', label: 'USt-IdNr.' },
    'branche': { dbField: 'industry', label: 'Branche' },
    'industry': { dbField: 'industry', label: 'Branche' },
    'kategorie': { dbField: 'category', label: 'Kategorie' },
    'category': { dbField: 'category', label: 'Kategorie' },
    'status': { dbField: 'status', label: 'Status' },
    'zahlungsbedingungen': { dbField: 'payment_terms', label: 'Zahlungsbedingungen' },
    'payment_terms': { dbField: 'payment_terms', label: 'Zahlungsbedingungen' },
    'notizen': { dbField: 'notes_internal', label: 'Interne Notizen' },
    'notes': { dbField: 'notes_internal', label: 'Interne Notizen' },
    'typ': { dbField: 'type', label: 'Typ' },
    'type': { dbField: 'type', label: 'Typ' },
};

/* ════════════════════════════════════════════
   Routes
   ════════════════════════════════════════════ */

export default async function importExportRoutes(fastify: FastifyInstance): Promise<void> {

    // ══════════════════════════════════════════
    // POST /import/preview — CSV hochladen + Vorschau
    // ══════════════════════════════════════════
    fastify.post('/import/preview', {
        preHandler: [requirePermission('crm.create')],
        config: { rawBody: true },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as any;
        const csvContent = body.csv_content as string;
        const delimiter = body.delimiter || ';';

        if (!csvContent || typeof csvContent !== 'string') {
            return reply.status(400).send({ error: 'CSV-Inhalt fehlt' });
        }

        const { headers, rows } = parseCSV(csvContent, delimiter);

        if (headers.length === 0) {
            return reply.status(400).send({ error: 'CSV enthält keine Kopfzeile' });
        }

        // Auto-Mapping basierend auf Header-Namen
        const mapping: Record<string, string> = {};
        const unmapped: string[] = [];

        for (const header of headers) {
            const normalized = header.toLowerCase().replace(/[^a-zaeoeue0-9_-]/g, '').trim();
            const match = FIELD_MAP[normalized];
            if (match) {
                mapping[header] = match.dbField;
            } else {
                unmapped.push(header);
            }
        }

        // Vorschau-Daten (max 10 Zeilen)
        const preview = rows.slice(0, 10).map(row => {
            const record: Record<string, string> = {};
            headers.forEach((h, i) => { record[h] = row[i] || ''; });
            return record;
        });

        return reply.send({
            headers,
            mapping,
            unmapped,
            totalRows: rows.length,
            preview,
            availableFields: Object.entries(FIELD_MAP)
                .filter(([_, v], i, arr) => arr.findIndex(([_, v2]) => v2.dbField === v.dbField) === i)
                .map(([_, v]) => ({ value: v.dbField, label: v.label })),
        });
    });

    // ══════════════════════════════════════════
    // POST /import/execute — CSV-Import durchführen
    // ══════════════════════════════════════════
    fastify.post('/import/execute', { preHandler: [requirePermission('crm.create')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const body = request.body as any;

        const csvContent = body.csv_content as string;
        const delimiter = body.delimiter || ';';
        const mapping = body.mapping as Record<string, string>;
        const skipDuplicates = body.skip_duplicates !== false;
        const defaultType = body.default_type || 'company';
        const defaultStatus = body.default_status || 'active';

        if (!csvContent || !mapping) {
            return reply.status(400).send({ error: 'CSV-Inhalt und Mapping erforderlich' });
        }

        const { headers, rows } = parseCSV(csvContent, delimiter);

        let imported = 0;
        let skipped = 0;
        let errors: { row: number; reason: string }[] = [];
        let nextNum = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const record: Record<string, any> = {};

            // Felder mappen
            for (const [csvHeader, dbField] of Object.entries(mapping)) {
                const colIdx = headers.indexOf(csvHeader);
                if (colIdx >= 0 && row[colIdx]) {
                    record[dbField] = row[colIdx].trim();
                }
            }

            // Typ und Status defaults
            if (!record.type || !['company', 'person'].includes(record.type)) {
                record.type = record.company_name ? 'company' : (record.last_name ? 'person' : defaultType);
            }
            if (!record.status || !['active', 'inactive', 'prospect'].includes(record.status)) {
                record.status = defaultStatus;
            }

            // Validierung
            if (record.type === 'company' && !record.company_name) {
                if (record.last_name) {
                    record.type = 'person';
                } else {
                    errors.push({ row: i + 2, reason: 'Kein Firmenname und kein Nachname' });
                    skipped++;
                    continue;
                }
            }
            if (record.type === 'person' && !record.last_name) {
                errors.push({ row: i + 2, reason: 'Kein Nachname für Person' });
                skipped++;
                continue;
            }

            // Duplikat-Check per E-Mail
            if (skipDuplicates && record.email) {
                const existing = await db('crm_customers')
                    .where({ tenant_id: user.tenantId, email: record.email })
                    .first();
                if (existing) {
                    skipped++;
                    continue;
                }
            }

            // Kundennummer generieren
            const customerNumber = await generateCustomerNumber(user.tenantId);

            try {
                await db('crm_customers').insert({
                    tenant_id: user.tenantId,
                    customer_number: customerNumber,
                    type: record.type,
                    company_name: record.company_name || null,
                    salutation: record.salutation || null,
                    first_name: record.first_name || null,
                    last_name: record.last_name || null,
                    email: record.email || null,
                    phone: record.phone || null,
                    mobile: record.mobile || null,
                    fax: record.fax || null,
                    website: record.website || null,
                    street: record.street || null,
                    zip: record.zip || null,
                    city: record.city || null,
                    country: record.country || 'Deutschland',
                    vat_id: record.vat_id || null,
                    industry: record.industry || null,
                    category: record.category || null,
                    status: record.status,
                    payment_terms: record.payment_terms || null,
                    notes_internal: record.notes_internal || null,
                    created_by: user.userId,
                    created_at: new Date(),
                    updated_at: new Date(),
                });
                imported++;
            } catch (err: any) {
                errors.push({ row: i + 2, reason: err.message?.substring(0, 100) || 'Unbekannter Fehler' });
                skipped++;
            }
        }

        // Audit-Log
        await fastify.audit.log({
            action: 'crm.import.executed',
            category: 'plugin',
            entityType: 'crm_customers',
            newState: { imported, skipped, totalRows: rows.length },
            pluginId: 'crm',
        }, request);

        return reply.send({
            success: true,
            imported,
            skipped,
            errors: errors.slice(0, 20),
            totalRows: rows.length,
        });
    });

    // ══════════════════════════════════════════
    // GET /export/csv — Kunden als CSV exportieren
    // ══════════════════════════════════════════
    fastify.get('/export/csv', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { status, type, category } = request.query as Record<string, string>;

        let query = db('crm_customers').where('tenant_id', user.tenantId);
        if (status) query = query.where('status', status);
        if (type) query = query.where('type', type);
        if (category) query = query.where('category', category);

        const customers = await query.orderBy('customer_number', 'asc').select('*');

        // CSV-Header
        const csvFields = [
            'customer_number', 'type', 'company_name', 'salutation', 'first_name', 'last_name',
            'email', 'phone', 'mobile', 'fax', 'website', 'street', 'zip', 'city', 'country',
            'vat_id', 'industry', 'category', 'status', 'payment_terms', 'notes_internal',
        ];
        const csvLabels = [
            'Kundennr', 'Typ', 'Firmenname', 'Anrede', 'Vorname', 'Nachname',
            'E-Mail', 'Telefon', 'Mobil', 'Fax', 'Webseite', 'Strasse', 'PLZ', 'Ort', 'Land',
            'USt-IdNr', 'Branche', 'Kategorie', 'Status', 'Zahlungsbedingungen', 'Notizen',
        ];

        const escape = (val: any): string => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(';') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        // BOM für UTF-8 Excel-Kompatibilität
        const BOM = '\uFEFF';
        let csv = BOM + csvLabels.join(';') + '\n';

        for (const c of customers) {
            csv += csvFields.map(f => escape(c[f])).join(';') + '\n';
        }

        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="crm_kunden_export_${new Date().toISOString().split('T')[0]}.csv"`);
        return reply.send(csv);
    });

    // ══════════════════════════════════════════
    // GET /export/pdf/:id — Einzelne Kundenakte als PDF
    // ══════════════════════════════════════════
    fastify.get('/export/pdf/:id', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { id } = request.params as { id: string };

        const customer = await db('crm_customers').where({ id, tenant_id: user.tenantId }).first();
        if (!customer) return reply.status(404).send({ error: 'Kunde nicht gefunden' });

        const displayName = customer.type === 'company' && customer.company_name
            ? customer.company_name
            : [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unbenannt';

        // Zugehoerige Daten laden
        let contacts: any[] = [];
        let tickets: any[] = [];
        let notes: any[] = [];
        try {
            contacts = await db('crm_contacts').where({ customer_id: id, tenant_id: user.tenantId }).orderBy('is_primary', 'desc');
            tickets = await db('crm_tickets').where({ customer_id: id, tenant_id: user.tenantId }).orderBy('created_at', 'desc').limit(20);
            notes = await db('crm_notes').where({ customer_id: id, tenant_id: user.tenantId }).orderBy('created_at', 'desc').limit(20);
        } catch { /* Tabellen evtl. noch nicht vorhanden */ }

        const statusLabels: Record<string, string> = { active: 'Aktiv', inactive: 'Inaktiv', prospect: 'Interessent' };
        const ticketStatusLabels: Record<string, string> = { open: 'Offen', in_progress: 'In Bearbeitung', waiting: 'Wartend', resolved: 'Gelöst', closed: 'Geschlossen' };
        const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('de-DE') : '—';

        // Stammdaten-Tabelle
        const infoRows: TableCell[][] = [];
        const addRow = (label: string, value: any) => {
            if (value) infoRows.push([{ text: label, bold: true, fillColor: '#f8f9fa' }, String(value)]);
        };
        addRow('Kundennummer', customer.customer_number);
        addRow('Typ', customer.type === 'company' ? 'Firma' : 'Person');
        addRow('Status', statusLabels[customer.status] || customer.status);
        if (customer.company_name) addRow('Firmenname', customer.company_name);
        if (customer.salutation) addRow('Anrede', customer.salutation);
        if (customer.first_name) addRow('Vorname', customer.first_name);
        if (customer.last_name) addRow('Nachname', customer.last_name);
        if (customer.email) addRow('E-Mail', customer.email);
        if (customer.phone) addRow('Telefon', customer.phone);
        if (customer.mobile) addRow('Mobil', customer.mobile);
        if (customer.fax) addRow('Fax', customer.fax);
        if (customer.website) addRow('Webseite', customer.website);
        const address = [customer.street, [customer.zip, customer.city].filter(Boolean).join(' '), customer.country].filter(Boolean).join(', ');
        if (address) addRow('Adresse', address);
        if (customer.vat_id) addRow('USt-IdNr.', customer.vat_id);
        if (customer.industry) addRow('Branche', customer.industry);
        if (customer.category) addRow('Kategorie', customer.category);
        if (customer.payment_terms) addRow('Zahlungsbedingungen', customer.payment_terms);
        addRow('Erstellt am', formatDate(customer.created_at));

        const content: Content[] = [
            // Header
            { text: 'Kundenakte', style: 'header' },
            { text: displayName, style: 'customerName' },
            { text: `${customer.customer_number} · Exportiert am ${new Date().toLocaleDateString('de-DE')}`, style: 'subheader' },
            { text: '', margin: [0, 10, 0, 0] },

            // Stammdaten
            { text: 'Stammdaten', style: 'sectionTitle' },
            {
                table: {
                    widths: [130, '*'],
                    body: infoRows.length > 0 ? infoRows : [['-', '-']],
                },
                layout: {
                    hLineWidth: () => 0.5,
                    vLineWidth: () => 0.5,
                    hLineColor: () => '#ddd',
                    vLineColor: () => '#ddd',
                    paddingLeft: () => 6,
                    paddingRight: () => 6,
                    paddingTop: () => 4,
                    paddingBottom: () => 4,
                },
            },
        ];

        // Interne Notizen
        if (customer.notes_internal) {
            content.push(
                { text: '', margin: [0, 10, 0, 0] },
                { text: 'Interne Notizen', style: 'sectionTitle' },
                { text: customer.notes_internal, fontSize: 9, color: '#555', margin: [0, 4, 0, 0] },
            );
        }

        // Ansprechpartner
        if (contacts.length > 0) {
            content.push(
                { text: '', margin: [0, 14, 0, 0] },
                { text: `Ansprechpartner (${contacts.length})`, style: 'sectionTitle' },
                {
                    table: {
                        headerRows: 1,
                        widths: ['*', '*', '*', 60],
                        body: [
                            [
                                { text: 'Name', bold: true, fillColor: '#f0f0f0' },
                                { text: 'E-Mail', bold: true, fillColor: '#f0f0f0' },
                                { text: 'Telefon', bold: true, fillColor: '#f0f0f0' },
                                { text: 'Haupt', bold: true, fillColor: '#f0f0f0' },
                            ],
                            ...contacts.map(c => [
                                [c.first_name, c.last_name].filter(Boolean).join(' ') + (c.position ? ` (${c.position})` : ''),
                                c.email || '—',
                                c.phone || c.mobile || '—',
                                c.is_primary ? 'Ja' : '',
                            ]),
                        ] as TableCell[][],
                    },
                    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#ddd', vLineColor: () => '#ddd', paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3 },
                    fontSize: 8,
                },
            );
        }

        // Tickets
        if (tickets.length > 0) {
            content.push(
                { text: '', margin: [0, 14, 0, 0] },
                { text: `Tickets (${tickets.length})`, style: 'sectionTitle' },
                {
                    table: {
                        headerRows: 1,
                        widths: [65, '*', 70, 55, 55],
                        body: [
                            [
                                { text: 'Nr.', bold: true, fillColor: '#f0f0f0' },
                                { text: 'Betreff', bold: true, fillColor: '#f0f0f0' },
                                { text: 'Status', bold: true, fillColor: '#f0f0f0' },
                                { text: 'Prioritaet', bold: true, fillColor: '#f0f0f0' },
                                { text: 'Erstellt', bold: true, fillColor: '#f0f0f0' },
                            ],
                            ...tickets.map(t => [
                                { text: t.ticket_number, fontSize: 7 },
                                t.subject,
                                ticketStatusLabels[t.status] || t.status,
                                t.priority === 'urgent' ? { text: 'Dringend', color: '#dc2626', bold: true } : t.priority,
                                formatDate(t.created_at),
                            ]),
                        ] as TableCell[][],
                    },
                    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#ddd', vLineColor: () => '#ddd', paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3 },
                    fontSize: 8,
                },
            );
        }

        // Notizen
        if (notes.length > 0) {
            content.push(
                { text: '', margin: [0, 14, 0, 0] },
                { text: `Notizen (${notes.length})`, style: 'sectionTitle' },
            );
            for (const note of notes) {
                content.push({
                    stack: [
                        { text: note.title || 'Ohne Titel', bold: true, fontSize: 9 },
                        { text: note.content || '', fontSize: 8, color: '#555', margin: [0, 2, 0, 0] },
                        { text: formatDate(note.created_at), fontSize: 7, color: '#999', margin: [0, 2, 0, 6] },
                    ] as Content[],
                });
            }
        }

        const styles: Record<string, Style> = {
            header: { fontSize: 10, color: '#888', margin: [0, 0, 0, 2] },
            customerName: { fontSize: 18, bold: true, color: '#1a1a1a', margin: [0, 0, 0, 4] },
            subheader: { fontSize: 9, color: '#999', margin: [0, 0, 0, 8] },
            sectionTitle: { fontSize: 11, bold: true, color: '#333', margin: [0, 0, 0, 6], decoration: 'underline' as any },
        };

        const docDefinition: TDocumentDefinitions = {
            content,
            styles,
            defaultStyle: { font: defaultFont, fontSize: 9 },
            pageSize: 'A4',
            pageMargins: [40, 40, 40, 50],
            footer: (currentPage: number, pageCount: number) => ({
                columns: [
                    { text: `Kundenakte: ${displayName} (${customer.customer_number})`, fontSize: 7, color: '#bbb', alignment: 'left' as any, margin: [40, 0, 0, 0] },
                    { text: `Seite ${currentPage} von ${pageCount}`, fontSize: 7, color: '#bbb', alignment: 'right' as any, margin: [0, 0, 40, 0] },
                ],
            }),
        };

        const doc = getPrinter().createPdfKitDocument(docDefinition);
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));

        return new Promise<void>((resolve) => {
            doc.on('end', () => {
                const buffer = Buffer.concat(chunks);
                reply.header('Content-Type', 'application/pdf');
                reply.header('Content-Disposition', `attachment; filename="Kundenakte_${customer.customer_number}.pdf"`);
                reply.send(buffer);
                resolve();
            });
            doc.end();
        });
    });

    // ══════════════════════════════════════════
    // GET /export/pdf-list — Kundenliste als PDF
    // ══════════════════════════════════════════
    fastify.get('/export/pdf-list', { preHandler: [requirePermission('crm.view')] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const db = getDatabase();
        const user = request.user as any;
        const { status, type, category } = request.query as Record<string, string>;

        let query = db('crm_customers').where('tenant_id', user.tenantId);
        if (status) query = query.where('status', status);
        if (type) query = query.where('type', type);
        if (category) query = query.where('category', category);

        const customers = await query.orderBy('customer_number', 'asc').select('*');
        const statusLabels: Record<string, string> = { active: 'Aktiv', inactive: 'Inaktiv', prospect: 'Interessent' };

        const tableBody: TableCell[][] = [
            [
                { text: 'Nr.', bold: true, fillColor: '#f0f0f0' },
                { text: 'Name', bold: true, fillColor: '#f0f0f0' },
                { text: 'E-Mail', bold: true, fillColor: '#f0f0f0' },
                { text: 'Telefon', bold: true, fillColor: '#f0f0f0' },
                { text: 'Ort', bold: true, fillColor: '#f0f0f0' },
                { text: 'Status', bold: true, fillColor: '#f0f0f0' },
            ],
        ];

        for (const c of customers) {
            const name = c.type === 'company' && c.company_name
                ? c.company_name
                : [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';
            tableBody.push([
                { text: c.customer_number, fontSize: 7 },
                name,
                c.email || '—',
                c.phone || c.mobile || '—',
                c.city || '—',
                statusLabels[c.status] || c.status,
            ]);
        }

        const docDefinition: TDocumentDefinitions = {
            content: [
                { text: 'Kundenliste', style: 'header' },
                { text: `${customers.length} Kunden · Exportiert am ${new Date().toLocaleDateString('de-DE')}`, fontSize: 9, color: '#999', margin: [0, 0, 0, 12] },
                {
                    table: { headerRows: 1, widths: [60, '*', '*', 70, 60, 50], body: tableBody },
                    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#ddd', vLineColor: () => '#ddd', paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3 },
                    fontSize: 8,
                },
            ],
            styles: { header: { fontSize: 16, bold: true, margin: [0, 0, 0, 4] } },
            defaultStyle: { font: defaultFont, fontSize: 9 },
            pageSize: 'A4',
            pageOrientation: 'landscape',
            pageMargins: [30, 30, 30, 40],
            footer: (currentPage: number, pageCount: number) => ({
                text: `Seite ${currentPage} von ${pageCount}`,
                fontSize: 7, color: '#bbb', alignment: 'center' as any,
            }),
        };

        const doc = getPrinter().createPdfKitDocument(docDefinition);
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));

        return new Promise<void>((resolve) => {
            doc.on('end', () => {
                const buffer = Buffer.concat(chunks);
                reply.header('Content-Type', 'application/pdf');
                reply.header('Content-Disposition', `attachment; filename="Kundenliste_${new Date().toISOString().split('T')[0]}.pdf"`);
                reply.send(buffer);
                resolve();
            });
            doc.end();
        });
    });

    // ══════════════════════════════════════════
    // POST /import/accounting/preview — Accounting data preview
    // ══════════════════════════════════════════
    fastify.post('/import/accounting/preview', {
        preHandler: [requirePermission('crm.create')],
        schema: {
            description: 'Preview accounting customer data import',
            tags: ['CRM', 'Import'],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        customers: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    customer_number: { type: 'string' },
                                    company: { type: 'string' },
                                    first_name: { type: 'string' },
                                    last_name: { type: 'string' },
                                    email: { type: 'string' },
                                    phone: { type: 'string' },
                                    address: { type: 'string' },
                                    city: { type: 'string' },
                                    zip: { type: 'string' },
                                    country: { type: 'string' },
                                    action: { type: 'string', enum: ['create', 'update'] }
                                }
                            }
                        },
                        total: { type: 'number' }
                    }
                }
            }
        }
    }, async (request, reply) => {
        const db = getDatabase();

        // Get all customer events from accounting connector
        const events = await db('accounting_connector_events')
            .whereIn('event_type', ['customer.created', 'customer.updated'])
            .orderBy('created_at', 'desc');

        const customers: any[] = [];
        const processed = new Set<string>();

        for (const event of events) {
            const payload = JSON.parse(event.payload_json);
            const customerData = payload.customer;

            if (!customerData || processed.has(customerData.id)) continue;
            processed.add(customerData.id);

            // Check if customer already exists
            const existingCustomer = await db('crm_customers')
                .where('customer_number', customerData.id)
                .first();

            const customer = {
                customer_number: customerData.id,
                company: customerData.company || '',
                first_name: customerData.first_name || '',
                last_name: customerData.last_name || '',
                email: customerData.email || '',
                phone: customerData.phone || '',
                address: customerData.address?.street || '',
                city: customerData.address?.city || '',
                zip: customerData.address?.zip || '',
                country: customerData.address?.country || 'Deutschland',
                action: existingCustomer ? 'update' : 'create'
            };

            customers.push(customer);
        }

        return { customers, total: customers.length };
    });

    // ══════════════════════════════════════════
    // POST /import/accounting/execute — Execute accounting data import
    // ══════════════════════════════════════════
    fastify.post('/import/accounting/execute', {
        preHandler: [requirePermission('crm.create')],
        schema: {
            description: 'Execute accounting customer data import',
            tags: ['CRM', 'Import'],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        imported: { type: 'number' },
                        updated: { type: 'number' },
                        errors: {
                            type: 'array',
                            items: { type: 'string' }
                        }
                    }
                }
            }
        }
    }, async (request, reply) => {
        const db = getDatabase();

        // Get all customer events from accounting connector
        const events = await db('accounting_connector_events')
            .whereIn('event_type', ['customer.created', 'customer.updated'])
            .orderBy('created_at', 'desc');

        let imported = 0;
        let updated = 0;
        const errors: string[] = [];
        const processed = new Set<string>();

        for (const event of events) {
            try {
                const payload = JSON.parse(event.payload_json);
                const customerData = payload.customer;

                if (!customerData || processed.has(customerData.id)) continue;
                processed.add(customerData.id);

                // Check if customer already exists
                const existingCustomer = await db('crm_customers')
                    .where('customer_number', customerData.id)
                    .first();

                const customerRecord: any = {
                    customer_number: customerData.id,
                    company: customerData.company || '',
                    first_name: customerData.first_name || '',
                    last_name: customerData.last_name || '',
                    email: customerData.email || '',
                    phone: customerData.phone || '',
                    address: customerData.address?.street || '',
                    city: customerData.address?.city || '',
                    zip: customerData.address?.zip || '',
                    country: customerData.address?.country || 'Deutschland',
                    updated_at: new Date()
                };

                if (existingCustomer) {
                    // Update existing customer
                    await db('crm_customers')
                        .where('id', existingCustomer.id)
                        .update(customerRecord);
                    updated++;
                } else {
                    // Create new customer
                    customerRecord.created_at = new Date();
                    await db('crm_customers').insert(customerRecord);
                    imported++;
                }

                // Handle contact person if present
                if (customerData.contact_person) {
                    const contactRecord: any = {
                        customer_id: existingCustomer ? existingCustomer.id : (await db('crm_customers').where('customer_number', customerData.id).first()).id,
                        first_name: customerData.contact_person.first_name || '',
                        last_name: customerData.contact_person.last_name || '',
                        email: customerData.contact_person.email || '',
                        phone: customerData.contact_person.phone || '',
                        position: customerData.contact_person.position || '',
                        is_primary: true,
                        updated_at: new Date()
                    };

                    // Check if contact already exists
                    const existingContact = await db('crm_contacts')
                        .where('customer_id', contactRecord.customer_id)
                        .where('email', contactRecord.email)
                        .first();

                    if (existingContact) {
                        await db('crm_contacts')
                            .where('id', existingContact.id)
                            .update(contactRecord);
                    } else {
                        contactRecord.created_at = new Date();
                        await db('crm_contacts').insert(contactRecord);
                    }
                }

            } catch (error: any) {
                errors.push(`Error processing customer ${event.id}: ${error.message}`);
            }
        }

        return { imported, updated, errors };
    });
}
