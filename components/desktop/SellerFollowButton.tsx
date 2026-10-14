'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AuthModal from '@/components/AuthModal';
import FollowList from '@/components/FollowList';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import { useFollow } from '@/lib/hooks/useFollow';
import { useTranslation } from '@/lib/hooks/useTranslation';
import type { FollowListKind } from '@/lib/follows';
import { CHAT_OPEN_EVENT, type ChatOpenDetail } from '@/lib/chat';

// Follow on the (server-rendered) seller page, with the shop's follower count
// beside it. Mirrors the mobile SellerProfile button: Following stays a
// toggle, and a signed-out visitor gets the sign-in wall instead of a no-op.
//
// On your OWN shop page this is the desktop profile view instead: Following /
// Followers counts that open the lists, and Edit profile. Desktop had no other
// way to see either.
export default function SellerFollowButton({
    sellerId,
    sellerName,
    sellerUsername = null,
    sellerAvatarUrl = null,
    pathPrefix = '',
}: {
    sellerId: string;
    sellerName: string;
    sellerUsername?: string | null;
    sellerAvatarUrl?: string | null;
    /** '' on the Thai canonical, '/en' under the English prefix. */
    pathPrefix?: string;
}) {
    const { user } = useDesktopCart();
    const { t, isThai } = useTranslation();
    const router = useRouter();
    // The sign-in wall's reason: whichever of Follow / Message was tapped.
    const [authMessage, setAuthMessage] = useState<string | null>(null);
    const [openList, setOpenList] = useState<FollowListKind | null>(null);
    const viewerId = user?.id ?? null;
    const follow = useFollow(sellerId, {
        sellerName,
        viewerId,
        onRequireAuth: () => setAuthMessage(t('authGate.follow')),
    });
    const { reload } = follow;

    useEffect(() => {
        if (!openList) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenList(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [openList]);

    const closeList = () => {
        setOpenList(null);
        // An unfollow inside the list changes the count shown here.
        reload();
    };

    if (viewerId === sellerId) {
        const countButton = (kind: FollowListKind, count: number | null) => (
            <button
                onClick={() => setOpenList(kind)}
                className="text-sm text-slate-400 hover:text-white transition-colors"
            >
                <span className="font-black text-white">{(count ?? 0).toLocaleString()}</span> {t(kind === 'following' ? 'seller.following' : 'seller.followers')}
            </button>
        );
        return (
            <div className="flex items-center gap-4 flex-wrap">
                <Link
                    href={`${pathPrefix}/settings?tab=profile`}
                    className={`h-9 px-5 rounded-lg text-xs font-black uppercase ${isThai ? 'tracking-normal' : 'tracking-widest'} flex items-center gap-2 border border-white/15 text-slate-200 hover:border-brand-cyan/50 hover:text-white transition-colors`}
                >
                    <i className="fa-solid fa-user-pen text-[11px]"></i>
                    {t('desktop.editProfile')}
                </Link>
                {follow.followers !== null && (
                    <>
                        {countButton('following', follow.following)}
                        <span className="w-px h-4 bg-white/10" aria-hidden="true"></span>
                        {countButton('followers', follow.followers)}
                    </>
                )}
                {openList && (
                    <div
                        className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
                        onClick={closeList}
                    >
                        <div
                            role="dialog"
                            aria-modal="true"
                            className="w-full max-w-md max-h-[80vh] overflow-y-auto bg-brand-dark border border-white/10 rounded-2xl shadow-2xl shadow-black/50"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <FollowList
                                kind={openList}
                                compact
                                onBack={closeList}
                                onOpenSeller={(_id, hint) => {
                                    if (!hint.username) return;
                                    setOpenList(null);
                                    router.push(`${pathPrefix}/seller/${encodeURIComponent(hint.username)}`);
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>
        );
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
            <button
                onClick={() => {
                    if (!viewerId) { setAuthMessage(t('authGate.chat')); return; }
                    const detail: ChatOpenDetail = {
                        user: { id: sellerId, username: sellerUsername, display_name: sellerName, avatar_url: sellerAvatarUrl },
                    };
                    window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail }));
                }}
                className={`h-9 px-4 rounded-lg text-xs font-black uppercase ${isThai ? 'tracking-normal' : 'tracking-widest'} flex items-center gap-2 border border-white/15 text-slate-200 hover:border-brand-cyan/50 hover:text-white transition-colors`}
            >
                <i className="fa-regular fa-comment-dots text-[12px]"></i>
                {t('chat.message')}
            </button>
            {follow.followers !== null && (
                <span className="text-sm text-slate-400">
                    <span className="font-black text-white">{follow.followers.toLocaleString()}</span> {t('seller.followers')}
                </span>
            )}
            <AuthModal isOpen={!!authMessage} onClose={() => setAuthMessage(null)} contextMessage={authMessage ?? undefined} />
        </div>
    );
}
