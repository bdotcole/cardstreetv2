'use client';

import React from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { SNAPSHOT_LANGUAGE_KEY, snapshotLanguage, snapshotSetLine } from '@/lib/orderCardMeta';

/**
 * The line under a card's name on an order, sale or shipment row: language
 * chip, then set, collector number and condition. Everything comes from the
 * listing's card_data snapshot, so the row reads the same whatever the
 * catalog says today. Renders nothing when the snapshot carries none of it
 * (live-break spot orders have no listing).
 */
export default function OrderCardMeta({
    cardData,
    condition,
    className = '',
}: {
    cardData: unknown;
    condition?: string | null;
    className?: string;
}) {
    const { t } = useTranslation();
    const lang = snapshotLanguage(cardData);
    const detail = [snapshotSetLine(cardData), condition].filter(Boolean).join(' · ');
    if (!lang && !detail) return null;
    const label = lang ? t(SNAPSHOT_LANGUAGE_KEY[lang]) : '';
    // Thai copy overflows a letter-spaced pill; track Latin labels only.
    const tracked = /^[\x00-\x7F]*$/.test(label);
    const tone = lang === 'th'
        ? 'text-brand-cyan bg-brand-cyan/10 border-brand-cyan/30'
        : lang === 'jp'
            ? 'text-rose-300 bg-rose-500/10 border-rose-500/30'
            : 'text-slate-200 bg-white/5 border-white/15';
    return (
        <div className={`flex items-center gap-1.5 min-w-0 ${className}`}>
            {lang && (
                <span className={`flex-shrink-0 text-[9px] font-black uppercase ${tracked ? 'tracking-wider' : 'tracking-normal'} rounded-md px-1.5 py-0.5 border ${tone}`}>
                    {label}
                </span>
            )}
            {detail && <span className="text-slate-500 text-xs truncate">{detail}</span>}
        </div>
    );
}
