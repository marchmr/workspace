/**
 * PDF-Export
 *
 * Leichtgewichtiger HTML→PDF Generator via pdfmake.
 * Kein Puppeteer/Chrome noetig – laeuft komplett in Node.js.
 *
 * Nutzung:
 * ```ts
 * const buffer = await fastify.pdf.generate({
 *   title: 'Rechnung',
 *   content: [
 *     { text: 'Rechnung #42', style: 'header' },
 *     { table: { body: [['Pos', 'Betrag'], ['1', '500€']] } }
 *   ],
 * });
 * ```
 */

import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

interface PdfMakeApi {
    setFonts?: (fonts: PdfFonts) => void;
    addFonts?: (fonts: PdfFonts) => void;
    createPdf: (docDefinition: Record<string, any>, options?: Record<string, any>) => {
        getBuffer: () => Promise<Buffer>;
    };
}

interface PdfFonts {
    [fontName: string]: {
        normal: string;
        bold: string;
        italics: string;
        bolditalics: string;
    };
}

const pdfmake = require('pdfmake') as PdfMakeApi;
const fonts: PdfFonts = {
    Roboto: {
        normal: require.resolve('pdfmake/fonts/Roboto/Roboto-Regular.ttf'),
        bold: require.resolve('pdfmake/fonts/Roboto/Roboto-Medium.ttf'),
        italics: require.resolve('pdfmake/fonts/Roboto/Roboto-Italic.ttf'),
        bolditalics: require.resolve('pdfmake/fonts/Roboto/Roboto-MediumItalic.ttf'),
    },
};

interface PdfOptions {
    /** Titel des Dokuments */
    title?: string;
    /** pdfmake Content-Array */
    content: any[];
    /** Footer-Text */
    footer?: string;
    /** Seitenformat (Default: A4) */
    pageSize?: 'A4' | 'A3' | 'LETTER';
    /** Ausrichtung */
    pageOrientation?: 'portrait' | 'landscape';
    /** Eigene Styles */
    styles?: Record<string, any>;
}

async function pdfExportPlugin(fastify: FastifyInstance): Promise<void> {
    if (typeof pdfmake.setFonts === 'function') {
        pdfmake.setFonts(fonts);
    } else if (typeof pdfmake.addFonts === 'function') {
        pdfmake.addFonts(fonts);
    }

    const generate = async (opts: PdfOptions): Promise<Buffer> => {
        const defaultStyles: Record<string, any> = {
            header: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
            subheader: { fontSize: 14, bold: true, margin: [0, 10, 0, 5] },
            tableHeader: { bold: true, fontSize: 11, color: '#333' },
            small: { fontSize: 8, color: '#666' },
        };

        const docDefinition: Record<string, any> = {
            content: opts.content,
            pageSize: opts.pageSize || 'A4',
            pageOrientation: opts.pageOrientation || 'portrait',
            styles: { ...defaultStyles, ...(opts.styles || {}) },
            defaultStyle: { font: 'Roboto', fontSize: 10 },
            info: {
                title: opts.title || 'Dokument',
                producer: 'MIKE WorkSpace',
            },
        };

        if (opts.footer) {
            docDefinition.footer = (currentPage: number, pageCount: number) => ({
                columns: [
                    { text: opts.footer, alignment: 'left', fontSize: 8, color: '#999', margin: [40, 0] },
                    { text: `Seite ${currentPage} von ${pageCount}`, alignment: 'right', fontSize: 8, color: '#999', margin: [0, 0, 40, 0] },
                ],
            });
        }

        const output = pdfmake.createPdf(docDefinition);
        return output.getBuffer();
    };

    fastify.decorate('pdf', {
        generate,

        /**
         * Generiert eine einfache Tabelle als PDF
         */
        async generateTable(opts: {
            title: string;
            headers: string[];
            rows: string[][];
            footer?: string;
        }): Promise<Buffer> {
            const tableBody = [
                opts.headers.map(h => ({ text: h, style: 'tableHeader' })),
                ...opts.rows,
            ];

            return generate({
                title: opts.title,
                content: [
                    { text: opts.title, style: 'header' },
                    {
                        table: {
                            headerRows: 1,
                            widths: opts.headers.map(() => '*'),
                            body: tableBody,
                        },
                        layout: 'lightHorizontalLines',
                    },
                ],
                footer: opts.footer || 'MIKE WorkSpace',
            });
        },
    });

    console.log('[PdfExport] Initialisiert');
}

// Type Declaration
declare module 'fastify' {
    interface FastifyInstance {
        pdf: {
            generate: (opts: PdfOptions) => Promise<Buffer>;
            generateTable: (opts: {
                title: string;
                headers: string[];
                rows: string[][];
                footer?: string;
            }) => Promise<Buffer>;
        };
    }
}

export default fp(pdfExportPlugin, { name: 'pdfExport' });
