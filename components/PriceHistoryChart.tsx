'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

// recharts is ~100KB; defer until the chart actually renders.
const PriceChart = dynamic(() => import('./PriceChart'), {
    ssr: false,
    loading: () => <div className="w-full h-full rounded-lg bg-white/5 animate-pulse" />,
});

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

// Real market-value-over-time, backed by price_snapshots (daily cron). Renders nothing
// until there are >=2 genuine points (>=1 stored snapshot plus the current live price).
// This is the honest replacement for the old Math.random()/seeded-PRNG trend lines.
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
    const [points, setPoints] = useState<{ date: string; price: number }[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        const params = new URLSearchParams({ id: subjectId, language });
        if (condition) params.set('condition', condition);

        fetch(`/api/price-history?${params.toString()}`)
            .then((r) => (r.ok ? r.json() : { history: [] }))
            .then((data: { history?: { t: string; v: number }[] }) => {
                if (cancelled) return;
                const raw = Array.isArray(data?.history) ? data.history : [];
                const today = new Date().toISOString().slice(0, 10);

                // Work in ISO dates first so the today-dedup is exact, then label.
                const series = raw.map((r) => ({ date: r.t, price: Math.round(r.v) }));
                if (typeof currentPriceThb === 'number' && currentPriceThb > 0) {
                    const last = series[series.length - 1];
                    if (last && last.date === today) last.price = Math.round(currentPriceThb);
                    else series.push({ date: today, price: Math.round(currentPriceThb) });
                }

                const fmt = (iso: string) => {
                    const d = new Date(`${iso}T00:00:00Z`);
                    return d.toLocaleDateString(isThai ? 'th-TH' : 'en-GB', {
                        day: 'numeric',
                        month: 'short',
                        timeZone: 'UTC',
                    });
                };
                setPoints(
                    series.map((p) => ({
                        date: p.date === today ? (isThai ? 'วันนี้' : 'Now') : fmt(p.date),
                        price: p.price,
                    })),
                );
            })
            .catch(() => {
                if (!cancelled) setPoints([]);
            });

        return () => {
            cancelled = true;
        };
    }, [subjectId, language, condition, currentPriceThb, isThai]);

    // Honest empty state: no panel at all until there's genuine history to draw.
    if (!points || points.length < 2) return null;

    return (
        <div className={panelClassName}>
            {title ? <div className={titleClassName}>{title}</div> : null}
            <div className={chartClassName}>
                <PriceChart data={points} />
            </div>
        </div>
    );
};

export default PriceHistoryChart;
