import { useState, useMemo, ReactNode } from 'react';
import { useEntityLocks } from '../../hooks/useEntityLock';
import { LockIndicator } from './LockIndicator';

export interface DataTableColumn<T = any> {
    key: string;
    label: string;
    sortable?: boolean;
    render?: (value: any, row: T) => ReactNode;
    width?: string;
}

interface DataTableProps<T = any> {
    columns: DataTableColumn<T>[];
    data: T[];
    loading?: boolean;
    searchable?: boolean;
    searchPlaceholder?: string;
    pageSize?: number;
    emptyMessage?: string;
    onRowClick?: (row: T) => void;
    actions?: ReactNode;
    lockEntityType?: string;
    lockEntityIdKey?: string;
}

export default function DataTable<T extends Record<string, any>>({
    columns,
    data,
    loading = false,
    searchable = true,
    searchPlaceholder = 'Suchen...',
    pageSize = 20,
    emptyMessage = 'Keine Einträge vorhanden',
    onRowClick,
    actions,
    lockEntityType,
    lockEntityIdKey = 'id',
}: DataTableProps<T>) {
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
    const [page, setPage] = useState(1);

    // Lock integration
    const entityIds = useMemo(() => {
        if (!lockEntityType) return [];
        return data.map(row => String(row[lockEntityIdKey] || '')).filter(Boolean);
    }, [data, lockEntityType, lockEntityIdKey]);
    const { locks } = useEntityLocks(lockEntityType || '', entityIds);

    const filtered = useMemo(() => {
        if (!search.trim()) return data;
        const q = search.toLowerCase();
        return data.filter((row) =>
            columns.some((col) => {
                const val = row[col.key];
                return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
            }),
        );
    }, [data, search, columns]);

    const sorted = useMemo(() => {
        if (!sortKey) return filtered;
        return [...filtered].sort((a, b) => {
            const va = a[sortKey] ?? '';
            const vb = b[sortKey] ?? '';
            const cmp = String(va).localeCompare(String(vb), 'de', { numeric: true });
            return sortDir === 'asc' ? cmp : -cmp;
        });
    }, [filtered, sortKey, sortDir]);

    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const pageData = sorted.slice((page - 1) * pageSize, page * pageSize);

    const handleSort = (key: string) => {
        if (sortKey === key) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir('asc');
        }
        setPage(1);
    };

    const handleSearch = (value: string) => {
        setSearch(value);
        setPage(1);
    };

    return (
        <div className="data-table-wrapper">
            {(searchable || actions) && (
                <div className="data-table-toolbar">
                    {searchable && (
                        <input
                            type="text"
                            className="form-input data-table-search"
                            placeholder={searchPlaceholder}
                            value={search}
                            onChange={(e) => handleSearch(e.target.value)}
                        />
                    )}
                    {actions && <div className="data-table-actions">{actions}</div>}
                </div>
            )}

            <div className="table-container">
                <table className="data-table">
                    <thead>
                        <tr>
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    style={{ width: col.width }}
                                    className={col.sortable !== false ? 'sortable' : ''}
                                    onClick={() => col.sortable !== false && handleSort(col.key)}
                                >
                                    {col.label}
                                    {sortKey === col.key && (
                                        <span className="sort-indicator">
                                            {sortDir === 'asc' ? ' ▲' : ' ▼'}
                                        </span>
                                    )}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={columns.length} className="text-center text-muted" style={{ padding: 'var(--space-xl)' }}>
                                    Laden...
                                </td>
                            </tr>
                        ) : pageData.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} className="text-center text-muted" style={{ padding: 'var(--space-xl)' }}>
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            pageData.map((row, i) => {
                                const rowId = lockEntityType ? String(row[lockEntityIdKey] || '') : '';
                                const rowLock = lockEntityType ? locks.get(rowId) : undefined;
                                return (
                                <tr
                                    key={i}
                                    onClick={() => onRowClick?.(row)}
                                    className={`${onRowClick ? 'clickable' : ''} ${rowLock ? 'lock-row' : ''}`}
                                >
                                    {columns.map((col, ci) => (
                                        <td key={col.key}>
                                            {ci === 0 && rowLock && (
                                                <span style={{ marginRight: 6, verticalAlign: 'middle', display: 'inline-flex' }}>
                                                    <LockIndicator lock={rowLock} />
                                                </span>
                                            )}
                                            {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '–')}
                                        </td>
                                    ))}
                                </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {totalPages > 1 && (
                <div className="data-table-pagination">
                    <span className="text-muted" style={{ fontSize: 'var(--font-size-sm)' }}>
                        {sorted.length} Einträge · Seite {page} von {totalPages}
                    </span>
                    <div className="pagination-buttons">
                        <button
                            className="btn btn-sm"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => p - 1)}
                        >
                            ‹ Zurück
                        </button>
                        <button
                            className="btn btn-sm"
                            disabled={page >= totalPages}
                            onClick={() => setPage((p) => p + 1)}
                        >
                            Weiter ›
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
