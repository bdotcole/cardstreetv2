import React from 'react';
import Image from 'next/image';
import { SealedProduct } from '../services/pokemonService';
import { CURRENCY_SYMBOLS } from '@/constants';
import { useTranslation } from '@/lib/hooks/useTranslation';

interface SealedProductDetailProps {
  product: SealedProduct;
  onClose: () => void;
  currency?: string;
  exchangeRate?: number;
}

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  booster_box: 'Booster Box',
  etb: 'Elite Trainer Box',
  booster_pack: 'Booster Pack',
  bundle: 'Booster Bundle',
  collection: 'Collection',
  other: 'Sealed',
};

const SealedProductDetail: React.FC<SealedProductDetailProps> = ({ product, onClose, currency = 'THB', exchangeRate = 1 }) => {
  const { isThai } = useTranslation();
  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;

  // Prices arrive in THB (base); convert to the display currency.
  const fmt = (priceThb: number | null | undefined) => {
    if (!priceThb || priceThb <= 0) return 'N/A';
    const val = priceThb * exchangeRate;
    if (currency === 'USD') {
      return `${currencySymbol} ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `${currencySymbol} ${Math.round(val).toLocaleString()}`;
  };

  const tiers: Array<{ key: string; label: string; price: number | null }> = [
    { key: 'sealed', label: isThai ? 'ซีล (ใหม่)' : 'Factory Sealed', price: product.prices?.sealed },
    { key: 'cib', label: isThai ? 'ครบกล่อง' : 'Complete', price: product.prices?.cib },
    { key: 'loose', label: isThai ? 'เปิดแล้ว' : 'Loose', price: product.prices?.loose },
  ].filter((tt) => tt.price && tt.price > 0);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-brand-darker animate-slideUp">
      {/* Header */}
      <div className="px-6 pb-6 flex justify-between items-center sticky top-0 z-10 bg-brand-darker/80 backdrop-blur-lg border-b border-white/5" style={{ paddingTop: 'calc(1.5rem + var(--sat))' }}>
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 active:bg-brand-cyan active:text-brand-darker transition-all border border-white/5"
        >
          <i className="fa-solid fa-chevron-left text-sm"></i>
        </button>
        <div className="text-center">
          <span className="font-black italic skew-x-[-10deg] uppercase tracking-wider text-xs text-brand-cyan block">{isThai ? 'สินค้าซีล' : 'Sealed Product'}</span>
          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{PRODUCT_TYPE_LABEL[product.productType || 'other'] || 'Sealed'}</span>
        </div>
        <div className="w-10 h-10" aria-hidden="true" />
      </div>

      <div className="flex-1 overflow-y-auto pb-40 scrollbar-hide bg-dots">
        {/* Image */}
        <div className="p-8 flex justify-center relative min-h-[300px]">
          <div className="absolute inset-0 bg-gradient-to-b from-brand-cyan/5 to-transparent pointer-events-none"></div>
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              width={280}
              height={280}
              className="w-full max-w-[280px] object-contain drop-shadow-[0_25px_50px_rgba(0,0,0,0.8)] z-10"
            />
          ) : (
            <div className="w-[240px] aspect-square glass rounded-2xl flex flex-col items-center justify-center border border-white/10 z-10">
              <i className="fa-solid fa-box-open text-4xl text-slate-600 mb-3"></i>
              <span className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">{isThai ? 'ไม่มีรูปภาพ' : 'No image'}</span>
            </div>
          )}
        </div>

        <div className="px-6 space-y-8">
          <div className="space-y-1">
            <span className="bg-brand-cyan text-brand-darker px-2 py-0.5 rounded text-[9px] font-black uppercase italic skew-x-[-10deg] shadow-lg shadow-brand-cyan/20">
              {PRODUCT_TYPE_LABEL[product.productType || 'other'] || 'Sealed'}
            </span>
            <h1 className="text-2xl font-black text-white leading-tight tracking-tight mt-2">{product.name}</h1>
          </div>

          {/* Headline price */}
          <div className="bg-[#1e293b]/50 backdrop-blur-sm p-4 rounded-2xl border border-white/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-12 h-12 bg-brand-cyan/10 rounded-bl-3xl"></div>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">{isThai ? 'ราคาตลาด (ซีล)' : 'Market Price (Sealed)'}</p>
            <p className="text-3xl font-black text-white">{fmt(product.price)}</p>
            <p className="mt-2 text-[8px] text-slate-500 font-bold uppercase tracking-widest">PriceCharting</p>
          </div>

          {/* Per-condition breakdown */}
          {tiers.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-black italic skew-x-[-10deg] text-white text-sm uppercase tracking-wider px-1 border-l-4 border-brand-green pl-3">{isThai ? 'ราคาตามสภาพ' : 'Price by Condition'}</h3>
              <div className="space-y-2">
                {tiers.map((tier) => (
                  <div key={tier.key} className="flex justify-between items-center bg-white/[0.03] p-4 rounded-xl border border-white/5">
                    <p className="font-black text-white text-sm tracking-tight">{tier.label}</p>
                    <p className="font-black text-base text-brand-cyan">{fmt(tier.price)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SealedProductDetail;
