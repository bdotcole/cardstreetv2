
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface PriceChartProps {
  data: { date: string; price: number }[];
}

const PriceChart: React.FC<PriceChartProps> = ({ data }) => {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis 
            dataKey="date" 
            tick={{ fontSize: 9, fill: '#64748b' }} 
            axisLine={false}
            tickLine={false}
            dy={10}
          />
          <YAxis 
            tick={{ fontSize: 9, fill: '#64748b' }} 
            axisLine={false} 
            tickLine={false}
            tickFormatter={(val) => `฿${val/1000}k`}
          />
          <Tooltip 
            cursor={{ stroke: '#06b6d4', strokeWidth: 1, strokeDasharray: '4 4' }}
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
            activeDot={{ r: 6, fill: '#06b6d4', stroke: '#fff', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PriceChart;
