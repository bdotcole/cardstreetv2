
import { geminiService, SearchIntent } from './geminiService';
import { Card } from '../types';

const API_URL = 'https://api.pokemontcg.io/v2';
// Removed Content-Type to prevent unnecessary CORS preflight (OPTIONS) requests which can cause failures
const HEADERS = {
  'Accept': 'application/json'
};
const EXCHANGE_RATE = 35.85;

// Client-side search index / cache
const searchIndex = new Map<string, Card[]>();
const setsCache = new Map<string, { data: ApiSet[], totalCount: number }>();

// Mappings for English Set Names to Japanese equivalents
const JP_SET_MAPPINGS: Record<string, string> = {
  "Twilight Masquerade": "Transformation Mask",
  "Temporal Forces": "Wild Force / Cyber Judge",
  "Paldean Fates": "Shiny Treasure ex",
  "Paradox Rift": "Ancient Roar / Future Flash",
  "151": "Pokémon Card 151",
  "Obsidian Flames": "Ruler of the Black Flame",
  "Paldea Evolved": "Clay Burst / Snow Hazard",
  "Scarlet & Violet": "Scarlet ex / Violet ex",
  "Crown Zenith": "VSTAR Universe",
  "Silver Tempest": "Paradigm Trigger",
  "Lost Origin": "Lost Abyss",
  "Astral Radiance": "Time Gazer / Space Juggler",
  "Brilliant Stars": "Star Birth",
  "Fusion Strike": "Fusion Arts",
  "Celebrations": "25th Anniversary Collection",
  "Evolving Skies": "Blue Sky Stream / Towering Perfection",
  "Chilling Reign": "Silver Lance / Jet-Black Spirit",
  "Battle Styles": "Single Strike / Rapid Strike Master",
  "Shining Fates": "Shiny Star V",
  "Vivid Voltage": "Amazing Volt Tackle",
  "Darkness Ablaze": "Infinity Zone",
  "Rebel Clash": "Rebellion Crash",
  "Sword & Shield": "Sword / Shield",
  "Cosmic Eclipse": "Alter Genesis",
  "Hidden Fates": "GX Ultra Shiny",
  "Unified Minds": "Miracle Twin",
  "Unbroken Bonds": "Double Blaze",
  "Team Up": "Tag Bolt"
};

/**
 * Utility to handle fetch with retries and backoff
 * Handles TypeError (Network failures) and 429 (Rate Limits) more robustly
 */
