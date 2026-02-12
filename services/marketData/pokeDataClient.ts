/**
 * PokeData++ API Client (via RapidAPI)
 * Provides access to TCGplayer market data for Pokemon cards
 * API Docs: https://rapidapi.com/tcggo/api/pokedata-api
 */

const RAPIDAPI_BASE_URL = 'https://pokedata-api.p.rapidapi.com';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = 'pokedata-api.p.rapidapi.com';

export interface PokeDataPrice {
    card_id: string;
    card_name: string;
    set_name: string;
    number: string;
    rarity: string;
    tcgplayer_price: number;
    market_price: number;
    low_price: number;
    mid_price: number;
    high_price: number;
    condition: string;
    last_updated: string;
    source_url: string;
}

export interface PokeDataResponse {
    success: boolean;
    data: PokeDataPrice[];
    count?: number;
}

class PokeDataClient {
    private apiKey: string;
    private baseUrl: string;
    private host: string;

    constructor() {
        if (!RAPIDAPI_KEY) {
            throw new Error('RAPIDAPI_KEY environment variable is not set');
        }
        this.apiKey = RAPIDAPI_KEY;
        this.baseUrl = RAPIDAPI_BASE_URL;
        this.host = RAPIDAPI_HOST;
    }

    /**
     * Search for card prices by name
     */
    async searchCardPrices(cardName: string): Promise<PokeDataPrice[]> {
        try {
            const url = `${this.baseUrl}/cards/search`;
            const params = new URLSearchParams({
                name: cardName,
            });

            const response = await fetch(`${url}?${params}`, {
                headers: {
                    'X-RapidAPI-Key': this.apiKey,
                    'X-RapidAPI-Host': this.host,
                },
            });

            if (!response.ok) {
                throw new Error(`PokeData++ API error: ${response.status} ${response.statusText}`);
            }

            const data: PokeDataResponse = await response.json();
            return data.success ? data.data : [];
        } catch (error) {
            console.error('PokeData++ searchCardPrices error:', error);
            return [];
        }
    }

    /**
     * Get prices for a specific set
     */
    async getSetPrices(setId: string): Promise<PokeDataPrice[]> {
        try {
            const url = `${this.baseUrl}/sets/${setId}/prices`;

            const response = await fetch(url, {
                headers: {
                    'X-RapidAPI-Key': this.apiKey,
                    'X-RapidAPI-Host': this.host,
                },
            });

            if (!response.ok) {
                throw new Error(`PokeData++ API error: ${response.status} ${response.statusText}`);
            }

            const data: PokeDataResponse = await response.json();
            return data.success ? data.data : [];
        } catch (error) {
            console.error('PokeData++ getSetPrices error:', error);
            return [];
        }
    }

    /**
     * Get TCGplayer market price for a specific card
     */
    async getMarketPrice(cardName: string): Promise<number | null> {
        const prices = await this.searchCardPrices(cardName);

        if (prices.length === 0) return null;

        // Use market_price (average of low/mid/high) for best estimate
        const validPrices = prices
            .filter(p => p.market_price > 0)
            .map(p => p.market_price);

        if (validPrices.length === 0) return null;

        const sum = validPrices.reduce((acc, price) => acc + price, 0);
        return sum / validPrices.length;
    }
}

export const pokeDataClient = new PokeDataClient();
