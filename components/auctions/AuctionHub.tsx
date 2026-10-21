'use client';

/**
 * Mobile auction hub (beta) -- full-screen overlay reachable from the
 * Marketplace header when the caller has the 'auctions' beta flag. Non-beta
 * users never see the entry point, and the server would 404 them anyway.
 *
 * Tabs: Live (browse) / Bidding / Won / Selling. Payment for wins runs
 * through the EXISTING PaymentModal in pay-existing-orders mode
 * (existingTransferGroup) -- same Stripe rail as the cart.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getThumbnailUrl } from '@/lib/imageUtils';
import AuctionDetailModal from './AuctionDetailModal';
import {
    AuctionRecord,
    COUNTDOWN_DANGER_MS,
    computeServerOffset,
    formatTimeLeft,
    satangToDisplay,
} from './auctionShared';

const PaymentModal = dynamic(() => import('@/components/PaymentModal'), { ssr: false });

type Scope = 'live' | 'bidding' | 'won' | 'selling';

interface AuctionHubProps {
    isOpen: boolean;
    onClose: () => void;
    /** 'overlay' = full-screen mobile takeover; 'page' = inline block for the
     *  /auctions route (desktop shell or standalone). */
    variant?: 'overlay' | 'page';
}

const AuctionHub: React.FC<AuctionHubProps> = ({ isOpen, onClose, variant = 'overlay' }) => {
    const { t, isThai } = useTranslation();
    const [scope, setScope] = useState<Scope>('live');
    const [auctions, setAuctions] = useState<AuctionRecord[]>([]);
    const [userId, setUserId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [serverOffset, setServerOffset] = useState(0);
    const [nowTick, setNowTick] = useState(Date.now());
    const [detailId, setDetailId] = useState<string | null>(null);
    const [payTransferGroup, setPayTransferGroup] = useState<string | null>(null);
    const [banner, setBanner] = useState<string | null>(null);

    const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async (s: Scope) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/auctions?scope=${s}`);
            if (res.ok) {
                const data = await res.json();
                setAuctions(data.auctions ?? []);
                setUserId(data.userId ?? null);
                setServerOffset(computeServerOffset(data.serverNow));
            } else {
                setAuctions([]);
            }
        } catch {
            setAuctions([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) load(scope);
    }, [isOpen, scope, load]);

    // Countdown tick (only while open).
    useEffect(() => {
        if (!isOpen) return;
        const id = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [isOpen]);

    // Realtime: any auctions change → debounced list refetch (listings pattern).
    useEffect(() => {
        if (!isOpen) return;
        const supabase = createClient();
        const scheduleRefetch = () => {
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
            refetchTimer.current = setTimeout(() => {
                refetchTimer.current = null;
                load(scope);
            }, 1500);
        };
        const channel = supabase
            .channel('auctions-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions' }, scheduleRefetch)
            .subscribe();
        return () => {
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
            supabase.removeChannel(channel);
        };
    }, [isOpen, scope, load]);

    if (!isOpen) return null;

    const tabs: { key: Scope; label: string }[] = [
        { key: 'live', label: t('auction.tabLive') || 'Live' },
        { key: 'bidding', label: t('auction.tabBidding') || 'My bids' },
        { key: 'won', label: t('auction.tabWon') || 'Won' },
        { key: 'selling', label: t('auction.tabSelling') || 'Selling' },
    ];

    const renderTile = (a: AuctionRecord) => {
        const remainingMs = Date.parse(a.ends_at) - (nowTick + serverOffset);
        const live = a.status === 'live' && remainingMs > 0;
        const img = getThumbnailUrl(a.card_data?.images?.small || a.card_data?.imageUrl || a.image_front_url || '');
        const isHigh = userId && a.high_bidder_id === userId;
        const offeredToMe = userId && a.second_chance_status === 'offered' && a.second_chance_offered_to === userId;
        const payable = userId && a.winner_id === userId && a.order?.status === 'pending_payment' && a.order?.transfer_group;

        return (
            <button
                key={a.id}
                onClick={() => setDetailId(a.id)}
                className="w-full text-left bg-white/5 border border-white/10 rounded-2xl p-3 flex gap-3 hover:border-brand-cyan/40 transition-colors"
            >
                <div className="w-16 h-22 min-h-[5.5rem] bg-brand-darker rounded-lg border border-white/10 overflow-hidden flex-shrink-0">
                    {img && <img src={img} alt={a.card_data?.name} loading="lazy" className={`w-full h-full ${a.card_data?.isSealed ? 'object-contain' : 'object-cover'}`} />}
                </div>
                <div className="min-w-0 flex-1">
                    <h4 className="text-white text-sm font-bold truncate">{a.card_data?.name}</h4>
                    <p className="text-[10px] text-slate-500 truncate">{a.condition}{a.is_graded ? ` · ${a.grading_company} ${a.grade}` : ''}</p>
                    <p className="text-lg font-black text-white mt-1">{satangToDisplay(a.status === 'sold' ? a.winning_amount : a.current_price)}</p>
                    <p className="text-[10px] text-slate-400 font-bold">
                        {(t('auction.bidCount') || '{n} bids').replace('{n}', String(a.bid_count))}
                        {a.buy_now_price != null && a.bid_count === 0 && live && (
                            <span className="text-brand-purple"> · BIN {satangToDisplay(a.buy_now_price)}</span>
                        )}
                    </p>
                </div>
                <div className="text-right flex-shrink-0 flex flex-col items-end justify-between">
                    <span className={`text-[11px] font-black ${live && remainingMs <= COUNTDOWN_DANGER_MS ? 'text-brand-red animate-pulse' : live ? 'text-brand-cyan' : 'text-slate-500'}`}>
                        {live ? formatTimeLeft(remainingMs, isThai) : (t(`auction.status_${a.status}`) || a.status)}
                    </span>
                    {isHigh && live && (
                        <span className="text-[8px] font-black uppercase tracking-widest text-brand-green bg-brand-green/10 border border-brand-green/20 px-1.5 py-0.5 rounded-full">
                            {t('auction.highBidder') || 'High bidder'}
                        </span>
                    )}
                    {offeredToMe && (
                        <span className="text-[8px] font-black uppercase tracking-widest text-brand-purple bg-brand-purple/10 border border-brand-purple/30 px-1.5 py-0.5 rounded-full">
                            {t('auction.offerBadge') || '2nd chance'}
                        </span>
                    )}
                    {payable && (
                        <span className="text-[8px] font-black uppercase tracking-widest text-brand-darker bg-brand-green px-1.5 py-0.5 rounded-full">
                            {t('auction.payNow') || 'Pay now'}
                        </span>
                    )}
                </div>
            </button>
        );
    };

    const isOverlay = variant === 'overlay';

    return (
        <div className={isOverlay
            ? 'fixed inset-0 z-[65] bg-brand-darker flex flex-col animate-fadeIn'
            : 'w-full max-w-3xl mx-auto flex flex-col min-h-[70vh]'}>
            {/* Header */}
            <div className="flex-shrink-0 px-6 pt-6 pb-3" style={isOverlay ? { paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' } : undefined}>
                <div className="flex items-center gap-4 mb-4">
                    {isOverlay && (
                        <button onClick={onClose} className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center active:scale-90 transition-all">
                            <i className="fa-solid fa-chevron-left text-slate-400 text-xs"></i>
                        </button>
                    )}
                    <div>
                        <h2 className="text-2xl font-black text-white tracking-tighter italic skew-x-[-6deg]">
                            {t('auction.hubTitle') || 'Auctions'} <span className="text-amber-400">{t('auction.hubBeta') || 'Beta'}</span>
                        </h2>
                    </div>
                </div>
                <div className="flex gap-2">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => setScope(tab.key)}
                            className={`flex-1 h-9 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${scope === tab.key
                                ? 'bg-amber-400 text-brand-darker border-amber-400'
                                : 'bg-white/5 text-slate-400 border-white/10'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {banner && (
                <div className="mx-6 mb-2 p-3 bg-brand-green/10 border border-brand-green/20 rounded-xl text-brand-green text-xs font-bold flex justify-between items-center">
                    <span>{banner}</span>
                    <button onClick={() => setBanner(null)}><i className="fa-solid fa-xmark"></i></button>
                </div>
            )}

            {/* List */}
            <div className={`flex-1 px-6 space-y-3 ${isOverlay ? 'overflow-y-auto pb-24' : 'pb-8'}`}>
                {loading && auctions.length === 0 && (
                    <div className="flex items-center justify-center gap-2 text-slate-400 text-xs py-16">
                        <i className="fa-solid fa-circle-notch fa-spin"></i> {t('common.loading') || 'Loading…'}
                    </div>
                )}
                {!loading && auctions.length === 0 && (
                    <div className="text-center py-16">
                        <i className="fa-solid fa-gavel text-3xl text-slate-700 mb-3"></i>
                        <p className="text-slate-500 text-sm font-bold">{t('auction.empty') || 'Nothing here yet'}</p>
                        {scope === 'selling' && (
                            <p className="text-slate-600 text-xs mt-1">{t('auction.emptySelling') || 'Start an auction from your Vault — choose "Auction" when listing a card.'}</p>
                        )}
                    </div>
                )}
                {auctions.map(renderTile)}
            </div>

            {/* Detail */}
            {detailId && (
                <AuctionDetailModal
                    auctionId={detailId}
                    onClose={() => setDetailId(null)}
                    onChanged={() => load(scope)}
                    onPay={(tg) => {
                        setDetailId(null);
                        setPayTransferGroup(tg);
                    }}
                />
            )}

            {/* Payment (existing rail, pay-existing-orders mode) */}
            {payTransferGroup && (
                <PaymentModal
                    isOpen={true}
                    onClose={() => setPayTransferGroup(null)}
                    amount={0}
                    currency="THB"
                    items={[]}
                    apiEndpoint="/api/checkout"
                    extraData={{ buyerId: userId }}
                    existingTransferGroup={payTransferGroup}
                    onPaymentSuccess={() => {
                        setPayTransferGroup(null);
                        setBanner(t('auction.paymentReceived') || 'Payment received — the seller is preparing your shipment.');
                        load(scope);
                    }}
                    onPaymentFailed={(err) => {
                        setBanner(`${t('paymentFlow.paymentFailed') || 'Payment failed'}: ${err}`);
                    }}
                />
            )}
        </div>
    );
};

export default AuctionHub;
