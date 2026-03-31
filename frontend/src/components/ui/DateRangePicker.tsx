interface DateRangePickerProps {
    from: string;
    to: string;
    onChange: (from: string, to: string) => void;
    label?: string;
}

const presets: { label: string; getRange: () => [string, string] }[] = [
    {
        label: 'Heute',
        getRange: () => {
            const d = new Date().toISOString().slice(0, 10);
            return [d, d];
        },
    },
    {
        label: 'Diese Woche',
        getRange: () => {
            const now = new Date();
            const day = now.getDay() || 7;
            const mon = new Date(now);
            mon.setDate(now.getDate() - day + 1);
            return [mon.toISOString().slice(0, 10), now.toISOString().slice(0, 10)];
        },
    },
    {
        label: 'Diesen Monat',
        getRange: () => {
            const now = new Date();
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            return [start.toISOString().slice(0, 10), now.toISOString().slice(0, 10)];
        },
    },
    {
        label: 'Letzte 30 Tage',
        getRange: () => {
            const now = new Date();
            const past = new Date(now);
            past.setDate(now.getDate() - 30);
            return [past.toISOString().slice(0, 10), now.toISOString().slice(0, 10)];
        },
    },
    {
        label: 'Dieses Jahr',
        getRange: () => {
            const now = new Date();
            const start = new Date(now.getFullYear(), 0, 1);
            return [start.toISOString().slice(0, 10), now.toISOString().slice(0, 10)];
        },
    },
];

export default function DateRangePicker({ from, to, onChange, label }: DateRangePickerProps) {
    return (
        <div className="date-range-picker">
            {label && <label className="form-label">{label}</label>}
            <div className="date-range-inputs">
                <input
                    type="date"
                    className="form-input"
                    value={from}
                    onChange={(e) => onChange(e.target.value, to)}
                />
                <span className="text-muted" style={{ padding: '0 var(--space-xs)' }}>bis</span>
                <input
                    type="date"
                    className="form-input"
                    value={to}
                    onChange={(e) => onChange(from, e.target.value)}
                />
            </div>
            <div className="date-range-presets">
                {presets.map((preset) => (
                    <button
                        key={preset.label}
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => {
                            const [f, t] = preset.getRange();
                            onChange(f, t);
                        }}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
