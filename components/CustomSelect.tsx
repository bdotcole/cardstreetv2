import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Dropdown that renders identically on web and inside the Capacitor WebView,
 * because it draws its own option list instead of delegating to the platform
 * picker.
 *
 * Why not a native <select>: an <option> does not reliably inherit the
 * control's color, and the popup CHROME follows the device's resolved color
 * scheme rather than the app's. In LIGHT theme our `text-white` remaps to
 * near-black, so on a dark-OS phone the rows rendered near-black on a dark
 * sheet — measured at 1.09:1, i.e. invisible. Dark theme hid the bug (white
 * text reads fine there), which is why it only ever reproduced for some users.
 * iOS ignores option styling outright and draws its own picker. There is no
 * CSS that fixes every combination, so anything user-facing uses this instead;
 * app/globals.css keeps a best-effort `option` rule for the remaining raw
 * selects (admin screens, desktop tables).
 *
 * The list is PORTALLED to document.body and positioned fixed against the
 * trigger's rect. Rendered in place it was clipped by any `overflow-y-auto`
 * ancestor — both checkout address forms are exactly that — and any
 * backdrop-filter/transform ancestor would re-anchor it besides. It flips
 * above the trigger when there is more room there, and closes if the trigger
 * scrolls out of view.
 */

export interface CustomSelectOption {
    value: string;
    label: React.ReactNode;
    /** Renders greyed and unselectable — e.g. a placeholder, or a stored value the dataset no longer knows. */
    disabled?: boolean;
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
    /** Blocks opening, matching a native select's disabled state. */
    disabled?: boolean;
}

const DEFAULT_TRIGGER =
    'w-full h-12 bg-black/40 border border-white/10 rounded-xl px-4 text-sm font-semibold text-white outline-none focus:border-brand-cyan';

/** Gap between trigger and list, and the minimum breathing room at the viewport edge. */
const GAP = 8;
const VIEWPORT_MARGIN = 8;
const PREFERRED_MAX_H = 240;
const MIN_MAX_H = 120;

interface ListPos {
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
}

const CustomSelect: React.FC<CustomSelectProps> = ({
    value,
    onChange,
    options,
    placeholder,
    id,
    ariaLabel,
    triggerClassName,
    disabled = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [pos, setPos] = useState<ListPos | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const selected = options.find((o) => o.value === value);

    const place = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();

        // Trigger scrolled out of its scroll container / the viewport — a
        // floating list anchored to nothing is worse than no list.
        if (r.bottom < 0 || r.top > window.innerHeight) {
            setIsOpen(false);
            return;
        }

        const spaceBelow = window.innerHeight - r.bottom - GAP - VIEWPORT_MARGIN;
        const spaceAbove = r.top - GAP - VIEWPORT_MARGIN;
        const openUp = spaceBelow < Math.min(PREFERRED_MAX_H, spaceAbove);
        const available = openUp ? spaceAbove : spaceBelow;

        setPos({
            left: r.left,
            width: r.width,
            ...(openUp ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
            maxHeight: Math.max(MIN_MAX_H, Math.min(PREFERRED_MAX_H, available)),
        });
    }, []);

    // Place before paint so the list never flashes at the wrong spot.
    useLayoutEffect(() => {
        if (isOpen) place();
    }, [isOpen, place]);

    useEffect(() => {
        if (!isOpen) return;
        const handlePointerDown = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node;
            if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
            setIsOpen(false);
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        // Capture: the list must track a scroll happening in ANY ancestor
        // scroller, not just the window.
        const handleReflow = () => place();

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);
        document.addEventListener('keydown', handleKey);
        window.addEventListener('scroll', handleReflow, true);
        window.addEventListener('resize', handleReflow);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
            document.removeEventListener('keydown', handleKey);
            window.removeEventListener('scroll', handleReflow, true);
            window.removeEventListener('resize', handleReflow);
        };
    }, [isOpen, place]);

    // A control that goes disabled while open must not leave its list floating.
    useEffect(() => {
        if (disabled) setIsOpen(false);
    }, [disabled]);

    return (
        <div className="relative">
            <button
                type="button"
                id={id}
                ref={triggerRef}
                disabled={disabled}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                onClick={() => setIsOpen((o) => !o)}
                className={`${triggerClassName ?? DEFAULT_TRIGGER} flex items-center justify-between text-left disabled:opacity-50`}
            >
                {/* Truncate like a native select: long labels (e.g. "Magic:
                    The Gathering" in a half-width grid cell) must not wrap and
                    overflow the fixed-height trigger. The open list still
                    renders labels in full. */}
                <span className={`truncate ${selected ? '' : 'text-slate-500'}`}>
                    {selected ? selected.label : (placeholder ?? '')}
                </span>
                <i
                    className={`fa-solid fa-chevron-down text-slate-500 text-xs ml-2 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                ></i>
            </button>

            {isOpen && pos && typeof document !== 'undefined' && createPortal(
                <ul
                    ref={listRef}
                    role="listbox"
                    style={{
                        position: 'fixed',
                        left: pos.left,
                        width: pos.width,
                        top: pos.top,
                        bottom: pos.bottom,
                        maxHeight: pos.maxHeight,
                    }}
                    className="z-[10050] overflow-y-auto bg-brand-darker border border-white/10 rounded-xl shadow-2xl py-1"
                >
                    {options.map((option) => {
                        const isSelected = option.value === value;
                        return (
                            <li
                                key={option.value}
                                role="option"
                                aria-selected={isSelected}
                                aria-disabled={option.disabled || undefined}
                            >
                                <button
                                    type="button"
                                    disabled={option.disabled}
                                    onClick={() => {
                                        onChange(option.value);
                                        setIsOpen(false);
                                    }}
                                    className={`w-full text-left px-4 py-3 text-sm font-semibold transition-colors ${
                                        option.disabled
                                            ? 'text-slate-500 cursor-not-allowed'
                                            : isSelected
                                              ? 'custom-select-active bg-white/5'
                                              : 'text-white hover:bg-white/5'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            </li>
                        );
                    })}
                </ul>,
                document.body,
            )}
        </div>
    );
};

export default CustomSelect;
