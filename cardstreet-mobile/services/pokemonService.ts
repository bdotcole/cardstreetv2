/**
 * Pokemon Service - Mobile Implementation
 */

import { supabase } from '@/lib/supabase/client';
import { geminiService, SearchIntent } from './geminiService';
import AsyncStorage from '@react-native-async-storage/async-storage';
// Define Card type locally or import if shared types specific file exists
// For now, mirroring the web interface locally to avoid complex monorepo sharing setup

const SETS_TTL_MS = 24 * 60 * 60 * 1000; // 24h — set lists rarely change
const CARDS_TTL_MS = 6 * 60 * 60 * 1000; // 6h — card lists per set
const STORAGE_PREFIX = 'pokemonCache:v1:';

async function readPersistent<T>(key: string, ttlMs: number): Promise<T | null> {
    try {
        const raw = await AsyncStorage.getItem(STORAGE_PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { t: number; v: T };
        if (Date.now() - parsed.t > ttlMs) return null;
        return parsed.v;
    } catch {
        return null;
    }
}

async function writePersistent<T>(key: string, value: T): Promise<void> {
    try {
        await AsyncStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
    } catch {
        // Swallow — cache write failures should never break the UI
    }
}

export interface Card {
    id: string;
    name: string;
    thaiName?: string;
    set: string;
    number: string;
    rarity: string;
    imageUrl: string;
    images?: {
        small: string;
        large: string;
    };
    marketPrice?: number;
    tcgplayerUrl?: string;
    prices?: {
        market: number;
        low: number;
        mid: number;
        high: number;
        lastUpdated: string;
    };
    change7d?: number | null;
    priceHistory?: any[];
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

const EXCHANGE_RATE = 35.85;

// In-memory caches (fast path) — backed by AsyncStorage for persistence across restarts
const searchIndex = new Map<string, Card[]>();
const setsCache = new Map<string, { data: ApiSet[], totalCount: number }>();
const cardsCache = new Map<string, Card[]>();

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
        const persisted = await readPersistent<{ data: ApiSet[], totalCount: number }>(cacheKey, SETS_TTL_MS);
        if (persisted) {
            setsCache.set(cacheKey, persisted);
            return persisted;
        }

        try {
            // Calculate pagination offsets
            const from = (page - 1) * pageSize;
            const to = from + pageSize - 1;

            // Map app language to database language
            let dbLang = 'en';
            if (language?.includes('jp')) dbLang = 'ja';
            if (language?.includes('th')) dbLang = 'th';

            // Query Supabase for sets
            const { data: sets, error, count } = await supabase
                .from('pokemon_sets')
                .select('*', { count: 'exact' })
                .eq('language', dbLang)
                .order('release_date', { ascending: false, nullsFirst: false })
                .range(from, to);

            if (error) {
                console.error('Supabase error fetching sets:', error);
                return { data: [], totalCount: 0 };
            }

            // Transform Supabase data to match API format
            const transformedSets: ApiSet[] = (sets || []).map(s => {
                const fixTcgdexUrl = (url: string | null): string => {
                    if (!url) return '';
                    if (url.includes('tcgdex.net') && !url.match(/\.(png|jpg|jpeg|webp|svg)$/i)) {
                        return `${url}.png`;
                    }
                    return url;
                };

                return {
                    id: s.id,
                    name: s.name,
                    series: s.series || '',
                    printedTotal: s.printed_total || 0,
                    total: s.total || 0,
                    releaseDate: s.release_date || '',
                    updatedAt: s.updated_at || '',
                    images: {
                        symbol: fixTcgdexUrl(s.symbol_url),
                        logo: fixTcgdexUrl(s.logo_url)
                    }
                };
            });

            const result = { data: transformedSets, totalCount: count || 0 };
            setsCache.set(cacheKey, result);
            writePersistent(cacheKey, result);
            return result;
        } catch (error) {
            console.error("Failed to fetch sets from Supabase:", error);
            return { data: [], totalCount: 0 };
        }
    },

    async fetchCardsBySet(setId: string, language?: 'en' | 'jp' | 'th') {
        const cacheKey = `cards-${setId}-${language || 'any'}`;
        if (cardsCache.has(cacheKey)) {
            return cardsCache.get(cacheKey)!;
        }
        const persisted = await readPersistent<Card[]>(cacheKey, CARDS_TTL_MS);
        if (persisted) {
            cardsCache.set(cacheKey, persisted);
            return persisted;
        }
        try {
            console.log('[fetchCardsBySet] Querying for set_id:', setId, 'language:', language);

            // Only the columns the grid renders — drops the large raw_data JSONB blob.
            // pokemon_sets join + raw_data->tcgplayer JSONB path keep payload small while
            // preserving the set name/total and the price fallback that the mapper uses.
            const { data: cards, error } = await supabase
                .from('pokemon_cards')
                .select('id, name, english_name, set_id, number, rarity, image_small, image_large, language, raw_data->tcgplayer, pokemon_sets(name, printed_total, total), market_values(market_avg, last_updated)')
                .eq('set_id', setId)
                .order('number', { ascending: true });

            if (error) {
                console.error('Supabase error fetching cards:', error);
                return [];
            }

            // Filter by language using character detection if language specified
            let filteredCards = cards || [];
            if (language && cards) {
                const hasJapaneseChars = (text: string) => {
                    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
                    return japaneseRegex.test(text);
                };

                if (language === 'jp') {
                    filteredCards = cards.filter(c => hasJapaneseChars(c.name || ''));
                } else {
                    filteredCards = cards.filter(c => !hasJapaneseChars(c.name || ''));
                }
            }

            const mapped = filteredCards.map(c => this.mapSupabaseCardToInternal(c));
            cardsCache.set(cacheKey, mapped);
            writePersistent(cacheKey, mapped);
            return mapped;
        } catch (error) {
            console.error("Failed to fetch cards from Supabase:", error);
            return [];
        }
    },

    async searchCards(query: string, useAiResolution: boolean = false, language?: 'en' | 'jp' | 'th', game: string = 'pokemon') {
        if (!query || query.trim().length < 2) return [];

        // Scope to the browsing game so a search doesn't surface cards from the
        // other games sharing the pokemon_cards table (MTG, Yu-Gi-Oh, One Piece,
        // Riftbound, Lorcana). Defaults to pokemon since the mobile browse view
        // is currently Pokemon-only.
        const cacheKey = `${query.toLowerCase().trim()}-${game}-all-languages`;
        if (searchIndex.has(cacheKey)) {
            return searchIndex.get(cacheKey) || [];
        }

        try {
            const cleanQuery = query.toLowerCase().trim();

            const { data: cards, error } = await supabase
                .from('pokemon_cards')
                .select(`
                    id, name, english_name, set_id, number,
                    rarity, image_small, image_large, language,
                    raw_data->tcgplayer,
                    pokemon_sets(name, printed_total, total),
                    market_values(market_avg, last_updated)
                `)
                .eq('game', game)
                .or(`name.ilike.%${cleanQuery}%,english_name.ilike.%${cleanQuery}%`)
                .limit(50); // Lower limit for mobile

            if (error) {
                console.error('Search error:', error);
                return [];
            }

            // Simplified scoring logic for mobile performance
            const scoredResults = (cards || []).map(card => {
                const nameLower = card.name?.toLowerCase() || '';
                const englishLower = card.english_name?.toLowerCase() || '';

                let score = 0;
                if (nameLower === cleanQuery || englishLower === cleanQuery) score = 100;
                else if (nameLower.startsWith(cleanQuery) || englishLower.startsWith(cleanQuery)) score = 75;
                else if (nameLower.includes(cleanQuery) || englishLower.includes(cleanQuery)) score = 50;
                else score = 25;

                return { card, score };
            });

            const topResults = scoredResults
                .sort((a, b) => b.score - a.score)
                .slice(0, 30)
                .map(r => this.mapSupabaseCardToInternal(r.card));

            if (topResults.length > 0) {
                searchIndex.set(cacheKey, topResults);
            }

            return topResults;
        } catch (error) {
            console.error("Search failure:", error);
            return [];
        }
    },

    mapSupabaseCardToInternal(supabaseCard: any): Card {
        // raw_data->tcgplayer is selected via JSONB path, so it lands on the row as `tcgplayer`
        const tcgData = supabaseCard.tcgplayer;
        const setRel = supabaseCard.pokemon_sets;

        let marketThb = 0;
        let lastUpdated = '';

        const marketValueData = Array.isArray(supabaseCard.market_values)
            ? supabaseCard.market_values[0]
            : supabaseCard.market_values;

        if (marketValueData && marketValueData.market_avg > 0) {
            marketThb = Math.round(marketValueData.market_avg);
            lastUpdated = marketValueData.last_updated;
        } else {
            const pricesTypes = tcgData?.prices || {};
            const pricesObj = pricesTypes.holofoil || pricesTypes.normal || Object.values(pricesTypes)[0] || {};
            const marketUsd = (pricesObj as any)?.market || (pricesObj as any)?.mid || 0;
            marketThb = Math.round(marketUsd * EXCHANGE_RATE);
        }

        // TCGdex URLs have a "/{quality}/{ext}" convention — for thumbnails we want /low.webp,
        // for the full card we want /high.webp. Older rows may already include the extension.
        const buildTcgdexUrl = (url: string | null, quality: 'low' | 'high'): string => {
            if (!url) return '';
            if (!url.includes('tcgdex.net')) return url;
            // Strip an existing quality/extension suffix if present, then append the desired one
            const stripped = url.replace(/\/(low|high)(\.(png|jpg|jpeg|webp))?$/i, '')
                                .replace(/\.(png|jpg|jpeg|webp)$/i, '');
            return `${stripped}/${quality}.webp`;
        };

        // pokemontcg.io: foo.png is small, foo_hires.png is large — strip _hires for the thumbnail
        const toSmallPokemonTcg = (url: string): string => {
            if (!url.includes('pokemontcg.io')) return url;
            return url.replace(/_hires(\.(png|jpg|jpeg|webp))/i, '$1');
        };

        const resolveImage = (rawUrl: string | null, quality: 'low' | 'high'): string => {
            if (!rawUrl) return '';
            if (rawUrl.includes('tcgdex.net')) return buildTcgdexUrl(rawUrl, quality);
            if (rawUrl.includes('pokemontcg.io')) {
                return quality === 'low' ? toSmallPokemonTcg(rawUrl) : rawUrl;
            }
            return rawUrl;
        };

        const largeRaw = supabaseCard.image_large || supabaseCard.image_small;
        const smallRaw = supabaseCard.image_small || supabaseCard.image_large;

        const imageUrl = largeRaw ? resolveImage(largeRaw, 'high') : 'https://images.pokemontcg.io/placeholder.png';
        const imageSmall = smallRaw ? resolveImage(smallRaw, 'low') : imageUrl;

        const setTotal = setRel?.printed_total || setRel?.total || '??';

        return {
            id: supabaseCard.id,
            name: supabaseCard.name,
            thaiName: supabaseCard.name,
            set: setRel?.name || 'Unknown Set',
            number: supabaseCard.number ? `${supabaseCard.number}/${setTotal}` : '??',
            rarity: supabaseCard.rarity || 'Common',
            imageUrl: imageUrl,
            images: {
                small: imageSmall,
                large: imageUrl
            },
            marketPrice: marketThb,
            prices: {
                market: marketThb,
                low: Math.round(marketThb * 0.9),
                mid: marketThb,
                high: Math.round(marketThb * 1.1),
                lastUpdated: lastUpdated || new Date().toISOString()
            }
        };
    }
};
