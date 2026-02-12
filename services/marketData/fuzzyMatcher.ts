/**
 * Fuzzy Matcher for Card Mappings
 * Matches Thai cards to English/Japanese counterparts using multiple strategies
 */

import { createClient } from '@/lib/supabase/client';

export interface Card {
    id: string;
    name: string;
    english_name?: string;
    set_id: string;
    number: string;
    rarity: string;
    language: string;
    image_small?: string;
    image_large?: string;
}

export interface MatchResult {
    cardId: string;
    card: Card;
    confidence: number;
    method: 'name_exact' | 'name_fuzzy' | 'number_match' | 'rarity_match';
}

export class FuzzyMatcher {
    /**
     * Calculate similarity score between two strings (0-1)
     * Uses Levenshtein distance normalized by string length
     */
    private calculateSimilarity(str1: string, str2: string): number {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1.0;

        const distance = this.levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
        return (longer.length - distance) / longer.length;
    }

    /**
     * Levenshtein distance algorithm
     */
    private levenshteinDistance(str1: string, str2: string): number {
        const matrix: number[][] = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }

    /**
     * Match Thai card to English cards
     * Priority: name match > set/number match > rarity match
     */
    async matchToEnglish(thaiCard: Card): Promise<MatchResult[]> {
        const supabase = createClient();
        const results: MatchResult[] = [];

        try {
            // Strategy 1: Exact English name match
            if (thaiCard.english_name) {
                const { data: exactMatches } = await supabase
                    .from('pokemon_cards')
                    .select('*')
                    .eq('language', 'en')
                    .ilike('name', thaiCard.english_name)
                    .limit(5);

                if (exactMatches) {
                    results.push(...exactMatches.map(card => ({
                        cardId: card.id,
                        card,
                        confidence: 1.0,
                        method: 'name_exact' as const
                    })));
                }
            }

            // Strategy 2: Fuzzy name match with English name
            if (thaiCard.english_name && results.length === 0) {
                const { data: fuzzyMatches } = await supabase
                    .from('pokemon_cards')
                    .select('*')
                    .eq('language', 'en')
                    .ilike('name', `%${thaiCard.english_name.substring(0, 5)}%`)
                    .limit(20);

                if (fuzzyMatches) {
                    fuzzyMatches.forEach(card => {
                        const similarity = this.calculateSimilarity(
                            thaiCard.english_name || '',
                            card.name
                        );

                        if (similarity >= 0.7) {
                            results.push({
                                cardId: card.id,
                                card,
                                confidence: similarity,
                                method: 'name_fuzzy'
                            });
                        }
                    });
                }
            }

            // Strategy 3: Match by set and number (if Thai set has EN equivalent)
            if (results.length === 0) {
                // Try to find cards from same set with same number
                const { data: numberMatches } = await supabase
                    .from('pokemon_cards')
                    .select('*')
                    .eq('language', 'en')
                    .eq('number', thaiCard.number)
                    .limit(10);

                if (numberMatches) {
                    numberMatches.forEach(card => {
                        // Boost confidence if rarity also matches
                        const baseConfidence = 0.8;
                        const rarityBonus = card.rarity === thaiCard.rarity ? 0.15 : 0;

                        results.push({
                            cardId: card.id,
                            card,
                            confidence: Math.min(baseConfidence + rarityBonus, 1.0),
                            method: 'number_match'
                        });
                    });
                }
            }

            // Sort by confidence descending
            return results.sort((a, b) => b.confidence - a.confidence);

        } catch (error) {
            console.error('Error matching Thai card to English:', error);
            return [];
        }
    }

    /**
     * Match Thai card to Japanese cards (fallback if no English match)
     */
    async matchToJapanese(thaiCard: Card): Promise<MatchResult[]> {
        const supabase = createClient();
        const results: MatchResult[] = [];

        try {
            // Primary strategy: Match by card number and rarity
            const { data: matches } = await supabase
                .from('pokemon_cards')
                .select('*')
                .eq('language', 'jp')
                .eq('number', thaiCard.number)
                .limit(10);

            if (matches) {
                matches.forEach(card => {
                    const baseConfidence = 0.75;
                    const rarityBonus = card.rarity === thaiCard.rarity ? 0.2 : 0;

                    results.push({
                        cardId: card.id,
                        card,
                        confidence: Math.min(baseConfidence + rarityBonus, 1.0),
                        method: 'number_match'
                    });
                });
            }

            return results.sort((a, b) => b.confidence - a.confidence);

        } catch (error) {
            console.error('Error matching Thai card to Japanese:', error);
            return [];
        }
    }

    /**
     * Find best match for a Thai card (try EN first, then JP)
     */
    async findBestMatch(thaiCard: Card): Promise<MatchResult | null> {
        // Try English first
        const enMatches = await this.matchToEnglish(thaiCard);

        if (enMatches.length > 0 && enMatches[0].confidence >= 0.7) {
            return enMatches[0];
        }

        // Fallback to Japanese
        const jpMatches = await this.matchToJapanese(thaiCard);

        if (jpMatches.length > 0 && jpMatches[0].confidence >= 0.7) {
            return jpMatches[0];
        }

        return null;
    }

    /**
     * Store a confirmed mapping in the database
     */
    async storeMapping(
        thaiCardId: string,
        matchedCardId: string,
        language: 'en' | 'jp',
        method: string,
        confidence: number
    ): Promise<boolean> {
        const supabase = createClient();

        try {
            const mapping = {
                card_id_th: thaiCardId,
                ...(language === 'en' ? { card_id_en: matchedCardId } : { card_id_jp: matchedCardId }),
                match_method: method,
                confidence_score: confidence,
                verified: confidence >= 0.9, // Auto-verify high confidence matches
            };

            const { error } = await supabase
                .from('card_mappings')
                .upsert(mapping, { onConflict: 'card_id_th' });

            if (error) throw error;
            return true;

        } catch (error) {
            console.error('Error storing card mapping:', error);
            return false;
        }
    }
}

export const fuzzyMatcher = new FuzzyMatcher();
