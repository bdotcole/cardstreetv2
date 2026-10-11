/**
 * Stale-listing reprice nudge — Tuesday 12:00 UTC (19:00 Bangkok), weekly.
 *
 * The audit measured 146 of 222 active listings above their own market
 * snapshot, and 0 listings created in the preceding 7 days. Nothing ever told a
 * seller their card had sat unsold for a month at a price no buyer was going to
 * pay, so the marketplace's inventory quietly aged into a catalogue of things
 * priced not to sell.
 *
 * Both conditions must hold: OLDER THAN 30 DAYS *and* ABOVE 1.1x MARKET. Age
 * alone is not a fault — a fairly-priced card can simply be waiting for the
 * right buyer, and telling that seller to cut the price would be bad advice
 * dressed as a service.
 *
 * Skips anything whose market value is the 10-baht placeholder
 * (lib/listingPriceGuidance repriceTarget returns 0), so a card the pricing
 * pipeline has no real number for is never "repriced" down to the floor.
 *
 * One nudge per listing per run, one run per week, and a listing that has
 * already been nudged in the last 30 days is skipped — an unchanged listing
 * must not generate a weekly reminder forever.
 *
 * Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendStaleListingNudge } from '@/lib/courier';
import { OVER_MARKET_WARN_RATIO, repriceTarget } from '@/lib/listingPriceGuidance';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PAGE = 1000;
const MIN_AGE_DAYS = 30;
/** Do not re-nudge the same listing inside this window. */
const RENUDGE_COOLDOWN_DAYS = 30;
const MAX_SENDS = 200;
const TIME_BUDGET_MS = 250_000;

interface ListingRow {
    id: string;
    seller_id: string;
    card_id: string;
    price: number;
    created_at: string;
    stale_nudged_at: string | null;
    card_data: { name?: string; marketPrice?: number } | null;
}

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const started = Date.now();
    const cutoff = new Date(Date.now() - MIN_AGE_DAYS * 864e5).toISOString();
    const cooldown = new Date(Date.now() - RENUDGE_COOLDOWN_DAYS * 864e5).toISOString();

    try {
        const rows: ListingRow[] = [];
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await admin
                .from('listings')
                .select('id, seller_id, card_id, price, created_at, stale_nudged_at, card_data')
                .eq('status', 'active')
                .lt('created_at', cutoff)
                .order('created_at', { ascending: true })
                .range(from, from + PAGE - 1)
                .returns<ListingRow[]>();
            if (error) {
                // 42703 = stale_nudged_at column missing (migration not applied).
                // Quiet no-op rather than a weekly error, matching the other
                // migration-tolerant crons.
                if (error.code === '42703') {
                    console.log('[Cron/StaleListings] stale_nudged_at not present yet — skipping');
                    return NextResponse.json({ ok: false, sent: 0 });
                }
                throw new Error(`listings: ${error.message}`);
            }
            rows.push(...(data ?? []));
            if (!data || data.length < PAGE) break;
        }

        const candidates = rows
            .map((r) => {
                const market = r.card_data?.marketPrice;
                const suggested = repriceTarget(market);
                if (suggested <= 0) return null;
                const price = Number(r.price);
                if (!Number.isFinite(price) || price <= 0) return null;
                if (price / (market as number) <= OVER_MARKET_WARN_RATIO) return null;
                // Nothing to suggest if the "fix" is not actually lower.
                if (suggested >= price) return null;
                if (r.stale_nudged_at && r.stale_nudged_at > cooldown) return null;
                return {
                    row: r,
                    suggested,
                    ageDays: Math.floor((Date.now() - new Date(r.created_at).getTime()) / 864e5),
                };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);

        // One listing per seller per run. A seller with 40 stale listings should
        // get one nudge, not 40 pushes.
        const perSeller = new Map<string, (typeof candidates)[number]>();
        for (const c of candidates) {
            const prev = perSeller.get(c.row.seller_id);
            // The worst offender first: oldest, then furthest above market.
            if (!prev || c.ageDays > prev.ageDays) perSeller.set(c.row.seller_id, c);
        }
        const targets = [...perSeller.values()].slice(0, MAX_SENDS);

        // ?dryRun=1 counts and sends nothing — see the note in vault-demand.
        const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
        if (dryRun) {
            console.log(`[Cron/StaleListings] DRY RUN — ${candidates.length} stale, would nudge ${targets.length} seller(s)`);
            return NextResponse.json({ ok: true, dryRun: true, stale: candidates.length, sellers: targets.length, push: 0, email: 0 });
        }

        let push = 0;
        let email = 0;
        const nudged: string[] = [];
        const SEND_CHUNK = 10;
        for (let i = 0; i < targets.length; i += SEND_CHUNK) {
            if (Date.now() - started > TIME_BUDGET_MS) break;
            const slice = targets.slice(i, i + SEND_CHUNK);
            const results = await Promise.allSettled(
                slice.map((c) =>
                    sendStaleListingNudge(c.row.seller_id, {
                        listingId: c.row.id,
                        cardId: c.row.card_id,
                        cardName: c.row.card_data?.name || c.row.card_id,
                        currentPrice: Number(c.row.price),
                        suggestedPrice: c.suggested,
                        ageDays: c.ageDays,
                    }),
                ),
            );
            results.forEach((r, idx) => {
                if (r.status !== 'fulfilled' || r.value === false) return;
                if (r.value === 'push') push++;
                else email++;
                nudged.push(slice[idx].row.id);
            });
        }

        // Stamp only what actually went out, so a failed send is retried next
        // week rather than silently consuming the cooldown.
        if (nudged.length > 0) {
            const { error: stampErr } = await admin
                .from('listings')
                .update({ stale_nudged_at: new Date().toISOString() })
                .in('id', nudged);
            if (stampErr) console.error('[Cron/StaleListings] stamp failed:', stampErr.message);
        }

        console.log(
            `[Cron/StaleListings] ${candidates.length} stale+overpriced, ${targets.length} seller(s): ${push} push, ${email} email`,
        );
        return NextResponse.json({ ok: true, stale: candidates.length, push, email });
    } catch (err) {
        console.error('[Cron/StaleListings] error:', err);
        return NextResponse.json({ ok: false, push: 0, email: 0 });
    }
}
