import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { EXCHANGE_RATES } from '@/constants';

// Graded market prices for a single card.
//
// Sources, in precedence order per grade tier:
//   1. app_sale     — an actual graded sale on Cardstreet (official; overrides all).
//   2. market       — PriceCharting graded price (stored in market_values with a
//                     "PSA 10"-style condition, in USD).
//   3. thai_estimate — Thai Pokemon cards have no PriceCharting graded data, so we
//                     show 60% of a twin's graded price until a real Cardstreet sale
//                     exists for that card+grade. The twin is the JAPANESE card first
//                     (basis 'jp_twin'): a Thai set reprints a Japanese set 1:1 with
//                     the same numbering, so set code minus "-th" + collector number
//                     is the same card, the rule apply_thai_price_rule already uses.
//                     Only when that card has no graded prices does it fall back to
//                     the English card matched by name (basis 'en_name').
// A grade tier with none of the above is omitted (the UI renders blank, not a guess).
//
// Prices are returned in THB. PriceCharting/market_values rows are USD and converted.

export const runtime = 'nodejs';

// USD -> THB. EXCHANGE_RATES['USD'] is USD-per-THB (~0.028); invert for THB-per-USD.
const USD_TO_THB = 1 / (EXCHANGE_RATES['USD'] || 0.028);

// Thai graded = 60% of the English-equivalent graded price (interim, until a real sale).
const THAI_GRADED_FACTOR = 0.6;

// Order states where the buyer's money has been captured — i.e. a real sale at a
// real price. 'pending' isn't paid yet; 'cancelled'/'disputed' aren't settled.
const SOLD_STATUSES = ['paid', 'label_generated', 'shipped', 'in_transit', 'delivered', 'completed'];

// A graded condition looks like "PSA 10", "BGS 9.5", "CGC 10", "TAG 10".
const GRADED_CONDITION = /^(PSA|BGS|CGC|SGC|ARS|TAG)\s+(\d+(?:\.\d)?)$/i;

// Normalize a collector number for matching: drop the "/total" suffix, lowercase,
// strip leading zeros ("087/198" -> "87").
const normNum = (s: string) =>
    String(s || '').split('/')[0].toLowerCase().replace(/(\D)0+(?=\d)/, '$1').replace(/^0+(?=\d)/, '');

interface GradedPrice {
    company: string;   // PSA | BGS | CGC | SGC | ARS
    grade: number;     // 1.0 - 10.0
    label: string;     // e.g. "PSA 10"
    price: number;     // THB
    source: 'app_sale' | 'market' | 'thai_estimate';
    /** Which twin a thai_estimate came from. */
    basis?: 'jp_twin' | 'en_name';
}

// market_values graded rows for a card -> { "PSA 10": priceThb, ... }
async function gradedMarketByTier(supabase: any, cardId: string): Promise<Map<string, { company: string; grade: number; label: string; price: number }>> {
    const out = new Map<string, { company: string; grade: number; label: string; price: number }>();
    const { data: mv } = await supabase
        .from('market_values')
        .select('condition, market_avg, currency')
        .eq('card_id', cardId);
    for (const row of mv || []) {
        const m = GRADED_CONDITION.exec((row.condition || '').trim());
        if (!m || typeof row.market_avg !== 'number' || row.market_avg <= 0) continue;
        const company = m[1].toUpperCase();
        const grade = parseFloat(m[2]);
        const priceThb = row.currency === 'USD' ? Math.round(row.market_avg * USD_TO_THB) : Math.round(row.market_avg);
        out.set(`${company} ${grade}`, { company, grade, label: `${company} ${grade}`, price: priceThb });
    }
    return out;
}

// The Japanese twin of a Thai card: same set code without the "-th" suffix, same
// collector number, language 'ja'. Mirrors the join in apply_thai_price_rule
// (20260921b_thai_price_japanese_twin_band.sql). Null unless exactly one card
// matches; the whole set is read (a few hundred rows, indexed on set_id) so the
// number can be compared normalized ("014" vs "14/128").
//
// The 1:1 premise has exceptions: a Thai and a Japanese product can share a set
// code with different lineups (SVK, CLAUDE.md), and 601 of the 4,092 twins that
// carry an English name on both sides disagreed on it (2026-10-06). So when both
// names are known they must agree, or there is no twin.
async function japaneseTwinId(supabase: any, card: any): Promise<string | null> {
    if (!card.set_id || !card.number) return null;
    const jaSet = String(card.set_id).replace(/-th$/, '');
    const { data } = await supabase
        .from('pokemon_cards')
        .select('id, number, english_name')
        .eq('set_id', jaSet)
        .eq('language', 'ja')
        .eq('game', 'pokemon');
    const target = normNum(card.number);
    const hits = (data || []).filter((c: any) => normNum(c.number) === target);
    if (hits.length !== 1) return null;
    const thName = card.english_name;
    const jaName = hits[0].english_name;
    if (thName && jaName && !namesAgree(thName, jaName)) return null;
    return hits[0].id as string;
}

