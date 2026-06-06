import React, { useState, useEffect } from 'react';
import { UserProfile, PartnerStats } from '@/types';
import { GemIcon, GemType } from './GemIcons';

interface PartnerPortalProps {
    user: UserProfile;
}

interface PartnerTier {
    level: number;
    name: string;
    minDownloads: number;
    fee: number;
    color: string;
    gemIcon: string;
    gem?: GemType;
    rewards: string[];
}

const PARTNER_TIERS: PartnerTier[] = [
    {
        level: 1,
        name: 'Bronze Rare',
        minDownloads: 0,
        fee: 5.0,
        color: 'text-amber-600 border-amber-600',
        gemIcon: '🟤',
        rewards: ['Partner QR Code & referral link'],
    },
    {
        level: 2,
        name: 'Silver Rare',
        minDownloads: 100,
        fee: 4.5,
        color: 'text-slate-300 border-slate-300',
        gemIcon: '⚪',
        rewards: ['4.5% seller fee'],
    },
    {
        level: 3,
        name: 'Gold Rare',
        minDownloads: 500,
        fee: 4.0,
        color: 'text-yellow-400 border-yellow-400',
        gemIcon: '🟡',
        rewards: ['4% seller fee', 'Early access to feature updates (Actions & Live Breaks)'],
    },
    {
        level: 4,
        name: 'Platinum Rare',
        minDownloads: 1000,
        fee: 3.5,
        color: 'text-slate-200 border-slate-200',
        gemIcon: '🔷',
        rewards: ['3.5% seller fee', 'Raffle entry: English booster box (must reach by EOY)'],
    },
    {
        level: 5,
        name: 'Sapphire Rare',
        minDownloads: 2500,
        fee: 3.0,
        color: 'text-blue-400 border-blue-400',
        gemIcon: '💎',
        gem: 'sapphire',
        rewards: ['3% seller fee', 'Cardstreet social media feature'],
    },
    {
        level: 6,
        name: 'Ruby Rare',
        minDownloads: 3500,
        fee: 2.75,
        color: 'text-red-400 border-red-400',
        gemIcon: '🔴',
        gem: 'ruby',
        rewards: ['2.75% seller fee', 'Exclusive Cardstreet mousepad'],
    },
    {
        level: 7,
        name: 'Emerald Rare',
        minDownloads: 5000,
        fee: 2.5,
        color: 'text-green-400 border-green-400',
        gemIcon: '🟢',
        gem: 'emerald',
        rewards: ['2.5% seller fee', 'Free table spot at 2027 SEA International Card Show'],
    },
    {
        level: 8,
        name: 'Diamond Rare',
        minDownloads: 7500,
        fee: 2.25,
        color: 'text-brand-cyan border-brand-cyan',
        gemIcon: '💠',
        gem: 'diamond',
        rewards: ['2.25% seller fee', '1% profit sharing on transactions from your referred users'],
    },
    {
        level: 9,
        name: 'Black Opal Rare',
        minDownloads: 10000,
        fee: 2.0,
        color: 'text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 via-cyan-300 to-violet-400 border-violet-400',
        gemIcon: '🩷',
        gem: 'opal',
        rewards: ['2% seller fee', '2% profit sharing on transactions from your referred users'],
    },
];

