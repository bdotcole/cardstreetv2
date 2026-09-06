'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { marketplaceService, MarketplaceListing, ProfileIncompleteError } from '@/services/marketplaceService';
import { pokemonService } from '@/services/pokemonService';
import { sealedProductToCard } from '@/lib/sealedProduct';
import { getPreviewUrl, getThumbnailUrl, shouldSkipNextOptimization } from '@/lib/imageUtils';
import { SELLER_REQUIRED_PROFILE_FIELDS, checkSellerProfileComplete, isStripeOnlyIncomplete } from '@/lib/profileValidation';
import { useToast } from '@/lib/contexts/ToastContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import ListingForm from '@/components/ListingForm';
import AuthModal from '@/components/AuthModal';
import SellerStateBanner from '@/components/SellerStateBanner';
import SellerChecklist from '@/components/SellerChecklist';
import MostWantedList from '@/components/MostWantedList';
import { resolveSellerState, needsPayoutActionInState } from '@/lib/sellerState';
import StripePreScreen from '@/components/StripePreScreen';
import { Card } from '@/types';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import { formatTHB } from '@/components/desktop/DesktopMarketplace';

interface StripeStatus {
    connected: boolean;
    chargesEnabled: boolean | null;
    detailsSubmitted: boolean | null;
}

