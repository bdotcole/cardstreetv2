import { Card } from '../types';
import { EXCHANGE_RATES } from '../constants';
import { englishJpSetName } from './japaneseSetNames';
import { GRADED_CONDITION_RE } from './pricecharting';

const EXCHANGE_RATE = 1 / (EXCHANGE_RATES['USD'] || 0.028);

const fixTcgdexUrl = (url: string | null): string => {
  if (!url) return '';
  if (url.includes('tcgdex.net') && !url.match(/\.(png|jpg|jpeg|webp)$/i)) {
    return `${url}.png`;
  }
  return url;
};

// Thai cards historically had English rarity strings ("Illustration Rare", "Double Rare", ...).
// Display them as Japanese-style codes (AR, RR, ...) which is the convention Thai collectors use.
// The DB is being migrated; this map is the display-time fallback for any rows still in English.
const THAI_RARITY_DISPLAY: Record<string, string> = {
  'common': 'C',
  'uncommon': 'U',
  'rare': 'R',
  'double rare': 'RR',
  'ultra rare': 'SR',
  'illustration rare': 'AR',
  'special illustration rare': 'SAR',
  'hyper rare': 'UR',
  'shiny rare': 'AR',
  'shiny ultra rare': 'UR',
  'mega hyper rare': 'UR',
  'ace spec rare': 'ACE',
  'black & white rare': 'R',
  'rare holo': 'R',
  'rare holo v': 'RR',
  'rare holo vmax': 'RR',
  'rare holo vstar': 'RR',
  'secret rare': 'SAR',
  'radiant rare': 'SR',
  'amazing rare': 'SR',
};

function normalizeThaiRarity(rarity: string | null | undefined): string {
  if (!rarity) return 'C';
  const lookup = THAI_RARITY_DISPLAY[rarity.toLowerCase().trim()];
  return lookup || rarity;
}

// Embedded TCGplayer prices arrive in two shapes depending on the upstream source:
//   pokemontcg.io: tcgData.prices.<printing>.{market,mid,low}
//   TCGdex:        tcgData.<printing>.{marketPrice,midPrice,lowPrice}  (printing keys
//                  sit directly on tcgplayer alongside `unit`/`updated`)
// The mapper historically read only the first, so TCGdex-sourced EN sets (e.g. me03,
// me04) rendered priceless even though raw_data carried TCGplayer numbers. Printing
// preference mirrors the catalog convention: holofoil, then normal, then first usable.
function tcgplayerMarketUsd(tcgData: any): number {
  if (!tcgData || typeof tcgData !== 'object') return 0;

  // pokemontcg.io shape
  const priceTypes = tcgData.prices;
  if (priceTypes && typeof priceTypes === 'object') {
    const p = priceTypes.holofoil || priceTypes.normal || Object.values(priceTypes)[0] || {};
    const usd = (p as any)?.market || (p as any)?.mid || (p as any)?.low || 0;
    if (typeof usd === 'number' && usd > 0) return usd;
  }

  // TCGdex shape
  const printing = tcgData.holofoil || tcgData.normal || tcgData['reverse-holofoil']
    || Object.values(tcgData).find((v: any) => v && typeof v === 'object'
        && ('marketPrice' in v || 'midPrice' in v || 'lowPrice' in v));
  if (printing && typeof printing === 'object') {
    const usd = (printing as any).marketPrice ?? (printing as any).midPrice ?? (printing as any).lowPrice ?? 0;
    if (typeof usd === 'number' && usd > 0) return usd;
  }

  return 0;
}

const THAI_SET_MAP: Record<string, string> = {
  SV1V: 'Violet ex',
  SV1S: 'Scarlet ex',
  SV2D: 'Clay Burst',
  SV2P: 'Snow Hazard',
  SV4a: 'Shiny Treasure ex',
  SV5K: 'Wild Force',
  SV5M: 'Cyber Judge',
  SV8a: 'Terastal Festival ex',
  MA1: 'Mega Evolution',
  MA2: 'Crimson Haze',
  MA3: 'Mega Evolution Dream ex',
  SV10s: 'The Unbeatable Hero',
  SV9s: 'Destiny Threads',
};

// Shared set-name display convention (also used for sealed products): Thai sets
// get the curated English alias prefixed, JP sets get the curated English name.
// Sealed rows store language 'jp' where cards store 'ja'; accept both.
export function displaySetName(
  game: string,
  language: string | null | undefined,
  setId: string | null | undefined,
  baseName: string,
): string {
  if (game !== 'pokemon') return baseName;
  if (language === 'th') {
    const engName = setId ? THAI_SET_MAP[setId] : undefined;
    return engName && !baseName.includes(engName) ? `${engName} (${baseName})` : baseName;
  }
  if (language === 'ja' || language === 'jp') return englishJpSetName(setId, baseName);
  return baseName;
}

