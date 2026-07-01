import React, { useState, useEffect } from 'react';
import { UserProfile } from '@/types';
import { GemIcon, GemType } from './GemIcons';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { PARTNER_TIERS as TIER_SPECS, effectivePartnerLevel, feePercentForLevel } from '@/lib/partnerTiers';

interface PartnerPortalProps {
    user: UserProfile;
}

// Display decoration per level. The numeric ladder (name, minDownloads, fee)
// comes from lib/partnerTiers so this view can't drift from the fee a seller is
// actually charged; only the gem/colour/rewards presentation lives here.
interface TierDecor {
    color: string;
    gemIcon: string;
    gem?: GemType;
    rewards: string[];
    // QC-approved official Thai translation of `rewards`, same order.
    rewardsTh: string[];
}

interface PartnerTier extends TierDecor {
    level: number;
    name: string;
    minDownloads: number;
    fee: number; // percent, from the shared ladder
}

const TIER_DECOR: Record<number, TierDecor> = {
    1: {
        color: 'text-amber-600 border-amber-600',
        gemIcon: '🟤',
        rewards: ['Partner QR Code & referral link'],
        rewardsTh: ['QR Code และลิงก์แนะนำของพาร์ทเนอร์'],
    },
    2: {
        color: 'text-slate-300 border-slate-300',
        gemIcon: '⚪',
        rewards: ['4.5% seller fee'],
        rewardsTh: ['ค่าธรรมเนียม 4.5%'],
    },
    3: {
        color: 'text-yellow-400 border-yellow-400',
        gemIcon: '🟡',
        rewards: ['4% seller fee', 'Early access to feature updates (Actions & Live Breaks)'],
        rewardsTh: ['ค่าธรรมเนียม 4%', 'สิทธิ์เข้าถึงฟีเจอร์ใหม่ก่อนใคร (ประมูลและไลฟ์สดเปิดซอง)'],
    },
    4: {
        color: 'text-slate-200 border-slate-200',
        gemIcon: '🔷',
        rewards: ['3.5% seller fee', 'Raffle entry: English booster box (must reach by EOY)'],
        rewardsTh: ['ค่าธรรมเนียม 3.5%', 'ลุ้นรับสิทธิ์ซื้อ Booster Box ภาษาอังกฤษ (จำกัดเวลาถึงสิ้นปีนี้)'],
    },
    5: {
        color: 'text-blue-400 border-blue-400',
        gemIcon: '💎',
        gem: 'sapphire',
        rewards: ['3% seller fee', 'Cardstreet social media feature'],
        rewardsTh: ['ค่าธรรมเนียม 3%', 'สิทธิ์เข้าใช้ฟีเจอร์โซเชียลคาร์ดสตรีท'],
    },
    6: {
        color: 'text-red-400 border-red-400',
        gemIcon: '🔴',
        gem: 'ruby',
        rewards: ['2.75% seller fee', 'Exclusive Cardstreet mousepad'],
        rewardsTh: ['ค่าธรรมเนียม 2.75%', 'รับแผ่นรองเมาส์รุ่นลิมิเต็ดจากคาร์ดสตรีท'],
    },
    7: {
        color: 'text-green-400 border-green-400',
        gemIcon: '🟢',
        gem: 'emerald',
        rewards: ['2.5% seller fee', 'Free table spot at 2027 SEA International Card Show'],
        rewardsTh: ['ค่าธรรมเนียม 2.5%', 'ฟรี! บูธแสดงสินค้างาน SEA International Card Show 2027'],
    },
    8: {
        color: 'text-brand-cyan border-brand-cyan',
        gemIcon: '💠',
        gem: 'diamond',
        rewards: ['2.25% seller fee', '1% profit sharing on transactions from your referred users'],
        rewardsTh: ['ค่าธรรมเนียม 2.25%', 'ส่วนแบ่งกำไร 1% จากยอดซื้อขายของ User ที่คุณแนะนำ (Referred users)'],
    },
    9: {
        color: 'text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 via-cyan-300 to-violet-400 border-violet-400',
        gemIcon: '🩷',
        gem: 'opal',
        rewards: ['2% seller fee', '2% profit sharing on transactions from your referred users'],
        rewardsTh: ['ค่าธรรมเนียม 2%', 'ส่วนแบ่งกำไร 2% จากยอดซื้อขายของ User ที่คุณแนะนำ (Referred users)'],
    },
};

