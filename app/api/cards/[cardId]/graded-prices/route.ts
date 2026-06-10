import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { EXCHANGE_RATES } from '@/constants';

// Graded market prices for a single card.
//
// Two sources, merged. An actual graded sale on CardStreet is the official price
// and overrides everything; otherwise we fall back to JustTCG's graded pricing
// (stored in market_values with a "PSA 10"-style condition). A grade tier with
// neither is omitted entirely so the UI can render blank rather than a guess.
//
// Prices are returned in THB (the catalog base currency). JustTCG rows price in
// USD and are converted; listing prices are already entered in THB.

export const runtime = 'nodejs';

// USD -> THB. THB is the base (rate 1), USD is 0.028 THB-per-USD inverse.
const USD_TO_THB = 1 / (EXCHANGE_RATES['USD'] || 0.028);

// Order states where the buyer's money has been captured — i.e. a real sale at a
// real price. 'pending' isn't paid yet; 'cancelled'/'disputed' aren't settled.
const SOLD_STATUSES = ['paid', 'label_generated', 'shipped', 'in_transit', 'delivered', 'completed'];

// A JustTCG graded condition looks like "PSA 10", "BGS 9.5", "CGC 10".
const GRADED_CONDITION = /^(PSA|BGS|CGC|ARS)\s+(\d+(?:\.\d)?)$/i;

interface GradedPrice {
    company: string;   // PSA | BGS | CGC | ARS
    grade: number;     // 1.0 - 10.0
    label: string;     // e.g. "PSA 10"
    price: number;     // THB
    source: 'app_sale' | 'justtcg';
}

export async function GET(_request: Request, props: { params: Promise<{ cardId: string }> }) {
    try {
        const { cardId } = await props.params;
        if (!cardId) {
            return NextResponse.json({ error: 'Missing cardId' }, { status: 400 });
        }

        // Service role: we aggregate completed-sale prices across all sellers, which
        // sits behind per-user RLS on orders. Only the de-identified price is returned.
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Keyed by `${company} ${grade}`; app_sale wins over justtcg for the same key.
        const byTier = new Map<string, GradedPrice>();

        // --- JustTCG graded prices (fallback) ---------------------------------
        const { data: mv } = await supabase
            .from('market_values')
            .select('condition, market_avg, currency')
            .eq('card_id', cardId);

        for (const row of mv || []) {
            const m = GRADED_CONDITION.exec((row.condition || '').trim());
            if (!m || typeof row.market_avg !== 'number' || row.market_avg <= 0) continue;
            const company = m[1].toUpperCase();
            const grade = parseFloat(m[2]);
            const priceThb = row.currency === 'USD'
                ? Math.round(row.market_avg * USD_TO_THB)
                : Math.round(row.market_avg);
            byTier.set(`${company} ${grade}`, { company, grade, label: `${company} ${grade}`, price: priceThb, source: 'justtcg' });
        }

        // --- App sales (official, override) -----------------------------------
        // Most recent settled order per (company, grade); its listing price in THB
        // becomes the official graded value.
        const { data: sales } = await supabase
            .from('orders')
            .select('created_at, status, listings!inner(card_id, is_graded, grading_company, grade, price)')
            .eq('listings.card_id', cardId)
            .eq('listings.is_graded', true)
            .in('status', SOLD_STATUSES)
            .order('created_at', { ascending: false });

        for (const order of sales || []) {
            const listing: any = Array.isArray(order.listings) ? order.listings[0] : order.listings;
            if (!listing?.grading_company || listing.grade == null || typeof listing.price !== 'number') continue;
            const company = String(listing.grading_company).toUpperCase();
            const grade = Number(listing.grade);
            const key = `${company} ${grade}`;
            // Rows are newest-first, so only set the first (latest) sale per tier.
            const existing = byTier.get(key);
            if (existing?.source === 'app_sale') continue;
            byTier.set(key, { company, grade, label: key, price: Math.round(listing.price), source: 'app_sale' });
        }

        // Sort by company then descending grade for a stable, readable order.
        const prices = [...byTier.values()].sort((a, b) =>
            a.company === b.company ? b.grade - a.grade : a.company.localeCompare(b.company)
        );

        return NextResponse.json(
            { prices },
            { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } }
        );
    } catch (error: any) {
        console.error('[GradedPrices] Error:', error);
        return NextResponse.json({ prices: [] }, { status: 500 });
    }
}
