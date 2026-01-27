'use client'

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
    const [loading, setLoading] = useState(false);
    const supabase = createClient();

    const handleLogin = async (provider: 'google' | 'line') => {
        setLoading(true);
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: provider as any,
                options: {
                    redirectTo: `${window.location.origin}/api/auth/callback`,
                },
            });
            if (error) throw error;
        } catch (error) {
            console.error('Error logging in:', error);
            alert('Error logging in. Please try again.');
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            ></div>

            {/* Modal */}
            <div className="relative w-full max-w-sm glass-panel rounded-2xl p-6 transition-all animate-slideUp">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
                >
                    <i className="fa-solid fa-xmark text-xl"></i>
                </button>

                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-brand-cyan/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-brand-cyan/20 shadow-[0_0_20px_rgba(6,182,212,0.2)]">
                        <i className="fa-solid fa-user-astronaut text-2xl text-brand-cyan"></i>
                    </div>
                    <h2 className="text-xl font-black text-white italic skew-x-[-5deg]">
                        Welcome to <span className="text-brand-cyan">CardStreet</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-2 font-medium">
                        Sign in to manage your vault and track portfolio value.
                    </p>
                </div>

                <div className="space-y-3">
                    <button
                        onClick={() => handleLogin('google')}
                        disabled={loading}
                        className="w-full h-12 bg-white hover:bg-slate-50 active:bg-slate-100 rounded-xl flex items-center justify-center gap-3 transition-all font-bold text-slate-700 shadow-lg group disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <i className="fa-brands fa-google text-xl text-red-500 group-hover:scale-110 transition-transform"></i>
                        <span>Continue with Google</span>
                    </button>

                    <div className="relative flex py-2 items-center">
                        <div className="flex-grow border-t border-slate-600"></div>
                        <span className="flex-shrink-0 mx-4 text-[10px] text-slate-500 uppercase font-bold tracking-widest">Or</span>
                        <div className="flex-grow border-t border-slate-600"></div>
                    </div>

                    <button
                        onClick={() => {
                            localStorage.setItem('cardstreet-guest', 'true');
                            window.location.reload();
                        }}
                        className="w-full h-12 bg-white/5 hover:bg-white/10 active:bg-white/15 rounded-xl flex items-center justify-center gap-3 transition-all font-bold text-slate-300 border border-white/10"
                    >
                        <i className="fa-solid fa-user-secret text-lg"></i>
                        <span>Continue as Guest</span>
                    </button>
                </div>

                <div className="mt-6 text-center">
                    <p className="text-[10px] text-slate-500">
                        By continuing, you agree to our Terms of Service and Privacy Policy.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default AuthModal;
