'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastData {
    id: string;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
    const [toasts, setToasts] = useState<ToastData[]>([]);

    const showToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts((prev) => [...prev, { id, message, type }]);

        // Auto remove after 3 seconds
        setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== id));
        }, 3000);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, []);

    // Determine padding based on safe area if available, else standard padding
    const [safeTop, setSafeTop] = useState('calc(1rem + var(--sat, 0px))');

    useEffect(() => {
        // Fallback or read from var(--sat) safely on mount
        const sat = document.documentElement.style.getPropertyValue('--sat');
        if (sat) {
            setSafeTop(`calc(1rem + ${sat})`);
        }
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {/* Toast Container */}
            <div
                className="fixed left-0 right-0 z-[100] flex flex-col items-center gap-2 pointer-events-none px-4"
                style={{ top: safeTop }}
            >
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        className="pointer-events-auto flex items-center gap-3 bg-brand-darker/95 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl p-4 min-w-[min(300px,100%)] max-w-sm animate-slideDown"
                    >
                        {toast.type === 'success' && (
                            <div className="w-8 h-8 rounded-full bg-brand-green/20 flex items-center justify-center flex-shrink-0">
                                <i className="fa-solid fa-check text-brand-green text-sm"></i>
                            </div>
                        )}
                        {toast.type === 'error' && (
                            <div className="w-8 h-8 rounded-full bg-brand-red/20 flex items-center justify-center flex-shrink-0">
                                <i className="fa-solid fa-exclamation text-brand-red text-sm"></i>
                            </div>
                        )}
                        {toast.type === 'info' && (
                            <div className="w-8 h-8 rounded-full bg-brand-cyan/20 flex items-center justify-center flex-shrink-0">
                                <i className="fa-solid fa-info text-brand-cyan text-sm"></i>
                            </div>
                        )}

                        <div className="flex-1">
                            <p className="text-white text-sm font-bold leading-tight">{toast.message}</p>
                        </div>

                        <button
                            onClick={() => removeToast(toast.id)}
                            className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors flex-shrink-0"
                        >
                            <i className="fa-solid fa-xmark text-slate-500 text-xs"></i>
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};
