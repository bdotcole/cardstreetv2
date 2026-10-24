'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { HIT_CLASSES } from '@/lib/slabPacks/tiers';
import type { HitClass, PackTier, TierKey } from '@/lib/slabPacks/types';

/** Whole baht, with the sign in front and thousands separators. */
export function baht(n: number): string {
    return `฿${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * Translations for this feature. Keys live under `slabPacks.*`; `{name}`
 * placeholders are filled from `vars`.
 */
export function useSp() {
    const { t, isThai } = useTranslation();
    const tt = useCallback(
        (key: string, vars?: Record<string, string | number>) => {
            let out = t(`slabPacks.${key}`);
            if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
            return out;
        },
        // `t` is rebuilt every render by the hook; the language is what matters.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [isThai],
    );
    return { t: tt, isThai };
}

/** CSS variables for a tier's colours, for any element that is tier-themed. */
export function tierVars(tier: PackTier): React.CSSProperties {
    return {
        '--sp-a': tier.theme.a,
        '--sp-b': tier.theme.b,
        '--sp-c': tier.theme.c,
        '--sp-glow': tier.theme.glow,
        '--sp-ink': tier.theme.ink,
    } as React.CSSProperties;
}

export function classVars(cls: HitClass): React.CSSProperties {
    const def = HIT_CLASSES[cls];
    return { '--cls': def.color, '--cls2': def.color2 } as React.CSSProperties;
}

/** The slanted letter chip for a hit class. Font size sets its scale. */
export function RankBadge({ cls, className = '', style }: { cls: HitClass; className?: string; style?: React.CSSProperties }) {
    return (
        <span className={`sp-rank ${className}`} data-cls={cls} style={{ ...classVars(cls), ...style }}>
            <span>{HIT_CLASSES[cls].letter}</span>
        </span>
    );
}

/**
 * One glyph per tier, stamped into the foil: the tier's ink, slightly thinner
 * at the top so the foil colour shows through, with a hairline of light on
 * its edge.
 */
export function TierEmblem({ tier, className }: { tier: TierKey; className?: string }) {
    const id = `sp-emblem-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
    const glyph = (() => {
        switch (tier) {
            case 'silver':
                // A medal: a ring with a star cut out of it.
                return (
                    <path
                        fillRule="evenodd"
                        d="M50 6a44 44 0 1 0 0 88 44 44 0 0 0 0-88zm0 16 8.8 19.2 21 2.2-15.6 14.2 4.4 20.7L50 67.8l-18.6 10.5 4.4-20.7-15.6-14.2 21-2.2z"
                    />
                );
            case 'gold':
                // A crown.
                return (
                    <>
                        <path d="M10 72 4 30l24 16 22-30 22 30 24-16-6 42z" />
                        <path d="M12 78h76v12H12z" opacity=".7" />
                    </>
                );
            case 'platinum':
                // A hexagonal badge with a cut-out inner hexagon.
                return (
                    <path
                        fillRule="evenodd"
                        d="M50 4 90 27v46L50 96 10 73V27zm0 18L26 36v28l24 14 24-14V36z"
                    />
                );
            case 'emerald':
                // An emerald cut: an octagon with a step inside.
                return (
                    <>
                        <path fillRule="evenodd" d="M30 8h40l22 22v40L70 92H30L8 70V30zm4 12L20 34v32l14 14h32l14-14V34L66 20z" />
                        <path d="M38 40h24v20H38z" opacity=".55" />
                    </>
                );
            case 'diamond':
                // A brilliant cut: flat table, pointed pavilion.
                return (
                    <>
                        <path d="M26 14h48l20 26-44 54L6 40z" />
                        <path d="M26 14 6 40h88L74 14zM36 40l14 50 14-50z" opacity=".4" />
                    </>
                );
            case 'opal':
                // A ringed planet.
                return (
                    <>
                        <circle cx="50" cy="50" r="28" />
                        <path
                            fillRule="evenodd"
                            d="M50 30c30 0 50 6 50 14s-20 14-50 14S0 52 0 44s20-14 50-14zm0 6c-24 0-40 4-40 8s16 8 40 8 40-4 40-8-16-8-40-8z"
                            opacity=".75"
                            transform="rotate(-18 50 44)"
                        />
                    </>
                );
        }
    })();
    return (
        <svg viewBox="0 0 100 100" className={className} aria-hidden>
            <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0.35" y2="1">
                    <stop offset="0" style={{ stopColor: 'var(--sp-ink)', stopOpacity: 0.74 }} />
                    <stop offset="1" style={{ stopColor: 'var(--sp-ink)', stopOpacity: 1 }} />
                </linearGradient>
            </defs>
            <g fill={`url(#${id})`} stroke="rgba(255,255,255,0.3)" strokeWidth="1.1" strokeLinejoin="round" paintOrder="stroke">
                {glyph}
            </g>
        </svg>
    );
}

