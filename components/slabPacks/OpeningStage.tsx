'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Coins, FastForward, Volume2, VolumeX, X } from 'lucide-react';
import { haptics } from '@/lib/slabPacks/haptics';
import { getSlab, slabImage } from '@/lib/slabPacks/pool';
import { previewActions } from '@/lib/slabPacks/previewStore';
import { sfx, type ChargeHandle, type TearHandle } from '@/lib/slabPacks/sfx';
import type { PaymentMethod } from '@/lib/slabPacks/previewStore';
import { HIT_CLASSES, HIT_ORDER, TIERS, sellBackThb } from '@/lib/slabPacks/tiers';
import type { HitClass, Pull, TierKey } from '@/lib/slabPacks/types';
import FxCanvas, { type FxHandle } from './FxCanvas';
import { PACK_CLIP, PackFace, TEAR_Y } from './PackArt';
import SlabCard from './SlabCard';
import { CountUp, RankBadge, baht, tierVars, useSp, useTween } from './ui';

/**
 * The opening: one sealed pack, a cut across the top, and a slab that turns
 * over. Everything in the feature exists to get someone to this screen, so
 * this is where the craft goes.
 *
 * The beats, for one slab:
 *
 *   present   the pack drops onto the stage
 *   ready     it waits; a dashed line shows where to cut
 *   tearing   a finger drags a line of light across the seal (or a tap does
 *             it for them) — the buyer's own hand opens the pack
 *   burst     the seal comes away, light spills out
 *   rise      the slab lifts out face-down and the pack falls away
 *   charge    the "tell": the glow starts steel-grey and climbs one hit class
 *             at a time up to the slab's real class. The longer it keeps
 *             climbing, the bigger the pull — you know before you see
 *   flip      a beat of dark, then the slab turns over
 *   revealed  class stamp, value counts up, keep or sell
 *
 * The slab was drawn and committed to when the pack was bought
 * (lib/slabPacks/engine.ts) and is already owned by the time this screen
 * mounts; the sequence is theatre over a result that cannot change, and it
 * can be skipped at any point.
 */

export interface OpeningSession {
    id: string;
    tierKey: TierKey;
    pulls: Pull[];
    /** Resuming unrevealed slabs from the vault: no pack to tear. */
    packless: boolean;
    /** How these packs were paid for; "rip again" pays the same way. */
    method: PaymentMethod;
}

type Phase = 'present' | 'ready' | 'tearing' | 'burst' | 'rise' | 'charge' | 'flip' | 'revealed' | 'leaving' | 'summary';

const STEP_MS = 430;
const CHARGE_LEAD_MS = 520;
const CHARGE_TAIL_MS = 300;
const RAINBOW = ['#ff5fa2', '#ffd166', '#7dffcb', '#7dd3fc', '#c084fc', '#ffffff'];
// Share of the pack's width the cut must cover before it gives.
const TEAR_SPAN = 0.8;
// Dust in the stage light: [left %, size px, seconds to rise, delay s, sideways drift px, opacity].
const MOTES: [number, number, number, number, number, number][] = [
    [8, 3, 13, 0, 26, 0.5], [19, 2, 17, 4, -18, 0.4], [29, 4, 15, 8, 30, 0.35], [41, 2, 19, 2, -24, 0.45],
    [52, 3, 14, 10, 16, 0.4], [63, 2, 18, 6, -30, 0.5], [72, 4, 16, 1, 22, 0.3], [83, 2, 20, 12, -14, 0.45],
    [91, 3, 15, 5, -26, 0.4], [36, 2, 22, 14, 18, 0.35], [58, 3, 21, 16, -20, 0.3], [14, 2, 23, 9, 14, 0.4],
];

interface Props {
    session: OpeningSession;
    /** Wallet credit, for the chip the sell-back coins fly to. */
    credits: number;
    fast: boolean;
    reduced: boolean;
    sound: boolean;
    onClose: () => void;
    onRipAgain: (count: number) => void;
    /** Development only: cut the pack open without a gesture. */
    autoRip?: boolean;
}

