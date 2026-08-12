'use client'

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { marketplaceService, MarketplaceListing } from '@/services/marketplaceService';
import { getOptimizedImageUrl, getPreviewUrl, shouldSkipNextOptimization, CARD_BLUR_DATA_URL } from '@/lib/imageUtils';
import { GAMES, getGameLanguages } from '@/lib/games';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import DesktopFaqTeaser from '@/components/desktop/DesktopFaqTeaser';
import OfferModal from '@/components/OfferModal';
import { useToast } from '@/lib/contexts/ToastContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getSellerTrust } from '@/lib/sellerTrust';
import { getDealPercent, conditionBadgeLabel } from '@/lib/listingDisplay';
import { formatTHB } from '@/lib/currency';
import SnipeBadge, { isSnipeListing } from '@/components/SnipeBadge';
import GradedSlabFrame from '@/components/GradedSlabFrame';
import { CartItem } from '@/types';

const PAGE_SIZE = 60;

// OBO offers are behind a single build-time flag; when off, every tile shows
// "Buy Now" regardless of a listing's accepts_offers value.
const OFFERS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1';

// Language values match the listing snapshot's `card_data.language`. The service
// expands 'ja' to also cover sealed's 'jp' code, so a single option covers both.
const LANGUAGE_LABEL_KEYS: Record<string, string> = {
    en: 'desktop.english',
    ja: 'desktop.japanese',
    th: 'desktop.thai',
};

// Re-exported for the desktop components that historically imported it here.
export { formatTHB };

type SortKey = 'newest' | 'price_asc' | 'price_desc' | 'best_deals';

export function listingToCartItem(listing: MarketplaceListing): CartItem {
    return {
        id: listing.id,
        cardId: listing.card_id,
        card: listing.card_data,
        price: listing.price,
        sellerId: listing.seller_id,
        sellerName: listing.seller?.display_name || 'Unknown Seller',
        condition: listing.condition,
    };
}

