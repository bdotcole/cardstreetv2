'use client'

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { marketplaceService, MarketplaceListing } from '@/services/marketplaceService';
import { getPreviewUrl, shouldSkipNextOptimization } from '@/lib/imageUtils';
import { GAMES } from '@/lib/games';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import { CartItem } from '@/types';

const PAGE_SIZE = 60;

// Listings are priced in THB natively; desktop shows THB only for now.
export function formatTHB(amount: number): string {
    return `฿${amount < 1 ? amount.toFixed(2) : Math.round(amount).toLocaleString()}`;
}

type SortKey = 'newest' | 'price_asc' | 'price_desc';

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

export default function DesktopMarketplace() {
    const searchParams = useSearchParams();
    const q = searchParams?.get('q') ?? '';

    const [game, setGame] = useState('all');
    const [sort, setSort] = useState<SortKey>('newest');
    const [listings, setListings] = useState<MarketplaceListing[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        marketplaceService
            .getActiveListings({ search: q || undefined, game, sort, limit: PAGE_SIZE })
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
    }, [q, game, sort]);

    const loadMore = async () => {
        setLoadingMore(true);
        try {
            const rows = await marketplaceService.getActiveListings({
                search: q || undefined,
                game,
                sort,
                limit: PAGE_SIZE,
                offset: listings.length,
            });
            setListings((prev) => [...prev, ...rows]);
            setHasMore(rows.length === PAGE_SIZE);
        } finally {
            setLoadingMore(false);
        }
    };

    return (
        <div>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-white">Marketplace</h1>
                    <p className="text-sm text-slate-400 mt-1">
                        {q ? (
                            <>Results for <span className="text-white font-bold">&ldquo;{q}&rdquo;</span></>
                        ) : (
                            'Live listings from sellers across Thailand'
                        )}
                    </p>
                </div>

                <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-brand-cyan/50 [&>option]:bg-brand-dark"
                >
                    <option value="newest">Newest first</option>
                    <option value="price_asc">Price: low to high</option>
                    <option value="price_desc">Price: high to low</option>
                </select>
            </div>

            <div className="flex flex-wrap gap-2 mt-6">
                <GameChip label="All Games" active={game === 'all'} onClick={() => setGame('all')} />
                {GAMES.filter((g) => g.enabled).map((g) => (
                    <GameChip key={g.id} label={g.shortName} active={game === g.id} onClick={() => setGame(g.id)} />
                ))}
            </div>

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
                    <h2 className="text-white font-bold uppercase tracking-widest text-sm mb-1">No listings found</h2>
                    <p className="text-slate-500 text-sm">Try a different search or game filter.</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 mt-8">
                        {listings.map((listing, idx) => (
                            <ListingTile key={listing.id} listing={listing} eager={idx < 6} />
                        ))}
                    </div>

                    {hasMore && (
                        <div className="flex justify-center mt-10">
                            <button
                                onClick={loadMore}
                                disabled={loadingMore}
                                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-bold px-8 py-3 rounded-xl transition-colors disabled:opacity-50"
                            >
                                {loadingMore ? 'Loading...' : 'Load more'}
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function GameChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                active
                    ? 'bg-brand-cyan text-brand-darker'
                    : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
            }`}
        >
            {label}
        </button>
    );
}

function ListingTile({ listing, eager }: { listing: MarketplaceListing; eager: boolean }) {
    const { addItem } = useDesktopCart();
    const imageUrl = getPreviewUrl(listing.card_data.images?.small || listing.card_data.imageUrl);
    return (
        <Link
            href={`/card/${listing.card_id}`}
            className="group bg-[#1e293b]/40 border border-white/5 rounded-2xl overflow-hidden hover:border-brand-cyan/40 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40 transition-all"
        >
            <div className="relative aspect-[3/4] bg-brand-darker overflow-hidden">
                <Image
                    src={imageUrl}
                    alt={listing.card_data.name || 'Card'}
                    fill
                    sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 20vw, 40vw"
                    loading={eager ? 'eager' : 'lazy'}
                    unoptimized={shouldSkipNextOptimization(imageUrl)}
                    className="object-cover group-hover:scale-[1.03] transition-transform duration-300"
                />
            </div>
            <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-white truncate">{listing.card_data.name}</h3>
                    <span className="shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded border bg-slate-700/60 text-slate-300 border-slate-600">
                        {listing.is_graded && listing.grading_company
                            ? `${listing.grading_company} ${listing.grade ?? ''}`.trim()
                            : listing.condition}
                    </span>
                </div>
                <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">
                    {listing.card_data.set}
                </p>
                <div className="flex items-center justify-between mt-2">
                    <p className="text-lg font-black text-brand-cyan">{formatTHB(listing.price)}</p>
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            addItem(listingToCartItem(listing));
                        }}
                        className="w-8 h-8 rounded-full bg-white/5 hover:bg-brand-cyan text-brand-cyan hover:text-brand-darker flex items-center justify-center transition-colors"
                        aria-label={`Add ${listing.card_data.name} to cart`}
                    >
                        <i className="fa-solid fa-cart-plus text-xs"></i>
                    </button>
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-400">
                    <span className="w-4 h-4 rounded-full bg-slate-700 overflow-hidden shrink-0">
                        {listing.seller?.avatar_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={listing.seller.avatar_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                        )}
                    </span>
                    <span className="truncate font-bold">{listing.seller?.display_name || 'Unknown Seller'}</span>
                </div>
            </div>
        </Link>
    );
}
