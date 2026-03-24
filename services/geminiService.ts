"use server";

import { GoogleGenAI, Type } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || '';
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

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
    if (!ai) return null;
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
    throw new Error('Deprecated: Please use /api/scan route which delegates to Google Lens & Gemini.');
  },

  async getMarketInsights(currentPrices: any[]) {
    if (!ai) return "AI insights unavailable.";
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
