import { GoogleGenAI, Type } from "@google/genai";
import { createClient as createAdminClient, SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
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
  source?: 'set-code-ocr' | 'phash' | 'gemini-text' | 'gemini-image' | 'lens';
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
        const phashResult = await this.phashScan(payload.image as string, {
          ocrText: payload.text,
          userLocale: payload.languageHint,
        });
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

  async phashScan(
    base64Image: string,
    opts: { ocrText?: string; userLocale?: string } = {}
  ): Promise<ScanResult | null> {
    const supabase = getSupabase();
    const imageBuffer = base64ToBuffer(base64Image);

    // Compute the dHash AND extract the printed set code / number / language from the
    // bottom of the card, in parallel. Both legs take 200-500ms; wall clock = max.
    //
    // The set-code+number OCR is the kingpin signal: when readable, the combination is
    // globally unique within a language, and the matched set's `language` field is a
    // ground-truth language tag (no visual classifier guessing). This is what unlocks
    // accurate Thai/Japanese scans, since those cards share artwork with their EN/JP
    // counterparts and confuse dHash on its own.
    const [hash, ocr] = await Promise.all([
      computeDHash(imageBuffer),
      this.extractCardMetadata(base64Image, opts.ocrText),
    ]);
    const hex = bufferToPostgresBytea(hash);

    // -------- Tier 1: deterministic (set_id, number) lookup --------
    if (ocr?.setCode && ocr?.cardNumber) {
      const direct = await this.lookupBySetAndNumber(ocr.setCode, ocr.cardNumber, ocr.language);
      if (direct && direct.length > 0) {
        // Multiple matches happen for variant prints (holo/reverse holo/full-art at the
        // same number). Rank them by dHash distance so the user's actual print surfaces.
        const ranked = await this.rankByPhash(direct, hex);
        return this.buildScanResult(ranked, ranked[0].distance ?? 0, 'set-code-ocr');
      }
    }

    // -------- Tier 1b: name-based lookup when set code was unreadable --------
    // Pro often reads the Pokémon name correctly even when the set code is obscured
    // (glare, fingerprint, oblique angle). Cross-checking name + number + language
    // narrows the catalog to a handful of candidates; pHash picks the right one.
    if (ocr?.name && ocr?.language && (ocr?.cardNumber || ocr?.setCode)) {
      const byName = await this.lookupByNameAndLanguage(ocr.name, ocr.language, ocr.cardNumber);
      if (byName && byName.length > 0) {
        const ranked = await this.rankByPhash(byName, hex);
        // Only ship this tier if the best print is reasonably close visually —
        // a low-confidence name match without dHash backing it can be confidently wrong.
        if ((ranked[0].distance ?? 99) <= 14) {
          return this.buildScanResult(ranked, ranked[0].distance ?? 0, 'set-code-ocr');
        }
      }
    }

    // -------- Tier 2: pHash search, filtered by detected language --------
    const filter = ocr?.language ?? null;

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

    // If the detected language returned nothing, the detection may have been wrong
    // (e.g. partial OCR). Retry unfiltered.
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

    // Re-rank: when two prints tie on distance, prefer the user's app-locale region.
    // Purely cosmetic ordering — the candidate list already spans languages when
    // distances are spread, and the user sees the language chip in the UI.
    const ranked = [...rows].sort((a: any, b: any) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      if (opts.userLocale && opts.userLocale !== 'other') {
        const al = a.language === opts.userLocale ? 0 : 1;
        const bl = b.language === opts.userLocale ? 0 : 1;
        if (al !== bl) return al - bl;
      }
      return 0;
    });

    const hydrated = await this.hydrateCards(ranked);
    return this.buildScanResult(hydrated, ranked[0].distance, 'phash');
  },

  // Look up cards by printed set code + card number. The combination is globally
  // unique within a language, so a hit here is essentially ground truth — set IDs in
  // the DB match the printed codes one-to-one (MA3, SV5K, swsh3, sv4pt5, etc.).
  //
  // Regional reprints sometimes append a language indicator to the printed set code:
  // Thai cards print "SV8s T", "MA3 T", etc. The DB column stores only the canonical
  // "SV8s" / "MA3" — language is its own column. We strip any whitespace-delimited
  // suffix tokens before the lookup so OCR'd "SV8s T" still matches DB "SV8s".
  async lookupBySetAndNumber(
    setCode: string,
    cardNumber: string,
    language?: 'en' | 'th' | 'jp' | null,
  ): Promise<any[] | null> {
    const supabase = getSupabase();
    // Take the first whitespace-delimited token, then drop non-alphanumerics.
    // Examples: "SV8s T" → "SV8s", "MA3 T" → "MA3", "sv4pt5" → "sv4pt5".
    const firstToken = setCode.trim().split(/\s+/)[0] ?? '';
    const cleanSet = firstToken.replace(/[^a-zA-Z0-9]/g, '').trim();
    if (!cleanSet) return null;
    // Card numbers are usually "087/198"; we only need the numerator. Strip any
    // leading zeros for one leg; keep the original for the prefix leg because the DB
    // sometimes stores e.g. "087/198" verbatim.
    const numeratorRaw = cardNumber.split('/')[0].replace(/[^a-zA-Z0-9]/g, '').trim();
    const numeratorStripped = numeratorRaw.replace(/^0+/, '') || numeratorRaw;
    if (!numeratorRaw) return null;

    let q = supabase
      .from('pokemon_cards')
      .select('*, market_values(market_avg, currency, last_updated), pokemon_sets(name, printed_total, total)')
      .ilike('set_id', cleanSet)
      .or(
        `number.eq.${numeratorRaw},number.eq.${numeratorStripped},number.ilike.${numeratorRaw}/%,number.ilike.${numeratorStripped}/%`
      );
    if (language) q = q.eq('language', language);

    const { data, error } = await q.limit(5);
    if (error) {
      console.warn('[ScannerService] lookupBySetAndNumber error:', error);
      return null;
    }
    if (data && data.length > 0) return data;

    // Defensive retry: some Thai sets are stored with extra characters in pokemon_sets
    // but the bulk of rows live under the canonical id. Try an ILIKE prefix match if
    // an exact match found nothing.
    let q2 = supabase
      .from('pokemon_cards')
      .select('*, market_values(market_avg, currency, last_updated), pokemon_sets(name, printed_total, total)')
      .ilike('set_id', `${cleanSet}%`)
      .or(
        `number.eq.${numeratorRaw},number.eq.${numeratorStripped},number.ilike.${numeratorRaw}/%,number.ilike.${numeratorStripped}/%`
      );
    if (language) q2 = q2.eq('language', language);
    const retry = await q2.limit(5);
    if (retry.error) {
      console.warn('[ScannerService] lookupBySetAndNumber prefix retry error:', retry.error);
      return null;
    }
    return retry.data && retry.data.length > 0 ? retry.data : null;
  },

  // Fallback lookup for when the set code didn't OCR cleanly but Pro identified the
  // Pokémon name. We restrict by language so we only return cards the user actually
  // could have been scanning (e.g. a Thai-locale collector who held up a Thai card).
  // When the number is also known we further narrow by number — name + number + lang
  // is essentially unique up to print variants.
  async lookupByNameAndLanguage(
    name: string,
    language: 'en' | 'th' | 'jp',
    cardNumber?: string | null,
  ): Promise<any[] | null> {
    const supabase = getSupabase();
    const cleanName = name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
    if (!cleanName) return null;

    let q = supabase
      .from('pokemon_cards')
      .select('*, market_values(market_avg, currency, last_updated), pokemon_sets(name, printed_total, total)')
      .or(`name.ilike.%${cleanName}%,english_name.ilike.%${cleanName}%`)
      .eq('language', language);

    if (cardNumber) {
      const numerator = cardNumber.split('/')[0].replace(/[^a-zA-Z0-9]/g, '').trim();
      if (numerator) {
        const stripped = numerator.replace(/^0+/, '') || numerator;
        q = q.or(
          `number.eq.${numerator},number.eq.${stripped},number.ilike.${numerator}/%,number.ilike.${stripped}/%`,
        );
      }
    }

    const { data, error } = await q.limit(10);
    if (error) {
      console.warn('[ScannerService] lookupByNameAndLanguage error:', error);
      return null;
    }
    return data && data.length > 0 ? data : null;
  },

  // Compute pHash distance for each candidate to pick the best print of a card
  // (e.g. holo vs normal vs reverse-holo all share id/number; the print on the table
  // is whichever has the lowest dHash distance to the captured frame).
  async rankByPhash(cards: any[], queryHex: string): Promise<Array<any & { distance: number }>> {
    const supabase = getSupabase();
    if (cards.length === 1) return [{ ...cards[0], distance: 0 }];

    const ids = cards.map((c) => c.id);
    const { data, error } = await supabase
      .from('pokemon_cards')
      .select('id, phash')
      .in('id', ids);
    if (error || !data) return cards.map((c) => ({ ...c, distance: 0 }));

    // Decode bytea hex (supabase returns it as \x...) and Hamming-compare to query.
    const queryBytes = hexToBytes(queryHex);
    const distById = new Map<string, number>();
    for (const row of data) {
      if (!row.phash) {
        distById.set(row.id, 999);
        continue;
      }
      const cardBytes = decodeSupabaseBytea(row.phash);
      distById.set(row.id, cardBytes ? hammingDistance(queryBytes, cardBytes) : 999);
    }

    return cards
      .map((c) => ({ ...c, distance: distById.get(c.id) ?? 999 }))
      .sort((a, b) => a.distance - b.distance);
  },

  async hydrateCards(rows: any[]): Promise<any[]> {
    const supabase = getSupabase();
    const ids = rows.map((r) => r.id);
    const [marketRes, setsRes] = await Promise.all([
      supabase.from('market_values').select('card_id, market_avg, currency, last_updated').in('card_id', ids),
      supabase.from('pokemon_sets').select('id, name, printed_total, total')
        .in('id', Array.from(new Set(rows.map((r) => r.set_id).filter(Boolean)))),
    ]);
    const marketBy = new Map<string, any>();
    for (const m of marketRes.data ?? []) marketBy.set(m.card_id, m);
    const setBy = new Map<string, any>();
    for (const s of setsRes.data ?? []) setBy.set(s.id, s);
    return rows.map((r) => ({
      ...r,
      market_values: marketBy.get(r.id) ?? r.market_values ?? null,
      pokemon_sets: setBy.get(r.set_id) ?? r.pokemon_sets ?? null,
    }));
  },

  buildScanResult(
    ranked: any[],
    distance: number,
    source: 'phash' | 'set-code-ocr',
  ): ScanResult {
    const matches: Card[] = ranked.map((r) => mapSupabaseCardToInternal(r));
    const confidence =
      source === 'set-code-ocr'
        ? 0.97
        : distance <= DIST_HIGH_CONFIDENCE
        ? 0.95
        : distance <= 14
        ? 0.7
        : 0.4;
    const top = matches[0];
    const primary: ScanResultPrimary = {
      name: top.name,
      set: top.set,
      setHint: ranked[0].set_id,
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
        reason: source === 'set-code-ocr' ? 'same set+number variant' : 'pHash neighbour',
      })),
      matches,
      matchDistance: distance,
      source,
    };
  },

  // Full-card identification using Gemini 2.5 Pro. Multi-image input: the full card
  // plus a bottom-strip crop so the model has both the artwork context AND a high-
  // resolution view of the set code / card number printed at the bottom.
  //
  // Why Pro and not Flash here: Flash's OCR on non-Latin scripts (Thai especially) is
  // unreliable, and it can't cross-reference signals — e.g. it sees a Latin set code
  // and outputs `language: "en"` even when the attack box is in Thai. Pro reads Thai
  // script reliably, can attend to multiple card regions in one pass, and produces
  // well-calibrated confidence values.
  //
  // Cost: ~$0.003/scan (two ~1MB images in, ~150 tokens out). Latency: 3-6s typical,
  // ~7s worst case. The compute leg of pHash runs in parallel for free.
  //
  // Free-of-charge fast path: if the device already sent us native MLKit OCR text and
  // a quick regex parse extracts everything we need, we skip the Pro call.
  async extractCardMetadata(
    base64Image: string,
    ocrText?: string,
  ): Promise<{
    setCode: string | null;
    cardNumber: string | null;
    language: 'en' | 'th' | 'jp' | null;
    name?: string | null;
    rarity?: string | null;
    confidence?: number;
  } | null> {
    const fromOcrText = parseMetadataFromOcrText(ocrText);
    if (fromOcrText && fromOcrText.setCode && fromOcrText.cardNumber && fromOcrText.language) {
      return fromOcrText;
    }

    const ai = getAi();
    if (!ai) return fromOcrText;

    // Prepare two image inputs: full card, and bottom strip. Pro handles multi-image
    // input well — the bottom crop emphasises the set code without losing whole-card
    // context (set symbol, language of attack box text, rarity icon, etc.).
    let fullBase64: string;
    let bottomBase64: string;
    try {
      const buf = base64ToBuffer(base64Image);
      const meta = await sharp(buf).metadata();
      if (!meta.height || !meta.width) return fromOcrText;
      // Re-encode the full image with a sane quality ceiling — incoming frames are
      // sometimes oversized JPEGs that waste input tokens.
      const fullJpeg = await sharp(buf).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
      fullBase64 = fullJpeg.toString('base64');

      const cropTop = Math.floor(meta.height * 0.78);
      const bottom = await sharp(buf)
        .extract({ left: 0, top: cropTop, width: meta.width, height: meta.height - cropTop })
        .jpeg({ quality: 92 })
        .toBuffer();
      bottomBase64 = bottom.toString('base64');
    } catch (e) {
      console.warn('[ScannerService] image prep for Pro failed:', e);
      return fromOcrText;
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: [
          {
            parts: [
              { inlineData: { data: fullBase64, mimeType: 'image/jpeg' } },
              { inlineData: { data: bottomBase64, mimeType: 'image/jpeg' } },
              {
                text: `You are a Pokémon TCG identification expert. Two images are provided: the full card, then a magnified view of its bottom edge.

Extract the following fields. Cross-reference visual signals; do not guess from any single region in isolation.

- name: The Pokémon's name in English. Even if the card is Thai or Japanese, return the canonical ENGLISH name (e.g. "Charizard ex", "Pikachu V").
- setCode: The short alphanumeric printed near the bottom corners. Examples: "MA3", "MA2", "SV5K", "SV4a", "sv4pt5", "swsh3", "PROMO", "s12a", "s9a". Preserve exact casing. Look at the magnified bottom view carefully. If unreadable, return null.
- cardNumber: The card number as printed, usually digits with a forward slash. Examples: "087/198", "132/190", "14/214", "SV001". If unreadable, return null.
- language: The language of the BODY TEXT (attack descriptions, abilities, flavour text). Return "th" if ANY Thai script is visible anywhere on the card. Return "jp" if ANY hiragana, katakana, or kanji is visible. Return "en" only if all body text is in Latin/English. The set code being Latin does NOT make a card English — Thai and Japanese cards use Latin set codes too.
- rarity: One of "C", "U", "R", "RR", "RRR", "SR", "AR", "SAR", "UR", "PB", "EH", "MA", "MUR", or "Common"/"Uncommon"/"Rare" etc. Best effort.
- confidence: Your overall confidence in the identification, 0.0 to 1.0.

Return JSON only.`,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              setCode: { type: Type.STRING },
              cardNumber: { type: Type.STRING },
              language: { type: Type.STRING, enum: ['en', 'th', 'ja'] },
              rarity: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
            },
          },
        },
      });
      const parsed = JSON.parse(response.text || '{}');
      const language =
        parsed.language === 'ja' ? 'jp' : parsed.language === 'th' || parsed.language === 'en' ? parsed.language : null;
      console.log('[ScannerService] Pro extraction:', {
        name: parsed.name,
        setCode: parsed.setCode,
        cardNumber: parsed.cardNumber,
        language,
        confidence: parsed.confidence,
      });
      return {
        setCode: parsed.setCode || fromOcrText?.setCode || null,
        cardNumber: parsed.cardNumber || fromOcrText?.cardNumber || null,
        language: language ?? fromOcrText?.language ?? null,
        name: parsed.name ?? null,
        rarity: parsed.rarity ?? null,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
      };
    } catch (e) {
      console.warn('[ScannerService] Pro extraction failed:', e);
      return fromOcrText;
    }
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

