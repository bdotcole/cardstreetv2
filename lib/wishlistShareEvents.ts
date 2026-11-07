'use client';

/**
 * GA4 events for the wishlist share funnel: how many people make a link, how
 * many send it on, and through which channel. The holiday promotion is judged
 * on these plus the page views of /wishlist/* that the GA tag already records.
 *
 * Not added to lib/engagementEvents.ts on purpose: that set deliberately
 * mirrors the rewards ledger's rule keys, and sharing earns no XP.
 */

import { Capacitor } from '@capacitor/core';
import { sendGAEvent } from '@next/third-parties/google';

export type WishlistShareEvent = 'wishlist_share_link' | 'wishlist_share';
export type WishlistShareChannel = 'system' | 'copy' | 'line' | 'facebook' | 'x';

function surface(): 'native_app' | 'web' {
    try {
        return Capacitor.isNativePlatform() ? 'native_app' : 'web';
    } catch {
        return 'web';
    }
}

export function trackWishlistShare(
    name: WishlistShareEvent,
    params: { channel?: WishlistShareChannel; cards?: number } = {},
): void {
    if (typeof window === 'undefined') return;
    try {
        sendGAEvent('event', name, {
            ...(params.channel ? { channel: params.channel } : {}),
            ...(typeof params.cards === 'number' ? { cards: params.cards } : {}),
            surface: surface(),
        });
    } catch {
        // GA not loaded.
    }
}
