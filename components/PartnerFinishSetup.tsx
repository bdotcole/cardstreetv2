'use client';

/**
 * Forced first-login setup for provisioned partner accounts.
 *
 * Shown (non-dismissible) by the app shell whenever a partner's
 * partner_onboarding_complete is false. The partner was created by an admin
 * with a username + temp password and a synthetic login email; here they set
 * their real email, phone, and a new password. The new password is set
 * client-side (keeps the current session alive); email + phone go through
 * /api/partner/complete-onboarding, which also clears the gate.
 */

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Mail, Phone, Lock, Loader2 } from 'lucide-react';

interface Props {
    shopName: string;
    onComplete: () => void;
}

const PartnerFinishSetup: React.FC<Props> = ({ shopName, onComplete }) => {
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }
        if (password !== confirm) {
            setError('Passwords do not match.');
            return;
        }

        setLoading(true);
        try {
            const supabase = createClient();
            // Set the new password first, in the live session, so changing it
            // never logs the partner out mid-flow.
            const { error: pwErr } = await supabase.auth.updateUser({ password });
            if (pwErr) throw new Error(pwErr.message);

            const res = await fetch('/api/partner/complete-onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, phone }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || 'Could not finish setup. Please try again.');
                setLoading(false);
                return;
            }

            // Pull the fresh session so the new email is reflected client-side.
            await supabase.auth.refreshSession();
            onComplete();
        } catch (err: any) {
            console.error('Partner setup failed:', err);
            setError(err?.message || 'Something went wrong. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="relative w-full max-w-md bg-brand-darker rounded-3xl border border-white/10 shadow-2xl max-h-[92dvh] overflow-y-auto">
                <div className="bg-gradient-to-br from-brand-cyan/10 to-brand-green/10 border-b border-white/10 px-8 pt-8 pb-6 text-center">
                    <p className="text-brand-cyan text-[10px] font-black uppercase tracking-[0.2em] italic skew-x-[-10deg] mb-2">
                        Partner Activation
                    </p>
                    <h2 className="text-2xl font-black text-white italic skew-x-[-5deg]">
                        Welcome, <span className="text-brand-cyan">{shopName}</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-2 font-medium max-w-sm mx-auto">
                        One last step — set your email, phone, and a new password to finish
                        activating your shop account.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-4">
                    {error && (
                        <div className="bg-brand-red/10 border border-brand-red/20 rounded-xl p-4">
                            <p className="text-sm text-red-200">{error}</p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                            <Mail className="w-3 h-3" /> Email
                        </label>
                        <input
                            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                            placeholder="your@email.com" required
                            className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                            <Phone className="w-3 h-3" /> Phone Number
                        </label>
                        <input
                            type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                            placeholder="08X XXX XXXX" required
                            className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                            <Lock className="w-3 h-3" /> New Password
                        </label>
                        <input
                            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••" required minLength={6}
                            className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                            <Lock className="w-3 h-3" /> Confirm Password
                        </label>
                        <input
                            type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                            placeholder="••••••••" required minLength={6}
                            className="w-full h-12 px-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                        />
                    </div>

                    <button
                        type="submit" disabled={loading}
                        className="w-full h-12 bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-brand-cyan/20 hover:shadow-brand-cyan/40 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                    >
                        {loading ? (<><Loader2 className="w-5 h-5 animate-spin" /><span>Activating…</span></>) : <span>Finish Setup</span>}
                    </button>

                    <p className="text-[10px] text-slate-500 text-center leading-relaxed">
                        After this, sign in any time with your email and new password.
                    </p>
                </form>
            </div>
        </div>
    );
};

export default PartnerFinishSetup;
