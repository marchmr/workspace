/**
 * Request-Validation mit Zod
 *
 * Bietet preHandler-Hooks fuer automatische Body/Query/Params-Validierung.
 * Bei Fehlern: 422 mit strukturiertem Fehlerformat.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { z, ZodSchema, ZodError } from 'zod';

/**
 * PreHandler der den Request-Body gegen ein Zod-Schema validiert.
 * Bei Erfolg: Validierte Daten auf `request.validated` speichern.
 * Bei Fehler: 422 mit feldspezifischen Fehlermeldungen.
 *
 * Nutzung:
 * ```ts
 * const schema = z.object({ name: z.string().min(1) });
 * fastify.post('/items', { preHandler: [validateBody(schema)] }, handler);
 * // In handler: const data = (request as any).validated;
 * ```
 */
export function validateBody<T>(schema: ZodSchema<T>) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const result = schema.safeParse(request.body);
        if (!result.success) {
            return reply.status(422).send(formatZodError(result.error));
        }
        (request as any).validated = result.data;
    };
}

/**
 * PreHandler der die Query-Parameter gegen ein Zod-Schema validiert.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const result = schema.safeParse(request.query);
        if (!result.success) {
            return reply.status(422).send(formatZodError(result.error));
        }
        (request as any).validatedQuery = result.data;
    };
}

/**
 * PreHandler der die URL-Parameter gegen ein Zod-Schema validiert.
 */
export function validateParams<T>(schema: ZodSchema<T>) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const result = schema.safeParse(request.params);
        if (!result.success) {
            return reply.status(422).send(formatZodError(result.error));
        }
        (request as any).validatedParams = result.data;
    };
}

/**
 * Zod-Fehler in ein benutzerfreundliches Format umwandeln.
 */
function formatZodError(error: ZodError): { error: string; details: Record<string, string[]> } {
    return {
        error: 'Validierungsfehler',
        details: error.flatten().fieldErrors as Record<string, string[]>,
    };
}

// Re-export Zod fuer bequemere Nutzung in Plugins
export { z } from 'zod';
