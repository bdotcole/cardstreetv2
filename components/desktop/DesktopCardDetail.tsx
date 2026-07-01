'use client'

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { marketplaceService, MarketplaceListing } from '@/services/marketplaceService';
import { getOptimizedImageUrl, shouldSkipNextOptimization } from '@/lib/imageUtils';
import { Card } from '@/types';
import { formatTHB, listingToCartItem } from '@/components/desktop/DesktopMarketplace';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getSellerTrust } from '@/lib/sellerTrust';
import { useUserCollections } from '@/lib/hooks/useUserCollections';
import { useWishlist } from '@/lib/hooks/useWishlist';
import { useToast } from '@/lib/contexts/ToastContext';
import AuthModal from '@/components/AuthModal';
import type { User } from '@supabase/supabase-js';

export default function DesktopCardDetail({
    cardId,
    initialCard = null,
    initialListings = [],
    setId = null,
}: {
    cardId: string;
    // Provided by the server component so the initial HTML is fully rendered
    // (SEO) and there's no loading flash. When present we skip the client fetch.
    initialCard?: Card | null;
    initialListings?: MarketplaceListing[];
    // The card's set id, for the breadcrumb link to its set page.
    setId?: string | null;
}) {
    const { addItem } = useDesktopCart();
    const { t } = useTranslation();
    const { showToast } = useToast();
    const { collections, addCollection, addCardToCollection } = useUserCollections();
    const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
    const [card, setCard] = useState<Card | null>(initialCard);
    const [listings, setListings] = useState<MarketplaceListing[]>(initialListings);
    const [loading, setLoading] = useState(!initialCard);
    // If catalog art fails to load (TCGdex outages black out most EN card
    // art), fall back to a seller's condition photo from our own storage.
    const [catalogArtFailed, setCatalogArtFailed] = useState(false);
    const [user, setUser] = useState<User | null>(null);
    const [authOpen, setAuthOpen] = useState(false);
    const [addingToCollection, setAddingToCollection] = useState(false);

    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
        const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
        return () => sub.subscription.unsubscribe();
    }, []);

    const handleAddToCollection = async () => {
        if (!card) return;
        if (!user) { setAuthOpen(true); return; }
        setAddingToCollection(true);
        try {
            // useUserCollections auto-heals a default collection for legacy
            // accounts, but a brand-new user may momentarily have none loaded —
            // create one on demand so the add never fails.
            let colId = collections[0]?.id;
            if (!colId) colId = await addCollection(t('desktop.collection.defaultName'));
            await addCardToCollection(colId, card);
            showToast(t('desktop.collection.added'), 'success');
        } catch {
            showToast(t('desktop.collection.addFailed'), 'error');
        } finally {
            setAddingToCollection(false);
        }
    };

    const handleToggleWishlist = async () => {
        if (!card) return;
        if (!user) { setAuthOpen(true); return; }
        try {
            if (isInWishlist(card.id)) {
                await removeFromWishlist(card.id);
                showToast(t('desktop.collection.wishlistRemoved'), 'success');
            } else {
                await addToWishlist(card);
                showToast(t('desktop.collection.wishlistAdded'), 'success');
            }
        } catch {
            showToast(t('desktop.collection.addFailed'), 'error');
        }
    };

    useEffect(() => {
        // Server already supplied the data — nothing to fetch.
        if (initialCard) return;
        let cancelled = false;
        (async () => {
            const rows = await marketplaceService.getListingsForCard(cardId);
            let resolved: Card | null = rows[0]?.card_data ?? null;

            // No active listings — pull the card straight from the catalog.
            // Covers Pokemon only; other games without listings 404 for now.
            if (!resolved) {
                const supabase = createClient();
                const { data } = await supabase
                    .from('pokemon_cards')
                    .select('id, name, english_name, set_id, number, rarity, image_small, image_large, language, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(market_avg, currency, last_updated)')
                    .eq('id', cardId)
                    .maybeSingle();
                if (data) resolved = mapSupabaseCardToInternal(data);
            }

            if (cancelled) return;
            setListings(rows);
            setCard(resolved);
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [cardId, initialCard]);

    if (loading) {
        return (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,380px)_1fr] gap-10">
                <div className="rounded-2xl bg-white/5 animate-pulse aspect-[3/4]"></div>
                <div className="space-y-4">
                    <div className="h-8 w-2/3 rounded bg-white/5 animate-pulse"></div>
                    <div className="h-4 w-1/3 rounded bg-white/5 animate-pulse"></div>
                    <div className="h-20 rounded-xl bg-white/5 animate-pulse mt-8"></div>
                    <div className="h-20 rounded-xl bg-white/5 animate-pulse"></div>
                </div>
            </div>
        );
    }

    if (!card) {
        return (
            <div className="text-center py-24">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                    <i className="fa-solid fa-circle-question text-2xl text-slate-600"></i>
                </div>
                <h1 className="text-white font-bold uppercase tracking-widest text-sm mb-1">{t('desktop.card.notFoundTitle')}</h1>
                <p className="text-slate-500 text-sm mb-6">{t('desktop.card.notFoundDesc')}</p>
                <Link href="/" className="text-brand-cyan text-sm font-bold hover:text-white transition-colors">
                    {t('desktop.card.backToMarketplace')}
                </Link>
            </div>
        );
    }

    const sellerPhoto = listings.find((l) => l.image_front_url)?.image_front_url;
    const imageUrl = catalogArtFailed && sellerPhoto
        ? getOptimizedImageUrl(sellerPhoto, 640, 85)
        : getOptimizedImageUrl(card.images?.large || card.imageUrl || card.images?.small, 640, 85);

    return (
        <div>
            <nav className="text-sm text-slate-500">
                <Link href="/" className="hover:text-slate-300 transition-colors">{t('desktop.navMarketplace')}</Link>
                <span className="mx-2">›</span>
                {setId && card.set && (
                    <>
                        <Link href={`/sets/${setId}`} className="hover:text-slate-300 transition-colors">{card.set}</Link>
                        <span className="mx-2">›</span>
                    </>
                )}
                <span className="text-slate-300">{card.name}</span>
            </nav>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,380px)_1fr] gap-10 mt-6">
                <div>
                    <div className="relative aspect-[3/4] rounded-2xl overflow-hidden border border-white/10 bg-brand-darker lg:sticky lg:top-24">
                        <Image
                            src={imageUrl}
                            alt={card.name}
                            fill
                            sizes="380px"
                            priority
                            unoptimized={shouldSkipNextOptimization(imageUrl)}
                            onError={() => setCatalogArtFailed(true)}
                            className="object-cover"
                        />
                    </div>
                </div>

                <div>
                    <h1 className="text-3xl font-black text-white">{card.name}</h1>
                    <p className="text-sm text-slate-400 font-bold uppercase tracking-wide mt-2">
                        {card.set}
                        {card.number ? ` · #${card.number}` : ''}
                        {card.rarity ? ` · ${card.rarity}` : ''}
                    </p>

                    {card.marketPrice > 0 && (
                        <div className="inline-flex items-baseline gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-3 mt-5">
                            <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{t('desktop.card.marketPrice')}</span>
                            <span className="text-xl font-black text-white">{formatTHB(card.marketPrice)}</span>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 mt-6">
                        <button
                            onClick={handleAddToCollection}
                            disabled={addingToCollection}
                            className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
                        >
                            <i className="fa-solid fa-plus text-xs text-brand-green"></i>
                            {t('desktop.collection.addToCollection')}
                        </button>
                        <button
                            onClick={handleToggleWishlist}
                            className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors"
                        >
                            <i className={`${isInWishlist(card.id) ? 'fa-solid text-brand-red' : 'fa-regular text-slate-400'} fa-heart text-xs`}></i>
                            {isInWishlist(card.id) ? t('desktop.collection.wishlisted') : t('desktop.collection.addToWishlist')}
                        </button>
                    </div>

                    <h2 className="text-sm font-black text-white uppercase tracking-widest mt-10 mb-4">
                        {t('desktop.card.activeListings')} <span className="text-slate-500">({listings.length})</span>
                    </h2>

                    {listings.length === 0 ? (
                        <p className="text-slate-500 text-sm">{t('desktop.card.noListings')}</p>
                    ) : (
                        <div className="space-y-2">
                            {listings.map((listing) => (
                                <div
                                    key={listing.id}
                                    className="flex items-center justify-between gap-4 bg-[#1e293b]/40 border border-white/5 rounded-xl px-4 py-3"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className="shrink-0 text-[10px] font-black px-2 py-1 rounded border bg-slate-700/60 text-slate-300 border-slate-600">
                                            {listing.is_graded && listing.grading_company
                                                ? `${listing.grading_company} ${listing.grade ?? ''}`.trim()
                                                : listing.condition}
                                        </span>
                                        <span className="w-6 h-6 rounded-full bg-slate-700 overflow-hidden shrink-0">
                                            {listing.seller?.avatar_url && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={listing.seller.avatar_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                                            )}
                                        </span>
                                        {listing.seller?.username ? (
                                            <Link
                                                href={`/seller/${listing.seller.username}`}
                                                className="text-sm font-bold text-slate-300 hover:text-brand-cyan truncate transition-colors"
                                            >
                                                {listing.seller.display_name || listing.seller.username}
                                            </Link>
                                        ) : (
                                            <span className="text-sm font-bold text-slate-300 truncate">
                                                {listing.seller?.display_name || t('desktop.unknownSeller')}
                                            </span>
                                        )}
                                        {getSellerTrust(listing.seller).kind === 'partner' && (
                                            <span className="shrink-0 text-[11px] text-brand-cyan font-bold whitespace-nowrap flex items-center gap-0.5">
                                                <i className="fa-solid fa-circle-check"></i>
                                                {t('seller.officialPartner')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-4 shrink-0">
                                        <span className="text-lg font-black text-brand-cyan">{formatTHB(listing.price)}</span>
                                        <button
                                            onClick={() => addItem(listingToCartItem(listing))}
                                            className="bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-xs font-black px-4 py-2 rounded-lg transition-colors"
                                        >
                                            {t('desktop.card.addToCart')}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
        </div>
    );
}
