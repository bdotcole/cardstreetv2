/**
 * Pokemon Service - Supabase Implementation
 * 
 * This service queries Pokemon card and set data from Supabase
 * instead of the external Pokemon TCG API for better performance.
 */

import { createClient } from '@/lib/supabase/client';
import { geminiService, SearchIntent } from './geminiService';
import { Card } from '../types';

const EXCHANGE_RATE = 35.85;

// Client-side search cache
const searchIndex = new Map<string, Card[]>();
const setsCache = new Map<string, { data: ApiSet[], totalCount: number }>();

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
            const supabase = createClient();

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
                .order('release_date', { ascending: false })
                .range(from, to);

            if (error) {
                console.error('Supabase error fetching sets:', error);
                return { data: [], totalCount: 0 };
            }

            // Transform Supabase data to match API format
            const transformedSets: ApiSet[] = (sets || []).map(s => {
                // Helper to fix TCGdex URLs (same as card images)
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

    async fetchCardsBySet(setId: string) {
        try {
            const supabase = createClient();

            // Query cards by set_id
            const { data: cards, error } = await supabase
                .from('pokemon_cards')
                .select('*')
                .eq('set_id', setId)
                .order('number', { ascending: true });

            if (error) {
                console.error('Supabase error fetching cards:', error);
                return [];
            }

            return (cards || []).map(c => this.mapSupabaseCardToInternal(c));
        } catch (error) {
            console.error("Failed to fetch cards from Supabase:", error);
            return [];
        }
    },

    async findCardByMetadata(name: string, set: string, number: string): Promise<Card[]> {
        try {
            const supabase = createClient();

            const cleanNumber = number.split('/')[0].trim();
            const cleanName = name.replace(/[^a-zA-Z0-9 ]/g, '').trim();

            // Try exact match first
            let { data: cards, error } = await supabase
                .from('pokemon_cards')
                .select('*')
                .ilike('name', `%${cleanName}%`)
                .eq('number', cleanNumber)
                .limit(5);

            // If no results, try broader search
            if (!cards || cards.length === 0) {
                const { data: fallbackCards } = await supabase
                    .from('pokemon_cards')
                    .select('*')
                    .ilike('name', `%${cleanName}%`)
                    .limit(5);

                cards = fallbackCards;
            }

            if (error) {
                console.error('Supabase error searching cards:', error);
                return [];
            }

            return (cards || []).map(c => this.mapSupabaseCardToInternal(c));
        } catch (error) {
            console.error("Metadata match failed:", error);
            return [];
        }
    },

    async searchCards(query: string, useAiResolution: boolean = false, language?: 'en' | 'jp' | 'th') {
        if (!query || query.trim().length < 2) return [];

        const cacheKey = `${query.toLowerCase().trim()}-${language || 'all'}`;
        if (searchIndex.has(cacheKey)) {
            return searchIndex.get(cacheKey) || [];
        }

        try {
            const supabase = createClient();
            const containsThai = /[\u0E00-\u0E7F]/.test(query);
            const containsJapanese = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/.test(query);
            const lowerQuery = query.toLowerCase();

            // Determine language filter - use provided language or auto-detect from query
            let langFilter: string | null = null;
            if (language) {
                // Map 'jp' to 'ja' for database
                langFilter = language === 'jp' ? 'ja' : language;
            } else if (containsThai || lowerQuery.includes('thai') || lowerQuery.includes(' th ')) {
                langFilter = 'th';
            } else if (containsJapanese || lowerQuery.includes('japanese') || lowerQuery.includes(' jp') || lowerQuery.includes(' ja ')) {
                langFilter = 'ja';
            } else if (lowerQuery.includes('english') || lowerQuery.includes(' en ')) {
                langFilter = 'en';
            }

            // Clean search term
            const cleanQuery = query
                .toLowerCase()
                .replace(/\b(japanese|jp|jpn|thai|th|english|en)\b/g, '')
                .trim();

            // Multi-strategy search for better results
            let queryBuilder = supabase
                .from('pokemon_cards')
                .select('id, name, set_id, number, supertype, subtypes, rarity, hp, types, image_small, image_large, language, raw_data');

            // Apply language filter if detected
            if (langFilter) {
                queryBuilder = queryBuilder.eq('language', langFilter);
            }

            // Use case-insensitive name search with wildcards
            if (cleanQuery) {
                queryBuilder = queryBuilder.ilike('name', `%${cleanQuery}%`);
            }

            // Order by relevance: exact matches first, then partial
            // PERFORMANCE: Limit to 50 results max
            const { data: cards, error } = await queryBuilder
                .order('name', { ascending: true })
                .limit(50);

            if (error) {
                console.error('Supabase search error:', error);
                return [];
            }

            // Score and sort results
            const scoredResults = (cards || []).map(card => {
                const nameLower = card.name.toLowerCase();
                const queryLower = cleanQuery.toLowerCase();

                let score = 0;
                if (nameLower === queryLower) score = 100;
                else if (nameLower.startsWith(queryLower)) score = 75;
                else if (nameLower.includes(queryLower)) score = 50;
                else score = 25;

                // Boost Pokemon cards
                if (card.supertype === 'Pokémon') score += 10;

                return { card, score };
            });

            // Sort by score and take top 30
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
        // Extract price data from raw_data JSONB field (contains full API response)
        const rawData = supabaseCard.raw_data || {};
        const tcgData = rawData.tcgplayer;
        const pricesTypes = tcgData?.prices || {};
        const pricesObj = pricesTypes.holofoil || pricesTypes.normal || Object.values(pricesTypes)[0] || {};

        const marketUsd = (pricesObj as any)?.market || (pricesObj as any)?.mid || (pricesObj as any)?.low || 5.0;
        const marketThb = Math.round(marketUsd * EXCHANGE_RATE);

        // Helper function to ensure TCGdex URLs have .png extension
        const fixTcgdexUrl = (url: string | null): string => {
            if (!url) return '';
            // TCGdex requires .png extension (e.g., /high.png not just /high)
            if (url.includes('tcgdex.net') && !url.match(/\.(png|jpg|jpeg|webp)$/i)) {
                return `${url}.png`;
            }
            return url;
        };

        // Fix image URLs - Handle both TCGdex and Pokemon TCG API formats
        let imageUrl = '';
        let imageSmall = '';

        // TCGdex format: URLs need .png extension appended
        if (supabaseCard.image_large) {
            imageUrl = fixTcgdexUrl(supabaseCard.image_large);
        } else if (supabaseCard.image_small) {
            imageUrl = fixTcgdexUrl(supabaseCard.image_small);
        }
        // Pokemon TCG API format: use raw_data.images
        else if (rawData.images?.large) {
            imageUrl = rawData.images.large;
            imageSmall = rawData.images.small;
        }
        // Fallback to raw_data.image (TCGdex base URL)
        else if (rawData.image) {
            const baseUrl = rawData.image.includes('http') ? rawData.image : `${rawData.image}/high`;
            imageUrl = fixTcgdexUrl(baseUrl);
        }
        // Ultimate fallback: placeholder
        else {
            imageUrl = 'https://images.pokemontcg.io/placeholder.png';
        }

        // Fix imageSmall too
        if (supabaseCard.image_small && !imageSmall) {
            imageSmall = fixTcgdexUrl(supabaseCard.image_small);
        }

        return {
            id: supabaseCard.id,
            name: supabaseCard.name,
            thaiName: supabaseCard.name,
            set: rawData.set?.name || 'Unknown Set',
            number: supabaseCard.number ? `${supabaseCard.number}/${rawData.set?.printedTotal || '??'}` : '??',
            rarity: supabaseCard.rarity || 'Common',
            imageUrl: imageUrl,
            images: {
                small: imageSmall || imageUrl,
                large: imageUrl
            },
            marketPrice: marketThb,
            tcgplayerUrl: supabaseCard.tcgplayer_url,
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
