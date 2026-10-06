import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { mapSealedRowToProduct, type SealedProductRow } from '@/lib/sealedProduct';
import { mergeSealedJustTcgHistory, type MergeSummary } from '@/lib/justtcgSealed';

// Daily market-value snapshot -> price_snapshots. Builds the real "Price Over Time"
// series forward (PriceCharting supplies no history). Captures every sealed product,
// every single that currently has an active listing, and a change point for every
// Thai or sale-priced card whose price moved. PriceCharting-priced cards get their
// change points from /api/cron/pricecharting as it writes the price. Idempotent within a
// UTC day via the (subject_id, language, condition, captured_on) unique constraint.
//
// Sealed products bridged to JustTCG (sealed_products.justtcg_id, see
// lib/justtcgSealed.ts) then get the last 7 days of REAL TCGplayer history merged
// over the PriceCharting rows written above — PriceCharting's sealed prices move
// rarely, so on their own the series drew a flat line. Runs last so a JustTCG
// outage still leaves today's PriceCharting point in place.
//
// Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}` (same as the other crons).

export const runtime = 'nodejs';
export const maxDuration = 300;

const TIME_BUDGET_MS = 250_000;
const PAGE = 1000;

// Same columns the card page selects so mapSupabaseCardToInternal derives the exact
// headline market price the UI shows (raw_data->tcgplayer is the price fallback).
const CATALOG_SELECT =
    'id, name, english_name, set_id, number, rarity, image_small, image_large, language, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(condition, language, market_avg, currency, last_updated)';

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
    const summary = { sealed: 0, singles: 0, changed: 0, written: 0, errors: 0 };
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
    const listedIds = new Set<string>();
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
        for (const id of singleIds) listedIds.add(id);

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

    // ── Every other priced card that PriceCharting does not chart ────────────────
    // /api/cron/pricecharting writes a chart point whenever a card's loose price
    // moves, which covers every PriceCharting-priced card. Two kinds of card fall
    // outside it, and they are charted here instead:
    //   - Thai cards: PriceCharting has no Thai catalog; their prices are derived
    //     from the Japanese/English twins and from Thai sales.
    //   - cards whose price is pinned by our own sales or an admin
    //     (market_values.source 'cardstreet' / 'admin'), where the guard trigger
    //     keeps that price rather than the vendor's.
    // A point is written only when the headline price differs from the card's newest
    // stored point (change points; /api/price-history forward-fills the gaps), so
    // this does not add a row per card per day. Listed cards are captured daily above.
    try {
        const candidates = new Set<string>();
        let lastId: string | null = null;
        while (!overBudget()) {
            let q = supabase.from('pokemon_cards').select('id').eq('language', 'th').order('id').limit(PAGE);
            if (lastId) q = q.gt('id', lastId);
            const { data, error } = await q;
            if (error) throw error;
            if (!data?.length) break;
            for (const r of data) candidates.add(r.id);
            lastId = data[data.length - 1].id;
            if (data.length < PAGE) break;
        }
        let lastMv: string | null = null;
        while (!overBudget()) {
            let q = supabase.from('market_values').select('id, card_id')
                .in('source', ['cardstreet', 'admin']).order('id').limit(PAGE);
            if (lastMv) q = q.gt('id', lastMv);
            const { data, error } = await q;
            if (error) throw error;
            if (!data?.length) break;
            for (const r of data) if (r.card_id && !String(r.card_id).startsWith('pc-')) candidates.add(r.card_id);
            lastMv = data[data.length - 1].id;
            if (data.length < PAGE) break;
        }
        const ids = [...candidates].filter((id) => !listedIds.has(id));

        for (let i = 0; i < ids.length && !overBudget(); i += 200) {
            const batch = ids.slice(i, i + 200);
            const [{ data: cards, error: cErr }, { data: latest, error: lErr }] = await Promise.all([
                supabase.from('pokemon_cards').select(CATALOG_SELECT).in('id', batch),
                supabase.rpc('latest_price_snapshots', { p_ids: batch, p_condition: 'Market' }),
            ]);
            if (cErr) throw cErr;
            // Without the comparison every card would get a point every day, so the
            // leg stops until 20261006_pricecharting_consolidation.sql is applied.
            if (lErr) throw new Error(`latest_price_snapshots: ${lErr.message}`);
            const prev = new Map<string, number>();
            for (const p of (latest || []) as Array<{ subject_id: string; language: string; market_thb: number }>) {
                prev.set(`${p.subject_id}|${p.language}`, Math.round(Number(p.market_thb)));
            }
            for (const row of cards || []) {
                const card = mapSupabaseCardToInternal(row);
                if (!(card.marketPrice > 0)) continue;
                const language = (row as { language?: string }).language || card.language || 'en';
                const thb = Math.round(card.marketPrice);
                if (prev.get(`${card.id}|${language}`) === thb) continue;
                rows.push({
                    subject_id: card.id,
                    language,
                    condition: 'Market',
                    is_sealed: false,
                    market_thb: thb,
                    market_native: null,
                    currency: 'THB',
                    source: 'catalog',
                    captured_on: capturedOn,
                });
                summary.changed++;
            }
        }
    } catch (e: unknown) {
        summary.errors++;
        Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: 'price-snapshots', leg: 'changed' } });
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

    // ── Sealed, JustTCG leg: real TCGplayer daily history for bridged products ──
    // Fails soft: no key, missing bridge columns, or an API error all leave the
    // PriceCharting points above untouched.
    let justtcg: MergeSummary | { enabled: false; reason: string } = { enabled: false, reason: 'JUSTTCG_API_KEY unset' };
    if (process.env.JUSTTCG_API_KEY) {
        try {
            justtcg = await mergeSealedJustTcgHistory(supabase, {
                apiKey: process.env.JUSTTCG_API_KEY,
                overBudget,
                duration: '7d',
            });
            if (justtcg.enabled && justtcg.errors.length) {
                Sentry.captureMessage(`price-snapshots justtcg leg: ${justtcg.errors[0]}`, { level: 'warning', tags: { cron: 'price-snapshots', leg: 'justtcg' } });
            }
        } catch (e: unknown) {
            summary.errors++;
            Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { tags: { cron: 'price-snapshots', leg: 'justtcg' } });
        }
    }

    return NextResponse.json({ ok: true, ...summary, justtcg, tookMs: Date.now() - started });
}
