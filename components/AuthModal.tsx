'use client'

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { isPasswordStructurallyValid } from '@/lib/passwordPolicy';
import { trackSignUp } from '@/lib/signupEvents';
import { readAttributionCookie, unknownAttribution, withWriter } from '@/lib/attribution';
import { X, Mail, Lock, User, Phone, Loader2 } from 'lucide-react';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    // Why the modal opened ("Sign in to save cards to your vault") — shown in
    // the header so a gate-triggered prompt reads as a step toward what the
    // user was doing, not a generic interruption.
    contextMessage?: string;
    /**
     * Which tab the wall opens on. Defaults to 'signin', which is right when
     * the user reached the wall from something only an existing account does.
     * Buy Now is the opposite case: someone who taps it on a listing is far
     * more likely to have no account at all, and showing them a sign-in form
     * asks for a password they never set.
     */
    initialMode?: 'signin' | 'signup';
}

type AuthMode = 'signin' | 'signup' | 'verify' | 'forgot' | 'forgot-sent';

// App Review rejected the app twice for "loads indefinitely" on login (iPad,
// WKWebView). A hang anywhere in the auth stack must therefore surface as a
// visible, retryable error — never an endless spinner — and must report to
// Sentry with enough context to diagnose the failing environment remotely.
const AUTH_TIMEOUT_MS = 15000;

class AuthTimeoutError extends Error {
    constructor(step: string) {
        super(`Auth step "${step}" timed out after ${AUTH_TIMEOUT_MS / 1000}s`);
        this.name = 'AuthTimeoutError';
    }
}

