'use client';

import { Card } from '@/types';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getThumbnailUrl } from '@/lib/imageUtils';

/**
 * "You just added this — want to sell it for ~฿X?"
 *
 * Fires at the two moments a collector has a physical card in one hand and the
 * app in the other: right after a scan resolves, and right after a vault add.
 * Listing was reachable only from the Vault tab, three taps deep, at a moment
 * when the user had already put the card down — which is a large part of why
 * 222 listings exist against 4,837 vaulted cards.
 *
 * One tap. No price entry, no condition picker, no photos here: it opens the
 * real listing form with the price pre-filled, because a sheet that tried to
 * be the form would either drop the photo requirement or stop being one tap.
 *
 * Renders nothing without a usable suggested price — see suggestedSellPrice.
 * A prompt to sell for 20 baht, derived from the 10-baht market placeholder,
 * is worse than no prompt.
 */
export default function SellPromptSheet({
    card,
    suggested,
    onList,
    onDismiss,
}: {
    card: Card;
    suggested: number;
    onList: () => void;
    onDismiss: () => void;
}) {
    const { t, isThai } = useTranslation();
    if (suggested <= 0) return null;

    return (
        <div className="fixed inset-0 z-[90] flex items-end justify-center" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onDismiss}></div>
            <div
                className="relative w-full max-w-md bg-brand-darker border-t border-white/10 rounded-t-3xl p-6 animate-slideUp"
                style={{ paddingBottom: 'calc(1.5rem + var(--sab, 0px))' }}
            >
                <div className="flex items-center gap-4">
                    <div className="w-14 h-20 rounded-xl bg-slate-900 overflow-hidden flex-shrink-0 border border-white/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={getThumbnailUrl(card.images?.small || card.imageUrl)}
                            alt={card.name}
                            className={`w-full h-full ${card.isSealed ? 'object-contain' : 'object-cover'}`}
                        />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-white font-black text-base truncate">{card.name}</p>
                        <p className="text-sm text-brand-green font-black mt-1">
                            {t('listingPrice.sellFor')} ~฿{suggested.toLocaleString()}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                            {isThai
                                ? 'ลงขายฟรี เสียค่าธรรมเนียมเฉพาะตอนขายได้'
                                : 'Free to list — you only pay a fee when it sells.'}
                        </p>
                    </div>
                </div>

                <div className="flex gap-3 mt-5">
                    <button
                        onClick={onDismiss}
                        className="flex-1 h-12 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-bold text-sm active:scale-95 transition-all"
                    >
                        {isThai ? 'ไว้ทีหลัง' : 'Not now'}
                    </button>
                    <button
                        onClick={onList}
                        className="flex-[1.4] h-12 rounded-xl bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black text-sm active:scale-95 transition-all shadow-lg shadow-brand-cyan/20"
                    >
                        {isThai ? 'ลงขายเลย' : 'List it'}
                    </button>
                </div>
            </div>
        </div>
    );
}
