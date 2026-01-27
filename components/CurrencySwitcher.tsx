import React, { useState, useRef, useEffect } from 'react';
import { EXCHANGE_RATES } from '@/constants';

interface CurrencySwitcherProps {
    currentCurrency: string;
    onCurrencyChange: (currency: string) => void;
}

const CurrencySwitcher: React.FC<CurrencySwitcherProps> = ({ currentCurrency, onCurrencyChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const currencies = Object.keys(EXCHANGE_RATES);

    return (
        <div className="relative z-50" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="glass h-9 pl-3 pr-3 rounded-xl flex items-center gap-2 border border-white/10 hover:bg-white/5 transition-all text-[10px] font-black text-brand-cyan min-w-[70px] justify-between"
            >
                <span>{currentCurrency}</span>
                <i className={`fa-solid fa-chevron-down text-[8px] text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}></i>
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-2 w-24 max-h-60 overflow-y-auto bg-brand-darker/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1 animate-fadeIn scrollbar-hide">
                    {currencies.map((currency) => (
                        <button
                            key={currency}
                            onClick={() => {
                                onCurrencyChange(currency);
                                setIsOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 text-[10px] font-bold hover:bg-white/5 transition-colors flex justify-between items-center ${currentCurrency === currency ? 'text-brand-cyan bg-brand-cyan/10' : 'text-slate-300'
                                }`}
                        >
                            {currency}
                            {currentCurrency === currency && <i className="fa-solid fa-check text-[8px]"></i>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CurrencySwitcher;
