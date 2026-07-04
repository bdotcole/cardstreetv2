'use client';

/**
 * Auction detail + bid panel (mobile + desktop shared).
 *
 * Live behavior:
 *   - Countdown derives from server ends_at + a serverNow offset captured on
 *     every fetch. The client clock is never trusted for time-left.
 *   - Supabase Realtime (postgres_changes on this auction row) triggers a
 *     debounced refetch, so price / bid count / soft-close extensions appear
 *     without polling.
 *   - The client never computes price: min-next-bid and all outcomes come
 *     from the API / place_bid RPC.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getThumbnailUrl } from '@/lib/imageUtils';
import {
    AuctionBidRow,
    AuctionRecord,
    COUNTDOWN_DANGER_MS,
    computeServerOffset,
    formatTimeLeft,
    satangToDisplay,
} from './auctionShared';

interface DetailPayload {
    auction: AuctionRecord;
    bids: AuctionBidRow[];
    you: {
        id: string;
        isSeller: boolean;
        isHighBidder: boolean;
        isWinner: boolean;
        maxBid: number | null;
        secondChanceOffer: { amount: number; expiresAt: string } | null;
    };
    minNextBid: number;
    increment: number;
    serverNow: string;
}

interface AuctionDetailModalProps {
    auctionId: string;
    onClose: () => void;
    /** Open the payment flow for an existing pending order. */
    onPay: (transferGroup: string) => void;
    onChanged?: () => void;
}

