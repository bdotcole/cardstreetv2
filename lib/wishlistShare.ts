// Shareable wishlists (supabase/migrations/20261107_wishlist_shares.sql).
//
// The client helpers behind the share sheet, plus the pure bits the server
// page shares with it: the link path, the gift-season window and the shape of
// a shared wishlist. No 'use client' and no next/* imports, so the SPA shell,
// the desktop panel and the server-rendered /wishlist/<token> page can all
// import it.

import type { Card } from '@/types';

export interface WishlistShareState {
    /** False until the migration has run; the sheet says sharing is not available yet. */
    available: boolean;
    enabled: boolean;
    token: string | null;
    /** App-relative link, `/wishlist/<token>`, while enabled. */
    path: string | null;
}

export interface PublicWishlistOwner {
    id: string;
    /** display_name, else username; null when the profile has neither (the page localizes the fallback). */
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
}

export interface PublicWishlistCard {
    card: Card;
    addedAt: string;
    /** Cheapest active listing and how many shops have one; null when nobody is selling it. */
    available: { fromPrice: number; sellers: number } | null;
}

export interface PublicWishlist {
    owner: PublicWishlistOwner;
    sharedAt: string | null;
    /** Available-to-buy cards first, then the rest, each group newest first. */
    cards: PublicWishlistCard[];
    availableCount: number;
    /** Every card on the list, including any beyond the page's display cap. */
    totalCards: number;
}

/** Cards shown on one shared page. Lists this long are rare, and the page is for a gift-giver, not an audit. */
export const PUBLIC_WISHLIST_MAX_CARDS = 200;

export function wishlistSharePath(token: string): string {
    return `/wishlist/${encodeURIComponent(token)}`;
}

/**
 * The gift-giving window the copy leans into: November through the first days
 * of January, which covers Christmas and the Thai New Year gift exchanges. The
 * share message and the public page switch to neutral wording outside it, so
 * nothing needs editing when the season ends.
 */
export function isGiftSeason(now: Date = new Date()): boolean {
    const month = now.getMonth();
    return month >= 10 || (month === 0 && now.getDate() <= 10);
}

const UNAVAILABLE: WishlistShareState = { available: false, enabled: false, token: null, path: null };

async function parseState(res: Response): Promise<WishlistShareState | null> {
    if (res.status === 503) return UNAVAILABLE;
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<WishlistShareState>;
    return {
        available: body.available !== false,
        enabled: body.enabled === true,
        token: body.token ?? null,
        path: body.path ?? null,
    };
}

/** The signed-in user's share link, if any. Null on a network or auth failure. */
export async function fetchWishlistShare(signal?: AbortSignal): Promise<WishlistShareState | null> {
    try {
        const res = await fetch('/api/wishlist/share', { credentials: 'include', cache: 'no-store', signal });
        return await parseState(res);
    } catch {
        return null;
    }
}

/** Create the link, or turn sharing back on under a fresh token. Null on failure. */
export async function enableWishlistShare(): Promise<WishlistShareState | null> {
    try {
        const res = await fetch('/api/wishlist/share', { method: 'POST', credentials: 'include' });
        return await parseState(res);
    } catch {
        return null;
    }
}

/** Turn the link off. The next enable mints a new token, so this one stays dead. */
export async function disableWishlistShare(): Promise<boolean> {
    try {
        const res = await fetch('/api/wishlist/share', { method: 'DELETE', credentials: 'include' });
        return res.ok;
    } catch {
        return false;
    }
}
