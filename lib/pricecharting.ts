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

// PriceCharting lists every single CARD alongside sealed products in each category.
// A card is recognized by one of three signals (none of which a real sealed carries):
//   - a collector number "#<1-4 digits>" (Pokemon/MTG/Lorcana), e.g. "Charizard #199"
//   - a trailing set-code "OP07-002" / "RA04-EN253" / "ST10-013" (One Piece / Yu-Gi-Oh)
//   - a card-only variant bracket, e.g. "[Foil]", "[Extended Art]", "[Prize Pack]",
//     "[Tin Topper]" — sealed products never use these (their brackets are "[1st Edition]",
//     "[Series 1]", set names, etc.)
// The number/set-code signal is suppressed when the name LEADS with a container noun,
// because a few real sealed products append a set code: "Booster Box #SV8", "Double Pack DP-08".
const CARD_NUMBER_RE = /#\s*[A-Za-z]{0,5}\d{1,4}\b/;
const CARD_SETCODE_RE = /\b[A-Z]{1,5}\d{0,2}-[A-Z]{0,4}\d{1,4}[a-z]?\b\s*$/;
const CONTAINER_HEAD_RE = /^\s*(sealed\s+|factory\s+sealed\s+)?(booster box|booster pack|booster bundle|elite trainer box|\betb\b|double pack|triple pack|build\s*&?\s*battle|starter deck|structure deck|prerelease|bundle box|display box|booster case)\b/i;
const CARD_VARIANT_RE = /\[(foil|non-?foil[^\]]*|etched[^\]]*|extended art|borderless|showcase|retro frame|full art|alt(?:ernate)? art|[^\]]*\bfoil\b|serial(?:ized)?|prize pack[^\]]*|tin topper|box topper|storage box set[^\]]*|illustration box[^\]]*|dash pack|welcome pack[^\]]*|master ball|poke ball|reverse holo)\]/i;

/** True when a PriceCharting product-name is actually a single card, not a sealed product. */
export function looksLikeCardProductName(productName: string): boolean {
  const name = productName || '';
  if (CARD_VARIANT_RE.test(name)) return true;
  return (CARD_NUMBER_RE.test(name) || CARD_SETCODE_RE.test(name)) && !CONTAINER_HEAD_RE.test(name);
}

// Ordered: first match wins. The union of these patterns defines "names a sealed
// container" — a product-name matching none of them (and not a card) is skipped.
const SEALED_KEYWORDS: Array<[RegExp, string]> = [
  [/elite trainer box|\betb\b/i, 'etb'],
  [/booster box|booster case|display box/i, 'booster_box'],
  [/booster bundle|booster pack|sleeved booster|\bblister\b|fat pack|\bpack\b/i, 'booster_pack'],
  [/\bbundle\b|build\s*&?\s*battle|prerelease|\bjumpstart\b|toolkit/i, 'bundle'],
  [/starter deck|structure deck|commander deck|theme deck|planeswalker deck|challenger deck|battle deck|deck box|deckbuilder|\bdeck\b/i, 'other'],
  [/\bcollection\b|\btin\b|premium|box set|\bgift\b|\btrove\b|portfolio|\bbinder\b|\bcalendar\b|advent|checklane|storage box|\bbox\b/i, 'collection'],
];

/**
 * Classify a PriceCharting product-name as a sealed product type, or null when it is
 * a single card. A card gate runs FIRST so that card names containing sealed-sounding
 * words ("Bulbasaur [Tin Topper] #3", "Tin Goldfish", "Iron Bundle #66") are correctly
 * rejected instead of being filed as sealed.
 */
export function classifySealed(productName: string): string | null {
  const name = productName || '';
  if (looksLikeCardProductName(name)) return null; // it's a single card, not sealed
  for (const [re, type] of SEALED_KEYWORDS) {
    if (re.test(name)) return type;
  }
  return null; // no recognizable container -> not a sealed product
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
