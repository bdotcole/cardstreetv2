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
            case 'spark':
                return <path d="M58 4 22 54h22l-8 42 42-56H54z" />;
            case 'surge':
                return (
                    <>
                        <path d="M6 44c14-22 30-22 44 0s30 22 44 0v14c-14 22-30 22-44 0S20 36 6 58z" />
                        <path d="M6 70c14-18 30-18 44 0s30 18 44 0v10c-14 18-30 18-44 0S20 62 6 80z" opacity=".55" />
                        <path d="M6 22c14-18 30-18 44 0s30 18 44 0v10c-14 18-30 18-44 0S20 14 6 32z" opacity=".55" />
                    </>
                );
            case 'nova':
                return (
                    <path
                        d="M50 2l9 33 30-17-17 30 33 9-33 9 17 30-30-17-9 33-9-33-30 17 17-30-33-9 33-9-17-30 30 17z"
                        transform="translate(-5 -7) scale(1.1)"
                    />
                );
            case 'eclipse':
                return <path fillRule="evenodd" d="M50 6a44 44 0 1 0 0 88 44 44 0 0 0 0-88zm12 12a32 32 0 1 1 0 64 38 38 0 0 0 0-64z" />;
            case 'apex':
                return (
                    <>
                        <path d="M50 6 94 88H6z" opacity=".5" />
                        <path d="M50 30 80 88H20z" />
                        <path d="M50 6l12 22H38z" />
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
