'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

export default function RedirectContent() {
    const searchParams = useSearchParams();
    const [url, setUrl] = useState('cardstreet://login-callback');
    // Package-less by design (see the effect below): omitting the package avoids
    // a Play Store fallback when the app isn't installed / on debug builds. The
    // effect overwrites this with the query-bearing intent on mount.
    const [intentUrl, setIntentUrl] = useState('intent://login-callback#Intent;scheme=cardstreet;end');

    // This page is the deep-link bounce target for both OAuth login and Stripe
    // Connect onboarding returns. The forwarding logic is identical; only the
    // heading differs so a returning seller doesn't see "Login Successful!".
    const isStripeReturn = !!searchParams?.get('stripe_connect');

    useEffect(() => {
        // Construct the full deeplink including access tokens in the hash and code in the search
        const hash = window.location.hash || '';
        const search = window.location.search || '';

        const standardUrl = `cardstreet://login-callback${search}${hash}`;
        setUrl(standardUrl);

        // Android Intent URL for Custom Tabs reliability (Omit package name to avoid Play Store fallback on debug builds)
        const pathAndQuery = `login-callback${search}${hash}`;
        const androidIntent = `intent://${pathAndQuery}#Intent;scheme=cardstreet;end`;
        setIntentUrl(androidIntent);

        // Attempt automatic redirect using Intent for Android, fallback to standard
        const isAndroid = /Android/i.test(navigator.userAgent);
        const redirectTarget = isAndroid ? androidIntent : standardUrl;

        console.log("Redirecting to", redirectTarget);

        // Slight delay helps prevent immediate drop
        const timer = setTimeout(() => {
            window.location.href = redirectTarget;
        }, 500);

        return () => clearTimeout(timer);
    }, [searchParams]);

    return (
        <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-brand-darker text-white p-6 font-sans">
            <div className="w-20 h-20 bg-gradient-to-br from-[#22d3ee] to-[#4ade80] rounded-[2rem] flex items-center justify-center mb-8 shadow-lg shadow-[#22d3ee]/20">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-brand-darker" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>

            <h1 className="text-3xl font-black mb-4 text-center">
                {isStripeReturn ? 'All set!' : 'Login Successful!'}
            </h1>

            <p className="text-slate-400 text-center mb-10 max-w-sm leading-relaxed">
                If you are not automatically redirected, please tap the button below to return to the app.
            </p>

            <button
                onClick={() => {
                    const isAndroid = /Android/i.test(navigator.userAgent);
                    window.location.href = isAndroid ? intentUrl : url;
                }}
                className="bg-white text-brand-darker font-black py-4 px-10 rounded-2xl shadow-xl active:scale-95 transition-all text-lg flex items-center gap-3 w-full max-w-xs justify-center"
            >
                <span>Return to App</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
            </button>

            <a href={url} className="mt-8 text-sm text-slate-500 underline">Alternative Link</a>
        </div>
    )
}
