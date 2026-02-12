/**
 * JustTCG API Client
 * Provides access to English and Japanese Pokemon card market data
 * API Docs: https://justtcg.com/docs
 */

const JUSTTCG_BASE_URL = 'https://api.justtcg.com/v1';
const API_KEY = process.env.JUSTTCG_API_KEY;

export interface JustTCGPrice {
    card_id: string;
    card_name: string;
    set_name: string;
    number: string;
    rarity: string;
    market_price: number;
    low_price: number;
    high_price: number;
    condition: string; // 'NM', 'LP', 'MP', 'HP', 'DMG'
    language: 'en' | 'jp';
    last_updated: string;
    source_url: string;
}

export interface JustTCGResponse {
    success: boolean;
    data: JustTCGPrice[];
    pagination?: {
        page: number;
        per_page: number;
        total: number;
    };
}

class JustTCGClient {
    private apiKey: string;
    private baseUrl: string;

    constructor() {
        if (!API_KEY) {
            throw new Error('JUSTTCG_API_KEY environment variable is not set');
        }
        this.apiKey = API_KEY;
        this.baseUrl = JUSTTCG_BASE_URL;
    }

    /**
     * Fetch market data for a specific card by name
     */
    async getCardPrices(cardName: string, language: 'en' | 'jp' = 'en'): Promise<JustTCGPrice[]> {
        try {
            const url = `${this.baseUrl}/prices/search`;
            const params = new URLSearchParams({
                q: cardName,
                game: 'pokemon',
                language: language,
            });

            const response = await fetch(`${url}?${params}`, {
                headers: {
                    'x-api-key': this.apiKey,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`JustTCG API error: ${response.status} ${response.statusText}`);
            }

            const data: JustTCGResponse = await response.json();
            return data.success ? data.data : [];
        } catch (error) {
            console.error('JustTCG getCardPrices error:', error);
            return [];
        }
    }

    /**
     * Fetch market data for a specific set
     */
    async getSetPrices(setId: string, language: 'en' | 'jp' = 'en'): Promise<JustTCGPrice[]> {
        try {
            const url = `${this.baseUrl}/prices/set/${setId}`;
            const params = new URLSearchParams({
                language: language,
            });

            const response = await fetch(`${url}?${params}`, {
                headers: {
                    'x-api-key': this.apiKey,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`JustTCG API error: ${response.status} ${response.statusText}`);
            }

            const data: JustTCGResponse = await response.json();
            return data.success ? data.data : [];
        } catch (error) {
            console.error('JustTCG getSetPrices error:', error);
            return [];
        }
    }

    /**
     * Get averaged market price for a card across all conditions
     */
    async getAverageMarketPrice(
        cardName: string,
        language: 'en' | 'jp' = 'en'
    ): Promise<number | null> {
        const prices = await this.getCardPrices(cardName, language);

        if (prices.length === 0) return null;

        // Filter for NM condition only for more accurate market value
        const nmPrices = prices.filter(p => p.condition === 'NM');
        const relevantPrices = nmPrices.length > 0 ? nmPrices : prices;

        const sum = relevantPrices.reduce((acc, p) => acc + p.market_price, 0);
        return sum / relevantPrices.length;
    }
}

export const justTCGClient = new JustTCGClient();
