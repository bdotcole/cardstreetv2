/**
 * Pricing Calculator
 * Calculates weighted average prices and Thai card valuations
 */

import { justTCGClient } from './justTCGClient';
import { createClient } from '@/lib/supabase/client';

export interface PriceSource {
    source: string;
    price: number;
    url: string;
    weight: number;
}

export interface MarketSnapshot {
    cardId: string;
    language: 'en' | 'jp' | 'th';
    condition: string;
    marketAvg: number;
    sources: PriceSource[];
    calculationBreakdown: {
        rawPrices: number[];
        afterOutlierRemoval: number[];
        weightedAverage: number;
    };
}

export class PricingCalculator {
    /**
     * Remove outliers using 3 standard deviations rule
     */
    private removeOutliers(prices: number[]): number[] {
        if (prices.length < 3) return prices;

        const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
        const stdDev = Math.sqrt(variance);

        const threshold = 3 * stdDev;
        return prices.filter(p => Math.abs(p - mean) <= threshold);
    }

    /**
     * Calculate weighted average from multiple price sources
     * JustTCG gets 100% weight now
     */
    calculateWeightedAverage(sources: PriceSource[]): number {
        const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);
        const weightedSum = sources.reduce((sum, s) => sum + (s.price * s.weight), 0);

        return weightedSum / totalWeight;
    }

    /**
     * Calculate Thai card price based on English or Japanese counterpart
     * EN: 0.55x multiplier
     * JP: 0.8x multiplier
     */
    calculateThaiPrice(enPrice?: number, jpPrice?: number): number | null {
        if (enPrice && enPrice > 0) {
            return enPrice * 0.55;
        }

        if (jpPrice && jpPrice > 0) {
            return jpPrice * 0.8;
        }

        return null;
    }

    /**
     * Fetch and calculate market price for an English card
     */
    async fetchEnglishMarketPrice(cardName: string): Promise<MarketSnapshot | null> {
        try {
            // Get prices from JustTCG only
            const justTcgPrice = await justTCGClient.getAverageMarketPrice(cardName, 'en');

            const sources: PriceSource[] = [];

            if (justTcgPrice) {
                sources.push({
                    source: 'JustTCG',
                    price: justTcgPrice,
                    url: 'https://justtcg.com',
                    weight: 1.0
                });
            }

            if (sources.length === 0) return null;

            // Remove outliers from raw prices
            const rawPrices = sources.map(s => s.price);
            const cleanedPrices = this.removeOutliers(rawPrices);

            // Filter sources to only include non-outliers
            const validSources = sources.filter(s => cleanedPrices.includes(s.price));

            const marketAvg = this.calculateWeightedAverage(validSources);

            return {
                cardId: '', // Will be set by caller
                language: 'en',
                condition: 'Raw_NM',
                marketAvg,
                sources: validSources,
                calculationBreakdown: {
                    rawPrices,
                    afterOutlierRemoval: cleanedPrices,
                    weightedAverage: marketAvg
                }
            };

        } catch (error) {
            console.error('Error fetching English market price:', error);
            return null;
        }
    }

    /**
     * Fetch and calculate market price for a Japanese card
     */
    async fetchJapaneseMarketPrice(cardName: string): Promise<MarketSnapshot | null> {
        try {
            const justTcgPrice = await justTCGClient.getAverageMarketPrice(cardName, 'jp');

            if (!justTcgPrice) return null;

            const sources: PriceSource[] = [{
                source: 'JustTCG (JP)',
                price: justTcgPrice,
                url: 'https://justtcg.com',
                weight: 1.0
            }];

            return {
                cardId: '',
                language: 'jp',
                condition: 'Raw_NM',
                marketAvg: justTcgPrice,
                sources,
                calculationBreakdown: {
                    rawPrices: [justTcgPrice],
                    afterOutlierRemoval: [justTcgPrice],
                    weightedAverage: justTcgPrice
                }
            };

        } catch (error) {
            console.error('Error fetching Japanese market price:', error);
            return null;
        }
    }

    /**
     * Calculate Thai card price based on mapped English/Japanese card or Internal Sales
     */
    async calculateThaiCardPrice(thaiCardId: string): Promise<MarketSnapshot | null> {
        const supabase = createClient();

        try {
            // First, check for Cardstreet internal sales
            const { data: soldListings, error: listingsErr } = await supabase
                .from('listings')
                .select('price')
                .eq('card_id', thaiCardId)
                .eq('status', 'sold');

            if (!listingsErr && soldListings && soldListings.length > 0) {
                // Calculate average of internal sales
                const sum = soldListings.reduce((acc, curr) => acc + Number(curr.price), 0);
                const internalAvg = sum / soldListings.length;

                return {
                    cardId: thaiCardId,
                    language: 'th',
                    condition: 'Raw_NM',
                    marketAvg: internalAvg,
                    sources: [{
                        source: 'Cardstreet Internal Sales',
                        price: internalAvg,
                        url: 'Internal Listings Data',
                        weight: 1.0
                    }],
                    calculationBreakdown: {
                        rawPrices: soldListings.map(l => Number(l.price)),
                        afterOutlierRemoval: soldListings.map(l => Number(l.price)),
                        weightedAverage: internalAvg,
                    }
                };
            }

            // Get the card mapping as fallback
            const { data: mapping } = await supabase
                .from('card_mappings')
                .select('card_id_en, card_id_jp')
                .eq('card_id_th', thaiCardId)
                .single();

            if (!mapping) {
                console.log('No mapping found for Thai card:', thaiCardId);
                return null;
            }

            let enPrice: number | undefined;
            let jpPrice: number | undefined;
            const sources: PriceSource[] = [];

            // Try to get English counterpart price
            if (mapping.card_id_en) {
                const { data: enCard } = await supabase
                    .from('pokemon_cards')
                    .select('name, english_name')
                    .eq('id', mapping.card_id_en)
                    .single();

                if (enCard) {
                    const enSnapshot = await this.fetchEnglishMarketPrice(enCard.name);
                    if (enSnapshot) {
                        enPrice = enSnapshot.marketAvg;
                        sources.push({
                            source: 'English Counterpart (0.55x)',
                            price: enPrice * 0.55,
                            url: 'Calculated from EN sources',
                            weight: 1.0
                        });
                    }
                }
            }

            // Fallback to Japanese counterpart
            if (!enPrice && mapping.card_id_jp) {
                const { data: jpCard } = await supabase
                    .from('pokemon_cards')
                    .select('name')
                    .eq('id', mapping.card_id_jp)
                    .single();

                if (jpCard) {
                    const jpSnapshot = await this.fetchJapaneseMarketPrice(jpCard.name);
                    if (jpSnapshot) {
                        jpPrice = jpSnapshot.marketAvg;
                        sources.push({
                            source: 'Japanese Counterpart (0.8x)',
                            price: jpPrice * 0.8,
                            url: 'Calculated from JP sources',
                            weight: 1.0
                        });
                    }
                }
            }

            const thaiPrice = this.calculateThaiPrice(enPrice, jpPrice);

            if (!thaiPrice) return null;

            return {
                cardId: thaiCardId,
                language: 'th',
                condition: 'Raw_NM',
                marketAvg: thaiPrice,
                sources,
                calculationBreakdown: {
                    rawPrices: [thaiPrice],
                    afterOutlierRemoval: [thaiPrice],
                    weightedAverage: thaiPrice
                }
            };

        } catch (error) {
            console.error('Error calculating Thai card price:', error);
            return null;
        }
    }

    /**
     * Store market snapshot in database
     */
    async storeSnapshot(snapshot: MarketSnapshot): Promise<boolean> {
        const supabase = createClient();

        try {
            const { error } = await supabase
                .from('market_values')
                .insert({
                    card_id: snapshot.cardId,
                    language: snapshot.language,
                    condition: snapshot.condition,
                    market_avg: snapshot.marketAvg,
                    source_links: snapshot.sources.map(s => s.url),
                    source_prices: snapshot.sources,
                    weighted_calculation: snapshot.calculationBreakdown,
                });

            if (error) throw error;
            return true;

        } catch (error) {
            console.error('Error storing market snapshot:', error);
            return false;
        }
    }
}

export const pricingCalculator = new PricingCalculator();