// Decorated tiers for the UI, built from the shared numeric ladder.
const PARTNER_TIERS: PartnerTier[] = TIER_SPECS.map((spec) => ({
    level: spec.level,
    name: spec.name,
    minDownloads: spec.minDownloads,
    fee: spec.feePercent,
    ...TIER_DECOR[spec.level],
}));

interface ReferralData {
    slug: string;
    link: string;
    clicks: number;
    installs: number;
    signups: number;
    totalDownloads: number;
}

// Static UI labels. Thai is the QC-approved official translation.
const LABELS = {
    en: {
        partnerPortal: 'Partner Portal',
        welcomeBack: 'Welcome back,',
        level: 'Level',
        partnerSuffix: 'Partner',
        totalDownloads: 'Total App Downloads',
        keepGrowing: 'Keep Growing',
        currentFee: 'Current Fee',
        earnings: 'Earnings',
        roadToLegend: 'Road to Legend',
        shareValue: 'Share the Value',
        downloadPng: 'Download PNG for print',
        linkOpens: 'Link Opens',
        signups: 'Signups',
        tierRewards: 'Tier Rewards',
        downloadsLabel: 'Downloads',
        sellerFee: 'Seller Fee',
        currentTier: 'Current Tier',
        downloadsTo: (n: number, tier: string) => `${n.toLocaleString()} downloads to ${tier}`,
    },
    th: {
        partnerPortal: 'ระบบพาร์ทเนอร์',
        welcomeBack: 'ยินดีต้อนรับกลับมา,',
        level: 'เลเวล',
        partnerSuffix: 'Partner',
        totalDownloads: 'ยอดดาวน์โหลดแอปทั้งหมด',
        keepGrowing: 'สะสมต่อ',
        currentFee: 'ค่าธรรมเนียมปัจจุบัน',
        earnings: 'รายได้',
        roadToLegend: 'เส้นทางสู่ระดับตำนาน',
        shareValue: 'แชร์สิ่งดีๆ ให้เพื่อน',
        downloadPng: 'ดาวน์โหลด PNG สำหรับพิมพ์',
        linkOpens: 'จำนวนการเปิดลิงก์',
        signups: 'จำนวนการลงทะเบียน',
        tierRewards: 'รางวัลตามระดับ',
        downloadsLabel: 'ดาวน์โหลด',
        sellerFee: 'ค่าธรรมเนียม',
        currentTier: 'ระดับปัจจุบัน',
        downloadsTo: (n: number, tier: string) => `อีก ${n.toLocaleString()} ดาวน์โหลด สู่ ${tier}`,
    },
};