export default function DesktopSell() {
    const searchParams = useSearchParams();
    const { showToast } = useToast();
    const { t, isThai } = useTranslation();

    // Shared auth state from the cart provider (single gotrue subscription
    // for the whole desktop shell).
    const { user, authChecked } = useDesktopCart();
    const [authOpen, setAuthOpen] = useState(false);

    const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
    const [stripeLoading, setStripeLoading] = useState(false);
    const [showPreScreen, setShowPreScreen] = useState(false);
    const [profileIncomplete, setProfileIncomplete] = useState(false);
    // Raw profile row, so the shared seller-state helper can be given the same
    // inputs the mobile shell gives it (see lib/sellerState.ts).
    const [sellerProfile, setSellerProfile] = useState<Record<string, string | boolean | null> | null>(null);
    // Focus target for the checklist's "list one" step.
    const searchInputRef = useRef<HTMLInputElement>(null);

    // What's being listed: single cards or sealed products (boxes, ETBs, ...).
    // Sealed results are mapped to Card-shaped snapshots so the same results
    // grid and ListingForm flow works unchanged.
    const [mode, setMode] = useState<'cards' | 'sealed'>('cards');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Card[]>([]);
    const [searching, setSearching] = useState(false);
    const [searched, setSearched] = useState(false);

    const [listingCard, setListingCard] = useState<Card | null>(null);
    const [myListings, setMyListings] = useState<MarketplaceListing[]>([]);

    // Inline quick price edit on a live listing (one at a time, keyed by listing id)
    const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
    const [priceDraft, setPriceDraft] = useState('');
    const [savingPrice, setSavingPrice] = useState(false);

    const refreshMyListings = useCallback(() => {
        marketplaceService.getMyListings().then(setMyListings);
    }, []);

    useEffect(() => {
        if (!user) {
            setMyListings([]);
            setStripeStatus(null);
            return;
        }
        refreshMyListings();

        // Force a Stripe re-read when we just landed back from hosted onboarding.
        const justReturned = searchParams?.get('stripe_connect') === 'complete';
        fetch(`/api/stripe/connect/status${justReturned ? '?refresh=1' : ''}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => data && setStripeStatus(data))
            .catch(() => setStripeStatus(null));

        const supabase = createClient();
        supabase
            .from('profiles')
            .select(SELLER_REQUIRED_PROFILE_FIELDS.join(','))
            .eq('id', user.id)
            .single<Record<string, string | boolean | null>>()
            .then(({ data }) => {
                if (data) {
                    // Stripe-only incompleteness is the amber payouts banner's
                    // job (and listings save as drafts now) — the red profile
                    // panel is for missing shipping fields only.
                    const completeness = checkSellerProfileComplete(data);
                    setProfileIncomplete(
                        !completeness.complete && !isStripeOnlyIncomplete(completeness.missing)
                    );
                    setSellerProfile(data as Record<string, string | boolean | null>);
                }
            });
    }, [user, searchParams, refreshMyListings]);

    const startStripeOnboarding = async () => {
        setStripeLoading(true);
        try {
            const origin = window.location.origin;
            const res = await fetch('/api/stripe/connect/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    returnUrl: `${origin}/sell?stripe_connect=complete`,
                    refreshUrl: `${origin}/sell?stripe_connect=refresh`,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.url) throw new Error(data.error || t('desktop.sell.toastStripeError'));
            window.location.href = data.url;
        } catch (err: any) {
            showToast(err.message || t('desktop.sell.toastStripeError'), 'error');
            setStripeLoading(false);
        }
    };

    // Show the prep step before handing off, unless the seller already
    // submitted the KYC form (nothing left to prepare — they're fixing a
    // specific field). Mirrors StripeConnectSection's launchOnboarding.
    const launchStripeOnboarding = () => {
        if (stripeStatus?.detailsSubmitted) startStripeOnboarding();
        else setShowPreScreen(true);
    };

    // Universal search: every game and every language. A seller listing a Thai
    // print or a One Piece box shouldn't have to pick the right catalog first —
    // the result tiles carry set + number + art to disambiguate.
    const runSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const q = query.trim();
        if (q.length < 2) return;
        setSearching(true);
        setSearched(true);
        try {
            if (mode === 'sealed') {
                const products = await pokemonService.fetchSealedProducts({ game: 'all', q });
                setResults(products.map(sealedProductToCard));
            } else {
                const cards = await pokemonService.searchCards(q, false, undefined, 'all');
                setResults(cards);
            }
        } finally {
            setSearching(false);
        }
    };

    const publishListing = async (listingData: any) => {
        if (!listingCard) return;
        try {
            const created = await marketplaceService.createListing({
                cardId: listingCard.id,
                cardData: listingCard,
                price: listingData.price,
                condition: listingData.condition,
                isGraded: listingData.is_graded,
                gradingCompany: listingData.grading_company,
                grade: listingData.grade,
                image_front_url: listingData.image_front_url,
                image_back_url: listingData.image_back_url,
                acceptsOffers: listingData.accepts_offers,
                quantity: listingData.quantity,
            });
            setListingCard(null);
            if (created?.status === 'draft') {
                // Stripe onboarding unfinished — saved as a draft that goes
                // live automatically once the seller completes setup. The
                // amber payouts banner above carries the resume CTA.
                showToast(t('desktop.sell.toastDraftSaved'), 'success');
            } else {
                showToast(t('desktop.sell.toastPublished'), 'success');
            }
            refreshMyListings();
        } catch (error) {
            if (error instanceof ProfileIncompleteError) {
                setListingCard(null);
                setProfileIncomplete(true);
                showToast(t('desktop.sell.toastCompleteShipping'), 'error');
                return;
            }
            throw error; // ListingForm surfaces the message inline
        }
    };

    const cancelListing = async (listing: MarketplaceListing) => {
        if (!window.confirm(t('desktop.sell.cancelConfirm'))) return;
        const ok = await marketplaceService.cancelListing(listing.id);
        if (ok) {
            showToast(t('desktop.sell.toastCancelled'), 'success');
            refreshMyListings();
        } else {
            showToast(t('desktop.sell.toastCancelFailed'), 'error');
        }
    };

    const draftPrice = parseFloat(priceDraft);
    // Mirror the bounds enforced by /api/listings' zod schema.
    const isPriceDraftValid = Number.isFinite(draftPrice) && draftPrice > 0 && draftPrice <= 10_000_000;

    const savePrice = async (listing: MarketplaceListing) => {
        if (!isPriceDraftValid || savingPrice) return;
        if (draftPrice === Number(listing.price)) {
            setEditingPriceId(null);
            return;
        }
        setSavingPrice(true);
        try {
            const ok = await marketplaceService.updateListingPrice(listing.id, draftPrice);
            if (ok) {
                showToast(t('desktop.sell.toastPriceUpdated'), 'success');
                setEditingPriceId(null);
            } else {
                // Sold/cancelled while editing — the refresh below reconciles.
                showToast(t('desktop.sell.toastPriceUpdateFailed'), 'error');
            }
            refreshMyListings();
        } catch {
            showToast(t('desktop.sell.toastPriceUpdateFailed'), 'error');
        } finally {
            setSavingPrice(false);
        }
    };

    if (!authChecked) {
        return <div className="h-64 rounded-2xl bg-white/5 animate-pulse"></div>;
    }

    if (!user) {
        return (
            <div className="text-center py-24">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                    <i className="fa-solid fa-tag text-2xl text-slate-600"></i>
                </div>
                <h1 className="text-white font-bold uppercase tracking-widest text-sm mb-1">{t('desktop.sell.signedOutTitle')}</h1>
                <p className="text-slate-500 text-sm mb-6">{t('desktop.sell.signedOutDesc')}</p>
                <button
                    onClick={() => setAuthOpen(true)}
                    className="bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black px-6 py-2.5 rounded-xl transition-colors"
                >
                    {t('desktop.signIn')}
                </button>
                <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
            </div>
        );
    }

    // One derivation for both shells. The old banner keyed on chargesEnabled
    // alone, so a seller Stripe was still reviewing was told to "finish payout
    // setup" and handed a button that reopened a form they had completed.
    const sellerState = resolveSellerState(!!user, sellerProfile, stripeStatus);

    return (
        <div>
            <h1 className="text-2xl font-black text-white">{t('desktop.sell.title')}</h1>
            <p className="text-sm text-slate-400 mt-1">{t('desktop.sell.subtitle')}</p>

            {stripeStatus && (
                <SellerStateBanner
                    state={sellerState}
                    busy={stripeLoading}
                    className="mt-6"
                    onAction={
                        needsPayoutActionInState(sellerState)
                            ? launchStripeOnboarding
                            : sellerState === 'shipping_incomplete'
                                // Plain navigation, not the router: /settings is
                                // middleware-routed per device, so it must be a
                                // real request.
                                ? () => { window.location.href = '/settings?tab=profile'; }
                                : undefined
                    }
                />
            )}

            {/* Back from Stripe's hosted onboarding — the moment the seller has
                just done something effortful and has no idea what remains.
                Shown only on that return, not permanently. */}
            {searchParams?.get('stripe_connect') === 'complete' && (
                <div className="mt-6 max-w-2xl">
                    <SellerChecklist
                        state={sellerState}
                        hasListing={myListings.length > 0}
                        onFixShipping={() => { window.location.href = '/settings?tab=profile'; }}
                        onSetupPayouts={launchStripeOnboarding}
                        onList={() => searchInputRef.current?.focus()}
                    />
                </div>
            )}

            {profileIncomplete && (
                <div className="bg-brand-red/10 border border-brand-red/30 rounded-2xl px-5 py-4 mt-4">
                    <p className="text-rose-300 font-bold text-sm">{t('desktop.sell.incompleteTitle')}</p>
                    <p className="text-slate-400 text-xs mt-0.5">
                        {t('desktop.sell.incompleteBody1')}
                        <a href="/settings?tab=profile" className="text-brand-cyan hover:underline">{t('desktop.sell.incompleteLink')}</a>
                        {t('desktop.sell.incompleteBody2')}
                    </p>
                </div>
            )}

            <form onSubmit={runSearch} className="mt-8">
                <div className="flex flex-wrap gap-2 mb-4">
                    {/* Cards / Sealed toggle — mirrors the mobile Explore toggle.
                        There is deliberately no game or language picker: search
                        spans every catalog, so typing the name is enough. */}
                    <div className="flex gap-1 bg-white/5 border border-white/10 rounded-full p-1">
                        {(['cards', 'sealed'] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => {
                                    if (mode === m) return;
                                    setMode(m);
                                    setResults([]);
                                    setSearched(false);
                                }}
                                className={`px-4 py-1 rounded-full text-xs font-bold transition-colors ${
                                    mode === m
                                        ? 'bg-brand-cyan text-brand-darker'
                                        : 'text-slate-300 hover:text-white'
                                }`}
                            >
                                {m === 'cards' ? (isThai ? 'การ์ด' : 'Cards') : (isThai ? 'สินค้าซีล' : 'Sealed')}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex gap-3">
                    <div className="relative flex-1 max-w-2xl">
                        <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
                        <input
                            ref={searchInputRef}
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('desktop.sell.searchPlaceholder')}
                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-11 pr-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-brand-cyan/50 transition-colors"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={searching || query.trim().length < 2}
                        className="bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black px-6 py-2.5 rounded-xl transition-colors disabled:opacity-50"
                    >
                        {searching ? t('desktop.sell.searching') : t('desktop.sell.search')}
                    </button>
                </div>
            </form>

            {searched && !searching && results.length === 0 && (
                <p className="text-slate-500 text-sm mt-6">{t('desktop.sell.noMatches')}</p>
            )}

            {results.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-6">
                    {results.map((card) => {
                        const imageUrl = getPreviewUrl(card.images?.small || card.imageUrl);
                        return (
                            <div key={card.id} className="bg-slate-800/40 border border-white/5 rounded-2xl overflow-hidden">
                                <div className="relative aspect-[3/4] bg-brand-darker">
                                    <Image
                                        src={imageUrl}
                                        alt={card.name}
                                        fill
                                        sizes="(min-width: 1024px) 16vw, 40vw"
                                        loading="lazy"
                                        unoptimized={shouldSkipNextOptimization(imageUrl)}
                                        className={card.isSealed ? 'object-contain p-2' : 'object-cover'}
                                    />
                                </div>
                                <div className="p-3">
                                    <h3 className="text-sm font-bold text-white truncate">{card.name}</h3>
                                    <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">
                                        {card.isSealed ? card.set : `${card.set}${card.number ? ` · #${card.number}` : ''}`}
                                    </p>
                                    {card.marketPrice > 0 && (
                                        <p className="text-xs text-slate-400 mt-1">{t('desktop.marketShort')} {formatTHB(card.marketPrice)}</p>
                                    )}
                                    <button
                                        onClick={() => setListingCard(card)}
                                        className="w-full mt-2.5 bg-brand-cyan/10 hover:bg-brand-cyan text-brand-cyan hover:text-brand-darker border border-brand-cyan/30 text-xs font-black py-2 rounded-lg transition-colors"
                                    >
                                        {t('desktop.sell.listThis')}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* What buyers are asking for and nobody is selling. Above the
                seller's own listings on purpose: it is the only part of this
                page that answers "what should I list next". */}
            <div className="mt-12 max-w-2xl">
                {/* No ownedCardIds here: this page loads the seller's LISTINGS,
                    not their vault, and every card with an active listing is
                    already excluded server-side — passing them would highlight
                    nothing. The mobile vault does have the collection and
                    passes it. */}
                <MostWantedList onSelect={(cardId) => { window.location.href = `/card/${cardId}`; }} />
            </div>

            <h2 className="text-sm font-black text-white uppercase tracking-widest mt-12 mb-4">
                {t('desktop.sell.yourListings')} <span className="text-slate-500">({myListings.length})</span>
            </h2>
            {myListings.length === 0 ? (
                <p className="text-slate-500 text-sm">{t('desktop.sell.noListings')}</p>
            ) : (
                <div className="space-y-2">
                    {myListings.map((listing) => (
                        <div
                            key={listing.id}
                            className="flex items-center justify-between gap-4 bg-slate-800/40 border border-white/5 rounded-xl px-4 py-3"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <span className="w-10 h-14 rounded-md bg-brand-darker overflow-hidden shrink-0 border border-white/10">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={getThumbnailUrl(listing.card_data.images?.small || listing.card_data.imageUrl)}
                                        alt=""
                                        loading="lazy"
                                        className={`w-full h-full ${listing.card_data.isSealed ? 'object-contain' : 'object-cover'}`}
                                    />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-white truncate">
                                        {listing.card_data.name}
                                        {listing.status === 'draft' && (
                                            <span className="ml-2 align-middle inline-block bg-amber-400/15 border border-amber-400/40 text-amber-300 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded">
                                                {t('desktop.sell.draftBadge')}
                                            </span>
                                        )}
                                    </p>
                                    <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wide truncate">
                                        {listing.card_data.set} · {listing.condition}
                                        {listing.is_graded && listing.grading_company ? ` · ${listing.grading_company} ${listing.grade ?? ''}` : ''}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                                {editingPriceId === listing.id ? (
                                    <>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-black">฿</span>
                                            <input
                                                type="number"
                                                min="1"
                                                autoFocus
                                                value={priceDraft}
                                                onChange={(e) => setPriceDraft(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') savePrice(listing);
                                                    if (e.key === 'Escape') setEditingPriceId(null);
                                                }}
                                                className="w-32 bg-brand-darker border border-white/10 focus:border-brand-cyan/50 rounded-lg pl-7 pr-2 py-2 text-white text-sm font-black outline-none transition-colors"
                                            />
                                        </div>
                                        <button
                                            onClick={() => savePrice(listing)}
                                            disabled={savingPrice || !isPriceDraftValid}
                                            className="bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-xs font-black px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
                                        >
                                            {savingPrice ? <i className="fa-solid fa-spinner fa-spin"></i> : t('desktop.sell.savePrice')}
                                        </button>
                                        <button
                                            onClick={() => setEditingPriceId(null)}
                                            disabled={savingPrice}
                                            aria-label={t('desktop.sell.cancel')}
                                            className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors"
                                        >
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-lg font-black text-brand-cyan">{formatTHB(listing.price)}</span>
                                        <button
                                            onClick={() => {
                                                setPriceDraft(String(listing.price));
                                                setEditingPriceId(listing.id);
                                            }}
                                            className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                                        >
                                            {t('desktop.sell.editPrice')}
                                        </button>
                                        <button
                                            onClick={() => cancelListing(listing)}
                                            className="bg-white/5 hover:bg-brand-red/20 border border-white/10 hover:border-brand-red/40 text-slate-400 hover:text-rose-300 text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                                        >
                                            {t('desktop.sell.cancel')}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {listingCard && (
                <ListingForm
                    card={listingCard}
                    onClose={() => setListingCard(null)}
                    onSuccess={publishListing}
                />
            )}

            {showPreScreen && (
                <StripePreScreen
                    onCancel={() => setShowPreScreen(false)}
                    onContinue={() => {
                        setShowPreScreen(false);
                        startStripeOnboarding();
                    }}
                    loading={stripeLoading}
                />
            )}
        </div>
    );
}
