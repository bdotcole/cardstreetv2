
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface PriceChartProps {
  data: { date: string; price: number }[];
}

// Recharts' default numeric YAxis anchors at 0 ([0, 'auto']), so a ฿15 card gets
// drawn against a 0-16 scale and every real move collapses into a flat sliver at
// the top. Fit the axis to the data's own range instead, with headroom so the line
// never kisses an edge, and a floor of a few baht for a genuinely flat series so it
// reads as a centered line rather than pinned to a border. Clamped at 0 (prices are
// non-negative) and kept to whole baht to match the integer tick labels below.
function fitDomain(prices: number[]): [number, number] {
  if (prices.length === 0) return [0, 1];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min;
  const pad = span > 0 ? span * 0.15 : Math.max(1, Math.round(max * 0.05));
  return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
}

const PriceChart: React.FC<PriceChartProps> = ({ data }) => {
  const yDomain = fitDomain(data.map((d) => d.price));
  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 30, bottom: 5, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 9, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            dy={5}
            minTickGap={20}
          />
          <YAxis
            domain={yDomain}
            allowDecimals={false}
            tick={{ fontSize: 9, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(val) => {
              if (val >= 1000) {
                return `฿${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}k`;
              }
              return `฿${val.toFixed(0)}`;
            }}
          />
          <Tooltip
            active={true}
            isAnimationActive={false}
            cursor={{ stroke: '#06b6d4', strokeWidth: 1, strokeDasharray: '4 4' }}
            wrapperStyle={{
              outline: 'none',
              zIndex: 1000
            }}
            position={{ y: 0 }}
            allowEscapeViewBox={{ x: false, y: true }}
            contentStyle={{
              backgroundColor: '#020617',
              borderRadius: '8px',
              border: '1px solid #06b6d4',
              boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.3)',
              padding: '8px 12px'
            }}
            itemStyle={{ color: '#fff', fontWeight: '800', fontSize: '12px' }}
            labelStyle={{ color: '#94a3b8', marginBottom: '4px', fontSize: '10px', textTransform: 'uppercase', fontWeight: '700' }}
            formatter={(val: number) => [`฿${val.toLocaleString()}`, 'Valuation']}
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="#06b6d4"
            strokeWidth={3}
            dot={false}
            activeDot={{
              r: 8,
              fill: '#06b6d4',
              stroke: '#fff',
              strokeWidth: 3,
              style: { cursor: 'pointer' }
            }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PriceChart;
