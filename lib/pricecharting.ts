/**
 * PriceCharting integration — shared, pure helpers (no env, no I/O).
 *
 * PriceCharting (Legendary plan) is our source for GRADED card prices and SEALED
 * product prices. Catalog + ungraded market prices still come from the per-game
 * sources + JustTCG; this only adds the graded/sealed layer.
 *
 * Used by the Next API/cron (TS). The standalone ingest (scripts/ingest/
 * pricecharting.mjs) intentionally re-declares the same constants inline because
 * .mjs can't import this TS module — keep the two in sync (small, rarely changes).
 *
 * IMPORTANT: the JSON product API returns integer USD CENTS; the bulk CSV returns
 * dollar strings. This module is used by the cron (JSON API), so its helpers expect
 * cents. The ingest (CSV) parses dollars itself.
 */

export const PRICECHARTING_BASE = 'https://www.pricecharting.com';

/**
 * For trading cards PriceCharting repurposes its generic video-game price columns.
 * This is the documented card mapping, confirmed live against known cards.
 *
 * loose-price = Ungraded (handled separately, not a graded tier).
 */
export const GRADED_FIELD_MAP: Record<string, string> = {
  'graded-price': 'PSA 9', // PriceCharting "Grade 9"
  'box-only-price': 'BGS 9.5',
  'manual-only-price': 'PSA 10',
  'bgs-10-price': 'BGS 10',
  'condition-17-price': 'CGC 10',
  'condition-18-price': 'SGC 10',
};

/** All graded condition labels we may write into market_values. */
export const GRADED_CONDITIONS = Object.values(GRADED_FIELD_MAP);

/** Matches a graded condition string like "PSA 10", "BGS 9.5", "CGC 10", "SGC 10". */
export const GRADED_CONDITION_RE = /^(PSA|BGS|CGC|SGC|ARS)\s+(\d+(?:\.\d)?)$/i;

/** Our game id -> PriceCharting price-guide category (CSV download `category=`). */
export const PC_CATEGORY: Record<string, string> = {
  pokemon: 'pokemon-cards',
  'pokemon-jp': 'pokemon-japanese-cards',
  mtg: 'magic-cards',
  yugioh: 'yugioh-cards',
  onepiece: 'one-piece-cards',
  lorcana: 'lorcana-cards',
};

/** Integer USD cents -> USD number (2dp). Returns null for missing/zero. */
export function centsToUsd(cents: unknown): number | null {
  const n = typeof cents === 'string' ? parseInt(cents, 10) : (cents as number);
  if (!Number.isFinite(n) || (n as number) <= 0) return null;
  return Math.round(n as number) / 100;
}

const SEALED_KEYWORDS: Array<[RegExp, string]> = [
  [/elite trainer box|\betb\b/i, 'etb'],
  [/booster box/i, 'booster_box'],
  [/booster bundle|booster pack|\bpack\b/i, 'booster_pack'],
  [/bundle/i, 'bundle'],
  [/collection|tin|premium|box set|gift/i, 'collection'],
];

/**
 * Classify a PriceCharting product-name as a sealed product type, or null when it
 * looks like a single card (card names carry a "#<number>" token).
 */
export function classifySealed(productName: string): string | null {
  const name = productName || '';
  const looksLikeCard = /#\s*\w+/.test(name);
  for (const [re, type] of SEALED_KEYWORDS) {
    if (re.test(name)) return type;
  }
  if (!looksLikeCard && /\b(box|case|display|collection)\b/i.test(name)) return 'other';
  return null;
}

export function buildProductByIdUrl(token: string, id: string): string {
  return `${PRICECHARTING_BASE}/api/product?t=${encodeURIComponent(token)}&id=${encodeURIComponent(id)}`;
}

export function buildCsvDownloadUrl(token: string, category: string): string {
  return `${PRICECHARTING_BASE}/price-guide/download-custom?t=${encodeURIComponent(token)}&category=${encodeURIComponent(category)}`;
}

/** Extract graded market_values rows from a PriceCharting product JSON object (cents). */
export function gradedRowsFromProduct(
  product: Record<string, any>,
): Array<{ condition: string; usd: number }> {
  const out: Array<{ condition: string; usd: number }> = [];
  for (const [field, condition] of Object.entries(GRADED_FIELD_MAP)) {
    const usd = centsToUsd(product[field]);
    if (usd != null) out.push({ condition, usd });
  }
  return out;
}