const PartnerPortal: React.FC<PartnerPortalProps> = ({ user }) => {
    const [stats, setStats] = useState({
        totalDownloads: 0,
        totalEarnings: 0,
        currentFee: 5.0,
        referralCode: `CARDSTREET-${user?.name?.toUpperCase().slice(0, 5) || 'PARTNER'}`,
        level: 1
    });

    useEffect(() => {
        const loadStats = async () => {
            try {
                // Fetch profile data
                const profileRes = await fetch('/api/profile');
                let downloads = 0;
                let userLevelStr = 'bronze';
                
                if (profileRes.ok) {
                    const data = await profileRes.json();
                    if (data.profile) {
                        downloads = data.profile.total_downloads || 0;
                        userLevelStr = data.profile.partner_level || 'bronze';
                    }
                }

                // Fetch earnings
                let earnings = 0;
                const salesRes = await fetch('/api/profile/sales');
                if (salesRes.ok) {
                    const salesData = await salesRes.json();
                    earnings = salesData.totalEarnings || 0;
                }

                // Map admin string to exact level index, or fallback to auto-computed from downloads
                let activeLevel = 1;
                const strMap: Record<string, number> = {
                    'bronze': 1,
                    'silver': 2,
                    'gold': 3,
                    'platinum': 4,
                    'sapphire': 5,
                    'ruby': 6,
                    'emerald': 7,
                    'diamond': 8,
                    'black_opal': 9,
                    'black opal': 9,
                    'opal': 9,
                    'pink_diamond': 9,
                    'heart': 9,
                    'pink diamond': 9
                };

                const matchedTier = strMap[userLevelStr.toLowerCase()];
                if (matchedTier) {
                    activeLevel = matchedTier;
                } else {
                    const sortedTiers = [...PARTNER_TIERS].reverse(); 
                    const calculatedTier = sortedTiers.find(t => downloads >= t.minDownloads);
                    if (calculatedTier) activeLevel = calculatedTier.level;
                }

                const activeFee = PARTNER_TIERS.find(t => t.level === activeLevel)?.fee || 5.0;

                setStats({
                    totalDownloads: downloads,
                    totalEarnings: earnings,
                    currentFee: activeFee,
                    referralCode: `CARDSTREET-${user?.name?.toUpperCase().slice(0, 5) || 'PARTNER'}`,
                    level: activeLevel
                });
            } catch (err) {
                console.error("Failed to load partner stats:", err);
            }
        };

        if (user) {
            loadStats();
        }
    }, [user]);

    const currentTierIndex = PARTNER_TIERS.findIndex(t => t.level === stats.level);
    const currentTier = PARTNER_TIERS[currentTierIndex];
    const nextTier = PARTNER_TIERS[currentTierIndex + 1];

    // Progress Calculation
    const progressToNext = nextTier
        ? Math.min(100, Math.max(0, ((stats.totalDownloads - currentTier.minDownloads) / (nextTier.minDownloads - currentTier.minDownloads)) * 100))
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
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Total App Downloads</p>
                        <p className="text-4xl font-black text-white">{stats.totalDownloads.toLocaleString()}</p>
                        <div className="mt-2 text-[10px] text-brand-green font-bold uppercase flex items-center gap-1">
                            <i className="fa-solid fa-arrow-trend-up"></i> Keep Growing
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
                                {nextTier.minDownloads - stats.totalDownloads} downloads to {nextTier.name}
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
                        <span>{currentTier.minDownloads.toLocaleString()}</span>
                        <span>{nextTier ? nextTier.minDownloads.toLocaleString() : 'MAX'}</span>
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
                    {PARTNER_TIERS.map((tier) => {
                        const isActive = tier.level === stats.level;
                        const isUnlocked = tier.level <= stats.level;
                        return (
                            <div
                                key={tier.level}
                                className={`p-4 rounded-xl border transition-all ${isActive
                                    ? 'bg-white/10 border-brand-cyan/50 shadow-[0_0_15px_rgba(6,182,212,0.1)]'
                                    : isUnlocked
                                        ? 'bg-white/5 border-white/10'
                                        : 'bg-white/5 border-white/5 opacity-50'
                                    }`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-3">
                                        {tier.gem
                                            ? <GemIcon type={tier.gem} className="w-6 h-6 drop-shadow-[0_0_4px_rgba(255,255,255,0.15)]" />
                                            : <span className="text-xl">{tier.gemIcon}</span>}
                                        <div>
                                            <p className={`text-sm font-bold ${tier.color.split(' ')[0]}`}>{tier.name}</p>
                                            <p className="text-[9px] text-slate-500 font-bold uppercase">{tier.minDownloads.toLocaleString()}+ Downloads</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-white">{tier.fee}%</p>
                                        <p className="text-[8px] text-slate-500 font-bold uppercase">Seller Fee</p>
                                    </div>
                                </div>
                                <ul className="space-y-1 pl-9">
                                    {tier.rewards.map((reward, i) => (
                                        <li key={i} className="text-[10px] text-slate-400 font-semibold flex items-start gap-1.5">
                                            <span className="text-brand-cyan mt-0.5">✦</span>
                                            {reward}
                                        </li>
                                    ))}
                                </ul>
                                {isActive && (
                                    <div className="mt-2 pl-9">
                                        <span className="text-[9px] font-black text-brand-cyan uppercase tracking-widest">← Current Tier</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default PartnerPortal;
