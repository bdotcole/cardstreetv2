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
                .order('release_date', { ascending: false, nullsFirst: false })
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

            console.log('[fetchCardsBySet] Querying for set_id:', setId);

            // Query cards by set_id
            const { data: cards, error } = await supabase
                .from('pokemon_cards')
                .select('*')
                .ilike('set_id', setId)
                .order('number', { ascending: true });

            if (error) {
                console.error('Supabase error fetching cards:', error);
                return [];
            }

            console.log('[fetchCardsBySet] Found cards count:', cards?.length || 0);

            // If no cards found, try with ilike for partial match (debugging)
            if (cards && cards.length === 0) {
                const { data: debugCards } = await supabase
                    .from('pokemon_cards')
                    .select('set_id')
                    .ilike('set_id', `%${setId.split('-')[0]}%`)
                    .limit(5);
                console.log('[fetchCardsBySet] Debug - similar set_ids found:', debugCards?.map(c => c.set_id));
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

        // Cache key without language for cross-language search
        const cacheKey = `${query.toLowerCase().trim()}-all-languages`;
        if (searchIndex.has(cacheKey)) {
            return searchIndex.get(cacheKey) || [];
        }

        try {
            const supabase = createClient();
            const cleanQuery = query.toLowerCase().trim();

            // CROSS-LANGUAGE SEARCH: Search both 'name' and 'english_name' fields
            // This allows English users to find Thai cards and vice versa
            const { data: cards, error } = await supabase
                .from('pokemon_cards')
                .select(`
                    id, name, english_name, set_id, number, supertype, subtypes, 
                    rarity, hp, types, image_small, image_large, language, raw_data
                `)
                .or(`name.ilike.%${cleanQuery}%,english_name.ilike.%${cleanQuery}%`)
                .limit(100);

            if (error) {
                console.error('Search error:', error);
                return [];
            }

            // Get search popularity data
            const cardIds = (cards || []).map(c => c.id);
            const { data: popularityData } = await supabase
                .from('search_popularity')
                .select('card_id, search_count')
                .in('card_id', cardIds);

            const popularityMap = new Map(
                (popularityData || []).map(p => [p.card_id, p.search_count])
            );

            // Score results with popularity boost
            const scoredResults = (cards || []).map(card => {
                const nameLower = card.name?.toLowerCase() || '';
                const englishLower = card.english_name?.toLowerCase() || '';
                const queryLower = cleanQuery;

                let score = 0;

                // Exact match = highest score
                if (nameLower === queryLower || englishLower === queryLower) {
                    score = 100;
                }
                // Starts with query
                else if (nameLower.startsWith(queryLower) || englishLower.startsWith(queryLower)) {
                    score = 75;
                }
                // Contains query
                else if (nameLower.includes(queryLower) || englishLower.includes(queryLower)) {
                    score = 50;
                } else {
                    score = 25;
                }

                // POPULARITY BOOST - Machine learning from user searches!
                const searchCount = popularityMap.get(card.id) || 0;
                const popularityBoost = Math.min(50, Math.floor(searchCount / 10)); // Max +50 points
                score += popularityBoost;

                // Boost Pokemon cards over Trainers/Energy
                if (card.supertype === 'Pokémon') score += 10;

                // Hardcoded boost for most popular Pokemon
                const popularPokemon = [
                    'charizard', 'pikachu', 'mewtwo', 'rayquaza', 'lucario',
                    'eevee', 'gengar', 'dragonite', 'gyarados', 'garchomp',
                    'ลิซาร์ดอน', 'ปิกาจู', 'มิวทู' // Thai names for popular Pokemon
                ];
                if (popularPokemon.some(p => nameLower.includes(p) || englishLower.includes(p))) {
                    score += 30;
                }

                return { card, score };
            });

            // Sort by score descending and take top 30
            const topResults = scoredResults
                .sort((a, b) => b.score - a.score)
                .slice(0, 30)
                .map(r => this.mapSupabaseCardToInternal(r.card));

            // Track search popularity for top 10 results (learning!)
            if (topResults.length > 0) {
                // Fire and forget - track search popularity
                topResults.slice(0, 10).forEach(card => {
                    void supabase.rpc('increment_search_popularity', { p_card_id: card.id });
                });
            }

            // Cache results
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
