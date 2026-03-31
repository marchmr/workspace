import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, useAuth } from '../context/AuthContext';
import { useWebSocket } from '../context/WebSocketContext';

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

export interface LockInfo {
    userId: number;
    username: string;
    displayName: string;
    acquiredAt: string;
    lastHeartbeat: string;
}

/* ════════════════════════════════════════════
   useEntityLock — Fuer Detail-Ansichten
   ════════════════════════════════════════════ */

const HEARTBEAT_INTERVAL_MS = 20_000;

export function useEntityLock(entityType: string, entityId: string | null) {
    const { user } = useAuth();
    const { on } = useWebSocket();
    const [lockedBy, setLockedBy] = useState<LockInfo | null>(null);
    const [isOwnLock, setIsOwnLock] = useState(false);
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const entityRef = useRef({ entityType, entityId });
    entityRef.current = { entityType, entityId };

    // Initial lock status abfragen
    useEffect(() => {
        if (!entityId) return;

        const checkLock = async () => {
            try {
                const res = await apiFetch(`/api/locks/query?entityType=${encodeURIComponent(entityType)}&entityIds=${encodeURIComponent(entityId)}`);
                if (res.ok) {
                    const data = await res.json();
                    const lock = data.locks?.[entityId];
                    if (lock) {
                        setLockedBy(lock);
                        setIsOwnLock(lock.userId === user?.id);
                    } else {
                        setLockedBy(null);
                        setIsOwnLock(false);
                    }
                }
            } catch { /* ignore */ }
        };

        checkLock();
    }, [entityType, entityId, user?.id]);

    // WebSocket listener fuer Lock-Events
    useEffect(() => {
        const unsub1 = on('lock.acquired', (data: any) => {
            if (data.entityType === entityType && data.entityId === entityId) {
                setLockedBy({
                    userId: data.userId,
                    username: data.username,
                    displayName: data.displayName,
                    acquiredAt: new Date().toISOString(),
                    lastHeartbeat: new Date().toISOString(),
                });
                setIsOwnLock(data.userId === user?.id);
            }
        });

        const unsub2 = on('lock.released', (data: any) => {
            if (data.entityType === entityType && data.entityId === entityId) {
                setLockedBy(null);
                setIsOwnLock(false);
            }
        });

        const unsub3 = on('lock.expired', (data: any) => {
            if (data.entityType === entityType && data.entityId === entityId) {
                setLockedBy(null);
                setIsOwnLock(false);
            }
        });

        return () => { unsub1(); unsub2(); unsub3(); };
    }, [on, entityType, entityId, user?.id]);

    // Acquire lock
    const acquire = useCallback(async (): Promise<boolean> => {
        if (!entityId) return false;
        try {
            const res = await apiFetch('/api/locks/acquire', {
                method: 'POST',
                body: JSON.stringify({ entityType, entityId }),
            });
            const data = await res.json();

            if (data.acquired) {
                setIsOwnLock(true);
                // Start heartbeat
                if (heartbeatRef.current) clearInterval(heartbeatRef.current);
                heartbeatRef.current = setInterval(async () => {
                    try {
                        await apiFetch('/api/locks/heartbeat', {
                            method: 'POST',
                            body: JSON.stringify({
                                entityType: entityRef.current.entityType,
                                entityId: entityRef.current.entityId,
                            }),
                        });
                    } catch { /* ignore */ }
                }, HEARTBEAT_INTERVAL_MS);
                return true;
            } else {
                if (data.lockedBy) {
                    setLockedBy(data.lockedBy);
                    setIsOwnLock(false);
                }
                return false;
            }
        } catch {
            return false;
        }
    }, [entityType, entityId]);

    // Release lock
    const doRelease = useCallback(async () => {
        if (!entityId) return;

        // Stop heartbeat
        if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
        }

        try {
            await apiFetch('/api/locks/release', {
                method: 'POST',
                body: JSON.stringify({ entityType, entityId }),
            });
        } catch { /* ignore */ }

        setIsOwnLock(false);
    }, [entityType, entityId]);

    // Request access (sendet Notification an Lock-Holder)
    const requestAccess = useCallback(async () => {
        if (!entityId) return;
        try {
            await apiFetch('/api/locks/request-access', {
                method: 'POST',
                body: JSON.stringify({ entityType, entityId }),
            });
        } catch { /* ignore */ }
    }, [entityType, entityId]);

    // Cleanup: Release on unmount + beforeunload
    useEffect(() => {
        const handleBeforeUnload = () => {
            if (entityRef.current.entityId && heartbeatRef.current) {
                // sendBeacon fuer zuverlaessiges Release bei Tab-Close
                const payload = JSON.stringify({
                    entityType: entityRef.current.entityType,
                    entityId: entityRef.current.entityId,
                });
                navigator.sendBeacon('/api/locks/release', new Blob([payload], { type: 'application/json' }));
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current);
                heartbeatRef.current = null;
            }
        };
    }, []);

    const isLocked = !!lockedBy && !isOwnLock;

    return {
        isLocked,
        lockedBy,
        isOwnLock,
        acquire,
        release: doRelease,
        requestAccess,
    };
}

/* ════════════════════════════════════════════
   useEntityLocks — Fuer Listenansichten (Bulk)
   ════════════════════════════════════════════ */

export function useEntityLocks(entityType: string, entityIds: string[]) {
    const { on } = useWebSocket();
    const [locksMap, setLocksMap] = useState<Map<string, LockInfo>>(new Map());

    // Bulk query
    const refresh = useCallback(async () => {
        if (!entityType || entityIds.length === 0) {
            setLocksMap(new Map());
            return;
        }

        try {
            const res = await apiFetch(`/api/locks/query?entityType=${encodeURIComponent(entityType)}&entityIds=${encodeURIComponent(entityIds.join(','))}`);
            if (res.ok) {
                const data = await res.json();
                const map = new Map<string, LockInfo>();
                for (const [id, lock] of Object.entries(data.locks || {})) {
                    map.set(id, lock as LockInfo);
                }
                setLocksMap(map);
            }
        } catch { /* ignore */ }
    }, [entityType, entityIds.join(',')]);

    // Fetch on mount / when IDs change
    useEffect(() => {
        refresh();
    }, [refresh]);

    // WebSocket live updates
    useEffect(() => {
        const unsub1 = on('lock.acquired', (data: any) => {
            if (data.entityType !== entityType) return;
            setLocksMap(prev => {
                const next = new Map(prev);
                next.set(data.entityId, {
                    userId: data.userId,
                    username: data.username,
                    displayName: data.displayName,
                    acquiredAt: new Date().toISOString(),
                    lastHeartbeat: new Date().toISOString(),
                });
                return next;
            });
        });

        const handleRelease = (data: any) => {
            if (data.entityType !== entityType) return;
            setLocksMap(prev => {
                const next = new Map(prev);
                next.delete(data.entityId);
                return next;
            });
        };

        const unsub2 = on('lock.released', handleRelease);
        const unsub3 = on('lock.expired', handleRelease);

        return () => { unsub1(); unsub2(); unsub3(); };
    }, [on, entityType]);

    return {
        locks: locksMap,
        refresh,
    };
}
