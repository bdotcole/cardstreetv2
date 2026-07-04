'use client';

/**
 * Prefetch-proof email verification landing page.
 *
 * Mail providers' link scanners GET one-time Supabase links before the human
 * clicks, consuming the token and stranding the user on
 * /#error=otp_expired. This page breaks that: the Supabase email templates
 * link HERE with a token_hash ({{ .SiteURL }}/auth/confirm?token_hash=...&type=email),
 * and the token is only redeemed when the user presses the button — scanners
 * load the page but never click.
 *
 * type=email (signup confirm) → verify, session set, into the app.
 * type=recovery (password reset) → verify, then /reset-password.
 * Old-style {{ .ConfirmationURL }} links keep working alongside — GoTrue
 * honors both — so the template switch needs no coordination window.
 *
 * On Android with the app installed, cardstreet.app App Links route this URL
 * into the native app instead; the appUrlOpen handler in app/page.tsx has a
 * matching /auth/confirm branch (a deep-link open is itself the user's click,
 * so it verifies immediately).
 *
 * Bilingual inline copy (TH first): reachable straight from an email, so no
 * language cookie may exist yet.
 */

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, MailCheck, ShieldAlert } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type OtpType = 'email' | 'signup' | 'recovery' | 'invite' | 'magiclink' | 'email_change';

function ConfirmInner() {
    const searchParams = useSearchParams();
    const tokenHash = searchParams?.get('token_hash') || '';
    const type = (searchParams?.get('type') || 'email') as OtpType;
    const isRecovery = type === 'recovery';

    const [state, setState] = useState<'idle' | 'working' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const confirm = async () => {
        setState('working');
        try {
            const supabase = createClient();
            const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
            if (error) throw error;
            // Session cookies are set by the browser client; a full navigation
            // lets the server render the signed-in state.
            window.location.replace(isRecovery ? '/reset-password' : '/');
        } catch (err: any) {
            setState('error');
            setErrorMessage(err?.message || null);
        }
    };

    const invalid = !tokenHash;

    return (
        <div className="min-h-[100dvh] bg-brand-darker flex items-center justify-center p-4">
            <div className="bg-slate-900/60 border border-white/10 rounded-3xl max-w-md w-full p-8 space-y-5 text-center shadow-2xl">
                {invalid || state === 'error' ? (
                    <>
                        <div className="w-16 h-16 bg-brand-red/15 rounded-full flex items-center justify-center mx-auto">
                            <ShieldAlert className="w-8 h-8 text-brand-red" />
                        </div>
                        <h1 className="text-white font-black text-xl">
                            ลิงก์นี้ใช้ไม่ได้แล้ว · This link no longer works
                        </h1>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            ลิงก์ถูกใช้ไปแล้วหรือหมดอายุ — กลับไปที่แอปแล้วลองเข้าสู่ระบบ
                            หรือขออีเมลฉบับใหม่จากหน้าเข้าสู่ระบบ
                        </p>
                        <p className="text-slate-500 text-xs leading-relaxed">
                            The link was already used or has expired. Head back to the app and
                            try signing in, or request a fresh email from the sign-in screen.
                        </p>
                        {errorMessage && (
                            <p className="text-slate-600 text-[11px]">{errorMessage}</p>
                        )}
                        <a
                            href="/"
                            className="block w-full h-12 leading-[3rem] bg-brand-cyan text-brand-darker font-black rounded-xl text-sm uppercase tracking-widest hover:bg-white transition-colors"
                        >
                            ไปที่ CardStreet · Open CardStreet
                        </a>
                    </>
                ) : (
                    <>
                        <div className="w-16 h-16 bg-brand-green/15 rounded-full flex items-center justify-center mx-auto">
                            <MailCheck className="w-8 h-8 text-brand-green" />
                        </div>
                        <h1 className="text-white font-black text-xl">
                            {isRecovery
                                ? 'ตั้งรหัสผ่านใหม่ · Reset your password'
                                : 'ยืนยันอีเมลของคุณ · Confirm your email'}
                        </h1>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            {isRecovery
                                ? 'กดปุ่มด้านล่างเพื่อยืนยันตัวตนและตั้งรหัสผ่านใหม่'
                                : 'กดปุ่มด้านล่างเพื่อยืนยันอีเมลและเริ่มใช้งาน CardStreet'}
                        </p>
                        <p className="text-slate-500 text-xs leading-relaxed">
                            {isRecovery
                                ? 'Press the button below to verify it\'s you and set a new password.'
                                : 'Press the button below to confirm your email and start using CardStreet.'}
                        </p>
                        <button
                            onClick={confirm}
                            disabled={state === 'working'}
                            className="w-full h-12 bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black rounded-xl flex items-center justify-center gap-2 text-sm uppercase tracking-widest shadow-lg shadow-brand-cyan/20 hover:shadow-brand-cyan/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                        >
                            {state === 'working' ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    <span>กำลังยืนยัน...</span>
                                </>
                            ) : (
                                <span>{isRecovery ? 'ยืนยัน · Continue' : 'ยืนยันอีเมล · Confirm email'}</span>
                            )}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

export default function AuthConfirmPage() {
    // useSearchParams requires a Suspense boundary for prerendering.
    return (
        <Suspense fallback={null}>
            <ConfirmInner />
        </Suspense>
    );
}
