import type { SupabaseClient } from '@supabase/supabase-js';
import { Card, CardCondition } from '@/types';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { calculateRecommendedPrice } from '@/lib/utils/priceCalculator';
import { SealedProductRow, mapSealedRowToProduct, sealedProductToCard } from '@/lib/sealedProduct';
import { EXCHANGE_RATES } from '@/constants';
import { GradingCompany } from './types';

// Server-side catalog resolution + graded valuation for the bulk importer.
//
// The caller passes a Supabase client (service-role) so this stays free of the
// admin-client import and remains unit-testable. It must never be imported from a
// 'use client' module.

// USD -> THB. EXCHANGE_RATES['USD'] is USD-per-THB (~0.028); invert for THB-per-USD.
const USD_TO_THB = 1 / (EXCHANGE_RATES['USD'] || 0.028);

// A graded market_values row's condition looks like "PSA 10", "BGS 9.5", ...
const GRADED_CONDITION = /^(PSA|BGS|CGC|SGC|ARS)\s+(\d+(?:\.\d)?)$/i;

// Same projection the scanner's deterministic lookup uses — the mapper needs the
// market_values rows (all conditions, for both ungraded display and graded tiers)
// and the set join. `*` carries raw_data for the embedded-price fallback.
const SELECT = '*, market_values(condition, market_avg, currency, last_updated), pokemon_sets(name, printed_total, total)';

interface GradedInput {
  isGraded: boolean;
  gradingCompany?: GradingCompany;
  grade?: number;
}

// Image-free candidate lookup by printed set code + collector number, optionally
// narrowed by language/game and a name tiebreaker. Mirrors the query in
// services/scannerService.ts:lookupBySetAndNumber — keep the two in sync.
export async function resolveCandidates(
  supabase: SupabaseClient,
  input: { set: string; number: string; language?: string | null; game?: string | null; name?: string | null },
): Promise<any[]> {
  const firstToken = (input.set || '').trim().split(/\s+/)[0] ?? '';
  const cleanSet = firstToken.replace(/[^a-zA-Z0-9]/g, '').trim();
  const numeratorRaw = (input.number || '').split('/')[0].replace(/[^a-zA-Z0-9]/g, '').trim();
  const numeratorStripped = numeratorRaw.replace(/^0+/, '') || numeratorRaw;
  if (!cleanSet || !numeratorRaw) return [];

  const numberOr = `number.eq.${numeratorRaw},number.eq.${numeratorStripped},number.ilike.${numeratorRaw}/%,number.ilike.${numeratorStripped}/%`;
  const setMatchers: Array<(q: any) => any> = [
    (q) => q.ilike('set_id', cleanSet),
    (q) => q.ilike('set_id', `${cleanSet}%`),
    (q) => q.ilike('set_id', `%${cleanSet}`),
  ];

  for (const applySetMatcher of setMatchers) {
    let q = applySetMatcher(supabase.from('pokemon_cards').select(SELECT)).or(numberOr);
    if (input.language) q = q.eq('language', input.language);
    if (input.game) q = q.eq('game', input.game);
    const { data, error } = await q.limit(10);
    if (error) {
      console.warn('[collectionImport] resolveCandidates error:', error);
      return [];
    }
    if (data && data.length > 0) {
      // Name tiebreaker: if the sheet carries a name and it narrows the print
      // variants, prefer the narrowed set. Never widen (an empty narrow is ignored).
      const name = (input.name || '').toLowerCase().trim();
      if (name && data.length > 1) {
        const narrowed = data.filter(
          (r: any) => String(r.name || '').toLowerCase().includes(name) || String(r.english_name || '').toLowerCase().includes(name),
        );
        if (narrowed.length >= 1) return narrowed;
      }
      return data;
    }
  }
  return [];
}

