import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
    buildProductByIdUrl,
    gradedRowsFromProduct,
    centsToUsd,
} from '@/lib/pricecharting';

// Weekly PriceCharting refresh. Graded + sealed prices move slowly, so this only
// re-fetches a bounded, stalest-first slice each run (by PriceCharting product id,
// so no re-matching). The initial backfill is the .mjs ingest; this keeps it fresh.
//
// Auth: Vercel Cron `Authorization: Bearer ${CRON_SECRET}` (same as the other crons).
// Needs PRICECHARTING_TOKEN in the Vercel env.

export const runtime = 'nodejs';
export const maxDuration = 60;

const GRADED_CAP = 400;   // mapped cards refreshed per run
const SEALED_CAP = 200;   // sealed products refreshed per run
const TIME_BUDGET_MS = 50_000;
const RATE_MS = 120;      // gentle pacing between PriceCharting calls

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: NextRequest) {
    if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = process.env.PRICECHARTING_TOKEN;
    if (!token) {
        return NextResponse.json({ error: 'PRICECHARTING_TOKEN not configured' }, { status: 503 });
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const started = Date.now();
    const overBudget = () => Date.now() - started > TIME_BUDGET_MS;

    async function fetchProduct(id: string) {
        await sleep(RATE_MS);
        const res = await fetch(buildProductByIdUrl(token!, id));
        if (!res.ok) throw new Error(`PriceCharting ${res.status}`);
        return res.json();
    }

    let gradedCards = 0, gradedRows = 0, sealedUpdated = 0;
    const errors: string[] = [];

    // --- Graded: stalest-mapped cards ------------------------------------------
    const { data: maps } = await supabase
        .from('pricecharting_map')
        .select('card_id, pricecharting_id')
        .order('last_priced_at', { ascending: true, nullsFirst: true })
        .limit(GRADED_CAP);

    // The market_values unique key includes language; reuse the card's market
    // language (ja -> jp) so refreshes update the same row the ingest wrote.
    const cardIds = (maps || []).map((m) => m.card_id);
    const langByCard = new Map<string, string>();
    if (cardIds.length) {
        const { data: cards } = await supabase
            .from('pokemon_cards')
            .select('id, language, game')
            .in('id', cardIds);
        for (const c of cards || []) langByCard.set(c.id, c.language === 'ja' ? 'jp' : (c.language || 'en'));
    }

    for (const m of maps || []) {
        if (overBudget()) break;
        try {
            const product = await fetchProduct(m.pricecharting_id);
            const lang = langByCard.get(m.card_id) || 'en';
            const rows = gradedRowsFromProduct(product).map((r) => ({
                card_id: m.card_id,
                language: lang,
                condition: r.condition,
                printing: null,
                market_avg: r.usd,
                currency: 'USD',
                last_updated: new Date().toISOString(),
            }));
            if (rows.length) {
                const { error } = await supabase.from('market_values').upsert(rows, { onConflict: 'card_id,language,condition' });
                if (error) throw error;
                gradedRows += rows.length;
            }
            await supabase.from('pricecharting_map').update({ last_priced_at: new Date().toISOString() }).eq('card_id', m.card_id);
            gradedCards++;
        } catch (e: any) {
            if (errors.length < 5) errors.push(`graded ${m.pricecharting_id}: ${e.message}`);
        }
    }

    // --- Sealed: stalest sealed products ---------------------------------------
    const { data: sealed } = await supabase
        .from('sealed_products')
        .select('id, pricecharting_id')
        .not('pricecharting_id', 'is', null)
        .order('last_updated', { ascending: true, nullsFirst: true })
        .limit(SEALED_CAP);

    for (const s of sealed || []) {
        if (overBudget()) break;
        try {
            const product = await fetchProduct(s.pricecharting_id);
            const { error } = await supabase.from('sealed_products').update({
                loose_price: centsToUsd(product['loose-price']),
                cib_price: centsToUsd(product['cib-price']),
                new_price: centsToUsd(product['new-price']),
                last_updated: new Date().toISOString(),
            }).eq('id', s.id);
            if (error) throw error;
            sealedUpdated++;
        } catch (e: any) {
            if (errors.length < 10) errors.push(`sealed ${s.pricecharting_id}: ${e.message}`);
        }
    }

    return NextResponse.json({
        success: true,
        gradedCards, gradedRows, sealedUpdated,
        elapsedMs: Date.now() - started,
        errors,
        timestamp: new Date().toISOString(),
    });
}
