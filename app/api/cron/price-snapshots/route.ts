import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { mapSealedRowToProduct, type SealedProductRow } from '@/lib/sealedProduct';

// Daily market-value snapshot -> price_snapshots. Builds the real "Price Over Time"
// series forward (PriceCharting supplies no history). Captures a bounded, chart-worthy
// slice: every sealed product, plus every single that currently has an active listing
// (exactly the subjects whose /card/[id] page renders a chart). Idempotent within a
// UTC day via the (subject_id, language, condition, captured_on) unique constraint.
//
// Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}` (same as the other crons).

export const runtime = 'nodejs';
export const maxDuration = 300;

const TIME_BUDGET_MS = 250_000;
const PAGE = 1000;

// Same columns the card page selects so mapSupabaseCardToInternal derives the exact
// headline market price the UI shows (raw_data->tcgplayer is the price fallback).
const CATALOG_SELECT =
    'id, name, english_name, set_id, number, rarity, image_small, image_large, language, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(condition, market_avg, currency, last_updated)';

interface SnapshotRow {
    subject_id: string;
    language: string;
    condition: string;
    is_sealed: boolean;
    market_thb: number;
    market_native: number | null;
    currency: string;
    source: string;
    captured_on: string;
}

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const started = Date.now();
    const overBudget = () => Date.now() - started > TIME_BUDGET_MS;
    const capturedOn = new Date().toISOString().slice(0, 10); // UTC date, matches the column default
    const summary = { sealed: 0, singles: 0, written: 0, errors: 0 };
    const rows: SnapshotRow[] = [];

    // ── Sealed: one headline point per product (condition='Sealed') ──────────────
    try {
        for (let from = 0; !overBudget(); from += PAGE) {
            const { data, error } = await supabase
                .from('sealed_products')
                .select('id, game, language, set_id, name, product_type, image_url, pricecharting_id, loose_price, cib_price, new_price, currency, last_updated')
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw error;
            if (!data?.length) break;
            for (const r of data as SealedProductRow[]) {
                const thb = mapSealedRowToProduct(r, null).price; // already THB base
                if (typeof thb === 'number' && thb > 0) {
                    rows.push({
                        subject_id: r.id,
                        language: r.language || 'en',
                        condition: 'Sealed',
                        is_sealed: true,
                        market_thb: Math.round(thb),
                        market_native: r.new_price ?? r.cib_price ?? r.loose_price ?? null,
                        currency: r.currency || 'USD',
                        source: 'pricecharting',
                        captured_on: capturedOn,
                    });
                    summary.sealed++;
                }
            }
            if (data.length < PAGE) break;
        }
    } catch (e: unknown) {
        summary.errors++;
        Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: 'price-snapshots', leg: 'sealed' } });
    }

    // ── Singles: headline market price for cards with an active listing ──────────
    try {
        const { data: listingRows, error } = await supabase
            .from('listings')
            .select('card_id')
            .eq('status', 'active');
        if (error) throw error;
        // pc-* ids are sealed listings, already captured above.
        const singleIds = Array.from(
            new Set((listingRows || []).map((l: { card_id: string }) => l.card_id).filter(Boolean)),
        ).filter((id) => !String(id).startsWith('pc-'));

        for (let i = 0; i < singleIds.length && !overBudget(); i += 200) {
            const batch = singleIds.slice(i, i + 200);
            const { data: cards, error: cErr } = await supabase
                .from('pokemon_cards')
                .select(CATALOG_SELECT)
                .in('id', batch);
            if (cErr) throw cErr;
            for (const row of cards || []) {
                const card = mapSupabaseCardToInternal(row);
                if (card.marketPrice > 0) {
                    rows.push({
                        subject_id: card.id,
                        language: (row as { language?: string }).language || card.language || 'en',
                        condition: 'Market',
                        is_sealed: false,
                        market_thb: Math.round(card.marketPrice),
                        market_native: null,
                        currency: 'THB',
                        source: 'catalog',
                        captured_on: capturedOn,
                    });
                    summary.singles++;
                }
            }
        }
    } catch (e: unknown) {
        summary.errors++;
        Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: 'price-snapshots', leg: 'singles' } });
    }

    // ── Upsert (idempotent on the daily key) ────────────────────────────────────
    for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase
            .from('price_snapshots')
            .upsert(batch, { onConflict: 'subject_id,language,condition,captured_on' });
        if (error) {
            summary.errors++;
            Sentry.captureException(new Error(`price-snapshots upsert: ${error.message}`), { tags: { cron: 'price-snapshots', leg: 'upsert' } });
        } else {
            summary.written += batch.length;
        }
    }

    return NextResponse.json({ ok: true, ...summary, tookMs: Date.now() - started });
}