// Per-unit value to book into the collection, in THB.
//  - raw card  -> the ungraded catalog market price (matches single-add behavior;
//                 raw condition does not discount value today).
//  - graded    -> the card's own PriceCharting graded price for that tier when we
//                 have it; otherwise the raw NM price scaled by the standard grade
//                 multiplier (same math as the listing "Use Recommended" button).
export function unitValueThb(mappedCard: Card, marketValues: any, graded: GradedInput): number {
  const base = Math.round(mappedCard.marketPrice || 0);
  if (!graded.isGraded || !graded.gradingCompany || graded.grade == null) return base;

  const wantKey = `${graded.gradingCompany.toUpperCase()} ${graded.grade}`;
  for (const row of Array.isArray(marketValues) ? marketValues : []) {
    const m = GRADED_CONDITION.exec(String(row?.condition || '').trim());
    if (!m || typeof row.market_avg !== 'number' || row.market_avg <= 0) continue;
    if (`${m[1].toUpperCase()} ${parseFloat(m[2])}` === wantKey) {
      return row.currency === 'USD' ? Math.round(row.market_avg * USD_TO_THB) : Math.round(row.market_avg);
    }
  }

  // Fallback: scale the raw NM price by the grade multiplier.
  const est = calculateRecommendedPrice({
    basePrice: base,
    condition: CardCondition.NM,
    isGraded: true,
    gradingCompany: graded.gradingCompany,
    grade: graded.grade,
  });
  return est > 0 ? est : base;
}

// Build the card_data snapshot to store for one item. For graded items the graded
// value is baked into marketPrice/prices so every existing portfolio-value surface
// (which reads card_data.marketPrice) reflects the graded worth with no extra wiring.
export function buildSnapshot(supabaseCard: any, graded: GradedInput): { card: Card; value: number } {
  const card = mapSupabaseCardToInternal(supabaseCard);
  const value = unitValueThb(card, supabaseCard.market_values, graded);

  if (graded.isGraded && value > 0) {
    card.marketPrice = value;
    card.prices = {
      market: value,
      low: Math.round(value * 0.9),
      mid: value,
      high: Math.round(value * 1.1),
      lastUpdated: card.prices?.lastUpdated || new Date().toISOString(),
    };
  }
  return { card, value };
}

// ── Sealed products ──────────────────────────────────────────────────────────
// Sealed live in `sealed_products` (keyed pc-<id>, no collector number), so they
// resolve by set code + product_type instead of set + number.

// Candidate sealed products for a row. `productType` narrows to a specific type
// (booster_box/etb/...); 'other' or empty returns all sealed for the set so the
// partner can pick. Name is a tiebreaker.
export async function resolveSealedCandidates(
  supabase: SupabaseClient,
  input: { set: string; productType?: string | null; language?: string | null; game?: string | null; name?: string | null },
): Promise<any[]> {
  const firstToken = (input.set || '').trim().split(/\s+/)[0] ?? '';
  const cleanSet = firstToken.replace(/[^a-zA-Z0-9]/g, '').trim();
  if (!cleanSet) return [];

  const type = input.productType && input.productType !== 'other' ? input.productType : null;
  const setMatchers: Array<(q: any) => any> = [
    (q) => q.ilike('set_id', cleanSet),
    (q) => q.ilike('set_id', `${cleanSet}%`),
    (q) => q.ilike('set_id', `%${cleanSet}`),
  ];

  for (const applySetMatcher of setMatchers) {
    let q = applySetMatcher(supabase.from('sealed_products').select('*')).eq('game', input.game || 'pokemon');
    if (input.language) q = q.eq('language', input.language);
    if (type) q = q.eq('product_type', type);
    const { data, error } = await q.limit(10);
    if (error) {
      console.warn('[collectionImport] resolveSealedCandidates error:', error);
      return [];
    }
    if (data && data.length > 0) {
      const name = (input.name || '').toLowerCase().trim();
      if (name && data.length > 1) {
        const narrowed = data.filter((r: any) => String(r.name || '').toLowerCase().includes(name));
        if (narrowed.length >= 1) return narrowed;
      }
      return data;
    }
  }
  return [];
}

// sealed_products.set_id is a plain link (no FK), so set names come from a separate
// batch query. Returns set_id -> pokemon_sets.name.
export async function sealedSetNames(supabase: SupabaseClient, rows: any[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.set_id).filter(Boolean))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await supabase.from('pokemon_sets').select('id, name').in('id', ids);
  for (const s of data || []) out.set(s.id, s.name);
  return out;
}

// Build the card_data snapshot for a sealed row. Value = its factory-sealed price
// (THB), already the marketPrice on the mapped Card.
export function buildSealedSnapshot(row: any, setName?: string | null): { card: Card; value: number } {
  const product = mapSealedRowToProduct(row as SealedProductRow, setName ?? null);
  const card = sealedProductToCard(product);
  return { card, value: Math.round(card.marketPrice || 0) };
}
