import React, { useState } from 'react';
import { UserProfile, PartnerStats } from '@/types';

interface PartnerPortalProps {
    user: UserProfile;
}

const PARTNER_TIERS = [
    { level: 1, name: 'Entry', minSignups: 0, fee: 5.0, color: 'text-brand-orange border-brand-orange' },
    { level: 2, name: 'Rising Star', minSignups: 100, fee: 4.5, color: 'text-slate-300 border-slate-300' },
    { level: 3, name: 'Pro Dealer', minSignups: 500, fee: 4.0, color: 'text-yellow-400 border-yellow-400' },
    { level: 4, name: 'Market Maker', minSignups: 1000, fee: 3.5, color: 'text-brand-cyan border-brand-cyan' },
    { level: 5, name: 'Hobby Icon', minSignups: 5000, fee: 3.0, color: 'text-brand-purple border-brand-purple' },
    { level: 6, name: 'Legendary', minSignups: 10000, fee: 2.0, color: 'text-transparent bg-clip-text bg-gradient-to-r from-brand-cyan via-white to-brand-purple border-white' },
];

const PartnerPortal: React.FC<PartnerPortalProps> = ({ user }) => {
    const stats = user.partnerStats || {
        totalSignups: 0,
        totalEarnings: 0,
        currentFee: 5.0,
        referralCode: `CARDSTREET-${user.name.toUpperCase().slice(0, 5)}`,
        level: 1
    };

    const currentTierIndex = PARTNER_TIERS.findIndex(t => t.level === stats.level);
    const currentTier = PARTNER_TIERS[currentTierIndex];
    const nextTier = PARTNER_TIERS[currentTierIndex + 1];

    // Progress Calculation
    const progressToNext = nextTier
        ? Math.min(100, Math.max(0, ((stats.totalSignups - currentTier.minSignups) / (nextTier.minSignups - currentTier.minSignups)) * 100))
        : 100;

    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(`https://cardstreet.app/join/${stats.referralCode}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="pb-32 animate-fadeIn bg-brand-darker min-h-screen">
            {/* Header */}
            <div className="pt-6 px-6 pb-6 bg-gradient-to-b from-brand-cyan/5 to-transparent border-b border-white/5">
                <p className="text-brand-cyan text-[10px] font-black uppercase tracking-[0.2em] italic skew-x-[-10deg] mb-1">Partner Portal</p>
                <h1 className="text-3xl font-black text-white italic skew-x-[-5deg]">
                    Welcome back, <br />
                    <span className={currentTier.color}>{user.name}</span>
                </h1>
                <p className="text-xs font-bold text-slate-500 mt-2 uppercase tracking-widest">
                    Level {stats.level} • {currentTier.name} Partner
                </p>
            </div>

            <div className="px-4 -mt-4 space-y-6">
                {/* Stat Cards - Glassmorphism */}
                <div className="grid grid-cols-1 gap-3">
                    <div className="glass p-5 rounded-2xl border border-white/10 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <i className="fa-solid fa-users text-4xl text-brand-cyan"></i>
                        </div>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Total Sign-ups</p>
                        <p className="text-4xl font-black text-white">{stats.totalSignups.toLocaleString()}</p>
                        <div className="mt-2 text-[10px] text-brand-green font-bold uppercase flex items-center gap-1">
                            <i className="fa-solid fa-arrow-trend-up"></i> Top 5%
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="glass p-4 rounded-2xl border border-white/10">
                            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">Current Fee</p>
                            <p className="text-2xl font-black text-brand-red">{stats.currentFee}%</p>
                        </div>
                        <div className="glass p-4 rounded-2xl border border-white/10">
                            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">Earnings</p>
                            <p className="text-2xl font-black text-brand-green">฿{stats.totalEarnings.toLocaleString()}</p>
                        </div>
                    </div>
                </div>

                {/* Road to Legend Progress */}
                <div className="glass p-6 rounded-2xl border border-white/10 space-y-4 relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-brand-cyan/5 to-brand-purple/5"></div>

                    <div className="flex justify-between items-end relative z-10">
                        <h3 className="font-black text-white italic skew-x-[-10deg] uppercase tracking-wide">Road to Legend</h3>
                        {nextTier && (
                            <span className="text-[9px] font-bold text-brand-cyan uppercase tracking-wider">
                                {nextTier.minSignups - stats.totalSignups} to Level {nextTier.level}
                            </span>
                        )}
                    </div>

                    {/* Progress Bar Container */}
                    <div className="h-4 bg-brand-darker rounded-full overflow-hidden border border-white/10 relative z-10">
                        <div
                            className="h-full bg-gradient-to-r from-brand-cyan via-brand-purple to-brand-red relative"
                            style={{ width: `${progressToNext}%` }}
                        >
                            {/* Shimmer Effect */}
                            <div className="absolute inset-0 w-full h-full bg-white/20 animate-pulse"></div>
                        </div>
                    </div>

                    <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-widest relative z-10">
                        <span>{currentTier.minSignups}</span>
                        <span>{nextTier ? nextTier.minSignups : 'MAX'}</span>
                    </div>
                </div>

                {/* Referral Tool */}
                <div className="glass p-6 rounded-2xl border border-white/10 space-y-4">
                    <h3 className="font-black text-white italic skew-x-[-10deg] uppercase tracking-wide">Share the Value</h3>
                    <div className="flex gap-2">
                        <div className="flex-1 bg-brand-darker border border-white/10 rounded-xl px-4 flex items-center h-12">
                            <span className="text-xs text-slate-400 font-mono table-fixed truncate w-full">cardstreet.app/join/{stats.referralCode}</span>
                        </div>
                        <button
                            onClick={handleCopy}
                            className="w-12 h-12 bg-white text-brand-darker rounded-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
                        >
                            {copied ? <i className="fa-solid fa-check text-brand-green"></i> : <i className="fa-regular fa-copy"></i>}
                        </button>
                        <button className="w-12 h-12 bg-brand-cyan text-brand-darker rounded-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all">
                            <i className="fa-solid fa-qrcode"></i>
                        </button>
                    </div>
                </div>

                {/* Tier Overview */}
                <div className="space-y-3">
                    <h3 className="font-black text-white italic skew-x-[-10deg] uppercase tracking-wide px-2">Tier Rewards</h3>
                    {PARTNER_TIERS.map((tier) => (
                        <div
                            key={tier.level}
                            className={`flex justify-between items-center p-4 rounded-xl border transition-all ${tier.level === stats.level
                                    ? 'bg-white/10 border-brand-cyan/50 shadow-[0_0_15px_rgba(6,182,212,0.1)]'
                                    : 'bg-white/5 border-white/5 opacity-60'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs border ${tier.color.replace('text-', 'bg-').split(' ')[0]} bg-opacity-20 ${tier.color.split(' ')[0]}`}>
                                    {tier.level}
                                </div>
                                <div>
                                    <p className={`text-sm font-bold ${tier.color.split(' ')[0]}`}>{tier.name}</p>
                                    <p className="text-[9px] text-slate-500 font-bold uppercase">{tier.minSignups}+ Recruits</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <p className="text-sm font-black text-white">{tier.fee}%</p>
                                <p className="text-[8px] text-slate-500 font-bold uppercase">Fee</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default PartnerPortal;
