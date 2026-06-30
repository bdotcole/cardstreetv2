'use client';

import React from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';

/**
 * One-time explainer shown the first time a seller opens the listing form.
 * Spells out the money flow so a new seller isn't surprised at pickup:
 * the CardStreet fee, Stripe's processing fee, what the buyer is charged, and
 * the seller's own responsibility — they pay Flash for the shipment when it's
 * collected, funded by the shipping the buyer already paid. Bilingual via the
 * `sellerInfo.*` keys in lib/locales/{en,th}.json.
 */
interface SellerInfoModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const SECTIONS: { icon: string; titleKey: string; bodyKey: string }[] = [
    { icon: 'fa-percent', titleKey: 'sellerInfo.feeTitle', bodyKey: 'sellerInfo.feeBody' },
    { icon: 'fa-credit-card', titleKey: 'sellerInfo.stripeTitle', bodyKey: 'sellerInfo.stripeBody' },
    { icon: 'fa-cart-shopping', titleKey: 'sellerInfo.buyerTitle', bodyKey: 'sellerInfo.buyerBody' },
    { icon: 'fa-box', titleKey: 'sellerInfo.shippingTitle', bodyKey: 'sellerInfo.shippingBody' },
];

const SellerInfoModal: React.FC<SellerInfoModalProps> = ({ isOpen, onClose }) => {
    const { t } = useTranslation();

    if (!isOpen) return null;

    return (
        // Above the listing form (z-50) and the cart/payment layers.
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
            <div className="bg-[#0f172a] w-full max-w-md rounded-[2rem] border border-white/10 overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
                <div className="p-7 pb-4 text-center">
                    <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-brand-cyan/10 border border-brand-cyan/20 flex items-center justify-center">
                        <i className="fa-solid fa-circle-info text-2xl text-brand-cyan"></i>
                    </div>
                    <h3 className="text-white text-lg font-black mb-1">{t('sellerInfo.title')}</h3>
                    <p className="text-sm text-slate-400 leading-relaxed">{t('sellerInfo.subtitle')}</p>
                </div>

                <div className="px-6 overflow-y-auto space-y-3">
                    {SECTIONS.map((s) => (
                        <div key={s.titleKey} className="flex gap-3 rounded-2xl bg-white/5 border border-white/5 p-4 text-left">
                            <div className="mt-0.5 w-8 h-8 flex-shrink-0 rounded-full bg-brand-cyan/10 flex items-center justify-center">
                                <i className={`fa-solid ${s.icon} text-brand-cyan text-sm`}></i>
                            </div>
                            <div className="min-w-0">
                                <h4 className="text-white text-sm font-bold mb-0.5">{t(s.titleKey)}</h4>
                                <p className="text-xs text-slate-400 leading-relaxed">{t(s.bodyKey)}</p>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-6 pt-4">
                    <button
                        onClick={onClose}
                        className="w-full h-12 rounded-xl bg-brand-cyan text-brand-darker font-black uppercase tracking-[0.2em] text-xs hover:bg-white transition-all active:scale-95"
                    >
                        {t('sellerInfo.gotIt')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SellerInfoModal;
