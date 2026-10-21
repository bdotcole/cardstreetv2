'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * One canvas for every particle in the opening: tear sparks, reveal bursts,
 * confetti, shockwave rings, glitter rain and the coins that fly to the
 * wallet. A canvas rather than DOM nodes because a big hit puts several
 * hundred particles on screen at once, and a phone holds 60fps for that only
 * when nothing is laid out.
 *
 * Coordinates are CSS pixels inside the canvas's own box. The loop runs only
 * while something is alive.
 */

export interface BurstOptions {
    count: number;
    colors: string[];
    /** Launch speed in px/s (each particle gets 35-100% of it). */
    speed: number;
    /** Seconds. */
    life: number;
    gravity?: number;
    size?: number;
    shape?: 'spark' | 'dot' | 'confetti';
    /** Direction (radians, 0 = right, -PI/2 = up) and half-width of the cone. Omit for all directions. */
    angle?: number;
    spread?: number;
}

export interface FxHandle {
    burst(x: number, y: number, o: BurstOptions): void;
    ring(x: number, y: number, color: string, radius: number, life?: number): void;
    rain(colors: string[], ms: number): void;
    fly(x: number, y: number, tx: number, ty: number, count: number, color: string): void;
    /** Motes drawn in from a ring toward a point: energy gathering. */
    converge(x: number, y: number, radius: number, count: number, colors: string[]): void;
    clear(): void;
}

interface Particle {
    kind: 'spark' | 'dot' | 'confetti' | 'fly';
    x: number; y: number; vx: number; vy: number;
    life: number; max: number;
    size: number; color: string;
    gravity: number;
    rot: number; vr: number; tumble: number;
    // fly only
    sx: number; sy: number; cx: number; cy: number; tx: number; ty: number;
}

interface Ring {
    x: number; y: number; color: string; radius: number; life: number; max: number;
}

const MAX_PARTICLES = 700;

