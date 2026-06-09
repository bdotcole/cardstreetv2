'use client'

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { createClient } from '@/lib/supabase/client';
import { X, Mail, Lock, User, Phone, Loader2 } from 'lucide-react';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type AuthMode = 'signin' | 'signup' | 'verify';

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
    const [mode, setMode] = useState<AuthMode>('signin');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [verificationEmail, setVerificationEmail] = useState<string | null>(null);

    // Form fields
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [phone, setPhone] = useState('');
    const [mounted, setMounted] = useState(false);

    // Portal target is document.body, which only exists after mount.
    useEffect(() => setMounted(true), []);

    const supabase = createClient();

    const handleOAuthLogin = async (provider: 'google' | 'apple') => {
        setLoading(true);
        setError(null);
        try {
            // For web (browser), derive the callback from the current origin so the
            // OAuth flow returns to the same origin the user started from. This
            // makes localhost and Vercel preview deployments work without code
            // changes — the prior hardcoded production URL caused PKCE verifier
            // mismatch errors anywhere off-prod because the verifier is stored
            // per-origin in browser localStorage.
            //
            // Native (Capacitor) keeps the prod URL because the deep-link scheme
            // is registered against cardstreet.app — that one MUST stay absolute.
            let redirectUrl = `${window.location.origin}/api/auth/callback`;
            let isNative = false;

            try {
                const { Capacitor } = await import('@capacitor/core');
                if (Capacitor.isNativePlatform()) {
                    redirectUrl = 'https://cardstreet.app/mobile-redirect';
                    isNative = true;
                }
            } catch (e) {
                // Ignore, fallback to dynamic-origin web URL
            }

            console.log(`[Auth] Initiating ${provider} Login. Native:`, isNative, 'Redirect:', redirectUrl);

            const { data, error } = await supabase.auth.signInWithOAuth({
                provider,
                options: {
                    redirectTo: redirectUrl,
                    skipBrowserRedirect: isNative // Only skip on native to open manually in system browser
                },
            });

            if (error) throw error;

            // Handle manual redirect for Native Custom Scheme
            if (isNative && data?.url) {
                console.log('[Auth] Opening Capacitor Browser for Auth:', data.url);
                try {
                    const { Browser } = await import('@capacitor/browser');
                    await Browser.open({ url: data.url });
                } catch (e) {
                    console.error('Failed to open Capacitor Browser:', e);
                    window.open(data.url, '_system');
                }
            }
        } catch (err: any) {
            console.error(`Error logging in with ${provider}:`, err);
            const label = provider === 'apple' ? 'Apple' : 'Google';
            setError(`Failed to sign in with ${label}. Please try again.`);
            setLoading(false);
        }
    };

    const handleEmailSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) throw error;

            // Success. The parent listens to onAuthStateChange and updates the app,
            // but close + clear loading here too so the button can never get stuck
            // on a spinner if that listener is delayed.
            setLoading(false);
            onClose();
        } catch (err: any) {
            console.error('Error signing in:', err);
            setError(err.message || 'Invalid email or password');
            setLoading(false);
        }
    };

    const handleEmailSignUp = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: name,
                        phone_number: phone,
                        username: username,
                    },
                    emailRedirectTo: `${window.location.origin}/api/auth/callback`,
                },
            });

            if (error) throw error;

            // Show verification message
            setVerificationEmail(email);
            setMode('verify');
        } catch (err: any) {
            console.error('Error signing up:', err);
            setError(err.message || 'Failed to create account');
            setLoading(false);
        }
    };



    if (!isOpen || !mounted) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-md transition-opacity"
                onClick={onClose}
            ></div>

            {/* Modal */}
            <div className="relative w-full max-w-md bg-brand-darker rounded-3xl border border-white/10 shadow-2xl transition-all animate-slideUp max-h-[90dvh] overflow-y-auto">
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors group"
                >
                    <X className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" />
                </button>

                {/* Header */}
                <div className="bg-gradient-to-br from-brand-cyan/10 to-brand-green/10 border-b border-white/10 px-8 pt-8 pb-6">
                    <div className="w-16 h-16 bg-gradient-to-br from-brand-cyan to-brand-green rounded-[2rem] flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-cyan/20">
                        <i className="fa-solid fa-cards text-2xl text-brand-darker"></i>
                    </div>
                    <h2 className="text-2xl font-black text-white italic skew-x-[-5deg] text-center">
                        Welcome to <span className="text-brand-cyan">CardStreet</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-2 font-medium text-center max-w-sm mx-auto">
                        {mode === 'verify'
                            ? 'Check your email to verify your account'
                            : 'Sign in to sync your collection across devices'}
                    </p>
                </div>

                {mode === 'verify' ? (
                    /* Verification Message */
                    <div className="p-8 space-y-6">
                        <div className="bg-brand-green/10 border border-brand-green/20 rounded-2xl p-6 text-center space-y-3">
                            <div className="w-16 h-16 bg-brand-green/20 rounded-full flex items-center justify-center mx-auto mb-2">
                                <Mail className="w-8 h-8 text-brand-green" />
                            </div>
                            <h3 className="text-lg font-bold text-white">Verify Your Email</h3>
                            <p className="text-sm text-slate-400 leading-relaxed">
                                We've sent a verification link to <span className="text-brand-cyan font-semibold">{verificationEmail}</span>
                            </p>
                            <p className="text-xs text-slate-500">
                                Click the link in your email to complete your registration.
                            </p>
                        </div>

                        <button
                            onClick={() => {
                                setMode('signin');
                                setVerificationEmail(null);
                            }}
                            className="w-full h-12 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 font-semibold transition-colors"
                        >
                            Back to Sign In
                        </button>
                    </div>
                ) : (
                    /* Sign In / Sign Up Forms */
                    <div className="p-8 space-y-6">
                        {/* Tab Switcher */}
                        <div className="flex gap-2 p-1 bg-white/5 rounded-xl">
                            <button
                                onClick={() => {
                                    setMode('signin');
                                    setError(null);
                                }}
                                className={`flex-1 h-10 rounded-lg font-bold text-sm transition-all ${mode === 'signin'
                                    ? 'bg-brand-cyan text-brand-darker shadow-lg shadow-brand-cyan/20'
                                    : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                Sign In
                            </button>
                            <button
                                onClick={() => {
                                    setMode('signup');
                                    setError(null);
                                }}
                                className={`flex-1 h-10 rounded-lg font-bold text-sm transition-all ${mode === 'signup'
                                    ? 'bg-brand-cyan text-brand-darker shadow-lg shadow-brand-cyan/20'
                                    : 'text-slate-400 hover:text-white'
                                    }`}
                            >
                                Sign Up
                            </button>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="bg-brand-red/10 border border-brand-red/20 rounded-xl p-4 flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-brand-red/20 flex items-center justify-center flex-shrink-0">
                                    <i className="fa-solid fa-exclamation text-brand-red text-sm"></i>
                                </div>
                                <p className="text-sm text-red-200 flex-1">{error}</p>
                            </div>
                        )}

                        {/* Social OAuth — Apple is required by App Store Guideline 4.8
                            whenever a third-party social login (Google) is offered. */}
                        <div className="space-y-3">
                            <button
                                onClick={() => handleOAuthLogin('google')}
                                disabled={loading}
                                className="w-full h-12 bg-white hover:bg-slate-50 active:bg-slate-100 rounded-xl flex items-center justify-center gap-3 transition-all font-bold text-slate-900 shadow-lg group disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <i className="fa-brands fa-google text-xl text-red-500 group-hover:scale-110 transition-transform"></i>
                                <span>Continue with Google</span>
                            </button>

                            <button
                                onClick={() => handleOAuthLogin('apple')}
                                disabled={loading}
                                className="w-full h-12 bg-black hover:bg-zinc-900 active:bg-zinc-800 rounded-xl flex items-center justify-center gap-3 transition-all font-bold text-white shadow-lg group disabled:opacity-50 disabled:cursor-not-allowed border border-white/10"
                            >
                                <i className="fa-brands fa-apple text-xl group-hover:scale-110 transition-transform"></i>
                                <span>Continue with Apple</span>
                            </button>
                        </div>

                        {/* Divider */}
                        <div className="relative flex py-2 items-center">
                            <div className="flex-grow border-t border-slate-700"></div>
                            <span className="flex-shrink-0 mx-4 text-[10px] text-slate-500 uppercase font-bold tracking-widest">
                                Or with email
                            </span>
                            <div className="flex-grow border-t border-slate-700"></div>
                        </div>

                        {/* Email/Password Form */}
                        <form onSubmit={mode === 'signin' ? handleEmailSignIn : handleEmailSignUp} className="space-y-4">
                            {mode === 'signup' && (
                                <>
                                    {/* Username Field */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                            <User className="w-3 h-3" />
                                            Username
                                        </label>
                                        <input
                                            type="text"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            placeholder="Enter a unique username"
                                            required
                                            minLength={3}
                                            maxLength={20}
                                            pattern="[a-zA-Z0-9_]+"
                                            title="Letters, numbers, and underscores only"
                                            className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                                        />
                                    </div>

                                    {/* Name Field */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                            <User className="w-3 h-3" />
                                            Full Name
                                        </label>
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="Enter your full name"
                                            required
                                            className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                                        />
                                    </div>

                                    {/* Phone Field */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                            <Phone className="w-3 h-3" />
                                            Phone Number (Optional)
                                        </label>
                                        <input
                                            type="tel"
                                            value={phone}
                                            onChange={(e) => setPhone(e.target.value)}
                                            placeholder="+66 xxx xxx xxxx"
                                            className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                                        />
                                    </div>
                                </>
                            )}

                            {/* Email Field */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                    <Mail className="w-3 h-3" />
                                    Email
                                </label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="your@email.com"
                                    required
                                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                                />
                            </div>

                            {/* Password Field */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                    <Lock className="w-3 h-3" />
                                    Password
                                </label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    minLength={6}
                                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                                />
                                {mode === 'signup' && (
                                    <p className="text-[10px] text-slate-500">Minimum 6 characters</p>
                                )}
                            </div>

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full h-12 bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand-cyan/20 hover:shadow-brand-cyan/40 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span>Please wait...</span>
                                    </>
                                ) : (
                                    <span>{mode === 'signin' ? 'Sign In' : 'Create Account'}</span>
                                )}
                            </button>
                        </form>

                        {/* Terms */}
                        <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                            By continuing, you agree to our{' '}
                            <span className="text-brand-cyan">Terms of Service</span> and{' '}
                            <span className="text-brand-cyan">Privacy Policy</span>.
                        </p>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

export default AuthModal;
