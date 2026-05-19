import { GoogleGenAI, Type } from "@google/genai";
import { createClient as createAdminClient, SupabaseClient } from '@supabase/supabase-js';
import { computeDHash, base64ToBuffer, bufferToPostgresBytea } from '@/lib/phash';
import { mapSupabaseCardToInternal } from '@/lib/cardMapper';
import { Card } from '../types';

// Lazy-init both clients. createAdminClient throws at construction time when
// SUPABASE_URL is empty (which is true during `next build` page-data collection
// in environments without env vars). Lazy init defers that to the first
// request, so the build can complete.
let _ai: GoogleGenAI | null | undefined;
function getAi(): GoogleGenAI | null {
    if (_ai !== undefined) return _ai;
    const apiKey = process.env.GEMINI_API_KEY || '';
    _ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
    return _ai;
}

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
    if (_supabase) return _supabase;
    _supabase = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );
    return _supabase;
}

// dHash distance thresholds (out of 64 bits).
// 0-6: essentially the same image. 7-14: same card, different print/angle.
// 15-22: same Pokémon, different art. 23+: unrelated.
const DIST_HIGH_CONFIDENCE = 8;
const DIST_CANDIDATE_CEILING = 20;

export interface ScanResultPrimary {
  name: string;
  set: string;
  setHint?: string;
  number: string;
  rarity: string;
  language?: 'en' | 'th' | 'jp' | 'other';
  confidence: number;
}

export interface ScanResult {
  primary: ScanResultPrimary | null;
  candidates: Array<{ name: string; set: string; number: string; reason: string }>;
  // pHash-resolved cards. Frontend should prefer these over re-querying via name/set.
  matches?: Card[];
  // Distance of the top pHash match, when present. Lower = better.
  matchDistance?: number;
  // Which path produced the result, for telemetry.
  source?: 'phash' | 'gemini-text' | 'gemini-image' | 'lens';
}

export interface ScanPayload {
  image?: string;
  text?: string;
  languageHint?: 'en' | 'jp' | 'th' | 'other';
}

