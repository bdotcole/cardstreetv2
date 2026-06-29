/**
 * Pokemon Service - Supabase Implementation
 * 
 * This service queries Pokemon card and set data from Supabase
 * instead of the external Pokemon TCG API for better performance.
 */

import { createClient } from '@/lib/supabase/client';
import { geminiService, SearchIntent } from './geminiService';
import { Card } from '../types';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';

// Client-side search cache
const searchIndex = new Map<string, Card[]>();
const setsCache = new Map<string, { data: ApiSet[], totalCount: number }>();
let allSetsDbCache: { id: string, name: string }[] | null = null;

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

export interface SealedProduct {
    id: string;
    name: string;
    productType: string | null;
    setId: string | null;
    imageUrl: string | null;
    price: number | null;       // THB (base); multiply by display exchangeRate
    prices: { sealed: number | null; cib: number | null; loose: number | null };
    currency: string;
    lastUpdated?: string;
}

export const pokemonService = {
    async fetchSets(
        language: 'en' | 'jp' | 'th' | 'pokemon-en' | 'pokemon-jp' | 'pokemon-th' = 'en',
        page: number = 1,
        pageSize: number = 15,
        game: string = 'pokemon'
    ): Promise<{ data: ApiSet[], totalCount: number }> {
        const cacheKey = `sets-${game}-${language}-${page}-${pageSize}`;
        if (setsCache.has(cacheKey)) {
            return setsCache.get(cacheKey)!;
        }

        try {
            const response = await fetch(`/api/sets?game=${game}&language=${language}&page=${page}&pageSize=${pageSize}`);
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

    async fetchCardsBySet(setId: string, language?: 'en' | 'jp' | 'th', game: string = 'pokemon') {
        try {
            console.log('[fetchCardsBySet] Querying via Edge API for set_id:', setId, 'language:', language, 'game:', game);

            const params = new URLSearchParams({ game });
            if (language) params.set('language', language);
            const response = await fetch(`/api/sets/${setId}/cards?${params.toString()}`);
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

    async findCardByMetadata(name: string, setHint: string, numberStr: string, languageHint: string = 'en'): Promise<Card[]> {
        try {
            const supabase = createClient();

            // Clean inputs for resilient ILIKE matching
            const cleanNumber = (numberStr || '').split('/')[0].replace(/[^a-zA-Z0-9]/g, '').trim(); 
            const cleanName = (name || '').replace(/[^a-zA-Z0-9 ]/g, '').trim();
            const cleanSet = (setHint || '').replace(/[^a-zA-Z0-9]/g, '').trim();

            const baseSelect = '*, market_values(market_avg, currency, last_updated), pokemon_sets(name, printed_total, total)';
            const nameSearch = `name.ilike.%${cleanName}%,english_name.ilike.%${cleanName}%`;

            // TIER 1: The "Perfect" Strict Match (Name + Number + Set + Language)
            if (cleanSet && cleanNumber) {
                let strictQuery = supabase.from('pokemon_cards').select(baseSelect)
                    .or(nameSearch)
                    .or(`number.eq.${cleanNumber},number.ilike.${cleanNumber}/%`)
                    .ilike('set_id', `%${cleanSet}%`);
                if (languageHint && languageHint !== 'other') strictQuery = strictQuery.eq('language', languageHint);
                
                const { data: cards, error } = await strictQuery.limit(5);
                if (cards && cards.length > 0) return cards.map(c => this.mapSupabaseCardToInternal(c));
            }

            // TIER 2: Missing/Hallucinated Set Code (Name + Number + Language)
            if (cleanNumber) {
                let numQuery = supabase.from('pokemon_cards').select(baseSelect)
                    .or(nameSearch)
                    .or(`number.eq.${cleanNumber},number.ilike.${cleanNumber}/%`);
                if (languageHint && languageHint !== 'other') numQuery = numQuery.eq('language', languageHint);
                
                const { data: fallbackCards } = await numQuery.limit(5);
                if (fallbackCards && fallbackCards.length > 0) return fallbackCards.map(c => this.mapSupabaseCardToInternal(c));
            }

            // TIER 3: Missing/Hallucinated Number (Name + Set Code + Language)
            if (cleanSet) {
                let setQuery = supabase.from('pokemon_cards').select(baseSelect).or(nameSearch).ilike('set_id', `%${cleanSet}%`);
                if (languageHint && languageHint !== 'other') setQuery = setQuery.eq('language', languageHint);
                
                const { data: setFallback } = await setQuery.limit(5);
                if (setFallback && setFallback.length > 0) return setFallback.map(c => this.mapSupabaseCardToInternal(c));
            }

            // TIER 4: Absolute Broadest Fallback (Name Only, cross-language)
            const { data: broadFallback, error } = await supabase.from('pokemon_cards').select(baseSelect).or(nameSearch).limit(5);
            
            if (error) {
                console.error('Supabase error searching cards:', error);
                return [];
            }

            return (broadFallback || []).map(c => this.mapSupabaseCardToInternal(c));
        } catch (error) {
            console.error("Metadata match failed:", error);
            return [];
        }
    },

    async searchCards(query: string, useAiResolution: boolean = false, language?: 'en' | 'jp' | 'th', game: string = 'pokemon') {
        if (!query || query.trim().length < 2) return [];

        // Scope search to the browsing context (game + language) so a Pokemon
        // search doesn't surface One Piece/MTG and vice versa.
        const dbLang = language === 'jp' ? 'ja' : language;
        const cacheKey = `${query.toLowerCase().trim()}-${game}-${dbLang || 'all'}`;
        if (searchIndex.has(cacheKey)) {
            return searchIndex.get(cacheKey) || [];
        }

        try {
            const supabase = createClient();
            const cleanQuery = query.toLowerCase().trim();

            // 1. Fetch all set names to extract set from query
            if (!allSetsDbCache) {
                const { data } = await supabase.from('pokemon_sets').select('id, name');
                allSetsDbCache = data || [];
            }
            
            const matchedSetIds: string[] = [];
            let queryWithoutSet = cleanQuery;
            
            if (allSetsDbCache && allSetsDbCache.length > 0) {
                // Sort by name length descending to match longest set names first
                const sortedSets = [...allSetsDbCache].sort((a, b) => b.name.length - a.name.length);
                
                for (const set of sortedSets) {
                    const setNameLower = set.name.toLowerCase();
                    const setIdLower = set.id.toLowerCase();
                    
                    // Exact match on set name or ID
                    if (cleanQuery === setNameLower || cleanQuery === setIdLower) {
                        matchedSetIds.push(set.id);
                        queryWithoutSet = '';
                        break;
                    }
                    
                    // Substring match with word boundary on Set ID (e.g., "sv4a")
                    const idRegex = new RegExp(`\\b${setIdLower}\\b`, 'i');
                    if (idRegex.test(cleanQuery)) {
                        matchedSetIds.push(set.id);
                        queryWithoutSet = cleanQuery.replace(idRegex, '').trim();
                        break;
                    }
                    
                    // Substring match with word boundary on Set Name
                    const escapedSetName = setNameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const nameRegex = new RegExp(`\\b${escapedSetName}\\b`, 'i');
                    if (nameRegex.test(cleanQuery)) {
                        matchedSetIds.push(set.id);
                        queryWithoutSet = cleanQuery.replace(nameRegex, '').trim();
                        break;
                    }
                }
            }

            // CROSS-LANGUAGE SEARCH: Search both 'name' and 'english_name' fields
            // This allows English users to find Thai cards and vice versa
            let dbQuery = supabase
                .from('pokemon_cards')
                .select(`
                    id, name, english_name, set_id, number, supertype, subtypes,
                    rarity, hp, types, game, image_small, image_large, language, raw_data,
                    market_values(market_avg, currency, last_updated),
                    pokemon_sets(name, printed_total, total)
                `)
                .eq('game', game);

            if (dbLang) dbQuery = dbQuery.eq('language', dbLang);

            if (matchedSetIds.length > 0) {
                dbQuery = dbQuery.in('set_id', matchedSetIds);
                if (queryWithoutSet.length > 0) {
                    dbQuery = dbQuery.or(`name.ilike.%${queryWithoutSet}%,english_name.ilike.%${queryWithoutSet}%`);
                }
            } else {
                // Fallback: check if the query is a partial set name
                const { data: partialSets } = await supabase.from('pokemon_sets').select('id').ilike('name', `%${cleanQuery}%`);
                const partialSetIds = partialSets?.map(s => s.id) || [];
                
                let orStr = `name.ilike.%${cleanQuery}%,english_name.ilike.%${cleanQuery}%`;
                if (partialSetIds.length > 0) {
                    orStr += `,set_id.in.(${partialSetIds.join(',')})`;
                }
                dbQuery = dbQuery.or(orStr);
            }

            const { data: cards, error } = await dbQuery.limit(100);

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

                // Pokemon-specific ranking boosts only apply when searching Pokemon.
                if (game === 'pokemon') {
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

    async fetchSealedProducts(opts: { game: string; setId?: string; q?: string; language?: string }): Promise<SealedProduct[]> {
        try {
            const params = new URLSearchParams({ game: opts.game });
            if (opts.setId) params.set('setId', opts.setId);
            if (opts.q) params.set('q', opts.q);
            if (opts.language) params.set('language', opts.language);
            const res = await fetch(`/api/sealed?${params.toString()}`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.products || [];
        } catch (error) {
            console.error('Failed to fetch sealed products:', error);
            return [];
        }
    },

    mapSupabaseCardToInternal(supabaseCard: any): Card {
        return mapSupabaseCardToInternal(supabaseCard);
    },

    async fetchCardsByIds(ids: string[]): Promise<Card[]> {
        if (!ids || ids.length === 0) return [];
        try {
            const supabase = createClient();
            const { data, error } = await supabase
                .from('pokemon_cards')
                .select(`
                    *,
                    market_values(market_avg, currency, last_updated),
                    pokemon_sets(name, printed_total, total)
                `)
                .in('id', ids);
            if (error) {
                console.error('fetchCardsByIds error:', error);
                return [];
            }
            const byId = new Map((data || []).map(r => [r.id, r]));
            return ids.map(id => byId.get(id)).filter(Boolean).map(r => mapSupabaseCardToInternal(r));
        } catch (e) {
            console.error('fetchCardsByIds failed:', e);
            return [];
        }
    }
};
