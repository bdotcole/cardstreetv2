/**
 * Weekly Vercel cron: push recently-changed EVERGREEN CONTENT to IndexNow.
 *
 * IndexNow was wired for listing writes only (app/api/listings, the
 * listing-created alert, lib/draftListings), because a listing is an event with
 * an obvious trigger. Guides and landing pages have no write event at all — they
 * ship in a deploy — so the six guides added in 4bd2481 had no way to reach
 * Bing except an organic crawl. Bing feeds ChatGPT's web answers, which is where
 * CardStreet has gone from zero mentions to being cited by URL, so waiting is
 * the expensive option.
 *
 * WHY A FRESHNESS WINDOW rather than submitting everything every week:
 * IndexNow is a "this changed" signal. Re-submitting unchanged URLs weekly is
 * noise at best and a reason to be ignored at worst. Each guide carries its own
 * hand-maintained `updated` date and each sitemap route its own `lastModified`,
 * so editing one page is what makes it eligible — and nothing else moves.
 *
 * Both locale variants are submitted: each is its own self-canonical indexable
 * URL (see lib/i18nRouting), exactly as submitCardIdsToIndexNow does for cards.
 *
 * Fails soft throughout — submitUrlsToIndexNow never throws, and indexing must
 * never be able to take a route down.
 */

import { NextRequest, NextResponse } from 'next/server';
import { GUIDES } from '@/lib/guides';
import { submitUrlsToIndexNow } from '@/lib/indexNow';
import { localizedUrl } from '@/lib/i18nRouting';

export const runtime = 'nodejs';

/**
 * How recently a page must have changed to be worth announcing. Comfortably
 * wider than the weekly schedule so a run that fails or is skipped does not
 * silently drop a new page on the floor.
 */
const FRESH_DAYS = 21;

/** Content routes with no per-item data source, kept in step with app/sitemap.ts. */
const STATIC_CONTENT: { path: string; updated: string }[] = [
    { path: '/guides', updated: '2026-08-30' },
];

function isFresh(iso: string, nowMs: number): boolean {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return false;
    return nowMs - t <= FRESH_DAYS * 24 * 60 * 60 * 1000;
}

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = Date.now();

    const fresh = [
        ...STATIC_CONTENT.filter((c) => isFresh(c.updated, now)).map((c) => c.path),
        ...GUIDES.filter((g) => isFresh(g.updated, now)).map((g) => `/guides/${g.slug}`),
    ];

    // Nothing changed recently is the normal steady state, not a problem.
    if (fresh.length === 0) {
        return NextResponse.json({ ok: true, submitted: 0, reason: 'no content changed within the freshness window' });
    }

    const urls = fresh.flatMap((path) => [localizedUrl(path, 'th'), localizedUrl(path, 'en')]);
    await submitUrlsToIndexNow(urls);

    console.log(`[IndexNow] content cron submitted ${urls.length} url(s) across ${fresh.length} page(s)`);
    return NextResponse.json({ ok: true, pages: fresh.length, submitted: urls.length, paths: fresh });
}
