
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || '' });

export interface ScanResult {
  primary: {
    name: string;
    set: string;
    setHint?: string;
    number: string;
    rarity: string;
    language?: 'en' | 'th' | 'jp' | 'other';
    confidence: number;
  };
  candidates: Array<{
    name: string;
    set: string;
    number: string;
    reason: string;
  }>;
}

export interface SearchIntent {
  englishName: string;
  region: 'en' | 'jp' | 'th' | 'any';
  rarity?: string;
  setHint?: string;
}

export const geminiService = {
  async resolveSearchIntent(query: string): Promise<SearchIntent | null> {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Translate this Pokémon card search query into structured parameters. Query: "${query}"`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              englishName: { type: Type.STRING, description: "The standard English name of the Pokemon" },
              region: { type: Type.STRING, enum: ['en', 'jp', 'th', 'any'] },
              rarity: { type: Type.STRING },
              setHint: { type: Type.STRING }
            },
            required: ["englishName", "region"]
          }
        }
      });
      return JSON.parse(response.text || '{}') as SearchIntent;
    } catch (error) {
      console.error("Search Intent Error:", error);
      return null;
    }
  },

  async identifyCardFromImage(base64Image: string): Promise<ScanResult | null> {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: [
          {
            parts: [
              { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
              {
                text: `Act as a professional TCG grader and card identifier. Identify this Pokémon card from the image.

IMPORTANT INSTRUCTIONS:
1. Focus on the set symbol and card number at the bottom of the card.
2. The card may be in ANY language including Thai (ภาษาไทย), Japanese, or English.
3. If the card has Thai text, it is a Thai regional print. Look for the Thai name but return the ENGLISH name for the Pokémon (e.g. if you see "ลิซาร์ดอน" return "Charizard").
4. **CRITICAL:** Identify the Set Code printed on the card (e.g., "MA3", "SV1", "SV6", "S9a"). This is often more accurate than the full set name.
5. Identify the language of the card (en, th, jp).
6. Card numbers are typically shown as "XXX/YYY" at the bottom.
7. Provide your best match as the primary result and alternatives as candidates.
8. Return valid JSON matching the schema.` }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              primary: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  set: { type: Type.STRING },
                  setHint: { type: Type.STRING, description: "The set code printed on the card (typically bottom left/right, e.g. SV1, MA3, SV6)" },
                  number: { type: Type.STRING },
                  rarity: { type: Type.STRING },
                  language: { type: Type.STRING, enum: ['en', 'th', 'jp', 'other'] },
                  confidence: { type: Type.NUMBER }
                },
                required: ["name", "set", "number"]
              },
              candidates: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    set: { type: Type.STRING },
                    number: { type: Type.STRING },
                    reason: { type: Type.STRING }
                  }
                }
              }
            }
          }
        }
      });

      const parsed = JSON.parse(response.text || '{}') as ScanResult;
      console.log('[GeminiService] Card identified:', parsed.primary?.name, parsed.primary?.set, '#' + parsed.primary?.number);
      return parsed;
    } catch (error) {
      console.error("Gemini Identification Error:", error);
      throw error; // Let the caller handle and show error to user
    }
  },

  async getMarketInsights(currentPrices: any[]) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Analyze these Thai Pokémon card market prices and provide insights: ${JSON.stringify(currentPrices)}. Include a brief summary and whether the market is bullish or bearish. Respond in Markdown.`,
      });
      return response.text;
    } catch (error) {
      console.error("Gemini Market Insight Error:", error);
      return "Market data analysis unavailable right now.";
    }
  }
};
