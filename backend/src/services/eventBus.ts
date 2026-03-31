import { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

type EventHandler = (payload: any, meta: EventMeta) => void | Promise<void>;

interface EventMeta {
    event: string;
    timestamp: string;
    userId?: number | null;
    tenantId?: number | null;
    pluginId?: string;
}

interface EventBusOptions {
    event: string;
    data?: Record<string, any>;
    userId?: number | null;
    tenantId?: number | null;
    pluginId?: string;
    request?: FastifyRequest;
}

class EventBus {
    private listeners = new Map<string, Set<EventHandler>>();
    private wildcardListeners = new Set<EventHandler>();

    on(event: string, handler: EventHandler): void {
        if (event === '*') {
            this.wildcardListeners.add(handler);
            return;
        }
        let handlers = this.listeners.get(event);
        if (!handlers) {
            handlers = new Set();
            this.listeners.set(event, handlers);
        }
        handlers.add(handler);
    }

    off(event: string, handler: EventHandler): void {
        if (event === '*') {
            this.wildcardListeners.delete(handler);
            return;
        }
        this.listeners.get(event)?.delete(handler);
    }

    async emit(options: EventBusOptions): Promise<void> {
        const meta: EventMeta = {
            event: options.event,
            timestamp: new Date().toISOString(),
            userId: options.userId ?? options.request?.user?.userId ?? null,
            tenantId: options.tenantId ?? options.request?.user?.tenantId ?? null,
            pluginId: options.pluginId,
        };

        const payload = options.data || {};
        const handlers = this.listeners.get(options.event);

        // Specific listeners
        if (handlers) {
            for (const handler of handlers) {
                try {
                    await handler(payload, meta);
                } catch (error) {
                    console.error(`[EventBus] Handler-Fehler bei '${options.event}':`, error);
                }
            }
        }

        // Wildcard listeners (e.g. webhook service)
        for (const handler of this.wildcardListeners) {
            try {
                await handler(payload, meta);
            } catch (error) {
                console.error(`[EventBus] Wildcard-Handler-Fehler bei '${options.event}':`, error);
            }
        }
    }

    listenerCount(event?: string): number {
        if (event) {
            return (this.listeners.get(event)?.size || 0);
        }
        let total = this.wildcardListeners.size;
        for (const set of this.listeners.values()) {
            total += set.size;
        }
        return total;
    }
}

declare module 'fastify' {
    interface FastifyInstance {
        events: EventBus;
    }
}

async function eventBusPlugin(fastify: FastifyInstance): Promise<void> {
    const bus = new EventBus();
    fastify.decorate('events', bus);
    console.log('[EventBus] Plugin-Event-Bus initialisiert');
}

export { EventBus, EventMeta, EventBusOptions, EventHandler };
export default fp(eventBusPlugin, { name: 'eventBus' });