const PartnerPortal: React.FC<PartnerPortalProps> = ({ user }) => {
    const { isThai } = useTranslation();
    const L = isThai ? LABELS.th : LABELS.en;
    const [stats, setStats] = useState({
        totalDownloads: 0,
        totalEarnings: 0,
        currentFee: 5.0,
        referralCode: `CARDSTREET-${user?.name?.toUpperCase().slice(0, 5) || 'PARTNER'}`,
        level: 1
    });
    const [referral, setReferral] = useState<ReferralData | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [showQr, setShowQr] = useState(false);

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
                        // partner_level is INTEGER 1-9 in the DB; String() so
                        // the numeric keys in strMap below match it too.
                        userLevelStr = String(data.profile.partner_level ?? 'bronze');
                    }
                }

                // Fetch earnings
                let earnings = 0;
                const salesRes = await fetch('/api/profile/sales');
                if (salesRes.ok) {
                    const salesData = await salesRes.json();
                    earnings = salesData.totalEarnings || 0;
                }

                // Effective level = the higher of the admin-set level and what
                // the partner's downloads have earned (shared ladder; mirrors
                // the checkout fee and the SQL trigger).
                const activeLevel = effectivePartnerLevel(userLevelStr, downloads);
                const activeFee = feePercentForLevel(activeLevel);

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

    // Real referral link + tracking stats (slug is generated server-side on
    // first call). Falls back to nothing — the UI keeps the placeholder until
    // this resolves.
    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/referrals/me');
                if (!res.ok) return;
                const data: ReferralData = await res.json();
                if (cancelled) return;
                setReferral(data);
                // Pre-render the QR so opening the panel is instant. Dynamic
                // import keeps the qrcode lib out of the main bundle.
                const QRCode = (await import('qrcode')).default;
                const url = await QRCode.toDataURL(data.link, {
                    width: 512,
                    margin: 2,
                    color: { dark: '#0f1419', light: '#ffffff' },
                });
                if (!cancelled) setQrDataUrl(url);
            } catch (err) {
                console.error('Failed to load referral data:', err);
            }
        })();
        return () => { cancelled = true; };
    }, [user]);

    const currentTierIndex = PARTNER_TIERS.findIndex(t => t.level === stats.level);
    const currentTier = PARTNER_TIERS[currentTierIndex];
    const nextTier = PARTNER_TIERS[currentTierIndex + 1];

    // Progress Calculation
    const progressToNext = nextTier
        ? Math.min(100, Math.max(0, ((stats.totalDownloads - currentTier.minDownloads) / (nextTier.minDownloads - currentTier.minDownloads)) * 100))
        : 100;

    const referralLink = referral?.link ?? `https://cardstreet.app/join/${stats.referralCode}`;
    const referralLinkLabel = referralLink.replace(/^https?:\/\//, '');

    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(referralLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="pb-32 animate-fadeIn bg-brand-darker min-h-screen">
            {/* Header */}
            <div className="pt-6 px-6 pb-6 bg-gradient-to-b from-brand-cyan/5 to-transparent border-b border-white/5">
                <p className="text-brand-cyan text-[10px] font-black uppercase tracking-[0.2em] italic skew-x-[-10deg] mb-1">{L.partnerPortal}</p>
                <h1 className="text-3xl font-black text-white italic skew-x-[-5deg]">
                    {L.welcomeBack} <br />
                    <span className={currentTier.color}>{user.name}</span>
                </h1>
                <p className="text-xs font-bold text-slate-500 mt-2 uppercase tracking-widest">
                    {L.level} {stats.level} • {currentTier.name} {L.partnerSuffix}
                </p>
            </div>

            <div className="px-4 -mt-4 space-y-6">
                {/* Stat Cards - Glassmorphism */}
                <div className="grid grid-cols-1 gap-3">
                    <div className="glass p-5 rounded-2xl border border-white/10 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <i className="fa-solid fa-users text-4xl text-brand-cyan"></i>
                        </div>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">{L.totalDownloads}</p>
                        <p className="text-4xl font-black text-white">{stats.totalDownloads.toLocaleString()}</p>
                        <div className="mt-2 text-[10px] text-brand-green font-bold uppercase flex items-center gap-1">
                            <i className="fa-solid fa-arrow-trend-up"></i> {L.keepGrowing}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="glass p-4 rounded-2xl border border-white/10">
                            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">{L.currentFee}</p>
                            <p className="text-2xl font-black text-brand-red">{stats.currentFee}%</p>
                        </div>
                        <div className="glass p-4 rounded-2xl border border-white/10">
                            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">{L.earnings}</p>
                            <p className="text-2xl font-black text-brand-green">฿{stats.totalEarnings.toLocaleString()}</p>
                        </div>
                    </div>
                </div>

                {/* Road to Legend Progress */}
                <div className="glass p-6 rounded-2xl border border-white/10 space-y-4 relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-brand-cyan/5 to-brand-purple/5"></div>

                    <div className="flex justify-between items-end relative z-10">
                        <h3 className="font-black text-white italic skew-x-[-10deg] uppercase tracking-wide">{L.roadToLegend}</h3>
                        {nextTier && (
                            <span className="text-[9px] font-bold text-brand-cyan uppercase tracking-wider">
                                {L.downloadsTo(nextTier.minDownloads - stats.totalDownloads, nextTier.name)}
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
                    <h3 className="font-black text-white italic skew-x-[-10deg] uppercase tracking-wide">{L.shareValue}</h3>
                    <div className="flex gap-2">
                        <div className="flex-1 min-w-0 bg-brand-darker border border-white/10 rounded-xl px-4 flex items-center h-12">
                            <span className="text-xs text-slate-400 font-mono truncate w-full">{referralLinkLabel}</span>
                        </div>
                        <button
                            onClick={handleCopy}
                            className="shrink-0 w-12 h-12 bg-white text-brand-darker rounded-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
                        >
                            {copied ? <i className="fa-solid fa-check text-brand-green"></i> : <i className="fa-regular fa-copy"></i>}
                        </button>
                        <button
                            onClick={() => setShowQr(v => !v)}
                            disabled={!qrDataUrl}
                            className="shrink-0 w-12 h-12 bg-brand-cyan text-brand-darker rounded-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-40 disabled:hover:scale-100"
                        >
                            <i className="fa-solid fa-qrcode"></i>
                        </button>
                    </div>

                    {showQr && qrDataUrl && (
                        <div className="flex flex-col items-center gap-3 pt-2">
                            <div className="bg-white p-3 rounded-2xl">
                                {/* Plain img: the QR is a generated data URL, no optimizer needed */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={qrDataUrl} alt="Partner referral QR code" className="w-48 h-48" />
                            </div>
                            <a
                                href={qrDataUrl}
                                download={`cardstreet-qr-${referral?.slug ?? 'partner'}.png`}
                                className="text-[10px] font-bold text-brand-cyan uppercase tracking-widest hover:underline"
                            >
                                <i className="fa-solid fa-download mr-1"></i> {L.downloadPng}
                            </a>
                        </div>
                    )}

                    {referral && (
                        <div className="grid grid-cols-2 gap-3 pt-1">
                            <div className="bg-brand-darker border border-white/10 rounded-xl p-3">
                                <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">{L.linkOpens}</p>
                                <p className="text-xl font-black text-white">{referral.clicks.toLocaleString()}</p>
                            </div>
                            <div className="bg-brand-darker border border-white/10 rounded-xl p-3">
                                <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-1">{L.signups}</p>
                                <p className="text-xl font-black text-brand-green">{referral.signups.toLocaleString()}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Tier Overview */}
                <div className="space-y-3">
                    <h3 className="font-black text-white italic skew-x-[-10deg] uppercase tracking-wide px-2">{L.tierRewards}</h3>
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
                                            <p className={`text-sm font-bold ${tier.color}`}>{tier.name}</p>
                                            <p className="text-[9px] text-slate-500 font-bold uppercase">{tier.minDownloads.toLocaleString()}+ {L.downloadsLabel}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-white">{tier.fee}%</p>
                                        <p className="text-[8px] text-slate-500 font-bold uppercase">{L.sellerFee}</p>
                                    </div>
                                </div>
                                <ul className="space-y-1 pl-9">
                                    {(isThai ? tier.rewardsTh : tier.rewards).map((reward, i) => (
                                        <li key={i} className="text-[10px] text-slate-400 font-semibold flex items-start gap-1.5">
                                            <span className="text-brand-cyan mt-0.5">✦</span>
                                            {reward}
                                        </li>
                                    ))}
                                </ul>
                                {isActive && (
                                    <div className="mt-2 pl-9">
                                        <span className="text-[9px] font-black text-brand-cyan uppercase tracking-widest">← {L.currentTier}</span>
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
