import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../context/AuthContext';

interface EntitySearchProps {
    endpoint: string;           // z.B. '/api/auth/search?q='
    labelKey?: string;          // Feld für die Anzeige (default: 'name')
    valueKey?: string;          // Feld für den Wert (default: 'id')
    value?: string | number | null;
    displayValue?: string;
    onChange: (id: string | number | null, item: any) => void;
    placeholder?: string;
    label?: string;
    required?: boolean;
    disabled?: boolean;
    minChars?: number;
}

interface SearchResult {
    [key: string]: any;
}

export default function EntitySearch({
    endpoint,
    labelKey = 'name',
    valueKey = 'id',
    value,
    displayValue,
    onChange,
    placeholder = 'Suchen...',
    label,
    required = false,
    disabled = false,
    minChars = 2,
}: EntitySearchProps) {
    const [query, setQuery] = useState(displayValue || '');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        if (displayValue !== undefined) setQuery(displayValue);
    }, [displayValue]);

    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    const doSearch = async (q: string) => {
        if (q.length < minChars) {
            setResults([]);
            return;
        }
        setLoading(true);
        try {
            const sep = endpoint.includes('?') ? '&' : '?';
            const res = await apiFetch(`${endpoint}${sep}q=${encodeURIComponent(q)}`);
            if (res.ok) {
                const data = await res.json();
                setResults(Array.isArray(data) ? data : data.results || []);
                setIsOpen(true);
            }
        } catch { /* */ }
        setLoading(false);
    };

    const handleInput = (val: string) => {
        setQuery(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => doSearch(val), 300);
    };

    const handleSelect = (item: SearchResult) => {
        setQuery(item[labelKey] || '');
        onChange(item[valueKey], item);
        setIsOpen(false);
    };

    const handleClear = () => {
        setQuery('');
        onChange(null, null);
        setResults([]);
    };

    return (
        <div className="entity-search" ref={wrapperRef}>
            {label && (
                <label className="form-label">
                    {label}
                    {required && <span className="text-danger" style={{ marginLeft: 2 }}>*</span>}
                </label>
            )}
            <div className="entity-search-input-wrapper">
                <input
                    type="text"
                    className="form-input"
                    value={query}
                    onChange={(e) => handleInput(e.target.value)}
                    onFocus={() => query.length >= minChars && results.length > 0 && setIsOpen(true)}
                    placeholder={placeholder}
                    disabled={disabled}
                />
                {value && (
                    <button type="button" className="entity-search-clear" onClick={handleClear}>✕</button>
                )}
                {loading && <span className="entity-search-spinner" />}
            </div>
            {isOpen && results.length > 0 && (
                <ul className="entity-search-dropdown">
                    {results.map((item, i) => (
                        <li key={i} onClick={() => handleSelect(item)} className="entity-search-option">
                            {item[labelKey] || item[valueKey]}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
