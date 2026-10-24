'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, Coins, ExternalLink, Lock, RotateCcw, ShieldCheck, Tag, Truck, Users, Vibrate, Volume2, X, Zap } from 'lucide-react';
import { verifyDraw } from '@/lib/slabPacks/engine';
import { MARKET_FEE_RATE, PULL_MARKET_FEE_RATE, SHIP_DAYS, listingPayoutThb } from '@/lib/slabPacks/policy';
import { getSlab } from '@/lib/slabPacks/pool';
import { previewActions, tryTable, type PreviewSettings } from '@/lib/slabPacks/previewStore';
import { sfx } from '@/lib/slabPacks/sfx';
import { HIT_CLASSES, HIT_ORDER, TIERS, sellBackThb } from '@/lib/slabPacks/tiers';
import type { CardOdds, HitClass, PackTable, PackTier, Pull } from '@/lib/slabPacks/types';
import SlabCard from './SlabCard';
import { RankBadge, baht, classVars, gameLabel, tierVars, useSp } from './ui';

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

export function SheetHeader({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
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

export const pct = (n: number) => {
    const v = n * 100;
    if (v >= 10) return `${v.toFixed(0)}%`;
    if (v >= 1) return `${v.toFixed(1)}%`;
    if (v >= 0.1) return `${v.toFixed(2)}%`;
    // A single grail in a big table sits far below 0.01%: keep a visible digit.
    return `${v.toFixed(3)}%`;
};

/** "1 in 140" reads better than "0.71%" for the long shots. */
export const oneIn = (n: number) => (n > 0 ? `1 in ${Math.round(1 / n).toLocaleString('en-US')}` : '—');

/** The value band of a class in a tier, as money: "฿7,750 – ฿15,500". */
export const bandLabel = (cls: HitClass, tier: PackTier) =>
    `${baht(tier.priceThb * HIT_CLASSES[cls].min)} – ${baht(tier.priceThb * HIT_CLASSES[cls].max)}`;

const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;

export function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
    return (
        <div className="sp-card rounded-[18px] px-3 py-3">
            <div className="sp-label">{label}</div>
            <div className="sp-num mt-1 text-[19px] leading-none">{value}</div>
            <div className="mt-1 text-[10.5px] leading-tight text-white/45">{sub}</div>
        </div>
    );
}

// ── Odds & details ──────────────────────────────────────────────────────────

const CARD_LIST_LIMIT = 40;

export function OddsSheet({
    open, onClose, tier, table, onCard,
}: {
    open: boolean;
    onClose: () => void;
    tier: PackTier;
    table: PackTable;
    onCard: (c: CardOdds) => void;
}) {
    const { t, isThai } = useSp();
    const [showAll, setShowAll] = useState(false);
    useEffect(() => {
        if (!open) setShowAll(false);
    }, [open]);
    const shown = showAll ? table.cards : table.cards.slice(0, CARD_LIST_LIMIT);

    return (
        <Sheet open={open} onClose={onClose}>
            <SheetHeader title={t('odds.title', { tier: `${gameLabel(table.game, isThai)} ${tier.name}` })} sub={t('odds.sub')} onClose={onClose} />
            <div className="sp-scroll min-h-0 flex-1 px-5 pb-6" style={tierVars(tier)}>
                <div className="grid grid-cols-3 gap-2">
                    <Stat label={t('odds.avg')} value={baht(table.evThb)} sub={t('odds.avgSub', { pct: pct(table.evThb / tier.priceThb) })} />
                    <Stat label={t('odds.floor')} value={baht(table.floorThb)} sub={t('odds.floorSub')} />
                    <Stat label={t('odds.top')} value={baht(table.topThb)} sub={t('odds.topSub')} />
                </div>

                <div className="sp-label mt-6">{t('odds.byClass')}</div>
                <div className="mt-2 overflow-hidden rounded-[20px] border border-white/10">
                    {[...HIT_ORDER].reverse().map((cls, n) => (
                        <ClassRow key={cls} cls={cls} tier={tier} table={table} first={n === 0} />
                    ))}
                </div>
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-white/50">{t('odds.fixedNote')}</p>

                <div className="mt-6 flex items-end justify-between">
                    <span className="sp-label">{t('odds.everyCard')}</span>
                    <span className="text-[11px] text-white/45">{t('odds.cardCount', { n: table.cards.length })}</span>
                </div>
                <div className="mt-2 overflow-hidden rounded-[20px] border border-white/10">
                    {shown.map((c, n) => (
                        <CardRow key={c.slab.key} c={c} first={n === 0} onClick={() => onCard(c)} />
                    ))}
                </div>
                {!showAll && table.cards.length > CARD_LIST_LIMIT && (
                    <button
                        className="sp-btn sp-btn-ghost mt-2.5 h-[44px] w-full text-[13px]"
                        onClick={() => {
                            sfx.tap();
                            setShowAll(true);
                        }}
                    >
                        {t('odds.showAll', { n: table.cards.length - CARD_LIST_LIMIT })}
                    </button>
                )}

                <div className="sp-card mt-5 rounded-[20px] p-4">
                    <div className="flex items-center gap-2 text-[13px] font-extrabold">
                        <ShieldCheck size={16} className="text-emerald-400" />
                        {t('odds.fairTitle')}
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-white/60">{t('odds.fairBody')}</p>
                </div>

                <div className="sp-label mt-6">{t('odds.howTitle')}</div>
                <ol className="mt-2 grid gap-2">
                    {(['how1', 'how2', 'how3', 'how4'] as const).map((k, n) => (
                        <li key={k} className="flex gap-3 text-[12.5px] leading-relaxed text-white/70">
                            <span className="sp-num mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px]">
                                {n + 1}
                            </span>
                            <span>
                                {t(`odds.${k}`, {
                                    floor: pct(HIT_CLASSES.d.min),
                                    rate: pct(tier.sellBackRate),
                                    fee: pct(PULL_MARKET_FEE_RATE),
                                    stdFee: pct(MARKET_FEE_RATE),
                                    d1: SHIP_DAYS[0],
                                    d2: SHIP_DAYS[1],
                                })}
                            </span>
                        </li>
                    ))}
                </ol>
            </div>
        </Sheet>
    );
}

function ClassRow({ cls, tier, table, first }: { cls: HitClass; tier: PackTier; table: PackTable; first: boolean }) {
    const { t } = useSp();
    const def = HIT_CLASSES[cls];
    const c = table.byClass[cls];
    return (
        <div className={`flex items-center gap-3 px-3.5 py-3 ${first ? '' : 'border-t border-white/10'}`} style={classVars(cls)}>
            <RankBadge cls={cls} style={{ fontSize: 15 }} />
            <div className="min-w-0 flex-1">
                <div className="text-[13px] font-extrabold">{t(`class.${cls}`)}</div>
                <div className="mt-0.5 truncate text-[11.5px] text-white/55">{bandLabel(cls, tier)}</div>
            </div>
            <div className="shrink-0 text-right">
                <div className="sp-num text-[15px] leading-none" style={{ color: def.color }}>{pct(c.odds)}</div>
                <div className="mt-1 text-[10.5px] text-white/45">{oneIn(c.odds)}</div>
            </div>
        </div>
    );
}

function CardRow({ c, first, onClick }: { c: CardOdds; first: boolean; onClick: () => void }) {
    return (
        <button
            onClick={() => {
                sfx.tap();
                onClick();
            }}
            className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left ${first ? '' : 'border-t border-white/10'}`}
        >
            <RankBadge cls={c.cls} style={{ fontSize: 10 }} />
            <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-bold leading-tight">{c.slab.name}</div>
                <div className="truncate text-[10.5px] text-white/45">
                    {c.slab.setName} · PSA {c.slab.grade}
                </div>
            </div>
            <div className="shrink-0 text-right">
                <div className="sp-num text-[12.5px] leading-none">{baht(c.slab.valueThb)}</div>
                <div className="mt-0.5 text-[10px] text-white/45">{pct(c.odds)}</div>
            </div>
            <ChevronRight size={14} className="shrink-0 text-white/30" />
        </button>
    );
}

/** One card of the lobby's top-pulls strip: what it is worth, and the chance of it. Opens the card. */
export function TopPullCard({ c, tier, onClick }: { c: CardOdds; tier: PackTier; onClick: () => void }) {
    return (
        <button
            onClick={() => {
                sfx.tap();
                onClick();
            }}
            className="sp-mini w-[86px] shrink-0 text-left active:scale-95"
        >
            <div className="relative">
                <SlabCard slab={c.slab} tier={tier} art="small" flat foil={0.25} />
                <RankBadge cls={c.cls} className="absolute -left-1.5 -top-1.5" style={{ fontSize: 12 }} />
            </div>
            <div className="sp-num mt-1.5 truncate text-[13px] leading-none">{baht(c.slab.valueThb)}</div>
            <div className="mt-0.5 truncate text-[10px] text-white/50">{oneIn(c.odds)}</div>
        </button>
    );
}

// ── A card the pack can contain ─────────────────────────────────────────────

export function CardSheet({ card, tier, onClose }: { card: CardOdds | null; tier: PackTier; onClose: () => void }) {
    const { t, isThai } = useSp();
    const [shown, setShown] = useState<CardOdds | null>(card);
    useEffect(() => {
        if (card) setShown(card);
    }, [card]);
    const c = shown;

    return (
        <Sheet open={!!card} onClose={onClose}>
            {c && (
                <>
                    <div className="flex justify-end px-5">
                        <button onClick={onClose} aria-label={t('common.close')} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
                            <X size={18} strokeWidth={2.6} />
                        </button>
                    </div>
                    <div className="sp-scroll min-h-0 flex-1 px-5 pb-6">
                        <div className="mx-auto" style={{ width: 'min(56vw, 230px)' }}>
                            <SlabCard slab={c.slab} tier={tier} tilt foil={0.3 + HIT_CLASSES[c.cls].rank * 0.12} />
                        </div>
                        <div className="mt-5 flex items-center gap-2.5">
                            <RankBadge cls={c.cls} style={{ fontSize: 16 }} />
                            <span className="sp-display text-[18px]" style={{ color: HIT_CLASSES[c.cls].color }}>
                                {t(`class.${c.cls}`)}
                            </span>
                            <span className="sp-label ml-auto">{gameLabel(c.slab.game, isThai)} · {tier.name}</span>
                        </div>
                        <div className="mt-2 text-[20px] font-extrabold leading-tight">{c.slab.name}</div>
                        <div className="text-[12.5px] text-white/55">
                            {c.slab.setName} · PSA {c.slab.grade} · #{c.slab.number}
                        </div>
                        <div className="sp-num mt-2 text-[34px] leading-none">{baht(c.slab.valueThb)}</div>
                        <div className="sp-label mt-1.5">{t('stage.marketValue')}</div>

                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <Stat label={t('card.odds')} value={pct(c.odds)} sub={oneIn(c.odds)} />
                            <Stat label={t('card.band')} value={t(`class.${c.cls}`)} sub={bandLabel(c.cls, tier)} />
                        </div>
                        <p className="mt-3 text-[11.5px] leading-relaxed text-white/50">{t('card.note', { tier: tier.name, price: baht(tier.priceThb) })}</p>
                    </div>
                </>
            )}
        </Sheet>
    );
}

// ── A slab from the vault ───────────────────────────────────────────────────

export function SlabSheet({
    pull, onClose, onList, onShip,
}: {
    pull: Pull | null;
    onClose: () => void;
    onList: (pull: Pull) => void;
    onShip: (pull: Pull) => void;
}) {
    const { t, isThai } = useSp();
    // Hold the last pull so the sheet keeps its content while it slides away.
    const [shown, setShown] = useState<Pull | null>(pull);
    useEffect(() => {
        if (pull) setShown(pull);
    }, [pull]);

    const p = shown;
    const slab = p ? getSlab(p.slabKey) : undefined;
    const tier = p ? TIERS[p.tier] : null;
    // The check a buyer can run: the seed hashes to the commit shown before
    // the rip, and re-running the draw with it lands on this card.
    const verified = useMemo(() => {
        if (!p || !slab || p.id.startsWith('demo-')) return null;
        const table = tryTable(slab.game, p.tier);
        return table ? verifyDraw(table, p.proof.seed, p.proof.clientSeed, p.proof.commit, p.slabKey) : null;
    }, [p, slab]);
    const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(isThai ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short' });
    const inCollection = p && (p.status === 'vault' || p.status === 'listed' || p.status === 'shipping');

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
                            <span className="sp-label ml-auto">{gameLabel(slab.game, isThai)} · {tier.name}</span>
                        </div>
                        <div className="mt-2 text-[20px] font-extrabold leading-tight">{slab.name}</div>
                        <div className="text-[12.5px] text-white/55">
                            {slab.setName} · PSA {slab.grade} · #{slab.number}
                        </div>
                        <div className="sp-num mt-2 text-[34px] leading-none">{baht(slab.valueThb)}</div>
                        <div className="sp-label mt-1.5">{t('stage.marketValue')}</div>

                        {inCollection && (
                            <Link
                                href="/?tab=vault"
                                className="sp-card mt-4 flex items-center gap-2.5 rounded-2xl p-3 text-[12px] text-white/70"
                            >
                                <Check size={15} className="shrink-0 text-emerald-400" strokeWidth={3} />
                                <span className="min-w-0 flex-1">{t('vault.inCollection')}</span>
                                <span className="flex shrink-0 items-center gap-1 font-bold text-white/85">
                                    {t('vault.openCollection')}
                                    <ExternalLink size={12} />
                                </span>
                            </Link>
                        )}

                        {p.status === 'vault' && (
                            <>
                                <div className="mt-4 grid grid-cols-2 gap-3">
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
                                        className="sp-btn sp-btn-primary h-[54px] px-2 text-[15px]"
                                        onClick={() => {
                                            sfx.tap();
                                            onList(p);
                                        }}
                                    >
                                        <Tag size={17} strokeWidth={2.4} />
                                        {t('vault.list')}
                                    </button>
                                </div>
                                <div className="mt-2 text-center text-[11px] text-white/45">
                                    {t('vault.listFeeNote', { fee: pct(PULL_MARKET_FEE_RATE), std: pct(MARKET_FEE_RATE) })}
                                </div>
                                {/* The terms, fee and timing come step by step inside the flow, not here. */}
                                <button
                                    className="sp-btn sp-btn-ghost mt-3 h-[50px] w-full justify-between px-4 text-[14px]"
                                    onClick={() => {
                                        sfx.tap();
                                        onShip(p);
                                    }}
                                >
                                    <span className="flex items-center gap-2">
                                        <Truck size={16} />
                                        {t('vault.ship')}
                                    </span>
                                    <ChevronRight size={16} className="text-white/50" />
                                </button>
                            </>
                        )}
                        {p.status === 'listed' && p.listPriceThb != null && (
                            <>
                                <div className="sp-card mt-4 rounded-2xl p-3.5 text-[12.5px] text-white/70">
                                    <div className="flex items-center gap-2 font-extrabold text-white">
                                        <Tag size={15} style={{ color: tier.theme.glow }} />
                                        {t('vault.listedAt', { price: baht(p.listPriceThb) })}
                                    </div>
                                    <div className="mt-1">
                                        {t('vault.listedPayout', { payout: baht(listingPayoutThb(p.listPriceThb)), fee: pct(PULL_MARKET_FEE_RATE) })}
                                    </div>
                                    <div className="mt-1 text-white/50">{t('vault.listedShipNote')}</div>
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-3">
                                    <button
                                        className="sp-btn sp-btn-sell h-[50px] px-2 text-[14px]"
                                        onClick={() => {
                                            previewActions.sell([p.id]);
                                            sfx.coins();
                                            onClose();
                                        }}
                                    >
                                        <Coins size={16} strokeWidth={2.6} />
                                        {t('stage.sell')} {baht(sellBackThb(slab.valueThb, tier))}
                                    </button>
                                    <button
                                        className="sp-btn sp-btn-ghost h-[50px] px-2 text-[14px]"
                                        onClick={() => {
                                            previewActions.unlist(p.id);
                                            sfx.tap();
                                        }}
                                    >
                                        {t('vault.unlist')}
                                    </button>
                                </div>
                            </>
                        )}
                        {p.status === 'shipping' && p.shipRequestedAt != null && (
                            <div className="sp-card mt-4 flex items-start gap-2.5 rounded-2xl p-3.5 text-[12.5px] text-white/70">
                                <Truck size={16} className="mt-0.5 shrink-0" style={{ color: tier.theme.glow }} />
                                <div className="min-w-0">
                                    <div className="font-extrabold text-white">{t('vault.shippingTitle')}</div>
                                    <div className="mt-0.5">
                                        {t('vault.shippingWindow', {
                                            from: fmtDate(p.shipRequestedAt + SHIP_DAYS[0] * 86_400_000),
                                            to: fmtDate(p.shipRequestedAt + SHIP_DAYS[1] * 86_400_000),
                                        })}
                                    </div>
                                    {p.shipTo && <div className="mt-0.5 truncate text-white/50">{p.shipTo.name} · {p.shipTo.address}</div>}
                                    <div className="mt-0.5 text-white/50">
                                        {t('vault.shippingFeePaid', { fee: baht(p.shipFeeThb ?? 0) })}
                                        {p.shipInsuredThb ? ` · ${t('vault.insured')}` : ''}
                                    </div>
                                </div>
                            </div>
                        )}
                        {p.status === 'sold' && (
                            <div className="sp-card mt-4 rounded-2xl p-3.5 text-[12.5px] text-white/70">
                                {t('vault.soldNote', { amount: baht(p.soldForThb ?? 0) })}
                            </div>
                        )}

                        {verified !== null && (
                            <div className="mt-4 rounded-2xl bg-black/40 p-3.5">
                                <div className="flex items-center gap-2 text-[12px] font-extrabold">
                                    <Lock size={13} className="text-white/60" />
                                    {t('proof.title')}
                                    <span className={`ml-auto flex items-center gap-1 ${verified ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {verified && <Check size={13} strokeWidth={3} />}
                                        {verified ? t('proof.verified') : t('proof.mismatch')}
                                    </span>
                                </div>
                                <div className="mt-2 grid gap-1 text-[10.5px]">
                                    <div className="flex gap-2">
                                        <span className="w-14 shrink-0 text-white/45">{t('proof.commit')}</span>
                                        <code className="truncate font-mono text-white/75">{shortHash(p.proof.commit)}</code>
                                    </div>
                                    <div className="flex gap-2">
                                        <span className="w-14 shrink-0 text-white/45">{t('proof.seed')}</span>
                                        <code className="truncate font-mono text-white/75">{shortHash(p.proof.seed)}</code>
                                    </div>
                                </div>
                                <p className="mt-2 text-[10.5px] leading-snug text-white/45">{t('proof.body')}</p>
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
    open, onClose, settings,
}: {
    open: boolean;
    onClose: () => void;
    settings: PreviewSettings;
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
