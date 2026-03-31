import { createContext, useContext, useEffect, useRef, useCallback, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

type MessageHandler = (data: any) => void;

interface WebSocketContextType {
    connected: boolean;
    on: (type: string, handler: MessageHandler) => () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function useWebSocket(): WebSocketContextType {
    const ctx = useContext(WebSocketContext);
    if (!ctx) throw new Error('useWebSocket muss innerhalb von WebSocketProvider verwendet werden');
    return ctx;
}

/* ════════════════════════════════════════════
   Provider
   ════════════════════════════════════════════ */

export function WebSocketProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const [connected, setConnected] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);
    const listenersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectDelayRef = useRef(1000);
    const mountedRef = useRef(true);

    // Register a listener for a specific message type
    const on = useCallback((type: string, handler: MessageHandler): (() => void) => {
        let handlers = listenersRef.current.get(type);
        if (!handlers) {
            handlers = new Set();
            listenersRef.current.set(type, handlers);
        }
        handlers.add(handler);

        // Return unsubscribe function
        return () => {
            handlers!.delete(handler);
            if (handlers!.size === 0) {
                listenersRef.current.delete(type);
            }
        };
    }, []);

    // Dispatch incoming message to listeners
    const dispatch = useCallback((type: string, data: any) => {
        const handlers = listenersRef.current.get(type);
        if (handlers) {
            for (const h of handlers) {
                try { h(data); } catch (e) { console.error('[WebSocket] Handler error:', e); }
            }
        }
        // Wildcard listeners
        const wildcardHandlers = listenersRef.current.get('*');
        if (wildcardHandlers) {
            for (const h of wildcardHandlers) {
                try { h({ type, data }); } catch (e) { console.error('[WebSocket] Wildcard handler error:', e); }
            }
        }
    }, []);

    // Connect WebSocket
    useEffect(() => {
        mountedRef.current = true;

        if (!user) {
            // Not logged in — disconnect if connected
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            setConnected(false);
            return;
        }

        function connect() {
            if (!mountedRef.current) return;

            // Get JWT token from cookie or fallback
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/api/ws`;

            // We need a token for WS auth - fetch it
            fetch('/api/auth/ws-token', { credentials: 'include' })
                .then(res => res.ok ? res.json() : Promise.reject('No token'))
                .then(data => {
                    if (!mountedRef.current) return;

                    const ws = new WebSocket(`${wsUrl}?token=${data.token}`);
                    wsRef.current = ws;

                    ws.onopen = () => {
                        if (!mountedRef.current) return;
                        setConnected(true);
                        reconnectDelayRef.current = 1000; // Reset backoff
                    };

                    ws.onmessage = (event) => {
                        try {
                            const msg = JSON.parse(event.data);
                            if (msg.type) {
                                dispatch(msg.type, msg.data);
                            }
                        } catch { /* ignore malformed messages */ }
                    };

                    ws.onclose = () => {
                        if (!mountedRef.current) return;
                        setConnected(false);
                        wsRef.current = null;

                        // Reconnect with exponential backoff (max 30s)
                        const delay = reconnectDelayRef.current;
                        reconnectDelayRef.current = Math.min(delay * 1.5, 30000);
                        reconnectTimeoutRef.current = setTimeout(connect, delay);
                    };

                    ws.onerror = () => {
                        // onclose will fire after onerror
                    };
                })
                .catch(() => {
                    if (!mountedRef.current) return;
                    // Retry after delay
                    const delay = reconnectDelayRef.current;
                    reconnectDelayRef.current = Math.min(delay * 1.5, 30000);
                    reconnectTimeoutRef.current = setTimeout(connect, delay);
                });
        }

        connect();

        return () => {
            mountedRef.current = false;
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [user, dispatch]);

    return (
        <WebSocketContext.Provider value={{ connected, on }}>
            {children}
        </WebSocketContext.Provider>
    );
}
