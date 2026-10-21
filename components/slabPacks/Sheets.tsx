'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Coins, Gift, Lock, RotateCcw, ShieldCheck, Truck, Users, Vibrate, Volume2, X, Zap } from 'lucide-react';
import { verifyCommit, type ChaseEntry } from '@/lib/slabPacks/engine';
import { getSlab } from '@/lib/slabPacks/pool';
import { TOP_UP_THB, previewActions, type PreviewSettings, type SealedRecord } from '@/lib/slabPacks/previewStore';
import { sfx } from '@/lib/slabPacks/sfx';
import { HIT_CLASSES, HIT_ORDER, LAST_PACK_BONUS_CLASS, TIERS, sellBackThb } from '@/lib/slabPacks/tiers';
import type { HitClass, PackTier, Pull, SeriesState, SeriesSummary } from '@/lib/slabPacks/types';
import SlabCard from './SlabCard';
import { RankBadge, baht, classVars, tierVars, useSp } from './ui';

/**
 * Bottom sheets. Open and closed are a CSS transition on a data attribute,
 * not a mount/unmount with an exit animation: a sheet whose removal waits on
 * an animation frame can be left stranded over the page when the tab is
 * throttled, and these sit over the buy button.
 */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
    // Keep the content mounted through the closing slide, then drop it.
    const [rendered, setRendered] = useState(open);
    useEffect(() => {
        if (open) {
            setRendered(true);
            return;
        }
        const id = setTimeout(() => setRendered(false), 400);
        return () => clearTimeout(id);
    }, [open]);

    return (
        <>
            <div className="sp-scrim" data-open={open} onClick={onClose} />
            <div className="sp-sheet" data-open={open} role="dialog" aria-modal="true" aria-hidden={!open} inert={!open}>
                <div className="sp-grab" />
                {rendered && children}
            </div>
        </>
    );
}