const FxCanvas = forwardRef<FxHandle, { className?: string }>(function FxCanvas({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const sim = useRef({
        particles: [] as Particle[],
        rings: [] as Ring[],
        rainUntil: 0,
        rainColors: [] as string[],
        raf: 0,
        last: 0,
        w: 0,
        h: 0,
        dpr: 1,
    });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const s = sim.current;
        const resize = () => {
            s.dpr = Math.min(2, window.devicePixelRatio || 1);
            s.w = canvas.clientWidth;
            s.h = canvas.clientHeight;
            canvas.width = Math.round(s.w * s.dpr);
            canvas.height = Math.round(s.h * s.dpr);
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(canvas);
        return () => {
            ro.disconnect();
            cancelAnimationFrame(s.raf);
            s.raf = 0;
        };
    }, []);

    useImperativeHandle(ref, () => {
        const s = sim.current;

        const push = (p: Particle) => {
            if (s.particles.length >= MAX_PARTICLES) s.particles.shift();
            s.particles.push(p);
        };

        const frame = () => {
            // One clock for the whole simulation (performance.now), read here:
            // a frame timestamp from a different origin would run time backwards.
            const now = performance.now();
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (!canvas || !ctx) {
                s.raf = 0;
                return;
            }
            const dt = Math.min(0.05, Math.max(0, (now - s.last) / 1000));
            s.last = now;

            if (now < s.rainUntil) {
                for (let i = 0; i < 3; i++) {
                    push({
                        kind: Math.random() < 0.7 ? 'confetti' : 'dot',
                        x: Math.random() * s.w, y: -12,
                        vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 220,
                        life: 2.6, max: 2.6,
                        size: 1.2 + Math.random() * 3.2,
                        color: s.rainColors[Math.floor(Math.random() * s.rainColors.length)],
                        gravity: 120,
                        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10, tumble: Math.random() * 6.28,
                        sx: 0, sy: 0, cx: 0, cy: 0, tx: 0, ty: 0,
                    });
                }
            }

            ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
            ctx.clearRect(0, 0, s.w, s.h);

            // Light adds: sparks, dots, coins and rings brighten where they overlap.
            ctx.globalCompositeOperation = 'lighter';
            for (const r of s.rings) {
                r.life -= dt;
                const p = 1 - Math.max(0, r.life) / r.max;
                const eased = 1 - Math.pow(1 - p, 3);
                ctx.globalAlpha = (1 - p) * 0.9;
                ctx.strokeStyle = r.color;
                ctx.lineWidth = 10 * (1 - p) + 1;
                ctx.beginPath();
                ctx.arc(r.x, r.y, r.radius * eased, 0, 6.2832);
                ctx.stroke();
            }
            s.rings = s.rings.filter((r) => r.life > 0);

            for (const p of s.particles) {
                p.life -= dt;
                if (p.kind === 'fly') {
                    const t = 1 - Math.max(0, p.life) / p.max;
                    const e = t * t * (3 - 2 * t);
                    const u = 1 - e;
                    p.x = u * u * p.sx + 2 * u * e * p.cx + e * e * p.tx;
                    p.y = u * u * p.sy + 2 * u * e * p.cy + e * e * p.ty;
                } else {
                    const drag = p.kind === 'confetti' ? 0.985 : 0.965;
                    p.vx *= drag;
                    p.vy = p.vy * drag + p.gravity * dt;
                    p.x += p.vx * dt;
                    p.y += p.vy * dt;
                    p.rot += p.vr * dt;
                    p.tumble += 9 * dt;
                }
                if (p.kind === 'confetti') continue;
                const a = Math.max(0, p.life / p.max);
                ctx.globalAlpha = p.kind === 'fly' ? Math.min(1, (1 - a) * 5, a * 6) : a;
                if (p.kind === 'spark') {
                    ctx.strokeStyle = p.color;
                    ctx.lineWidth = p.size;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
                    ctx.stroke();
                } else {
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, 6.2832);
                    ctx.fill();
                    ctx.globalAlpha *= 0.3;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * 2.6, 0, 6.2832);
                    ctx.fill();
                }
            }

            // Confetti is solid paper, drawn over the light.
            ctx.globalCompositeOperation = 'source-over';
            for (const p of s.particles) {
                if (p.kind !== 'confetti') continue;
                ctx.globalAlpha = Math.min(1, (p.life / p.max) * 2.5);
                ctx.fillStyle = p.color;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.scale(1, Math.cos(p.tumble));
                ctx.fillRect(-p.size, -p.size * 0.55, p.size * 2, p.size * 1.1);
                ctx.restore();
            }
            ctx.globalAlpha = 1;

            s.particles = s.particles.filter((p) => p.life > 0 && p.y < s.h + 60);

            if (s.particles.length || s.rings.length || now < s.rainUntil) {
                s.raf = requestAnimationFrame(frame);
            } else {
                ctx.clearRect(0, 0, s.w, s.h);
                s.raf = 0;
            }
        };

        const kick = () => {
            if (s.raf) return;
            s.last = performance.now();
            s.raf = requestAnimationFrame(frame);
        };

        return {
            burst(x, y, o) {
                for (let i = 0; i < o.count; i++) {
                    const dir = o.angle === undefined
                        ? Math.random() * 6.2832
                        : o.angle + (Math.random() - 0.5) * 2 * (o.spread ?? 0.5);
                    const v = o.speed * (0.35 + Math.random() * 0.65);
                    const life = o.life * (0.55 + Math.random() * 0.45);
                    push({
                        kind: o.shape ?? 'spark',
                        x, y, vx: Math.cos(dir) * v, vy: Math.sin(dir) * v,
                        life, max: life,
                        size: (o.size ?? 2) * (0.6 + Math.random() * 0.8),
                        color: o.colors[Math.floor(Math.random() * o.colors.length)],
                        gravity: o.gravity ?? 0,
                        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14, tumble: Math.random() * 6.28,
                        sx: 0, sy: 0, cx: 0, cy: 0, tx: 0, ty: 0,
                    });
                }
                kick();
            },
            ring(x, y, color, radius, life = 0.6) {
                s.rings.push({ x, y, color, radius, life, max: life });
                kick();
            },
            rain(colors, ms) {
                s.rainColors = colors;
                s.rainUntil = performance.now() + ms;
                kick();
            },
            fly(x, y, tx, ty, count, color) {
                for (let i = 0; i < count; i++) {
                    const life = 0.45 + Math.random() * 0.3;
                    const sx = x + (Math.random() - 0.5) * 80;
                    const sy = y + (Math.random() - 0.5) * 80;
                    push({
                        kind: 'fly',
                        x: sx, y: sy, vx: 0, vy: 0,
                        life, max: life,
                        size: 2.5 + Math.random() * 2.5, color, gravity: 0,
                        rot: 0, vr: 0, tumble: 0,
                        sx, sy,
                        // Bow the path outward so the coins arc, not beeline.
                        cx: (sx + tx) / 2 + (Math.random() - 0.5) * 220,
                        cy: (sy + ty) / 2 - 60 - Math.random() * 120,
                        tx, ty,
                    });
                }
                kick();
            },
            converge(x, y, radius, count, colors) {
                for (let i = 0; i < count; i++) {
                    const a = Math.random() * 6.2832;
                    const r = radius * (0.8 + Math.random() * 0.4);
                    const sx = x + Math.cos(a) * r;
                    const sy = y + Math.sin(a) * r;
                    const life = 0.38 + Math.random() * 0.22;
                    push({
                        kind: 'fly',
                        x: sx, y: sy, vx: 0, vy: 0,
                        life, max: life,
                        size: 1.3 + Math.random() * 1.6,
                        color: colors[Math.floor(Math.random() * colors.length)],
                        gravity: 0, rot: 0, vr: 0, tumble: 0,
                        sx, sy,
                        // Pull the path a quarter-turn round so the motes spiral in.
                        cx: x + Math.cos(a + 1.1) * r * 0.62,
                        cy: y + Math.sin(a + 1.1) * r * 0.62,
                        tx: x, ty: y,
                    });
                }
                kick();
            },
            clear() {
                s.particles = [];
                s.rings = [];
                s.rainUntil = 0;
            },
        };
    }, []);

    return <canvas ref={canvasRef} className={className} aria-hidden />;
});

export default FxCanvas;
