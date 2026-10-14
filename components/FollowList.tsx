'use client';

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { fetchFollowList, setFollowing, type FollowListEntry, type FollowListKind } from '@/lib/follows';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useToast } from '@/lib/contexts/ToastContext';

interface FollowListProps {
    kind: FollowListKind;
    onBack: () => void;
    /** Opens a followed shop's page (Following list only). */
    onOpenSeller?: (sellerId: string, hint: { display_name: string | null; username: string | null; avatar_url: string | null }) => void;
    /** Inside a desktop modal: no phone safe-area padding, and a close X instead of Back. */
    compact?: boolean;
}

/**
 * Profile > Following / Followers. Following is how a buyer gets back to a
 * shop they liked, so each row opens the shop, and Unfollow stays a toggle
 * (the row remains, now with Follow) so a mis-tap can be undone in place.
 */
export default function FollowList({ kind, onBack, onOpenSeller, compact = false }: FollowListProps) {
    const { t, isThai } = useTranslation();
    const { showToast } = useToast();
    const [users, setUsers] = useState<FollowListEntry[] | null>(null);
    const [failed, setFailed] = useState(false);
    // Shops unfollowed from this list, kept on screen so they can be re-followed.
    const [unfollowed, setUnfollowed] = useState<Set<string>>(new Set());
    const [busyId, setBusyId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void fetchFollowList(kind).then((res) => {
            if (cancelled) return;
            if (!res) setFailed(true);
            setUsers(res?.users ?? []);
        });
        return () => { cancelled = true; };
    }, [kind]);

    const toggle = async (entry: FollowListEntry) => {
        if (busyId) return;
        const name = entry.display_name || entry.username || 'Seller';
        const follow = unfollowed.has(entry.id);
        setBusyId(entry.id);
        const result = await setFollowing(entry.id, follow);
        setBusyId(null);
        if (!result.ok) {
            showToast(t(result.code === 'NOT_AVAILABLE' ? 'seller.followUnavailable' : 'seller.followFailed'), 'error');
            return;
        }
        setUnfollowed((prev) => {
            const next = new Set(prev);
            if (follow) next.delete(entry.id);
            else next.add(entry.id);
            return next;
        });
        showToast(t(follow ? 'seller.followedToast' : 'seller.unfollowedToast').replace('{name}', name), 'success');
    };

    const title = t(kind === 'following' ? 'follows.followingTitle' : 'follows.followersTitle');

    return (
        <div
            className={compact ? 'p-5 space-y-5' : 'p-4 pt-16 space-y-6'}
            style={compact ? undefined : { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 120px)' }}
        >
            <div className={`flex items-center gap-4 ${compact ? 'justify-between' : 'mb-6'}`}>
                {!compact && (
                    <button onClick={onBack} className="p-2 -ml-2 hover:bg-white/5 rounded-xl transition-colors" aria-label="Back">
                        <ChevronLeft className="w-5 h-5 text-slate-400" />
                    </button>
                )}
                <h2 className={`text-lg font-black text-white uppercase ${isThai ? 'tracking-normal' : 'tracking-wide'}`}>{title}</h2>
                {compact && (
                    <button onClick={onBack} className="p-2 -mr-2 hover:bg-white/5 rounded-xl transition-colors" aria-label="Close">
                        <X className="w-5 h-5 text-slate-400" />
                    </button>
                )}
            </div>

            {users === null ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
                </div>
            ) : users.length === 0 ? (
                <div className="glass p-6 rounded-2xl border border-white/5 text-center text-sm text-slate-400 leading-relaxed">
                    {failed ? t('follows.loadFailed') : t(kind === 'following' ? 'follows.emptyFollowing' : 'follows.emptyFollowers')}
                </div>
            ) : (
                <div className="glass rounded-[2rem] border-white/5 overflow-hidden">
                    {users.map((entry, idx) => {
                        const name = entry.display_name || entry.username || 'Seller';
                        const isUnfollowed = unfollowed.has(entry.id);
                        const avatar = (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={entry.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.id}`}
                                alt=""
                                className="w-11 h-11 rounded-full object-cover bg-slate-900 shrink-0"
                            />
                        );
                        const border = idx !== users.length - 1 ? 'border-b border-white/[0.04]' : '';

                        if (kind === 'followers') {
                            return (
                                <div key={entry.id} className={`flex items-center gap-3 px-4 py-3 ${border}`}>
                                    {avatar}
                                    <span className="text-sm font-semibold text-white truncate">{name}</span>
                                </div>
                            );
                        }

                        return (
                            <div key={entry.id} className={`flex items-center gap-3 px-4 py-3 ${border}`}>
                                <button
                                    onClick={() => onOpenSeller?.(entry.id, { display_name: entry.display_name, username: entry.username, avatar_url: entry.avatar_url })}
                                    className="flex-1 min-w-0 flex items-center gap-3 text-left group"
                                >
                                    {avatar}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-white truncate">{name}</p>
                                        {entry.listing_count !== null && (
                                            <p className="text-[11px] text-slate-500 truncate">
                                                {entry.listing_count > 0
                                                    ? t('follows.listings').replace('{n}', entry.listing_count.toLocaleString())
                                                    : t('follows.noListings')}
                                            </p>
                                        )}
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-slate-700 group-hover:translate-x-1 transition-transform shrink-0" />
                                </button>
                                <button
                                    onClick={() => { void toggle(entry); }}
                                    disabled={busyId === entry.id}
                                    className={`shrink-0 h-8 px-3 rounded-lg text-[11px] font-bold border transition-all active:scale-95 disabled:opacity-60 ${isUnfollowed
                                        ? 'bg-white text-brand-darker border-white'
                                        : 'border-white/15 text-slate-300 hover:border-brand-red/50 hover:text-brand-red'}`}
                                >
                                    {t(isUnfollowed ? 'follows.follow' : 'follows.unfollow')}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
