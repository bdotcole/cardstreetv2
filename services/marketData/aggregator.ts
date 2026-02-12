/**
 * Market Data Aggregator - Main Orchestrator
 * Coordinates the daily market data snapshot process
 */

import { createClient } from '@/lib/supabase/client';
import { fuzzyMatcher, type Card } from './fuzzyMatcher';
import { pricingCalculator } from './pricingCalculator';

export interface AggregationResult {
    success: boolean;
    totalCards: number;
    mapped: number;
    priced: number;
    failed: number;
    errors: string[];
}

export class MarketDataAggregator {
    /**
     * Run the complete daily snapshot process
     * 1. Get all Thai cards
     * 2. Match Thai cards to EN/JP counterparts
     * 3. Calculate and store market prices
     */
    async runDailySnapshot(): Promise<AggregationResult> {
        const result: AggregationResult = {
            success: false,
            totalCards: 0,
            mapped: 0,
            priced: 0,
            failed: 0,
            errors: []
        };

        try {
            const supabase = createClient();

            // Step 1: Get all Thai cards that don't have mappings yet
            const { data: thaiCards, error: fetchError } = await supabase
                .from('pokemon_cards')
                .select('*')
                .eq('language', 'th')
                .not('id', 'in', `(SELECT card_id_th FROM card_mappings)`);

            if (fetchError) {
                result.errors.push(`Failed to fetch Thai cards: ${fetchError.message}`);
                return result;
            }

            result.totalCards = thaiCards?.length || 0;

            // Step 2: Match each Thai card
            if (thaiCards) {
                for (const card of thaiCards) {
                    try {
                        const bestMatch = await fuzzyMatcher.findBestMatch(card as Card);

                        if (bestMatch) {
                            const language = bestMatch.card.language as 'en' | 'jp';
                            await fuzzyMatcher.storeMapping(
                                card.id,
                                bestMatch.cardId,
                                language,
                                bestMatch.method,
                                bestMatch.confidence
                            );
                            result.mapped++;
                        } else {
                            result.failed++;

                            // Store in pending_matches for manual review
                            await supabase.from('pending_matches').insert({
                                card_id_th: card.id,
                                suggested_matches: [],
                                status: 'pending'
                            });
                        }
                    } catch (error) {
                        result.failed++;
                        result.errors.push(`Failed to match card ${card.id}: ${error}`);
                    }
                }
            }

            // Step 3: Calculate prices for all mapped Thai cards
            const { data: mappedCards } = await supabase
                .from('card_mappings')
                .select('card_id_th');

            if (mappedCards) {
                for (const mapping of mappedCards) {
                    try {
                        const snapshot = await pricingCalculator.calculateThaiCardPrice(
                            mapping.card_id_th
                        );

                        if (snapshot) {
                            await pricingCalculator.storeSnapshot(snapshot);
                            result.priced++;
                        }
                    } catch (error) {
                        result.errors.push(`Failed to price card ${mapping.card_id_th}: ${error}`);
                    }
                }
            }

            result.success = result.errors.length === 0;
            return result;

        } catch (error) {
            result.errors.push(`Fatal error in aggregation: ${error}`);
            return result;
        }
    }

    /**
     * Run incremental update for specific cards
     */
    async updateSpecificCards(cardIds: string[]): Promise<AggregationResult> {
        const result: AggregationResult = {
            success: false,
            totalCards: cardIds.length,
            mapped: 0,
            priced: 0,
            failed: 0,
            errors: []
        };

        try {
            for (const cardId of cardIds) {
                const snapshot = await pricingCalculator.calculateThaiCardPrice(cardId);

                if (snapshot) {
                    await pricingCalculator.storeSnapshot(snapshot);
                    result.priced++;
                } else {
                    result.failed++;
                }
            }

            result.success = true;
            return result;

        } catch (error) {
            result.errors.push(`Error updating cards: ${error}`);
            return result;
        }
    }
}

export const marketDataAggregator = new MarketDataAggregator();
