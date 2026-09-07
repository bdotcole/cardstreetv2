import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeMarketThb } from '@/lib/cardMapper';

/**
 * Nightly resync of the market price frozen into each listing's card snapshot.
 *
 * listings.card_data is written once, at listing time, and deal_ratio is a stored
 * generated column over card_data->>'marketPrice' (20260702_listing_deal_ratio.sql).
 * Nothing refreshed the snapshot afterwards (the migration comment said the mirror
 * cron did; it only rewrites images), so the deal badge, the Best Deals sort, and
 * the listing page's chart endpoint all read a market price from the day the seller
 * listed. A card whose market fell from 1,539 to 467 baht stayed a "-74%" deal for
 * months; several "deals" were 2-3x above the live market.
 *
 * This walks every active and draft listing, recomputes the THB market price with
 * the same helper the card mapper uses (so the grid and the catalog agree), and
 * rewrites marketPrice + prices.* when it moved by more than 1%. A card with no
 * live price gets marketPrice 0, which nulls deal_ratio: no badge, sorted last in
 * deals. Sealed listings are left alone (they price from sealed_products).
 *
 * Runs after the Thai rule (03:45 UTC) and PriceCharting (03:00 UTC).
 * Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}`.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const TIME_BUDGET_MS = 250_000;
const PAGE = 500;
const CHUNK = 150;

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const admin = createAdminClient();
    const started = Date.now();
    const summary = { scanned: 0, updated: 0, unchanged: 0, unpriced: 0, skipped: 0, errors: 0, truncated: false };

    for (let offset = 0; ; offset += PAGE) {
        if (Date.now() - started > TIME_BUDGET_MS) { summary.truncated = true; break; }
        const { data: listings, error } = await admin
            .from('listings')
            .select('id, card_id, card_data')
            .in('status', ['active', 'draft'])
            .order('created_at', { ascending: true })
            .range(offset, offset + PAGE - 1);
        if (error) {
            Sentry.captureException(new Error(`refresh-listing-snapshots page failed: ${error.message}`));
            return NextResponse.json({ ok: false, error: error.message, ...summary }, { status: 500 });
        }
        if (!listings || listings.length === 0) break;

        const singles = listings.filter((l: any) => l.card_id && !(l.card_data as any)?.isSealed);
        summary.skipped += listings.length - singles.length;
        summary.scanned += singles.length;

        for (let i = 0; i < singles.length; i += CHUNK) {
            const chunk = singles.slice(i, i + CHUNK);
            const ids = Array.from(new Set(chunk.map((l: any) => l.card_id as string)));
            const { data: cards, error: cardsError } = await admin
                .from('pokemon_cards')
                .select('id, tcgplayer:raw_data->tcgplayer, market_values(condition, market_avg, currency, last_updated)')
                .in('id', ids);
            if (cardsError) { summary.errors++; continue; }
            const byId = new Map((cards || []).map((c: any) => [c.id, c]));

            for (const l of chunk as any[]) {
                const card = byId.get(l.card_id);
                if (!card) { summary.skipped++; continue; }
                const { marketThb, lastUpdated } = computeMarketThb(card);
                const next = Math.round(marketThb * 100) / 100;
                const cd = (l.card_data || {}) as any;
                const prev = Number(cd.marketPrice) || 0;
                if (next <= 0) summary.unpriced++;
                const moved = prev <= 0 ? next > 0 : Math.abs(next - prev) / prev > 0.01;
                if (!moved && !(prev > 0 && next <= 0)) { summary.unchanged++; continue; }

                const prices = { ...(cd.prices || {}), market: next, low: next, mid: next, high: next, lastUpdated: lastUpdated || cd.prices?.lastUpdated || null };
                const { error: upErr } = await admin
                    .from('listings')
                    .update({ card_data: { ...cd, marketPrice: next, prices } })
                    .eq('id', l.id);
                if (upErr) summary.errors++; else summary.updated++;
            }
        }
        if (listings.length < PAGE) break;
    }

    return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
