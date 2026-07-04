'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import AuctionHub from '@/components/auctions/AuctionHub';
import { useBetaFeatures } from '@/lib/hooks/useBetaFeatures';

// Desktop-shell auction hub (beta, dark): same AuctionHub the mobile overlay
// uses, rendered inline under the desktop nav. Reached via the middleware
// rewrite from /auctions for desktop clients.
export default function DesktopAuctionsPage() {
    const router = useRouter();
    const { hasBeta, loading } = useBetaFeatures();

    if (loading) return null;
    if (!hasBeta('auctions')) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <p className="text-slate-500 text-sm font-bold">404 — Not found</p>
            </div>
        );
    }

    return <AuctionHub isOpen onClose={() => router.push('/')} variant="page" />;
}
