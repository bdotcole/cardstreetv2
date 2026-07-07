/**
 * Feature B: API -> Internal Market-Price Switchover — shared helpers.
 *
 * A realized sale is recorded into `market_value_sales` and the DB recompute
 * function materializes a `source='cardstreet'` price into `market_values` (or,
 * for Thai sealed, into `sealed_products`). This module derives the sale's
 * condition key + THB->USD conversion and drives the record/recompute from the
 * fulfillment path.
 *
 * Server-only (imports the service-role Supabase client from the caller). Never
 * import from a 'use client' module.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { EXCHANGE_RATES } from '@/constants';

// Same constant the display mapper converts back with (cardMapper.ts:6), so a
// THB sale -> USD store -> THB display round-trip is lossless in aggregate.
// EXCHANGE_RATES.USD = 0.028 => ~35.71 THB/USD.
const THB_PER_USD = 1 / (EXCHANGE_RATES['USD'] || 0.028);

export const thbToUsd = (thb: number): number => thb / THB_PER_USD;

/**
 * Derives the `condition` key of a sold listing so the learned row lands on the
 * SAME key the API writer uses.
 *
 * - Graded => '<COMPANY> <grade>' with a single space (PriceCharting convention,
 *   e.g. 'PSA 10', 'BGS 9.5'). grade is DECIMAL(3,1); Number() coercion renders
 *   10 / '10.0' as '10' and 9.5 as '9.5'. listings.grading_company is constrained
 *   to PSA/BGS/CGC/ARS, all of which match GRADED_CONDITION_RE.
 * - 'Sealed' passes through.
 * - Only Near Mint / Mint / unlabeled feed the API-populated headline key 'Raw_NM'.
 *   Played conditions keep their OWN key so a played sale never drags down the NM
 *   price — pickDisplayMarketValue ranks such a row below Raw_NM/Near Mint, so it
 *   only surfaces if no NM row exists.
 */
export function saleConditionKey(listing: {
  is_graded?: boolean | null;
  grading_company?: string | null;
  grade?: number | null;
  condition?: string | null;
}): string {
  if (listing.is_graded && listing.grading_company && listing.grade != null) {
    const gradeStr = String(Number(listing.grade));
    return `${listing.grading_company.toUpperCase()} ${gradeStr}`;
  }
  const c = (listing.condition || '').trim();
  if (c === 'Sealed') return 'Sealed';
  if (c === '' || c === 'Near Mint' || c === 'Mint') return 'Raw_NM';
  return c; // 'Lightly Played', 'Moderately Played', ... — condition-specific key
}

/**
 * Language of the sold card, normalized to the market_values convention
 * ('en' | 'jp' | 'th'). Card snapshots store Japanese as 'ja' (cardMapper.ts:193),
 * so normalize 'ja' -> 'jp'. Falls back to a pokemon_cards lookup when the snapshot
 * carries no language (older listings).
 */
async function deriveLanguage(
  supabase: SupabaseClient,
  listing: { card_id?: string | null; card_data?: any },
): Promise<string> {
  const raw = (listing.card_data?.language || '').toString().trim().toLowerCase();
  if (raw) return raw === 'ja' ? 'jp' : raw;

  if (listing.card_id) {
    const { data } = await supabase
      .from('pokemon_cards')
      .select('language')
      .eq('id', listing.card_id)
      .maybeSingle();
    const dbLang = (data?.language || '').toString().trim().toLowerCase();
    if (dbLang) return dbLang === 'ja' ? 'jp' : dbLang;
  }
  return 'en';
}

/**
 * Records the realized sales for a batch of just-fulfilled orders into
 * `market_value_sales` and triggers the per-key recompute.
 *
 * Idempotent (market_value_sales.order_id UNIQUE); a duplicate insert (23505) is
 * ignored and the recompute still runs (harmless — recompute is a pure function of
 * sale history, and self-heals a run that recorded but crashed before recomputing).
 *
 * The sale amount is the RECORDED sale price = orders.total_amount (item price only;
 * shipping is orders.shipping_fee). This is also the agreed price for an
 * accepted-offer sale once that branch merges, since it too funnels total_amount
 * through fulfillment.
 *
 * MUST NOT throw meaningfully — the caller wraps this, but individual failures are
 * swallowed per-order so one bad row never blocks the rest. Pricing must never fail
 * or roll back an order.
 */
export async function recordInternalSales(
  supabase: SupabaseClient,
  orders: Array<{ id: string; listing_id: string | null; total_amount: number }>,
): Promise<void> {
  const listingIds = orders
    .map((o) => o.listing_id)
    .filter((v): v is string => !!v);
  if (!listingIds.length) return;

  const { data: listings } = await supabase
    .from('listings')
    .select('id, card_id, card_data, condition, is_graded, grading_company, grade')
    .in('id', listingIds);
  const byId = new Map((listings || []).map((l: any) => [l.id, l]));

  for (const order of orders) {
    const listing = order.listing_id ? byId.get(order.listing_id) : null;
    if (!listing) continue;

    const thb = Number(order.total_amount);
    if (!(thb > 0)) continue; // reject 0 / negative / NaN

    const isSealed = listing.condition === 'Sealed';
    const cardId = listing.card_id as string;
    if (!cardId) continue;

    const language = await deriveLanguage(supabase, listing);

    // Feature B scope: Thai sealed only. English / other-game sealed stays on the API.
    if (isSealed && language !== 'th') continue;

    const condition = isSealed ? 'Sealed' : saleConditionKey(listing);
    const game = (listing.card_data?.game as string) || 'pokemon';

    const { error: insErr } = await supabase.from('market_value_sales').insert({
      order_id: order.id,
      card_id: cardId,
      language,
      condition,
      game,
      is_sealed: isSealed,
      sale_amount_thb: thb,
      sale_amount_usd: thbToUsd(thb),
    });
    // 23505 = unique_violation (already recorded) — fall through to recompute.
    if (insErr && insErr.code !== '23505') {
      console.error('[InternalPricing] sale insert failed:', insErr);
      continue;
    }

    if (isSealed) {
      await supabase.rpc('recompute_thai_sealed_price', { p_sealed_id: cardId });
    } else {
      await supabase.rpc('recompute_internal_price', {
        p_card_id: cardId,
        p_language: language,
        p_condition: condition,
      });
    }
  }
}
