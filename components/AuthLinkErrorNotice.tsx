'use client';

/**
 * Catches Supabase (GoTrue) email-link errors that arrive in the URL hash,
 * e.g. /#error=access_denied&error_code=otp_expired&error_description=...
 *
 * GoTrue puts verification failures in the URL fragment, which survives the
 * /api/auth/callback redirect chain but is invisible to server routes — so
 * without this the user lands on a silently logged-out app and assumes
 * signup is broken.
 *
 * The most common cause is NOT a stale link: mail providers' link scanners
 * GET the one-time confirmation URL before the human clicks it, consuming
 * the token — and, for signup links, confirming the email in the process.
 * So the guidance steers the user to simply sign in, which usually works;
 * if the account genuinely isn't confirmed, AuthModal's sign-in path routes
 * them to the verify screen with a resend button.
 *
 * Self-contained (owns its AuthModal instance) so both shells can mount it:
 * the mobile SPA (app/page.tsx) and the desktop layout (app/desktop/layout.tsx).
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import AuthModal from '@/components/AuthModal';

export default function AuthLinkErrorNotice() {
    const { t } = useTranslation();
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [authOpen, setAuthOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const hash = window.location.hash;
        if (!hash || !hash.includes('error')) return;
        const params = new URLSearchParams(hash.slice(1));
        const error = params.get('error');
        if (!error) return; // e.g. #access_token=... success hash — not ours
        setErrorCode(params.get('error_code') || error);
        // Strip the fragment so refresh / session restore doesn't re-trigger.
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }, []);

    if (!errorCode && !authOpen) return null;

    const isExpired = errorCode === 'otp_expired';

    return (
        <>
            {errorCode && (
                <div
                    className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby="auth-link-error-title"
                >
                    <div className="bg-brand-darker border border-white/10 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
                        <div className="w-14 h-14 bg-amber-400/15 rounded-full flex items-center justify-center mx-auto">
                            <i className="fa-solid fa-envelope-circle-check text-2xl text-amber-400"></i>
                        </div>
                        <h2 id="auth-link-error-title" className="text-white font-black text-xl text-center">
                            {t('authLinkError.title')}
                        </h2>
                        <p className="text-slate-400 text-sm leading-relaxed text-center">
                            {isExpired ? t('authLinkError.expiredBody') : t('authLinkError.genericBody')}
                        </p>
                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={() => setErrorCode(null)}
                                className="flex-1 h-11 bg-white/5 border border-white/10 text-white font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-white/10 transition-colors"
                            >
                                {t('authLinkError.close')}
                            </button>
                            <button
                                onClick={() => {
                                    setErrorCode(null);
                                    setAuthOpen(true);
                                }}
                                className="flex-1 h-11 bg-brand-cyan text-brand-darker font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-white transition-colors"
                            >
                                {t('authLinkError.signIn')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
        </>
    );
}
