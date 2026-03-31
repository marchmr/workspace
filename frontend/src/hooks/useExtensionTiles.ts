import { useMemo } from 'react';
import { pluginRegistry, type PluginExtensionTile } from '../pluginRegistry';
import { useAuth } from '../context/AuthContext';

export interface ResolvedExtensionTile extends PluginExtensionTile {
    /** Eindeutiger Schlüssel: ext.<pluginId>.<tileId> */
    key: string;
    /** ID des Plugins, das diese Kachel bereitstellt */
    sourcePluginId: string;
}

/**
 * Hook zum Abrufen aller Extension Tiles für einen bestimmten Slot.
 *
 * Beispiel: Im Kunden-Detail-Page:
 *   const tiles = useExtensionTiles('kunden.detail');
 *
 * Gibt nur Kacheln zurück, für die der aktuelle Benutzer die nötige Permission hat.
 * Sortiert nach `order` (aufsteigend).
 */
export function useExtensionTiles(targetSlot: string): ResolvedExtensionTile[] {
    const { user } = useAuth();

    return useMemo(() => {
        return pluginRegistry
            .flatMap((entry) =>
                (entry.extensionTiles || []).map((tile) => ({
                    ...tile,
                    key: `ext.${entry.id}.${tile.id}`,
                    sourcePluginId: entry.id,
                }))
            )
            .filter((tile) => tile.targetSlot === targetSlot)
            .filter((tile) => {
                if (!tile.permission) return true;
                if (!user) return false;
                return user.permissions.includes('*') || user.permissions.includes(tile.permission);
            })
            .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    }, [targetSlot, user]);
}
