import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Card } from '../types';
import PriceHistoryChart from './PriceHistoryChart';
import { THAI_SETS, CURRENCY_SYMBOLS } from '@/constants';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getSellerTrust } from '@/lib/sellerTrust';
import { marketplaceService } from '@/services/marketplaceService';

interface CardDetailsProps {
  card: Card;
  isWishlisted: boolean;
  onClose: () => void;
  onAddToCollection: (card: Card) => void;
  onToggleWishlist: (card: Card) => void;
  onShopNow?: () => void;
  onAddToBuylist?: () => void;
  listings?: any[];
  actionButtons?: React.ReactNode;
  onAddToCart?: (item: any) => void;
  currency?: string;
  exchangeRate?: number;
  isVaultView?: boolean;
  vaultActionButtons?: React.ReactNode;
  // Signed-out viewers get a "sign in to save this" banner above the action
  // bar — the post-scan moment is the strongest signup hook in the app.
  showSignInPrompt?: boolean;
}

const CardDetails: React.FC<CardDetailsProps> = ({
  card,
  isWishlisted,
  onClose,
  onAddToCollection,
  onToggleWishlist,
  onShopNow,
  onAddToBuylist,
  listings = [],
  actionButtons,
  onAddToCart,
  currency = 'THB',
  exchangeRate = 1,
  isVaultView = false,
  vaultActionButtons,
  showSignInPrompt = false
}) => {
  const { isThai } = useTranslation();

  const [imageLoaded, setImageLoaded] = useState(false);

  // Real graded prices for this card: app sales (official) override JustTCG.
  // Empty until a grade tier actually has data — the dashboard stays blank
  // rather than inventing values off the raw price.
  interface GradedPrice { company: string; grade: number; label: string; price: number; source: 'app_sale' | 'market' | 'thai_estimate'; }
  const [gradedPrices, setGradedPrices] = useState<GradedPrice[]>([]);

  useEffect(() => {
    if (!card?.id) return;
    let cancelled = false;
    setGradedPrices([]);
    fetch(`/api/cards/${encodeURIComponent(card.id)}/graded-prices`)
      .then(res => (res.ok ? res.json() : { prices: [] }))
      .then(data => { if (!cancelled) setGradedPrices(data.prices || []); })
      .catch(() => { if (!cancelled) setGradedPrices([]); });
    return () => { cancelled = true; };
  }, [card?.id]);

  // Active listings for THIS card, fetched from the DB. The `listings` prop is
  // the 50 newest listings sitewide (Explore's price overlay cache) — a listing
  // older than that window is still live but absent from it, which used to make
  // this page claim "no listings" while the marketplace tab showed the card for
  // sale. The prop is kept as an instant first paint and merged in below.
  const [fetchedListings, setFetchedListings] = useState<any[] | null>(null);
  useEffect(() => {
    if (!card?.id || isVaultView) return;
    let cancelled = false;
    setFetchedListings(null);
    marketplaceService.getListingsForCard(card.id)
      .then(rows => { if (!cancelled) setFetchedListings(rows); })
      .catch(() => { if (!cancelled) setFetchedListings(null); });
    return () => { cancelled = true; };
  }, [card?.id, isVaultView]);

  const cardListings = useMemo(() => {
    const matchesCard = (l: any) =>
      l.card_data?.id === card.id || (l.card_data?.name === card.name && l.card_data?.set === card.set);
    const local = listings.filter(matchesCard);
    if (!fetchedListings) return local;
    // The per-card fetch joins on exact card_id; the prop's name+set fallback
    // can still catch a listing created against a twin catalog row, so merge.
    const seen = new Set(fetchedListings.map((l: any) => l.id));
    return [...fetchedListings, ...local.filter((l: any) => !seen.has(l.id))];
  }, [fetchedListings, listings, card.id, card.name, card.set]);

  // Thai Price Adjustment Logic
  const isThaiSet = THAI_SETS.some(s => card.set.includes(s) || s.includes(card.set));
  const priceAdjustment = isThaiSet ? 0.55 : 1.0;

  const displayExchangeRate = exchangeRate * priceAdjustment;
  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;

  // Format helper
  const formatPrice = (price: number) => {
    if (!price || price === 0) return 'N/A';
    const val = price * displayExchangeRate;
    if (currency === 'USD') {
      return `${currencySymbol} ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `${currencySymbol} ${Math.round(val).toLocaleString()}`;
  };

  // Graded prices are real transacted/market values, so they take the plain
  // currency conversion — not the Thai-set market estimate haircut in formatPrice.
  const formatGradedPrice = (priceThb: number) => {
    const val = priceThb * exchangeRate;
    if (currency === 'USD') {
      return `${currencySymbol} ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `${currencySymbol} ${Math.round(val).toLocaleString()}`;
  };

  const gradedColor = (company: string) => (
    { PSA: 'text-brand-cyan', BGS: 'text-brand-green', CGC: 'text-brand-red', TAG: 'text-amber-400' } as Record<string, string>
  )[company] || 'text-white';

  // Prioritize hires images if available
  const displayImageUrl = card.imageUrl;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-brand-darker animate-slideUp">
      {/* Header with Wishlist Toggle */}
      <div className="px-6 pb-6 flex justify-between items-center sticky top-0 z-10 bg-brand-darker/80 backdrop-blur-lg border-b border-white/5" style={{ paddingTop: 'calc(1.5rem + var(--sat))' }}>
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 active:bg-brand-cyan active:text-brand-darker transition-all border border-white/5"
        >
          <i className="fa-solid fa-chevron-left text-sm"></i>
        </button>
        <div className="text-center">
          <span className="font-black italic skew-x-[-10deg] uppercase tracking-wider text-xs text-brand-cyan block">{isThai ? 'ข้อมูลเชิงลึก' : 'Asset Details'}</span>
          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{card.number}</span>
        </div>
        <button
          onClick={() => onToggleWishlist(card)}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/5 active:scale-90 transition-all group"
        >
          <i className={`fa-solid fa-heart transition-colors ${isWishlisted ? 'text-brand-red' : 'text-slate-500 group-hover:text-brand-red'}`}></i>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-40 scrollbar-hide bg-dots">
        {/* Card Image Showcase with Lazy Loading & High-Res Priority */}
        <div className="p-8 flex justify-center relative min-h-[380px]">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-cyan/5 to-transparent pointer-events-none"></div>

          {/* Skeleton Loader - Matches Card Aspect Ratio */}
          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center z-0">
              <div className="w-[280px] aspect-[3/4] glass rounded-xl animate-pulse flex items-center justify-center border border-white/10 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-tr from-white/5 via-white/10 to-transparent"></div>
                <i className="fa-solid fa-folder-plus text-base font-normal"></i>
                <div className="flex flex-col items-center">
                  {isThai ? 'เพิ่มเข้าคลัง' : 'Add to Vault'}
                </div>
              </div>
            </div>
          )}

          {/* Main Image with Lazy Loading */}
          <Image
            src={displayImageUrl || ""}
            alt={card.name}
            width={280}
            height={392}
            onLoad={() => setImageLoaded(true)}
            className={`w-full max-w-[280px] drop-shadow-[0_25px_50px_rgba(0,0,0,0.8)] transition-all duration-700 ease-out z-10 ${imageLoaded ? 'opacity-100 scale-100 blur-0' : 'opacity-0 scale-95 blur-sm'}`}
          />
        </div>

        <div className="px-6 space-y-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-brand-cyan text-brand-darker px-2 py-0.5 rounded text-[9px] font-black uppercase italic skew-x-[-10deg] shadow-lg shadow-brand-cyan/20">{card.rarity}</span>
              <span className="text-slate-400 text-[10px] font-bold tracking-widest uppercase">{card.set}</span>
            </div>
            <h1 className="text-3xl font-black text-white leading-none tracking-tight">{card.name}</h1>
            <h2 className="text-lg font-bold text-slate-500 tracking-wide">{card.thaiName}</h2>
          </div>

          {/* Current market price — a single real value. No fabricated 7-day change
              or "market high"; the real price range comes from live listings below. */}
          <div className="bg-slate-800/50 backdrop-blur-sm p-4 rounded-2xl border border-white/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-12 h-12 bg-brand-cyan/10 rounded-bl-3xl"></div>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">{isThai ? 'ราคาตลาด' : 'Market Price'}</p>
            <p className="text-3xl font-black text-white">
              {formatPrice(card.prices?.market || card.marketPrice)}
            </p>
          </div>

          {/* Real market-value-over-time (price_snapshots). Self-hides until there
              is genuine history to draw — no synthesized trend. */}
          <PriceHistoryChart
            subjectId={card.id}
            language={card.language}
            condition={card.isSealed ? 'Sealed' : 'Market'}
            currentPriceThb={card.prices?.market || card.marketPrice}
            isThai={isThai}
            panelClassName="bg-slate-800/50 rounded-2xl border border-white/5 p-4"
            chartClassName="h-44"
          />

          {!isVaultView ? (
            <>
              {/* Marketplace Listings (Individual Sellers) */}
              <div className="space-y-4">
                <h3 className="font-black italic skew-x-[-10deg] text-white text-sm uppercase tracking-wider px-1 border-l-4 border-brand-green pl-3">{isThai ? 'สถานะการวางขาย' : 'Marketplace Listings'}</h3>
                <div className="space-y-2">
                  {cardListings.length > 0 ? (
                    cardListings
                      .map((listing, idx) => (
                        <div key={idx} className="bg-white/[0.03] p-4 rounded-xl border border-white/5 flex justify-between items-center group hover:border-brand-green/30 transition-all">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-800 overflow-hidden border border-white/10 flex-shrink-0">
                              {listing.seller?.avatar_url ? (
                                <Image src={listing.seller.avatar_url} alt="Seller Avatar" width={40} height={40} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-slate-500">?</div>
                              )}
                            </div>
                            <div>
                              <p className="text-white text-xs font-bold">{listing.seller?.display_name || 'User'}</p>
                              <div className="flex items-center gap-2">
                                <span className={`text-[9px] font-black uppercase tracking-widest ${listing.is_graded && listing.grading_company ? 'text-amber-400' : 'text-brand-green'}`}>
                                  {listing.is_graded && listing.grading_company
                                    ? `${listing.grading_company} ${listing.grade != null ? Number(listing.grade) : ''}`.trim()
                                    : listing.condition}
                                </span>
                                <span className="w-1 h-1 rounded-full bg-slate-700"></span>
                                {(() => {
                                  const trust = getSellerTrust(listing.seller);
                                  if (trust.kind === 'partner')
                                    return <span className="text-[8px] text-brand-cyan font-bold uppercase">{isThai ? 'พาร์ทเนอร์ทางการ' : 'Official Partner'}</span>;
                                  if (trust.kind === 'new')
                                    return <span className="text-[8px] text-slate-500 font-bold uppercase">{isThai ? 'ผู้ขายใหม่' : 'New Seller'}</span>;
                                  return <span className="text-[8px] text-slate-500 font-bold uppercase">{trust.rating.toFixed(1)} ★</span>;
                                })()}
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex items-center gap-4">
                            <p className="text-white text-base font-black italic">
                              {currencySymbol} {Math.round(listing.price * exchangeRate).toLocaleString()}
                            </p>
                            <button
                              onClick={() => onAddToCart && onAddToCart({
                                id: listing.id,
                                cardId: listing.card_id,
                                card: listing.card_data,
                                price: listing.price,
                                sellerId: listing.seller_id,
                                sellerName: listing.seller?.display_name || 'Unknown',
                                condition: listing.condition
                              })}
                              className="bg-brand-green text-brand-darker text-[9px] font-black px-4 py-2 rounded-lg hover:bg-white transition-colors active:scale-95 shadow-lg shadow-brand-green/10"
                            >
                              BUY
                            </button>
                          </div>
                        </div>
                      ))
                  ) : (
                    <div className="py-8 border border-dashed border-white/5 rounded-xl text-center">
                      <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">{isThai ? 'ไม่มีรายการขายในขณะนี้' : 'No listings available for this item'}</p>
                      <button className="mt-2 text-[9px] text-brand-cyan font-black uppercase tracking-widest hover:text-white transition-colors">Notify me on drop</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Graded Section — only rendered when we have real graded prices */}
              {gradedPrices.length > 0 && (
                <div className="space-y-4">
                  <h3 className="font-black italic skew-x-[-10deg] text-white text-sm uppercase tracking-wider px-1 border-l-4 border-brand-cyan pl-3">{isThai ? 'แดชบอร์ดการ์ดเกรด' : 'Graded Dashboard'}</h3>
                  <div className="space-y-2">
                    {gradedPrices.map((graded) => (
                      <div key={graded.label} className="flex justify-between items-center bg-white/[0.03] p-4 rounded-xl border border-white/5 hover:border-brand-cyan/30 transition-all cursor-default">
                        <div>
                          <p className="font-black text-white text-sm tracking-tight">{graded.label}</p>
                          <p className="text-[9px] text-slate-500 uppercase font-bold tracking-widest">
                            {graded.source === 'app_sale'
                              ? (isThai ? 'ขายบนแอป' : 'Sold on CardStreet')
                              : graded.source === 'thai_estimate'
                                ? (isThai ? 'ประมาณจากอังกฤษ ×60%' : 'Est. (EN ×60%)')
                                : (isThai ? 'ราคาตลาด' : 'Market')}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`font-black text-base ${gradedColor(graded.company)}`}>
                            {formatGradedPrice(graded.price)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4 mt-6">
              {vaultActionButtons}
            </div>
          )}
        </div>
      </div>

      {/* Action Bar */}
      {actionButtons ? actionButtons : (
        <div className="fixed bottom-0 left-0 w-full p-6 bg-brand-darker/90 backdrop-blur-xl border-t border-white/5 flex flex-col gap-3 z-20">
          {showSignInPrompt && (
            <button
              onClick={() => onAddToCollection(card)}
              className="w-full flex items-center gap-3 bg-brand-cyan/10 border border-brand-cyan/25 rounded-xl px-4 py-3 text-left active:scale-[0.98] transition-all"
            >
              <i className="fa-solid fa-circle-user text-brand-cyan text-xl"></i>
              <span className="flex-1 text-sm font-semibold text-white leading-snug">
                {isThai
                  ? 'เข้าสู่ระบบฟรีเพื่อบันทึกการ์ดนี้เข้าคลังของคุณ'
                  : 'Sign in free to save this card to your vault'}
              </span>
              <i className="fa-solid fa-arrow-right text-brand-cyan"></i>
            </button>
          )}
          <div className="flex gap-3">
          <button
            onClick={() => onAddToCollection(card)}
            className="flex-1 h-14 bg-white/5 border border-white/10 text-white hover:bg-white/10 font-black text-[10px] tracking-[0.2em] rounded-xl active:scale-95 transition-all uppercase flex items-center justify-center gap-2 group"
          >
            <i className="fa-solid fa-vault text-brand-cyan group-hover:scale-110 transition-transform"></i>
            {isThai ? 'เพิ่มเข้าคลัง' : 'Add to Vault'}
          </button>
          <button
            onClick={() => {
              if (cardListings.length > 0 && onShopNow) {
                onShopNow();
              } else if (onAddToBuylist) {
                onAddToBuylist();
              }
            }}
            className="flex-1 h-14 bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black text-[10px] tracking-[0.2em] rounded-xl shadow-lg shadow-brand-cyan/20 active:scale-95 transition-all uppercase flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-store"></i>
            {isThai ? 'ช้อปเลย' : 'Shop Now'}
          </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CardDetails;