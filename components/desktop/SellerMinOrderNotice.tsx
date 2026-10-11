'use client'

import { useDesktopCart } from '@/components/desktop/DesktopCartContext';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { minOrderMessage, minOrderNote, minOrderShortfall } from '@/lib/minOrder';

// Shop minimum order on the (server-rendered) seller page. The page itself can
// only print the standing rule; this reads the live cart so a buyer sent here
// from a blocked checkout sees how much is still missing, then a way back to
// the cart once the minimum is met. Mirrors the mobile SellerProfile notice.
export default function SellerMinOrderNotice({ sellerId, minOrderThb }: { sellerId: string; minOrderThb: number }) {
    const { items, openCart } = useDesktopCart();
    const { t, isThai } = useTranslation();
    if (minOrderThb <= 0) return null;

    const inCart = items.filter((i) => i.sellerId === sellerId).reduce((sum, i) => sum + i.price, 0);
    const shortfall = minOrderShortfall(inCart, minOrderThb);

    if (inCart > 0 && shortfall > 0) {
        return (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 max-w-xl">
                <p className="text-sm font-bold text-amber-300 leading-snug">{minOrderMessage(isThai, minOrderThb, shortfall)}</p>
                <p className="text-xs text-slate-400 mt-1">{t('seller.inYourCart').replace('{amount}', inCart.toLocaleString())}</p>
            </div>
        );
    }
    if (inCart > 0) {
        return (
            <div className="mt-3 rounded-xl border border-brand-green/30 bg-brand-green/10 px-4 py-3 max-w-xl flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <p className="text-sm font-bold text-brand-green">{t('seller.minOrderMet')}</p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{t('seller.inYourCart').replace('{amount}', inCart.toLocaleString())}</p>
                </div>
                <button
                    onClick={openCart}
                    className="shrink-0 bg-brand-green hover:bg-white text-brand-darker text-xs font-black px-4 py-2 rounded-lg transition-colors"
                >
                    {t('desktop.cart.checkout')}
                </button>
            </div>
        );
    }
    return <p className="text-xs text-amber-300/90 font-bold mt-1">{minOrderNote(isThai, minOrderThb)}</p>;
}