// The market_values join returns one row PER CONDITION — since the PriceCharting
// ingest that includes graded tiers ("PSA 10", "BGS 10", ...) whose prices run many
// multiples of raw. The display price must come from an ungraded row: prefer the
// JustTCG-refreshed 'Raw_NM', then 'Near Mint' (the two catalog conventions), then
// any other ungraded condition, freshest first. Queries must project `condition`
// for the graded filter to work; without it this degrades to freshest-row-first.
export function pickDisplayMarketValue(marketValues: any): any | null {
  if (!marketValues) return null;
  const rows = (Array.isArray(marketValues) ? marketValues : [marketValues]).filter(
    (r: any) => r && !GRADED_CONDITION_RE.test(String(r.condition || '').trim()),
  );
  const rank = (r: any) =>
    r.condition === 'Raw_NM' ? 0 : r.condition === 'Near Mint' ? 1 : 2;
  rows.sort(
    (a: any, b: any) =>
      rank(a) - rank(b) ||
      (Date.parse(b.last_updated || '') || 0) - (Date.parse(a.last_updated || '') || 0),
  );
  return rows[0] ?? null;
}

export function mapSupabaseCardToInternal(supabaseCard: any): Card {
  // Pokemon-specific display rules (Thai rarity codes, Thai set-name aliases) must
  // not touch other games. They are also implicitly language-gated, but gate on
  // game explicitly so a future non-'en' language in another game stays unaffected.
  const game = supabaseCard.game || 'pokemon';
  const isPokemon = game === 'pokemon';
  const rawData = supabaseCard.raw_data || {};
  // List queries project `tcgplayer:raw_data->tcgplayer` instead of shipping the
  // whole raw_data blob, so the slice arrives as a top-level key.
  const tcgData = rawData.tcgplayer ?? supabaseCard.tcgplayer;

  const marketValueData = pickDisplayMarketValue(supabaseCard.market_values);

  let marketThb = 0;
  let lastUpdated = '';
  if (marketValueData && marketValueData.market_avg > 0) {
    let avg = marketValueData.market_avg;
    if (marketValueData.currency === 'USD') avg = avg * EXCHANGE_RATE;
    marketThb = avg;
    lastUpdated = marketValueData.last_updated;
  } else {
    const marketUsd = tcgplayerMarketUsd(tcgData);
    marketThb = Math.round(marketUsd * EXCHANGE_RATE);
  }

  let imageUrl = '';
  let imageSmall = '';
  if (supabaseCard.image_large) imageUrl = fixTcgdexUrl(supabaseCard.image_large);
  else if (supabaseCard.image_small) imageUrl = fixTcgdexUrl(supabaseCard.image_small);
  else if (rawData.images?.large) {
    imageUrl = rawData.images.large;
    imageSmall = rawData.images.small;
  } else if (rawData.image) {
    const baseUrl = rawData.image.includes('http') ? rawData.image : `${rawData.image}/high`;
    imageUrl = fixTcgdexUrl(baseUrl);
  } else {
    imageUrl = 'https://images.pokemontcg.io/placeholder.png';
  }

  if (supabaseCard.image_small) imageSmall = fixTcgdexUrl(supabaseCard.image_small);
  else if (rawData.images?.small) imageSmall = rawData.images.small;
  else if (rawData.image) {
    const baseUrl = rawData.image.includes('http') ? rawData.image : `${rawData.image}/low`;
    imageSmall = fixTcgdexUrl(baseUrl);
  }

  const setName = displaySetName(
    game,
    supabaseCard.language,
    supabaseCard.set_id,
    supabaseCard.pokemon_sets?.name || rawData.set?.name || 'Unknown Set',
  );

  const setTotal =
    supabaseCard.pokemon_sets?.printed_total ||
    supabaseCard.pokemon_sets?.total ||
    rawData.set?.printedTotal ||
    '??';

  // Show the name actually printed on the card; the English name rides in the
  // secondary slot (CardDetails renders name as <h1> and thaiName as <h2>).
  //
  // a689cea substituted english_name here for JP Pokemon because the JA catalog
  // then held English text — or machine translations like 金星 for Venusaur — in
  // `name`. Real Japanese names landed 2026-08, so that override now hides the
  // card's actual name and leaves both slots showing the same English string.
  const displayName = supabaseCard.name;
  // Only when it differs, so EN rows don't render the same text twice.
  const secondaryName =
    supabaseCard.english_name && supabaseCard.english_name !== supabaseCard.name
      ? supabaseCard.english_name
      : '';

  return {
    id: supabaseCard.id,
    name: displayName,
    thaiName: secondaryName,
    set: setName,
    game,
    language: supabaseCard.language || 'en',
    number: supabaseCard.number ? `${supabaseCard.number.split('/')[0]}/${setTotal}` : '??',
    rarity: (isPokemon && supabaseCard.language === 'th')
      ? normalizeThaiRarity(supabaseCard.rarity)
      : (supabaseCard.rarity || 'Common'),
    imageUrl,
    images: { small: imageSmall || imageUrl, large: imageUrl },
    marketPrice: marketThb,
    tcgplayerUrl: supabaseCard.tcgplayer_url,
    prices: {
      // We only have a single market value per card, not a real low/mid/high
      // spread — so don't fabricate one. All three mirror the market price; the
      // real range on the card page comes from live listings, not this field.
      market: marketThb,
      low: marketThb,
      mid: marketThb,
      high: marketThb,
      // Real market-data timestamp only (our market_values row, else tcgplayer's
      // embedded updatedAt). Never synthesize now() — a fabricated "updated today"
      // reads as false freshness. null lets the UI hide the freshness stamp.
      lastUpdated: lastUpdated || tcgData?.updatedAt || null,
    },
    // No synthesized 7-day change or trend line. Real market-value-over-time is
    // served from price_snapshots via /api/price-history (components/PriceHistoryChart).
    priceHistory: [],
  };
}
