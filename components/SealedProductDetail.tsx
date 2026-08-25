import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { SealedProduct } from '../services/pokemonService';
import { Card } from '@/types';
import { CURRENCY_SYMBOLS } from '@/constants';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { sealedProductToCard, productTypeLabel } from '@/lib/sealedProduct';
import PriceHistoryChart from './PriceHistoryChart';

interface SealedProductDetailProps {
  product: SealedProduct;
  onClose: () => void;
  currency?: string;
  exchangeRate?: number;
  // When provided, shows the Add to Vault action (same handler cards use —
  // the product is converted to a Card-shaped snapshot first).
  onAddToCollection?: (card: Card) => void;
}

const SealedProductDetail: React.FC<SealedProductDetailProps> = ({ product, onClose, currency = 'THB', exchangeRate = 1, onAddToCollection }) => {
  const { t, isThai } = useTranslation();
  const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;
  const typeLabel = productTypeLabel(product.productType, isThai);
  const [mounted, setMounted] = useState(false);

  // Portal target is document.body, which only exists after mount.
  useEffect(() => setMounted(true), []);

  // Prices arrive in THB (base); convert to the display currency.
  const fmt = (priceThb: number | null | undefined) => {
    if (!priceThb || priceThb <= 0) return 'N/A';
    const val = priceThb * exchangeRate;
    if (currency === 'USD') {
      return `${currencySymbol} ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `${currencySymbol} ${Math.round(val).toLocaleString()}`;
  };

  if (!mounted) return null;

  // Rendered through a portal: this component mounts inside <main> (a z-10
  // stacking context), where fixed z-50 still paints BELOW the sibling bottom
  // nav (z-40) — hiding the Add to Vault bar behind the tab bar. Escaping to
  // document.body lets the overlay genuinely cover the app chrome, same as
  // CardDetails (mounted after the nav) and AuthModal (also a portal).
  return createPortal(
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
          <span className="font-black italic skew-x-[-10deg] uppercase tracking-wider text-xs text-brand-cyan block">{isThai ? 'สินค้าซีล' : 'Sealed Product'}</span>
          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{typeLabel}</span>
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
              {typeLabel}
            </span>
            <h1 className="text-2xl font-black text-white leading-tight tracking-tight mt-2">{product.name}</h1>
            {product.setName && (
              <p className="text-sm text-slate-400 font-bold">{product.setName}</p>
            )}
          </div>

          {/* Headline price */}
          {(() => {
            const pt = product.priceType || 'market';
            const headline = pt === 'srp'
              ? (isThai ? 'ราคาขายปลีก (SRP)' : 'Retail Price (SRP)')
              : pt === 'estimate'
                ? (isThai ? 'ราคาประเมิน (ซีล)' : 'Est. Market (Sealed)')
                : (isThai ? 'ราคาตลาด (ซีล)' : 'Market Price (Sealed)');
            const source = pt === 'srp'
              ? (isThai ? 'ราคาขายปลีกไทยโดยประมาณ' : 'Thai retail (SRP)')
              : pt === 'estimate'
                ? (isThai ? 'ประมาณจากตลาดญี่ปุ่น (ชุดเดียวกัน)' : 'Est. from JP market (same set)')
                : 'PriceCharting';
            return (
              <div className="bg-slate-800/50 backdrop-blur-sm p-4 rounded-2xl border border-white/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-12 h-12 bg-brand-cyan/10 rounded-bl-3xl"></div>
                <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">{headline}</p>
                <p className="text-3xl font-black text-white">{fmt(product.price)}</p>
                <p className="mt-2 text-[8px] text-slate-500 font-bold uppercase tracking-widest">{source}</p>
              </div>
            );
          })()}

          {/* Real market-value-over-time (price_snapshots via /api/price-history).
              Self-hides until there is genuine history to draw — no synthesized trend. */}
          <PriceHistoryChart
            subjectId={product.id}
            language={product.language}
            condition="Sealed"
            currentPriceThb={product.price}
            isThai={isThai}
            title={t('priceHistory.title')}
            panelClassName="bg-slate-800/50 rounded-2xl border border-white/5 p-4"
            titleClassName="font-black italic skew-x-[-10deg] text-white text-sm uppercase tracking-wider mb-4 border-l-4 border-brand-green pl-3"
            chartClassName="h-44"
          />
        </div>
      </div>

      {/* Action Bar — mirrors CardDetails. Adding stores a Card-shaped
          snapshot so the vault/listing pipeline treats it like any card. */}
      {onAddToCollection && (
        <div className="absolute bottom-0 left-0 w-full px-6 pt-6 bg-brand-darker/90 backdrop-blur-xl border-t border-white/5 flex gap-3 z-20" style={{ paddingBottom: 'calc(1.5rem + var(--sab, 0px))' }}>
          <button
            onClick={() => onAddToCollection(sealedProductToCard(product))}
            className="flex-1 h-14 bg-white/5 border border-white/10 text-white hover:bg-white/10 font-black text-[10px] tracking-[0.2em] rounded-xl active:scale-95 transition-all uppercase flex items-center justify-center gap-2 group"
          >
            <i className="fa-solid fa-vault text-brand-cyan group-hover:scale-110 transition-transform"></i>
            {isThai ? 'เพิ่มเข้าคลัง' : 'Add to Vault'}
          </button>
        </div>
      )}
    </div>,
    document.body
  );
};

export default SealedProductDetail;
