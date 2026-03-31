import {
    useRef,
    useState,
    useCallback,
    useEffect,
    useMemo,
    type ReactNode,
    type MouseEvent as ReactMouseEvent,
    type TouchEvent as ReactTouchEvent,
} from 'react';
import './TileGrid.css';

/* ════════════════════════════════════════════
   Types
   ════════════════════════════════════════════ */

export interface TileGridItem {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
    visible?: boolean;
}

export type TileSizeClass = 'compact' | 'normal' | 'expanded';

export interface TileGridProps {
    items: TileGridItem[];
    columns?: number;
    rowHeight?: number;
    gap?: number;
    onChange: (items: TileGridItem[]) => void;
    renderTile: (item: TileGridItem, sizeClass: TileSizeClass) => ReactNode;
    /** Context menu content when right-clicking empty space */
    onEmptyContextMenu?: (e: { x: number; y: number }) => void;
}

/* ════════════════════════════════════════════
   Constants
   ════════════════════════════════════════════ */

const DEFAULT_COLUMNS = 48;
const DEFAULT_ROW_HEIGHT = 20;
const DEFAULT_GAP = 16;
const MIN_W = 9;   // ~180px at 20px unit
const MIN_H = 6;   // ~120px at 20px unit
const MOBILE_BREAKPOINT = 768;

/* ════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════ */

function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
}

function snapToGrid(val: number): number {
    return Math.round(val);
}

function getSizeClass(w: number): TileSizeClass {
    if (w < 16) return 'compact';
    if (w < 32) return 'normal';
    return 'expanded';
}

