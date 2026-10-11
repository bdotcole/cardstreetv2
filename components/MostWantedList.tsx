'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getThumbnailUrl } from '@/lib/imageUtils';

/**
 * "Wanted, nobody selling" — the closest thing to a shopping list this
 * platform can hand a seller.
 *
 * Every card here is on at least one collector's wishlist and has no active
 * listing, so a seller who owns one would be the only person selling it. The
 * data existed from day one and was visible to nobody: 297 wishlist rows, of
 * which the audit found only 11 had any supply at all.
 *
 * `ownedCardIds` marks the rows already sitting in the viewer's vault, which is
 * the whole point on a sell surface — "you own this and someone is waiting for
 * it" is a materially different message from "someone wants this".
 */

interface MostWantedItem {
    cardId: string;
    wishlisters: number;
    card: { name?: string; set?: string; number?: string; images?: { small?: string }; imageUrl?: string } | null;
}

export default function MostWantedList({
    ownedCardIds,
    onSelect,
    limit = 8,
}: {
    /** Cards in the viewer's vault, so owned rows can be surfaced first. */
    ownedCardIds?: readonly string[];
    /** Tap handler. Omitted where there is nothing useful to open. */
    onSelect?: (cardId: string) => void;
    limit?: number;
}) {
    const { t } = useTranslation();
    const [items, setItems] = useState<MostWantedItem[] | null>(null);

    useEffect(() => {
        let active = true;
        fetch('/api/wishlist-demand?mode=most_wanted')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (active) setItems(Array.isArray(d?.items) ? d.items : []); })
            .catch(() => { if (active) setItems([]); });
        return () => { active = false; };
    }, []);

    if (items === null) {
        return <div className="h-32 rounded-2xl bg-white/5 animate-pulse"></div>;
    }

    const owned = new Set(ownedCardIds ?? []);
    // Cards the seller already owns float to the top: for them this is not a
    // market report, it is a to-do list.
    const ordered = [...items].sort((a, b) => {
        const ao = owned.has(a.cardId) ? 1 : 0;
        const bo = owned.has(b.cardId) ? 1 : 0;
        if (ao !== bo) return bo - ao;
        return b.wishlisters - a.wishlisters;
    }).slice(0, limit);

    return (
        <section>
            <h3 className="text-sm font-black text-white">{t('sell.mostWantedTitle')}</h3>
            <p className="text-[11px] text-slate-500 mt-1 leading-snug">{t('sell.mostWantedBody')}</p>

            {ordered.length === 0 ? (
                <p className="mt-4 text-xs text-slate-500">{t('sell.mostWantedEmpty')}</p>
            ) : (
                <div className="mt-3 space-y-2">
                    {ordered.map((row) => {
                        const name = row.card?.name || row.cardId;
                        const thumb = getThumbnailUrl(row.card?.images?.small || row.card?.imageUrl || '');
                        const isOwned = owned.has(row.cardId);
                        return (
                            <button
                                key={row.cardId}
                                onClick={onSelect ? () => onSelect(row.cardId) : undefined}
                                className={`w-full flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                                    isOwned
                                        ? 'border-brand-green/30 bg-brand-green/[0.07] hover:bg-brand-green/10'
                                        : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                                } ${onSelect ? 'active:scale-[0.99]' : 'cursor-default'}`}
                            >
                                <span className="w-10 h-14 rounded-lg bg-slate-900 overflow-hidden flex-shrink-0 border border-white/5">
                                    {thumb && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={thumb} alt="" loading="lazy" className="w-full h-full object-contain" />
                                    )}
                                </span>
                                <span className="flex-1 min-w-0">
                                    <span className="block text-sm font-bold text-white truncate">{name}</span>
                                    <span className="block text-[10px] text-slate-500 truncate">
                                        {row.card?.set ?? ''}{row.card?.number ? ` · #${row.card.number}` : ''}
                                    </span>
                                    {isOwned && (
                                        <span className="mt-1 inline-block text-[10px] font-black text-brand-green">
                                            {t('sell.inYourVault')}
                                        </span>
                                    )}
                                </span>
                                <span className="flex items-center gap-1 text-[11px] font-black text-amber-300 shrink-0">
                                    <i className="fa-solid fa-heart text-[9px]"></i>
                                    {row.wishlisters}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
