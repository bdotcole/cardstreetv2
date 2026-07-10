'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { usePremium } from '@/lib/hooks/usePremium';

// recharts is ~100KB; defer until the chart actually renders.
const PriceChart = dynamic(() => import('./PriceChart'), {
    ssr: false,
    loading: () => <div className="w-full h-full rounded-lg bg-white/5 animate-pulse" />,
});

type RangeKey = '7d' | '30d' | '90d' | '180d' | '1y';

// 180d/1y are Pro (advanced_market) — locked chips upsell instead of fetching,
// and /api/price-history enforces the same split server-side via requirePremium().
const RANGES: { key: RangeKey; label: string; pro?: boolean; days: number }[] = [
    { key: '7d', label: '7D', days: 7 },
    { key: '30d', label: '30D', days: 30 },
    { key: '90d', label: '90D', days: 90 },
    { key: '180d', label: '180D', days: 180, pro: true },
    { key: '1y', label: '1Y', days: 365, pro: true },
];

interface Props {
    subjectId: string;
    language?: string;
    // 'Sealed' for sealed products, 'Market' for singles. Inferred from the id
    // (pc-*) by the API when omitted.
    condition?: 'Sealed' | 'Market';
    // Current live market price (THB base). Folded in as the final "Now" point so a
    // chart appears with a single stored snapshot — both points are real.
    currentPriceThb?: number | null;
    isThai?: boolean;
    // Optional titled panel wrapper. When title is set the component renders its own
    // panel (and self-hides when there is no chart); otherwise it renders only the
    // chart node. panel/title/chart classes let each surface match its own styling.
    title?: string;
    panelClassName?: string;
    titleClassName?: string;
    chartClassName?: string;
}

const LockIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5 shrink-0" aria-hidden="true">
        <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
    </svg>
);

// Market-value-over-time, backed by price_snapshots (daily cron going forward; the
// pre-cron past was seeded once with flagged estimates). Renders nothing until the
// selected range has >=2 points (>=1 stored snapshot plus the current live price).
const PriceHistoryChart: React.FC<Props> = ({
    subjectId,
    language = 'en',
    condition,
    currentPriceThb,
    isThai,
    title,
    panelClassName = 'rounded-2xl bg-white/5 border border-white/10 p-5',
    titleClassName = 'text-[10px] text-slate-500 font-black uppercase tracking-widest mb-4',
    chartClassName = 'h-44',
}) => {
    const { t } = useTranslation();
    const { loading: premiumLoading, hasFeature } = usePremium();
    // Fail closed while the entitlement resolves — same policy as usePremium itself.
    const proUnlocked = !premiumLoading && hasFeature('advanced_market');

    const [range, setRange] = useState<RangeKey>('30d');
    const [points, setPoints] = useState<{ date: string; price: number }[] | null>(null);
    const [fetching, setFetching] = useState(false);
    const [showUpsell, setShowUpsell] = useState(false);
    // A subject that stopped accruing snapshots (e.g. a delisted card) can have an
    // empty default window while older history exists — widen once to the free
    // ceiling before giving up, but never fight a range the user chose.
    const userPickedRange = useRef(false);
    // Once the panel has shown a real chart, an empty/failed range must degrade to an
    // inline "no data" state — hiding the panel would take the chips (the only way
    // back to a populated range) with it.
    const hadChart = useRef(false);

    const rangeDays = useMemo(() => RANGES.find((r) => r.key === range)?.days ?? 30, [range]);

    useEffect(() => {
        // The UI never selects a locked range, but never fetch one either — the
        // server would 401/403 and the chart would blank.
        const pro = RANGES.find((r) => r.key === range)?.pro;
        if (pro && !proUnlocked) return;

        let cancelled = false;
        setFetching(true);
        const params = new URLSearchParams({ id: subjectId, language, range });
        if (condition) params.set('condition', condition);

        fetch(`/api/price-history?${params.toString()}`)
            .then((r) => (r.ok ? r.json() : { history: [] }))
            .then((data: { history?: { t: string; v: number }[] }) => {
                if (cancelled) return;
                const raw = Array.isArray(data?.history) ? data.history : [];
                if (raw.length < 1 && range !== '90d' && !userPickedRange.current) {
                    setRange('90d');
                    return;
                }
                const today = new Date().toISOString().slice(0, 10);

                // Work in ISO dates first so the today-dedup is exact, then label.
                const series = raw.map((r) => ({ date: r.t, price: Math.round(r.v) }));
                if (typeof currentPriceThb === 'number' && currentPriceThb > 0) {
                    const last = series[series.length - 1];
                    if (last && last.date === today) last.price = Math.round(currentPriceThb);
                    else series.push({ date: today, price: Math.round(currentPriceThb) });
                }

                // Long ranges wrap around the calendar year — disambiguate with a year.
                const fmt = (iso: string) => {
                    const d = new Date(`${iso}T00:00:00Z`);
                    return d.toLocaleDateString(isThai ? 'th-TH' : 'en-GB', {
                        day: 'numeric',
                        month: 'short',
                        ...(rangeDays >= 180 ? { year: '2-digit' as const } : {}),
                        timeZone: 'UTC',
                    });
                };
                setPoints(
                    series.map((p) => ({
                        date: p.date === today ? (isThai ? 'วันนี้' : 'Now') : fmt(p.date),
                        price: p.price,
                    })),
                );
                setFetching(false);
            })
            .catch(() => {
                if (cancelled) return;
                setPoints([]);
                setFetching(false);
            });

        return () => {
            cancelled = true;
        };
    }, [subjectId, language, condition, currentPriceThb, isThai, range, rangeDays, proUnlocked]);

    const hasChart = !!points && points.length >= 2;
    if (hasChart) hadChart.current = true;

    // Honest empty state: no panel at all until there's genuine history to draw.
    // But once a chart has rendered, a range with no data keeps the panel (and the
    // chips) and says so inline — vanishing here would strand the user.
    if (!hasChart && !hadChart.current) return null;

    return (
        <div className={panelClassName}>
            {title ? <div className={titleClassName}>{title}</div> : null}
            <div className="flex items-center justify-end gap-1 mb-3 flex-wrap">
                {RANGES.map((r) => {
                    const locked = r.pro && !proUnlocked;
                    const active = r.key === range;
                    return (
                        <button
                            key={r.key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => {
                                if (locked) {
                                    setShowUpsell((v) => !v);
                                    return;
                                }
                                userPickedRange.current = true;
                                setShowUpsell(false);
                                setRange(r.key);
                            }}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide transition-colors ${
                                active
                                    ? 'border-cyan-500/40 bg-cyan-500/20 text-cyan-300'
                                    : locked
                                      ? 'border-white/10 text-slate-600 hover:text-slate-400'
                                      : 'border-white/10 text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {r.label}
                            {locked ? <LockIcon /> : null}
                        </button>
                    );
                })}
            </div>
            {showUpsell ? (
                <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2">
                    <span className="text-[11px] text-amber-200/90">{t('priceHistory.proNote')}</span>
                    <a
                        href="/premium"
                        className="shrink-0 rounded-full bg-amber-400/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-300 hover:bg-amber-400/30"
                    >
                        {t('priceHistory.upgrade')}
                    </a>
                </div>
            ) : null}
            <div className={`${chartClassName} transition-opacity ${fetching ? 'opacity-60' : 'opacity-100'}`}>
                {hasChart ? (
                    <PriceChart data={points} />
                ) : (
                    <div className="flex h-full items-center justify-center rounded-lg bg-white/5 text-[11px] text-slate-500">
                        {t('priceHistory.noData')}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PriceHistoryChart;
