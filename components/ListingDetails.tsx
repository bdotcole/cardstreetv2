import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Card } from '../types';
import ReportModal from './ReportModal';
import PriceHistoryChart from './PriceHistoryChart';
import { CURRENCY_SYMBOLS, THAI_SETS } from '@/constants';
import { useTranslation } from '@/lib/hooks/useTranslation';
import ShippingNote from '@/components/ShippingNote';
import { getSellerTrust } from '@/lib/sellerTrust';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import OfferModal from './OfferModal';
import GradedSlabFrame from './GradedSlabFrame';

// Gallery slide with pinch/double-tap zoom. One-finger drag is left to the
// scroll-snap gallery until the image is actually zoomed in — otherwise the
// zoom library claims the drag for panning and swiping between slides fights
// the photo. Panning only wakes up past 1x, and the slide snaps back to 1x
// when swiped away so the next visit starts unzoomed.
const ZoomableSlide: React.FC<{
    active: boolean;
    wrapperClass: string;
    children: React.ReactNode;
}> = ({ active, wrapperClass, children }) => {
    const zoomRef = useRef<ReactZoomPanPinchRef | null>(null);
    const [isZoomed, setIsZoomed] = useState(false);

    useEffect(() => {
        if (!active && isZoomed) zoomRef.current?.resetTransform(200);
    }, [active, isZoomed]);

    return (
        <TransformWrapper
            ref={zoomRef}
            initialScale={1}
            minScale={1}
            maxScale={4}
            centerOnInit
            panning={{ disabled: !isZoomed, velocityDisabled: true }}
            doubleClick={{ mode: 'toggle' }}
            wheel={{ wheelDisabled: true }}
            onTransformed={(_, state) => setIsZoomed(state.scale > 1.02)}
        >
            <TransformComponent wrapperClass={wrapperClass} contentClass="w-full h-full">
                {children}
            </TransformComponent>
        </TransformWrapper>
    );
};
interface ListingDetailsProps {
    listing: {
        id: string;
        price: number;
        condition: string;
        seller: any;
        card_data: Card;
        image_front_url?: string;
        image_back_url?: string;
        accepts_offers?: boolean;
        seller_id?: string;
        is_graded?: boolean;
        grading_company?: string | null;
        grade?: number | null;
    };
    onClose: () => void;
    onBuyNow: () => void;
    onAddToCart: () => void;
    onSellerClick: (seller: any) => void;
    currency?: string;
    exchangeRate?: number;
    /** Signed-in user id, so the OBO "Make an offer" button hides on own listings. */
    currentUserId?: string | null;
    /** Fired after an offer is submitted, so the shell can toast. */
    onOfferSubmitted?: () => void;
}

