import '@fastify/jwt';

// Erweitert den JWT-Payload-Typ von @fastify/jwt
// damit request.user die richtigen Felder hat
declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: {
            userId: number;
            username: string;
            permissions: string[];
            tenantId: number;
            tenantIds: number[];
            sessionId: number;
        };
        user: {
            userId: number;
            username: string;
            permissions: string[];
            tenantId: number;
            tenantIds: number[];
            sessionId: number;
        };
    }
}

declare module 'fastify' {
    interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        db: import('knex').Knex;
        audit: {
            log: (entry: {
                action: string;
                category: 'auth' | 'data' | 'admin' | 'plugin';
                entityType?: string;
                entityId?: string | number;
                previousState?: any;
                newState?: any;
                pluginId?: string;
            }, request?: FastifyRequest) => Promise<void>;
        };
        requirePermission: (permission: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        getTenantId: (request: FastifyRequest) => number | null;
        scopedQuery: <T extends import('knex').Knex.QueryBuilder>(query: T, request: FastifyRequest, column?: string) => T;
        scopedInsert: (data: Record<string, any>, request: FastifyRequest, column?: string) => Record<string, any>;
        requireTenantId: (request: FastifyRequest) => number;
        isSuperAdmin: (request: FastifyRequest) => boolean;
        encrypt: (plainText: string) => string;
        decrypt: (encryptedPayload: string) => string;
        validation: {
            z: typeof import('zod').z;
            validateBody: <T>(schema: import('zod').ZodSchema<T>) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
            validateQuery: <T>(schema: import('zod').ZodSchema<T>) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
            validateParams: <T>(schema: import('zod').ZodSchema<T>) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        };
        createCrudRoutes: (opts: import('../core/crudGenerator.js').CrudOptions) => void;
        scheduler: {
            register: (opts: {
                id: string;
                name: string;
                cron: string;
                handler: () => Promise<void> | void;
                pluginId?: string;
            }) => Promise<void>;
            unregister: (taskId: string) => Promise<void>;
            stopAll: () => void;
        };
        mail: {
            send: (opts: {
                to: string | string[];
                subject: string;
                text?: string;
                html?: string;
                template?: string;
                data?: Record<string, any>;
                accountId?: number;
            }) => Promise<void>;
            isConfigured: () => Promise<boolean>;
            getAccount: (id: number) => Promise<any>;
            getDefaultAccount: () => Promise<any>;
        };
    }
}
