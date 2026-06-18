'use client';

import React from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';

/**
 * Shown when a buyer outside Thailand tries to check out. Purchasing is gated
 * to TH for now (shipping is Thailand-only); browsing and collection features
 * stay open. The copy reassures them buying is coming to their country soon.
 */
interface PurchaseRegionModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const PurchaseRegionModal: React.FC<PurchaseRegionModalProps> = ({ isOpen, onClose }) => {
    const { t } = useTranslation();

    if (!isOpen) return null;

    return (
        // Above the cart drawer / payment modal (z-60).
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fadeIn">
            <div className="bg-[#0f172a] w-full max-w-sm rounded-[2rem] border border-white/10 overflow-hidden shadow-2xl">
                <div className="p-7 text-center">
                    <div className="mx-auto mb-5 w-16 h-16 rounded-full bg-brand-cyan/10 border border-brand-cyan/20 flex items-center justify-center">
                        <i className="fa-solid fa-location-dot text-2xl text-brand-cyan"></i>
                    </div>
                    <h3 className="text-white text-lg font-black mb-2">
                        {t('purchaseRegion.title')}
                    </h3>
                    <p className="text-sm text-slate-400 leading-relaxed mb-6">
                        {t('purchaseRegion.body')}
                    </p>
                    <button
                        onClick={onClose}
                        className="w-full h-12 rounded-xl bg-brand-cyan text-brand-darker font-black uppercase tracking-[0.2em] text-xs hover:bg-white transition-all active:scale-95"
                    >
                        {t('purchaseRegion.gotIt')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PurchaseRegionModal;