async function withAuthWatchdog<T>(step: string, run: () => Promise<T>): Promise<T> {
    Sentry.addBreadcrumb({ category: 'auth', message: `${step}: start`, level: 'info' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            run(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new AuthTimeoutError(step)), AUTH_TIMEOUT_MS);
            }),
        ]);
        Sentry.addBreadcrumb({ category: 'auth', message: `${step}: done`, level: 'info' });
        return result;
    } catch (err) {
        Sentry.addBreadcrumb({ category: 'auth', message: `${step}: failed`, level: 'error' });
        if (err instanceof AuthTimeoutError) {
            Sentry.captureException(err, {
                tags: { auth_step: step, auth_watchdog: 'timeout' },
                extra: {
                    online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
                    visibility: typeof document !== 'undefined' ? document.visibilityState : undefined,
                },
            });
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

// The session lives in cookies (@supabase/ssr) and every /api route reads it
// server-side — a cookie write that silently fails (the remaining WKWebView
// suspect) would leave the user "signed in" on the client but 401 on every
// API call. Measure it instead of guessing: report when the auth cookie is
// missing shortly after a successful sign-in. Diagnostic only; never blocks
// or disturbs the login flow.
function verifySessionPersisted(supabase: ReturnType<typeof createClient>) {
    setTimeout(async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const cookiePresent = document.cookie.split(';').some(c => {
                const name = c.trim().split('=')[0];
                return name.startsWith('sb-') && name.includes('-auth-token');
            });
            if (!session || !cookiePresent) {
                Sentry.captureMessage('Auth session failed to persist after sign-in', {
                    level: 'error',
                    tags: { auth_step: 'persistence-check' },
                    extra: { hasSession: !!session, cookiePresent },
                });
            }
        } catch {
            // Best-effort diagnostic.
        }
    }, 1500);
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, contextMessage, initialMode = 'signin' }) => {
    const [mode, setMode] = useState<AuthMode>(initialMode);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [verificationEmail, setVerificationEmail] = useState<string | null>(null);

    // Resend-verification state for the 'verify' screen. Confirmation links
    // are one-time and mail-provider link scanners often consume them before
    // the user clicks (GoTrue then reports otp_expired), so a resend path is
    // essential. Cooldown mirrors GoTrue's 60s resend rate limit.
    const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
    const [resendCooldown, setResendCooldown] = useState(0);
    useEffect(() => {
        if (resendCooldown <= 0) return;
        const id = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
        return () => clearTimeout(id);
    }, [resendCooldown]);

    // Form fields
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [phone, setPhone] = useState('');
    const [mounted, setMounted] = useState(false);
    const { t } = useTranslation();

    // Portal target is document.body, which only exists after mount.
    useEffect(() => setMounted(true), []);

    // Both shells keep this component mounted and toggle `isOpen`, so the
    // initial state above is only read once per page load — without this, the
    // second wall of a session would open on whatever tab the first one was
    // left on, and initialMode would be silently ignored. Only on the
    // closed -> open edge: resetting on every render would fight the user's
    // own tab clicks.
    const wasOpenRef = React.useRef(false);
    useEffect(() => {
        if (isOpen && !wasOpenRef.current) {
            setMode(initialMode);
            setError(null);
        }
        wasOpenRef.current = isOpen;
    }, [isOpen, initialMode]);

    // Web OAuth navigates the whole page away. If the user backs out of the
    // provider's page, bfcache restores this page with `loading` still true —
    // the same stuck "Please wait..." as the native sheet-dismiss case.
    useEffect(() => {
        const onPageShow = (e: PageTransitionEvent) => {
            if (e.persisted) setLoading(false);
        };
        window.addEventListener('pageshow', onPageShow);
        return () => window.removeEventListener('pageshow', onPageShow);
    }, []);

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

            const { data, error } = await withAuthWatchdog(`oauth-${provider}`, () =>
                supabase.auth.signInWithOAuth({
                    provider,
                    options: {
                        redirectTo: redirectUrl,
                        skipBrowserRedirect: isNative // Only skip on native to open manually in system browser
                    },
                })
            );

            if (error) throw error;

            // Handle manual redirect for Native Custom Scheme
            if (isNative && data?.url) {
                console.log('[Auth] Opening Capacitor Browser for Auth:', data.url);
                try {
                    const { Browser } = await import('@capacitor/browser');
                    // If the user dismisses the browser sheet without
                    // completing the provider flow, no deep link ever arrives
                    // and nothing else clears `loading` — the modal sat on
                    // "Please wait..." forever with every control disabled
                    // (the App Review "loads indefinitely" rejection). The
                    // listener also fires on the success path when the
                    // deep-link handler closes the sheet; re-enabling the form
                    // for the moment before onAuthStateChange signs the user
                    // in is harmless.
                    const finished = await Browser.addListener('browserFinished', () => {
                        finished.remove();
                        Sentry.addBreadcrumb({
                            category: 'auth',
                            message: `oauth-${provider}: browser sheet closed`,
                            level: 'info',
                        });
                        setLoading(false);
                    });
                    await Browser.open({ url: data.url });
                } catch (e) {
                    console.error('Failed to open Capacitor Browser:', e);
                    window.open(data.url, '_system');
                    // External browser gives no close signal — re-enable the
                    // form immediately so email sign-in stays available.
                    setLoading(false);
                }
            }
        } catch (err: any) {
            console.error(`Error logging in with ${provider}:`, err);
            const label = provider === 'apple' ? 'Apple' : 'Google';
            setError(err instanceof AuthTimeoutError
                ? t('auth.timeout')
                : `Failed to sign in with ${label}. Please try again.`);
            setLoading(false);
        }
    };

    const handleEmailSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const identifier = email.trim();

        try {
            // Partners provisioned by an admin sign in with a username (no '@').
            // The server resolves it to the account's email and sets the session
            // cookie, so we reload to pick it up. Anything with '@' is a normal
            // email sign-in.
            if (!identifier.includes('@')) {
                const res = await withAuthWatchdog('partner-username-signin', () =>
                    fetch('/api/auth/partner-login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: identifier.toLowerCase(), password }),
                    })
                );
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || 'Invalid username or password');
                }
                window.location.reload();
                return;
            }

            const { error } = await withAuthWatchdog('email-signin', () =>
                supabase.auth.signInWithPassword({
                    email: identifier,
                    password,
                })
            );

            if (error) throw error;

            verifySessionPersisted(supabase);

            // Success. The parent listens to onAuthStateChange and updates the app,
            // but close + clear loading here too so the button can never get stuck
            // on a spinner if that listener is delayed.
            setLoading(false);
            onClose();
        } catch (err: any) {
            console.error('Error signing in:', err);
            // Unconfirmed email isn't a dead end — route to the verify screen,
            // which explains the situation and offers a resend button (the
            // original link may have been consumed by a mail-provider scanner).
            if (/email not confirmed/i.test(err?.message || '')) {
                setVerificationEmail(identifier);
                setResendState('idle');
                setMode('verify');
                setError(null);
                setLoading(false);
                return;
            }
            setError(err instanceof AuthTimeoutError
                ? t('auth.timeout')
                : err.message || 'Invalid email or password');
            setLoading(false);
        }
    };

    const handleForgotPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            // The auth callback honors this cookie when the ?next= param gets
            // stripped anywhere along the redirect chain — both routes land
            // the user on /reset-password with a recovery session.
            document.cookie = 'cardstreet_auth_redirect=/reset-password; path=/; max-age=3600';

            const { error } = await withAuthWatchdog('password-reset', () =>
                supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: `${window.location.origin}/api/auth/callback?next=/reset-password`,
                })
            );
            if (error) throw error;

            setVerificationEmail(email);
            setMode('forgot-sent');
            setLoading(false);
        } catch (err: any) {
            console.error('Error sending password reset:', err);
            setError(err instanceof AuthTimeoutError
                ? t('auth.timeout')
                : err.message || 'Failed to send reset email');
            setLoading(false);
        }
    };

    const handleResendVerification = async () => {
        if (!verificationEmail || resendState === 'sending' || resendCooldown > 0) return;
        setResendState('sending');
        setError(null);
        try {
            const { error } = await withAuthWatchdog('resend-verification', () =>
                supabase.auth.resend({
                    type: 'signup',
                    email: verificationEmail,
                    options: { emailRedirectTo: `${window.location.origin}/api/auth/callback` },
                })
            );
            if (error) throw error;
            setResendState('sent');
            setResendCooldown(60);
        } catch (err: any) {
            console.error('Error resending verification email:', err);
            setResendState('idle');
            setError(err instanceof AuthTimeoutError
                ? t('auth.timeout')
                : err.message || t('auth.resendFailed'));
        }
    };

    const handleEmailSignUp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        // Mirror Supabase's password policy client-side so structural failures
        // surface inline instead of as a server-side 422 (the leaked-password
        // check still runs server-side and its message is shown below).
        if (!isPasswordStructurallyValid(password)) {
            setError(t('passwordPolicy.error'));
            return;
        }

        setLoading(true);
        try {
            const { data, error } = await withAuthWatchdog('email-signup', () =>
                supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            full_name: name,
                            phone_number: phone,
                            username: username,
                            // Rides the metadata the trigger already reads, so no
                            // extra round trip. If the migration adding the column
                            // has not run yet this is simply ignored — but it stays
                            // in auth.users.raw_user_meta_data, so nothing is lost
                            // and it can be backfilled.
                            // Falls back to an explicit "unknown" record rather
                            // than null: the trigger discards anything that is
                            // not a JSON object, so a null here left the account
                            // indistinguishable from the pre-feature back
                            // catalogue (see lib/attribution.ts).
                            signup_attribution:
                                withWriter(readAttributionCookie(), 'trigger') ??
                                unknownAttribution('callback_nocookie', window.location.pathname),
                        },
                        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
                    },
                })
            );

            if (error) throw error;

            // Record the conversion here, in the session that still carries the
            // acquisition channel. Waiting for email verification would move it to
            // whatever session opens the mail link — often another device, where
            // the organic-search attribution no longer exists.
            trackSignUp('email');

            // Show verification message
            setVerificationEmail(email);
            setMode('verify');
        } catch (err: any) {
            console.error('Error signing up:', err);
            setError(err instanceof AuthTimeoutError
                ? t('auth.timeout')
                : err.message || t('auth.signUpFailed'));
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
                        {t('auth.welcomeTitle')} <span className="text-brand-cyan">CardStreet</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-2 font-medium text-center max-w-sm mx-auto">
                        {mode === 'verify'
                            ? t('auth.subtitleVerify')
                            : mode === 'forgot' || mode === 'forgot-sent'
                                ? t('auth.subtitleReset')
                                : contextMessage || t('auth.subtitleDefault')}
                    </p>
                </div>

                {mode === 'verify' ? (
                    /* Verification Message */
                    <div className="p-8 space-y-6">
                        <div className="bg-brand-green/10 border border-brand-green/20 rounded-2xl p-6 text-center space-y-3">
                            <div className="w-16 h-16 bg-brand-green/20 rounded-full flex items-center justify-center mx-auto mb-2">
                                <Mail className="w-8 h-8 text-brand-green" />
                            </div>
                            <h3 className="text-lg font-bold text-white">{t('auth.verifyTitle')}</h3>
                            <p className="text-sm text-slate-400 leading-relaxed">
                                {t('auth.verifySentTo')} <span className="text-brand-cyan font-semibold">{verificationEmail}</span>
                            </p>
                            <p className="text-xs text-slate-500">
                                {t('auth.verifyHint')}
                            </p>
                        </div>

                        {error && (
                            <div className="bg-brand-red/10 border border-brand-red/20 rounded-xl p-4 flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-brand-red/20 flex items-center justify-center flex-shrink-0">
                                    <i className="fa-solid fa-exclamation text-brand-red text-sm"></i>
                                </div>
                                <p className="text-sm text-red-200 flex-1">{error}</p>
                            </div>
                        )}

                        {resendState === 'sent' && (
                            <div className="bg-brand-cyan/10 border border-brand-cyan/20 rounded-xl p-4">
                                <p className="text-sm text-cyan-100">
                                    {t('auth.resendSent')}
                                </p>
                            </div>
                        )}

                        <button
                            onClick={handleResendVerification}
                            disabled={resendState === 'sending' || resendCooldown > 0}
                            className="w-full h-12 bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand-cyan/20 hover:shadow-brand-cyan/40 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                        >
                            {resendState === 'sending' ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    <span>{t('auth.sending')}</span>
                                </>
                            ) : resendCooldown > 0 ? (
                                <span>{t('auth.resendEmail')} ({resendCooldown}s)</span>
                            ) : (
                                <span>{t('auth.resendEmail')}</span>
                            )}
                        </button>

                        <button
                            onClick={() => {
                                setMode('signin');
                                setVerificationEmail(null);
                                setResendState('idle');
                                setError(null);
                            }}
                            className="w-full h-12 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 font-semibold transition-colors"
                        >
                            {t('auth.backToSignIn')}
                        </button>
                    </div>
                ) : mode === 'forgot' || mode === 'forgot-sent' ? (
                    /* Forgot Password */
                    <div className="p-8 space-y-6">
                        {mode === 'forgot-sent' ? (
                            <div className="bg-brand-green/10 border border-brand-green/20 rounded-2xl p-6 text-center space-y-3">
                                <div className="w-16 h-16 bg-brand-green/20 rounded-full flex items-center justify-center mx-auto mb-2">
                                    <Mail className="w-8 h-8 text-brand-green" />
                                </div>
                                <h3 className="text-lg font-bold text-white">{t('auth.checkEmailTitle')}</h3>
                                <p className="text-sm text-slate-400 leading-relaxed">
                                    {t('auth.forgotSentPrefix')} <span className="text-brand-cyan font-semibold">{verificationEmail}</span>,
                                    {t('auth.forgotSentSuffix')}
                                </p>
                            </div>
                        ) : (
                            <>
                                {error && (
                                    <div className="bg-brand-red/10 border border-brand-red/20 rounded-xl p-4 flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-full bg-brand-red/20 flex items-center justify-center flex-shrink-0">
                                            <i className="fa-solid fa-exclamation text-brand-red text-sm"></i>
                                        </div>
                                        <p className="text-sm text-red-200 flex-1">{error}</p>
                                    </div>
                                )}
                                <p className="text-sm text-slate-400 leading-relaxed">
                                    {t('auth.forgotIntro')}
                                </p>
                                <form onSubmit={handleForgotPassword} className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                            <Mail className="w-3 h-3" />
                                            {t('auth.email')}
                                        </label>
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder={t('auth.emailPlaceholder')}
                                            required
                                            className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                                        />
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="w-full h-12 bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand-cyan/20 hover:shadow-brand-cyan/40 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                                    >
                                        {loading ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                <span>{t('auth.pleaseWait')}</span>
                                            </>
                                        ) : (
                                            <span>{t('auth.sendResetLink')}</span>
                                        )}
                                    </button>
                                </form>
                            </>
                        )}
                        <button
                            onClick={() => {
                                setMode('signin');
                                setError(null);
                            }}
                            className="w-full h-12 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 font-semibold transition-colors"
                        >
                            {t('auth.backToSignIn')}
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
                                {t('auth.signIn')}
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
                                {t('auth.signUp')}
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
                            whenever a third-party social login (Google) is offered.
                            theme-dark-locked: both buttons keep their brand colors
                            (white Google / black Apple) in light mode. */}
                        <div className="space-y-3">
                            <button
                                onClick={() => handleOAuthLogin('google')}
                                disabled={loading}
                                className="theme-dark-locked w-full h-12 bg-white hover:bg-slate-50 active:bg-slate-100 rounded-xl flex items-center justify-center gap-3 transition-all font-bold text-slate-900 shadow-lg group disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <i className="fa-brands fa-google text-xl text-red-500 group-hover:scale-110 transition-transform"></i>
                                <span>{t('auth.continueGoogle')}</span>
                            </button>

                            <button
                                onClick={() => handleOAuthLogin('apple')}
                                disabled={loading}
                                className="theme-dark-locked w-full h-12 bg-black hover:bg-zinc-900 active:bg-zinc-800 rounded-xl flex items-center justify-center gap-3 transition-all font-bold text-white shadow-lg group disabled:opacity-50 disabled:cursor-not-allowed border border-white/10"
                            >
                                <i className="fa-brands fa-apple text-xl group-hover:scale-110 transition-transform"></i>
                                <span>{t('auth.continueApple')}</span>
                            </button>
                        </div>

                        {/* Divider */}
                        <div className="relative flex py-2 items-center">
                            <div className="flex-grow border-t border-slate-700"></div>
                            <span className="flex-shrink-0 mx-4 text-[10px] text-slate-500 uppercase font-bold tracking-widest">
                                {t('auth.orWithEmail')}
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
                                            {t('auth.username')}
                                        </label>
                                        <input
                                            type="text"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            placeholder={t('auth.usernamePlaceholder')}
                                            required
                                            minLength={3}
                                            maxLength={20}
                                            pattern="[a-zA-Z0-9_]+"
                                            title={t('auth.usernameHint')}
                                            className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                                        />
                                    </div>

                                    {/* Name Field */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                            <User className="w-3 h-3" />
                                            {t('auth.fullName')}
                                        </label>
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder={t('auth.fullNamePlaceholder')}
                                            required
                                            className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                                        />
                                    </div>

                                    {/* Phone Field */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                            <Phone className="w-3 h-3" />
                                            {t('auth.phoneOptional')}
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

                            {/* Email (or username, on sign-in) Field */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                    <Mail className="w-3 h-3" />
                                    {mode === 'signin' ? t('auth.emailOrUsername') : t('auth.email')}
                                </label>
                                <input
                                    type={mode === 'signin' ? 'text' : 'email'}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder={mode === 'signin' ? t('auth.emailOrUsernamePlaceholder') : t('auth.emailPlaceholder')}
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    required
                                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                                />
                            </div>

                            {/* Password Field */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                    <Lock className="w-3 h-3" />
                                    {t('auth.password')}
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
                                    <p className="text-[10px] text-slate-500">{t('passwordPolicy.hint')}</p>
                                )}
                                {mode === 'signin' && (
                                    <div className="text-right">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setMode('forgot');
                                                setError(null);
                                            }}
                                            className="text-[11px] font-bold text-brand-cyan hover:underline"
                                        >
                                            {t('auth.forgotPassword')}
                                        </button>
                                    </div>
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
                                        <span>{t('auth.pleaseWait')}</span>
                                    </>
                                ) : (
                                    <span>{mode === 'signin' ? t('auth.signIn') : t('auth.createAccount')}</span>
                                )}
                            </button>
                        </form>

                        {/* Terms */}
                        <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                            {t('auth.termsPrefix')}{' '}
                            <span className="text-brand-cyan">{t('auth.termsOfService')}</span> {t('auth.and')}{' '}
                            <span className="text-brand-cyan">{t('auth.privacyPolicy')}</span>.
                        </p>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
};

export default AuthModal;
