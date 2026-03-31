interface StatusBadgeProps {
    status: 'success' | 'warning' | 'error' | 'info' | 'neutral';
    label: string;
    small?: boolean;
}

const statusConfig: Record<string, { className: string; icon: string }> = {
    success: { className: 'badge-success', icon: '✓' },
    warning: { className: 'badge-warning', icon: '⚠' },
    error: { className: 'badge-danger', icon: '✕' },
    info: { className: 'badge-info', icon: 'ℹ' },
    neutral: { className: 'badge-neutral', icon: '●' },
};

export default function StatusBadge({ status, label, small = false }: StatusBadgeProps) {
    const config = statusConfig[status] || statusConfig.neutral;
    return (
        <span className={`badge ${config.className} ${small ? 'badge-sm' : ''}`}>
            <span style={{ marginRight: 4 }}>{config.icon}</span>
            {label}
        </span>
    );
}
