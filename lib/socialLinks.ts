/**
 * Short tracked links for Cardstreet's social bios: cardstreet.app/ig, /fb,
 * /yt, /tt.
 *
 * Each one 302s to the homepage with the utm_* pair the Social dashboard
 * attributes by: utm_source = the platform, utm_medium = where the link sits
 * (bio / page / video). GA4 ranks utm_source above the referrer, so a tap
 * from an in-app browser that strips the referrer (Instagram's does) is
 * still credited to the right platform.
 *
 * Incoming query params win over the defaults (/ig?utm_medium=story) and
 * anything else rides along (?card=... deep links). 302, never 301: the
 * targets may change and a 301 is cached by browsers for good. Never cached
 * for the same reason.
 *
 * These paths are not in middleware's matcher, so they skip the desktop
 * rewrite and locale logic (same as /watch) and resolve as plain routes.
 * The link table itself lives in lib/social/shortLinks.ts (client-safe).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/lib/stripe';
import { shortLinkFor, shortLinkPath, type ShortLink } from '@/lib/social/shortLinks';

/** The public short URL, e.g. https://cardstreet.app/ig */
export function shortLinkUrl(slug: string): string {
    return `${getAppBaseUrl()}${shortLinkPath(slug)}`;
}

/** The homepage URL the short link resolves to, with the tracking params filled in. */
export function shortLinkTarget(link: ShortLink, incoming?: URLSearchParams): string {
    const params = new URLSearchParams();
    params.set('utm_source', link.source);
    params.set('utm_medium', link.medium);
    if (incoming) for (const [k, v] of incoming) params.set(k, v);
    return `${getAppBaseUrl()}/?${params.toString()}`;
}

export function shortLinkResponse(slug: string, request: NextRequest): NextResponse {
    const link = shortLinkFor(slug);
    if (!link) return NextResponse.json({ error: 'Unknown link' }, { status: 404 });
    return NextResponse.redirect(shortLinkTarget(link, new URL(request.url).searchParams), {
        status: 302,
        headers: { 'Cache-Control': 'no-store' },
    });
}
