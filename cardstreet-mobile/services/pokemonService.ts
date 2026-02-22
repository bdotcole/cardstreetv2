/**
 * Pokemon Service - Mobile Implementation
 */

import { supabase } from '@/lib/supabase/client';
import { geminiService, SearchIntent } from './geminiService';
// Define Card type locally or import if shared types specific file exists
// For now, mirroring the web interface locally to avoid complex monorepo sharing setup

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

// Client-side search cache
const searchIndex = new Map<string, Card[]>();
const setsCache = new Map<string, { data: ApiSet[], totalCount: number }>();

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
            return result;
        } catch (error) {
            console.error("Failed to fetch sets from Supabase:", error);
            return { data: [], totalCount: 0 };
        }
    },

    async fetchCardsBySet(setId: string, language?: 'en' | 'jp' | 'th') {
        try {
            console.log('[fetchCardsBySet] Querying for set_id:', setId, 'language:', language);

            // Query cards by set_id with market_values join
            const { data: cards, error } = await supabase
                .from('pokemon_cards')
                .select('*, market_values(market_avg, last_updated)')
                .ilike('set_id', setId)
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

            return filteredCards.map(c => this.mapSupabaseCardToInternal(c));
        } catch (error) {
            console.error("Failed to fetch cards from Supabase:", error);
            return [];
        }
    },

    async searchCards(query: string, useAiResolution: boolean = false, language?: 'en' | 'jp' | 'th') {
        if (!query || query.trim().length < 2) return [];

        const cacheKey = `${query.toLowerCase().trim()}-all-languages`;
        if (searchIndex.has(cacheKey)) {
            return searchIndex.get(cacheKey) || [];
        }

        try {
            const cleanQuery = query.toLowerCase().trim();

            const { data: cards, error } = await supabase
                .from('pokemon_cards')
                .select(`
                    id, name, english_name, set_id, number, supertype, subtypes, 
                    rarity, hp, types, image_small, image_large, language, raw_data,
                    market_values(market_avg, last_updated)
                `)
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
        const rawData = supabaseCard.raw_data || {};
        const tcgData = rawData.tcgplayer;

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

        const fixTcgdexUrl = (url: string | null): string => {
            if (!url) return '';
            if (url.includes('tcgdex.net') && !url.match(/\.(png|jpg|jpeg|webp)$/i)) {
                return `${url}.png`;
            }
            return url;
        };

        let imageUrl = '';
        if (supabaseCard.image_large) imageUrl = fixTcgdexUrl(supabaseCard.image_large);
        else if (supabaseCard.image_small) imageUrl = fixTcgdexUrl(supabaseCard.image_small);
        else if (rawData.images?.large) imageUrl = rawData.images.large;
        else imageUrl = 'https://images.pokemontcg.io/placeholder.png';

        return {
            id: supabaseCard.id,
            name: supabaseCard.name,
            thaiName: supabaseCard.name,
            set: rawData.set?.name || 'Unknown Set',
            number: supabaseCard.number ? `${supabaseCard.number}/${rawData.set?.printedTotal || '??'}` : '??',
            rarity: supabaseCard.rarity || 'Common',
            imageUrl: imageUrl,
            images: {
                small: imageUrl, // Simplified for mobile
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
