
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || '' });

export interface ScanResult {
  primary: {
    name: string;
    set: string;
    number: string;
    rarity: string;
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
        model: 'gemini-1.5-flash',
        contents: [
          {
            parts: [
              { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
              { text: "Act as a professional TCG grader. Identify this Pokémon card from the image. Focus on the set symbol and card number at the bottom. Provide the most likely match and a list of candidates if uncertain (e.g. if it could be a different holo version). Return valid JSON matching the schema." }
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
                  number: { type: Type.STRING },
                  rarity: { type: Type.STRING },
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

      return JSON.parse(response.text || '{}') as ScanResult;
    } catch (error) {
      console.error("Gemini Identification Error:", error);
      return null;
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
