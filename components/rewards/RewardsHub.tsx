'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { useUserSettings } from '@/lib/contexts/UserSettingsContext';
import { CATALOG, CHECKIN_CALENDAR, QUEST_COINS, bandForLevel, levelProgress } from '@/lib/rewardTiers';
import type { RewardsSummary } from '@/lib/hooks/useRewardsSummary';

/**
 * The Rewards Hub — Whatnot-style rewards sheet opened from the header coin
 * chip (and the Profile menu row via the 'cs:openRewards' window event).
 * Three tabs: Overview (coin balance, level bar, 7-day check-in calendar,
 * streak), Challenges (daily quests + Collector's Journey), Shop (coin store —
 * display-only until the redemption rail ships).
 *
 * Sheet chrome follows components/live/SpotPaymentSheet.tsx (framer spring,
 * items-end on phone / centered on desktop). z-[210] so it also opens above
 * Profile's z-[200] full-screen panels.
 */

type Tab = 'overview' | 'challenges' | 'shop';

interface RewardsHubProps {
    open: boolean;
    onClose: () => void;
    summary: RewardsSummary | null;
    refresh: () => Promise<RewardsSummary | null>;
}

const RewardsHub: React.FC<RewardsHubProps> = ({ open, onClose, summary, refresh }) => {
    const { t } = useTranslation();
    const { settings } = useUserSettings();
    const isThai = settings.language === 'TH';

    const [tab, setTab] = useState<Tab>('overview');
    const [claiming, setClaiming] = useState(false);
    const [claimingSlot, setClaimingSlot] = useState<number | null>(null);
    // Claim feedback renders INLINE — the global toast sits at z-[100] and
    // this sheet at z-[210], so a toast fired here would be invisible.
    const [flash, setFlash] = useState<string | null>(null);
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showFlash = useCallback((text: string) => {
        setFlash(text);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), 2600);
    }, []);
    useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

    const claimCheckin = useCallback(async () => {
        if (claiming) return;
        setClaiming(true);
        try {
            const res = await fetch('/api/rewards/checkin', { method: 'POST', credentials: 'include' });
            const data = await res.json().catch(() => null);
            if (data?.claimed) {
                const extra = data.milestoneCoins > 0 ? ` +${data.milestoneCoins}` : '';
                const levelUp = data.leveledUp ? ` · ${t('rewards.levelUp')} ${data.level}` : '';
                showFlash(`${t('rewards.checkinDone')} +${data.coins}${extra} ${t('rewards.coins')}${levelUp}`);
            } else if (data?.reason === 'already_claimed') {
                showFlash(t('rewards.alreadyClaimed'));
            }
            await refresh();
        } catch {
            // fail-soft: the hub simply stays as-is
        } finally {
            setClaiming(false);
        }
    }, [claiming, refresh, showFlash, t]);

    const claimQuest = useCallback(async (slot: number) => {
        if (claimingSlot !== null) return;
        setClaimingSlot(slot);
        try {
            const res = await fetch('/api/rewards/quests/claim', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slot }),
            });
            const data = await res.json().catch(() => null);
            if (data?.claimed) {
                const bonus = data.bonusCoins > 0 ? ` +${data.bonusCoins}` : '';
                const levelUp = data.leveledUp ? ` · ${t('rewards.levelUp')} ${data.level}` : '';
                showFlash(`${t('rewards.questDone')} +${data.coins}${bonus} ${t('rewards.coins')}${levelUp}`);
            }
            await refresh();
        } catch {
            // fail-soft
        } finally {
            setClaimingSlot(null);
        }
    }, [claimingSlot, refresh, showFlash, t]);

    if (!open || !summary) return null;

    const prog = levelProgress(summary.xp);
    const band = bandForLevel(summary.level);
    const doneThrough = summary.checkinClaimedToday ? summary.cycleDay : summary.cycleDay - 1;

    return (
        <AnimatePresence>
            <motion.div
                key="rewards-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[210] flex items-end lg:items-center justify-center bg-black/80 backdrop-blur-md"
                onClick={onClose}
            >
                <motion.div
                    key="rewards-sheet"
                    initial={{ y: 80, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 80, opacity: 0 }}
                    transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                    className="w-full max-w-md bg-slate-900 rounded-t-[2rem] lg:rounded-[2rem] border border-white/10 shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-hide"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header: balance + close */}
                    <div className="p-5 pb-4 border-b border-white/5 flex items-center justify-between sticky top-0 bg-slate-900/95 backdrop-blur-xl z-10 rounded-t-[2rem]">
                        <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{t('rewards.title')}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                                <i className="fa-solid fa-coins text-amber-400 text-sm"></i>
                                <span className="text-white text-2xl font-black tabular-nums">{summary.coins.toLocaleString()}</span>
                                <span className="text-slate-500 text-xs font-bold uppercase">{t('rewards.coins')}</span>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            aria-label={t('rewards.close')}
                            className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10 text-slate-400"
                        >
                            <i className="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    {/* Inline claim feedback */}
                    <AnimatePresence>
                        {flash && (
                            <motion.div
                                initial={{ opacity: 0, y: -6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="mx-5 mt-3 px-4 py-2.5 rounded-xl bg-amber-400/15 border border-amber-400/30 text-amber-200 text-xs font-bold text-center"
                            >
                                {flash}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Level bar */}
                    <div className="px-5 pt-4">
                        <div className="glass rounded-2xl border border-white/5 p-4">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <span className={`text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md ${band.chipClass}`}>
                                        {isThai ? band.nameTh : band.name}
                                    </span>
                                    <span className="text-white text-sm font-black">{t('rewards.level')} {summary.level}</span>
                                </div>
                                <span className="text-slate-500 text-[10px] font-bold tabular-nums">
                                    {prog.nextLevelXp === null
                                        ? t('rewards.maxLevel')
                                        : `${prog.intoLevel.toLocaleString()} / ${(prog.levelSpan ?? 0).toLocaleString()} XP`}
                                </span>
                            </div>
                            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.round(prog.pct * 100)}%` }}
                                    transition={{ duration: 0.6, ease: 'easeOut' }}
                                    className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-cyan-300"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="px-5 pt-4">
                        <div className="glass rounded-xl border border-white/5 p-1 flex gap-1">
                            {([
                                { key: 'overview' as Tab, label: t('rewards.tabOverview') },
                                { key: 'challenges' as Tab, label: t('rewards.tabChallenges') },
                                { key: 'shop' as Tab, label: t('rewards.tabShop') },
                            ]).map(({ key, label }) => (
                                <button
                                    key={key}
                                    onClick={() => setTab(key)}
                                    className={`flex-1 h-9 rounded-lg text-[11px] font-black uppercase tracking-wide transition-colors ${
                                        tab === key ? 'bg-brand-cyan text-brand-darker' : 'text-slate-400 hover:text-white'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="p-5 space-y-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
                        {tab === 'overview' && (
                            <>
                                {/* 7-day check-in calendar */}
                                <div>
                                    <div className="flex items-center justify-between mb-2 px-1">
                                        <h4 className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">{t('rewards.checkinTitle')}</h4>
                                        <div className="flex items-center gap-1.5 text-[10px] font-bold">
                                            <i className="fa-solid fa-fire text-orange-400"></i>
                                            <span className="text-orange-300 tabular-nums">{summary.streak}</span>
                                            <span className="text-slate-500 uppercase">{t('rewards.streakDays')}</span>
                                            {summary.freezes > 0 && (
                                                <span className="text-cyan-300 ml-2">
                                                    <i className="fa-solid fa-snowflake mr-1"></i>{summary.freezes}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-7 gap-1.5">
                                        {CHECKIN_CALENDAR.map((coins, i) => {
                                            const day = i + 1;
                                            const done = day <= doneThrough;
                                            const isToday = day === summary.cycleDay;
                                            return (
                                                <div
                                                    key={day}
                                                    className={`rounded-xl border py-2 flex flex-col items-center gap-0.5 ${
                                                        done
                                                            ? 'bg-brand-cyan/15 border-brand-cyan/30'
                                                            : isToday
                                                                ? 'bg-amber-400/10 border-amber-400/40'
                                                                : 'bg-white/[0.03] border-white/5'
                                                    } ${day === 7 ? 'ring-1 ring-amber-400/30' : ''}`}
                                                >
                                                    <span className="text-[8px] font-bold uppercase text-slate-500">{t('rewards.day')} {day}</span>
                                                    {done ? (
                                                        <i className="fa-solid fa-circle-check text-brand-cyan text-sm"></i>
                                                    ) : (
                                                        <span className="text-amber-300 text-[11px] font-black tabular-nums">+{coins}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <button
                                        onClick={claimCheckin}
                                        disabled={summary.checkinClaimedToday || claiming}
                                        className={`w-full mt-3 h-12 rounded-2xl font-black text-sm uppercase tracking-wide transition-all ${
                                            summary.checkinClaimedToday
                                                ? 'bg-white/5 text-slate-500'
                                                : 'bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 hover:opacity-90 active:scale-[0.99]'
                                        }`}
                                    >
                                        {claiming
                                            ? '...'
                                            : summary.checkinClaimedToday
                                                ? t('rewards.comeBackTomorrow')
                                                : `${t('rewards.claimCheckin')} +${CHECKIN_CALENDAR[summary.cycleDay - 1] ?? 5}`}
                                    </button>
                                </div>

                                {/* Recent activity */}
                                {summary.recent.length > 0 && (
                                    <div>
                                        <h4 className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 px-1">{t('rewards.recentTitle')}</h4>
                                        <div className="glass rounded-2xl border border-white/5 divide-y divide-white/5">
                                            {summary.recent.slice(0, 6).map((r, i) => (
                                                <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                                                    <span className="text-slate-300 text-xs font-semibold truncate mr-3">
                                                        {t(`rewards.rule.${r.rule}`) !== `rewards.rule.${r.rule}`
                                                            ? t(`rewards.rule.${r.rule}`)
                                                            : t('rewards.earned')}
                                                    </span>
                                                    <span className="text-[10px] font-black tabular-nums shrink-0">
                                                        {r.xp > 0 && <span className="text-brand-cyan mr-2">+{r.xp} XP</span>}
                                                        {r.coins !== 0 && (
                                                            <span className={r.coins > 0 ? 'text-amber-300' : 'text-red-400'}>
                                                                {r.coins > 0 ? '+' : ''}{r.coins} <i className="fa-solid fa-coins text-[9px]"></i>
                                                            </span>
                                                        )}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {tab === 'challenges' && (
                            <>
                                {/* Daily quests */}
                                <div>
                                    <h4 className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 px-1">{t('rewards.questsTitle')}</h4>
                                    <div className="space-y-2">
                                        {summary.quests.map((q) => {
                                            const complete = q.progress >= q.target;
                                            return (
                                                <div key={q.slot} className="glass rounded-2xl border border-white/5 p-3.5 flex items-center gap-3">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-white text-xs font-bold truncate">
                                                            {t(`rewards.quest.${q.rule}`)}{q.target > 1 ? ` ×${q.target}` : ''}
                                                        </p>
                                                        <div className="flex items-center gap-2 mt-1.5">
                                                            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                                <div
                                                                    className={`h-full rounded-full ${complete ? 'bg-brand-cyan' : 'bg-slate-500'}`}
                                                                    style={{ width: `${Math.round((q.progress / q.target) * 100)}%` }}
                                                                />
                                                            </div>
                                                            <span className="text-[9px] text-slate-500 font-bold tabular-nums">{q.progress}/{q.target}</span>
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => claimQuest(q.slot)}
                                                        disabled={q.claimed || !complete || claimingSlot !== null}
                                                        className={`h-8 px-3 rounded-lg text-[10px] font-black uppercase shrink-0 transition-colors ${
                                                            q.claimed
                                                                ? 'bg-white/5 text-slate-500'
                                                                : complete
                                                                    ? 'bg-amber-400 text-slate-900 hover:opacity-90'
                                                                    : 'bg-white/5 text-slate-500'
                                                        }`}
                                                    >
                                                        {q.claimed ? t('rewards.claimed') : `+${QUEST_COINS} `}
                                                        {!q.claimed && <i className="fa-solid fa-coins text-[9px]"></i>}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Collector's Journey */}
                                <div>
                                    <h4 className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-2 px-1">{t('rewards.journeyTitle')}</h4>
                                    <div className="glass rounded-2xl border border-white/5 divide-y divide-white/5">
                                        {summary.journey.map((s) => (
                                            <div key={s.key} className="px-4 py-2.5 flex items-center gap-3">
                                                <i className={`fa-solid ${s.done ? 'fa-circle-check text-brand-cyan' : 'fa-circle text-white/10'} text-sm shrink-0`}></i>
                                                <span className={`flex-1 text-xs font-semibold truncate ${s.done ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                                                    {t(`rewards.journey.${s.key}`)}
                                                </span>
                                                <span className="text-[9px] font-black text-slate-500 tabular-nums shrink-0">
                                                    +{s.xp} XP{s.coins > 0 ? ` · +${s.coins}` : ''}
                                                    {s.coins > 0 && <i className="fa-solid fa-coins text-[8px] ml-1 text-amber-400/70"></i>}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}

                        {tab === 'shop' && (
                            <div>
                                <p className="text-slate-500 text-[11px] font-semibold px-1 mb-3">{t('rewards.shopNote')}</p>
                                <div className="grid grid-cols-2 gap-2">
                                    {CATALOG.map((item) => (
                                        <div key={item.key} className="glass rounded-2xl border border-white/5 p-3.5 flex flex-col gap-2">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className="text-white text-xs font-bold leading-snug">{t(`rewards.item.${item.key}`)}</p>
                                                {!item.redeemable && (
                                                    <span className="text-[8px] font-black uppercase tracking-wide bg-white/5 text-slate-500 rounded-md px-1.5 py-0.5 shrink-0">
                                                        {t('rewards.shopSoon')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-auto">
                                                <i className="fa-solid fa-coins text-amber-400 text-[10px]"></i>
                                                <span className="text-amber-300 text-sm font-black tabular-nums">{item.coins.toLocaleString()}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default RewardsHub;