const ListingDetails: React.FC<ListingDetailsProps> = ({
    listing,
    onClose,
    onBuyNow,
    onAddToCart,
    onSellerClick,
    currency = 'THB',
    exchangeRate = 1,
    currentUserId = null,
    onOfferSubmitted
}) => {
    const { t, isThai } = useTranslation();
    const card = listing.card_data;
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const [activeSlide, setActiveSlide] = useState(0);
    const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);
    // OBO: true once the buyer has a live (pending) offer on this listing — the
    // "Make an offer" button then greys out. Seeded from the buyer's active
    // offers on mount and flipped optimistically after a successful submit so
    // the button reflects the 409-OFFER_ALREADY_LIVE state without a refetch.
    const [hasPendingOffer, setHasPendingOffer] = useState(false);

    // OBO "Make an offer": only when the feature flag is on, the listing accepts
    // offers, and the viewer is not the seller.
    const sellerId = listing.seller_id ?? listing.seller?.id;
    const canOffer =
        process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1' &&
        listing.accepts_offers === true &&
        !!currentUserId &&
        currentUserId !== sellerId;

    // Seed pending state: does the buyer already have a pending offer on THIS
    // listing? One fetch of their active offers; no-op when the button can't show.
    useEffect(() => {
        if (!canOffer) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/offers?role=buyer&state=active');
                if (!res.ok) return;
                const data = await res.json().catch(() => ({}));
                const pending = Array.isArray(data?.offers)
                    ? data.offers.some(
                          (o: { listing_id?: string; status?: string }) =>
                              o.status === 'pending' && o.listing_id === listing.id,
                      )
                    : false;
                if (!cancelled && pending) setHasPendingOffer(true);
            } catch { /* leave button enabled; server still guards with 409 */ }
        })();
        return () => {
            cancelled = true;
        };
    }, [canOffer, listing.id]);

    const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;

    // Market figures mirror the card database (CardDetails): same Thai-set
    // market-estimate haircut so the two screens never disagree on a price.
    const isThaiSet = THAI_SETS.some(s => card.set.includes(s) || s.includes(card.set));
    const marketExchangeRate = exchangeRate * (isThaiSet ? 0.55 : 1.0);
    const formatMarketPrice = (price?: number) => {
        if (!price || price === 0) return 'N/A';
        const val = price * marketExchangeRate;
        if (currency === 'USD') {
            return `${currencySymbol} ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        return `${currencySymbol} ${Math.round(val).toLocaleString()}`;
    };

    // Slide order is digital, front, back — but front/back only render when
    // their photo exists, so the back photo's index shifts when front is absent.
    const frontSlideIndex = listing.image_front_url ? 1 : -1;
    const backSlideIndex = listing.image_back_url ? (listing.image_front_url ? 2 : 1) : -1;

    // Graded listings render the catalog art inside a slab frame and show
    // "PSA 10"-style labels in place of the raw condition.
    const slabbed = !!listing.is_graded && !!listing.grading_company;
    const gradedLabel = slabbed
        ? `${listing.grading_company} ${listing.grade != null ? Number(listing.grade) : ''}`.trim()
        : null;


    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const scrollLeft = e.currentTarget.scrollLeft;
        const width = e.currentTarget.offsetWidth;
        const newIndex = Math.round(scrollLeft / width);
        setActiveSlide(newIndex);
    };

    return (
        <div className="fixed inset-0 z-50 max-w-[480px] mx-auto flex flex-col bg-brand-darker animate-slideUp">
            {/* Header */}
            <div className="px-6 pb-6 flex justify-between items-center sticky top-0 z-10 bg-brand-darker/80 backdrop-blur-lg border-b border-white/5" style={{ paddingTop: 'calc(1.5rem + var(--sat))' }}>
                <button
                    onClick={onClose}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 active:bg-brand-cyan active:text-brand-darker transition-all border border-white/5"
                >
                    <i className="fa-solid fa-chevron-left text-sm"></i>
                </button>
                <div className="text-center">
                    <span className="font-black italic skew-x-[-10deg] uppercase tracking-wider text-xs text-brand-green block">{isThai ? 'รายละเอียดสินค้า' : 'Listing Details'}</span>
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{card.number}</span>
                </div>
                <button 
                    onClick={() => setIsReportModalOpen(true)}
                    title="Report Listing"
                    className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/5 hover:text-brand-red text-slate-500 transition-all border border-transparent hover:border-white/5"
                >
                    <i className="fa-solid fa-flag text-sm"></i>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto pb-64 scrollbar-hide">
                {/* Swipeable Image Gallery */}
                <div className="relative w-full">
                    <div className="absolute inset-0 bg-gradient-to-b from-brand-green/5 to-transparent pointer-events-none z-0"></div>
                    
                    <div 
                        className="flex w-full overflow-x-auto snap-x snap-mandatory scrollbar-hide relative z-10"
                        onScroll={handleScroll}
                    >
                        {/* Slide 1: Digital Image */}
                        <div className="flex-none w-full snap-center flex justify-center p-8 items-center min-h-[400px]">
                            <ZoomableSlide active={activeSlide === 0} wrapperClass="w-full max-w-[280px] drop-shadow-[0_25px_50px_rgba(0,0,0,0.8)]">
                                {slabbed ? (
                                    <div className="relative w-full aspect-[3/4] rounded-lg overflow-hidden">
                                        <GradedSlabFrame company={listing.grading_company} grade={listing.grade} size="md" title={card.name} subtitle={card.set}>
                                            <Image
                                                src={card.imageUrl || ""}
                                                alt={card.name}
                                                fill
                                                sizes="280px"
                                                className="object-contain"
                                            />
                                        </GradedSlabFrame>
                                    </div>
                                ) : (
                                    <Image
                                        src={card.imageUrl || ""}
                                        alt={card.name}
                                        width={280}
                                        height={392}
                                        className="w-full"
                                    />
                                )}
                            </ZoomableSlide>
                        </div>

                        {/* Slide 2: Real Front Photo */}
                        {listing.image_front_url && (
                            <div className="flex-none w-full snap-center flex justify-center p-8 items-center min-h-[400px]">
                                <ZoomableSlide active={activeSlide === frontSlideIndex} wrapperClass="w-full max-w-[280px] rounded-xl overflow-hidden drop-shadow-[0_25px_50px_rgba(0,0,0,0.8)] border border-white/10">
                                    <Image src={listing.image_front_url} alt="Front condition" width={280} height={392} className="w-full object-contain bg-black/50" />
                                </ZoomableSlide>
                            </div>
                        )}

                        {/* Slide 3: Real Back Photo */}
                        {listing.image_back_url && (
                            <div className="flex-none w-full snap-center flex justify-center p-8 items-center min-h-[400px]">
                                <ZoomableSlide active={activeSlide === backSlideIndex} wrapperClass="w-full max-w-[280px] rounded-xl overflow-hidden drop-shadow-[0_25px_50px_rgba(0,0,0,0.8)] border border-white/10">
                                    <Image src={listing.image_back_url} alt="Back condition" width={280} height={392} className="w-full object-contain bg-black/50" />
                                </ZoomableSlide>
                            </div>
                        )}
                    </div>
                    
                    {/* Pagination Dots */}
                    {(listing.image_front_url || listing.image_back_url) && (
                        <div className="flex justify-center gap-2 pb-4">
                            <div className={`w-2 h-2 rounded-full transition-all ${activeSlide === 0 ? 'bg-brand-cyan w-4' : 'bg-white/20'}`} />
                            {listing.image_front_url && (
                                <div className={`w-2 h-2 rounded-full transition-all ${activeSlide === frontSlideIndex ? 'bg-brand-cyan w-4' : 'bg-white/20'}`} />
                            )}
                            {listing.image_back_url && (
                                <div className={`w-2 h-2 rounded-full transition-all ${activeSlide === backSlideIndex ? 'bg-brand-cyan w-4' : 'bg-white/20'}`} />
                            )}
                        </div>
                    )}
                </div>

                <div className="px-6 space-y-6">
                    <div className="text-center">
                        <h1 className="text-2xl font-black text-white leading-none tracking-tight mb-2">{card.name}</h1>
                        <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">{card.set} • {card.rarity}</p>
                    </div>

                    {/* Listing Specifics */}
                    <div className="glass p-6 rounded-3xl border border-brand-green/20 space-y-4">
                        <div className="flex justify-between items-center border-b border-white/5 pb-4">
                            <div>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">{isThai ? 'ราคาขาย' : 'Asking Price'}</p>
                                <p className="text-4xl font-black text-brand-cyan">
                                    {CURRENCY_SYMBOLS[currency] || currency}{' '}
                                    {(listing.price * exchangeRate) < 1 ? (listing.price * exchangeRate).toFixed(2) : Math.round(listing.price * exchangeRate).toLocaleString()}
                                </p>
                                {/* Shipping, before checkout rather than at the
                                    payment screen. On a cheap card it is most of
                                    what the buyer pays. */}
                                <ShippingNote className="mt-1.5" />
                            </div>
                            <div className="text-right">
                                <span className="bg-brand-green/20 text-brand-green px-3 py-1 rounded-lg text-xs font-black uppercase tracking-widest border border-brand-green/20">
                                    {gradedLabel ?? listing.condition}
                                </span>
                            </div>
                        </div>

                        <div
                            className="flex items-center gap-4 pt-2 cursor-pointer group"
                            onClick={() => onSellerClick(listing.seller)}
                        >
                            <div className="w-12 h-12 rounded-2xl bg-slate-800 overflow-hidden border border-white/10 group-hover:border-brand-cyan transition-colors relative z-10">
                                <Image src={listing.seller.avatar_url || "https://api.dicebear.com/7.x/avataaars/svg?seed=seller"} alt="Seller Avatar" width={48} height={48} className="w-full h-full object-cover" />
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest group-hover:text-brand-cyan transition-colors">{isThai ? 'ผู้ขาย' : 'Seller'}</p>
                                <p className="text-white font-bold group-hover:text-brand-cyan transition-colors">{listing.seller.display_name}</p>
                                {(() => {
                                    const trust = getSellerTrust(listing.seller);
                                    if (trust.kind === 'partner')
                                        return (
                                            <div className="flex items-center gap-1 text-[10px] text-brand-cyan font-bold">
                                                <i className="fa-solid fa-circle-check"></i>
                                                {isThai ? 'พาร์ทเนอร์ทางการ' : 'Official Partner'}
                                            </div>
                                        );
                                    if (trust.kind === 'new')
                                        return <div className="text-[10px] text-slate-500 font-bold">{isThai ? 'ผู้ขายใหม่' : 'New Seller'}</div>;
                                    return (
                                        <div className="flex items-center gap-1 text-[10px]">
                                            <i className="fa-solid fa-star text-yellow-500"></i>
                                            <span className="text-slate-500 font-bold">{trust.rating.toFixed(1)}</span>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>

                    {/* Market data for the underlying card, as on the card database page */}
                    <div className="space-y-3">
                        <h3 className="font-black italic skew-x-[-10deg] text-white text-sm uppercase tracking-wider px-1 border-l-4 border-brand-cyan pl-3">{isThai ? 'ข้อมูลตลาด' : 'Market Data'}</h3>
                        {/* Current market price — a single real value. No fabricated
                            7-day change or "market high"; the trend below is real. */}
                        <div className="bg-[#1e293b]/50 backdrop-blur-sm p-4 rounded-2xl border border-white/5 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-12 h-12 bg-brand-cyan/10 rounded-bl-3xl"></div>
                            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">{isThai ? 'ราคาตลาด' : 'Market Price'}</p>
                            <p className="text-3xl font-black text-white">
                                {formatMarketPrice(card.prices?.market || card.marketPrice)}
                            </p>
                        </div>
                        {/* Real market-value-over-time (price_snapshots). Self-hides
                            until there is genuine history to draw. */}
                        <PriceHistoryChart
                            subjectId={card.id}
                            language={card.language}
                            condition={card.isSealed ? 'Sealed' : 'Market'}
                            currentPriceThb={card.prices?.market || card.marketPrice}
                            isThai={isThai}
                            panelClassName="bg-[#1e293b]/50 rounded-2xl border border-white/5 p-4"
                            chartClassName="h-44"
                        />
                    </div>
                </div>
            </div>

            <div className="absolute bottom-0 left-0 w-full px-6 pt-6 bg-brand-darker/90 backdrop-blur-xl border-t border-white/5 flex flex-col gap-3 z-50" style={{ paddingBottom: 'calc(1.5rem + var(--sab, 0px))' }}>
                {canOffer && (
                    hasPendingOffer ? (
                        <button
                            disabled
                            className="w-full h-12 bg-white/5 border border-white/10 text-slate-500 font-black text-[10px] tracking-[0.2em] rounded-xl uppercase flex items-center justify-center gap-2 cursor-not-allowed"
                        >
                            <i className="fa-solid fa-hourglass-half text-lg"></i>
                            {t('offer.pending')}
                        </button>
                    ) : (
                        <button
                            onClick={() => setIsOfferModalOpen(true)}
                            className="w-full h-12 bg-brand-cyan/10 border border-brand-cyan/40 text-brand-cyan hover:bg-brand-cyan/20 font-black text-[10px] tracking-[0.2em] rounded-xl active:scale-95 transition-all uppercase flex items-center justify-center gap-2"
                        >
                            <i className="fa-solid fa-hand-holding-dollar text-lg"></i>
                            {isThai ? 'เสนอราคา' : 'Make an Offer'}
                        </button>
                    )
                )}
                <div className="flex gap-3">
                    <button
                        onClick={onAddToCart}
                        className="flex-1 h-14 bg-white/5 border border-white/10 text-white hover:bg-white/10 font-black text-[10px] tracking-[0.2em] rounded-xl active:scale-95 transition-all uppercase flex items-center justify-center gap-2 group"
                    >
                        <i className="fa-solid fa-cart-plus text-brand-cyan group-hover:scale-110 transition-transform text-lg"></i>
                        {isThai ? 'เพิ่มลงรถเข็น' : 'Add to Cart'}
                    </button>
                    <button
                        // Call with no args — passing the bare handler hands the
                        // click event to handleBuyNow as its `listingArg`, which
                        // then builds a garbage cart (NaN total) and crashes the
                        // payment modal. The shell reads `selectedListing` instead.
                        onClick={() => onBuyNow()}
                        className="flex-[2] h-14 bg-brand-green text-brand-darker font-black text-[10px] tracking-[0.2em] rounded-xl shadow-lg shadow-brand-green/20 active:scale-95 transition-all uppercase flex items-center justify-center gap-2"
                    >
                        {isThai ? 'ซื้อเลย' : 'Buy Now'}
                        <i className="fa-solid fa-arrow-right"></i>
                    </button>
                </div>
            </div>

            {isOfferModalOpen && (
                <OfferModal
                    listingId={listing.id}
                    listingPrice={listing.price}
                    cardName={card.name}
                    onClose={() => setIsOfferModalOpen(false)}
                    onSubmitted={() => {
                        // Grey the button immediately — no refetch needed.
                        setHasPendingOffer(true);
                        onOfferSubmitted?.();
                    }}
                />
            )}

            <ReportModal 
                isOpen={isReportModalOpen} 
                onClose={() => setIsReportModalOpen(false)} 
                entityType="listing" 
                entityId={listing.id} 
                entityName={`${card.name} (${listing.condition})`} 
            />
        </div>
    );
};

export default ListingDetails;
