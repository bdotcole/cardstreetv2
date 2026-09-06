import React, { useState, useRef } from 'react';
import { Card, CardCondition } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { calculateRecommendedPrice } from '@/lib/utils/priceCalculator';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { usePremium } from '@/lib/hooks/usePremium';
import { minListingPriceThb } from '@/lib/pricingFloors';
import { clampRecommendation, evaluatePrice, isUsableMarketValue } from '@/lib/listingPriceGuidance';
import { CATALOG_ART_MAX_PRICE_THB, catalogArtAllowed } from '@/lib/listingPhotoPolicy';
import { marketplaceService } from '@/services/marketplaceService';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import CustomSelect from './CustomSelect';
import SellerInfoModal from './SellerInfoModal';
import { getThumbnailUrl } from '@/lib/imageUtils';

// Shown once per device the first time the listing form opens, so a new seller
// understands the fees and that they pay Flash for shipping at pickup.
const SELLER_INFO_ACK_KEY = 'cs_seller_info_ack_v1';

interface ListingFormProps {
  card: Card;
  initialCondition?: CardCondition;
  onClose: () => void;
  onSuccess: (data?: any) => Promise<void> | void;
}

const ListingForm: React.FC<ListingFormProps> = ({ card, initialCondition, onClose, onSuccess }) => {
  const { t, isThai } = useTranslation();
  // Admins may seed the marketplace below the standard 20-baht floor (e.g. a
  // 1-baht test/seed listing); everyone else keeps the 20 minimum. This is UX
  // only -- usePremium fails closed, so a lookup miss safely keeps the 20 floor,
  // and the server/DB independently enforce price > 0. A sub-floor sale never
  // teaches market value (lib/pricingFloors.ts).
  const { isAdmin } = usePremium();
  const minPrice = minListingPriceThb(isAdmin);
  // Sealed products list factory-sealed only: condition is locked and grading
  // doesn't apply, so both sections are hidden below.
  const isSealed = !!card.isSealed;
  const [price, setPrice] = useState<string>('');
  const [condition, setCondition] = useState<CardCondition>(
    isSealed ? CardCondition.Sealed : (initialCondition || CardCondition.NM)
  );
  const [isGraded, setIsGraded] = useState(false);
  const [gradingCompany, setGradingCompany] = useState('PSA');
  const [grade, setGrade] = useState('10');
  // OBO Best-Offer opt-in. The toggle only renders while the offers feature flag
  // is on (see the JSX below); the field is always sent so the write path is
  // consistent, and defaults false so non-OBO listings are unchanged.
  const [acceptsOffers, setAcceptsOffers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendedPrice, setRecommendedPrice] = useState<number>(0);
  // Cheapest active listing for this same card, for the "lowest active listing
  // ฿Y" line. Undefined until loaded / when there are none — a seller who is
  // the first to list must not be shown a comparison to nothing.
  const [lowestActive, setLowestActive] = useState<number | undefined>(undefined);
  // Second tap for a price far above market (see OVER_MARKET_CONFIRM_RATIO).
  const [overpriceAcknowledged, setOverpriceAcknowledged] = useState(false);
  // Copies of this exact card. Creates N identical listing rows, so each can
  // sell independently (see createListing's `quantity`).
  const [quantity, setQuantity] = useState(1);
  const [useCatalogArt, setUseCatalogArt] = useState(false);
  
  // Photo states
  const [frontImageBlob, setFrontImageBlob] = useState<Blob | null>(null);
  const [frontImagePreview, setFrontImagePreview] = useState<string | null>(null);
  const [backImageBlob, setBackImageBlob] = useState<Blob | null>(null);
  const [backImagePreview, setBackImagePreview] = useState<string | null>(null);
  
  // First-listing explainer: open it on mount unless this device already
  // acknowledged it. SSR-safe (localStorage read deferred to an effect).
  const [showSellerInfo, setShowSellerInfo] = useState(false);
  React.useEffect(() => {
    try {
      if (!localStorage.getItem(SELLER_INFO_ACK_KEY)) setShowSellerInfo(true);
    } catch {
      /* localStorage unavailable (private mode) — just skip the explainer */
    }
  }, []);

  const dismissSellerInfo = () => {
    try { localStorage.setItem(SELLER_INFO_ACK_KEY, '1'); } catch { /* ignore */ }
    setShowSellerInfo(false);
  };

  const isSubmittingRef = useRef(false);
  const frontFileInputRef = useRef<HTMLInputElement>(null);
  const backFileInputRef = useRef<HTMLInputElement>(null);

  // Recalculate recommendation when inputs change
  React.useEffect(() => {
    const rec = calculateRecommendedPrice({
      basePrice: card.marketPrice,
      condition,
      isGraded,
      gradingCompany: isGraded ? gradingCompany : undefined,
      grade: isGraded ? grade : undefined
    });
    // Clamped to the public floor: a recommendation the form would then reject
    // is a bug the seller has to diagnose. Admins keep their own lower floor,
    // so only clamp when the seller is held to 20.
    setRecommendedPrice(isAdmin ? Math.round(rec) : clampRecommendation(rec));
  }, [card.marketPrice, condition, isGraded, gradingCompany, grade, isAdmin]);

  // Lowest active listing on the same card. Best-effort: a failure just hides
  // that half of the guidance rather than blocking the form.
  React.useEffect(() => {
    if (!card?.id) return;
    let cancelled = false;
    marketplaceService
      .getListingsForCard(card.id)
      .then((rows) => {
        if (cancelled) return;
        const prices = rows.map((r) => Number(r.price)).filter((p) => Number.isFinite(p) && p > 0);
        setLowestActive(prices.length ? Math.min(...prices) : undefined);
      })
      .catch(() => { /* guidance degrades to market-only */ });
    return () => { cancelled = true; };
  }, [card?.id]);

  // Any edit re-arms the confirm tap, so an acknowledged 3x price cannot be
  // silently edited up to 10x and published on the already-spent confirmation.
  const guidance = evaluatePrice(parseFloat(price), card.marketPrice, lowestActive);
  React.useEffect(() => { setOverpriceAcknowledged(false); }, [price]);

  const canUseCatalogArt = catalogArtAllowed(parseFloat(price), condition);
  // Untick automatically when the seller edits past the threshold, so the
  // option can never be silently in force for a card it does not cover.
  React.useEffect(() => {
    if (!canUseCatalogArt) setUseCatalogArt(false);
  }, [canUseCatalogArt]);

  const takePhoto = async (side: 'front' | 'back') => {
    try {
      const image = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera // Force camera
      });

      if (image.webPath) {
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        if (side === 'front') {
          setFrontImageBlob(blob);
          setFrontImagePreview(image.webPath);
        } else {
          setBackImageBlob(blob);
          setBackImagePreview(image.webPath);
        }
      }
    } catch (e: any) {
      console.log('Camera error or cancelled:', e);
      // Fallback to hidden file inputs on web or if camera fails
      if (side === 'front') frontFileInputRef.current?.click();
      if (side === 'back') backFileInputRef.current?.click();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, side: 'front' | 'back') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    if (side === 'front') {
      setFrontImageBlob(file);
      setFrontImagePreview(previewUrl);
    } else {
      setBackImageBlob(file);
      setBackImagePreview(previewUrl);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Sealed products need one photo of the item; the second angle is optional.
    // Raw cards still require both faces for condition assessment — UNLESS the
    // card is cheap and near-mint enough for the catalog image to stand in
    // (lib/listingPhotoPolicy.ts). Two photographs per 40-baht common is why
    // bulk never gets listed.
    if (!useCatalogArt && (!frontImageBlob || (!isSealed && !backImageBlob))) {
      setError(isThai
        ? (isSealed ? 'กรุณาอัปโหลดรูปถ่ายสินค้า' : 'กรุณาอัปโหลดรูปภาพด้านหน้าและด้านหลังของการ์ด')
        : (isSealed ? 'Please provide a photo of the sealed product.' : 'Please provide both front and back photos of the card.'));
      return;
    }
    // The checkbox can be left ticked while the price or condition is edited
    // past the threshold — re-check against the values being submitted, not
    // against what was true when it was ticked.
    if (useCatalogArt && !canUseCatalogArt) {
      setError(t('listingPhotos.photosRequired'));
      return;
    }
    
    // A price far above market takes a second, deliberate tap. Not a modal:
    // the seller may have a good reason (a graded card the catalog undervalues,
    // a print the market row does not distinguish), so this must be a speed
    // bump, not a wall. Any edit to the price re-arms it.
    if (guidance.requiresConfirm && !overpriceAcknowledged) {
      setOverpriceAcknowledged(true);
      setError(t('listingPrice.confirmPrompt'));
      return;
    }

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    setIsSubmitting(true);
    setError(null);

    try {
      // Defer database insertion to the parent component (page.tsx)
      // which uses marketplaceService and handles global state updates

      let front_url: string | null = null;
      let back_url: string | null = null;
      const supabase = createClient();

      // Catalog art: leave both URLs null. The listing tile already falls back
      // to card_data.images when image_front_url is absent, so nothing needs a
      // placeholder written into it — and a null keeps "this seller supplied a
      // photo" answerable later.
      if (!useCatalogArt && frontImageBlob) {
        // Upload Front Image
        const frontPath = `listings/${card.id}/${Date.now()}_front.jpg`;
        const { data: frontData, error: frontError } = await supabase.storage
          .from('listing-images')
          .upload(frontPath, frontImageBlob, { contentType: 'image/jpeg' });

        if (frontError) throw new Error("Failed to upload front image: " + frontError.message);
        front_url = supabase.storage.from('listing-images').getPublicUrl(frontData.path).data.publicUrl;
      }

      // Upload Back Image (optional for sealed products)
      if (!useCatalogArt && backImageBlob) {
        const backPath = `listings/${card.id}/${Date.now()}_back.jpg`;
        const { data: backData, error: backError } = await supabase.storage
          .from('listing-images')
          .upload(backPath, backImageBlob, { contentType: 'image/jpeg' });

        if (backError) throw new Error("Failed to upload back image: " + backError.message);
        back_url = supabase.storage.from('listing-images').getPublicUrl(backData.path).data.publicUrl;
      }

      const listingData = {
        card_id: card.id,
        quantity,
        price: parseFloat(price),
        condition,
        is_graded: isGraded,
        grading_company: isGraded ? gradingCompany : null,
        grade: isGraded ? parseFloat(grade) : null,
        image_front_url: front_url,
        image_back_url: back_url,
        accepts_offers: acceptsOffers
      };

      await onSuccess(listingData);
      onClose();
    } catch (err: any) {
      setError(err.message);
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <SellerInfoModal isOpen={showSellerInfo} onClose={dismissSellerInfo} />
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>

      <div className="relative w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-slideUp">
        {/* Header */}
        <div className="bg-brand-darker/50 p-4 border-b border-white/5 flex justify-between items-center">
          <h3 className="text-white font-black italic skew-x-[-5deg] text-lg uppercase">{isThai ? 'รายการขาย' : 'List for Sale'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[80vh] pb-40">
          {/* Card Preview */}
          <div className="flex gap-4 mb-6">
            <div className="w-20 h-28 bg-brand-darker rounded-lg border border-white/10 overflow-hidden flex-shrink-0">
              <img src={getThumbnailUrl(card.images?.small || card.imageUrl)} alt={card.name} decoding="async" className={`w-full h-full ${isSealed ? 'object-contain' : 'object-cover'}`} />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-white font-bold truncate">{card.name}</h4>
              <p className="text-xs text-slate-400">{isSealed ? card.set : `${card.set} #${card.number}`}</p>
              <div className="mt-2 text-xs text-brand-green font-bold bg-brand-green/10 inline-block px-2 py-1 rounded">
                {isThai ? 'ตลาด' : 'Market'}: ฿{card.marketPrice?.toLocaleString() || '-'}
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Price Input */}
            <div>
              <div className="flex justify-between items-end mb-1.5">
                <label className="text-xs font-bold text-slate-400 uppercase">{isThai ? 'ราคาขาย' : 'Asking Price'} (THB)</label>
                {recommendedPrice > 0 && (
                  <button
                    type="button"
                    onClick={() => setPrice(recommendedPrice.toString())}
                    className={`text-[10px] text-brand-cyan hover:text-white font-bold transition-colors ${isThai ? '' : 'uppercase'}`}
                  >
                    {t('listingPrice.useRecommended')}: ฿{recommendedPrice.toLocaleString()}
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">฿</span>
                <input
                  type="number"
                  required
                  min={minPrice}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={`w-full h-12 bg-white/5 border rounded-xl pl-8 pr-4 text-white font-bold outline-none transition-colors placeholder-slate-600 ${
                    guidance.warn ? 'border-amber-400/60 focus:border-amber-400' : 'border-white/10 focus:border-brand-cyan'
                  }`}
                  placeholder={recommendedPrice > 0 ? `${t('listingPrice.useRecommended')}: ${recommendedPrice.toLocaleString()}` : '0.00'}
                />
              </div>

              {/* Price guidance. Silent when the catalog's market value is the
                  10-baht placeholder daily-market-update writes for a card it
                  has no real price for (52% of Thai rows) — comparing against
                  that would be confidently wrong and would push a correct
                  price down. isUsableMarketValue is the gate. */}
              {(isUsableMarketValue(card.marketPrice) || guidance.lowestActive !== undefined) && (
                <div className="mt-2 space-y-1">
                  {guidance.percentFromMarket !== undefined && (
                    <p className={`text-[11px] font-bold ${guidance.warn ? 'text-amber-400' : guidance.verdict === 'under' ? 'text-brand-green' : 'text-slate-400'}`}>
                      {Math.abs(guidance.percentFromMarket) < 3
                        ? t('listingPrice.atMarket')
                        : `${Math.abs(guidance.percentFromMarket)}% ${guidance.percentFromMarket > 0 ? t('listingPrice.aboveMarket') : t('listingPrice.belowMarket')}`}
                    </p>
                  )}
                  {guidance.lowestActive !== undefined && (
                    <p className="text-[11px] text-slate-500">
                      {t('listingPrice.lowestActive')}: ฿{guidance.lowestActive.toLocaleString()}
                    </p>
                  )}
                  {guidance.warn && (
                    <p className="text-[11px] text-amber-400/80 leading-snug">{t('listingPrice.highWarning')}</p>
                  )}
                </div>
              )}
            </div>

            {/* Copies. One listing row per copy — see createListing's quantity. */}
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">{t('listingPhotos.quantity')}</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white font-black disabled:opacity-30 active:scale-95 transition-all"
                >
                  −
                </button>
                <span className="w-12 text-center text-white font-black tabular-nums text-lg">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(20, q + 1))}
                  disabled={quantity >= 20}
                  className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-white font-black disabled:opacity-30 active:scale-95 transition-all"
                >
                  +
                </button>
                {quantity > 1 && (
                  <span className="text-[11px] text-slate-500 leading-snug flex-1">{t('listingPhotos.quantityHint')}</span>
                )}
              </div>
            </div>

            {/* Condition — sealed products are factory sealed by definition */}
            {isSealed ? (
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">{isThai ? 'สภาพสินค้า' : 'Condition'}</label>
                <div className="h-10 rounded-lg text-xs font-bold border bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30 flex items-center justify-center gap-2">
                  <i className="fa-solid fa-box"></i>
                  {isThai ? 'ซีล (ยังไม่แกะ)' : 'Factory Sealed'}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">{isThai ? 'สภาพการ์ด' : 'Condition'}</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(CardCondition).filter(([, cond]) => cond !== CardCondition.Sealed).map(([abbr, cond]) => (
                    <button
                      key={cond}
                      type="button"
                      onClick={() => setCondition(cond)}
                      className={`h-10 rounded-lg text-xs font-bold border transition-all ${condition === cond
                        ? 'bg-brand-cyan text-brand-darker border-brand-cyan'
                        : 'bg-white/5 text-slate-400 border-white/5 hover:border-white/20'
                        }`}
                    >
                      {abbr}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Grading Toggle — not applicable to sealed products */}
            {!isSealed && (
            <div className="flex items-center gap-3 py-2">
              <button
                type="button"
                onClick={() => setIsGraded(!isGraded)}
                className={`w-12 h-6 rounded-full p-1 transition-colors ${isGraded ? 'bg-brand-cyan' : 'bg-slate-700'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${isGraded ? 'translate-x-6' : 'translate-x-0'}`}></div>
              </button>
              <span className="text-sm font-bold text-white">{isThai ? 'การ์ดใบนี้ได้รับการเกรดอย่างเป็นทางการ' : 'This card is professionally graded'}</span>
            </div>
            )}

            {!isSealed && isGraded && (
              <div className="grid grid-cols-2 gap-4 bg-white/5 p-4 rounded-xl border border-white/5 animate-fadeIn">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Company</label>
                  <CustomSelect
                    ariaLabel="Company"
                    value={gradingCompany}
                    onChange={setGradingCompany}
                    options={[
                      { value: 'PSA', label: 'PSA' },
                      { value: 'BGS', label: 'BGS' },
                      { value: 'CGC', label: 'CGC' },
                      { value: 'TAG', label: 'TAG' },
                    ]}
                    triggerClassName="w-full h-10 bg-brand-darker border border-white/10 rounded-lg px-3 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Grade</label>
                  <input
                    type="number"
                    value={grade}
                    onChange={(e) => setGrade(e.target.value)}
                    className="w-full h-10 bg-brand-darker border border-white/10 rounded-lg px-3 text-white text-sm"
                    max="10"
                    min="1"
                    step="0.5"
                  />
                </div>
              </div>
            )}

            {/* Accept offers (OBO) toggle — only while the offers feature is live */}
            {process.env.NEXT_PUBLIC_ENABLE_OFFERS === '1' && (
              <div className="flex items-center gap-3 py-2">
                <button
                  type="button"
                  onClick={() => setAcceptsOffers(!acceptsOffers)}
                  className={`w-12 h-6 rounded-full p-1 transition-colors ${acceptsOffers ? 'bg-brand-cyan' : 'bg-slate-700'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${acceptsOffers ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
                <span className="text-sm font-bold text-white">
                  {isThai ? 'รับข้อเสนอราคา (ต่อรองได้)' : 'Accept offers (OBO)'}
                </span>
              </div>
            )}

            {/* Photos. Required, except for cheap near-mint cards where the
                catalog image may stand in — see lib/listingPhotoPolicy.ts. */}
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                {useCatalogArt
                  ? (isThai ? 'รูปการ์ด' : 'Card photo')
                  : (isThai ? 'รูปถ่ายจริง (บังคับ)' : (isSealed ? 'Real Photo (Required)' : 'Real Photos (Required)'))}
              </label>

              {/* Only offered once the price and condition actually qualify, so
                  the checkbox never appears next to a card it cannot cover. */}
              {canUseCatalogArt && (
                <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCatalogArt}
                    onChange={(e) => setUseCatalogArt(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-brand-cyan"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-white">{t('listingPhotos.useCatalogArt')}</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5 leading-snug">{t('listingPhotos.useCatalogArtHint')}</span>
                  </span>
                </label>
              )}

              {useCatalogArt ? (
                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <img
                    src={getThumbnailUrl(card.images?.small || card.imageUrl)}
                    alt={card.name}
                    className={`w-14 h-20 rounded-lg ${isSealed ? 'object-contain' : 'object-cover'}`}
                  />
                  <p className="text-[11px] text-slate-400 leading-snug">
                    {isThai
                      ? `ใช้รูปแคตตาล็อกได้เพราะราคาไม่เกิน ฿${CATALOG_ART_MAX_PRICE_THB} และสภาพ NM`
                      : `Catalog image is allowed here: near-mint and at or under ฿${CATALOG_ART_MAX_PRICE_THB}.`}
                  </p>
                </div>
              ) : (
              <div className="flex gap-4">
                {/* Front Photo */}
                <div className="flex-1">
                  <input 
                    type="file" 
                    accept="image/*" 
                    ref={frontFileInputRef} 
                    className="hidden" 
                    onChange={(e) => handleFileUpload(e, 'front')} 
                  />
                  <div 
                    onClick={() => takePhoto('front')}
                    className="w-full aspect-[3/4] rounded-xl border-2 border-dashed border-white/20 bg-white/5 flex flex-col items-center justify-center cursor-pointer hover:border-brand-cyan hover:bg-white/10 transition-colors overflow-hidden group relative"
                  >
                    {frontImagePreview ? (
                      <>
                        <img src={frontImagePreview} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <i className="fa-solid fa-camera text-white text-xl"></i>
                        </div>
                      </>
                    ) : (
                      <div className="text-center p-2">
                        <i className="fa-solid fa-camera text-slate-400 text-2xl mb-2 group-hover:text-brand-cyan transition-colors"></i>
                        <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">{isSealed ? (isThai ? 'รูปสินค้า' : 'Product') : (isThai ? 'ด้านหน้า' : 'Front')}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Back Photo */}
                <div className="flex-1">
                  <input 
                    type="file" 
                    accept="image/*" 
                    ref={backFileInputRef} 
                    className="hidden" 
                    onChange={(e) => handleFileUpload(e, 'back')} 
                  />
                  <div 
                    onClick={() => takePhoto('back')}
                    className="w-full aspect-[3/4] rounded-xl border-2 border-dashed border-white/20 bg-white/5 flex flex-col items-center justify-center cursor-pointer hover:border-brand-cyan hover:bg-white/10 transition-colors overflow-hidden group relative"
                  >
                    {backImagePreview ? (
                      <>
                        <img src={backImagePreview} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <i className="fa-solid fa-camera text-white text-xl"></i>
                        </div>
                      </>
                    ) : (
                      <div className="text-center p-2">
                        <i className="fa-solid fa-camera text-slate-400 text-2xl mb-2 group-hover:text-brand-cyan transition-colors"></i>
                        <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">{isSealed ? (isThai ? 'มุมอื่น (ไม่บังคับ)' : 'Optional') : (isThai ? 'ด้านหลัง' : 'Back')}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-bold flex items-center gap-2">
                <i className="fa-solid fa-circle-exclamation"></i>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-14 bg-brand-green hover:bg-brand-green/90 active:scale-[0.98] rounded-xl text-brand-darker font-black uppercase tracking-wider shadow-lg shadow-brand-green/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <div className="w-5 h-5 border-2 border-brand-darker border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <i className="fa-solid fa-tag"></i>
                  {isThai ? 'รายการขาย' : 'List for Sale'}
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ListingForm;
