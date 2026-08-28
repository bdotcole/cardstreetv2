'use client';

import React from 'react';

/**
 * Header entry point for the Rewards Hub — sits where the currency switcher
 * used to (currency moved to Profile > Settings). Shows the coin balance with
 * a red dot while today's check-in is unclaimed, Whatnot-style.
 */
const RewardsChip: React.FC<{
    coins: number;
    unclaimed: boolean;
    onClick: () => void;
    label: string;
}> = ({ coins, unclaimed, onClick, label }) => (
    <button
        onClick={onClick}
        aria-label={label}
        className="glass h-9 pl-2.5 pr-3 rounded-xl flex items-center gap-1.5 border border-white/10 hover:bg-white/5 transition-all relative"
    >
        <i className="fa-solid fa-coins text-[12px] text-amber-400"></i>
        <span className="text-[10px] font-black text-amber-300 tabular-nums">
            {coins >= 10000 ? `${Math.floor(coins / 1000)}k` : coins.toLocaleString()}
        </span>
        {unclaimed && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-brand-red rounded-full border border-brand-darker"></span>
        )}
    </button>
);

export default RewardsChip;
