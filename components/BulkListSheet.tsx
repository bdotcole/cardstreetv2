'use client';

import { useMemo, useState } from 'react';
import { Card, CardCondition, UserCollectionItem } from '@/types';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getThumbnailUrl } from '@/lib/imageUtils';
import { PUBLIC_MIN_LISTING_PRICE_THB } from '@/lib/pricingFloors';
import { evaluatePrice, suggestedSellPrice } from '@/lib/listingPriceGuidance';
import { CATALOG_ART_MAX_PRICE_THB, catalogArtAllowed } from '@/lib/listingPhotoPolicy';

/**
 * List several vault cards in one pass.
 *
 * The one-at-a-time form is right for a card worth photographing and wrong for
 * the other fifty. Listing a shoebox meant fifty trips through a modal with two
 * camera captures each, which nobody does — the marketplace has 222 listings
 * against 4,837 vaulted cards.
 *
 * What is shared: the condition (a bulk stack is graded by eye, in one go) and
 * the decision to use catalog art. What is NOT shared: the price. A flat price
 * across different cards is how a 900-baht card gets listed for 40, so each row
 * carries its own, pre-filled from that card's own market value.
 *
 * Rows whose catalog has no usable market value arrive with an empty price and
 * are excluded until the seller types one — a bulk lister must never invent a
 * number for a card the pricing pipeline knows nothing about.
 */

export interface BulkListRow {
    colId: string;
    item: UserCollectionItem;
    card: Card;
    price: number;
}