// Token overlap of two English card names, ignoring case, accents and punctuation
// ("Pikachu ex" vs "Pikachu EX" agree; "Mew ex" vs "Radiant Charizard" do not).
function namesAgree(a: string, b: string): boolean {
    const tokens = (s: string) => new Set(s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean));
    const A = tokens(a);
    const B = tokens(b);
    if (!A.size || !B.size) return false;
    let both = 0;
    for (const w of A) if (B.has(w)) both++;
    return both / Math.min(A.size, B.size) >= 0.6;
}

// Resolve the English-equivalent card id for a Thai card.
//
// Thai<->EN collector numbers don't reliably align and set_bridge is incomplete,
// so we match on the English NAME (Thai rows carry it in english_name; EN rows
// carry it in name) and disambiguate by which English print actually HAS graded
// data, then by collector number. Anything still ambiguous (e.g. "Pikachu", which
// has dozens of graded prints) returns null -> blank. A blank beats a wrong estimate.
async function englishEquivalentId(supabase: any, card: any): Promise<string | null> {
    const enName = (card.english_name || card.name || '').trim();
    if (!enName) return null;

    // Two exact (case-insensitive) lookups instead of a .or() string, so names with
    // apostrophes / commas / parentheses can't break PostgREST's filter parser.
    const [byName, byEnglishName] = await Promise.all([
        supabase.from('pokemon_cards').select('id, number').eq('game', 'pokemon').eq('language', 'en').ilike('name', enName),
        supabase.from('pokemon_cards').select('id, number').eq('game', 'pokemon').eq('language', 'en').ilike('english_name', enName),
    ]);
    const cand = new Map<string, any>();
    for (const c of [...(byName.data || []), ...(byEnglishName.data || [])]) cand.set(c.id, c);
    if (cand.size === 0) return null;

    const ids = [...cand.keys()];
    const { data: mv } = await supabase.from('market_values').select('card_id, condition').in('card_id', ids);
    const gradedIds = new Set(
        (mv || []).filter((r: any) => GRADED_CONDITION.test((r.condition || '').trim())).map((r: any) => r.card_id)
    );
    const graded = [...cand.values()].filter((c: any) => gradedIds.has(c.id));
    if (graded.length === 0) return null;
    if (graded.length === 1) return graded[0].id as string;

    // Multiple English prints carry graded data — disambiguate by collector number.
    const targetNum = normNum(card.number);
    const byNum = graded.filter((c: any) => normNum(c.number) === targetNum);
    return byNum.length === 1 ? (byNum[0].id as string) : null;
}

export async function GET(_request: Request, props: { params: Promise<{ cardId: string }> }) {
    try {
        const { cardId } = await props.params;
        if (!cardId) {
            return NextResponse.json({ error: 'Missing cardId' }, { status: 400 });
        }

        // Service role: aggregate completed-sale prices across all sellers (behind
        // per-user RLS on orders). Only the de-identified price is returned.
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        const { data: card } = await supabase
            .from('pokemon_cards')
            .select('id, language, game, set_id, number, english_name')
            .eq('id', cardId)
            .maybeSingle();

        // Keyed by `${company} ${grade}`; precedence app_sale > market/thai_estimate.
        const byTier = new Map<string, GradedPrice>();

        // --- Market: this card's own PriceCharting graded prices (EN / JA) ---------
        const ownMarket = await gradedMarketByTier(supabase, cardId);
        for (const [key, v] of ownMarket) {
            byTier.set(key, { ...v, source: 'market' });
        }

        // --- Thai estimate: 60% of the Japanese twin's graded prices, else the -----
        // --- English equivalent's ----------------------------------------------------
        if (card && card.language === 'th' && (card.game || 'pokemon') === 'pokemon' && byTier.size === 0) {
            let twinMarket = new Map<string, { company: string; grade: number; label: string; price: number }>();
            let basis: 'jp_twin' | 'en_name' = 'jp_twin';
            const jpId = await japaneseTwinId(supabase, card);
            if (jpId) twinMarket = await gradedMarketByTier(supabase, jpId);
            if (twinMarket.size === 0) {
                basis = 'en_name';
                const engId = await englishEquivalentId(supabase, card);
                if (engId) twinMarket = await gradedMarketByTier(supabase, engId);
            }
            for (const [key, v] of twinMarket) {
                byTier.set(key, {
                    company: v.company,
                    grade: v.grade,
                    label: v.label,
                    price: Math.round(v.price * THAI_GRADED_FACTOR),
                    source: 'thai_estimate',
                    basis,
                });
            }
        }

        // --- App sales (official, override) ----------------------------------------
        // Most recent settled order per (company, grade); its listing price in THB
        // becomes the official graded value, beating any market/estimate.
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
            const existing = byTier.get(key);
            // Rows are newest-first, so only the first (latest) app sale wins per tier.
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