export const scannerService = {
  async scanCard(payload: ScanPayload): Promise<ScanResult> {
    const serpApiKey = process.env.SERPAPI_API_KEY;
    const ai = getAi();
    const hasGemini = !!ai;
    const hasImage = !!payload.image;
    const hasText = !!payload.text;

    // 1) pHash path — runs whenever an image is present. Far cheaper and more accurate
    // than any LLM call when the card has been backfilled into the catalog.
    if (hasImage) {
      try {
        const phashResult = await this.phashScan(payload.image as string, payload.languageHint);
        if (phashResult && phashResult.matches && phashResult.matches.length > 0) {
          const bestDist = phashResult.matchDistance ?? 99;
          if (bestDist <= DIST_CANDIDATE_CEILING) return phashResult;
          console.log(`[ScannerService] pHash best distance ${bestDist} > ceiling, falling through`);
        }
      } catch (e) {
        console.warn('[ScannerService] pHash path failed:', e);
      }
    }

    // 2) Native OCR text path — when the device produced clean OCR text, parse with Flash.
    if (hasText && hasGemini) {
      try {
        console.log('[ScannerService] Engaging Native OCR Flow via Gemini Flash...');
        const r = await this.geminiTextScan(payload.text as string);
        return { ...r, source: 'gemini-text' };
      } catch (e) {
        console.warn('[ScannerService] Native Text Parse failed, falling back to Image evaluation...', e);
      }
    }

    if (!hasImage) {
      if (!serpApiKey && !hasGemini) {
        throw new Error('No scanning paths available. Configure GEMINI_API_KEY or SERPAPI_API_KEY.');
      }
      throw new Error('Image payload missing and Native Text failed.');
    }

    // 3) Vision LLM fallback (Flash, not Pro — speed matters when pHash has already missed).
    if (hasGemini) {
      try {
        console.log('[ScannerService] Engaging Gemini Flash (image fallback)...');
        const r = await this.geminiScan(payload.image as string, 'gemini-2.5-flash');
        return { ...r, source: 'gemini-image' };
      } catch (e) {
        console.warn('[ScannerService] Gemini Flash failed, falling back to Lens:', e);
      }
    }

    // 4) Last-resort Google Lens via SerpApi.
    if (serpApiKey) {
      try {
        console.log('[ScannerService] Falling back to Google Lens (Slower)...');
        const lensResult = await this.lensScan(payload.image as string, serpApiKey);
        if (lensResult && lensResult.primary && lensResult.primary.confidence > 0.6) {
          return { ...lensResult, source: 'lens' };
        }
      } catch (e) {
        console.warn('[ScannerService] Google Lens failed:', e);
      }
    }

    throw new Error('All scan paths failed. Try a sharper, well-lit image.');
  },

  async phashScan(base64Image: string, languageHint?: string): Promise<ScanResult | null> {
    const supabase = getSupabase();
    const imageBuffer = base64ToBuffer(base64Image);
    const hash = await computeDHash(imageBuffer);
    const hex = bufferToPostgresBytea(hash);

    // Hard-filter by language when the caller hints one. The same artwork produces nearly
    // identical hashes across regional prints, so without a filter a JA card can outrank a
    // TH card even when the user scanned a TH card.
    const filter = languageHint && languageHint !== 'other' ? languageHint : null;

    const runRpc = (lang: string | null) =>
      supabase.rpc('search_pokemon_by_phash', {
        query_phash: hex,
        max_distance: DIST_CANDIDATE_CEILING,
        result_limit: 10,
        language_filter: lang,
      });

    let { data: rows, error } = await runRpc(filter);
    if (error) {
      console.error('[ScannerService] phash RPC error:', error);
      return null;
    }

    // Two-pass: if the hinted language returned nothing, retry without the filter so
    // we still serve a result. Common case: user has app set to TH but scans an EN card.
    if (filter && (!rows || rows.length === 0)) {
      console.log(`[ScannerService] phash: 0 matches in lang=${filter}, retrying unfiltered`);
      const retry = await runRpc(null);
      if (retry.error) {
        console.error('[ScannerService] phash retry error:', retry.error);
        return null;
      }
      rows = retry.data;
    }

    if (!rows || rows.length === 0) return null;

    const ids = rows.map((r: any) => r.id);
    const { data: marketRows } = await supabase
      .from('market_values')
      .select('card_id, market_avg, currency, last_updated')
      .in('card_id', ids);
    const marketByCard = new Map<string, any>();
    for (const m of marketRows ?? []) marketByCard.set(m.card_id, m);

    const { data: setRows } = await supabase
      .from('pokemon_sets')
      .select('id, name, printed_total, total')
      .in('id', Array.from(new Set(rows.map((r: any) => r.set_id).filter(Boolean))));
    const setById = new Map<string, any>();
    for (const s of setRows ?? []) setById.set(s.id, s);

    // Re-rank: prefer language hint within the same distance band so the user's region surfaces first.
    const ranked = [...rows].sort((a: any, b: any) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      if (languageHint && languageHint !== 'other') {
        const al = a.language === languageHint ? 0 : 1;
        const bl = b.language === languageHint ? 0 : 1;
        if (al !== bl) return al - bl;
      }
      return 0;
    });

    const matches: Card[] = ranked.map((r: any) =>
      mapSupabaseCardToInternal({
        ...r,
        market_values: marketByCard.get(r.id) ?? null,
        pokemon_sets: setById.get(r.set_id) ?? null,
      })
    );

    const best = ranked[0];
    const distance = best.distance as number;
    const confidence = distance <= DIST_HIGH_CONFIDENCE ? 0.95 : distance <= 14 ? 0.7 : 0.4;

    const top = matches[0];
    const primary: ScanResultPrimary = {
      name: top.name,
      set: top.set,
      setHint: best.set_id,
      number: top.number,
      rarity: top.rarity,
      language: (top.language as any) || 'en',
      confidence,
    };

    return {
      primary,
      candidates: matches.slice(1, 5).map((c) => ({
        name: c.name,
        set: c.set,
        number: c.number,
        reason: 'pHash neighbour',
      })),
      matches,
      matchDistance: distance,
      source: 'phash',
    };
  },

  async lensScan(base64Image: string, serpApiKey: string): Promise<ScanResult | null> {
    const supabase = getSupabase();
    const ai = getAi();
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    const filename = `scans/temp_lens_${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage.from('listings').upload(filename, byteArray.buffer, {
        contentType: 'image/jpeg',
        upsert: true
    });
    if (uploadError) throw new Error('Failed to upload temp image for Lens: ' + uploadError.message);

    const { data: { publicUrl } } = supabase.storage.from('listings').getPublicUrl(filename);

    const response = await fetch(`https://serpapi.com/search.json?engine=google_lens&url=${encodeURIComponent(publicUrl)}&api_key=${serpApiKey}`);
    const json = await response.json();

    supabase.storage.from('listings').remove([filename]).catch(e => console.error('Temp image cleanup failed:', e));

    if (json.error) throw new Error('SerpApi Error: ' + json.error);

    if (json.visual_matches && json.visual_matches.length > 0 && ai) {
        const titles = json.visual_matches.map((m: any) => m.title).slice(0, 8);
        const parseRes = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Act as a Pokémon TCG expert. Google Lens just identified an image with these titles: ${JSON.stringify(titles)}.

Identify the EXACT Pokémon card (Name, Set Code, Number, Rarity) they represent.
Return your best singular match as 'primary', and alternative matches as 'candidates'.
If the titles are garbage or unrelated to Pokemon, return a low confidence.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: scanResultSchema(),
            }
        });
        return JSON.parse(parseRes.text || '{}') as ScanResult;
    }
    return null;
  },

  async geminiScan(base64Image: string, modelName: string = 'gemini-2.5-flash'): Promise<ScanResult> {
    const ai = getAi();
    if (!ai) throw new Error("Gemini API key not configured");

    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          parts: [
            { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
            {
              text: `Act as a professional TCG grader and card identifier. Identify this EXACT Pokémon card variation from the cropped image.

CRITICAL OCR INSTRUCTIONS:
1. Examine the absolute bottom corners of the card. You must accurately extract the Alphanumeric Set Code (e.g., "SV4a", "s9a", "SV1", "PROMO") and the specific Card Number (e.g., "132/190", "014/165", "005/012").
2. The language of the card will be English, Japanese, or Thai (ภาษาไทย). SET THIS LANGUAGE CORRECTLY!
3. If it is Thai, look for the Thai name but return the standard ENGLISH name for the Pokémon.
4. If there are distinct art variants (like Secret Rares or Art Rares), ensure the set code and number correctly reflect this exact print, not the base set version.
5. Provide your single best exact match as primary. Return valid JSON.` }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: scanResultSchema(),
      }
    });

    return JSON.parse(response.text || '{}') as ScanResult;
  },

  async geminiTextScan(ocrText: string): Promise<ScanResult> {
    const ai = getAi();
    if (!ai) throw new Error("Gemini API key not configured");

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          text: `Act as a professional Pokémon TCG grader. A mobile device ran Native MLKit OCR on a cropped Pokemon card and retrieved the following raw text strings:\n\n[ ${ocrText} ]\n\nIdentify the EXACT Pokémon card variation from this text.
CRITICAL INSTRUCTIONS:
1. Parse the text for the crucial Alphanumeric Set Code (e.g., "SV4a", "s9a", "SV1", "PROMO") and the Card Number (e.g., "132/190", "014/165").
2. The language of the card will be English, Japanese, or Thai (ภาษาไทย). SET THIS LANGUAGE CORRECTLY!
3. If the names are in Thai or Japanese characters, use that to set language, but return the standard ENGLISH name for the Pokémon in the JSON.
4. Provide your single best exact match as primary. Return valid JSON.`
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: scanResultSchema(),
      }
    });

    return JSON.parse(response.text || '{}') as ScanResult;
  }
};

function scanResultSchema() {
    return {
        type: Type.OBJECT,
        properties: {
            primary: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING },
                    set: { type: Type.STRING },
                    setHint: { type: Type.STRING },
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
    };
}
