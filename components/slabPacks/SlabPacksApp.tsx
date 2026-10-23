'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { MotionGlobalConfig, animate, motion, useMotionValue, useTransform, type MotionValue } from 'framer-motion';
import { Activity, ChevronLeft, ChevronRight, Coins, CreditCard, Minus, Package, Plus, Vault, Wallet } from 'lucide-react';
import { useToast } from '@/lib/contexts/ToastContext';
import { readDebug, type SlabPacksDebug } from '@/lib/slabPacks/debug';
import { topPulls } from '@/lib/slabPacks/engine';
import { haptics } from '@/lib/slabPacks/haptics';
import { coinsForThb, type VerificationKind } from '@/lib/slabPacks/policy';
import { getSlab } from '@/lib/slabPacks/pool';
import { getTable, previewActions, usePreviewState, type PaymentMethod } from '@/lib/slabPacks/previewStore';
import { sfx } from '@/lib/slabPacks/sfx';
import { HIT_CLASSES, HIT_ORDER, TIER_ORDER, TIERS } from '@/lib/slabPacks/tiers';
import type { CardOdds, FeedEvent, PackTable, Pull, TierKey } from '@/lib/slabPacks/types';
import { ListSheet, ShipSheet, VerifySheet, WalletSheet } from './MoneySheets';
import OpeningStage, { type OpeningSession } from './OpeningStage';
import PackArt from './PackArt';
import { PullsScreen, VaultScreen } from './Screens';
import { OddsSheet, PreviewMenu, SlabSheet, TopPullCard, pct } from './Sheets';
import { RankBadge, baht, tierVars, usePrefersReducedMotion, useSp, useTween } from './ui';

/**
 * Slab Packs — the app shell: lobby, vault, pull feed, and the opening stage
 * that mounts over all three. Mobile-first: a single 480px column, centred on
 * anything wider.
 *
 * Reads everything from the preview store (lib/slabPacks/previewStore.ts);
 * see that file for what is real and what is stand-in.
 */

type Tab = 'packs' | 'vault' | 'pulls';
const QUANTITIES = [1, 3, 5, 10];
const SPRING = { type: 'spring' as const, stiffness: 260, damping: 30 };