export default function BulkListSheet({
    entries,
    onCancel,
    onConfirm,
    submitting = false,
}: {
    entries: { colId: string; item: UserCollectionItem; card: Card }[];
    onCancel: () => void;
    onConfirm: (rows: BulkListRow[], opts: { condition: CardCondition; useCatalogArt: boolean }) => void;
    submitting?: boolean;
}) {
    const { t, isThai } = useTranslation();
    const [condition, setCondition] = useState<CardCondition>(CardCondition.NM);
    const [useCatalogArt, setUseCatalogArt] = useState(true);
    const [prices, setPrices] = useState<Record<string, string>>(() =>
        Object.fromEntries(
            entries.map((e) => {
                const s = suggestedSellPrice(e.card.marketPrice);
                return [e.item.id, s > 0 ? String(s) : ''];
            }),
        ),
    );

    const rows = useMemo(
        () =>
            entries
                .map((e) => ({ ...e, price: parseFloat(prices[e.item.id] ?? '') }))
                .filter((r) => Number.isFinite(r.price) && r.price >= PUBLIC_MIN_LISTING_PRICE_THB),
        [entries, prices],
    );

    // Catalog art has to be allowed for EVERY row it would apply to. A mixed
    // batch where it covers some cards and not others cannot be expressed by
    // one checkbox, so the checkbox turns itself off rather than silently
    // applying to a subset.
    const catalogArtOkForAll =
        rows.length > 0 && rows.every((r) => catalogArtAllowed(r.price, condition));
    const effectiveCatalogArt = useCatalogArt && catalogArtOkForAll;

    const total = rows.reduce((sum, r) => sum + r.price, 0);

    return (
        <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel}></div>
            <div
                className="relative w-full max-w-md bg-brand-darker border-t border-white/10 rounded-t-3xl flex flex-col max-h-[88dvh]"
                style={{ paddingBottom: 'calc(1rem + var(--sab, 0px))' }}
            >
                <div className="px-6 pt-6 pb-3 border-b border-white/5">
                    <h3 className="text-white font-black text-lg">
                        {isThai ? `ลงขาย ${entries.length} ใบ` : `List ${entries.length} cards`}
                    </h3>

                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mt-4 mb-2">
                        {isThai ? 'สภาพ (ใช้กับทุกใบ)' : 'Condition (applies to all)'}
                    </label>
                    <div className="grid grid-cols-5 gap-1.5">
                        {Object.entries(CardCondition)
                            .filter(([, c]) => c !== CardCondition.Sealed)
                            .map(([abbr, c]) => (
                                <button
                                    key={c}
                                    onClick={() => setCondition(c as CardCondition)}
                                    className={`h-9 rounded-lg text-[11px] font-black transition-all ${
                                        condition === c
                                            ? 'bg-brand-cyan text-brand-darker'
                                            : 'bg-white/5 text-slate-400 border border-white/10'
                                    }`}
                                >
                                    {abbr}
                                </button>
                            ))}
                    </div>

                    <label className={`flex items-start gap-3 mt-3 ${catalogArtOkForAll ? 'cursor-pointer' : 'opacity-50'}`}>
                        <input
                            type="checkbox"
                            checked={effectiveCatalogArt}
                            disabled={!catalogArtOkForAll}
                            onChange={(e) => setUseCatalogArt(e.target.checked)}
                            className="mt-0.5 w-4 h-4 accent-brand-cyan"
                        />
                        <span className="min-w-0">
                            <span className="block text-xs font-bold text-white">{t('listingPhotos.useCatalogArt')}</span>
                            <span className="block text-[11px] text-slate-500 mt-0.5 leading-snug">
                                {catalogArtOkForAll
                                    ? t('listingPhotos.useCatalogArtHint')
                                    : isThai
                                        ? `มีบางใบเกิน ฿${CATALOG_ART_MAX_PRICE_THB} หรือสภาพต่ำกว่า NM — ต้องลงขายทีละใบพร้อมรูปจริง`
                                        : `Some of these are over ฿${CATALOG_ART_MAX_PRICE_THB} or below near-mint — list those individually with real photos.`}
                            </span>
                        </span>
                    </label>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-3 space-y-2">
                    {entries.map((e) => {
                        const raw = prices[e.item.id] ?? '';
                        const price = parseFloat(raw);
                        const guidance = evaluatePrice(price, e.card.marketPrice);
                        const belowFloor = Number.isFinite(price) && price > 0 && price < PUBLIC_MIN_LISTING_PRICE_THB;
                        return (
                            <div key={e.item.id} className="flex items-center gap-3">
                                <img
                                    src={getThumbnailUrl(e.card.images?.small || e.card.imageUrl)}
                                    alt=""
                                    className="w-9 h-12 rounded-md object-cover bg-slate-900 shrink-0"
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-bold text-white truncate">{e.card.name}</p>
                                    {guidance.percentFromMarket !== undefined && (
                                        <p className={`text-[10px] font-bold ${guidance.warn ? 'text-amber-400' : 'text-slate-500'}`}>
                                            {Math.abs(guidance.percentFromMarket) < 3
                                                ? t('listingPrice.atMarket')
                                                : `${Math.abs(guidance.percentFromMarket)}% ${guidance.percentFromMarket > 0 ? t('listingPrice.aboveMarket') : t('listingPrice.belowMarket')}`}
                                        </p>
                                    )}
                                    {belowFloor && (
                                        <p className="text-[10px] font-bold text-brand-red">
                                            {isThai ? `ขั้นต่ำ ฿${PUBLIC_MIN_LISTING_PRICE_THB}` : `Minimum ฿${PUBLIC_MIN_LISTING_PRICE_THB}`}
                                        </p>
                                    )}
                                </div>
                                <div className="relative shrink-0">
                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-bold">฿</span>
                                    <input
                                        type="number"
                                        inputMode="numeric"
                                        value={raw}
                                        onChange={(ev) => setPrices((p) => ({ ...p, [e.item.id]: ev.target.value }))}
                                        className={`w-24 h-9 bg-white/5 border rounded-lg pl-6 pr-2 text-sm text-white font-bold outline-none ${
                                            guidance.warn ? 'border-amber-400/60' : 'border-white/10 focus:border-brand-cyan'
                                        }`}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="px-6 pt-3 border-t border-white/5 space-y-3">
                    <p className="text-[11px] text-slate-500 font-bold tabular-nums">
                        {rows.length}/{entries.length} · ฿{total.toLocaleString()}
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={onCancel}
                            className="flex-1 h-12 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-bold text-sm active:scale-95 transition-all"
                        >
                            {t('report.cancel')}
                        </button>
                        <button
                            onClick={() => onConfirm(rows, { condition, useCatalogArt: effectiveCatalogArt })}
                            disabled={submitting || rows.length === 0}
                            className="flex-[1.4] h-12 rounded-xl bg-brand-green text-brand-darker font-black text-sm active:scale-95 transition-all disabled:opacity-40"
                        >
                            {submitting
                                ? (isThai ? 'กำลังลงขาย...' : 'Listing...')
                                : (isThai ? `ลงขาย ${rows.length} ใบ` : `List ${rows.length}`)}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