/** Check if two rects overlap */
function rectsOverlap(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Push colliding items down to resolve overlaps */
function resolveCollisions(items: TileGridItem[], movedId: string): TileGridItem[] {
    const result = items.map(item => ({ ...item }));
    const moved = result.find(i => i.id === movedId);
    if (!moved) return result;

    let changed = true;
    let iterations = 0;
    while (changed && iterations < 100) {
        changed = false;
        iterations++;
        for (const item of result) {
            if (item.id === movedId) continue;
            if (item.visible === false) continue;
            if (rectsOverlap(moved, item)) {
                item.y = moved.y + moved.h;
                changed = true;
            }
        }
        // Also resolve cascading collisions
        for (let i = 0; i < result.length; i++) {
            if (result[i].visible === false) continue;
            for (let j = i + 1; j < result.length; j++) {
                if (result[j].visible === false) continue;
                if (result[i].id === result[j].id) continue;
                if (rectsOverlap(result[i], result[j])) {
                    // Push the one that's lower, further down
                    if (result[j].y >= result[i].y) {
                        result[j].y = result[i].y + result[i].h;
                    } else {
                        result[i].y = result[j].y + result[j].h;
                    }
                    changed = true;
                }
            }
        }
    }
    return result;
}

/** Compact items vertically (remove gaps) */
function compactLayout(items: TileGridItem[]): TileGridItem[] {
    const result = items.map(it => ({ ...it }));
    const visible = result.filter(it => it.visible !== false).sort((a, b) => a.y - b.y || a.x - b.x);

    for (const item of visible) {
        let newY = 0;
        // Find the lowest y that doesn't overlap with any other placed item
        while (true) {
            const testRect = { ...item, y: newY };
            const hasOverlap = visible.some(
                other => other.id !== item.id && other.visible !== false && rectsOverlap(testRect, other)
            );
            if (!hasOverlap) break;
            newY++;
            if (newY > 200) break; // Safety
        }
        item.y = newY;
    }
    return result;
}

/* ════════════════════════════════════════════
   Component
   ════════════════════════════════════════════ */

export function TileGrid({
    items,
    columns = DEFAULT_COLUMNS,
    rowHeight = DEFAULT_ROW_HEIGHT,
    gap = DEFAULT_GAP,
    onChange,
    renderTile,
    onEmptyContextMenu,
}: TileGridProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);
    const [isMobile, setIsMobile] = useState(false);

    // Interaction state
    const [dragId, setDragId] = useState<string | null>(null);
    const [resizeId, setResizeId] = useState<string | null>(null);
    const [ghostRect, setGhostRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const interactionRef = useRef<{
        startMouseX: number;
        startMouseY: number;
        startX: number;
        startY: number;
        startW: number;
        startH: number;
        id: string;
        type: 'drag' | 'resize';
    } | null>(null);

    // Measure container
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                const w = entry.contentRect.width;
                setContainerWidth(w);
                setIsMobile(w < MOBILE_BREAKPOINT);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Pixel per grid unit (responsive)
    const unitPx = useMemo(() => {
        if (containerWidth <= 0) return rowHeight;
        return (containerWidth - gap * (columns - 1)) / columns;
    }, [containerWidth, columns, gap, rowHeight]);

    // Grid-units to pixels
    const toPixelX = useCallback((gridUnits: number) => gridUnits * (unitPx + gap) - gap, [unitPx, gap]);
    const toPixelY = useCallback((gridUnits: number) => gridUnits * (rowHeight + gap) - gap, [rowHeight, gap]);
    const toPixelW = useCallback((gridUnits: number) => gridUnits * unitPx + (gridUnits - 1) * gap, [unitPx, gap]);
    const toPixelH = useCallback((gridUnits: number) => gridUnits * rowHeight + (gridUnits - 1) * gap, [rowHeight, gap]);

    // Pixels to grid units
    const toGridX = useCallback((px: number) => snapToGrid(px / (unitPx + gap)), [unitPx, gap]);
    const toGridY = useCallback((px: number) => snapToGrid(px / (rowHeight + gap)), [rowHeight, gap]);
    const toGridW = useCallback((px: number) => Math.max(1, snapToGrid((px + gap) / (unitPx + gap))), [unitPx, gap]);
    const toGridH = useCallback((px: number) => Math.max(1, snapToGrid((px + gap) / (rowHeight + gap))), [rowHeight, gap]);

    // Max Y for container height
    const maxY = useMemo(() => {
        let max = 0;
        for (const item of items) {
            if (item.visible === false) continue;
            max = Math.max(max, item.y + item.h);
        }
        return max;
    }, [items]);

    const containerHeight = useMemo(() => {
        return toPixelY(maxY + 1) + rowHeight + 80; // Extra space at bottom
    }, [maxY, toPixelY, rowHeight]);

    /* ── Mouse/Touch Handlers ── */

    const handleInteractionMove = useCallback((clientX: number, clientY: number) => {
        const info = interactionRef.current;
        if (!info) return;
        const el = containerRef.current;
        if (!el) return;

        const deltaX = clientX - info.startMouseX;
        const deltaY = clientY - info.startMouseY;

        if (info.type === 'drag') {
            const rawX = info.startX * (unitPx + gap) + deltaX;
            const rawY = info.startY * (rowHeight + gap) + deltaY;
            const newX = clamp(toGridX(rawX), 0, columns - 1);
            const newY = Math.max(0, toGridY(rawY));
            // Find item to check bounds
            const item = items.find(i => i.id === info.id);
            const w = item?.w || MIN_W;
            const clampedX = clamp(newX, 0, columns - w);
            setGhostRect({ x: clampedX, y: newY, w, h: item?.h || MIN_H });
        } else {
            // Resize
            const item = items.find(i => i.id === info.id);
            if (!item) return;
            const minW = item.minW || MIN_W;
            const minH = item.minH || MIN_H;
            const maxW = item.maxW || columns - item.x;
            const maxH = item.maxH || 100;

            const rawW = info.startW * unitPx + (info.startW - 1) * gap + deltaX;
            const rawH = info.startH * rowHeight + (info.startH - 1) * gap + deltaY;
            const newW = clamp(toGridW(rawW), minW, Math.min(maxW, columns - item.x));
            const newH = clamp(toGridH(rawH), minH, maxH);
            setGhostRect({ x: item.x, y: item.y, w: newW, h: newH });
        }
    }, [items, columns, unitPx, gap, rowHeight, toGridX, toGridY, toGridW, toGridH]);

    const handleInteractionEnd = useCallback(() => {
        const info = interactionRef.current;
        if (!info || !ghostRect) {
            interactionRef.current = null;
            setDragId(null);
            setResizeId(null);
            setGhostRect(null);
            return;
        }

        let updated = items.map(item => {
            if (item.id !== info.id) return { ...item };
            if (info.type === 'drag') {
                return { ...item, x: ghostRect.x, y: ghostRect.y };
            } else {
                return { ...item, w: ghostRect.w, h: ghostRect.h };
            }
        });

        updated = resolveCollisions(updated, info.id);
        onChange(updated);

        interactionRef.current = null;
        setDragId(null);
        setResizeId(null);
        setGhostRect(null);
    }, [items, ghostRect, onChange]);

    // Global mouse/touch listeners
    useEffect(() => {
        if (!dragId && !resizeId) return;

        const handleMouseMove = (e: globalThis.MouseEvent) => {
            e.preventDefault();
            handleInteractionMove(e.clientX, e.clientY);
        };
        const handleMouseUp = () => handleInteractionEnd();
        const handleTouchMove = (e: globalThis.TouchEvent) => {
            if (e.touches.length !== 1) return;
            e.preventDefault();
            handleInteractionMove(e.touches[0].clientX, e.touches[0].clientY);
        };
        const handleTouchEnd = () => handleInteractionEnd();

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('touchmove', handleTouchMove, { passive: false });
        window.addEventListener('touchend', handleTouchEnd);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
        };
    }, [dragId, resizeId, handleInteractionMove, handleInteractionEnd]);

    /* ── Start Drag ── */
    const startDrag = useCallback((id: string, clientX: number, clientY: number) => {
        if (isMobile) return;
        const item = items.find(i => i.id === id);
        if (!item) return;

        interactionRef.current = {
            startMouseX: clientX,
            startMouseY: clientY,
            startX: item.x,
            startY: item.y,
            startW: item.w,
            startH: item.h,
            id,
            type: 'drag',
        };
        setDragId(id);
        setGhostRect({ x: item.x, y: item.y, w: item.w, h: item.h });
    }, [items, isMobile]);

    /* ── Start Resize ── */
    const startResize = useCallback((id: string, clientX: number, clientY: number) => {
        if (isMobile) return;
        const item = items.find(i => i.id === id);
        if (!item) return;

        interactionRef.current = {
            startMouseX: clientX,
            startMouseY: clientY,
            startX: item.x,
            startY: item.y,
            startW: item.w,
            startH: item.h,
            id,
            type: 'resize',
        };
        setResizeId(id);
        setGhostRect({ x: item.x, y: item.y, w: item.w, h: item.h });
    }, [items, isMobile]);

    /* ── Context Menu on empty area ── */
    const handleContainerContextMenu = useCallback((e: ReactMouseEvent) => {
        // Only trigger if clicking empty space (i.e. the container itself)
        if (e.target !== containerRef.current) return;
        e.preventDefault();
        onEmptyContextMenu?.({ x: e.clientX, y: e.clientY });
    }, [onEmptyContextMenu]);

    /* ── Render ── */
    const visibleItems = useMemo(() => items.filter(it => it.visible !== false), [items]);

    if (isMobile) {
        return (
            <div className="tile-grid tile-grid--mobile" ref={containerRef}>
                {visibleItems.map(item => (
                    <div key={item.id} className="tile-grid-item tile-grid-item--mobile">
                        <div className="tile-grid-item-content">
                            {renderTile(item, 'normal')}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="tile-grid"
            style={{ height: containerHeight }}
            onContextMenu={handleContainerContextMenu}
        >
            {visibleItems.map(item => {
                const isDragging = dragId === item.id;
                const isResizing = resizeId === item.id;
                const isActive = isDragging || isResizing;

                const displayRect = isActive && ghostRect ? ghostRect : item;
                const left = displayRect.x * (unitPx + gap);
                const top = displayRect.y * (rowHeight + gap);
                const width = toPixelW(displayRect.w);
                const height = toPixelH(displayRect.h);

                return (
                    <div
                        key={item.id}
                        className={`tile-grid-item ${isDragging ? 'tile-grid-item--dragging' : ''} ${isResizing ? 'tile-grid-item--resizing' : ''}`}
                        style={{
                            left,
                            top,
                            width,
                            height,
                            transition: isActive ? 'none' : undefined,
                            zIndex: isActive ? 1000 : 1,
                        }}
                    >
                        {/* Drag Zone (Header) */}
                        <div
                            className="tile-grid-drag-zone"
                            onMouseDown={(e) => {
                                if (e.button !== 0) return;
                                e.preventDefault();
                                startDrag(item.id, e.clientX, e.clientY);
                            }}
                            onTouchStart={(e: ReactTouchEvent) => {
                                if (e.touches.length !== 1) return;
                                startDrag(item.id, e.touches[0].clientX, e.touches[0].clientY);
                            }}
                        />

                        {/* Tile Content */}
                        <div className="tile-grid-item-content">
                            {renderTile(item, getSizeClass(displayRect.w))}
                        </div>

                        {/* Resize Handle */}
                        <div
                            className="tile-grid-resize-handle"
                            onMouseDown={(e) => {
                                if (e.button !== 0) return;
                                e.preventDefault();
                                e.stopPropagation();
                                startResize(item.id, e.clientX, e.clientY);
                            }}
                            onTouchStart={(e: ReactTouchEvent) => {
                                if (e.touches.length !== 1) return;
                                e.stopPropagation();
                                startResize(item.id, e.touches[0].clientX, e.touches[0].clientY);
                            }}
                        >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <line x1="9" y1="1" x2="1" y2="9" />
                                <line x1="9" y1="5" x2="5" y2="9" />
                            </svg>
                        </div>
                    </div>
                );
            })}

            {/* Ghost Placeholder */}
            {ghostRect && (dragId || resizeId) && (
                <div
                    className="tile-grid-placeholder"
                    style={{
                        left: ghostRect.x * (unitPx + gap),
                        top: ghostRect.y * (rowHeight + gap),
                        width: toPixelW(ghostRect.w),
                        height: toPixelH(ghostRect.h),
                    }}
                />
            )}
        </div>
    );
}