// Quick regex scan over native-OCR text. Free, runs first whenever we have OCR text.
// Misses are common — text is often jumbled and the model picks up things the
// regex can't parse — so we still fall through to the Flash call when fields are
// missing. The point is to skip the LLM hop when the OCR is clean.
const RE_SET_CODE = /\b(MA[0-9]{1,2}|SV[0-9][a-zA-Z0-9]*|sv[0-9][a-zA-Z0-9]*|swsh[0-9]{1,3}|sm[0-9]{1,3}|s[0-9]{1,3}[a-z]?|PROMO)\b/;
const RE_CARD_NUMBER = /\b([0-9]{1,3}\/[0-9]{1,3})\b/;
function parseMetadataFromOcrText(ocrText?: string) {
    if (!ocrText || ocrText.trim().length === 0) return null;
    const setMatch = ocrText.match(RE_SET_CODE);
    const numMatch = ocrText.match(RE_CARD_NUMBER);
    let language: 'en' | 'th' | 'jp' | null = null;
    if (/[฀-๿]/.test(ocrText)) language = 'th';
    else if (/[぀-ヿ一-鿿]/.test(ocrText)) language = 'jp';
    else if (/[A-Za-z]/.test(ocrText)) language = 'en';
    if (!setMatch && !numMatch && !language) return null;
    return {
        setCode: setMatch ? setMatch[1] : null,
        cardNumber: numMatch ? numMatch[1] : null,
        language,
    };
}

// Bytea decode/Hamming for the in-Node pHash distance ranking (variant disambiguation).
// Supabase-js returns bytea as a "\\x..." prefixed hex string when selected as a column.
function decodeSupabaseBytea(value: string): Uint8Array | null {
    if (typeof value !== 'string') return null;
    const hex = value.startsWith('\\x') ? value.slice(2) : value;
    if (hex.length === 0 || hex.length % 2 !== 0) return null;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}

function hexToBytes(hex: string): Uint8Array {
    const stripped = hex.startsWith('\\x') ? hex.slice(2) : hex;
    const out = new Uint8Array(stripped.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(stripped.substr(i * 2, 2), 16);
    return out;
}

function hammingDistance(a: Uint8Array, b: Uint8Array): number {
    if (a.length !== b.length) return 64;
    let total = 0;
    for (let i = 0; i < a.length; i++) {
        let x = a[i] ^ b[i];
        // popcount byte
        x = x - ((x >> 1) & 0x55);
        x = (x & 0x33) + ((x >> 2) & 0x33);
        total += (x + (x >> 4)) & 0x0f;
    }
    return total;
}