function SheetHeader({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
    const { t } = useSp();
    return (
        <div className="flex items-start gap-3 px-5 pb-3 pt-1">
            <div className="min-w-0 flex-1">
                <div className="sp-display text-[26px]">{title}</div>
                {sub && <div className="mt-1 text-[12px] text-white/55">{sub}</div>}
            </div>
            <button
                onClick={onClose}
                aria-label={t('common.close')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10"
            >
                <X size={18} strokeWidth={2.6} />
            </button>
        </div>
    );
}

// ── Odds & details ──────────────────────────────────────────────────────────

const pct = (n: number) => {
    const v = n * 100;
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;
};

const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;

export function OddsSheet({
    open, onClose, tier, series, summary, sealed,
}: {
    open: boolean;
    onClose: () => void;
    tier: PackTier;
    series: SeriesState;
    summary: SeriesSummary;
    sealed: SealedRecord[];
}) {
    const { t } = useSp();
    const bonus = series.bonusKey ? getSlab(series.bonusKey) : undefined;
    const past = sealed.filter((s) => s.tier === tier.key).slice(0, 3);

    return (
        <Sheet open={open} onClose={onClose}>
            <SheetHeader
                title={t('odds.title', { tier: tier.name })}
                sub={t('odds.sub', { n: series.number, left: summary.left, total: summary.total })}
                onClose={onClose}
            />
            <div className="sp-scroll min-h-0 flex-1 px-5 pb-6" style={tierVars(tier)}>
                <div className="grid grid-cols-3 gap-2">
                    <Stat label={t('odds.avg')} value={baht(summary.evAllThb)} sub={t('odds.avgSub', { pct: pct(summary.evAllThb / tier.priceThb) })} />
                    <Stat label={t('odds.floor')} value={baht(summary.floorThb)} sub={t('odds.floorSub')} />
                    <Stat label={t('odds.sellBack')} value={pct(tier.sellBackRate)} sub={t('odds.sellBackSub')} />
                </div>

                <div className="sp-label mt-6">{t('odds.stillSealed')}</div>
                <div className="mt-2 overflow-hidden rounded-[20px] border border-white/10">
                    {[...HIT_ORDER].reverse().map((cls, n) => (
                        <ClassRow key={cls} cls={cls} tier={tier} summary={summary} first={n === 0} />
                    ))}
                </div>
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-white/50">{t('odds.liveNote')}</p>

                {bonus && (
                    <div className="sp-card mt-5 flex items-center gap-3.5 rounded-[20px] p-3.5">
                        <div className="w-[58px] shrink-0">
                            <SlabCard slab={bonus} tier={tier} art="small" flat foil={0.2} />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-[13px] font-extrabold">
                                <Gift size={15} style={{ color: tier.theme.glow }} />
                                {t('odds.bonusTitle')}
                            </div>
                            <div className="mt-1 text-[12px] leading-snug text-white/60">
                                {t('odds.bonusBody', { name: bonus.name, grade: bonus.grade, value: baht(bonus.valueThb) })}
                            </div>
                        </div>
                    </div>
                )}

                <div className="sp-card mt-5 rounded-[20px] p-4">
                    <div className="flex items-center gap-2 text-[13px] font-extrabold">
                        <ShieldCheck size={16} className="text-emerald-400" />
                        {t('odds.fairTitle')}
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-white/60">{t('odds.fairBody')}</p>
                    <div className="mt-3 flex items-center gap-2 rounded-xl bg-black/40 px-3 py-2.5">
                        <Lock size={13} className="shrink-0 text-white/50" />
                        <span className="sp-label shrink-0">{t('odds.seal')}</span>
                        <code className="ml-auto truncate font-mono text-[11px] text-white/80">{shortHash(series.commit)}</code>
                    </div>
                    {past.map((rec) => (
                        <PastSeries key={`${rec.tier}-${rec.number}`} rec={rec} />
                    ))}
                </div>

                <div className="sp-label mt-6">{t('odds.howTitle')}</div>
                <ol className="mt-2 grid gap-2">
                    {(['how1', 'how2', 'how3', 'how4'] as const).map((k, n) => (
                        <li key={k} className="flex gap-3 text-[12.5px] leading-relaxed text-white/70">
                            <span className="sp-num mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px]">
                                {n + 1}
                            </span>
                            <span>{t(`odds.${k}`, { floor: pct(HIT_CLASSES.d.min), rate: pct(tier.sellBackRate), bonus: HIT_CLASSES[LAST_PACK_BONUS_CLASS].letter })}</span>
                        </li>
                    ))}
                </ol>
            </div>
        </Sheet>
    );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
    return (
        <div className="sp-card rounded-[18px] px-3 py-3">
            <div className="sp-label">{label}</div>
            <div className="sp-num mt-1 text-[19px] leading-none">{value}</div>
            <div className="mt-1 text-[10.5px] leading-tight text-white/45">{sub}</div>
        </div>
    );
}

function ClassRow({ cls, tier, summary, first }: { cls: HitClass; tier: PackTier; summary: SeriesSummary; first: boolean }) {
    const { t } = useSp();
    const def = HIT_CLASSES[cls];
    const c = summary.byClass[cls];
    const gone = c.left === 0;
    return (
        <div
            className={`flex items-center gap-3 px-3.5 py-3 ${first ? '' : 'border-t border-white/10'}`}
            style={{ ...classVars(cls), opacity: gone ? 0.42 : 1 }}
        >
            <RankBadge cls={cls} style={{ fontSize: 15 }} />
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-extrabold">{t(`class.${cls}`)}</span>
                    <span className="truncate text-[11px] text-white/50">
                        {baht(tier.priceThb * def.min)}–{baht(tier.priceThb * def.max)}
                    </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${c.total ? (c.left / c.total) * 100 : 0}%`, background: `linear-gradient(90deg, ${def.color2}, ${def.color})` }}
                    />
                </div>
            </div>
            <div className="shrink-0 text-right">
                <div className="sp-num text-[15px] leading-none" style={{ color: gone ? undefined : def.color }}>
                    {gone ? t('odds.gone') : pct(summary.oddsNext[cls])}
                </div>
                <div className="mt-1 text-[10.5px] text-white/45">{t('odds.leftOf', { left: c.left, total: c.total })}</div>
            </div>
        </div>
    );
}

function PastSeries({ rec }: { rec: SealedRecord }) {
    const { t } = useSp();
    // Recompute the commit from the now-public seed: this is the check a
    // buyer can run themselves once a series has sold out.
    const ok = useMemo(() => verifyCommit(rec.seed, rec.manifest, rec.bonusKey, rec.commit), [rec]);
    return (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-black/40 px-3 py-2.5 text-[11px]">
            <span className="font-bold text-white/80">{t('odds.pastSeries', { n: rec.number })}</span>
            <code className="truncate font-mono text-white/45">{rec.seed.slice(0, 12)}…</code>
            <span className={`ml-auto flex shrink-0 items-center gap-1 font-bold ${ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                {ok && <Check size={13} strokeWidth={3} />}
                {ok ? t('odds.verified') : t('odds.mismatch')}
            </span>
        </div>
    );
}

// ── A slab from the vault ───────────────────────────────────────────────────

export function SlabSheet({ pull, onClose }: { pull: Pull | null; onClose: () => void }) {
    const { t } = useSp();
    // Hold the last pull so the sheet keeps its content while it slides away.
    const [shown, setShown] = useState<Pull | null>(pull);
    useEffect(() => {
        if (pull) setShown(pull);
    }, [pull]);

    const p = shown;
    const slab = p ? getSlab(p.slabKey) : undefined;
    const tier = p ? TIERS[p.tier] : null;

    return (
        <Sheet open={!!pull} onClose={onClose}>
            {p && slab && tier && (
                <>
                    <div className="flex justify-end px-5">
                        <button onClick={onClose} aria-label={t('common.close')} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
                            <X size={18} strokeWidth={2.6} />
                        </button>
                    </div>
                    <div className="sp-scroll min-h-0 flex-1 px-5 pb-6">
                        <div className="mx-auto" style={{ width: 'min(56vw, 230px)' }}>
                            <SlabCard slab={slab} tier={tier} tilt foil={0.3 + HIT_CLASSES[p.cls].rank * 0.12} />
                        </div>
                        <div className="mt-5 flex items-center gap-2.5">
                            <RankBadge cls={p.cls} style={{ fontSize: 16 }} />
                            <span className="sp-display text-[18px]" style={{ color: HIT_CLASSES[p.cls].color }}>
                                {t(`class.${p.cls}`)}
                            </span>
                            <span className="sp-label ml-auto">
                                {tier.name} · {t('common.series', { n: p.series })}
                            </span>
                        </div>
                        <div className="mt-2 text-[20px] font-extrabold leading-tight">{slab.name}</div>
                        <div className="text-[12.5px] text-white/55">
                            {slab.setName} · PSA {slab.grade} · #{slab.number}
                        </div>
                        <div className="sp-num mt-2 text-[34px] leading-none">{baht(slab.valueThb)}</div>
                        <div className="sp-label mt-1.5">{t('stage.marketValue')}</div>

                        {p.status === 'vault' && (
                            <div className="mt-5 grid grid-cols-2 gap-3">
                                <button
                                    className="sp-btn sp-btn-sell h-[54px] px-2 text-[15px]"
                                    onClick={() => {
                                        previewActions.sell([p.id]);
                                        sfx.coins();
                                        onClose();
                                    }}
                                >
                                    <Coins size={17} strokeWidth={2.6} />
                                    <span>
                                        {t('stage.sell')} {baht(sellBackThb(slab.valueThb, tier))}
                                    </span>
                                </button>
                                <button
                                    className="sp-btn sp-btn-ghost h-[54px] px-2 text-[15px]"
                                    onClick={() => {
                                        previewActions.requestShipping(p.id);
                                        sfx.keep();
                                        onClose();
                                    }}
                                >
                                    <Truck size={17} />
                                    {t('vault.ship')}
                                </button>
                            </div>
                        )}
                        {p.status === 'shipping' && (
                            <div className="sp-card mt-5 flex items-center gap-2.5 rounded-2xl p-3.5 text-[12.5px] text-white/70">
                                <Truck size={16} className="shrink-0" style={{ color: tier.theme.glow }} />
                                {t('vault.shippingNote')}
                            </div>
                        )}
                        {p.status === 'sold' && (
                            <div className="sp-card mt-5 rounded-2xl p-3.5 text-[12.5px] text-white/70">
                                {t('vault.soldNote', { amount: baht(p.soldForThb ?? 0) })}
                            </div>
                        )}
                    </div>
                </>
            )}
        </Sheet>
    );
}

// ── Preview menu ────────────────────────────────────────────────────────────

export function PreviewMenu({
    open, onClose, settings, credits,
}: {
    open: boolean;
    onClose: () => void;
    settings: PreviewSettings;
    credits: number;
}) {
    const { t } = useSp();
    const [confirmReset, setConfirmReset] = useState(false);
    useEffect(() => {
        if (!open) setConfirmReset(false);
    }, [open]);

    const toggles: { key: keyof PreviewSettings; icon: React.ReactNode; label: string; hint: string }[] = [
        { key: 'sound', icon: <Volume2 size={17} />, label: t('menu.sound'), hint: t('menu.soundHint') },
        { key: 'haptics', icon: <Vibrate size={17} />, label: t('menu.haptics'), hint: t('menu.hapticsHint') },
        { key: 'fast', icon: <Zap size={17} />, label: t('menu.fast'), hint: t('menu.fastHint') },
        { key: 'activity', icon: <Users size={17} />, label: t('menu.activity'), hint: t('menu.activityHint') },
    ];

    return (
        <Sheet open={open} onClose={onClose}>
            <SheetHeader title={t('menu.title')} onClose={onClose} />
            <div className="sp-scroll min-h-0 flex-1 px-5 pb-6">
                <div className="rounded-[20px] border border-amber-300/30 bg-amber-300/10 p-4 text-[12.5px] leading-relaxed text-amber-100">
                    <div className="mb-1 font-extrabold uppercase tracking-wider text-amber-300">{t('menu.previewTitle')}</div>
                    {t('menu.previewBody')}
                </div>

                <div className="sp-card mt-4 flex items-center gap-3 rounded-[20px] p-4">
                    <div className="min-w-0 flex-1">
                        <div className="sp-label">{t('menu.credits')}</div>
                        <div className="sp-num mt-1 text-[26px] leading-none">{baht(credits)}</div>
                    </div>
                    <button
                        className="sp-btn sp-btn-sell h-[46px] px-4 text-[14px]"
                        onClick={() => {
                            previewActions.addCredits(TOP_UP_THB);
                            sfx.coins();
                        }}
                    >
                        + {baht(TOP_UP_THB)}
                    </button>
                </div>

                <div className="mt-4 overflow-hidden rounded-[20px] border border-white/10">
                    {toggles.map((row, n) => {
                        const on = settings[row.key];
                        return (
                            <button
                                key={row.key}
                                role="switch"
                                aria-checked={on}
                                onClick={() => {
                                    previewActions.setSetting(row.key, !on);
                                    // The sound toggle should be heard as it comes back on.
                                    if (row.key === 'sound') sfx.setEnabled(!on);
                                    sfx.tap();
                                }}
                                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left ${n ? 'border-t border-white/10' : ''}`}
                            >
                                <span className="text-white/70">{row.icon}</span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[14px] font-bold">{row.label}</span>
                                    <span className="block text-[11.5px] leading-snug text-white/50">{row.hint}</span>
                                </span>
                                <span
                                    className="relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors duration-200"
                                    style={{ background: on ? '#34D399' : 'rgba(255,255,255,0.16)' }}
                                >
                                    <span
                                        className="absolute top-[3px] h-5 w-5 rounded-full bg-white transition-all duration-200"
                                        style={{ left: on ? 23 : 3 }}
                                    />
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Each sound on its own, so one can be judged without pulling the hit that plays it. */}
                <div className="sp-label mt-5">{t('menu.soundCheck')}</div>
                <p className="mt-1 text-[11.5px] leading-snug text-white/50">{t('menu.soundCheckHint')}</p>
                <div className="mt-2.5 grid grid-cols-3 gap-2">
                    {SOUND_CHECK.map((s) => (
                        <button
                            key={s.id}
                            className="sp-card sp-mini flex h-11 items-center justify-center gap-1.5 rounded-[14px] px-1 text-[12px] font-bold active:scale-95"
                            onClick={() => {
                                sfx.unlock();
                                s.play();
                            }}
                        >
                            {s.cls ? <RankBadge cls={s.cls} style={{ fontSize: 10 }} /> : null}
                            <span className="truncate">{s.cls ? t(`class.${s.cls}`) : t(`menu.sounds.${s.id}`)}</span>
                        </button>
                    ))}
                </div>

                <button
                    className="sp-btn sp-btn-ghost mt-5 h-[50px] w-full text-[14px]"
                    onClick={() => {
                        if (!confirmReset) {
                            setConfirmReset(true);
                            sfx.tap();
                            return;
                        }
                        previewActions.reset();
                        sfx.whooshOut();
                        onClose();
                    }}
                >
                    <RotateCcw size={16} />
                    {confirmReset ? t('menu.resetConfirm') : t('menu.reset')}
                </button>
            </div>
        </Sheet>
    );
}

// The sound-check board: the physical sounds first, then the full
// tell-flip-reveal run for each hit class.
const SOUND_CHECK: { id: string; cls?: HitClass; play: () => void }[] = [
    { id: 'rip', play: () => sfx.playRip() },
    { id: 'packIn', play: () => sfx.packIn() },
    { id: 'rise', play: () => sfx.rise() },
    { id: 'slab', play: () => sfx.slabTap(1) },
    { id: 'coins', play: () => sfx.coins() },
    { id: 'keep', play: () => sfx.keep() },
    ...HIT_ORDER.map((cls) => ({ id: cls, cls, play: () => sfx.playTell(HIT_CLASSES[cls].rank) })),
];

/** One row of the chase board, as a small card. Shared by the lobby strip. */
export function ChaseCard({ entry, tier }: { entry: ChaseEntry; tier: PackTier }) {
    const { t } = useSp();
    return (
        <div className="w-[86px] shrink-0">
            <div className="relative">
                <div style={{ opacity: entry.claimed ? 0.32 : 1, filter: entry.claimed ? 'grayscale(0.9)' : undefined }}>
                    <SlabCard slab={entry.slab} tier={tier} art="small" flat foil={0.25} />
                </div>
                <RankBadge cls={entry.cls} className="absolute -left-1.5 -top-1.5" style={{ fontSize: 12 }} />
                {entry.claimed && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="-rotate-12 rounded-md border border-white/40 bg-black/70 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
                            {t('lobby.claimed')}
                        </span>
                    </div>
                )}
            </div>
            <div className="sp-num mt-1.5 truncate text-[13px] leading-none" style={{ opacity: entry.claimed ? 0.45 : 1 }}>
                {baht(entry.slab.valueThb)}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-white/50">
                {entry.claim ? (entry.claim.me ? t('common.you') : entry.claim.who) : entry.slab.name}
            </div>
        </div>
    );
}