const AuctionDetailModal: React.FC<AuctionDetailModalProps> = ({ auctionId, onClose, onPay, onChanged }) => {
    const { t, isThai } = useTranslation();
    const [data, setData] = useState<DetailPayload | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [serverOffset, setServerOffset] = useState(0);
    const [nowTick, setNowTick] = useState(Date.now());
    const [bidInput, setBidInput] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

    const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/auctions/${auctionId}`);
            if (!res.ok) {
                setLoadError(t('auction.loadFailed') || 'Could not load auction');
                return;
            }
            const payload: DetailPayload = await res.json();
            setData(payload);
            setServerOffset(computeServerOffset(payload.serverNow));
            setLoadError(null);
        } catch {
            setLoadError(t('auction.loadFailed') || 'Could not load auction');
        }
    }, [auctionId, t]);

    useEffect(() => { load(); }, [load]);

    // 1s countdown tick.
    useEffect(() => {
        const id = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    // Realtime: this auction's row updates → debounced refetch.
    useEffect(() => {
        const supabase = createClient();
        const scheduleRefetch = () => {
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
            refetchTimer.current = setTimeout(() => {
                refetchTimer.current = null;
                load();
            }, 400);
        };
        const channel = supabase
            .channel(`auction-${auctionId}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'auctions', filter: `id=eq.${auctionId}` },
                scheduleRefetch,
            )
            .subscribe();
        return () => {
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
            supabase.removeChannel(channel);
        };
    }, [auctionId, load]);

    const a = data?.auction;
    const remainingMs = a ? Date.parse(a.ends_at) - (nowTick + serverOffset) : 0;
    const isLive = !!a && a.status === 'live' && remainingMs > 0;
    const binAvailable = isLive && a!.buy_now_price != null && a!.bid_count === 0;

    const placeBid = async () => {
        if (!data || submitting) return;
        const thb = parseFloat(bidInput);
        if (!Number.isFinite(thb) || thb <= 0) {
            setNotice({ kind: 'err', text: t('auction.enterAmount') || 'Enter a bid amount' });
            return;
        }
        setSubmitting(true);
        setNotice(null);
        try {
            const res = await fetch(`/api/auctions/${auctionId}/bid`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ maxBidSatang: Math.round(thb * 100) }),
            });
            const out = await res.json();
            if (out.accepted) {
                setBidInput('');
                setNotice(out.is_high_bidder
                    ? { kind: 'ok', text: t('auction.youAreHighBidder') || "You're the high bidder!" }
                    : {
                        kind: 'warn',
                        text: (t('auction.instantlyOutbid') || 'Another bidder\'s max beat yours — current price is now {price}')
                            .replace('{price}', satangToDisplay(out.current_price)),
                    });
                onChanged?.();
            } else if (out.reason === 'below_min') {
                setNotice({
                    kind: 'err',
                    text: (t('auction.reasonBelowMin') || 'Bid at least {price}')
                        .replace('{price}', satangToDisplay(out.min_next_bid)),
                });
            } else if (out.reason === 'not_above_own_max') {
                setNotice({ kind: 'err', text: t('auction.reasonNotAboveOwnMax') || 'Your new max must be higher than your current max' });
            } else {
                const fallback: Record<string, string> = {
                    ended: 'This auction has ended',
                    suspended: 'Bidding is suspended on your account',
                    own_auction: "You can't bid on your own auction",
                    invalid_amount: 'Invalid amount',
                };
                setNotice({ kind: 'err', text: t(`auction.reason_${out.reason || 'unknown'}`) || out.error || fallback[out.reason] || 'Bid rejected' });
            }
            await load();
        } catch {
            setNotice({ kind: 'err', text: t('auction.bidFailed') || 'Bid failed — please retry' });
        } finally {
            setSubmitting(false);
        }
    };

    const buyNow = async () => {
        if (submitting) return;
        setSubmitting(true);
        setNotice(null);
        try {
            const res = await fetch(`/api/auctions/${auctionId}/buy-now`, { method: 'POST' });
            const out = await res.json();
            if (out.accepted && out.transferGroup) {
                onChanged?.();
                onPay(out.transferGroup);
            } else if (out.accepted && out.pendingSettlement) {
                setNotice({ kind: 'ok', text: t('auction.binPending') || 'Purchase confirmed — payment will be ready in a moment. Check "Won".' });
                onChanged?.();
                await load();
            } else {
                setNotice({ kind: 'err', text: out.error || t('auction.binFailed') || 'Buy It Now failed' });
                await load();
            }
        } catch {
            setNotice({ kind: 'err', text: t('auction.binFailed') || 'Buy It Now failed' });
        } finally {
            setSubmitting(false);
        }
    };

    const cancelAuction = async () => {
        if (submitting) return;
        if (!confirm(t('auction.cancelConfirm') || 'Cancel this auction?')) return;
        setSubmitting(true);
        try {
            const res = await fetch(`/api/auctions/${auctionId}/cancel`, { method: 'POST' });
            const out = await res.json();
            if (out.accepted) {
                onChanged?.();
                onClose();
            } else {
                setNotice({ kind: 'err', text: out.reason === 'has_bids' ? (t('auction.cancelHasBids') || 'Auctions with bids cannot be cancelled') : (out.error || 'Cancel failed') });
            }
        } finally {
            setSubmitting(false);
        }
    };

    const respondSecondChance = async (action: 'accept' | 'decline') => {
        if (submitting) return;
        setSubmitting(true);
        setNotice(null);
        try {
            const res = await fetch(`/api/auctions/${auctionId}/second-chance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            const out = await res.json();
            if (action === 'accept' && out.accepted && out.transferGroup) {
                onChanged?.();
                onPay(out.transferGroup);
            } else if (out.accepted) {
                onChanged?.();
                await load();
            } else {
                setNotice({ kind: 'err', text: out.error || (t('auction.offerGone') || 'This offer is no longer available') });
                await load();
            }
        } finally {
            setSubmitting(false);
        }
    };

    const imgSrc = a
        ? getThumbnailUrl(a.card_data?.images?.small || a.card_data?.imageUrl || a.image_front_url || '')
        : '';
    const minNextThb = data ? data.minNextBid / 100 : 0;
    const payable = a && data?.you.isWinner && a.order?.status === 'pending_payment' && a.order?.transfer_group;

    return (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative w-full max-w-md bg-[#0f172a] border border-white/10 rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl max-h-[92vh] flex flex-col animate-slideUp">
                {/* Header */}
                <div className="flex-shrink-0 p-4 border-b border-white/5 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2 py-1 rounded-full">
                            {t('auction.badge') || 'Auction'}
                        </span>
                        {a?.reserve_price != null && (
                            <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${a.reserve_met
                                ? 'text-brand-green bg-brand-green/10 border-brand-green/20'
                                : 'text-slate-400 bg-white/5 border-white/10'}`}>
                                {a.reserve_met ? (t('auction.reserveMet') || 'Reserve met') : (t('auction.reserveNotMet') || 'Reserve not met')}
                            </span>
                        )}
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 text-slate-400">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div className="overflow-y-auto p-5 space-y-4">
                    {loadError && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-bold">{loadError}</div>
                    )}
                    {!a && !loadError && (
                        <div className="flex items-center justify-center gap-2 text-slate-400 text-xs py-10">
                            <i className="fa-solid fa-circle-notch fa-spin"></i> {t('common.loading') || 'Loading…'}
                        </div>
                    )}

                    {a && (
                        <>
                            {/* Card + price block */}
                            <div className="flex gap-4">
                                <div className="w-24 h-32 bg-brand-darker rounded-lg border border-white/10 overflow-hidden flex-shrink-0">
                                    {imgSrc && <img src={imgSrc} alt={a.card_data?.name} className={`w-full h-full ${a.card_data?.isSealed ? 'object-contain' : 'object-cover'}`} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h4 className="text-white font-bold truncate">{a.card_data?.name}</h4>
                                    <p className="text-xs text-slate-400 truncate">{a.card_data?.set}{a.card_data?.number ? ` #${a.card_data.number}` : ''} · {a.condition}</p>
                                    <div className="mt-2">
                                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                            {a.bid_count > 0 ? (t('auction.currentBid') || 'Current bid') : (t('auction.startingPrice') || 'Starting price')}
                                        </p>
                                        <p className="text-3xl font-black text-white">{satangToDisplay(a.current_price)}</p>
                                        <p className="text-[11px] text-slate-400 font-bold mt-0.5">
                                            {(t('auction.bidCount') || '{n} bids').replace('{n}', String(a.bid_count))}
                                            {a.extension_count > 0 && isLive && (
                                                <span className="text-amber-400"> · {t('auction.extended') || 'extended'}</span>
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{t('auction.timeLeft') || 'Time left'}</p>
                                    <p className={`text-sm font-black ${isLive && remainingMs <= COUNTDOWN_DANGER_MS ? 'text-brand-red animate-pulse' : isLive ? 'text-brand-cyan' : 'text-slate-500'}`}>
                                        {isLive ? formatTimeLeft(remainingMs, isThai) : (t(`auction.status_${a.status}`) || a.status)}
                                    </p>
                                </div>
                            </div>

                            {notice && (
                                <div className={`p-3 rounded-xl text-xs font-bold border ${notice.kind === 'ok'
                                    ? 'bg-brand-green/10 border-brand-green/20 text-brand-green'
                                    : notice.kind === 'warn'
                                        ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                                        : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                                    {notice.text}
                                </div>
                            )}

                            {/* Second-chance offer for the caller */}
                            {data?.you.secondChanceOffer && (
                                <div className="p-4 bg-brand-purple/10 border border-brand-purple/30 rounded-xl space-y-3">
                                    <p className="text-xs text-white font-bold">
                                        {(t('auction.secondChanceText') || 'The winner didn\'t pay. Get it for your max bid of {price}.')
                                            .replace('{price}', satangToDisplay(data.you.secondChanceOffer.amount))}
                                    </p>
                                    <div className="flex gap-2">
                                        <button disabled={submitting} onClick={() => respondSecondChance('accept')}
                                            className="flex-1 h-10 bg-brand-green rounded-xl text-brand-darker text-xs font-black uppercase tracking-wider disabled:opacity-50">
                                            {t('auction.acceptAndPay') || 'Accept & Pay'}
                                        </button>
                                        <button disabled={submitting} onClick={() => respondSecondChance('decline')}
                                            className="flex-1 h-10 bg-white/5 border border-white/10 rounded-xl text-slate-300 text-xs font-black uppercase tracking-wider disabled:opacity-50">
                                            {t('auction.decline') || 'Decline'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Winner: pay now */}
                            {payable && (
                                <button
                                    onClick={() => onPay(a.order!.transfer_group!)}
                                    className="w-full h-12 bg-brand-green rounded-xl text-brand-darker font-black uppercase tracking-wider text-sm"
                                >
                                    <i className="fa-solid fa-credit-card mr-2"></i>
                                    {t('auction.payNow') || 'Pay now'}
                                    {a.payment_due_at && (
                                        <span className="ml-2 text-[10px] normal-case font-bold opacity-70">
                                            ({(t('auction.payBy') || 'due')} {new Date(a.payment_due_at).toLocaleString()})
                                        </span>
                                    )}
                                </button>
                            )}

                            {/* Bid panel */}
                            {isLive && !data?.you.isSeller && (
                                <div className="space-y-3">
                                    <div>
                                        <div className="flex justify-between items-end mb-1.5">
                                            <label className="text-xs font-bold text-slate-400 uppercase">{t('auction.yourMaxBid') || 'Your max bid'} (THB)</label>
                                            {data?.you.maxBid != null && (
                                                <span className="text-[10px] text-brand-cyan font-bold">
                                                    {(t('auction.currentMax') || 'Your max: {price}').replace('{price}', satangToDisplay(data.you.maxBid))}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <div className="relative flex-1">
                                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">฿</span>
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    min={minNextThb}
                                                    value={bidInput}
                                                    onChange={(e) => setBidInput(e.target.value)}
                                                    placeholder={minNextThb.toLocaleString()}
                                                    className="w-full h-12 bg-white/5 border border-white/10 rounded-xl pl-8 pr-3 text-white font-bold focus:border-brand-cyan outline-none placeholder-slate-600"
                                                />
                                            </div>
                                            <button
                                                onClick={placeBid}
                                                disabled={submitting}
                                                className="h-12 px-5 bg-brand-cyan rounded-xl text-brand-darker font-black uppercase tracking-wider text-xs disabled:opacity-50 active:scale-95 transition-all"
                                            >
                                                {submitting ? <i className="fa-solid fa-circle-notch fa-spin"></i> : (t('auction.placeBid') || 'Bid')}
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-slate-500 mt-1.5">
                                            {(t('auction.minBidHint') || 'Minimum bid {price}. We bid automatically for you up to your max.')
                                                .replace('{price}', satangToDisplay(data!.minNextBid))}
                                        </p>
                                        <div className="flex gap-2 mt-2">
                                            {[data!.minNextBid, data!.minNextBid + data!.increment, data!.minNextBid + 2 * data!.increment].map((v) => (
                                                <button key={v} onClick={() => setBidInput(String(v / 100))}
                                                    className="flex-1 h-8 bg-white/5 border border-white/10 rounded-lg text-[11px] font-bold text-slate-300 hover:border-brand-cyan/50">
                                                    {satangToDisplay(v)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {binAvailable && (
                                        <button
                                            onClick={buyNow}
                                            disabled={submitting}
                                            className="w-full h-12 bg-brand-purple/90 hover:bg-brand-purple rounded-xl text-white font-black uppercase tracking-wider text-xs disabled:opacity-50"
                                        >
                                            <i className="fa-solid fa-bolt mr-2"></i>
                                            {(t('auction.buyNowFor') || 'Buy It Now {price}').replace('{price}', satangToDisplay(a.buy_now_price!))}
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Seller controls */}
                            {isLive && data?.you.isSeller && (
                                <button
                                    onClick={cancelAuction}
                                    disabled={submitting || a.bid_count > 0}
                                    className="w-full h-11 bg-white/5 border border-white/10 rounded-xl text-brand-red/80 font-black uppercase tracking-wider text-xs disabled:opacity-40"
                                >
                                    {a.bid_count > 0 ? (t('auction.cancelHasBids') || 'Auctions with bids cannot be cancelled') : (t('auction.cancelAuction') || 'Cancel auction')}
                                </button>
                            )}

                            {/* Bid history */}
                            <div>
                                <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-2">{t('auction.bidHistory') || 'Bid history'}</p>
                                {data!.bids.length === 0 ? (
                                    <p className="text-xs text-slate-500 italic">{t('auction.noBids') || 'No bids yet — be the first.'}</p>
                                ) : (
                                    <div className="space-y-1.5">
                                        {data!.bids.map((b) => (
                                            <div key={b.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="text-xs text-slate-300 font-bold truncate">
                                                        {b.bidder_id === data!.you.id ? (t('auction.you') || 'You') : (b.bidder?.display_name || 'Bidder')}
                                                    </span>
                                                    {b.is_proxy && (
                                                        <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">
                                                            {t('auction.autoBid') || 'Auto'}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-right flex-shrink-0">
                                                    <span className="text-xs font-black text-white">{satangToDisplay(b.amount)}</span>
                                                    <span className="text-[9px] text-slate-500 ml-2">{new Date(b.created_at).toLocaleTimeString()}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AuctionDetailModal;
