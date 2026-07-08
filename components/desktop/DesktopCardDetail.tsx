'use client'

import React, { useEffect, useMemo, useState } from 'react';
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
import { getDealPercent, conditionBadgeLabel, isTopCondition } from '@/lib/listingDisplay';
import { useUserCollections } from '@/lib/hooks/useUserCollections';
import { useWishlist } from '@/lib/hooks/useWishlist';
import { useToast } from '@/lib/contexts/ToastContext';
import AuthModal from '@/components/AuthModal';
import OfferModal from '@/components/OfferModal';
import PriceHistoryChart from '@/components/PriceHistoryChart';

// OBO best-offer is dark-launched behind this flag; nothing renders when off.
const OFFERS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1';

// Real graded market prices for a card (PriceCharting market + actual CardStreet
// sales), served by /api/cards/[cardId]/graded-prices. Prices are already in THB.
interface GradedPrice {
    company: string;   // PSA | BGS | CGC | SGC | ARS
    grade: number;
    label: string;     // e.g. "PSA 10"
    price: number;     // THB
    source: 'app_sale' | 'market' | 'thai_estimate';
}

type SortKey = 'lowest' | 'highest' | 'best' | 'condition';
type CondFilter = 'all' | 'raw' | 'graded';

// Company accent for graded chips, matching the mobile Graded Dashboard.
const GRADED_COMPANY_COLOR: Record<string, string> = {
    PSA: 'text-brand-cyan',
    BGS: 'text-brand-green',
    CGC: 'text-brand-red',
};