async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 4, backoff = 1200): Promise<any> {
  try {
    const response = await fetch(url, { ...options, headers: { ...HEADERS, ...options.headers } });

    if (response.status === 429) {
      if (retries > 0) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : backoff;
        console.warn(`Rate limited. Waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return fetchWithRetry(url, options, retries - 1, backoff * 2);
      }
      throw new Error("SiamPoke: Global TCG Registry is busy. Please try again in 30 seconds.");
    }

    if (!response.ok) {
      throw new Error(`Registry Error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    const isNetworkError = error instanceof TypeError ||
      error.message?.includes('Failed to fetch') ||
      error.message?.includes('network');

    if (retries > 0 && isNetworkError) {
      console.warn(`Registry connection glitch. Retrying in ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw error;
  }
}

export interface ApiSet {
  id: string;
  name: string;
  series: string;
  printedTotal: number;
  total: number;
  releaseDate: string;
  updatedAt: string;
  images: {
    symbol: string;
    logo: string;
  };
}

export const pokemonService = {
  async fetchSets(
    language: 'en' | 'jp' | 'th' | 'pokemon-en' | 'pokemon-jp' | 'pokemon-th' = 'en',
    page: number = 1,
    pageSize: number = 15
  ): Promise<{ data: ApiSet[], totalCount: number }> {
    const cacheKey = `sets-${language}-${page}-${pageSize}`;
    if (setsCache.has(cacheKey)) {
      return setsCache.get(cacheKey)!;
    }

    try {
      // Use internal API route for caching benefits
      // The internal API handles the connection to the slow upstream provider
      let endpoint = `/api/sets?orderBy=-releaseDate&pageSize=${pageSize}&page=${page}`;

      const response = await fetch(endpoint);
      if (!response.ok) throw new Error("Internal API Error");

      const data = await response.json();

      let sets: ApiSet[] = data.data || [];
      const totalCount = data.totalCount || 0;

      // Simulate Region Sets if requested
      if (language === 'jp' || language === 'pokemon-jp') {
        sets = sets.map(s => {
          const jpName = JP_SET_MAPPINGS[s.name] || `${s.name} (JP)`;
          return {
            ...s,
            name: jpName,
            id: `jp-${s.id}`
          };
        });
      } else if (language === 'th' || language === 'pokemon-th') {
        sets = sets.map(s => ({
          ...s,
          name: `${s.name} (TH)`,
          id: `th-${s.id}`
        }));
      }

      const result = { data: sets, totalCount };
      setsCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error("Failed to fetch sets:", error);
      return { data: [], totalCount: 0 };
    }
  },

  async fetchCardsBySet(setId: string) {
    try {
      // Strip mock prefixes if present
      const realSetId = setId.replace(/^(jp-|th-)/, '');
      // Increased pageSize to 250 to cover most sets for Master Set view
      const data = await fetchWithRetry(`${API_URL}/cards?q=set.id:${realSetId}&pageSize=250&orderBy=number`);
      return (data.data || []).map((c: any) => this.mapApiCardToInternal(c));
    } catch (error) {
      console.error("Failed to fetch cards:", error);
      return [];
    }
  },

  async findCardByMetadata(name: string, set: string, number: string): Promise<Card[]> {
    try {
      const cleanNumber = number.split('/')[0].trim();
      const cleanName = name.replace(/[^a-zA-Z0-9 ]/g, '').trim();

      const query = `number:"${cleanNumber}" name:"${cleanName}*"`;
      const data = await fetchWithRetry(`${API_URL}/cards?q=${encodeURIComponent(query)}&pageSize=5`);

      if (!data.data || data.data.length === 0) {
        const broaderQuery = `name:"${cleanName}*" number:"${cleanNumber}"`;
        const fallbackData = await fetchWithRetry(`${API_URL}/cards?q=${encodeURIComponent(broaderQuery)}&pageSize=5`);
        return (fallbackData.data || []).map((c: any) => this.mapApiCardToInternal(c));
      }

      return (data.data || []).map((c: any) => this.mapApiCardToInternal(c));
    } catch (error) {
      console.error("Metadata match failed:", error);
      return [];
    }
  },

  async searchCards(query: string, useAiResolution: boolean = true) {
    if (!query || query.trim().length < 2) return [];

    const cacheKey = query.toLowerCase().trim();
    if (searchIndex.has(cacheKey)) {
      return searchIndex.get(cacheKey) || [];
    }

    try {
      let finalApiQuery = '';
      const containsThai = /[\u0E00-\u0E7F]/.test(query);

      if (useAiResolution && (containsThai || query.split(' ').length > 1)) {
        try {
          const intent = await geminiService.resolveSearchIntent(query);
          if (intent) {
            let parts = [];
            // Handle English Name carefully - if it's generic, use fuzzy search
            if (intent.englishName) {
              parts.push(`name:"*${intent.englishName}*"`);
            }

            if (intent.region === 'jp') {
              parts.push('(set.id:sv*p* OR set.id:swsh*p* OR set.id:s-p OR set.name:"*Japanese*")');
            } else if (intent.region === 'th') {
              parts.push('(set.name:"*Thai*" OR set.id:*th*)');
            }

            if (intent.rarity) {
              parts.push(`rarity:"*${intent.rarity}*"`);
            }

            if (parts.length > 0) {
              finalApiQuery = parts.join(' ');
            }
          }
        } catch (aiError) {
          console.warn("AI intent resolution skipped:", aiError);
        }
      }

      if (!finalApiQuery) {
        const namePart = query.toLowerCase()
          .replace(/\b(japanese|jp|jpn|thai|th|english|en)\b/g, '')
          .replace(/[^a-zA-Z0-9 ]/g, '')
          .trim();

        // If query was just "Japanese" or similar, namePart might be empty. 
        // We must ensure the query is valid.
        if (namePart) {
          finalApiQuery = `name:"${namePart}*"`;
        } else {
          // Fallback if user just typed a region but no name
          finalApiQuery = 'supertype:Pokémon';
        }

        if (/\b(japanese|jp|jpn)\b/i.test(query)) {
          finalApiQuery += ' (set.id:sv*p* OR set.name:"*Japanese*")';
        }
      }

      const data = await fetchWithRetry(`${API_URL}/cards?q=${encodeURIComponent(finalApiQuery)}&pageSize=30&orderBy=-set.releaseDate`);

      const results = (data.data || []).map((c: any) => this.mapApiCardToInternal(c));
      if (results.length > 0) searchIndex.set(cacheKey, results);

      return results;
    } catch (error) {
      console.error("Search failure:", error);
      // Return empty array instead of crashing UI, but log error for debugging
      return [];
    }
  },

  mapApiCardToInternal(apiCard: any): Card {
    const tcgData = apiCard.tcgplayer;
    const pricesTypes = tcgData?.prices || {};
    const pricesObj = pricesTypes.holofoil || pricesTypes.normal || Object.values(pricesTypes)[0] || {};

    const marketUsd = (pricesObj as any)?.market || (pricesObj as any)?.mid || (pricesObj as any)?.low || 5.0;
    const marketThb = Math.round(marketUsd * EXCHANGE_RATE);

    return {
      id: apiCard.id,
      name: apiCard.name,
      thaiName: apiCard.name,
      set: apiCard.set.name,
      number: `${apiCard.number}/${apiCard.set.printedTotal}`,
      rarity: apiCard.rarity || 'Common',
      imageUrl: apiCard.images.large,
      marketPrice: marketThb,
      tcgplayerUrl: tcgData?.url,
      prices: {
        market: marketThb,
        low: Math.round(((pricesObj as any)?.low || marketUsd * 0.9) * EXCHANGE_RATE),
        mid: Math.round(((pricesObj as any)?.mid || marketUsd) * EXCHANGE_RATE),
        high: Math.round(((pricesObj as any)?.high || marketUsd * 1.2) * EXCHANGE_RATE),
        lastUpdated: tcgData?.updatedAt || new Date().toISOString()
      },
      change7d: parseFloat((Math.random() * 15 - 5).toFixed(1)),
      priceHistory: [
        { date: '1D', price: Math.round(marketThb * (0.95 + Math.random() * 0.1)) },
        { date: '7D', price: Math.round(marketThb * (0.9 + Math.random() * 0.1)) },
        { date: '1M', price: Math.round(marketThb * (0.8 + Math.random() * 0.2)) },
        { date: '3M', price: Math.round(marketThb * (0.7 + Math.random() * 0.3)) },
        { date: '6M', price: marketThb }
      ]
    };
  }
};
