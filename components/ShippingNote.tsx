'use client';

import { useTranslation } from '@/lib/hooks/useTranslation';

/**
 * "Shipping included · Flash Express · 1-3 days".
 *
 * Since 2026-09-27 every listing price includes shipping: the seller prices it
 * in, as Thai sellers already do on Facebook and Shopee, and the buyer pays the
 * number on the tile and nothing more. The line sits next to the price because
 * shipping revealed at the payment form is what ended first purchases — see
 * lib/shippingDisplay.
 */
export default function ShippingNote({ variant = 'full', tone = 'muted', className = '' }: {
    /** 'full' for a listing detail; 'short' for a grid tile, where the line
     *  competes with the price for the same few pixels. */
    variant?: 'full' | 'short';
    /** 'light' when the short line sits on a dark image gradient, where the
     *  muted grey falls below readable contrast. */
    tone?: 'muted' | 'light';
    className?: string;
}) {
    const { t } = useTranslation();
    if (variant === 'short') {
        return (
            <span className={`text-[9px] font-bold ${tone === 'light' ? 'text-slate-300' : 'text-slate-500'} ${className}`}>
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