// One grid template shared by the listings header and every row so prices read
// straight down a single right-aligned column. Collapses to a wrapped flex row
// below sm (rare on the desktop shell, but must never scroll the page body).
const ROW_GRID = 'sm:grid sm:grid-cols-[6.5rem_minmax(0,1fr)_5.5rem_7rem_auto] sm:items-center sm:gap-4';

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
    // Shared auth state from the cart provider (single gotrue subscription
    // for the whole desktop shell).
    const { addItem, user } = useDesktopCart();
    const { t, isThai } = useTranslation();
    const { showToast } = useToast();
    const { collections, addCollection, addCardToCollection } = useUserCollections();
    const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
    const [card, setCard] = useState<Card | null>(initialCard);
    const [listings, setListings] = useState<MarketplaceListing[]>(initialListings);
    const [loading, setLoading] = useState(!initialCard);
    // If catalog art fails to load (TCGdex outages black out most EN card
    // art), fall back to a seller's condition photo from our own storage.
    const [catalogArtFailed, setCatalogArtFailed] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);
    const [addingToCollection, setAddingToCollection] = useState(false);
    // Real graded prices for this card; empty until a grade tier actually has
    // data — the dashboard stays hidden rather than inventing values.
    const [gradedPrices, setGradedPrices] = useState<GradedPrice[]>([]);
    // Client-side listing controls (reorder/filter the already-fetched array; no refetch).
    const [sortKey, setSortKey] = useState<SortKey>('lowest');
    const [condFilter, setCondFilter] = useState<CondFilter>('all');
    // OBO: the listing the buyer is making an offer on (null = modal closed).
    const [offerListing, setOfferListing] = useState<MarketplaceListing | null>(null);
    // OBO: listing ids on which the current buyer already has a pending offer.
    // This screen can show several listings for one card, so it's a Set keyed by
    // listing id. Seeded from the buyer's active offers on mount and updated
    // optimistically after a successful submit (no refetch), so each per-listing
    // "Make an Offer" button greys out to reflect the 409-OFFER_ALREADY_LIVE state.
    const [pendingOfferListingIds, setPendingOfferListingIds] = useState<Set<string>>(new Set());

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
                    .select('id, name, english_name, set_id, number, rarity, image_small, image_large, language, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(condition, market_avg, currency, last_updated)')
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

    // Graded prices are a card-level signal (independent of active listings), so
    // fetch them once per card. Mirrors the mobile CardDetails pattern.
    useEffect(() => {
        if (!card?.id) return;
        let cancelled = false;
        setGradedPrices([]);
        fetch(`/api/cards/${encodeURIComponent(card.id)}/graded-prices`)
            .then((res) => (res.ok ? res.json() : { prices: [] }))
            .then((data) => { if (!cancelled) setGradedPrices(Array.isArray(data?.prices) ? data.prices : []); })
            .catch(() => { if (!cancelled) setGradedPrices([]); });
        return () => { cancelled = true; };
    }, [card?.id]);

    // OBO: seed the set of listings this buyer already has a pending offer on,
    // so their per-listing "Make an Offer" button greys out. One fetch of the
    // buyer's active offers; only runs when the offer button could show.
    useEffect(() => {
        if (!OFFERS_ENABLED || !user) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/offers?role=buyer&state=active');
                if (!res.ok) return;
                const data = await res.json().catch(() => ({}));
                if (cancelled || !Array.isArray(data?.offers)) return;
                const ids = new Set<string>(
                    data.offers
                        .filter((o: { status?: string }) => o.status === 'pending')
                        .map((o: { listing_id: string }) => o.listing_id),
                );
                if (ids.size > 0) setPendingOfferListingIds(ids);
            } catch { /* leave buttons enabled; server still guards with 409 */ }
        })();
        return () => {
            cancelled = true;
        };
    }, [user]);

    // ─── Derived market stats (all real, straight off the live listings array) ──
    const marketPrice = card?.marketPrice ?? 0;
    const lowest = listings.length ? Math.min(...listings.map((l) => l.price)) : 0;
    const highest = listings.length ? Math.max(...listings.map((l) => l.price)) : 0;
    const hasRange = listings.length > 1 && highest !== lowest;
    const sellerCount = useMemo(() => new Set(listings.map((l) => l.seller_id)).size, [listings]);
    const gradedCount = useMemo(() => listings.filter((l) => l.is_graded).length, [listings]);
    // The globally cheapest listing, computed from the RAW array so re-sorting
    // never moves the "Best price" marker off the actually-cheapest row.
    const bestId = useMemo(
        () => (listings.length ? listings.reduce((a, b) => (a.price <= b.price ? a : b)).id : null),
        [listings],
    );
    const lowestDeal = marketPrice > 0 && listings.length ? getDealPercent(lowest, marketPrice) : null;

    // Freshness of the market price. cardMapper now emits null when there's no
    // real market-data timestamp, so any present, parseable value is genuine.
    const lastUpdatedMs = card?.prices?.lastUpdated ? Date.parse(card.prices.lastUpdated) : NaN;
    const showUpdated = marketPrice > 0 && Number.isFinite(lastUpdatedMs);
    const updatedText = showUpdated
        ? t('desktop.card.updatedOn').replace(
              '{date}',
              new Date(lastUpdatedMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
          )
        : '';

    // Filter chips only make sense when there's an actual mix of raw and graded.
    const showFilter = gradedCount > 0 && gradedCount < listings.length;
    const gradedEstimateShown = gradedPrices.some((g) => g.source === 'thai_estimate');

    const visibleListings = useMemo(() => {
        let arr = listings;
        if (showFilter && condFilter === 'raw') arr = arr.filter((l) => !l.is_graded);
        else if (showFilter && condFilter === 'graded') arr = arr.filter((l) => l.is_graded);
        const sorted = [...arr];
        const dealRatio = (l: MarketplaceListing) => (marketPrice > 0 ? l.price / marketPrice : Infinity);
        switch (sortKey) {
            case 'highest':
                sorted.sort((a, b) => b.price - a.price);
                break;
            case 'best':
                // Deepest discount first; listings with no usable market price sort last.
                sorted.sort((a, b) => dealRatio(a) - dealRatio(b));
                break;
            case 'condition':
                sorted.sort(
                    (a, b) => (isTopCondition(b) ? 1 : 0) - (isTopCondition(a) ? 1 : 0) || a.price - b.price,
                );
                break;
            default:
                sorted.sort((a, b) => a.price - b.price);
        }
        return sorted;
    }, [listings, showFilter, condFilter, sortKey, marketPrice]);

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

    const showMarketPanel = marketPrice > 0 || listings.length > 0 || gradedPrices.length > 0;

    const microLabel = 'text-[10px] text-slate-500 font-black uppercase tracking-widest';

    const gradedSourceLabel = (source: GradedPrice['source']) =>
        source === 'app_sale'
            ? t('desktop.card.gradedSourceSale')
            : source === 'thai_estimate'
                ? t('desktop.card.gradedSourceEstimate')
                : t('desktop.card.gradedSourceMarket');

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
                            className={card.isSealed ? 'object-contain p-4' : 'object-cover'}
                        />
                    </div>
                </div>

                <div>
                    <h1 className="text-3xl font-black text-white">{card.name}</h1>
                    <p className="text-sm text-slate-400 font-bold uppercase tracking-wide mt-2">
                        {card.set}
                        {/* Sealed products have no collector number or rarity */}
                        {!card.isSealed && card.number ? ` · #${card.number}` : ''}
                        {!card.isSealed && card.rarity ? ` · ${card.rarity}` : ''}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 mt-5">
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

                    {/* ─── Market overview: real price + live ask stats + graded dashboard ─── */}
                    {showMarketPanel && (
                        <div className="mt-6 rounded-2xl bg-white/5 border border-white/10 p-5">
                            <div className={`${microLabel} mb-4`}>{t('desktop.card.marketTitle')}</div>

                            {/* Band 1 — stat strip. Each block renders only when its data exists. */}
                            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                                <div>
                                    <div className={microLabel}>{t('desktop.card.marketPrice')}</div>
                                    {marketPrice > 0 ? (
                                        <div className="text-3xl font-black text-white leading-tight">{formatTHB(marketPrice)}</div>
                                    ) : (
                                        <div className="text-sm text-slate-500 font-bold mt-1">{t('desktop.card.noMarketPrice')}</div>
                                    )}
                                    {showUpdated && <div className="text-[10px] text-slate-500 mt-1">{updatedText}</div>}
                                </div>

                                {listings.length > 0 && (
                                    <div>
                                        <div className={microLabel}>{t('desktop.card.lowestAsk')}</div>
                                        <div className="text-2xl font-black text-brand-cyan leading-tight">{formatTHB(lowest)}</div>
                                        {lowestDeal != null && (
                                            <div className="text-[11px] text-brand-green font-black mt-1">
                                                {t('desktop.card.belowMarket').replace('{pct}', String(lowestDeal))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {hasRange && (
                                    <div>
                                        <div className={microLabel}>{t('desktop.card.priceRange')}</div>
                                        <div className="text-lg font-black text-slate-200 leading-tight mt-1">
                                            {formatTHB(lowest)} <span className="text-slate-600">–</span> {formatTHB(highest)}
                                        </div>
                                    </div>
                                )}

                                {listings.length > 0 && (
                                    <div className="flex items-end gap-5">
                                        <div>
                                            <div className={microLabel}>{t('desktop.card.statListings')}</div>
                                            <div className="text-lg font-black text-white leading-tight mt-1">{listings.length}</div>
                                        </div>
                                        <div>
                                            <div className={microLabel}>{t('desktop.card.statSellers')}</div>
                                            <div className="text-lg font-black text-white leading-tight mt-1">{sellerCount}</div>
                                        </div>
                                        {gradedCount > 0 && (
                                            <div>
                                                <div className={microLabel}>{t('desktop.card.statGraded')}</div>
                                                <div className="text-lg font-black text-white leading-tight mt-1">{gradedCount}</div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Band 2 — real graded prices (hidden entirely when none exist). */}
                            {gradedPrices.length > 0 && (
                                <div className="mt-5 pt-5 border-t border-white/10">
                                    <div className={`${microLabel} mb-3`}>{t('desktop.card.gradedTitle')}</div>
                                    <div className="flex flex-wrap gap-2">
                                        {gradedPrices.map((g) => (
                                            <div
                                                key={`${g.company}-${g.grade}`}
                                                className="inline-flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5"
                                            >
                                                <span className={`text-xs font-black ${GRADED_COMPANY_COLOR[g.company] || 'text-white'}`}>{g.label}</span>
                                                <span className="text-sm font-black text-white">{formatTHB(g.price)}</span>
                                                <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">{gradedSourceLabel(g.source)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    {gradedEstimateShown && (
                                        <p className="text-[10px] text-slate-500 mt-2 max-w-lg">{t('desktop.card.gradedEstimateNote')}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ─── Real market-value-over-time (price_snapshots via
                        /api/price-history). Self-hides until there is genuine history
                        to draw — no synthesized trend. Works for sealed and singles. ─── */}
                    <PriceHistoryChart
                        subjectId={card.id}
                        language={card.language || 'en'}
                        condition={card.isSealed ? 'Sealed' : 'Market'}
                        currentPriceThb={marketPrice}
                        isThai={isThai}
                        title={isThai ? 'ราคาย้อนหลัง' : 'Price Over Time'}
                        panelClassName="mt-6 rounded-2xl bg-white/5 border border-white/10 p-5"
                        titleClassName={`${microLabel} mb-4`}
                    />

                    {/* ─── Listings ─── */}
                    <div className="flex flex-wrap items-center justify-between gap-3 mt-10 mb-4">
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">
                            {t('desktop.card.activeListings')} <span className="text-slate-500">({listings.length})</span>
                        </h2>
                        {listings.length > 1 && (
                            <div className="flex items-center gap-3">
                                {showFilter && (
                                    <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-0.5">
                                        {(['all', 'raw', 'graded'] as CondFilter[]).map((f) => (
                                            <button
                                                key={f}
                                                onClick={() => setCondFilter(f)}
                                                className={`text-xs font-bold px-2.5 py-1 rounded-md transition-colors ${condFilter === f ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
                                            >
                                                {t(`desktop.card.filter${f === 'all' ? 'All' : f === 'raw' ? 'Raw' : 'Graded'}`)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <label className="flex items-center gap-2 text-xs text-slate-500 font-bold">
                                    <span className="uppercase tracking-widest">{t('desktop.card.sortLabel')}</span>
                                    <select
                                        value={sortKey}
                                        onChange={(e) => setSortKey(e.target.value as SortKey)}
                                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-brand-cyan/50 [&>option]:bg-brand-dark"
                                    >
                                        <option value="lowest">{t('desktop.card.sortLowest')}</option>
                                        <option value="highest">{t('desktop.card.sortHighest')}</option>
                                        <option value="best">{t('desktop.card.sortBestDeal')}</option>
                                        <option value="condition">{t('desktop.card.sortTopCondition')}</option>
                                    </select>
                                </label>
                            </div>
                        )}
                    </div>

                    {listings.length === 0 ? (
                        <p className="text-slate-500 text-sm">{t('desktop.card.noListings')}</p>
                    ) : (
                        <div>
                            {/* Column labels — aligned to the same grid as the rows (sm+ only). */}
                            <div className={`hidden ${ROW_GRID} px-4 pb-2 ${microLabel}`}>
                                <span>{t('desktop.card.conditionColumn')}</span>
                                <span>{t('desktop.card.sellerColumn')}</span>
                                <span className="text-right">{t('desktop.card.dealColumn')}</span>
                                <span className="text-right">{t('desktop.card.priceColumn')}</span>
                                <span></span>
                            </div>

                            <div className="space-y-2">
                                {visibleListings.map((listing) => {
                                    const trust = getSellerTrust(listing.seller);
                                    const graded = listing.is_graded;
                                    const top = isTopCondition(listing);
                                    const dealPct = marketPrice > 0 ? getDealPercent(listing.price, marketPrice) : null;
                                    const isBest = listings.length > 1 && listing.id === bestId;
                                    const badgeClass = graded
                                        ? 'bg-brand-cyan/15 text-brand-cyan border-brand-cyan/30'
                                        : top
                                            ? 'bg-brand-green/15 text-brand-green border-brand-green/30'
                                            : 'bg-slate-700/60 text-slate-300 border-slate-600';
                                    return (
                                        <div
                                            key={listing.id}
                                            className={`rounded-xl border px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-3 transition-colors ${ROW_GRID} ${isBest ? 'bg-brand-green/[0.05] border-brand-green/30 border-l-2 border-l-brand-green' : 'bg-slate-800/40 border-white/5 hover:border-white/10'}`}
                                        >
                                            {/* Condition (+ best-price marker) */}
                                            <div className="flex flex-col gap-1">
                                                {isBest && (
                                                    <span className="text-[9px] text-brand-green font-black uppercase tracking-widest">{t('desktop.card.bestPrice')}</span>
                                                )}
                                                <span className={`self-start text-[10px] font-black px-2 py-1 rounded border ${badgeClass}`}>
                                                    {conditionBadgeLabel(listing)}
                                                </span>
                                            </div>

                                            {/* Seller cluster */}
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <span className="w-6 h-6 rounded-full bg-slate-700 overflow-hidden shrink-0">
                                                    {listing.seller?.avatar_url && (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img src={listing.seller.avatar_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                                                    )}
                                                </span>
                                                <div className="min-w-0">
                                                    {listing.seller?.username ? (
                                                        <Link
                                                            href={`/seller/${listing.seller.username}`}
                                                            className="block text-sm font-bold text-slate-200 hover:text-brand-cyan truncate transition-colors"
                                                        >
                                                            {listing.seller.display_name || listing.seller.username}
                                                        </Link>
                                                    ) : (
                                                        <span className="block text-sm font-bold text-slate-200 truncate">
                                                            {listing.seller?.display_name || t('desktop.unknownSeller')}
                                                        </span>
                                                    )}
                                                    {trust.kind === 'partner' && (
                                                        <span className="text-[11px] text-brand-cyan font-bold whitespace-nowrap flex items-center gap-0.5">
                                                            <i className="fa-solid fa-circle-check"></i>
                                                            {t('seller.officialPartner')}
                                                        </span>
                                                    )}
                                                    {(trust.kind === 'owner' || trust.kind === 'rated') && (
                                                        <span className="text-[11px] text-slate-400 font-bold whitespace-nowrap">
                                                            {trust.rating.toFixed(1)} ★
                                                        </span>
                                                    )}
                                                    {trust.kind === 'new' && (
                                                        <span className="text-[11px] text-slate-600 font-bold whitespace-nowrap">
                                                            {t('desktop.card.newSeller')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Deal vs market */}
                                            <div className="text-right shrink-0 sm:w-auto">
                                                {dealPct != null ? (
                                                    <span className="text-xs text-brand-green font-black whitespace-nowrap">
                                                        {t('desktop.card.belowMarket').replace('{pct}', String(dealPct))}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-600 hidden sm:inline">—</span>
                                                )}
                                            </div>

                                            {/* Price */}
                                            <div className="text-right shrink-0">
                                                <span className="text-lg font-black text-brand-cyan">{formatTHB(listing.price)}</span>
                                            </div>

                                            {/* Actions */}
                                            <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
                                                {/* OBO: buyers (not the seller) can make an offer on
                                                    OBO-enabled listings when the feature flag is on. */}
                                                {OFFERS_ENABLED && listing.accepts_offers && user && user.id !== listing.seller_id && (
                                                    pendingOfferListingIds.has(listing.id) ? (
                                                        <button
                                                            disabled
                                                            className="bg-white/5 border border-white/10 text-slate-500 text-xs font-black px-4 py-2 rounded-lg cursor-not-allowed"
                                                        >
                                                            {t('offer.pending')}
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => setOfferListing(listing)}
                                                            className="bg-brand-cyan/10 hover:bg-brand-cyan/20 border border-brand-cyan/40 text-brand-cyan text-xs font-black px-4 py-2 rounded-lg transition-colors"
                                                        >
                                                            {t('offer.makeOffer')}
                                                        </button>
                                                    )
                                                )}
                                                <button
                                                    onClick={() => addItem(listingToCartItem(listing))}
                                                    className="bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-xs font-black px-4 py-2 rounded-lg transition-colors"
                                                >
                                                    {t('desktop.card.addToCart')}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />

            {OFFERS_ENABLED && offerListing && (
                <OfferModal
                    listingId={offerListing.id}
                    listingPrice={offerListing.price}
                    cardName={offerListing.card_data?.name || card.name}
                    onClose={() => setOfferListing(null)}
                    onSubmitted={() => {
                        // Grey this listing's offer button immediately — no refetch.
                        const submittedId = offerListing.id;
                        setPendingOfferListingIds((prev) => new Set(prev).add(submittedId));
                        showToast(t('offer.submitted'), 'success');
                    }}
                />
            )}
        </div>
    );
}