export default function DesktopMarketplace({ pathPrefix = '' }: {
    // '' on the Thai canonical, '/en' under the English prefix. Resolved by the
    // server page and passed down as a plain string, because lib/i18nRouting
    // imports next/headers.
    pathPrefix?: string;
}) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { t } = useTranslation();
    const { showToast } = useToast();
    const q = searchParams?.get('q') ?? '';

    // OBO: listing whose "Make an offer" modal is open (from a grid tile). The
    // tile only surfaces the button to a signed-in buyer, so opening the modal
    // needs no auth gate here.
    const [offerListing, setOfferListing] = useState<MarketplaceListing | null>(null);

    // OBO: the offer-email CTA deep-links to /?view=offers; on desktop the
    // middleware rewrites that to the desktop home. Forward it to the Offers
    // inbox tab (the desktop offers inbox lives under /orders). Gated on the
    // offers flag so it's inert when off.
    useEffect(() => {
        if (process.env.NEXT_PUBLIC_ENABLE_OFFERS !== '1') return;
        if (searchParams?.get('view') === 'offers') {
            router.replace(`${pathPrefix}/orders?tab=offers`);
        }
    }, [searchParams, router, pathPrefix]);

    const [game, setGame] = useState('all');
    const [language, setLanguage] = useState('all');

    // Game-first flow (mirrors the sets browser): the language sub-filter only
    // appears once a specific multi-language game is picked. games.ts declares
    // Japanese as 'jp'; listing snapshots use 'ja', so normalize for the chips.
    const languageOptions = game === 'all'
        ? []
        : getGameLanguages(game).map((l) => (l.code === 'jp' ? 'ja' : l.code));

    const selectGame = (g: string) => {
        setGame(g);
        // The language list belongs to the previous game — reset it.
        setLanguage('all');
    };
    // Deals-first, matching the mobile marketplace's default sort.
    const [sort, setSort] = useState<SortKey>('best_deals');
    const [listings, setListings] = useState<MarketplaceListing[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        marketplaceService
            .getActiveListings({
                search: q || undefined,
                game,
                language: language === 'all' ? undefined : language,
                sort,
                limit: PAGE_SIZE,
            })
            .then((rows) => {
                if (cancelled) return;
                setListings(rows);
                setHasMore(rows.length === PAGE_SIZE);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [q, game, language, sort]);

    const loadMore = async () => {
        setLoadingMore(true);
        try {
            const rows = await marketplaceService.getActiveListings({
                search: q || undefined,
                game,
                language: language === 'all' ? undefined : language,
                sort,
                limit: PAGE_SIZE,
                offset: listings.length,
            });
            // Offset pagination over a live list: a listing created mid-browse
            // shifts the pages, so drop anything already rendered.
            setListings((prev) => {
                const seen = new Set(prev.map((l) => l.id));
                return [...prev, ...rows.filter((r) => !seen.has(r.id))];
            });
            setHasMore(rows.length === PAGE_SIZE);
        } finally {
            setLoadingMore(false);
        }
    };

    return (
        <div>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-white">{t('desktop.marketplaceTitle')}</h1>
                    <p className="text-sm text-slate-400 mt-1">
                        {q ? (
                            <>{t('desktop.resultsFor')} <span className="text-white font-bold">&ldquo;{q}&rdquo;</span></>
                        ) : (
                            t('desktop.liveListings')
                        )}
                    </p>
                </div>

                <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-brand-cyan/50 [&>option]:bg-brand-dark"
                >
                    <option value="best_deals">{t('desktop.sortBestDeals')}</option>
                    <option value="newest">{t('desktop.sortNewest')}</option>
                    <option value="price_asc">{t('desktop.sortPriceAsc')}</option>
                    <option value="price_desc">{t('desktop.sortPriceDesc')}</option>
                </select>
            </div>

            <div className="flex flex-wrap gap-2 mt-6">
                <FilterChip label={t('desktop.allGames')} active={game === 'all'} onClick={() => selectGame('all')} />
                {GAMES.filter((g) => g.enabled).map((g) => (
                    <FilterChip key={g.id} label={g.shortName} active={game === g.id} onClick={() => selectGame(g.id)} />
                ))}
            </div>

            {/* Language sub-filter — only when the selected game has more than one listing language */}
            {languageOptions.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 mr-1">
                        {t('desktop.browse.language')}
                    </span>
                    <FilterChip
                        label={t('desktop.browse.allLanguages')}
                        active={language === 'all'}
                        tone="green"
                        small
                        onClick={() => setLanguage('all')}
                    />
                    {languageOptions.map((l) => (
                        <FilterChip
                            key={l}
                            label={t(LANGUAGE_LABEL_KEYS[l] ?? l)}
                            active={language === l}
                            tone="green"
                            small
                            onClick={() => setLanguage(l)}
                        />
                    ))}
                </div>
            )}

            {loading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 mt-8">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="rounded-2xl bg-white/5 animate-pulse aspect-[3/4.7]"></div>
                    ))}
                </div>
            ) : listings.length === 0 ? (
                <div className="text-center py-24">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                        <i className="fa-solid fa-satellite-dish text-2xl text-slate-600"></i>
                    </div>
                    <h2 className="text-white font-bold uppercase tracking-widest text-sm mb-1">{t('desktop.noListingsTitle')}</h2>
                    <p className="text-slate-500 text-sm">{t('desktop.noListingsDesc')}</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 mt-8">
                        {listings.map((listing, idx) => (
                            <ListingTile key={listing.id} listing={listing} eager={idx < 6} onMakeOffer={setOfferListing} pathPrefix={pathPrefix} />
                        ))}
                    </div>

                    {hasMore && (
                        <div className="flex justify-center mt-10">
                            <button
                                onClick={loadMore}
                                disabled={loadingMore}
                                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-bold px-8 py-3 rounded-xl transition-colors disabled:opacity-50"
                            >
                                {loadingMore ? t('desktop.loading') : t('desktop.loadMore')}
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* Homepage only: the FAQ teaser is a marketing/SEO surface, not a
                search result. Hidden once the visitor is actively searching. */}
            {!q && <DesktopFaqTeaser pathPrefix={pathPrefix} />}

            {OFFERS_ENABLED && offerListing && (
                <OfferModal
                    listingId={offerListing.id}
                    listingPrice={offerListing.price}
                    cardName={offerListing.card_data?.name || ''}
                    onClose={() => setOfferListing(null)}
                    onSubmitted={() => showToast(t('offer.submitted'), 'success')}
                />
            )}
        </div>
    );
}

function FilterChip({
    label,
    active,
    onClick,
    tone = 'cyan',
    small,
}: {
    label: string;
    active: boolean;
    onClick: () => void;
    tone?: 'cyan' | 'green';
    small?: boolean;
}) {
    const activeClass = tone === 'green' ? 'bg-brand-green text-brand-darker' : 'bg-brand-cyan text-brand-darker';
    return (
        <button
            onClick={onClick}
            className={`rounded-full font-bold transition-colors ${small ? 'px-3 py-1 text-[11px]' : 'px-4 py-1.5 text-xs'} ${
                active ? activeClass : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
            }`}
        >
            {label}
        </button>
    );
}

