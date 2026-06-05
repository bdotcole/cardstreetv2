import { Card } from '../types';
import { EXCHANGE_RATES } from '../constants';
import { englishJpSetName } from './japaneseSetNames';

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

const THAI_SET_MAP: Record<string, string> = {
  SV1V: 'Violet ex',
  SV1S: 'Scarlet ex',
  SV2D: 'Clay Burst',
  SV2P: 'Snow Hazard',
  SV5K: 'Wild Force',
  SV5M: 'Cyber Judge',
  MA1: 'Mega Evolution',
  MA2: 'Crimson Haze',
  MA3: 'Mega Evolution Dream ex',
  SV10s: 'The Unbeatable Hero',
  SV9s: 'Destiny Threads',
};

export function mapSupabaseCardToInternal(supabaseCard: any): Card {
  // Pokemon-specific display rules (Thai rarity codes, Thai set-name aliases) must
  // not touch other games. They are also implicitly language-gated, but gate on
  // game explicitly so a future non-'en' language in another game stays unaffected.
  const game = supabaseCard.game || 'pokemon';
  const isPokemon = game === 'pokemon';
  const rawData = supabaseCard.raw_data || {};
  const tcgData = rawData.tcgplayer;
  const pricesTypes = tcgData?.prices || {};
  const pricesObj = pricesTypes.holofoil || pricesTypes.normal || Object.values(pricesTypes)[0] || {};

  const marketValueData = Array.isArray(supabaseCard.market_values)
    ? supabaseCard.market_values[0]
    : supabaseCard.market_values;

  let marketThb = 0;
  let lastUpdated = '';
  if (marketValueData && marketValueData.market_avg > 0) {
    let avg = marketValueData.market_avg;
    if (marketValueData.currency === 'USD') avg = avg * EXCHANGE_RATE;
    marketThb = avg;
    lastUpdated = marketValueData.last_updated;
  } else {
    const marketUsd = (pricesObj as any)?.market || (pricesObj as any)?.mid || (pricesObj as any)?.low || 0;
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

  let setName = supabaseCard.pokemon_sets?.name || rawData.set?.name || 'Unknown Set';
  if (isPokemon && supabaseCard.language === 'th') {
    const engName = THAI_SET_MAP[supabaseCard.set_id];
    if (engName && !setName.includes(engName)) setName = `${engName} (${setName})`;
  } else if (isPokemon && supabaseCard.language === 'ja') {
    // English-first app: show the English name for JP sets where we have one.
    setName = englishJpSetName(supabaseCard.set_id, setName);
  }

  const setTotal =
    supabaseCard.pokemon_sets?.printed_total ||
    supabaseCard.pokemon_sets?.total ||
    rawData.set?.printedTotal ||
    '??';

  // English-first app: show the English card name for JP cards when we have one.
  const displayName = (isPokemon && supabaseCard.language === 'ja' && supabaseCard.english_name)
    ? supabaseCard.english_name
    : supabaseCard.name;

  return {
    id: supabaseCard.id,
    name: displayName,
    thaiName: supabaseCard.english_name || supabaseCard.name,
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
      market: marketThb,
      low: Math.round(marketThb * 0.9),
      mid: marketThb,
      high: Math.round(marketThb * 1.1),
      lastUpdated: lastUpdated || tcgData?.updatedAt || new Date().toISOString(),
    },
    change7d: parseFloat((Math.random() * 15 - 5).toFixed(1)),
    priceHistory: [
      { date: '1D', price: Math.round(marketThb * (0.95 + Math.random() * 0.1)) },
      { date: '7D', price: Math.round(marketThb * (0.9 + Math.random() * 0.1)) },
      { date: '1M', price: Math.round(marketThb * (0.8 + Math.random() * 0.2)) },
      { date: '3M', price: Math.round(marketThb * (0.7 + Math.random() * 0.3)) },
      { date: '6M', price: marketThb },
    ],
  };
}