export default function OpeningStage({ session, credits, fast, reduced, sound, onClose, onRipAgain, autoRip }: Props) {
    const { t } = useSp();
    const tier = TIERS[session.tierKey];
    const pulls = session.pulls;
    const quick = fast || reduced;

    const [i, setI] = useState(0);
    const [phase, setPhase] = useState<Phase>(session.packless ? 'rise' : 'present');
    const [step, setStep] = useState(0);
    const [flipDeg, setFlipDeg] = useState(180);
    const [impacted, setImpacted] = useState(false);
    const [counted, setCounted] = useState(false);
    const [torn, setTorn] = useState(false);
    const [flashKey, setFlashKey] = useState(0);
    const [shake, setShake] = useState('');
    const [decisions, setDecisions] = useState<Record<string, 'kept' | 'sold'>>({});

    const pull = pulls[Math.min(i, pulls.length - 1)];
    const slab = getSlab(pull.slabKey)!;
    const def = HIT_CLASSES[pull.cls];
    const rank = def.rank;
    const fromPack = !session.packless && i === 0;

    const stageRef = useRef<HTMLDivElement | null>(null);
    const areaRef = useRef<HTMLDivElement | null>(null);
    const packRef = useRef<HTMLDivElement | null>(null);
    const walletRef = useRef<HTMLDivElement | null>(null);
    const cutRef = useRef<HTMLDivElement | null>(null);
    const headRef = useRef<HTMLDivElement | null>(null);
    const fxRef = useRef<FxHandle | null>(null);
    const chargeRef = useRef<ChargeHandle | null>(null);
    const tearRef = useRef<TearHandle | null>(null);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const drag = useRef({ active: false, lo: 0, hi: 0, startX: 0, lastX: 0, lastT: 0, moved: 0, lastGrain: 0, raf: 0 });

    const later = useCallback((ms: number, fn: () => void) => {
        timers.current.push(setTimeout(fn, ms));
    }, []);
    const clearTimers = useCallback(() => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
    }, []);

    /** A point in stage coordinates (what the particle canvas uses). */
    const pointOf = useCallback((el: HTMLElement | null, fx = 0.5, fy = 0.5) => {
        const s = stageRef.current?.getBoundingClientRect();
        const r = el?.getBoundingClientRect();
        if (!s || !r) return { x: 0, y: 0 };
        return { x: r.left - s.left + r.width * fx, y: r.top - s.top + r.height * fy };
    }, []);

    // ── The sequence ────────────────────────────────────────────────────────

    const impact = useCallback(
        (idx: number) => {
            const p = pulls[idx];
            const d = HIT_CLASSES[p.cls];
            const r = d.rank;
            setImpacted(true);
            setFlashKey((k) => k + 1);
            sfx.reveal(r);
            haptics.reveal(r);
            previewActions.reveal(p.id);
            if (r >= 3) {
                setShake(r >= 5 ? 'sp-shake-big' : 'sp-shake');
                later(760, () => setShake(''));
            }

            const fx = fxRef.current;
            if (!fx || reduced) return;
            const c = pointOf(areaRef.current);
            const colors = r === 5 ? RAINBOW : [d.color, d.color2, '#ffffff'];
            if (r === 0) {
                fx.burst(c.x, c.y, { count: 12, colors, speed: 220, life: 0.5, shape: 'dot', size: 1.6 });
                return;
            }
            if (r === 1) {
                fx.burst(c.x, c.y, { count: 22, colors, speed: 300, life: 0.6, size: 2 });
                return;
            }
            fx.ring(c.x, c.y, d.color, 200 + r * 60, 0.55 + r * 0.06);
            fx.burst(c.x, c.y, { count: 30 + r * 28, colors, speed: 420 + r * 110, life: 0.8 + r * 0.12, size: 2.2, gravity: 240 });
            if (r >= 3) {
                fx.burst(c.x, c.y - 40, {
                    count: 24 + (r - 3) * 44, colors, speed: 640, life: 2.2, shape: 'confetti',
                    size: 4.5, gravity: 620, angle: -Math.PI / 2, spread: 1.1,
                });
                later(140, () => fx.ring(c.x, c.y, '#ffffff', 320, 0.7));
            }
            if (r >= 4) later(300, () => fx.ring(c.x, c.y, d.color2, 460, 0.9));
            if (r === 5) {
                // Two more bursts land on the fanfare's second and third chords.
                fx.rain(RAINBOW, 3400);
                for (const [ms, n] of [[560, 90], [1120, 140]] as const) {
                    later(ms, () => {
                        fx.ring(c.x, c.y, RAINBOW[Math.floor(Math.random() * 5)], 420, 0.8);
                        fx.burst(c.x, c.y, { count: n, colors: RAINBOW, speed: 760, life: 1.2, size: 2.4, gravity: 260 });
                    });
                }
            }
        },
        [later, pointOf, pulls, reduced],
    );

    const flip = useCallback(
        (idx: number) => {
            clearTimers();
            chargeRef.current?.stop();
            chargeRef.current = null;
            // Clearing the timers may have dropped the one that ends a
            // previous slab's shake; reset it so this slab's can replay.
            setShake('');
            setStep(HIT_CLASSES[pulls[idx].cls].rank);
            setPhase('flip');
            // The breath: sound and light both cut out, then the slab turns.
            later(quick ? 20 : 90, () => {
                setFlipDeg(360);
                sfx.flip();
                later(quick ? 130 : 200, () => impact(idx));
                later(quick ? 380 : 560, () => setPhase('revealed'));
            });
        },
        [clearTimers, impact, later, pulls, quick],
    );

    const beginCharge = useCallback(
        (idx: number) => {
            const r = HIT_CLASSES[pulls[idx].cls].rank;
            setPhase('charge');
            setStep(0);
            if (quick) {
                later(140, () => flip(idx));
                return;
            }
            const total = CHARGE_LEAD_MS + r * STEP_MS + CHARGE_TAIL_MS;
            chargeRef.current = sfx.chargeStart(total / 1000);
            for (let k = 1; k <= r; k++) {
                later(CHARGE_LEAD_MS + (k - 1) * STEP_MS, () => {
                    setStep(k);
                    sfx.escalate(k - 1);
                    haptics.step();
                    const c = pointOf(areaRef.current);
                    const cd = HIT_CLASSES[HIT_ORDER[k]];
                    fxRef.current?.burst(c.x, c.y, {
                        count: 10 + k * 5, colors: k === 5 ? RAINBOW : [cd.color, '#ffffff'],
                        speed: 280 + k * 70, life: 0.5, size: 2,
                    });
                });
            }
            later(total, () => flip(idx));
        },
        [flip, later, pointOf, pulls, quick],
    );

    const completeTear = useCallback(() => {
        const d = drag.current;
        d.active = false;
        cancelAnimationFrame(d.raf);
        tearRef.current?.end();
        tearRef.current = null;
        setTorn(true);
        setPhase('burst');
        sfx.burst();
        haptics.burst();
        const c = pointOf(packRef.current, 0.5, TEAR_Y / 100);
        const w = packRef.current?.getBoundingClientRect().width ?? 200;
        if (!reduced) {
            fxRef.current?.ring(c.x, c.y, tier.theme.glow, w * 1.1, 0.5);
            fxRef.current?.burst(c.x, c.y, {
                count: 70, colors: [tier.theme.a, tier.theme.glow, '#ffffff'], speed: 620, life: 0.9,
                size: 2.2, gravity: 500, angle: -Math.PI / 2, spread: 1.25,
            });
        }
        later(quick ? 60 : 130, () => {
            setPhase('rise');
            sfx.rise();
            later(quick ? 380 : 760, () => beginCharge(0));
        });
    }, [beginCharge, later, pointOf, quick, reduced, tier.theme]);

    // Entry: drop the pack in, or (resuming from the vault) go straight to a slab.
    useEffect(() => {
        for (const p of pulls) {
            const s = getSlab(p.slabKey);
            if (s) new Image().src = slabImage(s, 'large');
        }
        if (session.packless) {
            sfx.rise();
            later(440, () => beginCharge(0));
        } else {
            sfx.packIn();
            later(quick ? 300 : 620, () => setPhase('ready'));
        }
        const d = drag.current;
        return () => {
            clearTimers();
            cancelAnimationFrame(d.raf);
            chargeRef.current?.stop();
            tearRef.current?.end();
        };
        // One run per session: the stage is re-keyed for every new one.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // While the tell climbs, light is drawn into the slab from all round it:
    // more of it, and in the new colour, with every class.
    useEffect(() => {
        if (phase !== 'charge' || quick) return;
        const cd = HIT_CLASSES[HIT_ORDER[Math.min(step, HIT_ORDER.length - 1)]];
        const colors = step >= 5 ? RAINBOW : [cd.color, '#ffffff'];
        const id = setInterval(() => {
            const c = pointOf(areaRef.current);
            const w = areaRef.current?.getBoundingClientRect().width ?? 320;
            fxRef.current?.converge(c.x, c.y, w * 0.6, 2 + step, colors);
        }, 90);
        return () => clearInterval(id);
    }, [phase, step, quick, pointOf]);

    // ── The cut ─────────────────────────────────────────────────────────────

    const paintCut = (lo: number, hi: number, head: number) => {
        if (cutRef.current) {
            cutRef.current.style.left = `${lo * 100}%`;
            cutRef.current.style.width = `${Math.max(0, hi - lo) * 100}%`;
            cutRef.current.style.opacity = hi - lo > 0.005 ? '1' : '0';
        }
        if (headRef.current) {
            headRef.current.style.left = `${head * 100}%`;
            headRef.current.style.opacity = '1';
        }
    };

    const emitCut = (head: number, speed: number) => {
        const d = drag.current;
        const progress = Math.min(1, (d.hi - d.lo) / TEAR_SPAN);
        tearRef.current?.move(progress, speed);
        const now = performance.now();
        if (now - d.lastGrain > 42) {
            d.lastGrain = now;
            haptics.grain();
            if (!reduced) {
                const c = pointOf(packRef.current, head, TEAR_Y / 100);
                fxRef.current?.burst(c.x, c.y, {
                    count: 2 + Math.round(speed * 5), colors: [tier.theme.a, '#ffffff', tier.theme.glow],
                    speed: 190 + speed * 260, life: 0.42, size: 1.8, gravity: 520, angle: -Math.PI / 2, spread: 1.5,
                });
            }
        }
        return progress;
    };

    /** Finish the cut on its own, from wherever it is, across to the far edge. */
    const autoTear = useCallback(() => {
        const d = drag.current;
        if (!tearRef.current) tearRef.current = sfx.tearStart();
        setPhase('tearing');
        const from = d.hi > d.lo ? d.hi : 0.04;
        if (d.hi <= d.lo) d.lo = from;
        if (reduced) {
            // No travelling cut for reduced motion: the pack simply opens.
            completeTear();
            return;
        }
        const t0 = performance.now();
        const dur = quick ? 200 : 380;
        const frame = () => {
            const p = Math.min(1, Math.max(0, (performance.now() - t0) / dur));
            const head = from + (0.98 - from) * (p * p * (3 - 2 * p));
            d.hi = Math.max(d.hi, head);
            paintCut(d.lo, d.hi, head);
            emitCut(head, 0.85);
            if (p < 1) d.raf = requestAnimationFrame(frame);
            else completeTear();
        };
        d.raf = requestAnimationFrame(frame);
        // paintCut / emitCut only touch refs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [completeTear, quick, reduced]);

    useEffect(() => {
        if (!autoRip || phase !== 'ready') return;
        const id = setTimeout(autoTear, 350);
        return () => clearTimeout(id);
    }, [autoRip, autoTear, phase]);

    const relX = (clientX: number) => {
        const r = packRef.current?.getBoundingClientRect();
        if (!r) return 0;
        return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    };

    const onPackDown = (e: React.PointerEvent) => {
        if (phase !== 'ready') return;
        sfx.unlock();
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            // Not every pointer can be captured; the cut still tracks while it stays on the pack.
        }
        const x = relX(e.clientX);
        // Mutate, never replace: the unmount cleanup holds this same object to cancel a running cut.
        Object.assign(drag.current, { active: true, lo: x, hi: x, startX: e.clientX, lastX: e.clientX, lastT: performance.now(), moved: 0 });
        tearRef.current = sfx.tearStart();
        setPhase('tearing');
        paintCut(x, x, x);
    };

    const onPackMove = (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d.active) return;
        const now = performance.now();
        const dx = Math.abs(e.clientX - d.lastX);
        const speed = Math.min(1, dx / Math.max(1, now - d.lastT) / 1.4);
        d.moved += dx;
        d.lastX = e.clientX;
        d.lastT = now;
        const x = relX(e.clientX);
        d.lo = Math.min(d.lo, x);
        d.hi = Math.max(d.hi, x);
        paintCut(d.lo, d.hi, x);
        if (emitCut(x, speed) >= 1) completeTear();
    };

    const onPackUp = () => {
        const d = drag.current;
        if (!d.active) return;
        d.active = false;
        const progress = (d.hi - d.lo) / TEAR_SPAN;
        // A tap, or a cut taken past halfway, finishes itself. A short swipe
        // heals and waits for another go.
        if (d.moved < 10) {
            d.lo = 0.04;
            d.hi = 0.04;
            autoTear();
        } else if (progress >= 0.5) {
            autoTear();
        } else {
            tearRef.current?.end();
            tearRef.current = null;
            d.lo = 0;
            d.hi = 0;
            if (cutRef.current) cutRef.current.style.opacity = '0';
            if (headRef.current) headRef.current.style.opacity = '0';
            setPhase('ready');
        }
    };

    // ── After the reveal ────────────────────────────────────────────────────

    const advance = (from: number) => {
        if (from < pulls.length - 1) {
            setI(from + 1);
            setFlipDeg(180);
            setStep(0);
            setImpacted(false);
            setCounted(false);
            setPhase('rise');
            sfx.rise();
            later(quick ? 260 : 440, () => beginCharge(from + 1));
        } else {
            sfx.whooshOut();
            setPhase('summary');
        }
    };

    const decide = (kind: 'kept' | 'sold') => {
        if (phase !== 'revealed') return;
        setDecisions((d) => ({ ...d, [pull.id]: kind }));
        if (kind === 'sold') {
            previewActions.sell([pull.id]);
            sfx.coins();
            haptics.coins();
            if (!reduced) {
                const c = pointOf(areaRef.current);
                const w = pointOf(walletRef.current);
                fxRef.current?.fly(c.x, c.y, w.x, w.y, 18, '#FBBF24');
            }
        } else {
            sfx.keep();
            haptics.tap();
        }
        setPhase('leaving');
        const current = i;
        later(kind === 'sold' ? 620 : 360, () => advance(current));
    };

    /** Turn everything still face-down over at once and go to the results. */
    const revealAll = () => {
        clearTimers();
        chargeRef.current?.stop();
        chargeRef.current = null;
        tearRef.current?.end();
        tearRef.current = null;
        cancelAnimationFrame(drag.current.raf);
        let best = 0;
        for (const p of pulls) {
            if (decisions[p.id]) continue;
            previewActions.reveal(p.id);
            best = Math.max(best, HIT_CLASSES[p.cls].rank);
        }
        setDecisions((d) => {
            const next = { ...d };
            for (const p of pulls) if (!next[p.id]) next[p.id] = 'kept';
            return next;
        });
        sfx.reveal(best);
        haptics.reveal(best);
        setPhase('summary');
    };

    const skipCharge = () => {
        if (phase === 'charge') flip(i);
    };

    // ── Derived visuals ─────────────────────────────────────────────────────

    const stepCls: HitClass = HIT_ORDER[Math.min(step, HIT_ORDER.length - 1)];
    const lit = phase === 'charge' || ((phase === 'flip' || phase === 'revealed' || phase === 'leaving') && impacted);
    const auraCls = impacted ? pull.cls : stepCls;
    const auraColor = HIT_CLASSES[auraCls].color;
    // The slab's own light: the tier's colour until the tell starts, then the tell's.
    const telling = phase === 'charge' || (phase === 'flip' && !impacted);
    const backAura = telling ? HIT_CLASSES[stepCls].color : tier.theme.glow;
    const auraStyle = {
        '--aura': auraColor,
        '--aura-o': !lit ? 0 : impacted ? 0.5 + rank * 0.06 : 0.55 + step * 0.07,
        '--aura-s': impacted ? 0.95 + rank * 0.1 : 0.55 + step * 0.15,
        '--rays-o': rank >= 5 ? 0.62 : rank === 4 ? 0.42 : 0.2,
        '--flash-o': [0.16, 0.24, 0.42, 0.62, 0.88, 1][rank],
        '--flash-d': `${[0.35, 0.4, 0.5, 0.65, 0.9, 1.3][rank]}s`,
    } as React.CSSProperties;

    const slabPose = (() => {
        switch (phase) {
            case 'present':
            case 'ready':
            case 'tearing':
            case 'burst':
                return { y: '8%', x: '0%', scale: 0.78, opacity: 0 };
            case 'rise':
                return fromPack ? { y: '-30%', x: '0%', scale: 0.8, opacity: 1 } : { y: '0%', x: '0%', scale: 0.94, opacity: 1 };
            case 'charge':
                return { y: '0%', x: '0%', scale: 0.94, opacity: 1 };
            case 'flip':
                return { y: '0%', x: '0%', scale: 1.05, opacity: 1 };
            case 'revealed':
                return { y: '0%', x: '0%', scale: 1, opacity: 1 };
            case 'leaving':
                return decisions[pull.id] === 'sold'
                    ? { y: '-46%', x: '34%', scale: 0.2, opacity: 0 }
                    : { y: '64%', x: '0%', scale: 0.3, opacity: 0 };
            default:
                return { y: '0%', x: '0%', scale: 0.9, opacity: 0 };
        }
    })();

    const slabTransition = (() => {
        switch (phase) {
            case 'rise':
                return { duration: 0.5, ease: [0.2, 0.9, 0.2, 1] as const };
            case 'charge':
                return { type: 'spring' as const, stiffness: 170, damping: 17 };
            case 'flip':
                return { duration: 0.2 };
            case 'revealed':
                return { type: 'spring' as const, stiffness: 260, damping: 16 };
            case 'leaving':
                return { duration: 0.34, ease: [0.5, 0, 0.9, 0.5] as const };
            default:
                return { duration: 0.2 };
        }
    })();

    const showPack = fromPack && (phase === 'present' || phase === 'ready' || phase === 'tearing' || phase === 'burst' || phase === 'rise');
    const sellValue = sellBackThb(slab.valueThb, tier);
    const multiple = slab.valueThb / tier.priceThb;
    const remaining = pulls.length - 1 - i;
    const shownCredits = useTween(credits, reduced ? 0 : 600);

    const totals = useMemo(() => {
        let pulled = 0;
        let spent = 0;
        for (const p of pulls) {
            pulled += getSlab(p.slabKey)?.valueThb ?? 0;
            spent += p.pricePaidThb;
        }
        return { pulled, spent };
    }, [pulls]);

    const packCount = pulls.length;
    const againCost = packCount * tier.priceThb;

    return (
        <div
            ref={stageRef}
            className={`sp-stage ${shake}`}
            data-material={tier.theme.material}
            style={{ ...tierVars(tier), ...auraStyle }}
            onPointerDown={() => sfx.unlock()}
        >
            <div className="sp-stage-material" />
            <div className="sp-stage-spot" style={{ opacity: phase === 'summary' ? 0.22 : lit ? 0.2 : 0.5 }} />
            <div className="sp-stage-floor" style={{ opacity: phase === 'summary' ? 0.5 : 1 }} />
            {!reduced &&
                MOTES.map(([left, size, dur, delay, drift, o], n) => (
                    <span
                        key={n}
                        className="sp-mote"
                        style={{
                            left: `${left}%`, width: size, height: size,
                            animationDuration: `${dur}s`, animationDelay: `-${delay}s`,
                            '--mote-x': `${drift}px`, '--mote-o': o,
                        } as React.CSSProperties}
                    />
                ))}

            {/* Top bar */}
            <div className="absolute inset-x-0 top-0 z-30 flex items-center gap-3 px-4" style={{ paddingTop: 'calc(var(--sat) + 10px)' }}>
                <button
                    onClick={() => {
                        sfx.whooshOut();
                        onClose();
                    }}
                    aria-label={t('stage.close')}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 active:scale-90"
                >
                    <X size={20} strokeWidth={2.6} />
                </button>
                <div className={`flex min-w-0 flex-1 items-center justify-center ${pulls.length > 6 ? 'gap-1' : 'gap-1.5'}`}>
                    {pulls.length > 1 && phase !== 'summary' ? (
                        pulls.map((p, n) => {
                            const done = n < i || (n === i && impacted);
                            return (
                                <span
                                    key={p.id}
                                    className="h-1.5 shrink-0 rounded-full transition-all duration-300"
                                    style={{
                                        width: pulls.length > 6 ? (n === i ? 14 : 5) : n === i ? 22 : 8,
                                        background: done ? HIT_CLASSES[p.cls].color : n === i ? '#fff' : 'rgba(255,255,255,0.22)',
                                    }}
                                />
                            );
                        })
                    ) : (
                        <span className="sp-display text-[15px] text-white/80">{tier.name}</span>
                    )}
                </div>
                <button
                    onClick={() => {
                        const next = !sound;
                        // Muting has to silence a riser that is already playing.
                        if (!next) chargeRef.current?.stop();
                        previewActions.setSetting('sound', next);
                        sfx.setEnabled(next);
                        if (next) sfx.tap();
                    }}
                    aria-label={t(sound ? 'stage.mute' : 'stage.unmute')}
                    aria-pressed={!sound}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 active:scale-90"
                >
                    {sound ? <Volume2 size={18} strokeWidth={2.4} /> : <VolumeX size={18} strokeWidth={2.4} className="text-white/50" />}
                </button>
                <div ref={walletRef} className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-white/10 pl-3 pr-3.5">
                    <Coins size={15} className="text-amber-300" />
                    <span className="sp-num text-[14px]">{baht(shownCredits)}</span>
                </div>
            </div>

            {/* The stage itself */}
            {phase !== 'summary' && (
                <div
                    ref={areaRef}
                    className="absolute inset-x-0"
                    style={{ top: 'calc(var(--sat) + 62px)', bottom: 'calc(var(--sab) + 236px)', containerType: 'size' }}
                    onPointerDown={skipCharge}
                >
                    <div
                        className="sp-rays"
                        data-on={impacted && rank >= 3 && phase !== 'leaving'}
                        data-rainbow={rank === 5}
                    />
                    {/* The rainbow races while the tell is climbing and eases once the slab is up. */}
                    <div
                        className="sp-aura"
                        data-rainbow={auraCls === 'ss' && lit}
                        style={{ animationDuration: impacted ? '2.8s' : '1.1s' }}
                    />
                    {phase === 'charge' && step > 0 && <span key={`ring-${i}-${step}`} className="sp-pulse-ring" />}

                    {/* Slab */}
                    <div className="absolute inset-0 z-[1] flex items-center justify-center">
                        <motion.div
                            key={pull.id}
                            className="relative"
                            style={{ width: 'min(66cqw, 270px, calc((100cqh - 30px) * 0.605))' }}
                            initial={fromPack ? { y: '8%', x: '0%', scale: 0.78, opacity: 0 } : { y: '70%', x: '0%', scale: 0.8, opacity: 0 }}
                            animate={slabPose}
                            transition={slabTransition}
                        >
                            <div
                                className={phase === 'charge' && !quick ? 'sp-tremble' : phase === 'revealed' ? 'sp-float' : ''}
                                style={{ '--step': step, '--aura': backAura } as React.CSSProperties}
                            >
                                <div key={`bump-${step}`} className={phase === 'charge' && step > 0 ? 'sp-bump' : ''}>
                                    <SlabCard
                                        slab={slab}
                                        tier={tier}
                                        flipDeg={flipDeg}
                                        flipTransition={{ duration: quick ? 0.32 : 0.5, ease: [0.3, 1.4, 0.4, 1] }}
                                        tilt={phase === 'revealed'}
                                        foil={0.3 + rank * 0.12}
                                    />
                                </div>
                            </div>
                            {(phase === 'revealed' || phase === 'leaving') && rank >= 2 && (
                                <div className="sp-stamp pointer-events-none absolute -left-4 -top-5 z-10 flex items-center gap-2">
                                    <RankBadge cls={pull.cls} style={{ fontSize: 34 }} />
                                </div>
                            )}
                        </motion.div>
                    </div>

                    {/* Pack */}
                    {showPack && (
                        <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center">
                            <motion.div
                                style={{ width: 'min(58cqw, 236px, calc((100cqh - 60px) * 0.64))' }}
                                initial={{ y: '110%', rotate: -12, opacity: 0, scale: 0.9 }}
                                animate={
                                    phase === 'rise'
                                        ? { y: '125%', rotate: 9, opacity: 0, scale: 1 }
                                        : { y: '0%', rotate: 0, opacity: 1, scale: phase === 'burst' ? 1.05 : 1 }
                                }
                                transition={
                                    phase === 'rise'
                                        ? { delay: quick ? 0.12 : 0.34, duration: 0.42, ease: [0.5, 0, 0.9, 0.4] }
                                        : phase === 'burst'
                                          ? { duration: 0.12 }
                                          : { type: 'spring', stiffness: 150, damping: 15 }
                                }
                            >
                                <div className={phase === 'ready' ? 'sp-float' : ''}>
                                    <div
                                        ref={packRef}
                                        className="sp-pack pointer-events-auto"
                                        data-tier={tier.key}
                                        style={{ touchAction: 'none', cursor: phase === 'ready' ? 'grab' : 'default' }}
                                        onPointerDown={onPackDown}
                                        onPointerMove={onPackMove}
                                        onPointerUp={onPackUp}
                                        onPointerCancel={onPackUp}
                                    >
                                        <div className="sp-beam" data-on={torn} />
                                        <div className="sp-pack-piece" style={{ clipPath: PACK_CLIP.body }}>
                                            <PackFace tier={tier} subtitle={t('pack.subtitle')} />
                                        </div>
                                        <motion.div
                                            className="sp-pack-piece"
                                            style={{ clipPath: PACK_CLIP.strip, transformOrigin: '80% 10%' }}
                                            animate={torn ? { y: '-34%', x: '30%', rotate: 34, opacity: 0 } : { y: '0%', x: '0%', rotate: 0, opacity: 1 }}
                                            transition={{ duration: 0.55, ease: [0.2, 0.8, 0.3, 1] }}
                                        >
                                            <PackFace tier={tier} subtitle={t('pack.subtitle')} />
                                        </motion.div>
                                        {!torn && (
                                            <>
                                                <div className="sp-tearline" />
                                                {phase === 'ready' && <div className="sp-hint" />}
                                                <div ref={cutRef} className="sp-cut" style={{ opacity: 0, left: 0, width: 0 }} />
                                                <div ref={headRef} className="sp-cut-head" style={{ opacity: 0, left: 0 }} />
                                            </>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </div>
            )}

            <FxCanvas ref={fxRef} className="pointer-events-none absolute inset-0 z-20 h-full w-full" />
            <div key={flashKey} className="sp-flash z-[25]" data-on={flashKey > 0} />

            {/* Bottom panel: prompt, then the pull and what to do with it */}
            {phase !== 'summary' && (
                <div
                    className="absolute inset-x-0 bottom-0 z-30 flex flex-col justify-end px-5"
                    style={{ height: 'calc(var(--sab) + 236px)', paddingBottom: 'calc(var(--sab) + 16px)' }}
                >
                    {(phase === 'present' || phase === 'ready' || phase === 'tearing') && (
                        <div className="sp-fade-in flex flex-1 flex-col items-center justify-center text-center">
                            <div className="sp-display text-[30px]">{t('stage.ripPrompt')}</div>
                            <div className="sp-label mt-2.5">{t('stage.ripHint')}</div>
                        </div>
                    )}

                    {(phase === 'burst' || phase === 'rise' || phase === 'charge' || phase === 'flip') && (
                        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                            {phase === 'charge' && !quick && <div className="sp-label sp-breathe">{t('stage.tapToSkip')}</div>}
                        </div>
                    )}

                    {(phase === 'revealed' || phase === 'leaving') && (
                        <div className="sp-rise-in">
                            <div className="flex items-center gap-2.5">
                                <RankBadge cls={pull.cls} style={{ fontSize: 17 }} />
                                <span className="sp-display text-[19px]" style={{ color: def.color }}>
                                    {t(`class.${pull.cls}`)}
                                </span>
                                {multiple >= 1 && (
                                    <span className="sp-num ml-auto text-[16px]" style={{ color: def.color }}>
                                        {multiple >= 10 ? multiple.toFixed(0) : multiple.toFixed(1)}×
                                    </span>
                                )}
                            </div>
                            <div className="mt-2 truncate text-[19px] font-extrabold leading-tight">{slab.name}</div>
                            <div className="truncate text-[12px] text-white/55">
                                {slab.setName} · PSA {slab.grade} · #{slab.number}
                            </div>
                            <div className="mt-1.5 flex items-end justify-between gap-3">
                                <CountUp
                                    className="sp-num text-[40px] leading-none"
                                    value={slab.valueThb}
                                    run
                                    duration={reduced ? 0 : fast ? 240 : [500, 600, 800, 1000, 1300, 1700][rank]}
                                    onTick={(p) => sfx.tick(p)}
                                    onDone={() => {
                                        sfx.countDone(rank);
                                        setCounted(true);
                                    }}
                                />
                                <span className="sp-label pb-1 text-right">{t('stage.marketValue')}</span>
                            </div>
                            <div
                                className="mt-3 grid grid-cols-2 gap-3 transition-opacity duration-200"
                                style={{ opacity: counted && phase === 'revealed' ? 1 : 0.35 }}
                            >
                                <button
                                    className="sp-btn sp-btn-sell h-[54px] px-2 text-[15px]"
                                    disabled={!counted || phase !== 'revealed'}
                                    onClick={() => decide('sold')}
                                >
                                    <Coins size={17} strokeWidth={2.6} />
                                    <span>
                                        {t('stage.sell')} {baht(sellValue)}
                                    </span>
                                </button>
                                <button
                                    className="sp-btn sp-btn-ghost h-[54px] px-2 text-[15px]"
                                    disabled={!counted || phase !== 'revealed'}
                                    onClick={() => decide('kept')}
                                >
                                    {remaining > 0 ? t('stage.keepNext') : t('stage.keep')}
                                </button>
                            </div>
                        </div>
                    )}

                    {pulls.length > 1 && remaining > 0 && phase !== 'present' && phase !== 'ready' && phase !== 'tearing' && phase !== 'burst' && (
                        <button
                            onClick={revealAll}
                            className="sp-mini absolute right-5 flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white/80"
                            style={{ top: -6 }}
                        >
                            <FastForward size={13} />
                            {t('stage.revealAll')}
                        </button>
                    )}
                </div>
            )}

            {/* Results */}
            {phase === 'summary' && (
                <div
                    className="sp-fade-in absolute inset-0 z-30 flex flex-col px-5"
                    style={{ paddingTop: 'calc(var(--sat) + 70px)', paddingBottom: 'calc(var(--sab) + 16px)' }}
                >
                    <div className="text-center">
                        <div className="sp-label">{t('summary.title')}</div>
                        <div className="sp-num mt-1 text-[46px] leading-none">{baht(totals.pulled)}</div>
                        <div className="mt-1.5 text-[12px] text-white/55">
                            {t('summary.spent', { n: packCount, amount: baht(totals.spent) })}
                        </div>
                    </div>

                    <div className="sp-scroll mt-5 min-h-0 flex-1">
                        <div className={`grid gap-3 ${pulls.length === 1 ? 'mx-auto max-w-[min(210px,27dvh)] grid-cols-1' : pulls.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                            {pulls.map((p, n) => {
                                const s = getSlab(p.slabKey)!;
                                const sold = decisions[p.id] === 'sold';
                                return (
                                    <div key={p.id} className="sp-rise-in" style={{ animationDelay: `${Math.min(n, 9) * 55}ms` }}>
                                        <div className="relative" style={{ opacity: sold ? 0.45 : 1 }}>
                                            <SlabCard slab={s} tier={tier} art="small" flat foil={0.2} />
                                            <RankBadge cls={p.cls} className="absolute -left-1.5 -top-1.5" style={{ fontSize: 13 }} />
                                        </div>
                                        <div className="mt-1.5 truncate text-[11px] font-bold leading-tight">{s.name}</div>
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="sp-num text-[13px]">{baht(s.valueThb)}</span>
                                            <span className="text-[9px] font-black uppercase tracking-wider text-white/45">
                                                {sold ? t('summary.sold') : t('summary.kept')}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="mt-4 grid gap-2.5">
                        {/* Paid the same way as the packs just opened; the card never runs out. */}
                        <button className="sp-btn sp-btn-primary h-[58px] text-[18px]" onClick={() => onRipAgain(packCount)}>
                            <span className="sp-display">{t('summary.ripAgain', { n: packCount })}</span>
                            <span className="sp-num text-[17px] opacity-80">{baht(againCost)}</span>
                        </button>
                        <button
                            className="sp-btn sp-btn-ghost h-[50px] text-[15px]"
                            onClick={() => {
                                sfx.tap();
                                onClose();
                            }}
                        >
                            {t('summary.done')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