function ListingTile({ listing, eager, onMakeOffer, pathPrefix = '' }: { listing: MarketplaceListing; eager: boolean; onMakeOffer: (listing: MarketplaceListing) => void; pathPrefix?: string }) {
    const { buyNow, user } = useDesktopCart();
    const { t } = useTranslation();
    // Catalog art is the default; if its host is unreachable (TCGdex outages
    // black out most EN card art) fall back to the seller's condition photo,
    // which lives in our own Supabase storage.
    const [catalogArtFailed, setCatalogArtFailed] = useState(false);
    const catalogUrl = getPreviewUrl(listing.card_data.images?.small || listing.card_data.imageUrl);
    const imageUrl = catalogArtFailed && listing.image_front_url
        ? getOptimizedImageUrl(listing.image_front_url, 300, 80)
        : catalogUrl;
    const dealPct = getDealPercent(listing.price, listing.card_data.marketPrice);
    // Graded listings render inside the slab frame; the deal badge drops below
    // its label bar.
    const slabbed = !!listing.is_graded && !!listing.grading_company;
    // Show "Make Offer" only on offer-accepting listings, and only to a signed-in
    // buyer who isn't the seller. Everyone else (incl. signed-out visitors and
    // the flag-off case) gets "Buy Now".
    const showMakeOffer =
        OFFERS_ENABLED && listing.accepts_offers === true && !!user && user.id !== listing.seller_id;
    return (
        <Link
            href={`${pathPrefix}/card/${listing.card_id}`}
            className="group bg-slate-800/40 border border-white/5 rounded-2xl overflow-hidden hover:border-brand-cyan/40 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40 transition-all"
        >
            {/* Extra wrapper lets the snipe badge hang past the image's
                overflow-hidden edge, straddling the image/details boundary. */}
            <div className="relative">
                <div className="relative aspect-[3/4] bg-brand-darker overflow-hidden">
                    <GradedSlabFrame company={slabbed ? listing.grading_company : null} grade={listing.grade} size="md" title={listing.card_data.name} subtitle={listing.card_data.set}>
                        <Image
                            src={imageUrl}
                            alt={listing.card_data.name || 'Card'}
                            fill
                            sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 20vw, 40vw"
                            loading={eager ? 'eager' : 'lazy'}
                            placeholder="blur"
                            blurDataURL={CARD_BLUR_DATA_URL}
                            unoptimized={shouldSkipNextOptimization(imageUrl)}
                            onError={() => setCatalogArtFailed(true)}
                            className={`group-hover:scale-[1.03] transition-transform duration-300 ${listing.card_data.isSealed ? 'object-contain p-3' : slabbed ? 'object-contain' : 'object-cover'}`}
                        />
                    </GradedSlabFrame>
                    {dealPct !== null && (
                        <span className={`absolute left-2 bg-brand-green text-brand-darker text-[10px] font-black px-2 py-0.5 rounded-md shadow-lg shadow-black/40 ${slabbed ? 'top-16' : 'top-2'}`}>
                            -{dealPct}%
                        </span>
                    )}
                </div>
                {isSnipeListing(listing.price) && (
                    <SnipeBadge className="absolute -bottom-3 right-2 z-10 h-14 w-auto" />
                )}
            </div>
            <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-white truncate">{listing.card_data.name}</h3>
                    <span className="shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded border bg-slate-700/60 text-slate-300 border-slate-600">
                        {conditionBadgeLabel(listing)}
                    </span>
                </div>
                <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">
                    {listing.card_data.set}
                </p>
                <div className="flex items-baseline gap-1.5 min-w-0 mt-2">
                    <p className="text-lg font-black text-brand-cyan">{formatTHB(listing.price)}</p>
                    {dealPct !== null && (
                        <p className="text-[11px] text-slate-500 font-bold line-through truncate">
                            {formatTHB(listing.card_data.marketPrice)}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-400">
                    <span className="w-4 h-4 rounded-full bg-slate-700 overflow-hidden shrink-0">
                        {listing.seller?.avatar_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={listing.seller.avatar_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                        )}
                    </span>
                    <span className="truncate font-bold">{listing.seller?.display_name || t('desktop.unknownSeller')}</span>
                    {getSellerTrust(listing.seller).kind === 'partner' && (
                        <span className="text-brand-cyan font-bold whitespace-nowrap flex items-center gap-0.5 shrink-0">
                            <i className="fa-solid fa-circle-check"></i>
                            {t('seller.officialPartner')}
                        </span>
                    )}
                </div>

                {/* Primary action: Make Offer (OBO) or Buy Now (straight to payment) */}
                {showMakeOffer ? (
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onMakeOffer(listing);
                        }}
                        className="mt-3 w-full py-2 rounded-lg bg-brand-cyan/10 hover:bg-brand-cyan/20 border border-brand-cyan/40 text-brand-cyan text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
                        aria-label={`Make an offer on ${listing.card_data.name}`}
                    >
                        <i className="fa-solid fa-hand-holding-dollar"></i>
                        {t('offer.makeOffer')}
                    </button>
                ) : (
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            buyNow(listingToCartItem(listing));
                        }}
                        className="mt-3 w-full py-2 rounded-lg bg-brand-green hover:bg-brand-green/90 text-brand-darker text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
                        aria-label={`Buy ${listing.card_data.name} now`}
                    >
                        <i className="fa-solid fa-bolt"></i>
                        {t('marketplace.buyNow')}
                    </button>
                )}
            </div>
        </Link>
    );
}
