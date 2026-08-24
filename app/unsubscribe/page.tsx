'use client';

/**
 * Prefetch-proof unsubscribe landing.
 *
 * Mail scanners GET every link in a message before the human ever sees it —
 * the same behavior that consumed Supabase auth tokens here (see
 * app/auth/confirm/page.tsx). So this page performs NOTHING on load: it
 * renders a confirm button, and only the button's POST to /api/unsubscribe
 * writes. A scanner loads the page and leaves the subscription intact.
 *
 * No session required — the signed token in the URL is the authorization, and
 * it can only ever switch a preference OFF. Someone unsubscribing from their
 * inbox is often not signed in on that device, and demanding a login to stop
 * mail is what turns an unsubscribe into a spam complaint.
 *
 * Bilingual inline copy (TH first): reachable straight from an email, so no
 * language cookie is guaranteed to exist.
 */

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BellOff, Check, Loader2, ShieldAlert } from 'lucide-react';

function UnsubscribeInner() {
    const searchParams = useSearchParams();
    const token = searchParams?.get('token') || '';

    const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const unsubscribe = async () => {
        setState('working');
        setErrorMessage(null);
        try {
            const res = await fetch('/api/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErrorMessage(data?.error || null);
                setState('error');
                return;
            }
            setState('done');
        } catch {
            setState('error');
        }
    };

    const invalid = !token;

    return (
        <div className="min-h-[100dvh] bg-brand-darker flex items-center justify-center p-4">
            <div className="bg-slate-900/60 border border-white/10 rounded-3xl max-w-md w-full p-8 space-y-5 text-center shadow-2xl">
                {invalid || state === 'error' ? (
                    <>
                        <div className="w-16 h-16 bg-brand-red/15 rounded-full flex items-center justify-center mx-auto">
                            <ShieldAlert className="w-8 h-8 text-brand-red" />
                        </div>
                        <h1 className="text-white font-black text-xl">
                            ลิงก์นี้ใช้ไม่ได้ · This link did not work
                        </h1>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            ปิดการแจ้งเตือนได้เองในแอป — ไปที่ โปรไฟล์ &rsaquo; การแจ้งเตือน
                            แล้วปิด &ldquo;ไลฟ์เปิดการ์ด&rdquo;
                        </p>
                        <p className="text-slate-500 text-xs leading-relaxed">
                            You can turn these off yourself in the app: Profile &rsaquo;
                            Notifications &rsaquo; Live shows.
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
                ) : state === 'done' ? (
                    <>
                        <div className="w-16 h-16 bg-brand-green/15 rounded-full flex items-center justify-center mx-auto">
                            <Check className="w-8 h-8 text-brand-green" />
                        </div>
                        <h1 className="text-white font-black text-xl">
                            ยกเลิกแล้ว · You are unsubscribed
                        </h1>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            เราจะไม่ส่งอีเมลเกี่ยวกับไลฟ์เปิดการ์ดให้คุณอีก
                            อีเมลเรื่องคำสั่งซื้อและการจัดส่งยังส่งตามปกติ
                        </p>
                        <p className="text-slate-500 text-xs leading-relaxed">
                            We will not email you about live shows again. Order and shipping
                            emails are unaffected — you can turn live shows back on any time in
                            Profile &rsaquo; Notifications.
                        </p>
                        <a
                            href="/"
                            className="block w-full h-12 leading-[3rem] bg-brand-cyan text-brand-darker font-black rounded-xl text-sm uppercase tracking-widest hover:bg-white transition-colors"
                        >
                            ไปที่ CardStreet · Open CardStreet
                        </a>
                    </>
                ) : (
                    <>
                        <div className="w-16 h-16 bg-brand-cyan/15 rounded-full flex items-center justify-center mx-auto">
                            <BellOff className="w-8 h-8 text-brand-cyan" />
                        </div>
                        <h1 className="text-white font-black text-xl">
                            หยุดอีเมลไลฟ์เปิดการ์ด? · Stop live show emails?
                        </h1>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            กดปุ่มด้านล่างเพื่อหยุดรับอีเมลแจ้งไลฟ์เปิดการ์ด
                            อีเมลเรื่องคำสั่งซื้อและการจัดส่งจะยังส่งตามปกติ
                        </p>
                        <p className="text-slate-500 text-xs leading-relaxed">
                            Press the button below to stop emails about live shows. Order and
                            shipping emails keep coming.
                        </p>
                        <button
                            onClick={unsubscribe}
                            disabled={state === 'working'}
                            className="w-full h-12 bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black rounded-xl flex items-center justify-center gap-2 text-sm uppercase tracking-widest shadow-lg shadow-brand-cyan/20 hover:shadow-brand-cyan/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                        >
                            {state === 'working' ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    <span>กำลังดำเนินการ...</span>
                                </>
                            ) : (
                                <span>ยืนยัน · Unsubscribe</span>
                            )}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

export default function UnsubscribePage() {
    // useSearchParams requires a Suspense boundary for prerendering.
    return (
        <Suspense fallback={null}>
            <UnsubscribeInner />
        </Suspense>
    );
}