/** The brand's fanned-cards motif, for the mystery side of a slab. */
export function FanMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 120 80" className={className} fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" aria-hidden>
            <rect x="18" y="16" width="34" height="50" rx="6" transform="rotate(-18 35 41)" opacity=".55" />
            <rect x="43" y="10" width="34" height="50" rx="6" opacity=".8" />
            <rect x="68" y="16" width="34" height="50" rx="6" transform="rotate(18 85 41)" />
        </svg>
    );
}

/** "12s", "4m", "2h" — short enough for a ticker row. */
export function timeAgo(at: number, now: number): string {
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 60) return `${Math.max(1, s)}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m`;
    return `${Math.round(m / 60)}h`;
}

/** A clock that ticks every `ms`, for "x ago" labels. Starts after mount. */
export function useNow(ms = 15_000): number {
    const [now, setNow] = useState(0);
    useEffect(() => {
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(id);
    }, [ms]);
    return now;
}

export function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const sync = () => setReduced(mq.matches);
        sync();
        mq.addEventListener('change', sync);
        return () => mq.removeEventListener('change', sync);
    }, []);
    return reduced;
}

/**
 * Count from 0 to `value` once `run` turns true. `onTick` fires as the number
 * moves (throttled, with progress 0..1) so the caller can tick a sound.
 */
export function CountUp({
    value, run, duration, className, onTick, onDone,
}: {
    value: number;
    run: boolean;
    duration: number;
    className?: string;
    onTick?: (progress: number) => void;
    onDone?: () => void;
}) {
    const [shown, setShown] = useState(0);
    const cb = useRef({ onTick, onDone });
    cb.current = { onTick, onDone };

    useEffect(() => {
        if (!run) {
            setShown(0);
            return;
        }
        if (duration <= 0) {
            setShown(value);
            cb.current.onDone?.();
            return;
        }
        let raf = 0;
        let lastTick = 0;
        const start = performance.now();
        const frame = () => {
            // Read the clock here rather than trusting the frame timestamp:
            // the two are not guaranteed to share an origin, and a timestamp
            // older than `start` would count backwards.
            const now = performance.now();
            const p = Math.min(1, Math.max(0, (now - start) / duration));
            // Ease-out: fast through the small numbers, slow onto the total.
            const eased = 1 - Math.pow(1 - p, 3);
            setShown(Math.round(value * eased));
            if (now - lastTick > 55 && p < 1) {
                lastTick = now;
                cb.current.onTick?.(p);
            }
            if (p < 1) raf = requestAnimationFrame(frame);
            else cb.current.onDone?.();
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [run, value, duration]);

    return <span className={className}>{baht(shown)}</span>;
}

/** A number that glides to each new value instead of jumping (wallet balances). */
export function useTween(value: number, ms = 600): number {
    const [shown, setShown] = useState(value);
    const from = useRef(value);

    useEffect(() => {
        const start = from.current;
        if (start === value) return;
        if (ms <= 0) {
            from.current = value;
            setShown(value);
            return;
        }
        let raf = 0;
        const t0 = performance.now();
        const frame = () => {
            const p = Math.min(1, Math.max(0, (performance.now() - t0) / ms));
            const v = Math.round(start + (value - start) * (1 - Math.pow(1 - p, 3)));
            from.current = v;
            setShown(v);
            if (p < 1) raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(raf);
    }, [value, ms]);

    return shown;
}

/**
 * Pointer tilt. Writes --sp-tx / --sp-ty (each -1..1) and a rotation onto the
 * element directly, so dragging a slab never re-renders React.
 */
export function useTilt<T extends HTMLElement>(enabled: boolean, maxDeg = 14) {
    const ref = useRef<T | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const apply = (tx: number, ty: number) => {
            el.style.setProperty('--sp-tx', tx.toFixed(3));
            el.style.setProperty('--sp-ty', ty.toFixed(3));
            el.style.transform = `rotateY(${(tx * maxDeg).toFixed(2)}deg) rotateX(${(-ty * maxDeg).toFixed(2)}deg)`;
        };
        if (!enabled) {
            el.style.transition = 'transform 0.4s ease';
            apply(0, 0);
            return;
        }
        let active = false;
        const move = (e: PointerEvent) => {
            if (!active) return;
            const r = el.getBoundingClientRect();
            const tx = Math.min(1, Math.max(-1, ((e.clientX - r.left) / r.width - 0.5) * 2));
            const ty = Math.min(1, Math.max(-1, ((e.clientY - r.top) / r.height - 0.5) * 2));
            el.style.transition = 'transform 0.06s linear';
            apply(tx, ty);
        };
        const down = (e: PointerEvent) => {
            active = true;
            move(e);
        };
        const up = () => {
            active = false;
            el.style.transition = 'transform 0.6s cubic-bezier(0.2, 0.9, 0.2, 1)';
            apply(0, 0);
        };
        el.addEventListener('pointerdown', down);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        return () => {
            el.removeEventListener('pointerdown', down);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
        };
    }, [enabled, maxDeg]);

    return ref;
}
