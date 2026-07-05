import React, { useEffect, useRef, useState } from 'react';

/**
 * Dark-themed dropdown that renders identically on web and inside the Android
 * (Capacitor) WebView. Native <select> popups on Android ignore the option
 * background-color but inherit the control's text color, so a dark-themed
 * select renders as unreadable white-on-white. This component draws its own
 * option list instead of delegating to the platform picker.
 */

export interface CustomSelectOption {
    value: string;
    label: React.ReactNode;
}

interface CustomSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: CustomSelectOption[];
    placeholder?: string;
    id?: string;
    ariaLabel?: string;
    /** Trigger button classes. Overrides the default so each context can match its surroundings. */
    triggerClassName?: string;
}

const DEFAULT_TRIGGER =
    'w-full h-12 bg-black/40 border border-white/10 rounded-xl px-4 text-sm font-semibold text-white outline-none focus:border-brand-cyan';

const CustomSelect: React.FC<CustomSelectProps> = ({
    value,
    onChange,
    options,
    placeholder,
    id,
    ariaLabel,
    triggerClassName,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selected = options.find(o => o.value === value);

    useEffect(() => {
        if (!isOpen) return;
        const handlePointerDown = (e: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
            document.removeEventListener('keydown', handleKey);
        };
    }, [isOpen]);

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                id={id}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                onClick={() => setIsOpen(o => !o)}
                className={`${triggerClassName ?? DEFAULT_TRIGGER} flex items-center justify-between text-left`}
            >
                <span className={selected ? '' : 'text-slate-500'}>
                    {selected ? selected.label : (placeholder ?? '')}
                </span>
                <i
                    className={`fa-solid fa-chevron-down text-slate-500 text-xs ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                ></i>
            </button>

            {isOpen && (
                <ul
                    role="listbox"
                    className="absolute left-0 right-0 top-full mt-2 z-50 max-h-60 overflow-y-auto bg-brand-darker border border-white/10 rounded-xl shadow-2xl py-1"
                >
                    {options.map(option => {
                        const isSelected = option.value === value;
                        return (
                            <li key={option.value} role="option" aria-selected={isSelected}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onChange(option.value);
                                        setIsOpen(false);
                                    }}
                                    className={`w-full text-left px-4 py-3 text-sm font-semibold transition-colors ${
                                        isSelected
                                            ? 'text-brand-cyan bg-white/5'
                                            : 'text-white hover:bg-white/5'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};

export default CustomSelect;
