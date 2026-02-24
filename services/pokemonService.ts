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
            const response = await fetch(`/api/sets?language=${language}&page=${page}&pageSize=${pageSize}`);
            if (!response.ok) {
                console.error('Failed to fetch sets from Edge API:', response.statusText);
                return { data: [], totalCount: 0 };
            }
            const result = await response.json();

            setsCache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.error("Failed to fetch sets from Edge API:", error);
            return { data: [], totalCount: 0 };
        }
    },

    async fetchCardsBySet(setId: string, language?: 'en' | 'jp' | 'th') {
        try {
            console.log('[fetchCardsBySet] Querying via Edge API for set_id:', setId, 'language:', language);

            const response = await fetch(`/api/sets/${setId}/cards${language ? `?language=${language}` : ''}`);
            if (!response.ok) {
                console.error('Failed to fetch cards from Edge API:', response.statusText);
                return [];
            }

            const filteredCards = await response.json();

            return filteredCards.map(c => this.mapSupabaseCardToInternal(c));
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

            // Try exact match first (searching both name and english_name)
            // Use RAW SQL-like filter for OR condition with AND on number
            let { data: cards, error } = await supabase
                .from('pokemon_cards')
                .select('*, market_values(market_avg, last_updated), pokemon_sets(name)')
                .or(`name.ilike.%${cleanName}%,english_name.ilike.%${cleanName}%`)
                .eq('number', cleanNumber)
                .limit(5);

            // If no results, try broader search
            if (!cards || cards.length === 0) {
                const { data: fallbackCards } = await supabase
                    .from('pokemon_cards')
                    .select('*, market_values(market_avg, last_updated), pokemon_sets(name)')
                    .or(`name.ilike.%${cleanName}%,english_name.ilike.%${cleanName}%`)
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
                    rarity, hp, types, image_small, image_large, language, raw_data,
                    market_values(market_avg, last_updated),
                    pokemon_sets(name)
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

                // Extract root name (before any suffix like V, VMAX, EX, GX, etc.)
                const suffixes = [' v', ' vmax', ' vstar', ' ex', ' gx', ' tag team', ' break', ' prime', '-v', '-ex', '-gx'];
                const getRootName = (name: string) => {
                    let root = name.toLowerCase();
                    for (const suffix of suffixes) {
                        const idx = root.indexOf(suffix);
                        if (idx !== -1) {
                            root = root.substring(0, idx).trim();
                            break;
                        }
                    }
                    return root;
                };

                const nameRoot = getRootName(nameLower);
                const englishRoot = getRootName(englishLower);

                let score = 0;

                // Exact match = highest score
                if (nameLower === queryLower || englishLower === queryLower) {
                    score = 100;
                }
                // Root name exact match (e.g., "pikachu" matches "Pikachu V")
                else if (nameRoot === queryLower || englishRoot === queryLower) {
                    score = 90;
                }
                // Starts with query
                else if (nameLower.startsWith(queryLower) || englishLower.startsWith(queryLower)) {
                    score = 75;
                }
                // Root starts with query
                else if (nameRoot.startsWith(queryLower) || englishRoot.startsWith(queryLower)) {
                    score = 70;
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

        // Use live market_values if available, otherwise fallback to raw_data
        let marketThb = 0;
        let lastUpdated = '';

        // Check if market_values joined data exists (it might be an array or single object depending on relationship)
        const marketValueData = Array.isArray(supabaseCard.market_values)
            ? supabaseCard.market_values[0]
            : supabaseCard.market_values;

        if (marketValueData && marketValueData.market_avg > 0) {
            marketThb = Math.round(marketValueData.market_avg);
            lastUpdated = marketValueData.last_updated;
        } else {
            // Fallback to approximated old data (likely USD)
            const marketUsd = (pricesObj as any)?.market || (pricesObj as any)?.mid || (pricesObj as any)?.low || 0;
            marketThb = Math.round(marketUsd * EXCHANGE_RATE);
        }

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

        let setName = supabaseCard.pokemon_sets?.name || rawData.set?.name || 'Unknown Set';

        // Add dual-language wrapper for Thai sets to ensure filtering and visibility
        if (supabaseCard.language === 'th') {
            const thaiSetMap: Record<string, string> = {
                'SV1V': 'Violet ex',
                'SV1S': 'Scarlet ex',
                'SV2D': 'Clay Burst',
                'SV2P': 'Snow Hazard',
                'SV5K': 'Wild Force',
                'SV5M': 'Cyber Judge',
                'MA1': 'Mega Evolution',
                'MA2': 'Crimson Haze',
                'MA3': 'Mega Evolution Dream ex',
                'SV10s': 'The Unbeatable Hero',
                'SV9s': 'Destiny Threads',
                // Keep extending as needed
            };
            const engName = thaiSetMap[supabaseCard.set_id];
            if (engName && !setName.includes(engName)) {
                setName = `${engName} (${setName})`;
            }
        }

        return {
            id: supabaseCard.id,
            name: supabaseCard.name,
            thaiName: supabaseCard.english_name || supabaseCard.name, // Try to store both
            set: setName,
            language: supabaseCard.language || 'en',
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
                low: Math.round(marketThb * 0.9),
                mid: marketThb,
                high: Math.round(marketThb * 1.1),
                lastUpdated: lastUpdated || tcgData?.updatedAt || new Date().toISOString()
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
