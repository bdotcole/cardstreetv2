'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useBetaFeatures } from '@/lib/hooks/useBetaFeatures';
import MyLiveShows from '@/components/live/MyLiveShows';

/**
 * Standalone show manager for broadcasters — the desktop-reachable home of
 * components/live/MyLiveShows.tsx (mobile reaches the same component through
 * Profile > Live shows).
 *
 * Access posture matches the other /live pages: without the 'live_broadcast'
 * grant this renders the same generic not-found block (fails closed while the
 * grant resolves), and the server 404s the underlying ?mine=1 fetch regardless
 * — no hint the feature exists.
 */

function NotFoundBlock() {
    const { t } = useTranslation();
    return (
        <div className="min-h-[70vh] flex items-center justify-center px-6 text-center">
            <div className="max-w-md">
                <p className="text-6xl font-black tracking-tight mb-3 opacity-90">404</p>
                <h1 className="text-xl font-bold mb-2">{t('live.notFound.title') || 'Page not found'}</h1>
                <p className="opacity-70 mb-6 text-sm leading-relaxed">
                    {t('live.notFound.desc') ||
                        "The page you're looking for may have moved or no longer exists."}
                </p>
                <a
                    href="/"
                    className="inline-block px-5 py-2.5 rounded-xl font-bold text-sm uppercase tracking-wider bg-brand-cyan text-black hover:opacity-90 transition-opacity"
                >
                    {t('live.notFound.back') || 'Back home'}
                </a>
            </div>
        </div>
    );
}

export default function LiveStudioPage() {
    const router = useRouter();
    const { hasBeta, loading } = useBetaFeatures();

    if (loading) {
        return (
            <main className="min-h-screen bg-brand-darker text-white flex items-center justify-center">
                <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-2xl"></i>
            </main>
        );
    }

    if (!hasBeta('live_broadcast')) {
        return (
            <main className="min-h-screen bg-brand-darker text-white">
                <NotFoundBlock />
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-brand-darker text-white">
            <div className="w-full max-w-[480px] lg:max-w-2xl mx-auto">
                <MyLiveShows onBack={() => router.push('/live')} />
            </div>
        </main>
    );
}
