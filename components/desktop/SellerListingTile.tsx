'use client'

import Image from 'next/image';
import Link from 'next/link';
import type { MarketplaceListing } from '@/services/marketplaceService';
import { getThumbnailUrl, shouldSkipNextOptimization } from '@/lib/imageUtils';
import { formatTHB } from '@/lib/currency';
import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import { listingToCartItem } from '@/components/desktop/DesktopMarketplace';

// Client tile for the (server-rendered) seller shop page. Mirrors the shop
// page's original card markup and adds the same one-tap add-to-cart control the
// marketplace grid uses, so browsing a single seller's shop needs no detour
// through each card page.
export default function SellerListingTile({ listing }: { listing: MarketplaceListing }) {
    const { addItem } = useDesktopCart();
    const thumb = getThumbnailUrl(listing.card_data.images?.small || listing.card_data.imageUrl);

    return (
        <Link
            href={`/card/${listing.card_id}`}
            className="group bg-slate-800/40 border border-white/5 rounded-2xl overflow-hidden hover:border-brand-cyan/40 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40 transition-all"
        >
            <div className="relative aspect-[3/4] bg-brand-darker overflow-hidden">
                <Image
                    src={thumb}
                    alt={listing.card_data.name || 'Card'}
                    fill
                    sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 20vw, 40vw"
                    loading="lazy"
                    unoptimized={shouldSkipNextOptimization(thumb)}
                    className={`group-hover:scale-[1.03] transition-transform duration-300 ${listing.card_data.isSealed ? 'object-contain p-3' : 'object-cover'}`}
                />
            </div>
            <div className="p-3">
                <h2 className="text-sm font-bold text-white truncate">{listing.card_data.name}</h2>
                <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">
                    {listing.card_data.set}
                </p>
                <div className="flex items-center justify-between gap-2 mt-1.5">
                    <p className="text-lg font-black text-brand-cyan truncate">{formatTHB(listing.price)}</p>
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            addItem(listingToCartItem(listing));
                        }}
                        className="w-8 h-8 rounded-full bg-white/5 hover:bg-brand-cyan text-brand-cyan hover:text-brand-darker flex items-center justify-center transition-colors shrink-0"
                        aria-label={`Add ${listing.card_data.name} to cart`}
                    >
                        <i className="fa-solid fa-cart-plus text-xs"></i>
                    </button>
                </div>
            </div>
        </Link>
    );
}
