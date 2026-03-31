interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    maxVisible?: number;
}

export default function Pagination({
    currentPage,
    totalPages,
    onPageChange,
    maxVisible = 5,
}: PaginationProps) {
    if (totalPages <= 1) return null;

    const pages: (number | '...')[] = [];
    const half = Math.floor(maxVisible / 2);
    let start = Math.max(1, currentPage - half);
    let end = Math.min(totalPages, start + maxVisible - 1);

    if (end - start < maxVisible - 1) {
        start = Math.max(1, end - maxVisible + 1);
    }

    if (start > 1) {
        pages.push(1);
        if (start > 2) pages.push('...');
    }

    for (let i = start; i <= end; i++) pages.push(i);

    if (end < totalPages) {
        if (end < totalPages - 1) pages.push('...');
        pages.push(totalPages);
    }

    return (
        <nav className="pagination" role="navigation" aria-label="Seitennavigation">
            <button
                className="pagination-btn"
                disabled={currentPage <= 1}
                onClick={() => onPageChange(currentPage - 1)}
                aria-label="Vorherige Seite"
            >
                ‹
            </button>

            {pages.map((p, i) =>
                p === '...' ? (
                    <span key={`ellipsis-${i}`} className="pagination-ellipsis">…</span>
                ) : (
                    <button
                        key={p}
                        className={`pagination-btn ${p === currentPage ? 'pagination-active' : ''}`}
                        onClick={() => onPageChange(p)}
                        aria-current={p === currentPage ? 'page' : undefined}
                    >
                        {p}
                    </button>
                )
            )}

            <button
                className="pagination-btn"
                disabled={currentPage >= totalPages}
                onClick={() => onPageChange(currentPage + 1)}
                aria-label="Nächste Seite"
            >
                ›
            </button>
        </nav>
    );
}
