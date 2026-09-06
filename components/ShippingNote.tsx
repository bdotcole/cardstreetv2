'use client';

import { useTranslation } from '@/lib/hooks/useTranslation';

/**
 * "Shipping from ฿40 · Flash Express · 1-3 days".
 *
 * Shipping used to appear for the first time on the payment screen. On a ฿60
 * card that is most of what the buyer pays, revealed at the moment they are
 * deciding whether to trust the platform at all.
 *
 * The figure is the real floor, not a marketing one — see lib/shippingDisplay.
 */
export default function ShippingNote({ variant = 'full', className = '' }: {
    /** 'full' for a listing detail; 'short' for a grid tile, where the line
     *  competes with the price for the same few pixels. */
    variant?: 'full' | 'short';
    className?: string;
}) {
    const { t } = useTranslation();
    if (variant === 'short') {
        return (
            <span className={`text-[9px] text-slate-500 font-bold ${className}`}>
                {t('shipping.noteShort')}
            </span>
        );
    }
    return (
        <p className={`text-[11px] text-slate-400 flex items-center gap-1.5 ${className}`}>
            <i className="fa-solid fa-truck-fast text-[10px] text-slate-500"></i>
            {t('shipping.note')}
        </p>
    );
}
