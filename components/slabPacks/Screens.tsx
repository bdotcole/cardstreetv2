'use client';

import React, { useMemo, useState } from 'react';
import { PackageOpen, Truck } from 'lucide-react';
import { getSlab, slabImage } from '@/lib/slabPacks/pool';
import type { PreviewStats } from '@/lib/slabPacks/previewStore';
import { sfx } from '@/lib/slabPacks/sfx';
import { HIT_CLASSES, TIERS } from '@/lib/slabPacks/tiers';
import type { FeedEvent, Pull } from '@/lib/slabPacks/types';
import SlabCard from './SlabCard';
import { RankBadge, baht, timeAgo, useNow, useSp } from './ui';

/** Two-way switch used at the top of the Vault and Pulls screens. */
function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
    return (
        <div className="flex rounded-full border border-white/10 bg-white/5 p-1">
            {options.map((o) => (
                <button
                    key={o.id}
                    onClick={() => {
                        sfx.tap();
                        onChange(o.id);
                    }}
                    className={`h-9 flex-1 rounded-full px-3 text-[12px] font-extrabold transition-colors ${value === o.id ? 'bg-white text-black' : 'text-white/60'}`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

function ScreenHeader({ title, right }: { title: string; right?: React.ReactNode }) {
    return (
        <div className="flex items-end justify-between gap-3 px-5 pb-3 pt-4">
            <h1 className="sp-display text-[34px]">{title}</h1>
            {right}
        </div>
    );
}

// ── Vault ───────────────────────────────────────────────────────────────────

export function VaultScreen({
    pulls, onOpenSlab, onResume, onGoPacks,
}: {
    pulls: Pull[];
    onOpenSlab: (pull: Pull) => void;
    onResume: () => void;
    onGoPacks: () => void;
}) {
    const { t } = useSp();
    const [view, setView] = useState<'holding' | 'sold'>('holding');

    const { holding, sold, unrevealed, value } = useMemo(() => {
        const byValue = (a: Pull, b: Pull) => (getSlab(b.slabKey)?.valueThb ?? 0) - (getSlab(a.slabKey)?.valueThb ?? 0);
        const h = pulls.filter((p) => p.status === 'vault' || p.status === 'shipping').sort(byValue);
        return {
            holding: h,
            sold: pulls.filter((p) => p.status === 'sold'),
            unrevealed: pulls.filter((p) => p.status === 'unrevealed'),
            value: h.reduce((sum, p) => sum + (getSlab(p.slabKey)?.valueThb ?? 0), 0),
        };
    }, [pulls]);

    const list = view === 'holding' ? holding : sold;

    return (
        <div className="flex h-full flex-col" style={{ paddingTop: 'var(--sat)' }}>
            <ScreenHeader
                title={t('vault.title')}
                right={
                    <div className="pb-1 text-right">
                        <div className="sp-num text-[22px] leading-none">{baht(value)}</div>
                        <div className="sp-label mt-1">{t('vault.count', { n: holding.length })}</div>
                    </div>
                }
            />
            <div className="px-5">
                <Segmented<'holding' | 'sold'>
                    value={view}
                    onChange={setView}
                    options={[
                        { id: 'holding', label: `${t('vault.holding')} · ${holding.length}` },
                        { id: 'sold', label: `${t('vault.sold')} · ${sold.length}` },
                    ]}
                />
            </div>

            <div className="sp-scroll mt-4 min-h-0 flex-1 px-5" style={{ paddingBottom: 'calc(var(--sab) + 100px)' }}>
                {unrevealed.length > 0 && view === 'holding' && (
                    <button onClick={onResume} className="sp-btn sp-btn-primary mb-4 h-[58px] w-full justify-between px-5 text-[15px]">
                        <span className="flex items-center gap-2.5">
                            <PackageOpen size={19} strokeWidth={2.4} />
                            {t('vault.unrevealed', { n: unrevealed.length })}
                        </span>
                        <span className="sp-display text-[16px]">{t('vault.reveal')}</span>
                    </button>
                )}

                {list.length === 0 ? (
                    <div className="flex flex-col items-center px-6 pt-14 text-center">
                        <div className="flex h-20 w-20 items-center justify-center rounded-[26px] bg-white/5">
                            <PackageOpen size={34} className="text-white/40" />
                        </div>
                        <div className="sp-display mt-5 text-[22px]">{view === 'holding' ? t('vault.emptyTitle') : t('vault.emptySoldTitle')}</div>
                        <p className="mt-2 text-[13px] leading-relaxed text-white/55">
                            {view === 'holding' ? t('vault.emptyBody') : t('vault.emptySoldBody')}
                        </p>
                        {view === 'holding' && unrevealed.length === 0 && (
                            <button onClick={onGoPacks} className="sp-btn sp-btn-primary mt-6 h-[52px] px-7 text-[16px]">
                                <span className="sp-display">{t('vault.emptyCta')}</span>
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-3 gap-x-3 gap-y-5">
                        {list.map((p) => {
                            const slab = getSlab(p.slabKey);
                            if (!slab) return null;
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => {
                                        sfx.tap();
                                        onOpenSlab(p);
                                    }}
                                    className="text-left"
                                >
                                    <div className="relative" style={{ opacity: p.status === 'sold' ? 0.5 : 1 }}>
                                        <SlabCard slab={slab} tier={TIERS[p.tier]} art="small" flat foil={0.2} />
                                        <RankBadge cls={p.cls} className="absolute -left-1.5 -top-1.5" style={{ fontSize: 12 }} />
                                        {p.status === 'shipping' && (
                                            <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-black">
                                                <Truck size={13} strokeWidth={2.6} />
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1.5 truncate text-[11px] font-bold leading-tight">{slab.name}</div>
                                    <div className="sp-num text-[13px] leading-tight">
                                        {p.status === 'sold' ? baht(p.soldForThb ?? 0) : baht(slab.valueThb)}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Pulls ───────────────────────────────────────────────────────────────────

function PullRow({ slabKey, cls, who, tierName, at, now, note }: {
    slabKey: string; cls: Pull['cls']; who: string; tierName: string; at: number; now: number; note?: string;
}) {
    const slab = getSlab(slabKey);
    if (!slab) return null;
    const def = HIT_CLASSES[cls];
    return (
        <div className="flex items-center gap-3 py-2.5">
            <div
                className="h-[52px] w-[38px] shrink-0 overflow-hidden rounded-md bg-white/5"
                style={{ boxShadow: `0 0 0 1.5px ${def.color}55, 0 6px 14px -6px ${def.color}` }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slabImage(slab, 'small')} alt="" loading="lazy" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold leading-tight">{slab.name}</div>
                <div className="mt-0.5 truncate text-[11px] text-white/50">
                    {who} · {tierName} · PSA {slab.grade}
                    {note ? ` · ${note}` : ''}
                </div>
            </div>
            <div className="shrink-0 text-right">
                <div className="flex items-center justify-end gap-1.5">
                    <RankBadge cls={cls} style={{ fontSize: 11 }} />
                    <span className="sp-num text-[14px] leading-none">{baht(slab.valueThb)}</span>
                </div>
                <div className="mt-1 text-[10.5px] text-white/40">{now ? timeAgo(at, now) : ''}</div>
            </div>
        </div>
    );
}

export function PullsScreen({
    feed, pulls, stats, simulated,
}: {
    feed: FeedEvent[];
    pulls: Pull[];
    stats: PreviewStats;
    simulated: boolean;
}) {
    const { t } = useSp();
    const [view, setView] = useState<'live' | 'mine'>('live');
    const now = useNow(10_000);
    const mine = useMemo(() => pulls.filter((p) => p.status !== 'unrevealed'), [pulls]);
    const best = useMemo(
        () => mine.reduce<Pull | null>((b, p) => ((getSlab(p.slabKey)?.valueThb ?? 0) > (b ? getSlab(b.slabKey)?.valueThb ?? 0 : 0) ? p : b), null),
        [mine],
    );
    const bestSlab = best ? getSlab(best.slabKey) : undefined;

    return (
        <div className="flex h-full flex-col" style={{ paddingTop: 'var(--sat)' }}>
            <ScreenHeader
                title={t('pulls.title')}
                right={
                    view === 'live' ? (
                        <div className="flex items-center gap-2 pb-2">
                            <span className="sp-live-dot" />
                            <span className="sp-label">{simulated ? t('pulls.simulated') : t('pulls.live')}</span>
                        </div>
                    ) : undefined
                }
            />
            <div className="px-5">
                <Segmented<'live' | 'mine'>
                    value={view}
                    onChange={setView}
                    options={[
                        { id: 'live', label: t('pulls.live') },
                        { id: 'mine', label: t('pulls.mine') },
                    ]}
                />
            </div>

            <div className="sp-scroll mt-3 min-h-0 flex-1 px-5" style={{ paddingBottom: 'calc(var(--sab) + 100px)' }}>
                {view === 'live' && (
                    <div className="divide-y divide-white/10">
                        {feed.map((e) => (
                            <PullRow
                                key={e.id}
                                slabKey={e.slabKey}
                                cls={e.cls}
                                who={e.me ? t('common.you') : e.who}
                                tierName={TIERS[e.tier].name}
                                at={e.at}
                                now={now}
                                note={e.bonus ? t('pulls.bonus') : undefined}
                            />
                        ))}
                        {feed.length === 0 && <p className="py-12 text-center text-[13px] text-white/50">{t('pulls.emptyLive')}</p>}
                    </div>
                )}

                {view === 'mine' && (
                    <>
                        <div className="grid grid-cols-2 gap-2.5">
                            <Tile label={t('pulls.statPacks')} value={stats.packs.toLocaleString('en-US')} />
                            <Tile label={t('pulls.statSpent')} value={baht(stats.spentThb)} />
                            <Tile label={t('pulls.statPulled')} value={baht(stats.pulledThb)} />
                            <Tile label={t('pulls.statSold')} value={baht(stats.soldBackThb)} />
                        </div>
                        {best && bestSlab && (
                            <div className="sp-card mt-2.5 flex items-center gap-3.5 rounded-[20px] p-3.5">
                                <div className="w-[52px] shrink-0">
                                    <SlabCard slab={bestSlab} tier={TIERS[best.tier]} art="small" flat foil={0.3} />
                                </div>
                                <div className="min-w-0">
                                    <div className="sp-label">{t('pulls.best')}</div>
                                    <div className="mt-1 truncate text-[14px] font-extrabold">{bestSlab.name}</div>
                                    <div className="sp-num text-[18px] leading-tight" style={{ color: HIT_CLASSES[best.cls].color }}>
                                        {baht(bestSlab.valueThb)}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="mt-3 divide-y divide-white/10">
                            {mine.map((p) => (
                                <PullRow
                                    key={p.id}
                                    slabKey={p.slabKey}
                                    cls={p.cls}
                                    who={t(`pulls.status.${p.status}`)}
                                    tierName={TIERS[p.tier].name}
                                    at={p.at}
                                    now={now}
                                    note={p.bonus ? t('pulls.bonus') : undefined}
                                />
                            ))}
                            {mine.length === 0 && <p className="py-12 text-center text-[13px] text-white/50">{t('pulls.emptyMine')}</p>}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function Tile({ label, value }: { label: string; value: string }) {
    return (
        <div className="sp-card rounded-[18px] px-3.5 py-3">
            <div className="sp-label">{label}</div>
            <div className="sp-num mt-1 text-[20px] leading-none">{value}</div>
        </div>
    );
}
