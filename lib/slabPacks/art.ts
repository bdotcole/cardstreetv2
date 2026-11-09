'use client';

/**
 * Slab Packs — card art that is ready before it is needed.
 *
 * A card's large image is around 100 KB and takes a moment to arrive and to
 * decode on a phone. Asking for it only when the slab turns over, or when a
 * hit is tapped, leaves an empty case on screen at the one moment the art
 * matters. This module fetches and decodes ahead of time, remembers what is
 * ready, and holds on to the decoded images so the browser does not have to
 * decode them a second time when the <img> mounts.
 */

import { slabImage } from './pool';
import type { Slab } from './types';

type ArtSize = 'small' | 'large';
type ArtOf = Pick<Slab, 'cardId' | 'image'>;

const ready = new Set<string>();
const pending = new Map<string, Promise<void>>();
// Holding the Image keeps its decoded bitmap warm. Oldest out first.
const warm = new Map<string, HTMLImageElement>();
const WARM_CAP = 32;

/** True once the art has been fetched and decoded in this session. */
export function isArtReady(slab: ArtOf, size: ArtSize): boolean {
    return ready.has(slabImage(slab, size));
}

/** Fetch and decode a card's art. Resolves when it can be painted at once; never rejects. */
export function preloadArt(slab: ArtOf, size: ArtSize): Promise<void> {
    if (typeof Image === 'undefined') return Promise.resolve();
    const url = slabImage(slab, size);
    if (ready.has(url)) return Promise.resolve();
    const running = pending.get(url);
    if (running) return running;

    const task = new Promise<void>((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        const settle = (ok: boolean) => {
            pending.delete(url);
            if (ok) {
                ready.add(url);
                warm.set(url, img);
                if (warm.size > WARM_CAP) {
                    const oldest = warm.keys().next();
                    if (!oldest.done) warm.delete(oldest.value);
                }
            }
            resolve();
        };
        img.onload = () => {
            // decode() is what makes the first paint instant. A decode that
            // fails still leaves a loaded image, which paints a frame later.
            if (typeof img.decode === 'function') img.decode().then(() => settle(true), () => settle(true));
            else settle(true);
        };
        img.onerror = () => settle(false);
        img.src = url;
    });
    pending.set(url, task);
    return task;
}
