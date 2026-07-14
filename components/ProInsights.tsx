'use client';

import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { fitValueDomain } from '@/lib/chartDomain';

/**
 * Pro Insights (premium): the business side of collecting. Portfolio value
 * history (from the hourly snapshot cron), cost basis vs market value, top
 * holdings, allocation by game, and the week's movers inside the collection.
 * Rendering only — /api/insights holds the authoritative premium gate.
 */

interface InsightsData {
  summary: {
    totalValue: number;
    itemCount: number;
    uniqueCards: number;
    costBasis: number;
    costCoveredValue: number;
    unrealizedPl: number;
  };
  history: { t: string; v: number }[];
  topHoldings: { cardId: string; name: string; image: string | null; total: number; quantity: number; change7d: number | null }[];
  allocation: { game: string; value: number; pct: number }[];
  movers: { cardId: string; name: string; image: string | null; total: number; change7d: number | null }[];
}

const baht = (v: number) => `฿${Math.round(v).toLocaleString()}`;

const GAME_LABEL: Record<string, string> = {
  pokemon: 'Pokémon',
  mtg: 'Magic',
  yugioh: 'Yu-Gi-Oh!',
  onepiece: 'One Piece',
  riftbound: 'Riftbound',
  lorcana: 'Lorcana',
};

const Stat: React.FC<{ label: string; value: string; accent?: string }> = ({ label, value, accent }) => (
  <div className="glass rounded-2xl border-white/10 p-4">
    <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest">{label}</p>
    <p className={`text-lg font-black mt-1 ${accent ?? 'text-white'}`}>{value}</p>
  </div>
);

const ProInsights: React.FC = () => {
  const { t } = useTranslation();
  const [data, setData] = useState<InsightsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/insights')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || 'Failed to load insights');
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return <p className="text-[11px] text-rose-300 text-center py-10">{error}</p>;
  }
  if (!data) {
    return (
      <div className="text-center py-16">
        <i className="fa-solid fa-circle-notch animate-spin text-brand-cyan text-2xl"></i>
      </div>
    );
  }

  const { summary } = data;
  const plUp = summary.unrealizedPl >= 0;
  const chart = data.history.map((h) => ({
    t: new Date(h.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    v: h.v,
  }));
  // Fit the (hidden) axis to the portfolio's own value range so real movement shows
  // instead of a flat sliver — the same treatment as the card price-history chart.
  const yDomain = fitValueDomain(chart.map((c) => c.v));

  return (
    <div className="w-full max-w-[560px] mx-auto">
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-brand-cyan/10 flex items-center justify-center mx-auto mb-4">
          <i className="fa-solid fa-chart-line text-brand-cyan text-xl"></i>
        </div>
        <h2 className="text-2xl font-black text-white tracking-tight uppercase italic skew-x-[-10deg]">{t('pro.insightsTitle')}</h2>
        <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mt-1">{t('pro.insights.tagline')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <Stat label={t('pro.insights.portfolioValue')} value={baht(summary.totalValue)} />
        <Stat label={t('pro.insights.cards')} value={`${summary.itemCount.toLocaleString()} · ${summary.uniqueCards} ${t('pro.insights.unique')}`} />
        <Stat label={t('pro.insights.costBasis')} value={summary.costBasis > 0 ? baht(summary.costBasis) : '—'} />
        <Stat
          label={t('pro.insights.unrealizedPl')}
          value={summary.costBasis > 0 ? `${plUp ? '+' : '−'}${baht(Math.abs(summary.unrealizedPl))}` : '—'}
          accent={summary.costBasis > 0 ? (plUp ? 'text-emerald-400' : 'text-rose-400') : undefined}
        />
      </div>

      <div className="glass rounded-3xl border-white/10 p-5 mb-5">
        <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-3">{t('pro.insights.last90')}</p>
        {chart.length >= 2 ? (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="proValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={40} />
                <YAxis hide domain={yDomain} />
                <Tooltip
                  contentStyle={{ background: '#0f1419', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 11 }}
                  labelStyle={{ color: '#94a3b8' }}
                  formatter={(value: any) => [baht(Number(value)), t('pro.insights.portfolioValue')]}
                />
                <Area type="monotone" dataKey="v" stroke="#22d3ee" strokeWidth={2} fill="url(#proValue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500 py-8 text-center">{t('pro.insights.historyEmpty')}</p>
        )}
      </div>

      {data.allocation.length > 0 && (
        <div className="glass rounded-3xl border-white/10 p-5 mb-5">
          <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-3">{t('pro.insights.allocation')}</p>
          <div className="space-y-2.5">
            {data.allocation.map((a) => (
              <div key={a.game}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[11px] text-slate-300 font-bold">{GAME_LABEL[a.game] ?? a.game}</span>
                  <span className="text-[10px] text-slate-500">{baht(a.value)} · {Math.round(a.pct * 100)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full bg-brand-cyan" style={{ width: `${Math.max(2, a.pct * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.topHoldings.length > 0 && (
        <div className="glass rounded-3xl border-white/10 p-5 mb-5">
          <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-3">{t('pro.insights.topHoldings')}</p>
          <div className="space-y-2">
            {data.topHoldings.map((h) => (
              <div key={h.cardId} className="flex items-center gap-3">
                <div className="w-9 h-12 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                  {h.image && <img src={h.image} alt={h.name} loading="lazy" className="w-full h-full object-contain" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-bold truncate">{h.name}</p>
                  <p className="text-[10px] text-slate-500">{h.quantity > 1 ? `x${h.quantity} · ` : ''}{baht(h.total)}</p>
                </div>
                {h.change7d !== null && (
                  <span className={`text-[10px] font-black ${h.change7d >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {h.change7d >= 0 ? '+' : ''}{h.change7d.toFixed(1)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.movers.length > 0 && (
        <div className="glass rounded-3xl border-white/10 p-5">
          <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-3">{t('pro.insights.movers')}</p>
          <div className="space-y-2">
            {data.movers.map((m) => (
              <div key={m.cardId} className="flex items-center gap-3">
                <div className="w-9 h-12 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                  {m.image && <img src={m.image} alt={m.name} loading="lazy" className="w-full h-full object-contain" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-bold truncate">{m.name}</p>
                  <p className="text-[10px] text-slate-500">{baht(m.total)}</p>
                </div>
                <span className={`text-[10px] font-black ${(m.change7d ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {(m.change7d ?? 0) >= 0 ? '+' : ''}{(m.change7d ?? 0).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProInsights;
