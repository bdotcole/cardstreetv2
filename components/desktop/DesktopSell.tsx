'use client'

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { marketplaceService, MarketplaceListing, ProfileIncompleteError } from '@/services/marketplaceService';
import { pokemonService } from '@/services/pokemonService';
import { getPreviewUrl, getThumbnailUrl, shouldSkipNextOptimization } from '@/lib/imageUtils';
import { SELLER_REQUIRED_PROFILE_FIELDS, checkSellerProfileComplete } from '@/lib/profileValidation';
import { GAMES, gameHasMultipleLanguages, getGameLanguages, defaultLanguageForGame, GameLanguageCode } from '@/lib/games';
import { useToast } from '@/lib/contexts/ToastContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import ListingForm from '@/components/ListingForm';
import AuthModal from '@/components/AuthModal';
import { Card } from '@/types';
import { formatTHB } from '@/components/desktop/DesktopMarketplace';

interface StripeStatus {
    connected: boolean;
    chargesEnabled: boolean | null;
    detailsSubmitted: boolean | null;
}

export default function DesktopSell() {
    const searchParams = useSearchParams();
    const { showToast } = useToast();
    const { t } = useTranslation();

    const [user, setUser] = useState<User | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);

    const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
    const [stripeLoading, setStripeLoading] = useState(false);
    const [profileIncomplete, setProfileIncomplete] = useState(false);

    const [game, setGame] = useState('pokemon');
    const [language, setLanguage] = useState<GameLanguageCode>('en');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Card[]>([]);
    const [searching, setSearching] = useState(false);
    const [searched, setSearched] = useState(false);

    const [listingCard, setListingCard] = useState<Card | null>(null);
    const [myListings, setMyListings] = useState<MarketplaceListing[]>([]);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => {
            setUser(data.user ?? null);
            setAuthChecked(true);
        });
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });
        return () => sub.subscription.unsubscribe();
    }, []);

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
                if (data) setProfileIncomplete(!checkSellerProfileComplete(data).complete);
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

    const runSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const q = query.trim();
        if (q.length < 2) return;
        setSearching(true);
        setSearched(true);
        try {
            const lang = gameHasMultipleLanguages(game) ? language : defaultLanguageForGame(game);
            const cards = await pokemonService.searchCards(q, false, lang, game);
            setResults(cards);
        } finally {
            setSearching(false);
        }
    };

    const publishListing = async (listingData: any) => {
        if (!listingCard) return;
        try {
            await marketplaceService.createListing({
                cardId: listingCard.id,
                cardData: listingCard,
                price: listingData.price,
                condition: listingData.condition,
                isGraded: listingData.is_graded,
                gradingCompany: listingData.grading_company,
                grade: listingData.grade,
                image_front_url: listingData.image_front_url,
                image_back_url: listingData.image_back_url,
            });
            setListingCard(null);
            showToast(t('desktop.sell.toastPublished'), 'success');
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

    const payoutsReady = stripeStatus?.chargesEnabled === true;

    return (
        <div>
            <h1 className="text-2xl font-black text-white">{t('desktop.sell.title')}</h1>
            <p className="text-sm text-slate-400 mt-1">{t('desktop.sell.subtitle')}</p>

            {stripeStatus && !payoutsReady && (
                <div className="flex flex-wrap items-center justify-between gap-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl px-5 py-4 mt-6">
                    <div>
                        <p className="text-amber-300 font-bold text-sm">
                            {stripeStatus.connected ? t('desktop.sell.payoutsFinish') : t('desktop.sell.payoutsSetup')}
                        </p>
                        <p className="text-slate-400 text-xs mt-0.5">
                            {t('desktop.sell.payoutsDesc')}
                        </p>
                    </div>
                    <button
                        onClick={startStripeOnboarding}
                        disabled={stripeLoading}
                        className="bg-amber-400 hover:bg-amber-300 text-brand-darker text-xs font-black px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
                    >
                        {stripeLoading ? t('desktop.sell.payoutsOpening') : stripeStatus.connected ? t('desktop.sell.payoutsContinue') : t('desktop.sell.payoutsStart')}
                    </button>
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
                    {GAMES.filter((g) => g.enabled).map((g) => (
                        <button
                            key={g.id}
                            type="button"
                            onClick={() => {
                                setGame(g.id);
                                setLanguage(defaultLanguageForGame(g.id));
                            }}
                            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                                game === g.id
                                    ? 'bg-brand-cyan text-brand-darker'
                                    : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                            }`}
                        >
                            {g.shortName}
                        </button>
                    ))}
                </div>
                <div className="flex gap-3">
                    <div className="relative flex-1 max-w-2xl">
                        <i className="fa-solid fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('desktop.sell.searchPlaceholder')}
                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-11 pr-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-brand-cyan/50 transition-colors"
                        />
                    </div>
                    {gameHasMultipleLanguages(game) && (
                        <select
                            value={language}
                            onChange={(e) => setLanguage(e.target.value as GameLanguageCode)}
                            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-brand-cyan/50 [&>option]:bg-brand-dark"
                        >
                            {getGameLanguages(game).map((l) => (
                                <option key={l.code} value={l.code}>{l.label}</option>
                            ))}
                        </select>
                    )}
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
                            <div key={card.id} className="bg-[#1e293b]/40 border border-white/5 rounded-2xl overflow-hidden">
                                <div className="relative aspect-[3/4] bg-brand-darker">
                                    <Image
                                        src={imageUrl}
                                        alt={card.name}
                                        fill
                                        sizes="(min-width: 1024px) 16vw, 40vw"
                                        loading="lazy"
                                        unoptimized={shouldSkipNextOptimization(imageUrl)}
                                        className="object-cover"
                                    />
                                </div>
                                <div className="p-3">
                                    <h3 className="text-sm font-bold text-white truncate">{card.name}</h3>
                                    <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">
                                        {card.set}{card.number ? ` · #${card.number}` : ''}
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
                            className="flex items-center justify-between gap-4 bg-[#1e293b]/40 border border-white/5 rounded-xl px-4 py-3"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <span className="w-10 h-14 rounded-md bg-brand-darker overflow-hidden shrink-0 border border-white/10">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={getThumbnailUrl(listing.card_data.images?.small || listing.card_data.imageUrl)}
                                        alt=""
                                        loading="lazy"
                                        className="w-full h-full object-cover"
                                    />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-white truncate">{listing.card_data.name}</p>
                                    <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wide truncate">
                                        {listing.card_data.set} · {listing.condition}
                                        {listing.is_graded && listing.grading_company ? ` · ${listing.grading_company} ${listing.grade ?? ''}` : ''}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 shrink-0">
                                <span className="text-lg font-black text-brand-cyan">{formatTHB(listing.price)}</span>
                                <button
                                    onClick={() => cancelListing(listing)}
                                    className="bg-white/5 hover:bg-brand-red/20 border border-white/10 hover:border-brand-red/40 text-slate-400 hover:text-rose-300 text-xs font-bold px-4 py-2 rounded-lg transition-colors"
                                >
                                    {t('desktop.sell.cancel')}
                                </button>
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
        </div>
    );
}
