'use client';

import { useState } from 'react';
import AuthModal from '@/components/AuthModal';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import { useFollow } from '@/lib/hooks/useFollow';
import { useTranslation } from '@/lib/hooks/useTranslation';

// Follow on the (server-rendered) seller page, with the shop's follower count
// beside it. Mirrors the mobile SellerProfile button: Following stays a
// toggle, and a signed-out visitor gets the sign-in wall instead of a no-op.
export default function SellerFollowButton({ sellerId, sellerName }: { sellerId: string; sellerName: string }) {
    const { user } = useDesktopCart();
    const { t, isThai } = useTranslation();
    const [authOpen, setAuthOpen] = useState(false);
    const viewerId = user?.id ?? null;
    const follow = useFollow(sellerId, {
        sellerName,
        viewerId,
        onRequireAuth: () => setAuthOpen(true),
    });

    if (viewerId === sellerId) {
        return follow.followers !== null ? (
            <span className="text-sm text-slate-400">
                <span className="font-black text-white">{follow.followers.toLocaleString()}</span> {t('seller.followers')}
            </span>
        ) : null;
    }

    return (
        <div className="flex items-center gap-3">
            <button
                onClick={() => { void follow.toggle(); }}
                disabled={follow.busy}
                aria-pressed={follow.isFollowing}
                className={`h-9 px-5 rounded-lg text-xs font-black uppercase ${isThai ? 'tracking-normal' : 'tracking-widest'} flex items-center gap-2 transition-colors disabled:opacity-70 ${follow.isFollowing
                    ? 'border border-brand-cyan/40 text-brand-cyan hover:bg-brand-cyan/10'
                    : 'bg-white text-brand-darker hover:bg-brand-cyan'}`}
            >
                {follow.isFollowing && <i className="fa-solid fa-check text-[11px]"></i>}
                {t(follow.isFollowing ? 'seller.following' : 'seller.follow')}
            </button>
            {follow.followers !== null && (
                <span className="text-sm text-slate-400">
                    <span className="font-black text-white">{follow.followers.toLocaleString()}</span> {t('seller.followers')}
                </span>
            )}
            <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} contextMessage={t('authGate.follow')} />
        </div>
    );
}
