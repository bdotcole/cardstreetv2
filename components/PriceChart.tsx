import React, { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { niceValueDomain } from '@/lib/chartDomain';

export interface PricePoint {
  // Axis label when `label` is absent (the card price chart passes a formatted
  // day here); the portfolio chart passes the ISO timestamp plus a `label`.
  date: string;
  price: number;
  label?: string;
  // Cards held at that snapshot. A step in the line that coincides with a
  // change here came from adding or selling cards, not from the market, and
  // the tooltip is where that is explained.
  items?: number;
}

interface PriceChartProps {
  data: PricePoint[];
  // Unit for `items` in the tooltip ("cards").
  itemsLabel?: string;
  // Dashed guide at the window's first value, so a move reads against where
  // the window began rather than against the axis floor.
  showBaseline?: boolean;
}

// brand-green / brand-red / brand-cyan from app/globals.css. The line and the
// fill take the window's direction, so the chart reads as "up" or "down"
// before a single number is read.
const UP = '#84cc16';
const DOWN = '#f43f5e';
const FLAT = '#06b6d4';

// Tick values come from niceValueDomain, so they are round: 35k, 40k, 45k.
// A half step (12.5k) keeps its decimal; nothing is rounded to a neighbour.
const formatAxis = (val: number): string => {
  if (Math.abs(val) >= 1000) {
    return val % 1000 === 0 ? `฿${val / 1000}k` : `฿${(val / 1000).toFixed(1)}k`;
  }
  return `฿${Math.round(val)}`;
};

const tooltipDate = (p: PricePoint): string => {
  if (!p.label) return p.date;
  const d = new Date(p.date);
  if (Number.isNaN(d.getTime())) return p.label;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

const ChartTooltip = ({
  active,
  payload,
  itemsLabel,
}: {
  active?: boolean;
  payload?: { payload: PricePoint }[];
  itemsLabel: string;
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-brand-cyan bg-[#020617] px-3 py-2 shadow-[0_10px_30px_-10px_rgba(6,182,212,0.3)]">
      <p className="mb-0.5 text-[10px] font-bold uppercase text-slate-400">{tooltipDate(p)}</p>
      <p className="text-xs font-extrabold text-white">฿{Math.round(p.price).toLocaleString()}</p>
      {typeof p.items === 'number' && (
        <p className="text-[10px] font-medium text-slate-500">{p.items.toLocaleString()} {itemsLabel}</p>
      )}
    </div>
  );
};

const PriceChart: React.FC<PriceChartProps> = ({ data, itemsLabel = 'cards', showBaseline = true }) => {
  // useId's colons are legal in a fragment id but not in every CSS url()
  // parser; keep the gradient id plain.
  const gradientId = `pc${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // Three intervals, so a 160px-high chart gets four to six round labels rather
  // than seven cramped ones.
  const { domain, ticks } = niceValueDomain(data.map((d) => d.price), 3);
  const first = data[0]?.price ?? 0;
  const last = data[data.length - 1]?.price ?? 0;
  const tone = data.length < 2 || last === first ? FLAT : last > first ? UP : DOWN;
  const series = data.map((d) => ({ ...d, x: d.label ?? d.date }));

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 24, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity={0.32} />
              <stop offset="100%" stopColor={tone} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="x"
            tick={{ fontSize: 9, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            dy={6}
            minTickGap={28}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={domain}
            ticks={ticks}
            tick={{ fontSize: 9, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatAxis}
          />
          {showBaseline && data.length > 1 && (
            <ReferenceLine y={first} stroke="rgba(148,163,184,0.45)" strokeDasharray="4 4" />
          )}
          <Tooltip
            cursor={{ stroke: tone, strokeWidth: 1, strokeDasharray: '4 4' }}
            content={<ChartTooltip itemsLabel={itemsLabel} />}
            wrapperStyle={{ outline: 'none', zIndex: 1000 }}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="price"
            stroke={tone}
            strokeWidth={2.5}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 5, fill: tone, stroke: '#fff', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PriceChart;
