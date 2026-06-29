'use client';

/**
 * /reset-password — where the password-recovery email link lands.
 *
 * The link goes through /api/auth/callback (?next=/reset-password), which
 * exchanges the recovery code for a session server-side; by the time this
 * page mounts the user is signed in with a recovery session and just needs
 * to set the new password via supabase.auth.updateUser.
 *
 * This is also the activation path for pre-provisioned partner accounts:
 * the shop receives a welcome package, taps Sign In → "Forgot password?"
 * with their shop email, and lands here to set their first password.
 */

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { isPasswordStructurallyValid } from '@/lib/passwordPolicy';
import { Lock, Loader2, CheckCircle2 } from 'lucide-react';

type Status = 'checking' | 'ready' | 'saving' | 'done' | 'no-session';

export default function ResetPasswordPage() {
    const [status, setStatus] = useState<Status>('checking');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const { t } = useTranslation();

    useEffect(() => {
        const supabase = createClient();
        // Give detectSessionInUrl a beat in case the recovery code landed on
        // this page directly instead of via the server callback.
        const check = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                setStatus('ready');
                return true;
            }
            return false;
        };
        check().then(found => {
            if (!found) {
                setTimeout(async () => {
                    if (!(await check())) setStatus('no-session');
                }, 1500);
            }
        });
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!isPasswordStructurallyValid(password)) {
            setError(t('passwordPolicy.error'));
            return;
        }
        if (password !== confirm) {
            setError(t('passwordPolicy.mismatch'));
            return;
        }
        setStatus('saving');
        const supabase = createClient();
        const { error: updateErr } = await supabase.auth.updateUser({ password });
        if (updateErr) {
            setError(updateErr.message || 'Failed to update password.');
            setStatus('ready');
            return;
        }
        setStatus('done');
        setTimeout(() => { window.location.href = '/'; }, 2500);
    };

    return (
        <div className="min-h-dvh bg-brand-darker flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
                <div className="bg-gradient-to-br from-brand-cyan/10 to-brand-green/10 border-b border-white/10 px-8 pt-8 pb-6 text-center">
                    <h1 className="text-2xl font-black text-white italic skew-x-[-5deg]">
                        Set Your <span className="text-brand-cyan">Password</span>
                    </h1>
                    <p className="text-xs text-slate-400 mt-2 font-medium">
                        Choose a new password for your CardStreet account
                    </p>
                </div>

                <div className="p-8 space-y-6">
                    {status === 'checking' && (
                        <div className="flex items-center justify-center gap-3 py-8 text-slate-400">
                            <Loader2 className="w-5 h-5 animate-spin" />
                            <span className="text-sm">Verifying your link…</span>
                        </div>
                    )}

                    {status === 'no-session' && (
                        <div className="space-y-4 text-center">
                            <p className="text-sm text-red-200 bg-brand-red/10 border border-brand-red/20 rounded-xl p-4">
                                This reset link is invalid or has expired.
                            </p>
                            <p className="text-xs text-slate-400">
                                Request a new one from the app: Sign In → Forgot password?
                            </p>
                            <a href="/" className="inline-block px-6 h-12 leading-[3rem] bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 font-semibold transition-colors">
                                Back to CardStreet
                            </a>
                        </div>
                    )}

                    {status === 'done' && (
                        <div className="space-y-4 text-center py-4">
                            <CheckCircle2 className="w-12 h-12 text-brand-green mx-auto" />
                            <p className="text-sm text-slate-300">
                                Password set. You&apos;re signed in — taking you to CardStreet…
                            </p>
                        </div>
                    )}

                    {(status === 'ready' || status === 'saving') && (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && (
                                <p className="text-sm text-red-200 bg-brand-red/10 border border-brand-red/20 rounded-xl p-4">{error}</p>
                            )}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                    <Lock className="w-3 h-3" />
                                    New Password
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
                                <p className="text-[10px] text-slate-500">{t('passwordPolicy.hint')}</p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                    <Lock className="w-3 h-3" />
                                    Confirm Password
                                </label>
                                <input
                                    type="password"
                                    value={confirm}
                                    onChange={(e) => setConfirm(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    minLength={6}
                                    className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={status === 'saving'}
                                className="w-full h-12 bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand-cyan/20 hover:shadow-brand-cyan/40 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                            >
                                {status === 'saving' ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span>Saving…</span>
                                    </>
                                ) : (
                                    <span>Set Password</span>
                                )}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
