import { ReactNode } from 'react';

interface FormFieldProps {
    label: string;
    name?: string;
    type?: 'text' | 'email' | 'password' | 'number' | 'textarea' | 'select';
    value?: string | number;
    onChange?: (value: string) => void;
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    error?: string;
    hint?: string;
    options?: { value: string; label: string }[];
    rows?: number;
    children?: ReactNode;
}

export default function FormField({
    label,
    name,
    type = 'text',
    value,
    onChange,
    placeholder,
    required = false,
    disabled = false,
    error,
    hint,
    options,
    rows = 3,
    children,
}: FormFieldProps) {
    const inputId = name || label.toLowerCase().replace(/\s+/g, '-');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        onChange?.(e.target.value);
    };

    return (
        <div className={`form-group ${error ? 'has-error' : ''}`}>
            <label className="form-label" htmlFor={inputId}>
                {label}
                {required && <span className="text-danger" style={{ marginLeft: 2 }}>*</span>}
            </label>
            {children ? (
                children
            ) : type === 'textarea' ? (
                <textarea
                    id={inputId}
                    name={inputId}
                    className="form-input"
                    value={value ?? ''}
                    onChange={handleChange}
                    placeholder={placeholder}
                    required={required}
                    disabled={disabled}
                    rows={rows}
                />
            ) : type === 'select' ? (
                <select
                    id={inputId}
                    name={inputId}
                    className="form-input"
                    value={value ?? ''}
                    onChange={handleChange}
                    required={required}
                    disabled={disabled}
                >
                    {options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            ) : (
                <input
                    id={inputId}
                    name={inputId}
                    type={type}
                    className="form-input"
                    value={value ?? ''}
                    onChange={handleChange}
                    placeholder={placeholder}
                    required={required}
                    disabled={disabled}
                />
            )}
            {error && <p className="form-error">{error}</p>}
            {hint && !error && <p className="form-hint">{hint}</p>}
        </div>
    );
}