export default function SlabPacksApp() {
    const state = usePreviewState();
    const { t, isThai } = useSp();
    const { showToast } = useToast();
    const prefersReduced = usePrefersReducedMotion();
    const [debug, setDebug] = useState<SlabPacksDebug | null>(null);
    const reduced = prefersReduced || !!debug?.still;

    const [tab, setTab] = useState<Tab>('packs');
    const [tierKey, setTierKey] = useState<TierKey>('spark');
    const [qty, setQty] = useState(1);
    const [method, setMethod] = useState<PaymentMethod>('card');
    const [session, setSession] = useState<OpeningSession | null>(null);
    const [oddsOpen, setOddsOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [walletOpen, setWalletOpen] = useState(false);
    const [slabPull, setSlabPull] = useState<Pull | null>(null);
    const [listPull, setListPull] = useState<Pull | null>(null);
    const [shipPull, setShipPull] = useState<Pull | null>(null);
    const [verifyKind, setVerifyKind] = useState<VerificationKind | null>(null);

    const tier = TIERS[tierKey];

    useEffect(() => {
        setDebug(readDebug());
        previewActions.hydrate();
    }, []);

    // Reduced motion means poses change without travelling. The switch is
    // global to framer-motion, so it is handed back when this screen unmounts.
    useEffect(() => {
        MotionGlobalConfig.skipAnimations = reduced;
        return () => {
            MotionGlobalConfig.skipAnimations = false;
        };
    }, [reduced]);

    // Development only: /packs?demo=nova:ss opens straight onto a chosen pull.
    const demoStarted = useRef(false);
    useEffect(() => {
        if (!state.hydrated || !debug?.demo || demoStarted.current) return;
        demoStarted.current = true;
        setTierKey(debug.demo.tierKey);
        setSession({ id: 'demo', tierKey: debug.demo.tierKey, pulls: debug.demo.pulls, packless: false, method: 'card' });
    }, [state.hydrated, debug]);

    useEffect(() => {
        sfx.setEnabled(state.settings.sound);
        haptics.setEnabled(state.settings.haptics);
    }, [state.settings.sound, state.settings.haptics]);

    // Simulated collectors keep pulling while the app is on screen.
    useEffect(() => {
        if (!state.hydrated) return;
        const id = setInterval(() => {
            if (document.visibilityState === 'visible') previewActions.tick();
        }, 3500);
        return () => clearInterval(id);
    }, [state.hydrated]);

    const table = useMemo(() => getTable(tierKey), [tierKey]);
    const chase = useMemo(() => topPulls(table, 8), [table]);

    // A method the balance cannot cover falls back to the card, which never
    // runs out: the pack is paid for at purchase, like any order.
    const total = qty * tier.priceThb;
    const effectiveMethod: PaymentMethod =
        method === 'wallet' && state.walletThb < total ? 'card'
            : method === 'coins' && state.coins < coinsForThb(total) ? 'card'
                : method;

    const openPacks = useCallback(
        (key: TierKey, count: number, pay: PaymentMethod) => {
            sfx.unlock();
            const res = previewActions.buy(key, count, pay);
            if (!res.ok) {
                sfx.deny();
                haptics.deny();
                if (res.reason === 'wallet') {
                    showToast(t('lobby.needWallet'), 'error');
                    setWalletOpen(true);
                } else if (res.reason === 'coins') {
                    showToast(t('lobby.needCoins'), 'error');
                }
                return;
            }
            sfx.buy();
            haptics.tap();
            setOddsOpen(false);
            setSession({ id: `${key}-${Date.now()}`, tierKey: key, pulls: res.pulls, packless: false, method: pay });
        },
        [showToast, t],
    );

    // Slabs bought but never flipped (the app was closed mid-opening) resume
    // from the vault, one tier at a time, with no pack to tear.
    const resumeUnrevealed = useCallback(() => {
        const first = state.pulls.find((p) => p.status === 'unrevealed');
        if (!first) return;
        sfx.unlock();
        sfx.tap();
        const pulls = state.pulls.filter((p) => p.status === 'unrevealed' && p.tier === first.tier).reverse();
        setSession({ id: `resume-${Date.now()}`, tierKey: first.tier, pulls, packless: true, method: 'card' });
    }, [state.pulls]);

    // Android's back button and the iOS back swipe should close what is on
    // top (a sheet, the opening) rather than leave the feature. One history
    // entry stands for "something is open": back pops it and we close; closing
    // from the UI takes the entry back out so it cannot be replayed.
    const overlayOpen = !!session || oddsOpen || menuOpen || walletOpen || !!slabPull || !!listPull || !!shipPull || !!verifyKind;
    const historyEntry = useRef(false);
    useEffect(() => {
        if (overlayOpen && !historyEntry.current) {
            try {
                // Keep the router's own state keys; add ours beside them.
                window.history.pushState({ ...(window.history.state ?? {}), spOverlay: true }, '');
                historyEntry.current = true;
            } catch {
                // No history access: the on-screen close buttons still work.
            }
        } else if (!overlayOpen && historyEntry.current) {
            historyEntry.current = false;
            if (window.history.state?.spOverlay) window.history.back();
        }
    }, [overlayOpen]);
    useEffect(() => {
        const onPop = () => {
            if (!historyEntry.current) return;
            historyEntry.current = false;
            setOddsOpen(false);
            setMenuOpen(false);
            setWalletOpen(false);
            setSlabPull(null);
            setListPull(null);
            setShipPull(null);
            setVerifyKind(null);
            setSession(null);
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    const unrevealedCount = state.pulls.filter((p) => p.status === 'unrevealed').length;
    const shownSlabPull = slabPull ? state.pulls.find((p) => p.id === slabPull.id) ?? null : null;

    return (
        <div
            className={`sp-root theme-dark-locked ${isThai ? 'sp-th' : ''}`}
            style={tierVars(tier)}
            onPointerDown={() => sfx.unlock()}
        >
            <div className="sp-ambient" aria-hidden>
                {TIER_ORDER.map((key) => (
                    <div key={key} className="sp-ambient-layer" data-on={key === tierKey} style={tierVars(TIERS[key])} />
                ))}
                <div className="sp-ambient-grain" />
                <div className="sp-ambient-vignette" />
            </div>

            <div className="relative mx-auto flex h-full w-full max-w-[480px] flex-col overflow-hidden">
                {!state.hydrated ? (
                    <div className="flex h-full items-center justify-center">
                        <div className="sp-display sp-breathe text-[22px] text-white/70">{t('common.loading')}</div>
                    </div>
                ) : (
                    <>
                        {tab === 'packs' && (
                            <Lobby
                                tierKey={tierKey}
                                onTier={(key) => {
                                    if (key === tierKey) return;
                                    sfx.swipe(TIER_ORDER.indexOf(key) > TIER_ORDER.indexOf(tierKey));
                                    haptics.tap();
                                    setTierKey(key);
                                }}
                                table={table}
                                chase={chase}
                                feed={state.feed}
                                walletThb={state.walletThb}
                                coins={state.coins}
                                reduced={reduced}
                                qty={qty}
                                onQty={(n) => {
                                    sfx.tap();
                                    setQty(n);
                                }}
                                method={effectiveMethod}
                                onMethod={(m) => {
                                    sfx.tap();
                                    setMethod(m);
                                }}
                                onRip={() => openPacks(tierKey, qty, effectiveMethod)}
                                onOdds={() => {
                                    sfx.sheet(true);
                                    setOddsOpen(true);
                                }}
                                onMenu={() => {
                                    sfx.sheet(true);
                                    setMenuOpen(true);
                                }}
                                onWallet={() => {
                                    sfx.sheet(true);
                                    setWalletOpen(true);
                                }}
                                onFeed={() => setTab('pulls')}
                                simulated={state.settings.activity}
                            />
                        )}
                        {tab === 'vault' && (
                            <VaultScreen
                                pulls={state.pulls}
                                onOpenSlab={setSlabPull}
                                onResume={resumeUnrevealed}
                                onGoPacks={() => setTab('packs')}
                            />
                        )}
                        {tab === 'pulls' && (
                            <PullsScreen feed={state.feed} pulls={state.pulls} stats={state.stats} simulated={state.settings.activity} />
                        )}

                        <TabBar
                            tab={tab}
                            badge={unrevealedCount}
                            onTab={(next) => {
                                if (next === tab) return;
                                sfx.tap();
                                haptics.tap();
                                setTab(next);
                            }}
                        />

                        {session && (
                            <OpeningStage
                                key={session.id}
                                session={session}
                                credits={state.walletThb}
                                fast={state.settings.fast}
                                reduced={reduced}
                                sound={state.settings.sound}
                                onClose={() => setSession(null)}
                                onRipAgain={(count) => openPacks(session.tierKey, count, session.method)}
                                autoRip={!!debug?.auto}
                            />
                        )}

                        <OddsSheet
                            open={oddsOpen}
                            onClose={() => {
                                sfx.sheet(false);
                                setOddsOpen(false);
                            }}
                            tier={tier}
                            table={table}
                        />
                        <SlabSheet
                            pull={shownSlabPull}
                            onClose={() => setSlabPull(null)}
                            onList={(p) => {
                                setSlabPull(null);
                                setListPull(p);
                            }}
                            onShip={(p) => {
                                setSlabPull(null);
                                setShipPull(p);
                            }}
                        />
                        <ListSheet pull={listPull} onClose={() => setListPull(null)} />
                        <ShipSheet pull={shipPull} onClose={() => setShipPull(null)} state={state} onVerify={setVerifyKind} />
                        <WalletSheet
                            open={walletOpen}
                            onClose={() => {
                                sfx.sheet(false);
                                setWalletOpen(false);
                            }}
                            state={state}
                            onVerify={setVerifyKind}
                        />
                        <VerifySheet kind={verifyKind} onClose={() => setVerifyKind(null)} />
                        <PreviewMenu
                            open={menuOpen}
                            onClose={() => {
                                sfx.sheet(false);
                                setMenuOpen(false);
                            }}
                            settings={state.settings}
                        />
                    </>
                )}
            </div>
        </div>
    );
}

// ── Lobby ───────────────────────────────────────────────────────────────────

interface LobbyProps {
    tierKey: TierKey;
    onTier: (key: TierKey) => void;
    table: PackTable;
    chase: CardOdds[];
    feed: FeedEvent[];
    walletThb: number;
    coins: number;
    reduced: boolean;
    qty: number;
    onQty: (n: number) => void;
    method: PaymentMethod;
    onMethod: (m: PaymentMethod) => void;
    onRip: () => void;
    onOdds: () => void;
    onMenu: () => void;
    onWallet: () => void;
    onFeed: () => void;
    simulated: boolean;
}

function Lobby({
    tierKey, onTier, table, chase, feed, walletThb, coins, reduced, qty, onQty, method, onMethod, onRip, onOdds, onMenu, onWallet, onFeed, simulated,
}: LobbyProps) {
    const { t } = useSp();
    const tier = TIERS[tierKey];
    const shownWallet = useTween(walletThb, reduced ? 0 : 600);
    const qtyIndex = QUANTITIES.indexOf(qty);
    const nextQty = QUANTITIES[qtyIndex + 1];
    const prevQty = QUANTITIES[qtyIndex - 1];
    const total = qty * tier.priceThb;
    const coinsNeeded = coinsForThb(total);

    const methods: { id: PaymentMethod; label: string; icon: React.ReactNode; ok: boolean }[] = [
        { id: 'card', label: t('lobby.payCard'), icon: <CreditCard size={13} />, ok: true },
        { id: 'wallet', label: t('lobby.payWallet', { amount: baht(walletThb) }), icon: <Wallet size={13} />, ok: walletThb >= total },
        { id: 'coins', label: t('lobby.payCoins', { n: coins.toLocaleString('en-US') }), icon: <Coins size={13} />, ok: coins >= coinsNeeded },
    ];

    return (
        <div className="flex h-full flex-col" style={{ paddingTop: 'var(--sat)' }}>
            {/* Header */}
            <div className="flex items-center gap-2 px-4 pb-2 pt-3">
                <Link
                    href="/"
                    aria-label={t('common.back')}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 active:scale-90"
                >
                    <ChevronLeft size={21} strokeWidth={2.6} />
                </Link>
                <button onClick={onMenu} className="sp-mini min-w-0 flex-1 text-left">
                    <div className="sp-display truncate text-[21px]">{t('lobby.title')}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="shrink-0 rounded bg-amber-300 px-1.5 py-px text-[9px] font-black uppercase tracking-wider text-black">
                            {t('lobby.preview')}
                        </span>
                        <span className="truncate text-[10.5px] text-white/45">{t('lobby.previewNote')}</span>
                    </div>
                </button>
                {/* The wallet: sell-back credit and coins, cash-out behind it. No top-up. */}
                <button
                    onClick={onWallet}
                    aria-label={t('wallet.title')}
                    className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-white/10 px-3.5"
                >
                    <Wallet size={15} className="text-amber-300" />
                    <span className="sp-num text-[14px]">{baht(shownWallet)}</span>
                </button>
            </div>

            <Ticker feed={feed} onOpen={onFeed} simulated={simulated} />

            <div className="sp-scroll min-h-0 flex-1" style={{ paddingBottom: 'calc(var(--sab) + 212px)' }}>
                <Carousel tierKey={tierKey} onTier={onTier} subtitle={t('pack.subtitle')} />

                {/* Name and price */}
                <div className="flex items-end justify-between gap-3 px-5">
                    <div
                        key={tierKey}
                        className="sp-display sp-pop-in min-w-0 origin-left bg-clip-text text-[46px] text-transparent"
                        style={{ backgroundImage: `linear-gradient(180deg, #fff 30%, ${tier.theme.a})` }}
                    >
                        {tier.name}
                    </div>
                    <div className="shrink-0 pb-[3px] text-right">
                        <div className="sp-num text-[27px] leading-none">{baht(tier.priceThb)}</div>
                        <div className="sp-label mt-1">{t('lobby.perPack')}</div>
                    </div>
                </div>

                {/* The pack in one line: what it returns on average and what it can reach. Opens the odds. */}
                <div className="px-5">
                    <button onClick={onOdds} className="sp-card sp-mini mt-3 flex h-11 w-full items-center gap-2 rounded-full pl-4 pr-2.5 text-left">
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-white/55">
                            {t('lobby.avgPill', { pct: pct(table.evThb / tier.priceThb) })}
                            <span className="mx-1.5 text-white/25">·</span>
                            {t('lobby.topPill', { amount: baht(table.topThb) })}
                        </span>
                        <span className="sp-mini shrink-0 text-[11.5px] font-bold text-white/70">{t('lobby.oddsCta')}</span>
                        <ChevronRight size={16} className="shrink-0 text-white/50" />
                    </button>
                </div>

                {/* Top pulls: the dearest cards this pack can hold, each with its chance */}
                <div className="mt-4 flex items-center justify-between px-5">
                    <span className="sp-label">{t('lobby.topPulls')}</span>
                    <span className="text-[11px] text-white/45">{t('lobby.floor', { amount: baht(table.floorThb) })}</span>
                </div>
                <div className="sp-strip mt-2 gap-3 px-5 pb-2 pt-2">
                    {chase.map((c) => (
                        <TopPullCard key={c.slab.key} c={c} tier={tier} />
                    ))}
                </div>

                {/* What a pack can be, class by class. Fixed: the same before and after every pull. */}
                <div className="mt-5 px-5">
                    <div className="flex items-center justify-between">
                        <span className="sp-label">{t('lobby.nextPack')}</span>
                        <button onClick={onOdds} className="sp-mini flex items-center text-[11.5px] font-bold text-white/70">
                            {t('lobby.oddsCta')}
                            <ChevronRight size={14} />
                        </button>
                    </div>
                    <div className="mt-2.5 grid grid-cols-3 gap-2">
                        {HIT_ORDER.slice().reverse().map((cls) => (
                            <button key={cls} onClick={onOdds} className="sp-card sp-mini rounded-[18px] px-3 py-2.5 text-left">
                                <div className="flex items-center justify-between">
                                    <RankBadge cls={cls} style={{ fontSize: 13 }} />
                                    <span className="text-[10.5px] text-white/50">{t('odds.cardsShort', { n: table.byClass[cls].cards })}</span>
                                </div>
                                <div className="sp-num mt-2 text-[18px] leading-none" style={{ color: HIT_CLASSES[cls].color }}>
                                    {pct(table.byClass[cls].odds)}
                                </div>
                                <div className="mt-1 truncate text-[10px] text-white/45">{t(`class.${cls}`)}</div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Buy dock */}
            <div className="absolute inset-x-0 z-30 px-4" style={{ bottom: 'calc(var(--sab) + 82px)' }}>
                {/* How the pack is paid for: card by default, wallet credit or coins when they cover it. */}
                <div className="mb-2 flex gap-1.5">
                    {methods.map((m) => {
                        const on = method === m.id;
                        return (
                            <button
                                key={m.id}
                                disabled={!m.ok}
                                onClick={() => onMethod(m.id)}
                                aria-pressed={on}
                                className="sp-mini flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full border px-2 text-[11px] font-extrabold transition-colors disabled:opacity-35"
                                style={{
                                    background: on ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.45)',
                                    color: on ? '#000' : 'rgba(255,255,255,0.75)',
                                    borderColor: on ? 'transparent' : 'rgba(255,255,255,0.12)',
                                }}
                            >
                                {m.icon}
                                <span className="truncate">{m.label}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="sp-panel flex items-center gap-2 rounded-[26px] p-2">
                    {/* How many packs: steps through 1, 3, 5, 10. */}
                    <div className="flex h-[60px] shrink-0 items-center rounded-[20px] bg-white/[0.07] px-0.5">
                        <button
                            className="sp-mini flex h-[52px] w-8 items-center justify-center rounded-full text-white/80 disabled:opacity-25"
                            aria-label={t('lobby.fewer')}
                            disabled={prevQty === undefined}
                            onClick={() => prevQty !== undefined && onQty(prevQty)}
                        >
                            <Minus size={17} strokeWidth={3} />
                        </button>
                        <div className="w-[38px] text-center">
                            <div className="sp-num text-[20px] leading-none">×{qty}</div>
                            <div className="mt-1 truncate text-[8.5px] font-extrabold uppercase tracking-wider text-white/45">{t('lobby.packs')}</div>
                        </div>
                        <button
                            className="sp-mini flex h-[52px] w-8 items-center justify-center rounded-full text-white/80 disabled:opacity-25"
                            aria-label={t('lobby.more')}
                            disabled={nextQty === undefined}
                            onClick={() => nextQty !== undefined && onQty(nextQty)}
                        >
                            <Plus size={17} strokeWidth={3} />
                        </button>
                    </div>
                    <button className="sp-btn sp-btn-primary h-[60px] min-w-0 flex-1 justify-between gap-2 px-3.5" onClick={onRip}>
                        <span className="sp-display truncate text-[clamp(17px,5.5vw,22px)]">{t('lobby.rip')}</span>
                        <span className="sp-num shrink-0 text-[clamp(15px,4.7vw,19px)]">
                            {method === 'coins' ? t('lobby.coinsAmount', { n: coinsNeeded.toLocaleString('en-US') }) : baht(total)}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Ticker ──────────────────────────────────────────────────────────────────

function Ticker({ feed, onOpen, simulated }: { feed: FeedEvent[]; onOpen: () => void; simulated: boolean }) {
    const { t } = useSp();
    const [n, setN] = useState(0);
    const newest = feed[0]?.id;

    useEffect(() => {
        const id = setInterval(() => setN((v) => v + 1), 3200);
        return () => clearInterval(id);
    }, []);
    // A fresh pull jumps the queue.
    useEffect(() => setN(0), [newest]);

    const shown = feed.length ? feed[n % Math.min(feed.length, 8)] : null;
    const slab = shown ? getSlab(shown.slabKey) : undefined;

    return (
        <button onClick={onOpen} className="sp-card mx-4 flex h-10 shrink-0 items-center gap-2.5 overflow-hidden rounded-full px-3.5 text-left">
            <span className="sp-live-dot shrink-0" />
            {shown && slab ? (
                <span key={`${shown.id}-${n}`} className="sp-ticker-item flex min-w-0 flex-1 items-center gap-1.5 text-[12px]">
                    <span className="shrink-0 font-extrabold">{shown.me ? t('common.you') : shown.who}</span>
                    <span className="shrink-0 text-white/45">{t('feed.pulled')}</span>
                    <span className="min-w-0 truncate font-semibold text-white/90">{slab.name}</span>
                    <span
                        className="ml-auto shrink-0 rounded-full px-1.5 py-px text-[9px] font-black uppercase tracking-wider"
                        style={{ background: `${TIERS[shown.tier].theme.glow}26`, color: TIERS[shown.tier].theme.glow }}
                    >
                        {TIERS[shown.tier].name}
                    </span>
                    <RankBadge cls={shown.cls} className="shrink-0" style={{ fontSize: 10 }} />
                    <span className="sp-num shrink-0 text-[12.5px]" style={{ color: HIT_CLASSES[shown.cls].color }}>
                        {baht(slab.valueThb)}
                    </span>
                </span>
            ) : (
                <span className="text-[12px] text-white/45">{simulated ? t('feed.waiting') : t('feed.quiet')}</span>
            )}
        </button>
    );
}

// ── Pack carousel ───────────────────────────────────────────────────────────

function Carousel({ tierKey, onTier, subtitle }: { tierKey: TierKey; onTier: (key: TierKey) => void; subtitle: string }) {
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const x = useMotionValue(0);
    const index = TIER_ORDER.indexOf(tierKey);
    // True from the start of a drag until just after it ends, so the click
    // that follows a drag is not read as a tap on a pack.
    const dragged = useRef(false);

    useLayoutEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const packH = Math.max(0, size.h - 44);
    const packW = Math.min(packH * 0.64, size.w * 0.52);
    // Distance between pack centres: the neighbours peek in from both sides.
    const gap = Math.max(1, size.w * 0.5);
    const travel = (TIER_ORDER.length - 1) * gap;

    useEffect(() => {
        if (!size.w) return;
        const controls = animate(x, -index * gap, SPRING);
        return () => controls.stop();
    }, [index, gap, size.w, x]);

    return (
        <div ref={wrapRef} className="relative mt-1 w-full" style={{ height: 'clamp(184px, 31dvh, 300px)', perspective: 1100 }}>
            {/* Pool of light the active pack stands in */}
            <div
                className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-[50%]"
                style={{
                    bottom: 6, width: packW * 1.25, height: 26,
                    background: 'radial-gradient(closest-side, var(--sp-glow), transparent)', opacity: 0.4, filter: 'blur(6px)',
                }}
            />
            {size.w > 0 && (
                // The track is wider than the screen by its full travel on both
                // sides, so wherever it has been dragged to, the whole visible
                // strip is still track and a swipe that starts between two
                // packs is still a swipe.
                <motion.div
                    className="absolute inset-y-0"
                    style={{ left: -travel, right: -travel, x, transformStyle: 'preserve-3d', touchAction: 'pan-y' }}
                    drag="x"
                    dragDirectionLock
                    dragConstraints={{ left: -travel, right: 0 }}
                    dragElastic={0.14}
                    onDragStart={() => {
                        dragged.current = true;
                    }}
                    // Taps are resolved here, by position, rather than on each
                    // pack: a neighbour is turned in 3D, and the half of it
                    // that swings behind the track's plane cannot be hit.
                    onClick={(e) => {
                        const box = wrapRef.current?.getBoundingClientRect();
                        if (dragged.current || !box) return;
                        const i = Math.round((e.clientX - (box.left + box.width / 2) - x.get()) / gap);
                        if (i !== index && i >= 0 && i < TIER_ORDER.length) onTier(TIER_ORDER[i]);
                    }}
                    onDragEnd={(_, info) => {
                        setTimeout(() => {
                            dragged.current = false;
                        }, 60);
                        const projected = x.get() + info.velocity.x * 0.18;
                        const target = Math.max(0, Math.min(TIER_ORDER.length - 1, Math.round(-projected / gap)));
                        if (target === index) animate(x, -index * gap, SPRING);
                        else onTier(TIER_ORDER[target]);
                    }}
                >
                    {TIER_ORDER.map((key, i) => (
                        <CarouselPack
                            key={key}
                            i={i}
                            x={x}
                            gap={gap}
                            width={packW}
                            active={i === index}
                            label={TIERS[key].name}
                            onPick={() => onTier(key)}
                        >
                            <PackArt tier={TIERS[key]} subtitle={subtitle} />
                        </CarouselPack>
                    ))}
                </motion.div>
            )}
        </div>
    );
}

function CarouselPack({
    i, x, gap, width, active, label, onPick, children,
}: {
    i: number;
    x: MotionValue<number>;
    gap: number;
    width: number;
    active: boolean;
    label: string;
    onPick: () => void;
    children: React.ReactNode;
}) {
    // 0 when this pack is centred, +/-1 one slot away.
    const d = useTransform(x, (v) => (v + i * gap) / gap);
    const scale = useTransform(d, (v) => 1 - Math.min(Math.abs(v), 1.5) * 0.26);
    const rotateY = useTransform(d, (v) => Math.max(-1.2, Math.min(1.2, v)) * -34);
    const opacity = useTransform(d, (v) => 1 - Math.min(Math.abs(v), 1.7) * 0.46);
    const zIndex = useTransform(d, (v) => 10 - Math.round(Math.abs(v) * 2));

    return (
        <motion.div
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-current={active ? 'true' : undefined}
            className="sp-mini absolute bottom-[26px] cursor-pointer outline-none"
            style={{ left: '50%', marginLeft: i * gap - width / 2, width, scale, rotateY, opacity, zIndex }}
            // Keyboard only: pointer taps are handled by the track (see above).
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPick();
                }
            }}
        >
            <div className={active ? 'sp-float' : ''}>{children}</div>
        </motion.div>
    );
}

// ── Tab bar ─────────────────────────────────────────────────────────────────

function TabBar({ tab, badge, onTab }: { tab: Tab; badge: number; onTab: (t: Tab) => void }) {
    const { t } = useSp();
    const items: { id: Tab; label: string; icon: React.ReactNode }[] = [
        { id: 'packs', label: t('tabs.packs'), icon: <Package size={20} strokeWidth={2.3} /> },
        { id: 'vault', label: t('tabs.vault'), icon: <Vault size={20} strokeWidth={2.3} /> },
        { id: 'pulls', label: t('tabs.pulls'), icon: <Activity size={20} strokeWidth={2.3} /> },
    ];
    return (
        <nav className="absolute inset-x-0 bottom-0 z-40 px-4" style={{ paddingBottom: 'calc(var(--sab) + 12px)' }}>
            <div className="sp-panel grid h-[60px] grid-cols-3 rounded-[24px] p-1.5">
                {items.map((item) => {
                    const on = tab === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => onTab(item.id)}
                            aria-current={on ? 'page' : undefined}
                            className="relative flex items-center justify-center gap-2 rounded-[18px] text-[12.5px] font-extrabold transition-colors duration-200"
                            style={{
                                background: on ? 'color-mix(in srgb, var(--sp-glow) 18%, transparent)' : 'transparent',
                                color: on ? 'var(--sp-glow)' : 'rgba(255,255,255,0.5)',
                            }}
                        >
                            {item.icon}
                            <span>{item.label}</span>
                            {item.id === 'vault' && badge > 0 && (
                                <span className="sp-num absolute right-3 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10.5px] text-white">
                                    {badge}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
