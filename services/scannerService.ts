import { GoogleGenAI, Type } from "@google/genai";
import { createClient as createAdminClient, SupabaseClient } from '@supabase/supabase-js';

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

export const scannerService = {
  async scanCard(payload: { image?: string; text?: string }): Promise<ScanResult> {
    const serpApiKey = process.env.SERPAPI_API_KEY;
    const ai = getAi();
    const hasGemini = !!ai;

    if (!serpApiKey && !hasGemini) {
      throw new Error("No scanning API keys configured. Please add GEMINI_API_KEY or SERPAPI_API_KEY.");
    }

    // Ultra-Fast Native Route: If the device successfully parsed optical text via MLKit natively, 
    // we bypass massive multimodal image inference and use text-only Flash for $0 cost logic parsing.
    if (payload.text && hasGemini) {
        try {
            console.log('[ScannerService] Engaging Native OCR Flow via Gemini Flash (Sub-200ms, nearly free)...');
            return await this.geminiTextScan(payload.text);
        } catch (e) {
            console.warn('[ScannerService] Native Text Parse failed, falling back to Image evaluation...', e);
        }
    }

    const base64Image = payload.image as string;
    if (!base64Image) throw new Error("Image payload missing and Native Text failed.");

    // The user explicitly prefers the bulletproof accuracy of the PRO model over raw latency.
    if (hasGemini) {
        try {
            console.log('[ScannerService] Engaging Gemini Pro (Maximum Accuracy Cropped OCR Image Sequence)...');
            return await this.geminiScan(base64Image, 'gemini-2.5-pro');
        } catch (e) {
            console.warn('[ScannerService] Gemini Pro failed, falling back to Lens:', e);
        }
    }

    // Phase 2: Attempt Google Lens via SerpApi if key exists (Slower fallback >5s)
    if (serpApiKey) {
      try {
        console.log('[ScannerService] Falling back to Google Lens (Slower)...');
        const lensResult = await this.lensScan(base64Image, serpApiKey);
        if (lensResult && lensResult.primary && lensResult.primary.confidence > 0.6) {
             return lensResult;
        }
      } catch (e) {
        console.warn('[ScannerService] Google Lens failed:', e);
      }
    }
    
    throw new Error('Both Gemini Pro and Google Lens fallback failed.');
  },

  async lensScan(base64Image: string, serpApiKey: string): Promise<ScanResult | null> {
    const supabase = getSupabase();
    const ai = getAi();
    // 1. SerpApi requires a URL. We upload the base64 to Supabase temp bucket 'listings'.
    // Remove the data URI prefix if it exists
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const filename = `scans/temp_lens_${Date.now()}.jpg`;
    
    const { error: uploadError } = await supabase.storage.from('listings').upload(filename, byteArray.buffer, {
        contentType: 'image/jpeg',
        upsert: true
    });
    
    if (uploadError) {
        throw new Error('Failed to upload temp image for Lens: ' + uploadError.message);
    }
    
    const { data: { publicUrl } } = supabase.storage.from('listings').getPublicUrl(filename);

    // 2. Call SerpApi Google Lens
    console.log('[ScannerService] Image uploaded, calling SerpApi Lens with URL:', publicUrl);
    const response = await fetch(`https://serpapi.com/search.json?engine=google_lens&url=${encodeURIComponent(publicUrl)}&api_key=${serpApiKey}`);
    const json = await response.json();
    
    // Cleanup temp image asynchronously
    supabase.storage.from('listings').remove([filename]).catch(e => console.error('Temp image cleanup failed:', e));

    if (json.error) {
        throw new Error('SerpApi Error: ' + json.error);
    }

    // 3. Process matches using strict Gemini text-parsing for speed and accuracy
    if (json.visual_matches && json.visual_matches.length > 0) {
        const titles = json.visual_matches.map((m: any) => m.title).slice(0, 8);
        console.log('[ScannerService] Extracted Lens Visual Matches:', titles);

        if (ai) {
             const parseRes = await ai.models.generateContent({
                 model: 'gemini-3-flash-preview',
                 contents: `Act as a Pokémon TCG expert. Google Lens just identified an image with these titles: ${JSON.stringify(titles)}. 
                 
Identify the EXACT Pokémon card (Name, Set Code, Number, Rarity) they represent. 
Return your best singular match as 'primary', and alternative matches as 'candidates'. 
If the titles are garbage or unrelated to Pokemon, return a low confidence.`,
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
                            setHint: { type: Type.STRING },
                            number: { type: Type.STRING },
                            rarity: { type: Type.STRING },
                            language: { type: Type.STRING, enum: ['en', 'th', 'jp', 'other'] },
                            confidence: { type: Type.NUMBER, description: "Confidence score between 0.0 and 1.0 based on the consistency of the Lens titles" }
                            },
                            required: ["name", "set", "number", "confidence"]
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
             const parsed = JSON.parse(parseRes.text || '{}') as ScanResult;
             return parsed;
        }
    }
    
    return null;
  },

  async geminiScan(base64Image: string, modelName: string = 'gemini-2.5-pro'): Promise<ScanResult> {
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
        responseSchema: {
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
        }
      }
    });

    const parsed = JSON.parse(response.text || '{}') as ScanResult;
    return parsed;
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
        responseSchema: {
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
                language: { type: Type.STRING, enum: ['en', 'th', 'jp', 'other'] }
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
    return parsed;
  }
};
