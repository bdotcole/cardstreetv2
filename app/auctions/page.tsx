'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import AuctionHub from '@/components/auctions/AuctionHub';
import { useBetaFeatures } from '@/lib/hooks/useBetaFeatures';

// Standalone /auctions (beta, dark). Desktop browsers are rewritten by
// middleware to app/desktop/auctions (same hub inside the desktop shell);
// phones get this full-screen takeover. Non-beta visitors see a plain
// not-found-style shell -- the server routes 404 them regardless, so this
// page never confirms the feature exists.
export default function AuctionsPage() {
    const router = useRouter();
    const { hasBeta, loading } = useBetaFeatures();

    if (loading) return null;
    if (!hasBeta('auctions')) {
        return (
            <div className="min-h-screen bg-brand-darker flex items-center justify-center">
                <p className="text-slate-500 text-sm font-bold">404 — Not found</p>
            </div>
        );
    }

    return <AuctionHub isOpen onClose={() => router.push('/')} variant="overlay" />;
}
