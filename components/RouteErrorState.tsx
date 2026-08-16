'use client';

/**
 * Shared body for the route-level error boundaries (app/error.tsx and
 * app/desktop/error.tsx). Reports to Sentry and offers a retry, so a failed
 * segment is recoverable in place instead of dead-ending the session.
 *
 * Deliberately self-contained: no context, no data fetching, no locale JSON.
 * An error boundary must not depend on the machinery that may be what failed.
 */

import * as Sentry from '@sentry/nextjs';
import { useEffect, useState } from 'react';

// Inlined rather than read through useTranslation -- that hook calls
// useUserSettings, which throws outright when its provider is missing.
const COPY = {
    EN: {
        title: 'Something went wrong',
        body: "This page didn't load. The rest of CardStreet is still working.",
        retry: 'Try again',
        home: 'Return home',
        ref: 'Reference',
    },
    TH: {
        title: 'เกิดข้อผิดพลาด',
        body: 'โหลดหน้านี้ไม่สำเร็จ ส่วนอื่นของ CardStreet ยังใช้งานได้ตามปกติ',
        retry: 'ลองอีกครั้ง',
        home: 'กลับหน้าแรก',
        ref: 'รหัสอ้างอิง',
    },
} as const;

export default function RouteErrorState({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        Sentry.captureException(error);
    }, [error]);

    // Read in an effect, not at render time, so the server render and the first
    // client paint agree. TH is the app's default everywhere else, so it is the
    // right pre-hydration guess.
    const [lang, setLang] = useState<'EN' | 'TH'>('TH');
    useEffect(() => {
        setLang(/(?:^|;\s*)cs_lang=EN(?:;|$)/.test(document.cookie) ? 'EN' : 'TH');
    }, []);

    const t = COPY[lang];

    return (
        <div className="flex flex-col items-center justify-center text-center px-6 py-20">
            <div className="w-16 h-16 rounded-3xl bg-rose-500/10 flex items-center justify-center mb-5">
                <i className="fa-solid fa-triangle-exclamation text-rose-400 text-xl"></i>
            </div>
            <h2 className="text-xl font-black text-white">{t.title}</h2>
            <p className="text-sm text-slate-400 mt-2 max-w-sm leading-snug">{t.body}</p>
            <div className="flex items-center gap-3 mt-7">
                <button
                    onClick={reset}
                    className="h-12 px-6 rounded-2xl bg-brand-cyan text-brand-darker text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all"
                >
                    {t.retry}
                </button>
                <a
                    href="/"
                    className="h-12 px-6 rounded-2xl glass border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest active:scale-95 transition-all flex items-center"
                >
                    {t.home}
                </a>
            </div>
            {/* Same digest that is attached to the Sentry event, so a user
                reporting the problem can quote something we can search on. */}
            {error.digest && (
                <p className="text-[10px] text-slate-600 mt-6 font-mono">
                    {t.ref}: {error.digest}
                </p>
            )}
        </div>
    );
}
